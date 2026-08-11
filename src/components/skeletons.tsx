// DIE eine Quelle für alle Lade-Gerüste (loading.tsx der Seiten + Suspense-Fallbacks).
// Jeder Baustein spiegelt die Hülle einer ECHTEN Komponente: gleiche Radien, Schatten,
// Polster und Maße wie dort, nur mit Schimmer-Flächen (.sg-skeleton) statt Inhalt.
// So sieht das Gerüst schon wie die Seite aus, die gleich kommt, und der Wechsel
// Skeleton -> Inhalt ist ein Auffüllen statt ein Umbau.
//
// Ändert sich ein echtes Layout, wird der Baustein hier mitgezogen; nie ein zweites
// Skelett daneben bauen (Ein System statt Duplikate). Alle Bausteine sind aria-hidden:
// Screenreadern sagt die jeweilige loading.tsx über aria-busy, dass geladen wird.

// Karten-Schatten wie überall in der App (Touren-Kacheln, Spot-Sektionen, CardSkeleton).
const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.28)]";

/** Weiße Sektions-Karte mit Überschrift + Textzeilen. Spiegelt die Spot-Sektionen
 *  (CARD p-5, h2 + Fließtext); auch der Suspense-Fallback der streamenden
 *  Spot-Sektionen (Öffnungszeiten, Wasser, Wetter). */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className={`space-y-3 p-5 ${CARD}`} aria-hidden>
      <div className="sg-skeleton h-4 w-28 rounded-md" />
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`sg-skeleton h-3 rounded ${i === lines - 1 ? "w-4/6" : "w-full"}`}
        />
      ))}
    </div>
  );
}

/** Seitenkopf: h1 (text-2xl) + optional Untertitel (15px, mt-1) + optional die Pille
 *  rechts (Events: der Knopf zur Datumsauswahl, 36px hoch — nicht mehr die flache
 *  Status-Pille von früher, sonst rückt die Zeile beim Laden). Spiegelt den Kopf von
 *  Events, Touren, Gespeichert und Profil. */
export function PageHeadSkeleton({
  pill = false,
  subtitle = true,
}: {
  pill?: boolean;
  subtitle?: boolean;
}) {
  return (
    <div aria-hidden>
      <div className="flex items-end justify-between gap-2">
        <div className="sg-skeleton h-7 w-40 rounded-lg" />
        {pill && <div className="sg-skeleton h-9 w-40 rounded-full" />}
      </div>
      {subtitle && <div className="sg-skeleton mt-2.5 h-4 w-3/4 max-w-[320px] rounded" />}
    </div>
  );
}

/** Filter-Pillen-Reihe (Events). overflow-hidden statt Scroll-Streifen: Das Gerüst
 *  lebt nur Sekundenbruchteile, es darf das Dokument nur nicht verbreitern. */
export function PillStripSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`flex gap-2 overflow-hidden ${className}`} aria-hidden>
      {["w-14", "w-24", "w-16", "w-20", "w-16"].map((w, i) => (
        <div key={i} className={`sg-skeleton h-8 shrink-0 rounded-full ${w}`} />
      ))}
    </div>
  );
}

/** Event-Zeile: Emoji-Kachel links, Titel + Meta-Zeile rechts (EventCard.tsx). */
export function EventRowSkeleton() {
  return (
    <div
      className="flex gap-3 rounded-[16px] bg-white p-3.5 shadow-sm ring-1 ring-black/[0.04]"
      aria-hidden
    >
      <div className="sg-skeleton h-11 w-11 shrink-0 rounded-[12px]" />
      <div className="min-w-0 flex-1 py-0.5">
        <div className="sg-skeleton h-4 w-3/4 rounded" />
        <div className="sg-skeleton mt-2 h-3 w-1/2 rounded" />
      </div>
    </div>
  );
}

/** Merklisten-Zeile: Foto links (h-16 w-20), Titel + Beschreibung rechts
 *  (SavedSpots.tsx). */
export function SpotRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-[16px] bg-white p-3 shadow-sm" aria-hidden>
      <div className="sg-skeleton h-16 w-20 shrink-0 rounded-[12px]" />
      <div className="min-w-0 flex-1">
        <div className="sg-skeleton h-4 w-2/3 rounded" />
        <div className="sg-skeleton mt-2 h-3 w-5/6 rounded" />
      </div>
    </div>
  );
}

/** Touren-Kachel: Coverbild (h-40) über Titel, Untertitel und Meta-Zeile
 *  (Karten-Raster in touren/page.tsx). */
export function TourCardSkeleton() {
  return (
    <div className={`overflow-hidden ${CARD}`} aria-hidden>
      <div className="sg-skeleton h-40 w-full" />
      <div className="p-4">
        <div className="sg-skeleton h-4 w-1/2 rounded" />
        <div className="sg-skeleton mt-2.5 h-3 w-5/6 rounded" />
        <div className="sg-skeleton mt-3 h-3 w-1/3 rounded" />
      </div>
    </div>
  );
}

/** Einstellungs-Zeile im iOS-Stil: Text links, Aktion rechts (Profil). Die 68px sind
 *  die gemessene Höhe der echten Zeilen (siehe profil/page.tsx). */
export function SettingsRowSkeleton() {
  return (
    <div
      className="flex h-[68px] items-center justify-between rounded-[18px] bg-white px-5 shadow-sm"
      aria-hidden
    >
      <div className="sg-skeleton h-4 w-32 rounded" />
      <div className="sg-skeleton h-4 w-6 rounded" />
    </div>
  );
}

/** Die schwebende Quick-Facts-Pille der Spot-Seite: vier Fakten (Icon über Label)
 *  in der runden weißen Leiste, die den Hero überlappt (QuickFacts.tsx). */
export function QuickFactsSkeleton() {
  return (
    <div
      className="flex items-stretch justify-around rounded-full bg-white px-3 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_14px_36px_-20px_rgba(0,0,0,0.3)]"
      aria-hidden
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex flex-1 flex-col items-center justify-center gap-1 px-2">
          <div className="sg-skeleton h-5 w-5 rounded-full" />
          <div className="sg-skeleton h-3.5 w-12 rounded" />
        </div>
      ))}
    </div>
  );
}
