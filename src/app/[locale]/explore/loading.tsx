// Lade-Gerüst der Entdecken-Seite: dieselbe Raster-Fläche mit Lichtschimmer, die auch
// der Karten-Ladeschirm (MapLoading.tsx) zeigt — der Übergang Skeleton -> Karte wirkt
// so wie EIN durchgehender Ladevorgang statt zweier verschiedener Schirme.
// Gleiche Rahmen-Geometrie wie Explore.tsx (fixed, unter dem Desktop-Header).
export default function Loading() {
  return (
    <div className="fixed inset-0 z-0 md:top-[var(--sg-header-h)]" aria-busy>
      <div className="sg-map-loading absolute inset-0">
        <div className="sg-map-shimmer absolute inset-0" />
      </div>
    </div>
  );
}
