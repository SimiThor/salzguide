import { createClient } from "./supabase/server";
import { imagesFromMedia } from "./spots";
import { routing } from "@/i18n/routing";
import { translationStatus, type TranslationState } from "./spot-hash";
import { HOME_KEYS, type HomeTexts } from "./home-fields";
import { homeSourceHash, type HomeMedia } from "./home-content";
import { parseLandingImage, parseLandingVideo } from "./landing-media";
import deMessages from "../../messages/de.json";

export type AdminCategory = { id: string; key: string; season: string; title: string };
export type AdminLocal = { id: string; name: string };

// ── Nutzer ───────────────────────────────────────────────────────────────────
export type AdminUser = {
  id: string;
  email: string | null;
  isPro: boolean;
  proSource: "stripe" | "migration" | "comp" | null;
  proSince: string | null;
  role: "user" | "admin";
  newsletter: boolean;
  createdAt: string;
  /** Bezahltes Pro. Der Admin darf es NICHT anfassen – siehe lib/user-actions.ts. */
  paidPro: boolean;
};

/** Die letzte Protokollzeile zu einem Nutzer: beantwortet „warum hat der Pro?". */
export type ProGrantEntry = {
  granted: boolean;
  note: string | null;
  adminEmail: string | null;
  createdAt: string;
};

const USER_PAGE_SIZE = 50;

function toAdminUser(r: Record<string, unknown>): AdminUser {
  const proSource = (r.pro_source ?? null) as AdminUser["proSource"];
  const isPro = r.is_pro === true;
  return {
    id: String(r.id),
    email: (r.email as string | null) ?? null,
    isPro,
    proSource,
    proSince: (r.pro_since as string | null) ?? null,
    role: r.role === "admin" ? "admin" : "user",
    newsletter: r.newsletter_opt_in === true,
    createdAt: String(r.created_at),
    // Bezahlt ist nur AKTIVES Stripe-Pro. Nach einer Rückerstattung steht pro_source
    // weiterhin auf 'stripe' (der Webhook setzt nur is_pro=false und lässt die Herkunft
    // stehen) – so jemandem darf man sehr wohl Pro schenken.
    paidPro: isPro && proSource === "stripe",
  };
}

/**
 * Nutzerliste für den Admin. `q` sucht in der E-Mail.
 *
 * Liest mit dem Session-Client: RLS lässt Admins alle Zeilen sehen
 * (`profiles_select_own`: `id = auth.uid() or public.is_admin()`). Der Service-Client
 * wäre hier falsch – er umginge genau die Prüfung, die uns absichert.
 */
export async function getAdminUsers(q?: string): Promise<AdminUser[]> {
  const supabase = await createClient();
  let query = supabase
    .from("profiles")
    .select("id, email, is_pro, pro_source, pro_since, role, newsletter_opt_in, created_at")
    .order("created_at", { ascending: false })
    .limit(USER_PAGE_SIZE);

  const term = (q ?? "").trim();
  if (term) {
    // %-und_-Platzhalter des Suchenden entschärfen, sonst listet „%" alles und der
    // Suchende glaubt, er hätte gefiltert.
    const safe = term.replace(/[\\%_]/g, (c) => `\\${c}`);
    query = query.ilike("email", `%${safe}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("getAdminUsers:", error.message);
    return [];
  }
  return (data ?? []).map((r) => toAdminUser(r as Record<string, unknown>));
}

// ── Support ──────────────────────────────────────────────────────────────────
export type AdminSupportRequest = {
  id: string;
  email: string;
  name: string | null;
  message: string;
  locale: string | null;
  status: "open" | "done";
  hasAccount: boolean;
  handledByEmail: string | null;
  handledAt: string | null;
  createdAt: string;
};

/** Anfragen nach Status, älteste zuerst — wer am längsten wartet, steht oben. */
export async function getSupportRequests(
  status: "open" | "done",
): Promise<AdminSupportRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("support_requests")
    .select(
      "id, email, name, message, locale, status, user_id, handled_at, created_at, handler:profiles!support_requests_handled_by_fkey(email)",
    )
    .eq("status", status)
    // Offene: die ältesten zuerst (die warten am längsten). Erledigte: die neuesten zuerst.
    .order("created_at", { ascending: status === "open" })
    .limit(100);
  if (error) {
    console.error("getSupportRequests:", error.message);
    return [];
  }
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const handler = row.handler as { email?: string } | null;
    return {
      id: String(row.id),
      email: String(row.email),
      name: (row.name as string | null) ?? null,
      message: String(row.message),
      locale: (row.locale as string | null) ?? null,
      status: row.status === "done" ? "done" : "open",
      hasAccount: row.user_id != null,
      handledByEmail: handler?.email ?? null,
      handledAt: (row.handled_at as string | null) ?? null,
      createdAt: String(row.created_at),
    };
  });
}

/**
 * Zu jedem übergebenen Nutzer die JÜNGSTE Protokollzeile, als Map.
 *
 * Eine Abfrage für die ganze Liste statt einer pro Zeile. Die volle Historie steht in
 * pro_grants und ist dort abfragbar — in der Liste zählt nur die eine Frage, die man
 * wirklich stellt: „Warum hat der Pro, obwohl er nie bezahlt hat?"
 *
 * Fehlt die Tabelle noch (Migration 0038 nicht eingespielt), gibt es eine leere Map statt
 * einer kaputten Seite: Die Nutzerliste ist auch ohne Protokoll brauchbar.
 */
export async function getLatestProGrants(
  userIds: string[],
): Promise<Map<string, ProGrantEntry>> {
  const out = new Map<string, ProGrantEntry>();
  if (userIds.length === 0) return out;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pro_grants")
    .select("user_id, granted, note, created_at, admin:profiles!pro_grants_admin_id_fkey(email)")
    .in("user_id", userIds)
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("getLatestProGrants übersprungen – Migration 0038 nötig?", error.message);
    return out;
  }

  // Absteigend sortiert: Der erste Treffer je Nutzer ist der jüngste.
  for (const r of data ?? []) {
    const row = r as Record<string, unknown>;
    const id = String(row.user_id);
    if (out.has(id)) continue;
    const admin = row.admin as { email?: string } | null;
    out.set(id, {
      granted: row.granted === true,
      note: (row.note as string | null) ?? null,
      adminEmail: admin?.email ?? null,
      createdAt: String(row.created_at),
    });
  }
  return out;
}

export async function getCategoriesAll(): Promise<AdminCategory[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("id, key, season, title_translations, sort_order")
    .order("season", { ascending: true })
    .order("sort_order", { ascending: true });
  return (data ?? []).map((c) => {
    const titles = (c.title_translations ?? {}) as Record<string, string>;
    return { id: c.id, key: c.key, season: c.season, title: titles.de ?? c.key };
  });
}

// Volle Kategorie-Daten (alle Übersetzungen) für die Admin-Verwaltung.
export type AdminCategoryFull = {
  id: string;
  key: string;
  season: string;
  titles: Record<string, string>;
  sortOrder: number;
};

export async function getCategoriesAdmin(): Promise<AdminCategoryFull[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("id, key, season, title_translations, sort_order")
    .order("season", { ascending: true })
    .order("sort_order", { ascending: true });
  return (data ?? []).map((c) => ({
    id: c.id as string,
    key: c.key as string,
    season: c.season as string,
    titles: (c.title_translations ?? {}) as Record<string, string>,
    sortOrder: (c.sort_order as number) ?? 0,
  }));
}

export async function getLocalsAll(): Promise<AdminLocal[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("locals").select("id, name").order("name");
  return (data ?? []).map((l) => ({ id: l.id, name: l.name }));
}

// Volle Local-Daten (Name + Rolle + alle Rollen-Übersetzungen + Foto) für die Verwaltung.
export type AdminLocalFull = {
  id: string;
  name: string;
  role: string; // deutsche Basis-Rolle
  roleI18n: Record<string, string>; // Locale -> Rolle (inkl. de)
  avatarUrl: string | null;
};

export async function getLocalsFull(): Promise<AdminLocalFull[]> {
  const supabase = await createClient();
  // role_i18n existiert erst nach Migration 0033 -> mit Fallback abfragen (robust).
  const withI18n = await supabase
    .from("locals")
    .select("id, name, role, avatar_url, role_i18n")
    .order("name");
  const rows = withI18n.error
    ? (await supabase.from("locals").select("id, name, role, avatar_url").order("name")).data
    : withI18n.data;
  return ((rows ?? []) as Record<string, unknown>[]).map((l) => {
    const role = (l.role as string | null) ?? "";
    const i18n = ((l.role_i18n as Record<string, string> | null) ?? {}) as Record<string, string>;
    return {
      id: l.id as string,
      name: l.name as string,
      role,
      // Deutsch immer aus der Basis-Spalte (Quelle) ableiten.
      roleI18n: { ...i18n, de: role },
      avatarUrl: (l.avatar_url as string | null) ?? null,
    };
  });
}

// Spot-Liste fürs Admin-Dashboard (alle Status; RLS-Admin erlaubt)
export type AdminSpotRow = {
  id: string;
  slug: string;
  type: string;
  is_pro: boolean;
  status: string;
  title: string;
  // Übersetzungs-Status (Anti-Chaos): X/Y Sprachen + veraltet-Flag.
  trPresent: number;
  trTotal: number;
  trState: TranslationState;
};
export async function getAdminSpots(): Promise<AdminSpotRow[]> {
  const supabase = await createClient();
  const targets = routing.locales.filter((l) => l !== "de");
  // Mit source_hash (Aktualitäts-Check). Fällt zurück, falls Spalte noch nicht existiert
  // (Migration 0031 nicht eingespielt) -> Liste bricht NIE.
  const withHash = await supabase
    .from("spots")
    .select("id, slug, type, is_pro, status, spot_translations(title, lang, source_hash)")
    .order("sort_weight", { ascending: false });
  const data = withHash.error
    ? (
        await supabase
          .from("spots")
          .select("id, slug, type, is_pro, status, spot_translations(title, lang)")
          .order("sort_weight", { ascending: false })
      ).data
    : withHash.data;
  return (data ?? []).map((s) => {
    const tr = (s.spot_translations ?? []) as {
      title: string;
      lang: string;
      source_hash?: string | null;
    }[];
    const de = tr.find((t) => t.lang === "de") ?? tr[0];
    const st = translationStatus(tr, targets);
    return {
      id: s.id,
      slug: s.slug,
      type: s.type,
      is_pro: s.is_pro,
      status: s.status,
      title: de?.title ?? s.slug,
      trPresent: st.present,
      trTotal: st.total,
      trState: st.state,
    };
  });
}

// Einen Spot zum Bearbeiten laden (Rohdaten + DE-Übersetzung + Kategorie-IDs)
export async function getSpotForEdit(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("spots")
    .select(
      "*, spot_translations(*), spot_categories(category_id), media(url, role, sort_order)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const tr = (data.spot_translations ?? []) as Record<string, string>[];
  const de = tr.find((t) => t.lang === "de") ?? {};
  // Alle übrigen Sprachen als Map locale -> Zeile (für die N-Sprachen-Bearbeitung).
  const translations: Record<string, Record<string, string>> = {};
  let translationsSourceHash: string | undefined;
  for (const r of tr)
    if (r.lang && r.lang !== "de") {
      translations[r.lang] = r;
      if (!translationsSourceHash && r.source_hash) translationsSourceHash = r.source_hash;
    }
  const categoryIds = ((data.spot_categories ?? []) as { category_id: string }[]).map(
    (c) => c.category_id,
  );
  const images = imagesFromMedia(data.media);
  return { spot: data, de, translations, translationsSourceHash, categoryIds, images };
}

// Alle Spots, die für die Startseite ausgewählt WERDEN KÖNNEN — plus, ob sie es sind.
//
// 🔒 Nur freie Spots: Bei Pro-Spots verlässt das Foto den Server nie und der Titel wird
// geschwärzt; auf der Startseite wäre so eine Karte leer. Sie gar nicht erst anzubieten
// ist ehrlicher, als sie später kommentarlos wegzufiltern (das tut die Startseiten-
// Abfrage zusätzlich, und ein Trigger räumt home_rank weg, wenn ein Spot auf Pro kippt).
export type AdminHomeSpot = {
  slug: string;
  title: string;
  emoji: string | null;
  imageUrl: string | null;
  /** Position auf der Startseite (1 = erste). null = nicht ausgewählt. */
  homeRank: number | null;
};

// `spots` = auswählbare Spots. `migrationMissing` = die Spalte home_rank fehlt noch
// (Migration 0035 nicht eingespielt). Das ist BEWUSST unterschieden: Beides führte sonst
// zu einer leeren Liste, und die Oberfläche behauptete „keine Spots vorhanden" — obwohl es
// welche gibt und in Wahrheit nur die Migration fehlt. Ein Fehler, der wie ein Datenstand
// aussieht, kostet eine Stunde Suchen.
export type AdminHomeFeatured = { spots: AdminHomeSpot[]; migrationMissing: boolean };

export async function getHomeFeaturedAdmin(): Promise<AdminHomeFeatured> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("spots")
    .select(
      "slug, emoji, home_rank, spot_translations(title, lang), media(url, role, sort_order)",
    )
    .eq("status", "published")
    .eq("is_pro", false)
    .order("sort_weight", { ascending: false });

  if (error) {
    console.error("getHomeFeaturedAdmin:", error.message);
    // PostgREST meldet eine unbekannte Spalte mit 42703.
    const missing = error.code === "42703" || /home_rank/.test(error.message);
    return { spots: [], migrationMissing: missing };
  }

  const spots = (data ?? []).map((s) => {
    const trs = (s.spot_translations ?? []) as { title: string; lang: string }[];
    return {
      slug: s.slug as string,
      // Admin-Oberfläche ist deutsch — Titel entsprechend, mit Slug als Notnagel.
      title: trs.find((t) => t.lang === "de")?.title ?? trs[0]?.title ?? (s.slug as string),
      emoji: (s.emoji as string | null) ?? null,
      imageUrl: imagesFromMedia(s.media)[0] ?? null,
      homeRank: (s.home_rank as number | null) ?? null,
    };
  });
  return { spots, migrationMissing: false };
}

// Die Startseiten-Texte fürs Admin-Formular, plus ihr Übersetzungs-Status.
//
// VORBEFÜLLEN: Ist die DB-Zeile leer (Normalfall beim ersten Öffnen), kommen die Texte aus
// messages/de.json. Anton muss also nichts abtippen: Er sieht, was live steht, ändert was
// er will, drückt einmal Speichern, und ab dann gehört die Seite ihm. Ohne das wäre der
// erste Kontakt mit dem Formular 40 leere Felder.
export type AdminHomeContent = {
  /** Deutsche Texte, aus der DB oder (falls leer) aus messages/de.json. */
  texts: HomeTexts;
  /** Steht schon etwas in der DB, oder ist das noch der Datei-Stand? */
  fromDb: boolean;
  /** Welche Sprachen übersetzt sind. */
  translated: string[];
  /** Übersetzungen vorhanden, aber der deutsche Text hat sich seither geändert. */
  stale: boolean;
  state: TranslationState;
  /** Bilder und Video. Steht in derselben Zeile, also in derselben Abfrage. */
  media: HomeMedia;
  /** Die Spalte fehlt noch (Migration 0036 nicht eingespielt). */
  migrationMissing: boolean;
};

const EMPTY_MEDIA: HomeMedia = {
  heroPortrait: null,
  heroLandscape: null,
  explainerVideo: null,
  antonPhoto: null,
  simonPhoto: null,
};

export async function getHomeContentAdmin(): Promise<AdminHomeContent> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("home_content")
    .select("texts, translations, source_hash, media")
    .eq("id", 1)
    .maybeSingle();

  const fileTexts: HomeTexts = Object.fromEntries(
    HOME_KEYS.map((k) => [k, (deMessages as { Home?: Record<string, string> }).Home?.[k] ?? ""]),
  );

  if (error) {
    console.error("getHomeContentAdmin:", error.message);
    // PostgREST meldet eine unbekannte Tabelle/Spalte mit 42P01 bzw. 42703.
    const missing =
      error.code === "42P01" || error.code === "42703" || /home_content/.test(error.message);
    return {
      texts: fileTexts,
      fromDb: false,
      translated: [],
      stale: false,
      state: "none",
      media: EMPTY_MEDIA,
      migrationMissing: missing,
    };
  }

  const dbTexts = (data?.texts ?? {}) as HomeTexts;
  const fromDb = Object.values(dbTexts).some((v) => typeof v === "string" && v.trim());
  const texts = fromDb ? { ...fileTexts, ...dbTexts } : fileTexts;

  const translations = (data?.translations ?? {}) as Record<string, HomeTexts>;
  const targets = routing.locales.filter((l) => l !== "de");
  const translated = targets.filter((l) => Object.values(translations[l] ?? {}).some((v) => v?.trim()));

  // Veraltet: Es gibt Übersetzungen, aber sie wurden zu einem ANDEREN deutschen Stand
  // gemacht. Gleiche Mechanik wie bei Spots und Events (spot-hash.ts).
  const stale =
    translated.length > 0 && !!data?.source_hash && data.source_hash !== homeSourceHash(texts);

  const state: TranslationState =
    translated.length === 0
      ? "none"
      : translated.length < targets.length
        ? "partial"
        : stale
          ? "stale"
          : "complete";

  // Geprüft wie im Lesepfad: Das Formular soll denselben Stand zeigen wie die Startseite,
  // nicht den rohen DB-Inhalt. Sonst sähe im Admin ein Bild gültig aus, das auf der Seite
  // gar nicht erscheint.
  const m = (data?.media ?? {}) as Record<string, unknown>;
  const media: HomeMedia = {
    heroPortrait: parseLandingImage(m.heroPortrait),
    heroLandscape: parseLandingImage(m.heroLandscape),
    explainerVideo: parseLandingVideo(m.explainerVideo),
    antonPhoto: parseLandingImage(m.antonPhoto),
    simonPhoto: parseLandingImage(m.simonPhoto),
  };

  return { texts, fromDb, translated, stale, state, media, migrationMissing: false };
}

/**
 * Nur der Übersetzungs-Status der Startseite, für den Verweis in den Einstellungen.
 *
 * Baut bewusst auf getHomeContentAdmin auf, statt die Veraltet-Rechnung ein zweites Mal
 * hinzuschreiben: Zwei Kopien driften auseinander, und dann sagt die Kachel „aktuell",
 * während das Formular „veraltet" zeigt. Die eine Abfrage mehr kostet auf einer
 * Admin-Seite nichts.
 */
export async function getHomeStatus(): Promise<{ state: TranslationState }> {
  const { state } = await getHomeContentAdmin();
  return { state };
}
