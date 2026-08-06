import { PageHeadSkeleton, TourCardSkeleton } from "@/components/skeletons";

// Lade-Gerüst der Touren-Übersicht: dynamische Route (eigene Runden + Pro-Prüfung).
// Formen und Abstände spiegeln touren/page.tsx: Kopf, darunter die KI-Runden-Karte
// (Sparkle-Chip links, zwei Textzeilen, Chevron — BuildTourCard.tsx), dann das
// Kachel-Raster der kuratierten Runden (Cover über Titel/Untertitel/Meta).
export default function Loading() {
  return (
    <div className="min-h-viewport pt-[var(--sg-page-top)] md:pt-6" aria-busy>
      <div className="mx-auto w-full max-w-[760px] px-4">
        <PageHeadSkeleton />
        <div
          className="mt-5 flex items-center gap-3 rounded-[18px] bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.28)] ring-1 ring-black/[0.05]"
          aria-hidden
        >
          <div className="sg-skeleton h-[26px] w-[26px] shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="sg-skeleton h-4 w-40 rounded" />
            <div className="sg-skeleton mt-2 h-3 w-3/4 rounded" />
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <TourCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
