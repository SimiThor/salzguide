import {
  EventRowSkeleton,
  PageHeadSkeleton,
  PillStripSkeleton,
} from "@/components/skeletons";

// Lade-Gerüst der Events-Seite: dynamische Route (gemerkte Events des Betrachters).
// Formen und Abstände spiegeln EventsWeek.tsx: Kopf mit Titel + Datums-Pille,
// Untertitel, Filter-Pillen, dann Tagesgruppen (Wochentags-Überschrift über
// Event-Zeilen) im echten Rhythmus (space-y-10 md:space-y-12).
export default function Loading() {
  return (
    <div className="min-h-viewport pt-[var(--sg-page-top)] md:pt-6" aria-busy>
      <div className="mx-auto w-full max-w-[640px] px-4">
        <PageHeadSkeleton pill />
        <PillStripSkeleton className="mt-4" />
        <div className="mt-5 space-y-10 md:space-y-12">
          {[3, 2].map((rows, day) => (
            <section key={day}>
              <div className="sg-skeleton mb-3 h-3.5 w-32 rounded" />
              <div className="space-y-2.5">
                {Array.from({ length: rows }).map((_, i) => (
                  <EventRowSkeleton key={i} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
