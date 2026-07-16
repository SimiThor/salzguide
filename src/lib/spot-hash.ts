// Deterministischer Inhalts-Hash der QUELL-Texte (Deutsch). Wird mit jeder Übersetzung als
// `source_hash` gespeichert. Ändert sich Deutsch, weicht der Hash ab -> Übersetzungen sind
// „veraltet". Läuft identisch auf Client (Formular) UND Server (Speichern/Status).
export type SpotTextFields = {
  title: string;
  shortDesc: string;
  general: string;
  insiderTip: string;
  sectionA: string;
  sectionB: string;
  locationText: string;
};

export type TranslationState = "none" | "partial" | "stale" | "complete";

export function hashTexts(parts: (string | null | undefined)[]): string {
  const s = parts.map((x) => (x ?? "").trim()).join(" ");
  // djb2 (schnell, deterministisch, reicht für Änderungs-Erkennung)
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function hashSpotTexts(t: SpotTextFields): string {
  return hashTexts([
    t.title,
    t.shortDesc,
    t.general,
    t.insiderTip,
    t.sectionA,
    t.sectionB,
    t.locationText,
  ]);
}

// Übersetzungs-Status aus Übersetzungs-ZEILEN (Spots): die DE-Zeile trägt den aktuellen
// source_hash (Versionsmarke); eine Sprache ist AKTUELL, wenn ihr source_hash gleich ist.
// none: keine · partial: nicht alle · stale: alle da, aber ≥1 veraltet · complete: alle & aktuell.
export function translationStatus(
  rows: { lang: string; title?: string | null; source_hash?: string | null }[],
  targetLocales: readonly string[],
): { present: number; total: number; stale: boolean; state: TranslationState } {
  const deHash = rows.find((r) => r.lang === "de")?.source_hash ?? null;
  let present = 0;
  let stale = false;
  for (const l of targetLocales) {
    const r = rows.find((x) => x.lang === l);
    if (r && (r.title ?? "").trim()) {
      present++;
      if (deHash && r.source_hash && r.source_hash !== deHash) stale = true;
    }
  }
  const total = targetLocales.length;
  const state: TranslationState =
    present === 0 ? "none" : present < total ? "partial" : stale ? "stale" : "complete";
  return { present, total, stale, state };
}

// Darf dieser Inhalt VERÖFFENTLICHT werden? Strenger als der Badge-Status: verlangt
// ZUSÄTZLICH eine gültige source_hash-Marke (= via „In alle Sprachen übersetzen" erzeugt UND
// aktuell zum deutschen Text). So kann nichts Halb-/Veraltet-Übersetztes live gehen (Anti-Chaos).
// Fehlt die Marke (z.B. nur von Hand getippt), gilt es NICHT als veröffentlichbar.
export function translationsPublishable(
  translations: Record<string, { title?: string }> | null | undefined,
  sourceHash: string | null | undefined,
  deHash: string,
  targetLocales: readonly string[],
): boolean {
  const tr = translations ?? {};
  const allPresent = targetLocales.every((l) => (tr[l]?.title ?? "").trim() !== "");
  return allPresent && !!sourceHash && sourceHash === deHash;
}

// Status für JSONB-Übersetzungen (Events): eine EINZIGE source_hash-Marke am Objekt.
// Veraltet = source_hash weicht vom aktuellen DE-Hash ab.
export function jsonbTranslationStatus(
  translations: Record<string, { title?: string }> | null | undefined,
  sourceHash: string | null | undefined,
  deHash: string,
  targetLocales: readonly string[],
): { present: number; total: number; stale: boolean; state: TranslationState } {
  const tr = translations ?? {};
  let present = 0;
  for (const l of targetLocales) if ((tr[l]?.title ?? "").trim()) present++;
  const total = targetLocales.length;
  const stale = present > 0 && !!sourceHash && sourceHash !== deHash;
  const state: TranslationState =
    present === 0 ? "none" : present < total ? "partial" : stale ? "stale" : "complete";
  return { present, total, stale, state };
}
