// Lade-Gerüst der Vollbild-Karten-Routen (/explore, /wasser, /touren/<slug>,
// /touren/meine/<id>): dieselbe Raster-Fläche mit Lichtschimmer, die auch der
// Karten-Ladeschirm (MapLoading.tsx) zeigt — der Übergang Skeleton -> Karte wirkt so
// wie EIN durchgehender Ladevorgang statt zweier verschiedener Schirme.
// Gleiche Rahmen-Geometrie wie die Karten-Views (fixed, unter dem Desktop-Header).
//
// EINE Komponente für alle vier loading.tsx (Ein System statt Duplikate): Wer eine
// neue Vollbild-Karte baut, legt daneben nur `export { default } from
// "@/components/MapRouteLoading"` an — und trägt die Route in lib/routes.ts ein.
export default function MapRouteLoading() {
  return (
    <div className="fixed inset-0 z-0 md:top-[var(--sg-header-h)]" aria-busy>
      <div className="sg-map-loading absolute inset-0">
        <div className="sg-map-shimmer absolute inset-0" />
      </div>
    </div>
  );
}
