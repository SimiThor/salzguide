import { createClient } from "./supabase/server";
import { imagesFromMedia } from "./spots";
import { routing } from "@/i18n/routing";
import { translationStatus, type TranslationState } from "./spot-hash";

// Aktuellen User zurückgeben, falls Admin – sonst null.
export async function getAdminUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return profile?.role === "admin" ? user.id : null;
}

export type AdminCategory = { id: string; key: string; season: string; title: string };
export type AdminLocal = { id: string; name: string };

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
