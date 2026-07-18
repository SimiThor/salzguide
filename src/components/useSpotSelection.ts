"use client";

import { useCallback, useEffect, useState } from "react";
import { getSpotRoute } from "@/lib/spot-actions";
import type { SpotCardData } from "@/lib/spots";

/**
 * Ein Spot, den man auf einer Karte auswählen kann. Bewusst das Minimum:
 * `SpotCardData` (das, was jedes Kärtchen und jedes Sheet braucht) plus die Koordinaten.
 * `routeBounds` ist optional — die Startseite bekommt sie mit der Payload mitgeliefert,
 * die Gespeichert-Seite nicht. Fehlt sie, passt die Karte den Ausschnitt an, sobald die
 * Linie da ist (siehe `focusFor`). Ein Unterschied in den Daten, kein Unterschied im
 * Verhalten.
 */
export type SelectableSpot = SpotCardData & {
  lat: number | null;
  lng: number | null;
  routeBounds?: [number, number, number, number] | null;
};

/**
 * Auswahl auf einer Spot-Karte: welcher Spot ist offen, welche Route gehört dazu,
 * wohin fliegt die Kamera, und wie fährt das Sheet wieder zu.
 *
 * WARUM DAS HIER LIEGT UND NICHT IN EXPLORE:
 * Genau diese vier Dinge machten die Startseiten-Karte aus, und genau sie fehlten der
 * Gespeichert-Karte — die zeigte Punkte und sonst nichts. Zweimal nachbauen hätte
 * geheissen: Ab dem nächsten Umbau der Startseite fühlen sich die beiden Karten
 * unterschiedlich an, und niemandem fällt auf, warum. Jetzt gibt es EINE Quelle. Wer
 * hier etwas verbessert, verbessert es auf beiden Karten.
 *
 * Was NICHT hierher gehört, weil es die Seiten wirklich unterscheidet: das Aussehen
 * drumherum, die Saison-Umschaltung, die Regale — und wie viel Platz das Sheet unten
 * abdeckt. Letzteres reicht der Aufrufer an `focusFor` durch.
 */
export function useSpotSelection<T extends SelectableSpot>(spots: T[]) {
  const [slug, setSlug] = useState<string | null>(null);
  // Das Sheet fährt gerade runter (steuert seine eigene Animation).
  const [closing, setClosing] = useState(false);
  // Karte lässt SOFORT los: Pin auf Normalgrösse, Route blendet aus — während das
  // Sheet noch fährt, nicht danach.
  const [dismissing, setDismissing] = useState(false);
  const [routeCache, setRouteCache] = useState<
    Record<string, [number, number][] | null>
  >({});

  // Der einzige Weg, einen Spot zu öffnen — auch aus einem laufenden Schliessen heraus.
  // Beide Riegel müssen fallen, sonst bliebe die Route des neuen Spots aus.
  const open = useCallback((next: string) => {
    setClosing(false);
    setDismissing(false);
    setSlug(next);
  }, []);

  const close = useCallback(() => {
    setSlug(null);
    setClosing(false);
    setDismissing(false);
  }, []);

  const spot = spots.find((s) => s.slug === slug) ?? null;

  // Beim Antippen einer Wanderung deren Route on-demand laden.
  // An `locked` hängen, nicht an `isPro` — sonst bleibt die Route für zahlende
  // Pro-Kunden aus (getSpotRoute gibt sie ihnen sehr wohl heraus).
  useEffect(() => {
    if (!slug) return;
    const s = spots.find((x) => x.slug === slug);
    if (!s || s.type !== "activity" || s.locked) return;
    if (slug in routeCache) return; // schon geladen (auch null wird gecacht)
    let alive = true;
    getSpotRoute(slug).then((coords) => {
      if (alive) setRouteCache((c) => ({ ...c, [slug]: coords }));
    });
    return () => {
      alive = false;
    };
  }, [slug, spots, routeCache]);

  const loadedRoute =
    spot && spot.type === "activity" && !spot.locked
      ? (routeCache[spot.slug] ?? null)
      : null;

  // Was die Karte zeichnen soll. Beim Schliessen sofort nichts mehr.
  const route = dismissing ? null : loadedRoute;
  // Welcher Pin hervorgehoben ist. Gleiche Regel.
  const selectedSlug = dismissing ? null : slug;

  /**
   * Kamera-Ziel. `padTop`/`padBottom` sagen, welcher Streifen der Karte frei bleibt —
   * auf der Startseite Header und Peek-Sheet, im Vollbild der Gespeichert-Karte die
   * Safe-Area und dasselbe Sheet. Das ist der einzige echte Unterschied, deshalb kommt
   * es von aussen.
   *
   * Die Karte nimmt in dieser Reihenfolge: fertige Bounding-Box (ein Zoom, kein
   * Nachladen), sonst die geladene Linie, sonst der Punkt. Damit sitzt eine Wanderung
   * auf BEIDEN Karten am Ende im selben Ausschnitt — die Startseite kommt nur in einem
   * Rutsch dorthin, die Gespeichert-Karte zoomt nach, sobald die Linie da ist.
   */
  const focusFor = useCallback(
    (padTop: number, padBottom: number) =>
      spot && spot.lat != null && spot.lng != null
        ? {
            lng: spot.lng,
            lat: spot.lat,
            padTop,
            padBottom,
            bounds: spot.routeBounds ?? undefined,
            route: loadedRoute ?? undefined,
          }
        : null,
    [spot, loadedRoute],
  );

  return {
    slug,
    spot,
    open,
    close,
    route,
    selectedSlug,
    focusFor,
    closing,
    setClosing,
    dismissing,
    setDismissing,
  };
}
