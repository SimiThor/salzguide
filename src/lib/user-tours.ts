"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "./supabase/server";
import { viewerCanSeePro } from "./spots";
import {
  insertUserTour,
  listUserTourSummaries,
  loadUserTourDetail,
  removeUserTour,
  type SaveUserTourInput as CoreSaveUserTourInput,
  type UserTourSummary as CoreUserTourSummary,
} from "./user-tours-core";
import type { TourDetail } from "./tour-types";

// Gespeicherte User-Runden (0028). Persistiert wird nur der SNAPSHOT (geordnete
// Punkt-IDs + fertige Geh-Route + Meta) -> erneutes Ansehen kostet KEINE API (Claude und
// der Routendienst liefen nur einmal beim Bauen). Titel/Audio werden beim Ansehen frisch geladen,
// neu gegatet und signiert. Owner-Zugriff über RLS (Auth-Client); Struktur/Audio über
// den Service-Client (wie bei kuratierten Touren).
//
// Dieses "use server"-Modul exportiert NICHTS Neues: Die Logik lebt in user-tours-core.ts
// (auch die App-API ruft sie auf, mit dem Bearer-Client). Typen werden nur durchgereicht.
// Typ-Aliase statt `export type { ... }`: Turbopack liest die Re-Export-Form in einer
// "use server"-Datei als echten Export und bricht die Seiten ab.
export type SaveUserTourInput = CoreSaveUserTourInput;
export type UserTourSummary = CoreUserTourSummary;

// Runde des aktuellen Users speichern. RLS erzwingt user_id = auth.uid() und Pro (0072).
export async function saveUserTour(
  input: SaveUserTourInput,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };
  // Eine Server-Action ist ein eigener Eingang, nicht nur ein Schritt von generateTour: Sie
  // lässt sich auch ohne den Builder aufrufen. Speichern ist deshalb dasselbe Pro-Recht wie
  // Bauen, und die Prüfung gehört hierher, nicht nur zum Aufrufer.
  if (!(await viewerCanSeePro())) return { ok: false, error: "pro" };

  const saved = await insertUserTour(supabase, user.id, input);
  if (!saved.ok) return saved;

  revalidatePath("/touren");
  return saved;
}

// Runde des Users löschen (RLS: nur eigene).
export async function deleteUserTour(id: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  if (!(await removeUserTour(supabase, id))) return { ok: false };
  revalidatePath("/touren");
  return { ok: true };
}

// Gespeicherte Runden des Users als Kachel-Daten (null = nicht eingeloggt).
export async function listUserTours(locale: string): Promise<UserTourSummary[] | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return listUserTourSummaries(supabase, locale);
}

// Gespeicherte Runde als TourDetail rekonstruieren (frisches Audio + Gating + Signing).
// RLS auf user_tours stellt sicher, dass nur der Eigentümer die Runde laden kann.
export async function getUserTourDetail(
  id: string,
  locale: string,
): Promise<TourDetail | null> {
  const authed = await createClient();
  const {
    data: { user },
  } = await authed.auth.getUser();
  if (!user) return null;
  return loadUserTourDetail(authed, id, locale, viewerCanSeePro);
}
