// Die EINE Quelle unserer Social-Media-Profile (Fusszeile, iPhone-Burger, PC-„Mehr"-Menü,
// Profil-Seite, System-Mails, Instagram-Section der Startseite) — dasselbe Muster wie
// lib/legal-links.ts für die Rechtslinks und lib/nav.ts für die Navigation.
//
// WARUM DAS EINE DATEI IST: Ein Handle wandert. Wer „instagram.com/salzguide" an sechs
// Stellen tippt, hat beim Umbenennen fünf tote Links und merkt es nicht, weil jeder
// einzelne Link für sich völlig normal aussieht. Hier steht es genau einmal, die URL wird
// daraus GERECHNET (siehe profileUrl) — ein falsches Handle ist damit sofort überall
// falsch, statt schleichend an einer Stelle.
//
// KEIN ENV: Handles sind öffentlich, sie stehen in jeder Story. Die siteUrl-Regel
// (lib/site-url.ts) gilt für unsere eigene Adresse, weil die beim Domain-Umzug wandert.
// Ein Instagram-Handle wandert nicht mit dem Hosting.

export type SocialKey = "instagram" | "tiktok";

/**
 * Unsere Handles, OHNE @. Die einzige Zeile, die beim Umbenennen angefasst wird.
 * Steht ganz oben und ganz allein, damit sie niemand suchen muss.
 */
const HANDLES: Record<SocialKey, string> = {
  instagram: "salzguide",
  tiktok: "salzguide",
};

export type SocialProfile = {
  key: SocialKey;
  /** Name der Plattform. Kein Übersetzungs-Key: Marken werden nicht übersetzt. */
  label: string;
  /** Handle ohne @ (für „@salzguide" in der Anzeige). */
  handle: string;
  /** Volle Profil-Adresse. Abgeleitet, nie getippt. */
  url: string;
};

function profileUrl(key: SocialKey, handle: string): string {
  // TikTok braucht das @ IM Pfad, Instagram nicht. Das ist der einzige Unterschied
  // zwischen den beiden und der Grund, warum die URL hier gerechnet und nicht je Profil
  // eingetragen wird.
  return key === "tiktok"
    ? `https://www.tiktok.com/@${handle}`
    : `https://www.instagram.com/${handle}/`;
}

// Reihenfolge (bewusst, gilt überall gleich): Instagram vor TikTok. Instagram ist der
// Kanal, auf dem die Beiträge entstehen, die auf der Startseite laufen.
export const SOCIAL_PROFILES: readonly SocialProfile[] = (
  [
    { key: "instagram", label: "Instagram" },
    { key: "tiktok", label: "TikTok" },
  ] as const
).map((p) => ({
  ...p,
  handle: HANDLES[p.key],
  url: profileUrl(p.key, HANDLES[p.key]),
}));

/** Ein einzelnes Profil, z.B. für die Instagram-Section („@handle" + Folgen-Knopf). */
export function socialProfile(key: SocialKey): SocialProfile {
  // Der Fund ist garantiert: SOCIAL_PROFILES wird aus denselben Keys gebaut. Der Fallback
  // existiert nur, damit der Typ ohne `!` auskommt.
  return SOCIAL_PROFILES.find((p) => p.key === key) ?? SOCIAL_PROFILES[0];
}

/**
 * Die Attribute für JEDEN Link auf ein fremdes Profil. Als Konstante, weil das kein Stil
 * ist, sondern zwei Sicherheits-Entscheidungen:
 *
 * - `noopener`: Die fremde Seite bekommt keinen Zugriff auf unser window (Tabnabbing).
 * - `noreferrer`: Meta und TikTok erfahren NICHT, von welcher Unterseite jemand kam. Das
 *   ist der Grund, warum es hier steht und nicht bloss `noopener`: Ein Referrer wäre eine
 *   Datenübermittlung an die Plattform, ganz ohne dass sie ein Skript bei uns hat.
 * - `target="_blank"`: Unsere Seite bleibt offen. Wer folgt, verliert nicht seinen Platz.
 */
export const EXTERNAL_LINK_ATTRS = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;

// ── Die Instagram-Kacheln: Form und Anzahl ─────────────────────────────────────────────
//
// WARUM DAS HIER STEHT UND NICHT IN social-feed.ts, wo es gelesen wird: Jene Datei ist
// `server-only` (sie greift mit dem Service-Key auf die Datenbank zu). Der Admin-Block ist
// eine Client-Komponente und braucht beides trotzdem. Ein Import von dort hat die ganze App
// mit HTTP 500 lahmgelegt, ohne dass TypeScript oder ESLint ein Wort gesagt hätten: Die
// Grenze zwischen Server und Client kennt nur Next selbst, und zwar erst zur Laufzeit.
//
// Merksatz: Was Server UND Client brauchen, gehört in eine Datei ohne "server-only".

export type SocialPost = {
  id: string;
  /** Der Beitrag auf instagram.com. */
  permalink: string;
  /** Unsere eigene Kopie im Storage. Nie eine Instagram-Adresse (die laufen ab). */
  imageUrl: string;
  width: number;
  height: number;
  /** Reel? Dann liegt ein Play-Zeichen über der Kachel. Aus dem Link abgeleitet. */
  isReel: boolean;
  /** Bildbeschreibung für Screenreader. Leer = die Section nimmt ihren neutralen Satz. */
  alt: string;
};

/** Wie viele Kacheln die Section zeigt. Eine Zahl, zwei Layouts (Streifen am Handy, Reihe am PC). */
export const SOCIAL_FEED_SIZE = 6;

/**
 * Das Seitenverhältnis JEDER Kachel: 4:5, Instagrams Hochformat.
 *
 * WARUM ALS KONSTANTE UND NICHT ZWEIMAL GETIPPT: Die Section auf der Startseite zeigt das
 * Bild in diesem Rahmen (object-cover schneidet mittig zu), der Admin zeigt Vorschau und
 * Listen-Kachel im selben. Stünde die Zahl an drei Stellen, versprächen Vorschau und
 * Ergebnis irgendwann Verschiedenes — und der Zuschnitt fällt erst auf der fertigen Seite
 * auf. So ist der Rahmen für JEDE hochgeladene Bildgrösse derselbe, quer wie hoch wie
 * quadratisch.
 */
export const SOCIAL_TILE_ASPECT = "aspect-[4/5]";
