// Antwort-Typen der App-API (/api/app/v1). Reine Typen, bewusst OHNE `server-only`: Skripte
// und Prüfungen dürfen sie importieren.
//
// Die native App spiegelt diese Typen als Swift-Codable. Deshalb gilt: Änderungen nur
// ADDITIV (neue optionale Felder, neue Fälle bei Unions, die die App tolerant liest).
// Ein Umbenennen, Entfernen oder eine neue Bedeutung eines Feldes ist ein Bruch und heißt /v2.
import type { ExploreCategory, ExploreData, SpotDetail } from "./spots";
import type { TourDetail, TourSummary } from "./tour-types";
import type { SavedSpot } from "./saved";
import type { WeatherDay } from "./weather";
import type { OpeningWeek } from "./opening-hours";

/** Feste Fehlercodes. Nie rohe Fehlertexte nach außen. */
export type AppErrorCode =
  | "auth"
  | "pro"
  | "not_found"
  | "rate_limit"
  | "invalid"
  | "unavailable";

export type AppError = { error: AppErrorCode };

/** Antwort von POST /auth/email-code: Der Code ist unterwegs (auch für unbekannte Adressen). */
export type AppEmailCodeSent = { ok: true };

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

/** Antwort von GET /saved: Slugs für die Herz-Symbole, Karten für die Liste (nie gesperrt). */
export type AppSaved = { lang: string; slugs: string[]; spots: SavedSpot[] };

/** Antwort von PUT/DELETE /saved/{slug}. Idempotent: gleicher Aufruf, gleiche Antwort. */
export type AppSavedState = { saved: boolean };

/** Body von PATCH /me: mindestens ein Feld. `locale` aus den 13 Codes. */
export type AppMePatch = { locale?: string; newsletter?: boolean };

/**
 * Body von DELETE /me (optional). `appleAuthorizationCode`: frischer Code aus "Mit Apple
 * anmelden", den die App beim Löschen eines Apple-Kontos neu anfordert (docs/41 Abschnitt 5).
 */
export type AppDeleteMeRequest = { appleAuthorizationCode?: string };

/**
 * Antwort von DELETE /me. Das Konto ist bei 200 IMMER gelöscht. `appleRevoked`: null = das Konto
 * hatte keine Apple-Anmeldung; true = Apples Token widerrufen; false = Apple-Konto, aber der
 * Widerruf ging nicht (kein Code, Konfiguration fehlt oder Apple hat abgelehnt).
 */
export type AppDeleted = { deleted: true; appleRevoked: boolean | null };

export type AppWeather = { days: WeatherDay[] };

export type AppOpening = {
  source: "google" | "manual";
  /** Mo..So, wie das Web sie listet. */
  week: OpeningWeek;
  /** Index des heutigen Tages (0 = Montag, Europe/Vienna). */
  todayIndex: number;
  open: boolean;
  /** Minute in der Woche (0 = Mo 00:00) des nächsten Wechsels, oder null. */
  changeAt: number | null;
  /** Feiertagsname je Wochentag DIESER Woche (Mo..So) in der Anfrage-Sprache, sonst null. */
  holidays: (string | null)[];
};

export type AppWaterTemp = {
  lake: { slug: string; name: string };
  tempC: number;
  /** ISO-Zeitpunkt der Messung. */
  at: string;
  source: "salzburg" | "ages";
};

/** Antwort von GET /spots/{slug}/live. Alles null bei gesperrten Spots oder ohne Daten. */
export type AppSpotLive = {
  weather: AppWeather | null;
  opening: AppOpening | null;
  waterTemp: AppWaterTemp | null;
};

/** Body von POST /purchases/apple: bis zu 50 signierte Transaktionen (JWS), je höchstens ca. 10 KB. */
export type AppApplePurchaseRequest = { signedTransactions: string[] };

/**
 * Ergebnis je Transaktion, in der Reihenfolge der Anfrage (Eintrag i gehört zu Eingabe i).
 * granted = verbucht (neu oder an dieses Konto gebunden); already = war schon dieses Kontos;
 * foreign = gehört einem anderen, noch bestehenden Konto (nichts geändert); invalid = Signatur,
 * Bundle-ID, Umgebung, Produkt oder Form falsch (originalTransactionId dann null); revoked =
 * erstattet oder entzogen (kein Pro).
 */
export type AppApplePurchaseStatus = "granted" | "already" | "foreign" | "invalid" | "revoked";

export type AppApplePurchaseResult = {
  originalTransactionId: string | null;
  status: AppApplePurchaseStatus;
};

/** Antwort von POST /purchases/apple. `canSeePro` wie GET /me (inkl. Admin). */
export type AppApplePurchaseResponse = {
  canSeePro: boolean;
  results: AppApplePurchaseResult[];
};
