// Antwort-Typen der App-API (/api/app/v1). Reine Typen, bewusst OHNE `server-only`: Skripte
// und Prüfungen dürfen sie importieren.
//
// Die native App spiegelt diese Typen als Swift-Codable. Deshalb gilt: Änderungen nur
// ADDITIV (neue optionale Felder, neue Fälle bei Unions, die die App tolerant liest).
// Ein Umbenennen, Entfernen oder eine neue Bedeutung eines Feldes ist ein Bruch und heißt /v2.
import type { ExploreCategory, ExploreData, SpotDetail } from "./spots";
import type { TourDetail, TourSummary } from "./tour-types";

/** Feste Fehlercodes. Nie rohe Fehlertexte nach außen. */
export type AppErrorCode =
  | "auth"
  | "pro"
  | "not_found"
  | "rate_limit"
  | "invalid"
  | "unavailable";

export type AppError = { error: AppErrorCode };

/** Welche Fassung der Inhalte der Betrachter bekommen hat. */
export type AppTier = "pro" | "public";

/** Kategorie ohne Spot-Listen: hängt nicht vom Betrachter ab. */
export type AppCategory = Omit<ExploreCategory, "slugs">;

export type AppBootstrap = {
  apiVersion: 1;
  lang: string;
  minAppVersion: string;
  contentVersion: string;
  locales: string[];
  defaultLocale: string;
  categories: AppCategory[];
  links: {
    imprint: string;
    privacy: string;
    terms: string;
    withdrawal: string | null;
  };
};

export type AppExplore = { lang: string; tier: AppTier } & ExploreData;

export type AppSpot = { lang: string; tier: AppTier; spot: SpotDetail };

export type AppTours = { lang: string; tours: TourSummary[] };

export type AppTour = { lang: string; tier: AppTier; tour: TourDetail };

export type AppMe = {
  userId: string;
  email: string | null;
  canSeePro: boolean;
  locale: string;
  newsletter: boolean;
};
