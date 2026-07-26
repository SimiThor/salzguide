"use server";

import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";
import { requireAdmin } from "./admin-guard";
import { createServiceClient } from "./supabase/service";
import { MEDIA_BUCKET, storagePathFromUrl } from "./storage";

// Die Instagram-Kacheln pflegen: hinzufügen, verschieben, löschen. Nichts davon spricht mit
// Meta, alles läuft über unsere eigene Tabelle (Migration 0052).
//
// requireAdmin als erste Zeile JEDER Aktion: Eine Server Action ist ein eigener
// POST-Endpunkt, das Layout-Guard des Admin-Bereichs schützt sie NICHT (siehe
// lib/admin-guard.ts). Wer eine hier ohne diesen Aufruf exportiert, hat sie ins offene Netz
// gestellt.
//
// Geschrieben wird mit dem Service-Client, weil die Tabelle bewusst keine Schreib-Policy hat
// (nur Lesen für alle). Der Wächter oben IST die Zugangskontrolle.

export type ActionResult = { ok: boolean; error?: string };

/** Bis hierher wird die Bildbeschreibung gespeichert. Sie ist ein Ersatztext, kein Aufsatz. */
const ALT_MAX = 300;

/**
 * Ist das ein Link auf einen Instagram-Beitrag?
 *
 * Geprüft wird der HOST, nicht die Zeichenkette. Ein `includes("instagram.com")` liesse
 * „https://boese.tld/instagram.com" durch, und dieser Wert landet als `href` auf der
 * Startseite: Aus einer Kachel würde eine Weiterleitung irgendwohin.
 */
function cleanPermalink(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "instagram.com") return null;
  // Zählparameter (igsh=…, utm_…) fliegen raus: Sie stehen in jedem geteilten Instagram-Link,
  // sagen nichts über den Beitrag und wären ein Stück Nutzungsdaten in unserer Datenbank.
  return `https://www.instagram.com${u.pathname}`;
}

/**
 * Reel oder normaler Beitrag? Aus dem Pfad abgeleitet („/reel/…", „/reels/…").
 *
 * Damit ist ein Häkchen weniger im Formular, und es kann nicht falsch stehen: Der Link sagt
 * ohnehin, was es ist. Steht auf einer Kachel wider Erwarten kein Play-Zeichen, ist der Link
 * ein Foto-Link (/p/…), und dann ist das Zeichen auch richtig weg.
 */
function looksLikeReel(permalink: string): boolean {
  return /^\/reels?\//.test(new URL(permalink).pathname);
}

/** Nur Bilder aus unserem eigenen Storage. Alles andere würde next/image zur Laufzeit werfen. */
function ownStorageUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  const prefix = `${base}/storage/v1/object/public/${MEDIA_BUCKET}/`;
  return raw.startsWith(prefix) ? raw : null;
}

/**
 * Reihenfolge auf 0..n-1 glattziehen.
 *
 * Läuft nach jeder Änderung. Ohne das driften die Zahlen (beim Einfügen vorne braucht man
 * eine kleinere als die kleinste, beim Tauschen entstehen Lücken), und irgendwann sitzt
 * jemand vor einer Tabelle mit -3, 0, 7 und rät, was die Zahlen bedeuten. Bei einer Handvoll
 * Kacheln kostet das Glattziehen nichts.
 */
async function renumber(supabase: ReturnType<typeof createServiceClient>): Promise<void> {
  const { data } = await supabase
    .from("social_posts")
    .select("id")
    .order("position", { ascending: true });
  const rows = (data ?? []) as { id: string }[];
  await Promise.all(
    rows.map((r, i) => supabase.from("social_posts").update({ position: i }).eq("id", r.id)),
  );
}

/** Startseite und Über-uns-Seite werden vorgerendert und müssen die Änderung mitbekommen. */
function revalidatePublicPages(): void {
  for (const l of routing.locales) {
    revalidatePath(`/${l}`);
    revalidatePath(`/${l}/ueber-uns`);
  }
}

export type NewSocialPost = {
  /** Link zum Beitrag auf instagram.com. */
  permalink: string;
  /** Bild-URL aus unserem Storage (im Browser komprimiert und hochgeladen). */
  imageUrl: string;
  width: number;
  height: number;
  alt?: string;
};

/**
 * Neue Kachel. Sie landet VORNE, nicht hinten.
 *
 * Grund: Man fügt eine Kachel hinzu, weil man gerade etwas gepostet hat, und der neueste
 * Beitrag gehört bei Instagram nach vorn. Wer sie woanders haben will, verschiebt sie mit
 * den Pfeilen, aber im Normalfall stimmt es ohne einen einzigen weiteren Klick.
 */
export async function addSocialPost(input: NewSocialPost): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const permalink = cleanPermalink(input.permalink);
  if (!permalink) return { ok: false, error: "bad_link" };
  const imageUrl = ownStorageUrl(input.imageUrl);
  if (!imageUrl) return { ok: false, error: "bad_image" };
  const width = Math.round(Number(input.width));
  const height = Math.round(Number(input.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ok: false, error: "bad_size" };
  }

  const supabase = createServiceClient();
  // Kleinste vorhandene Position minus eins: Damit ist die neue Kachel vorn, ohne dass
  // vorher alle anderen angefasst werden müssen. renumber() zieht danach glatt.
  const { data: first } = await supabase
    .from("social_posts")
    .select("position")
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  const position = ((first?.position as number | undefined) ?? 0) - 1;

  const { error } = await supabase.from("social_posts").insert({
    permalink,
    image_url: imageUrl,
    width,
    height,
    is_reel: looksLikeReel(permalink),
    alt: input.alt?.trim().slice(0, ALT_MAX) || null,
    position,
  });
  if (error) {
    console.error("addSocialPost:", error.message);
    return { ok: false, error: "db" };
  }

  await renumber(supabase);
  revalidatePublicPages();
  return { ok: true };
}

/** Kachel löschen, samt Bilddatei. */
export async function deleteSocialPost(id: string): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (typeof id !== "string" || !id) return { ok: false, error: "bad_id" };

  const supabase = createServiceClient();
  const { data: row } = await supabase
    .from("social_posts")
    .select("image_url")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("social_posts").delete().eq("id", id);
  if (error) {
    console.error("deleteSocialPost:", error.message);
    return { ok: false, error: "db" };
  }

  // Erst die Zeile weg, dann die Datei: Andersherum zeigte eine Zeile kurz auf ein Bild, das
  // es nicht mehr gibt. Scheitert das Löschen der Datei, holt der wöchentliche Waisen-Sweep
  // sie nach (storage-orphans.ts) — deshalb ist das hier best effort und kein Fehlerfall.
  const path = storagePathFromUrl((row?.image_url as string | undefined) ?? "");
  if (path) {
    const { error: rmError } = await supabase.storage.from(MEDIA_BUCKET).remove([path]);
    if (rmError) console.error("deleteSocialPost (Datei):", rmError.message);
  }

  await renumber(supabase);
  revalidatePublicPages();
  return { ok: true };
}

/**
 * Kachel eine Stelle nach vorn oder hinten.
 *
 * Zwei Pfeile statt Ziehen-und-Fallenlassen: Bei sechs Kacheln ist das schneller, es
 * funktioniert am Handy genauso wie am PC, und es kann nicht halb misslingen.
 */
export async function moveSocialPost(id: string, dir: "up" | "down"): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (typeof id !== "string" || !id) return { ok: false, error: "bad_id" };
  if (dir !== "up" && dir !== "down") return { ok: false, error: "bad_dir" };

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("social_posts")
    .select("id, position")
    .order("position", { ascending: true });
  const rows = (data ?? []) as { id: string; position: number }[];
  const i = rows.findIndex((r) => r.id === id);
  if (i === -1) return { ok: false, error: "not_found" };
  const j = dir === "up" ? i - 1 : i + 1;
  // Am Rand ist nichts zu tun, und das ist kein Fehler: Der Knopf ist dort ohnehin aus.
  if (j < 0 || j >= rows.length) return { ok: true };

  const [a, b] = [rows[i], rows[j]];
  // Zwei getrennte UPDATEs, KEIN upsert: Ein upsert mit nur { id, position } ist für Postgres
  // ein INSERT mit lauter fehlenden Spalten, und der scheitert an permalink/image_url
  // (not null), bevor der Konflikt auf der id überhaupt erkannt wird.
  //
  // Der Zwischenzustand (zwei Zeilen mit derselben Zahl) ist gefahrlos: Auf `position` liegt
  // absichtlich kein Unique-Constraint, sortiert wird nur, und renumber() zieht gleich glatt.
  const [ua, ub] = await Promise.all([
    supabase.from("social_posts").update({ position: b.position }).eq("id", a.id),
    supabase.from("social_posts").update({ position: a.position }).eq("id", b.id),
  ]);
  if (ua.error || ub.error) {
    console.error("moveSocialPost:", ua.error?.message ?? ub.error?.message);
    return { ok: false, error: "db" };
  }

  await renumber(supabase);
  revalidatePublicPages();
  return { ok: true };
}
