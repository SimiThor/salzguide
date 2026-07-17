// Form der Startseiten-Medien — und die Prüfung, die sie beim Rein UND beim Raus durchlaufen.
//
// Hier stand bis eben eine Anleitung, wie Anton Dateien nach `public/landing/` legt und die
// Slots von Hand von `null` auf ein Objekt setzt. Das ist vorbei: Die Medien liegen in
// home_content.media und werden im Admin gepflegt (Einstellungen -> „Bilder & Video der
// Startseite"). Eine überholte Anleitung ist schlimmer als keine.
//
// Solange ein Slot `null` ist, zeigt die Seite dort einen markierten Platzhalter im
// richtigen Seitenverhältnis. Das Layout steht also fertig, ohne dass etwas springt.
//
// WARUM GEPRÜFT WIRD, obwohl nur Admins schreiben: `media` ist eine jsonb-Spalte. Dort kann
// alles landen — ein Tippfehler im Supabase-Studio, eine halb geschriebene Zeile, ein Slot
// aus einer älteren Version. Ohne Prüfung reicht das bis in next/image durch, und die
// Startseite wirft für JEDEN Besucher. Ein kaputter Slot soll ein leerer Slot sein: dann
// zeigt die Seite ihren Platzhalter und läuft weiter.

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

// Nur Dateien aus unserem eigenen Storage. Zwei Gründe: next/image lädt ohnehin nur, was in
// next.config.ts unter remotePatterns steht (eine fremde URL gäbe einen Laufzeitfehler statt
// eines Bildes), und die Startseite soll keinen fremden Server einbinden können.
function ownStorage(url: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return false;
  return url.startsWith(`${base}/storage/v1/object/public/`);
}

function positiveInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

/** Gültiges Bild oder null. Nie „halb gültig". */
export function parseLandingImage(v: unknown): LandingImage | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.src !== "string" || !ownStorage(o.src)) return null;
  // Ohne Masse müsste next/image raten, und das Layout springt beim Laden.
  if (!positiveInt(o.width) || !positiveInt(o.height)) return null;
  return {
    src: o.src,
    // Fehlender Alt-Text ist kein Grund, das Bild wegzuwerfen: leer heisst „dekorativ",
    // und das ist eine gültige Aussage.
    alt: typeof o.alt === "string" ? o.alt.trim() : "",
    width: o.width,
    height: o.height,
  };
}

/** Gültiges Video oder null. Ohne Standbild kein Video (siehe LandingVideo.tsx). */
export function parseLandingVideo(v: unknown): LandingVideo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.src !== "string" || !ownStorage(o.src)) return null;
  if (typeof o.poster !== "string" || !ownStorage(o.poster)) return null;
  return { src: o.src, poster: o.poster };
}
