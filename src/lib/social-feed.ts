import "server-only";
import { cache } from "react";
import { createServiceClient } from "./supabase/service";
// Typ und Anzahl liegen in social.ts, weil der Admin-Block (Client) sie ebenfalls
// braucht und diese Datei server-only ist. Siehe Kommentar dort.
import { SOCIAL_FEED_SIZE, type SocialPost } from "./social";

// Die LESE-Seite der Instagram-Kacheln (Startseite, Über uns, Admin). Geschrieben wird nur in
// social-actions.ts, hinter dem Admin-Guard.
//
// SERVICE-CLIENT, NICHT DER COOKIE-CLIENT: Die Kacheln sind für jeden Besucher dieselben.
// Sobald eine Seite Cookies liest, muss Next sie bei JEDEM Aufruf neu rendern — die
// Startseite wäre damit wieder dynamisch, obwohl sie eine Verkaufsseite ist. Gleiche
// Begründung wie in home-content.ts, und zwar dieselbe Falle.

type Row = {
  id: string;
  permalink: string;
  image_url: string;
  width: number;
  height: number;
  is_reel: boolean;
  alt: string | null;
};

const SELECT = "id, permalink, image_url, width, height, is_reel, alt";

// Eine Zeile ohne Bild oder ohne Masse würde next/image werfen und damit die ganze Seite.
// Geprüft wird beim Rein UND beim Raus (wie bei den Startseiten-Medien, siehe
// landing-media.ts): Ein kaputter Datensatz kostet SEINE Kachel, nicht die Seite.
function toPosts(rows: Row[]): SocialPost[] {
  return rows
    .filter((r) => r.image_url && r.width > 0 && r.height > 0)
    .map((r) => ({
      id: r.id,
      permalink: r.permalink,
      imageUrl: r.image_url,
      width: r.width,
      height: r.height,
      isReel: r.is_reel,
      alt: (r.alt ?? "").trim(),
    }));
}

/**
 * Die Kacheln für die öffentliche Section, in der im Admin festgelegten Reihenfolge.
 *
 * Fällt hier etwas aus (Migration fehlt, DB kurz weg, noch keine Kachel angelegt), kommt ein
 * leeres Array und die Section blendet sich selbst aus. Eine Startseite darf an einer
 * Instagram-Reihe nicht sterben, und ein leerer Kasten mit „Fehler" wäre schlimmer als keine
 * Section.
 *
 * `cache`: Startseite und Über-uns-Seite fragen je einmal pro Request, nicht pro Kachel.
 */
export const getSocialPosts = cache(async function getSocialPosts(
  limit = SOCIAL_FEED_SIZE,
): Promise<SocialPost[]> {
  try {
    const { data, error } = await createServiceClient()
      .from("social_posts")
      .select(SELECT)
      .order("position", { ascending: true })
      .limit(limit);
    if (error) {
      console.error("social_posts:", error.message);
      return [];
    }
    return toPosts((data ?? []) as Row[]);
  } catch (e) {
    console.error("social_posts:", e instanceof Error ? e.message : e);
    return [];
  }
});

/**
 * ALLE Kacheln für den Admin, auch die über der Sechser-Grenze.
 *
 * Getrennt von getSocialPosts, weil beide etwas anderes beantworten: „Was sehen Besucher?"
 * gegen „Was ist angelegt?". Wer im Admin nur sechs sieht, obwohl acht liegen, löscht die
 * siebte nie und wundert sich über den Speicherverbrauch.
 */
export async function getSocialPostsAdmin(): Promise<SocialPost[]> {
  try {
    const { data, error } = await createServiceClient()
      .from("social_posts")
      .select(SELECT)
      .order("position", { ascending: true });
    if (error) {
      console.error("social_posts (admin):", error.message);
      return [];
    }
    return toPosts((data ?? []) as Row[]);
  } catch (e) {
    console.error("social_posts (admin):", e instanceof Error ? e.message : e);
    return [];
  }
}
