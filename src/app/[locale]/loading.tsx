import { CardSkeleton, PageHeadSkeleton } from "@/components/skeletons";

// Auffang-Ladeschirm für ALLE Unterseiten (Loading-Grenze auf [locale]-Ebene).
//
// Warum es ihn braucht: Die loading.tsx einer Zielseite kommt per Link-Prefetch in den
// Router-Cache. Klickt man, BEVOR der Prefetch fertig ist (langsames Netz, schneller
// Finger), kennt der Router sie noch nicht — Next schaltet die URL trotzdem sofort um
// und rendert den Seiten-Slot LEER. Der Footer aus AppChrome war dann der einzige
// Fluss-Inhalt und stand für die Dauer der Server-Antwort allein ganz oben, als wäre er
// die Seite (am Handy nachgemessen: bis zu 1,5 s). Diese Datei gehört zum [locale]-
// Layout-Segment, das beim Klick schon geladen ist — sie ist deshalb IMMER sofort da
// und fängt jede Navigation ab, deren eigenes Skelett (noch) fehlt.
//
// min-h-viewport: Das Gerüst füllt mindestens den Bildschirm und drückt damit die
// Fußzeile unter die Falte. Die bleibt beim Laden bewusst sichtbar im Fluss (warum kein
// Verstecken mehr: globals.css, „Hier stand bis 08/2026 …"): Das erste Bild zeigt nur
// Gerüst, aber wer runterscrollt, findet die Fußzeile sofort — nicht erst, wenn die
// Daten da sind.
//
// Form: Seitenkopf (h1 + Untertitel) über Sektions-Karten — das gemeinsame Grundgerüst
// fast aller Inhaltsseiten, in deren üblicher Breite (640px; Events, Gespeichert, KI,
// Über uns). Hier kann jede Art von Seite ankommen, deshalb bleibt es bei dieser
// neutralen Grundform; Seiten mit eigener loading.tsx (Events, Touren, Gespeichert,
// Profil, Pro, Spot, Vollbild-Karten) zeigen ihr genaueres Gerüst, sobald der
// Prefetch es geliefert hat.
export default function Loading() {
  return (
    <div className="min-h-viewport pt-[var(--sg-page-top)] md:pt-6" aria-busy>
      <div className="mx-auto w-full max-w-[640px] px-4">
        <PageHeadSkeleton />
        <div className="mt-6 space-y-6">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={4} />
          <CardSkeleton lines={2} />
        </div>
      </div>
    </div>
  );
}
