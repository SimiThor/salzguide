import { PageHeadSkeleton, SpotRowSkeleton } from "@/components/skeletons";

// Lade-Gerüst der Merkliste: dynamische Route (Login-Prüfung + eigene Daten).
// Formen und Abstände spiegeln den Hauptfall der Seite (eingeloggt, mit Spots,
// SavedSpots.tsx): Titel, Sektions-Überschrift, die kleine Karte (h-56), darunter
// die Spot-Zeilen mit Foto links. Für Gäste und leere Merklisten ist das Gerüst
// nur einen Wimpernschlag zu sehen, dafür passt es im häufigsten Fall exakt.
export default function Loading() {
  return (
    <div className="min-h-viewport pt-[var(--sg-page-top)] md:pt-6" aria-busy>
      <div className="mx-auto w-full max-w-[640px]">
        <div className="px-4">
          <PageHeadSkeleton subtitle={false} />
        </div>
        <section className="mt-5">
          <div className="sg-skeleton mx-4 mb-3 h-5 w-24 rounded-md" />
          <div className="sg-skeleton mx-4 h-56 rounded-[18px]" />
          <div className="mt-4 space-y-3 px-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <SpotRowSkeleton key={i} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
