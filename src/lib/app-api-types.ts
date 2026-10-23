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
import type { LngLat, RouteSource, RouteStep } from "./routing/types";
import type { TourMode } from "./tour-mode";

/** Feste Fehlercodes. Nie rohe Fehlertexte nach außen. */
export type AppErrorCode =
  | "auth"
  | "pro"
  | "not_found"
  | "rate_limit"
  | "invalid"
  // 422, nur POST /route: zwischen den Punkten gibt es keinen Weg (oder ein Punkt liegt
  // ausserhalb der Wegdaten). Die App bleibt auf der alten Linie.
  | "no_route"
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

// ── Routing (docs/42) ───────────────────────────────────────────────────────────────────

/**
 * Die Navigationsroute einer Runde ab dem Tour-Start, aus unserem eigenen Routendienst
 * (OpenStreetMap, ODbL; nie Mapbox). Schritte sind sprachneutral: Den Text baut die App aus
 * ihren Sprachdateien (toNavSteps/prepareSteps als Port, docs/42 Abschnitt 5). Wer die Linie
 * oder eine Anweisung anzeigt, zeigt auch `source.attribution`.
 */
export type AppNavRoute = {
  v: 1;
  mode: TourMode;
  /** Profil beim Routendienst, etwa "trekking". */
  profile: string;
  /** Marke der Kette (wie tours.route_hash): ändert sie sich, ist die Runde umgebaut. */
  routeHash: string;
  /** Fingerabdruck der Linie: Schritte und Stellen gelten nur für genau diese Linie. */
  lineHash: string;
  geometry: LngLat[];
  steps: RouteStep[];
  /** Je Stopp in `tour.stops` (gleiche Reihenfolge) die Strecke ab Start in Metern; null = Stopp ohne Punkt. */
  stopAlongM: (number | null)[];
  /** Je Wegpunkt ohne Geschichte (Kennung wie tour.routeVia) seine Strecke ab Start. */
  viaAlongM: Record<string, number>;
  distanceM: number;
  /**
   * Dauer aus Länge und Tempo der Navigation (Fahr- bzw. Gehzeit plus Zuschlag je Stopp), NUR für
   * die Ankunftszeit. Angezeigt wird `tour.durationMin` / `tour.distanceKm`: Das sind die Werte,
   * die der Admin gesetzt hat.
   */
  durationMin: number;
  source: RouteSource;
};

/** Eine Audiodatei im Paket: gesperrte Stopps nur die Kostprobe, freie die Vollfassung. */
export type AppPackageAudio = {
  /** Wie `tour.stops[].spotSlug`. */
  stopId: string;
  kind: "full" | "sample";
  /** Signiert, 2 Stunden gültig: die App lädt sofort. */
  url: string;
  durationSec: number | null;
};

/**
 * Antwort von GET /tours/{slug}/package: alles, was die App für die Fahrt ohne Netz braucht.
 * `tour` ist EXAKT die Antwort von GET /tours/{slug} für diesen Betrachter. Der
 * `contentHash` bleibt gleich, solange sich nichts ändert, was die App neu laden müsste
 * (Texte, Stopps, Sperren, Dateien, Linie, Schritte); die Links ändern sich bei jedem Abruf
 * und zählen nicht mit.
 */
export type AppTourPackage = {
  lang: string;
  tier: AppTier;
  tour: TourDetail;
  /** null nur, wenn die Runde weniger als zwei Punkte mit Koordinate hat. */
  route: AppNavRoute | null;
  /** Kartenausschnitt für die Offline-Karte: Linie und Stopps mit Puffer. */
  bbox: { west: number; south: number; east: number; north: number };
  images: string[];
  audio: AppPackageAudio[];
  contentHash: string;
  /** Pflichthinweis zur Linie (ODbL): "© OpenStreetMap-Mitwirkende". */
  attribution: string;
};

/**
 * Body von POST /route (Umrouten). Der Server baut die Kette selbst aus der Runde; es gibt
 * KEINEN freien Routendienst. Unbekannte Felder = 400 invalid.
 */
export type AppRerouteRequest = {
  tourSlug: string;
  /** Position des Gastes [lng, lat]; höchstens 5 km von der Linie der Runde. */
  from: LngLat;
  /** Optional, muss zur Runde passen (sonst 400 invalid). */
  mode?: TourMode;
  lang?: string;
  /** Indizes in `tour.stops` der noch offenen Stopps, aufsteigend. Fehlt es: alle. */
  keep?: number[];
  /** Fortschritt auf der alten Linie in Metern: lässt Wegpunkte hinter dem Gast weg. */
  alongM?: number;
  /** `viaAlongM` der alten Route. */
  viaAlongM?: Record<string, number>;
};

export type AppReroute = {
  lang: string;
  tier: AppTier;
  route: {
    v: 1;
    mode: TourMode;
    profile: string;
    lineHash: string;
    geometry: LngLat[];
    steps: RouteStep[];
    /** Die Indizes in `tour.stops`, die diese Route anfährt (Echo der Anfrage, bei fehlendem `keep` alle mit Punkt). */
    keep: number[];
    /** Je Eintrag aus `keep` (gleiche Reihenfolge) die Strecke ab `from` in Metern. */
    stopAlongM: (number | null)[];
    viaAlongM: Record<string, number>;
    distanceM: number;
    /** Reine Fahr- bzw. Gehzeit der Reststrecke in Minuten. */
    durationMin: number;
    attribution: string;
  };
};
