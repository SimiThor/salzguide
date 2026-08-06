import { CardSkeleton, QuickFactsSkeleton } from "@/components/skeletons";
import { HERO_BOX } from "./[slug]/hero-box";

// Lade-Gerüst der Spot-Seite: Die Route ist dynamisch (Betrachter-Prüfung), zwischen
// Klick und Server-Antwort stand vorher eine leere Fläche. Der Hero-Block hat exakt
// die Masse des echten Heros (geteilte HERO_BOX), damit beim Eintreffen der Seite
// nichts springt. Darunter GENAU der Aufbau der echten Seite (spot/[slug]/page.tsx):
// die Quick-Facts-Pille überlappt den Hero (-mt-9, z-10), dann Sektions-Karten im
// echten Rhythmus (space-y-10 md:space-y-12) — der Wechsel zum Inhalt ist so ein
// Auffüllen der Formen, kein Umbau.
// min-h-viewport wie beim Auffang-Gerüst ([locale]/loading.tsx): füllt mindestens den
// Bildschirm, damit die Fußzeile unter der Falte bleibt, solange geladen wird.
//
// BEWUSST hier in spot/ und NICHT in spot/[slug]/: Die Loading-Grenze gehört so zum
// /spot-Segment, das beim Sprung Spot -> Spot („Ähnliche Spots") schon geladen ist.
// Läge sie im [slug]-Segment, käme sie erst mit dem Prefetch des ZIELS — wer schneller
// klickt (oder langsames Netz hat), bekam statt des Skeletts einen leeren Slot, in dem
// die Fußzeile allein ganz oben stand (am Handy nachgemessen, ~0,6 s pro Sprung).
export default function Loading() {
  return (
    <div className="min-h-viewport pb-16" aria-busy>
      <div className={`sg-skeleton ${HERO_BOX}`} />
      <div className="mx-auto w-full max-w-[760px]">
        <div className="relative z-10 -mt-9 space-y-10 px-4 md:space-y-12">
          <QuickFactsSkeleton />
          <CardSkeleton lines={3} />
          <CardSkeleton lines={4} />
        </div>
      </div>
    </div>
  );
}
