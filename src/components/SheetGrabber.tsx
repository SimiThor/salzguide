"use client";

import type { DragControls } from "framer-motion";
import { useSheetHandle } from "./useSheetHandle";

// Der Balken oben am Sheet – einmal für alle drei Sheets, damit er überall gleich
// aussieht UND gleich reagiert. Vorher stand dieselbe Zeile dreimal im Code und war
// dreimal leicht anders verdrahtet (einmal ohne sg-native-tap, einmal ohne Tippen).
//
// Die Polsterung kommt von außen: Sie bestimmt die Höhe des Streifens, und die steckt
// beim Explore-Sheet in --sg-sheet-peek (globals.css rechnet sie dort mit 26px ein).
// Wer sie ändert, muss dort nachziehen – deshalb steht sie an der Aufrufstelle.

// Ein Kopfbereich, der ziehen soll, braucht beides: touch-none, damit der Browser die
// senkrechte Geste nicht selbst als Scrollen nimmt, und select-none, damit beim Ziehen
// kein Text markiert wird. Als Konstante, damit kein Aufrufer die Hälfte vergisst.
export const SHEET_HANDLE_CLASS = "sg-native-tap touch-none select-none";

export default function SheetGrabber({
  dragControls,
  onTap,
  className = "",
}: {
  dragControls: DragControls;
  // Tippen (statt ziehen) auf den Balken. Nur hier, NICHT im Kopf daneben: Ein Tipp auf
  // einen Titel, der das Sheet aufspringen lässt, wäre eine Überraschung – am Balken ist
  // es die erwartete Abkürzung.
  onTap?: () => void;
  className?: string;
}) {
  const handle = useSheetHandle(dragControls, onTap);
  return (
    <div
      {...handle}
      className={`${SHEET_HANDLE_CLASS} flex shrink-0 cursor-grab items-center justify-center active:cursor-grabbing ${className}`}
    >
      <span className="h-1.5 w-10 rounded-full bg-black/15" aria-hidden />
    </div>
  );
}
