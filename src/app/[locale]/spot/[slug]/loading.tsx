import CardSkeleton from "@/components/CardSkeleton";

// Lade-Gerüst der Spot-Seite: Die Route ist dynamisch (Betrachter-Prüfung), zwischen
// Klick und Server-Antwort stand vorher eine leere Fläche. Der Hero-Block hat exakt
// die Masse des echten Heros (HERO_BOX in page.tsx), damit beim Eintreffen der Seite
// nichts springt; darunter zwei Karten-Skelette im Rhythmus der echten Sektionen.
export default function Loading() {
  return (
    <div className="pb-16" aria-busy>
      <div className="sg-skeleton h-[42svh] max-h-[460px] min-h-[300px] w-full" />
      <div className="mx-auto mt-6 w-full max-w-[760px] space-y-6 px-4">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={4} />
      </div>
    </div>
  );
}
