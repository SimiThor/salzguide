import { hashTexts } from "./spot-hash";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Die Regeln der Stimmen. Reine Funktionen, keine Server-Imports.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Hier steht, was PointForm, TourForm, die Server-Actions und `npm run voice:check` gemeinsam
// wissen müssen: Wann ist eine Datei aktuell, welche Stimmen braucht ein Punkt, wann darf
// eine Runde live gehen, welche Stimme bekommt eine KI-Runde. Client-sicher, damit das
// Formular dieselbe Regel anzeigt, die der Server beim Speichern anwendet, und das
// Prüf-Skript die echte Regel importiert statt eines Nachbaus.
//
// Das Modell dahinter (Migration 0068): Text je Punkt und Sprache, Dateien je Punkt, Sprache
// UND Stimme, und die Runde trägt genau eine Stimme.

export type VoiceKind = "synthetic" | "cloned" | "human";
export const VOICE_KINDS: readonly VoiceKind[] = ["synthetic", "cloned", "human"];

export type VoiceRow = {
  id: string;
  key: string;
  name: string;
  kind: VoiceKind;
  elevenVoiceId: string | null;
  personName: string | null;
  isDefault: boolean;
  sortOrder: number;
};

/** Was der Player über die Stimme einer Runde wissen darf: Name und Art, nie die ID. */
export type VoiceInfo = { name: string; kind: VoiceKind; personName: string | null };

export const ELEVEN_VOICE_ID_RE = /^[A-Za-z0-9]{10,40}$/;

export type AudioKind = "voll" | "kostprobe";

/**
 * Der Hash, den eine Datei trägt: NUR der Text.
 *
 * Nicht die Stimme (die ist der Schlüssel voice_id) und nicht Modell oder Settings (die
 * stehen informativ in tts_profile). Sonst würde ein geändertes Sprechtempo in der ENV 228
 * Dateien für veraltet erklären und zu einer 228-Dateien-Rechnung einladen. Derselbe
 * Em-Dash-Strip wie beim Speichern, sonst gälte jeder gespeicherte Text als geändert.
 */
export function ttsTextHash(text: string): string {
  return hashTexts([text]);
}

/**
 * Welche ElevenLabs-ID eine Stimme spricht. KEIN hart kodierter Fallback mehr: Eine still
 * falsche Stimme ist genau der Fehler, gegen den das Feature gebaut ist. Die ENV gilt nur
 * noch als Brücke für den Standard, bis seine ID im Admin steht.
 */
export function elevenIdOf(
  v: Pick<VoiceRow, "elevenVoiceId" | "isDefault" | "kind">,
  env: { ELEVENLABS_VOICE_ID?: string },
): string | null {
  if (v.kind === "human") return null;
  const own = v.elevenVoiceId?.trim();
  if (own) return own;
  const bridge = v.isDefault ? env.ELEVENLABS_VOICE_ID?.trim() : "";
  return bridge || null;
}

/** Der Standard, mit Netz für das Fenster zwischen „alten Standard löschen" und „neuen setzen". */
export function pickDefaultVoice(voices: VoiceRow[]): VoiceRow | null {
  return (
    voices.find((v) => v.isDefault) ??
    voices.find((v) => v.key === "toni") ??
    [...voices].sort((a, b) => a.sortOrder - b.sortOrder)[0] ??
    null
  );
}

// ── Zustand einer Datei ────────────────────────────────────────────────────────────────
export type FileState = "ok" | "missing" | "text_changed" | "object_missing" | "unhashed";

export function fileState(
  f: { url: string | null; hash: string | null; objectExists: boolean },
  wantHash: string,
): FileState {
  if (!f.url) return "missing";
  if (!f.objectExists) return "object_missing";
  // Altbestand und manuelle Uploads tragen keinen Hash. Sie gelten als aktuell: Wer sie
  // neu vertonen will, sagt das ausdrücklich (force), nie der Sammel-Knopf.
  if (f.hash === null) return "unhashed";
  return f.hash === wantHash ? "ok" : "text_changed";
}

/** Aktuell heißt: kein Aufruf nötig. */
export function fileCurrent(s: FileState): boolean {
  return s === "ok" || s === "unhashed";
}

/** Was „Prüfen" an der Runde zurückgibt: je fehlender oder veralteter Datei ein Eintrag. */
export type PlanReason = Exclude<FileState, "ok" | "unhashed">;
export type PlanItem = { pointId: string; lang: string; kind: AudioKind; chars: number; reason: PlanReason };
export type VoicePlan = {
  items: PlanItem[];
  /** Zahl der Dateien, die es für diese Stimme geben sollte (Texte vorhanden). */
  wanted: number;
  chars: number;
};

/** Wo eine Stimme in Gebrauch ist (Löschen nur, wenn beides 0). */
export type VoiceUsage = { tours: number; files: number };

// ── Welche Stimmen ein Punkt braucht ───────────────────────────────────────────────────
/**
 * Die Stimmen der VERÖFFENTLICHTEN Runden, in denen ein Punkt steckt. Entwürfe zählen erst
 * beim Veröffentlichen der Runde: Sonst blockierte eine Giro-Vorbereitung mit Antons
 * Stimme jede Tippfehler-Korrektur an einem Punkt, der bei Route 66 längst live ist.
 */
export function requiredVoiceIds(publishedTourVoiceIds: (string | null | undefined)[]): string[] {
  return [...new Set(publishedTourVoiceIds.filter((v): v is string => Boolean(v)))];
}

export type VoiceFileRef = { url: string | null; hash: string | null };

/**
 * Darf ein Punkt live gehen? Für jede Pflicht-Stimme braucht jede Sprache eine Volldatei;
 * steckt er in keiner veröffentlichten Runde, reicht EINE Stimme komplett (keine
 * Toni-Kosten für einen Punkt, der für Antons Runde vorbereitet wird).
 */
export function pointVoicesPublishable(input: {
  required: string[];
  langs: readonly string[];
  /** voiceId -> lang -> Datei */
  files: Record<string, Record<string, VoiceFileRef>>;
}): boolean {
  const complete = (voiceId: string) =>
    input.langs.every((l) => Boolean(input.files[voiceId]?.[l]?.url));
  if (input.required.length) return input.required.every(complete);
  return Object.keys(input.files).some(complete);
}

// ── Darf eine Runde live gehen? ────────────────────────────────────────────────────────
export type TourGateStop = {
  pointId: string;
  /** lang -> Sprechtext (leer/fehlend = keine Sprache) */
  textByLang: Record<string, string>;
  /** lang -> Datei der RUNDEN-Stimme */
  files: Record<string, VoiceFileRef>;
};
export type TourGateMiss = { pointId: string; lang: string; reason: "missing" | "text_changed" };

const FALLBACK_LANG = "de";

/**
 * Das Gate sichert die EINE Stimme, nicht die Übersetzungs-Vollständigkeit:
 *
 *   - Jede Station braucht die DEUTSCHE Volldatei der Runden-Stimme. Deutsch ist die
 *     Sprache, auf die der Player zurückfällt; ohne sie wäre die Station stumm.
 *   - Keine vorhandene Datei darf einen älteren Text sprechen (text_changed).
 *   - Fehlt eine andere Sprache, blockiert das NICHT: Der Player spielt dann wie bisher
 *     die deutsche Datei (voiced(locale) ?? voiced(de)), also weiterhin dieselbe Stimme.
 *     „Prüfen" an der Runde zeigt diese Lücken trotzdem, mit Zeichen und Kosten.
 *
 * Kostproben blockieren nie (fehlt eine, zeigt der Player das Schloss). Die Existenz im
 * Bucket prüft „Prüfen", nicht das Gate: Das Gate ist eine reine Datenbank-Frage.
 */
export function tourVoiceGate(stops: TourGateStop[], langs: readonly string[]): TourGateMiss[] {
  const out: TourGateMiss[] = [];
  for (const s of stops) {
    for (const lang of langs) {
      const f = s.files[lang];
      const text = (s.textByLang[lang] ?? "").trim();
      if (!f?.url) {
        if (lang === FALLBACK_LANG) out.push({ pointId: s.pointId, lang, reason: "missing" });
        continue;
      }
      if (f.hash !== null && text && f.hash !== ttsTextHash(text))
        out.push({ pointId: s.pointId, lang, reason: "text_changed" });
    }
  }
  return out;
}

// ── KI- und gespeicherte Runden ────────────────────────────────────────────────────────
/**
 * Die eine Stimme einer Runde, die nicht kuratiert ist: die mit der größten Abdeckung über
 * die Punkte, bei Gleichstand der Standard, danach die kleinste ID (deterministisch).
 * null, wenn kein Punkt eine Datei hat.
 */
export function pickRoundVoice(
  points: { voiceIds: string[] }[],
  defaultId: string | null,
): string | null {
  const count = new Map<string, number>();
  for (const p of points) for (const v of new Set(p.voiceIds)) count.set(v, (count.get(v) ?? 0) + 1);
  if (!count.size) return null;
  const best = Math.max(...count.values());
  const tied = [...count.entries()].filter(([, n]) => n === best).map(([v]) => v);
  if (defaultId && tied.includes(defaultId)) return defaultId;
  return tied.sort()[0];
}

// ── Offenlegung ────────────────────────────────────────────────────────────────────────
export type DisclosureKey = "aiVoice" | "aiVoiceClone" | "humanVoice";

/** Welcher Satz unter dem Play-Knopf steht (docs/39 §2). */
export function disclosureOf(
  v: VoiceInfo | null | undefined,
): { key: DisclosureKey; name: string | null } {
  if (!v || v.kind === "synthetic") return { key: "aiVoice", name: null };
  const name = v.personName ?? v.name;
  return { key: v.kind === "cloned" ? "aiVoiceClone" : "humanVoice", name };
}

/** Stimme -> Zahl der Sprachen mit Volldatei, aus eingebetteten Datei-Zeilen (Listen im Admin). */
export function countVoicedLangs(
  rows: { lang: string; voice_id: string; audio_url: string | null }[] | null | undefined,
): Record<string, number> {
  const langs = new Map<string, Set<string>>();
  for (const r of rows ?? []) {
    if (!r.audio_url) continue;
    if (!langs.has(r.voice_id)) langs.set(r.voice_id, new Set());
    langs.get(r.voice_id)!.add(r.lang);
  }
  return Object.fromEntries([...langs].map(([v, s]) => [v, s.size]));
}

/** Dauer aus der Dateigröße: mp3_44100_96 ist konstante Bitrate, 96 kbit/s. */
export function durationFromBytes(bytes: number): number {
  return Math.max(1, Math.round((bytes * 8) / 96000));
}
