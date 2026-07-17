// Wieviele Spots höchstens auf die Startseite dürfen. Mehr als eine Handvoll ist keine
// Auswahl mehr, sondern eine Liste — und genau davon will SalzGuide ja weg.
//
// Eigene Datei, weil die Zahl an ZWEI Stellen gilt: in der Server-Action (die kappt, was
// der Client schickt) und in der Admin-Oberfläche (die den Haken sperrt, bevor es soweit
// ist). In admin-actions.ts kann sie nicht liegen — aus einer "use server"-Datei darf man
// ausschliesslich async Funktionen exportieren, eine Konstante bricht dort den Build.
export const MAX_HOME_FEATURED = 6;
