"use server";

import { fetchWithRetry } from "./ai-fetch";
import { stripEmDashFields } from "./em-dash";
import { requireAdmin } from "./admin-guard";

// Server-Actions für Audio-Touren. Muster wie admin-actions.ts:
// - jede Action beginnt mit requireAdmin() aus lib/admin-guard (Defense-in-depth zur RLS)
// - Writes über den SESSION-Client (läuft als eingeloggter Admin; RLS tours_admin_all /
//   spot_audio_admin_all erlauben es)
// - kein revalidatePath (gibt es repo-weit nicht) -> Client ruft router.refresh()

const e = (v: string) => (v.trim() === "" ? null : v.trim());

function slugifyKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}


// Nur eigene Storage-URLs (spot-media-Bucket) zulassen -> kein Fremd-/Tracking-Medium.
function guardStorageUrl(
  url: string | null,
): { ok: true; url: string | null } | { ok: false } {
  const clean = typeof url === "string" && url.trim() ? url.trim() : null;
  if (!clean) return { ok: true, url: null };
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!base || !clean.startsWith(`${base}/storage/v1/object/public/spot-media/`))
    return { ok: false };
  return { ok: true, url: clean };
}

// Ein Stop einer kuratierten Runde = ein POOL-PUNKT (tour_points). Audio/Text gehört
// zum Punkt (im Punkt-Editor gepflegt), nicht zur Tour.
export type TourStopInput = { pointId: string };

export type TourInput = {
  id?: string;
  areaId: string | null;
  emoji: string;
  coverUrl: string | null;
  isPro: boolean;
  freeStops: number;
  status: "draft" | "published";
  durationMin: number | null;
  distanceKm: number | null;
  de: { title: string; subtitle: string; description: string };
  en: { title: string; subtitle: string; description: string };
  stops: TourStopInput[];
};

export type TourSaveResult = { ok: boolean; id?: string; error?: string };

export async function saveTour(input: TourInput): Promise<TourSaveResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;

  const deTitle = input.de.title.trim();
  if (!deTitle) return { ok: false, error: "required" };

  // EN-Parität wie bei Spots/Events: ist ein DE-Feld gefüllt, muss EN dazu gefüllt sein.
  const enTitle = input.en.title.trim();
  const pairs: [string, string][] = [
    [deTitle, enTitle],
    [input.de.subtitle, input.en.subtitle],
    [input.de.description, input.en.description],
  ];
  if (pairs.some(([de, en]) => de.trim() !== "" && en.trim() === ""))
    return { ok: false, error: "en_required" };

  const cover = guardStorageUrl(input.coverUrl);
  if (!cover.ok) return { ok: false, error: "bad_url" };
  const freeStops = Number.isFinite(input.freeStops)
    ? Math.max(0, Math.floor(input.freeStops))
    : 0;

  const row = {
    area_id: input.areaId ?? null,
    region: "stadt-salzburg", // vestigial (Gebiet ersetzt Region); Spalte bleibt NOT-NULL-frei
    emoji: e(input.emoji),
    cover_url: cover.url,
    is_pro: Boolean(input.isPro),
    free_stops: freeStops,
    status: input.status === "published" ? "published" : "draft",
    duration_min:
      input.durationMin != null && Number.isFinite(input.durationMin)
        ? Math.max(0, Math.floor(input.durationMin))
        : null,
    distance_km:
      input.distanceKm != null && Number.isFinite(input.distanceKm)
        ? Math.max(0, input.distanceKm)
        : null,
  };

  const createdNew = !input.id;
  let tourId = input.id;
  if (tourId) {
    const { error } = await supabase.from("tours").update(row).eq("id", tourId);
    if (error) return { ok: false, error: "db" };
  } else {
    const base = slugifyKey(deTitle) || "tour";
    const { data: existing, error: slugErr } = await supabase.from("tours").select("slug"); // GLOBAL unique
    if (slugErr) return { ok: false, error: "db" };
    const used = new Set(((existing ?? []) as { slug: string }[]).map((r) => r.slug));
    // Insert mit Retry bei Unique-Kollision (TOCTOU-Race zwischen SELECT und INSERT).
    for (let attempt = 0; attempt < 6 && !tourId; attempt++) {
      let slug = base;
      let n = 2;
      while (used.has(slug)) slug = `${base}-${n++}`;
      const { data, error } = await supabase
        .from("tours")
        .insert({ ...row, slug })
        .select("id")
        .single();
      if (!error && data) {
        tourId = (data as { id: string }).id;
      } else if (error && (error as { code?: string }).code === "23505") {
        used.add(slug); // Slug inzwischen vergeben -> nächsten Suffix probieren
      } else {
        return { ok: false, error: "db" };
      }
    }
  }
  if (!tourId) return { ok: false, error: "db" };

  // Bricht bei einem Folgefehler ab und räumt eine gerade NEU angelegte Tour wieder
  // weg -> keine Waisen-/Duplikat-Touren (saveTour ist nicht transaktional).
  const abort = async (err: string): Promise<TourSaveResult> => {
    if (createdNew && tourId) await supabase.from("tours").delete().eq("id", tourId);
    return { ok: false, error: err };
  };

  // Übersetzungen (title NOT NULL -> EN fällt auf DE-Titel zurück).
  const { error: eDe } = await supabase.from("tour_translations").upsert(
    {
      tour_id: tourId,
      lang: "de",
      title: deTitle,
      subtitle: e(input.de.subtitle),
      description: e(input.de.description),
    },
    { onConflict: "tour_id,lang" },
  );
  if (eDe) return abort("db");

  const hasEn = [enTitle, input.en.subtitle, input.en.description].some((v) => v.trim() !== "");
  if (hasEn) {
    const { error: eEn } = await supabase.from("tour_translations").upsert(
      {
        tour_id: tourId,
        lang: "en",
        title: enTitle || deTitle,
        subtitle: e(input.en.subtitle),
        description: e(input.en.description),
      },
      { onConflict: "tour_id,lang" },
    );
    if (eEn) return abort("db");
  } else {
    const { error: eEnDel } = await supabase
      .from("tour_translations")
      .delete()
      .eq("tour_id", tourId)
      .eq("lang", "en");
    if (eEnDel) return abort("db");
  }

  // Stops = geordnete Pool-Punkte (dedupe, Reihenfolge = Index) — full replace.
  // Audio/Text gehören zum Punkt und werden hier NICHT geschrieben.
  const seen = new Set<string>();
  const pointIds: string[] = [];
  for (const s of input.stops) {
    if (s.pointId && !seen.has(s.pointId)) {
      seen.add(s.pointId);
      pointIds.push(s.pointId);
    }
  }
  const { error: eStopsDel } = await supabase.from("tour_stops").delete().eq("tour_id", tourId);
  if (eStopsDel) return abort("db");
  if (pointIds.length) {
    const { error: eStops } = await supabase
      .from("tour_stops")
      .insert(pointIds.map((pid, i) => ({ tour_id: tourId, point_id: pid, sort_order: i })));
    if (eStops) return abort("db");
  }

  return { ok: true, id: tourId };
}

export async function deleteTour(id: string): Promise<TourSaveResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { error } = await gate.supabase.from("tours").delete().eq("id", id);
  if (error) return { ok: false, error: "db" };
  return { ok: true };
}

export async function setTourStatus(
  id: string,
  status: "draft" | "published",
): Promise<TourSaveResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const s = status === "published" ? "published" : "draft";
  const { error } = await gate.supabase.from("tours").update({ status: s }).eq("id", id);
  if (error) return { ok: false, error: "db" };
  return { ok: true, id };
}

// ── 1-Klick-Übersetzung der Tour-Texte ins Englische ─────────────────────────
const EN_VOICE = `You translate SalzGuide content from German to English. Keep it natural, casual and local — like a young Salzburg local talking to a friend, not a tourist brochure. Avoid clichés (breathtaking, hidden gem, paradise, must-see). NEVER use em dashes (—). They are the clearest tell of AI-written text and cost us the trust this brand is built on. Write like a human types: full stop, comma, colon, or a plain hyphen. The ONLY exception is Chinese, where the doubled "——" is standard punctuation. Keep proper nouns and place names. Translate faithfully; invent nothing. Return every field via the tool; keep empty fields empty.`;

export type TourTexts = { title: string; subtitle: string; description: string };
export type TourTranslateResult = { ok: boolean; texts?: TourTexts; error?: string };

export async function translateTourText(input: TourTexts): Promise<TourTranslateResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!input.title.trim()) return { ok: false, error: "Bitte zuerst den deutschen Titel ausfüllen." };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "ANTHROPIC_API_KEY fehlt – bitte in .env.local eintragen" };

  const src = {
    title: input.title.trim(),
    subtitle: input.subtitle.trim(),
    description: input.description.trim(),
  };
  const userMsg = `Translate these German audio-tour fields to English and return them via the tool "tour_texts_en". Keep empty fields empty.\n\n${JSON.stringify(
    src,
    null,
    2,
  )}`;

  try {
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1200,
          system: EN_VOICE,
          messages: [{ role: "user", content: userMsg }],
          tools: [
            {
              name: "tour_texts_en",
              description: "The English translations of the SalzGuide audio-tour fields.",
              input_schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  subtitle: { type: "string" },
                  description: { type: "string" },
                },
                required: ["title", "subtitle", "description"],
              },
            },
          ],
          tool_choice: { type: "tool", name: "tour_texts_en" },
        }),
      },
      2,
      60000,
    );
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `Claude ${res.status}: ${txt.slice(0, 160)}` };
    }
    const data = await res.json();
    const block = (data.content ?? []).find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "tour_texts_en",
    ) as { input?: Record<string, string> } | undefined;
    const tt = block?.input;
    if (!tt) return { ok: false, error: "Keine Übersetzung erhalten" };
    const keep = (deVal: string, enVal?: string) => (deVal.trim() ? (enVal ?? "").trim() : "");
    // Der Prompt verbietet den Gedankenstrich, aber ein Prompt ist eine Bitte (em-dash.ts).
    return {
      ok: true,
      texts: stripEmDashFields(
        {
          title: tt.title?.trim() || input.title.trim(),
          subtitle: keep(input.subtitle, tt.subtitle),
          description: keep(input.description, tt.description),
        },
        "en",
      ),
    };
  } catch {
    return { ok: false, error: "KI-Dienst gerade nicht erreichbar – bitte nochmal versuchen." };
  }
}

