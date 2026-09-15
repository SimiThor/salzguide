// Client-sichere Typen für das Audio-Tour-Feature (keine Server-Imports).
import type { TourMode } from "./tour-mode";
import type { VoiceInfo } from "./tts-rules";
import type { ViaLeg } from "./tour-route";
export type { TourMode, VoiceInfo, ViaLeg };

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
  /**
   * Kurzlebige Signed-URL der KOSTPROBE, rund 20 Sekunden. Nur an einem GESPERRTEN Stopp
   * gesetzt, und dort ist `audioUrl` immer null. Ein eigenes Objekt im privaten Bucket, kein
   * Ausschnitt der Volldatei: Sonst laege die ganze Geschichte im Browser.
   */
  teaserUrl?: string | null;
  /** Laenge der Kostprobe in Sekunden, fuer die Beschriftung des Knopfs. */
  teaserSec?: number | null;
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
  // Fortbewegungsart: walk = bestehende Geh-Tour, bike = S-Bike-Runde mit eigenem
  // Navigation-Screen statt manueller Stopp-Auswahl. Spalte `tours.mode` seit Migration
  // 0064 (Enum tour_mode, Default walk); lib/tours.ts liest sie an allen Stellen.
  mode: TourMode;
};

export type TourDetail = TourSummary & {
  /**
   * Wahr, wenn hier ein Admin einen ENTWURF ansieht. Fuer alle anderen gibt es diese Runde
   * gar nicht, getTourDetail liefert dann null. Die Oberflaeche zeigt es sichtbar an, damit
   * niemand einen Entwurf fuer die veroeffentlichte Runde haelt.
   */
  isDraftPreview?: boolean;
  description: string | null;
  /**
   * Die Stimme der Runde, so weit der Player sie kennen darf (Name, Art, Personenname).
   * Daraus baut VoiceDisclosure.tsx den Hinweis unter dem Play-Knopf (docs/39 §2). null =
   * unbekannt oder gemischt (alte gespeicherte Runde), dann der generische KI-Hinweis.
   */
  voice?: VoiceInfo | null;
  stops: TourStopView[];
  canSeePro: boolean; // ob der Betrachter voll berechtigt ist (Pro/Admin)
  // Echte, an Fusswege gesnappte Geh-Route (Mapbox) + Start/Ziel der Runde. Bei
  // KI-Runden kommt sie aus dem Optimizer, bei kuratierten Runden aus dem Admin
  // („Route an die Wege anpassen", Migration 0061). Fehlt sie, zeichnet TourView
  // die Linie über die Stationen.
  routeGeo?: [number, number][] | null; // [lng,lat][] Loop-Geometrie
  start?: { lat: number; lng: number } | null;
  end?: { lat: number; lng: number } | null; // gleich dem Start = Rundweg
  /**
   * Wegpunkte ohne Geschichte je Abschnitt (Migration 0071), Schluessel = Punkt-ID
   * (spotSlug der Stationen), "start" oder "end". Schon an die veroeffentlichte Kette
   * angepasst. Die Rad-Navigation nimmt sie in ihre Anfrage; der Player zeichnet sie nie.
   */
  routeVia?: ViaLeg[] | null;
};
