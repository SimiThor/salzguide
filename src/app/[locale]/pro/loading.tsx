// Lade-Gerüst der Pro-Seite: dynamische Route (Auth + Preis von Stripe). Formen
// spiegeln die eine große Bühnen-Karte der Seite (Shell in pro/page.tsx): Kreis-Icon,
// Titel, zwei Textzeilen, unten der runde Knopf — samt echtem Radius (28px) und dem
// warmen Verlauf, damit schon das Gerüst nach der Pro-Bühne aussieht.
export default function Loading() {
  return (
    <div className="min-h-viewport pt-[var(--sg-page-top)] md:pt-8" aria-busy>
      <div className="mx-auto w-full max-w-[480px] px-4">
        <div
          className="rounded-[28px] bg-gradient-to-b from-accent/[0.12] via-white to-white p-8 text-center shadow-[0_24px_60px_-28px_rgba(204,41,36,0.45)] ring-1 ring-black/[0.05]"
          aria-hidden
        >
          <div className="sg-skeleton mx-auto h-16 w-16 rounded-full" />
          <div className="sg-skeleton mx-auto mt-4 h-6 w-48 rounded-lg" />
          <div className="sg-skeleton mx-auto mt-3 h-3.5 w-4/5 rounded" />
          <div className="sg-skeleton mx-auto mt-2 h-3.5 w-3/5 rounded" />
          <div className="sg-skeleton mx-auto mt-6 h-12 w-44 rounded-full" />
        </div>
      </div>
    </div>
  );
}
