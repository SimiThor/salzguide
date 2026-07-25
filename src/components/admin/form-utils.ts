import type { KeyboardEvent } from "react";

// Enter in einem EINZEILIGEN Feld darf nicht das ganze Formular abschicken.
//
// Die Admin-Formulare (Spot, Event, Tour, Gebiet, Punkt) sind lang und speichern beim
// Submit sofort inklusive Weg-Navigation zur Liste. Der Browser-Standard („implicit
// submission": Enter in einem Input löst den Submit-Button aus) heißt hier: Titel
// tippen, aus Gewohnheit Enter drücken, und ein halb leerer Entwurf ist gespeichert
// und das Formular zu. Speichern soll eine bewusste Handlung am Button sein.
//
// Textareas (Enter = Zeilenumbruch) und Buttons (Enter = Klick) bleiben unberührt.
// Felder mit eigenem Enter-Handler (z. B. die Ortssuche) rufen selbst preventDefault
// und funktionieren weiter – dieser Handler greift erst beim Hochblubbern.
export function blockEnterSubmit(ev: KeyboardEvent<HTMLFormElement>) {
  if (ev.key !== "Enter") return;
  const target = ev.target as HTMLElement | null;
  if (target?.tagName === "INPUT") ev.preventDefault();
}
