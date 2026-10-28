import { LOCALE_CODES } from "@/i18n/locales";
import { fileCurrent, fileState, ttsTextHash, type FileState } from "./tts-rules";

// Regeln der gesprochenen Navigations-Ansagen (Migration 0077). BEWUSST ohne server-only und
// ohne Node-Importe: Das Admin-Panel (Client) und das Prüfskript importieren dieselbe Datei,
// und ein server-only-Import im Client legt jede Seite lahm (HTTP 500, tsc bleibt grün).
//
// Die Texte stehen in messages/<lang>.json unter NavVoice.hike.*. Sie haben eigene Schlüssel,
// getrennt von den Bildschirmtexten der App: Wer ein Banner umformuliert, soll nicht still
// einen Clip veralten lassen.

/** Alle Ansagen. Neue (z. B. bike.left.200m) kommen hier dazu und in messages/*.json. */
export const NAV_PROMPT_KEYS = [
  "hike.startReached",
  "hike.offTrail",
  "hike.backOnTrail",
  "hike.turnaround",
  "hike.wrongWay",
  "hike.arrived",
] as const;
export type NavPromptKey = (typeof NAV_PROMPT_KEYS)[number];

/** Gleiche Form wie der CHECK in der Migration. */
export const NAV_KEY_RE = /^[a-z]+(\.[a-zA-Z0-9]+){1,4}$/;

export function isNavPromptKey(k: unknown): k is NavPromptKey {
  return typeof k === "string" && (NAV_PROMPT_KEYS as readonly string[]).includes(k);
}

export function isNavLang(l: unknown): l is string {
  return typeof l === "string" && LOCALE_CODES.includes(l);
}

/** Der Text einer Ansage aus einer ROHEN Sprachdatei (ohne Deutsch-Merge), oder null. */
export function navTextOf(messages: unknown, key: string): string | null {
  let cur: unknown = (messages as Record<string, unknown> | null | undefined)?.NavVoice;
  for (const part of key.split(".")) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" && cur.trim() ? cur.trim() : null;
}

export type NavFileRow = {
  promptKey: string;
  lang: string;
  voiceId: string;
  audioPath: string;
  textHash: string;
  durationMs: number | null;
};

/** Zustand einer Zelle: der Dateizustand, oder "missing_text" (Text fehlt in der Sprachdatei). */
export type NavCellState = FileState | "missing_text";
export type NavCell = { key: NavPromptKey; lang: string; state: NavCellState; chars: number };
export type NavPlan = {
  /** Jede Ansage in jeder Sprache, für das Raster. */
  cells: NavCell[];
  /** Was noch erzeugt werden muss (fehlend, veraltet, Objekt weg), in Sprach- und Ansage-Reihenfolge. */
  items: NavCell[];
  wanted: number;
  /** Zeichen der noch zu erzeugenden Dateien (= Kosten). */
  chars: number;
  /** Zahl der Ansagen ohne Text. Nicht erzeugbar und blockiert das Aktivieren. */
  missingText: number;
};

/**
 * Was eine Stimme noch braucht. `texts[lang][key]` sind die rohen Texte (null = fehlt),
 * `files` die Zeilen DIESER Stimme, `exists` die Pfade, die im Bucket wirklich liegen.
 */
export function navPromptPlan(input: {
  langs: readonly string[];
  texts: Record<string, Record<string, string | null | undefined>>;
  files: readonly NavFileRow[];
  exists: ReadonlySet<string>;
}): NavPlan {
  const byKey = new Map(input.files.map((f) => [`${f.promptKey}|${f.lang}`, f]));
  const cells: NavCell[] = [];
  const items: NavCell[] = [];
  let chars = 0;
  let missingText = 0;
  for (const lang of input.langs) {
    for (const key of NAV_PROMPT_KEYS) {
      const text = (input.texts[lang]?.[key] ?? "").trim();
      if (!text) {
        cells.push({ key, lang, state: "missing_text", chars: 0 });
        missingText++;
        continue;
      }
      const f = byKey.get(`${key}|${lang}`);
      const state = fileState(
        { url: f?.audioPath ?? null, hash: f?.textHash ?? null, objectExists: f ? input.exists.has(f.audioPath) : false },
        ttsTextHash(text),
      );
      const cell: NavCell = { key, lang, state, chars: text.length };
      cells.push(cell);
      if (!fileCurrent(state)) {
        items.push(cell);
        chars += text.length;
      }
    }
  }
  return { cells, items, wanted: input.langs.length * NAV_PROMPT_KEYS.length, chars, missingText };
}

/** Darf die Stimme aktiviert werden? Nur wenn jede Ansage in jeder Sprache aktuell vorliegt. */
export function navVoiceGate(plan: NavPlan): boolean {
  return plan.missingText === 0 && plan.items.length === 0 && plan.cells.length === plan.wanted;
}

/**
 * Version eines Satzes von Clips: gleich bei gleichen Daten, anders bei anderer Stimme, anderem
 * Pfad oder anderer Sprache. Der Pfad gehört hinein, damit auch ein erzwungener Neu-Take die
 * Version ändert und die App neu lädt. Reihenfolge der Einträge spielt keine Rolle.
 */
export function navVoiceVersion(voiceId: string, lang: string, entries: readonly { key: string; path: string }[]): string {
  const body = [voiceId, lang, ...entries.map((e) => `${e.key}|${e.path}`).sort()].join("\n");
  // djb2 und sdbm nebeneinander: 64 Bit reichen für Änderungs-Erkennung, ohne Node-Import.
  let a = 5381;
  let b = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    a = ((a << 5) + a + c) >>> 0;
    b = (c + (b << 6) + (b << 16) - b) >>> 0;
  }
  return a.toString(36).padStart(7, "0") + b.toString(36).padStart(7, "0");
}
