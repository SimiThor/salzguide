"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ComponentProps } from "react";

// Mapbox GL ist mit Abstand der grösste JS-Brocken der Spot-Seite (~1,7 MB roh), die
// Karte steht aber weit unter dem ersten Bildschirm. Deshalb lädt sie erst, wenn der
// Besucher in ihre Nähe scrollt: Der IntersectionObserver unten meldet sich 400 px
// bevor die Kachel sichtbar wird — genug Vorlauf, dass die Karte beim Ankommen meist
// schon steht. Google misst derweil eine Seite ohne Mapbox im kritischen Pfad.
//
// ssr: false ist hier erlaubt (Client-Komponente) und richtig: Server-HTML einer
// Karte gibt es ohnehin nicht. /explore und /gespeichert laden Mapbox bewusst weiter
// sofort — dort IST die Karte die Seite.
const SpotDetailMap = dynamic(() => import("./SpotDetailMap"), {
  ssr: false,
  // Während der Chunk lädt, hält derselbe Platzhalter die Höhe — kein Springen.
  loading: () => <MapCardSkeleton />,
});

// Exakt die Kachel-Masse der Inline-Karte (SpotDetailMap.tsx: CARD + h-60), damit
// der Tausch Platzhalter -> Karte die Seite nicht verschiebt. Das Höhenprofil darunter
// (nur Wanderungen) kommt mit der Karte dazu; durch die 400 px Vorlauf passiert das,
// bevor der Bereich im Bild ist.
function MapCardSkeleton() {
  return (
    <div
      className="sg-skeleton relative h-60 overflow-hidden rounded-[18px]"
      aria-hidden
    />
  );
}

export default function SpotDetailMapLazy(
  props: ComponentProps<typeof SpotDetailMap>,
) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  return <div ref={box}>{near ? <SpotDetailMap {...props} /> : <MapCardSkeleton />}</div>;
}
