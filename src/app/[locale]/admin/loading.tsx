import { CardSkeleton, PageHeadSkeleton } from "@/components/skeletons";

// Lade-Gerüst für JEDE Admin-Seite. Liegt UNTER dem Admin-Layout, also bleiben die
// Reiter oben stehen, und nur der Inhalt darunter wechselt sofort aufs Gerüst.
//
// Warum es das braucht: Alle Admin-Seiten sind dynamisch (Wächter, Zähler, Daten). Ohne
// diese Grenze hielt Next die alte Seite stehen, bis die neue komplett vom Server kam,
// und ein Tipp auf einen Reiter, eine Kachel oder eine Zeile sah bis dahin aus wie einer,
// der nicht angekommen ist (Anton, 16.11.2026). Bewusst schlicht: Die Admin-Seiten sind
// zu verschieden für ein Gerüst je Seite, und es lebt nur Sekundenbruchteile.
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy>
      <PageHeadSkeleton subtitle={false} />
      <CardSkeleton lines={2} />
      <CardSkeleton lines={2} />
      <CardSkeleton lines={3} />
    </div>
  );
}
