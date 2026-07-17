// Client-sichere Typen für das Audio-Tour-Feature (keine Server-Imports).

// Eine Station der Tour = ein Spot + (ggf. gegated) Audio.
export type TourStopView = {
  spotSlug: string;
  order: number; // 1-basiert, für die Nummerierung auf Karte/Liste
  title: string;
  shortDesc: string | null;
  emoji: string | null;
  // Titel, Bild und Position sind bei Touren ÖFFENTLICHE Teaser und werden auch bei
  // locked ausgeliefert (Migration 0029). Nur Audio ist die Pro-Ware. Bewusst ANDERS
  // als bei Geheimtipp-Spots, wo genau diese Felder geschwärzt werden.
  imageUrl: string | null;
  lat: number | null;
  lng: number | null;
  // Audio ist bezahlter Pro-Inhalt -> nur gesetzt, wenn der Betrachter diesen Stop
  // hören darf (Gratis-Teaser ODER Pro). Sonst locked=true und audioUrl/Text = null.
  locked: boolean;
  audioUrl: string | null;
  audioText: string | null;
  durationSec: number | null;
};

export type TourSummary = {
  slug: string;
  region: string;
  emoji: string | null;
  coverUrl: string | null;
  title: string;
  subtitle: string | null;
  stopCount: number;
  isPro: boolean;
  freeStops: number;
  durationMin: number | null;
  distanceKm: number | null;
};

export type TourDetail = TourSummary & {
  description: string | null;
  stops: TourStopView[];
  canSeePro: boolean; // ob der Betrachter voll berechtigt ist (Pro/Admin)
  // Nur bei KI-generierten Runden: echte Geh-Route (Mapbox) + fixer Startpunkt der Runde.
  routeGeo?: [number, number][] | null; // [lng,lat][] Loop-Geometrie
  start?: { lat: number; lng: number } | null;
};
