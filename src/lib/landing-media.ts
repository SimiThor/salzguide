// Medien der Startseite an EINER Stelle. Solange ein Slot `null` ist, zeigt die Seite an
// dieser Stelle einen markierten Platzhalter im richtigen Seitenverhältnis, das Layout
// steht also schon fertig, ohne dass irgendwo etwas bricht oder springt.
//
// SO TRÄGST DU DEIN MATERIAL EIN (Anton):
//   1. Datei nach public/landing/ legen.
//   2. Unten den passenden Slot von `null` auf ein Objekt setzen.
//   3. Fertig, Platzhalter verschwindet, Seite lädt das Bild/Video optimiert.
//
// PERFORMANCE (der „Mittelweg" aus scharf + schnell):
// - Bilder: EIN grosses Original reicht (Hochformat ~1200×2133, Querformat ~2400×1350).
//   next/image schneidet daraus automatisch die passenden Grössen pro Gerät und liefert
//   WebP/AVIF aus. Bitte NICHT selbst kleinrechnen, das macht es nur schlechter.
// - Videos: bitte H.264/MP4, Hochformat 1080×1920, ~6–10 s, OHNE Ton, < 2,5 MB. Dazu ein
//   Standbild (poster), das lädt sofort, das Video erst danach bzw. auf Tippen. So bleibt
//   der erste Eindruck scharf UND schnell.
//
// SPÄTER: Diese Datei ist die Übergangslösung, bis die Startseiten-Medien im Admin-Menü
// pflegbar sind (eigener Schritt, siehe Gespräch 07/2026).

export type LandingImage = {
  src: string;
  /** Beschreibung für Screenreader + wenn das Bild nicht lädt. Leer lassen = rein dekorativ. */
  alt: string;
  width: number;
  height: number;
};

export type LandingVideo = {
  src: string;
  /** Standbild, lädt zuerst, das Video kommt erst beim Antippen. Pflicht. */
  poster: string;
};

type LandingMedia = {
  /** Hero, mobil: Hochformat 9:16. Gründer vor der Festung. */
  heroPortrait: LandingImage | null;
  /** Hero, Desktop: Querformat ~16:9. */
  heroLandscape: LandingImage | null;
  /** Erklär-/Gründervideo, Hochformat 9:16. Ein Video reicht für beide Geräte. */
  explainerVideo: LandingVideo | null;
  /** Anton & Simon, quadratisch oder hoch, für die Gründer-Section. */
  founders: LandingImage | null;
};

export const LANDING_MEDIA: LandingMedia = {
  heroPortrait: null,
  heroLandscape: null,
  explainerVideo: null,
  founders: null,
};
