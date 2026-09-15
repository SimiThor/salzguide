// ═══════════════════════════════════════════════════════════════════════════════════════
//  Lautheit angleichen: jede Stimme gleich laut, wie bei Apple (Sound Check, Podcasts).
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// WARUM: Am 15.09.2026 kam Simons geklonte Stimme mit -34 LUFS aus ElevenLabs, Toni mit
// -16 LUFS. Fast 19 LU Unterschied, also gefühlt ein Viertel der Lautstärke. Der Gast dreht
// bei Simon auf und bekommt beim naechsten Stopp von Toni den Schrecken. Eine Regelung im
// Player waere die falsche Stelle: `HTMLMediaElement.volume` ignoriert iOS, und Web Audio
// vertraegt sich schlecht mit Hintergrund-Wiedergabe und Sperrbildschirm. Also wird die
// DATEI selbst auf ein Mass gebracht, einmal, beim Erzeugen. Danach braucht kein Player
// etwas zu wissen.
//
// DAS MASS: -16 LUFS integriert (ITU-R BS.1770-4 / EBU R128, dieselbe Messung wie Apple
// Podcasts, Apple Music Sound Check und ffmpeg `ebur128`), Spitzen unter -1 dB. Der
// Bestand vom 08/2026 liegt bei -16,2 bis -16,4 LUFS, Toni neu bei -15,6: Der Standard war
// also schon da, nur nicht festgeschrieben. Innerhalb von +-1 LU (Apples Toleranz) bleibt
// eine Datei BYTEGLEICH: kein zweites verlustbehaftetes Kodieren fuer nichts.
//
// WIE: MP3 dekodieren (mpg123, WASM), K-gewichtet messen mit Gating, Verstaerkung auf das
// Ziel, ein Spitzenbegrenzer mit Vorausschau damit nichts uebersteuert, zurueck nach MP3
// (LAME, 96 kbit/s CBR mono wie ElevenLabs, damit lib/tts-rules.ts die Dauer weiter aus der
// Dateigroesse rechnen kann). Alles reines JavaScript/WASM, laeuft in der Vercel-Funktion.
//
// Die Messung ist gegen ffmpeg geprueft: `npm run loudness:check` misst dieselben Dateien
// mit beiden und verlangt Gleichstand auf 0,3 LU.

import { MPEGDecoder } from "mpg123-decoder";
import { Mp3Encoder } from "@breezystack/lamejs";

/** Zielwert und Toleranz, siehe Kopf. Eine Quelle, auch fuer das Bestands-Skript. */
export const LOUDNESS_TARGET_LUFS = -16;
export const LOUDNESS_TOLERANCE_LU = 1;
/** Spitzen-Deckel als Abtastwert. -1,5 dBFS laesst Luft, damit der wahre Spitzenwert unter -1 dBTP bleibt. */
export const PEAK_CEILING_DBFS = -1.5;
const MP3_KBPS = 96;
/** Unter dieser Lautheit ist es Stille (absolutes Gate der Norm): nichts zu normalisieren. */
const SILENCE_LUFS = -70;

// ── K-Bewertung (BS.1770-4), Koeffizienten je Abtastrate wie in libebur128 ─────────────
type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // Stufe 1: Kuppel-Filter (Kopf-Akustik), +4 dB oberhalb von ~1,7 kHz.
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  // Stufe 2: RLB-Hochpass bei 38 Hz.
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const hp: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  return [shelf, hp];
}

function applyBiquad(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    y[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return y;
}

/**
 * Integrierte Lautheit in LUFS nach BS.1770-4 (mono oder als Summe der Kanaele), mit
 * absolutem (-70 LUFS) und relativem (-10 LU) Gate ueber 400-ms-Bloecke, 75 % Ueberlappung.
 * -Infinity, wenn kein Block ueber dem absoluten Gate liegt (Stille).
 */
export function integratedLoudness(channels: Float32Array[], sampleRate: number): number {
  const [shelf, hp] = kWeighting(sampleRate);
  const block = Math.round(0.4 * sampleRate);
  const hop = Math.round(0.1 * sampleRate);
  const n = channels[0]?.length ?? 0;
  if (n < block) return -Infinity;
  // Mittlere Leistung je Block, ueber alle Kanaele summiert (Gewicht 1 fuer L/R/C/Mono).
  const blocks = Math.floor((n - block) / hop) + 1;
  const power = new Float64Array(blocks);
  for (const ch of channels) {
    const k = applyBiquad(applyBiquad(ch, shelf), hp);
    // Praefixsumme der Quadrate: jeder Block in O(1).
    const prefix = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + k[i] * k[i];
    for (let b = 0; b < blocks; b++) {
      const s = b * hop;
      power[b] += (prefix[s + block] - prefix[s]) / block;
    }
  }
  const lk = (p: number) => -0.691 + 10 * Math.log10(p);
  // Absolutes Gate.
  let sum = 0, cnt = 0;
  for (let b = 0; b < blocks; b++) if (lk(power[b]) > SILENCE_LUFS) { sum += power[b]; cnt++; }
  if (!cnt) return -Infinity;
  // Relatives Gate: 10 LU unter dem Mittel der uebrig gebliebenen Bloecke.
  const rel = lk(sum / cnt) - 10;
  sum = 0; cnt = 0;
  for (let b = 0; b < blocks; b++) if (lk(power[b]) > rel && lk(power[b]) > SILENCE_LUFS) { sum += power[b]; cnt++; }
  return cnt ? lk(sum / cnt) : -Infinity;
}

/** Groesster Abtastwert in dBFS. */
export function samplePeakDb(x: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

// ── Verstaerken + Spitzenbegrenzer ────────────────────────────────────────────────────────
/**
 * Verstaerkung mit Vorausschau-Begrenzer: Kein Abtastwert ueberschreitet `ceiling`, und die
 * Verstaerkung faellt VOR einer Spitze weich ab (3 ms Vorausschau, 80 ms Erholung), statt
 * hart zu kappen. Gleitendes Minimum ueber die Vorausschau mit einer monotonen Schlange,
 * also O(n) auch bei 100 Sekunden Audio.
 */
export function gainWithLimiter(x: Float32Array, gain: number, ceiling: number, sampleRate: number): Float32Array {
  const n = x.length;
  const look = Math.max(1, Math.round(0.003 * sampleRate));
  const release = Math.exp(-1 / (0.08 * sampleRate));
  const need = new Float32Array(n); // noetige Daempfung je Abtastwert (<= 1)
  for (let i = 0; i < n; i++) {
    const a = Math.abs(x[i] * gain);
    need[i] = a > ceiling ? ceiling / a : 1;
  }
  // Gleitendes Minimum von need ueber [i, i+look].
  const out = new Float32Array(n);
  const dq = new Int32Array(n);
  let head = 0, tail = 0;
  let g = 1;
  for (let i = 0; i < n; i++) {
    const add = i + look;
    if (add < n) {
      while (tail > head && need[dq[tail - 1]] >= need[add]) tail--;
      dq[tail++] = add;
    }
    while (tail > head && dq[head] < i) head++;
    // need[i] selbst gehoert ins Fenster (add kann vorher schon drin sein).
    const target = Math.min(need[i], tail > head ? need[dq[head]] : 1);
    g = target < g ? target : g + (target - g) * (1 - release);
    out[i] = x[i] * gain * g;
  }
  return out;
}

// ── MP3 rein, MP3 raus ────────────────────────────────────────────────────────────────────
export type Decoded = { samples: Float32Array; sampleRate: number };

export async function decodeMp3(bytes: Uint8Array): Promise<Decoded> {
  const decoder = new MPEGDecoder();
  await decoder.ready;
  try {
    const { channelData, sampleRate } = decoder.decode(bytes);
    // Der Decoder wirft bei Muell nicht, er liefert leere Kanaele. Das ist keine Dekodierung:
    // Ein Hand-Upload, der hier landet, ist keine MP3 (lib/tts-files.ts meldet bad_audio).
    if (!channelData.length || !channelData[0].length || !sampleRate) throw new Error("MP3 ohne Samples");
    if (channelData.length === 1) return { samples: channelData[0], sampleRate };
    // Stereo (kommt von ElevenLabs nicht, aber ein manueller Upload koennte es sein): mitteln.
    const n = channelData[0].length;
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (const ch of channelData) s += ch[i];
      mono[i] = s / channelData.length;
    }
    return { samples: mono, sampleRate };
  } finally {
    decoder.free();
  }
}

export function encodeMp3Mono(samples: Float32Array, sampleRate: number): Uint8Array {
  const enc = new Mp3Encoder(1, sampleRate, MP3_KBPS);
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
  }
  const parts: Uint8Array[] = [];
  const CHUNK = 1152 * 64;
  for (let i = 0; i < pcm.length; i += CHUNK) {
    const buf = enc.encodeBuffer(pcm.subarray(i, i + CHUNK));
    if (buf.length) parts.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
  }
  const tail = enc.flush();
  if (tail.length) parts.push(new Uint8Array(tail.buffer, tail.byteOffset, tail.length));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export type NormalizeResult = {
  bytes: Uint8Array;
  /** Gemessen vor dem Eingriff. -Infinity = Stille. */
  inputLufs: number;
  /** Erwartete Lautheit danach (Ziel), oder inputLufs, wenn nichts geaendert wurde. */
  outputLufs: number;
  gainDb: number;
  changed: boolean;
  /** Laenge in Sekunden aus den dekodierten Samples, unabhaengig von der Bitrate der Quelle. */
  seconds: number;
};

/**
 * Sprach-MP3 auf das Ziel bringen. Innerhalb der Toleranz kommen die Bytes UNVERAENDERT
 * zurueck (kein zweites Kodieren). Stille bleibt Stille.
 */
export async function normalizeSpeechMp3(
  bytes: Uint8Array,
  target = LOUDNESS_TARGET_LUFS,
  tolerance = LOUDNESS_TOLERANCE_LU,
): Promise<NormalizeResult> {
  const { samples, sampleRate } = await decodeMp3(bytes);
  const seconds = samples.length / sampleRate;
  const inputLufs = integratedLoudness([samples], sampleRate);
  if (!Number.isFinite(inputLufs) || Math.abs(inputLufs - target) <= tolerance)
    return { bytes, inputLufs, outputLufs: inputLufs, gainDb: 0, changed: false, seconds };
  const ceiling = Math.pow(10, PEAK_CEILING_DBFS / 20);
  // Der Begrenzer nimmt bei grosser Verstaerkung etwas Lautheit zurueck (Simon: +18 dB,
  // Ergebnis -17 statt -16). Deshalb bis zu drei Durchgaenge: messen, nachlegen, begrenzen.
  // Der Begrenzer ist O(n), das kostet bei 100 Sekunden Audio Millisekunden.
  const shape = (gainDb: number) => gainWithLimiter(samples, Math.pow(10, gainDb / 20), ceiling, sampleRate);
  let gainDb = target - inputLufs;
  let shaped = shape(gainDb);
  for (let pass = 0; pass < 2; pass++) {
    const got = integratedLoudness([shaped], sampleRate);
    if (!Number.isFinite(got) || Math.abs(got - target) <= 0.3) break;
    gainDb += target - got;
    shaped = shape(gainDb);
  }
  // Gemessen wird die FERTIGE Datei, nicht das Signal davor: Das Kodieren mit 96 kbit/s
  // nimmt noch einmal rund 0,4 LU weg. Liegt sie daneben, einmal nachlegen und neu kodieren
  // (eine Sekunde bei 90 Sekunden Audio). outputLufs ist damit ein ehrlicher Messwert.
  let out = encodeMp3Mono(shaped, sampleRate);
  let outputLufs = integratedLoudness([(await decodeMp3(out)).samples], sampleRate);
  if (Number.isFinite(outputLufs) && Math.abs(outputLufs - target) > 0.3) {
    gainDb += target - outputLufs;
    out = encodeMp3Mono(shape(gainDb), sampleRate);
    outputLufs = integratedLoudness([(await decodeMp3(out)).samples], sampleRate);
  }
  return { bytes: out, inputLufs, outputLufs, gainDb, changed: true, seconds };
}
