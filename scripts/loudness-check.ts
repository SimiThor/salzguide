// Prüft die Lautheits-Angleichung. Aufruf: npm run loudness:check
//
// WARUM ES DIESE PRÜFUNG GIBT: Eine Lautheitsmessung, die um 3 LU danebenliegt, macht jede
// Datei um 3 LU zu laut oder zu leise, und zwar alle gleich, also merkt es niemand am
// Vergleich. Deshalb wird die eigene Messung (src/lib/loudness.ts, BS.1770-4) hier gegen
// ffmpeg `ebur128` gehalten, dieselbe Norm, unabhängige Umsetzung. Ohne ffmpeg auf dem
// Rechner laufen nur die Prüfungen ohne Fremdmessung.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  integratedLoudness,
  samplePeakDb,
  gainWithLimiter,
  encodeMp3Mono,
  decodeMp3,
  normalizeSpeechMp3,
  LOUDNESS_TARGET_LUFS,
  PEAK_CEILING_DBFS,
} from "@/lib/loudness";

let failed = 0;
const ok = (name: string, detail = "") => console.log(`  ok    ${name}${detail ? `  (${detail})` : ""}`);
const bad = (name: string, detail: string) => {
  console.log(`  FEHLT ${name}\n        ${detail}`);
  failed++;
};
const near = (name: string, got: number, want: number, tol: number) => {
  if (Math.abs(got - want) <= tol) ok(name, `${got.toFixed(2)} vs ${want.toFixed(2)}`);
  else bad(name, `erwartet ${want.toFixed(2)} ± ${tol}, bekommen ${got.toFixed(2)}`);
};

const SR = 44100;
/** Sinus mit Spitze `peakDb` dBFS. */
function sine(freq: number, peakDb: number, seconds: number): Float32Array {
  const n = Math.round(SR * seconds);
  const a = Math.pow(10, peakDb / 20);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = a * Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
}
/**
 * Deterministisches Rauschen (LCG), sprachaehnlich: bandbegrenzt (Tiefpass bei ~2,5 kHz,
 * dort liegt die Energie von Sprache) mit Bursts und Pausen. Weisses Rauschen taugt hier
 * nicht: MP3 nimmt ihm die Hoehen, und die Lautheit faellt um 1 LU, was bei Sprache nie
 * passiert. Der erste Entwurf dieser Pruefung ist genau daran gescheitert.
 */
function bursts(peakDb: number, seconds: number): Float32Array {
  const n = Math.round(SR * seconds);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const out = new Float32Array(n);
  const k = 1 - Math.exp((-2 * Math.PI * 2500) / SR);
  let lp = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const on = Math.floor(t * 2) % 3 !== 2; // 1 s an, 1 s an, 0,5 s Pause
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t);
    lp += k * (rnd() - lp);
    out[i] = on ? env * lp : 0;
    if (Math.abs(out[i]) > peak) peak = Math.abs(out[i]);
  }
  const a = Math.pow(10, peakDb / 20) / peak;
  for (let i = 0; i < n; i++) out[i] *= a;
  return out;
}

let ffmpeg: string | null = null;
for (const c of ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]) if (existsSync(c)) ffmpeg = c;
const ffLufs = (file: string): number => {
  // ffmpeg schreibt die Messung nach stderr.
  const r = spawnSync(ffmpeg!, ["-nostats", "-hide_banner", "-i", file, "-af", "ebur128", "-f", "null", "-"], {
    encoding: "utf8",
  });
  const m = /Summary:[\s\S]*?I:\s+(-?[\d.]+) LUFS/.exec(r.stderr ?? "");
  if (!m) throw new Error("ffmpeg ohne Summary");
  return Number(m[1]);
};
const tmp = mkdtempSync(join(tmpdir(), "sg-loudness-"));

console.log("1. Die Messung selbst (BS.1770-4)");
{
  // 997-Hz-Sinus mit Spitze -20 dBFS: Leistung -23,0 dB, -0,691 dB Norm-Offset, und die
  // K-Bewertung hebt 997 Hz um +0,69 dB an -> -23,0 LUFS. Mit ffmpeg bestaetigt (Teil 5).
  const s = sine(997, -20, 6);
  near("997-Hz-Sinus, -20 dBFS Spitze", integratedLoudness([s], SR), -23.0, 0.1);
  near("gleicher Sinus bei 48 kHz-Koeffizienten unveraendert", integratedLoudness([s], 48000), integratedLoudness([s], SR), 0.3);
  near("6 dB leiser = 6 LU leiser", integratedLoudness([sine(997, -26, 6)], SR), integratedLoudness([s], SR) - 6, 0.05);
  if (!Number.isFinite(integratedLoudness([new Float32Array(SR * 3)], SR))) ok("Stille ist -Infinity (absolutes Gate)");
  else bad("Stille ist -Infinity", "endlicher Wert");
  // Gating: Pausen duerfen den Wert nicht herunterziehen. Bursts mit Stille dazwischen
  // messen fast so laut wie dieselben Bursts ohne Pausen.
  const withPause = bursts(-12, 9);
  const dense = new Float32Array(withPause.length);
  { let j = 0; for (let i = 0; i < withPause.length; i++) if (withPause[i] !== 0) dense[j++] = withPause[i]; }
  const d = Math.abs(integratedLoudness([withPause], SR) - integratedLoudness([dense.subarray(0, Math.floor(withPause.length * 0.8))], SR));
  if (d < 1) ok("Pausen werden weggegated", `${d.toFixed(2)} LU Unterschied`);
  else bad("Pausen werden weggegated", `${d.toFixed(2)} LU Unterschied`);
}

console.log("\n2. Verstaerken mit Begrenzer");
{
  const x = bursts(-30, 4);
  const ceiling = Math.pow(10, PEAK_CEILING_DBFS / 20);
  const y = gainWithLimiter(x, Math.pow(10, 40 / 20), ceiling, SR); // +40 dB: muss begrenzen
  const peak = samplePeakDb(y);
  if (peak <= PEAK_CEILING_DBFS + 0.01) ok("kein Abtastwert ueber dem Deckel", `${peak.toFixed(2)} dBFS`);
  else bad("kein Abtastwert ueber dem Deckel", `${peak.toFixed(2)} dBFS`);
  const z = gainWithLimiter(x, 2, ceiling, SR); // +6 dB: darf nichts anfassen
  let maxDiff = 0;
  for (let i = 0; i < x.length; i++) maxDiff = Math.max(maxDiff, Math.abs(z[i] - 2 * x[i]));
  if (maxDiff < 1e-6) ok("unter dem Deckel bleibt die Verstaerkung linear");
  else bad("unter dem Deckel bleibt die Verstaerkung linear", `Abweichung ${maxDiff}`);
}

console.log("\n3. MP3 hin und zurueck");
{
  const x = bursts(-14, 5);
  const mp3 = encodeMp3Mono(x, SR);
  const back = await decodeMp3(mp3);
  // Rauschen verliert beim Kodieren rund 0,5 LU (Sprache weniger); normalizeSpeechMp3 misst
  // deshalb die fertige Datei nach. Hier zaehlt nur: kein grober Bruch durch den Codec.
  near("Lautheit uebersteht das Kodieren", integratedLoudness([back.samples], back.sampleRate), integratedLoudness([x], SR), 0.7);
  const kbps = (mp3.length * 8) / (x.length / SR) / 1000;
  near("96 kbit/s CBR (Dauer aus der Dateigroesse bleibt richtig)", kbps, 96, 3);
}

console.log("\n4. Normalisieren");
{
  const quiet = encodeMp3Mono(bursts(-34, 6), SR); // wie Simon
  const r = await normalizeSpeechMp3(quiet);
  if (r.changed) ok("leise Datei wird angefasst", `${r.inputLufs.toFixed(1)} -> ${r.outputLufs.toFixed(1)} LUFS, +${r.gainDb.toFixed(1)} dB`);
  else bad("leise Datei wird angefasst", "changed=false");
  const back = await decodeMp3(r.bytes);
  near("Ergebnis liegt am Ziel", integratedLoudness([back.samples], back.sampleRate), LOUDNESS_TARGET_LUFS, 0.5);
  const pk = samplePeakDb(back.samples);
  if (pk <= -1.0) ok("Spitze unter -1 dBFS", `${pk.toFixed(2)} dBFS`);
  else bad("Spitze unter -1 dBFS", `${pk.toFixed(2)} dBFS`);

  // Wie Toni und der Bestand: exakt auf -16,2 LUFS skaliert (nach Lautheit, nicht nach Spitze).
  const raw = bursts(-6, 6);
  const scale = Math.pow(10, (-16.2 - integratedLoudness([raw], SR)) / 20);
  const fine = encodeMp3Mono(raw.map((v) => v * scale), SR);
  const r2 = await normalizeSpeechMp3(fine);
  if (!r2.changed && r2.bytes === fine) ok("innerhalb der Toleranz bleiben die Bytes unangetastet", `${r2.inputLufs.toFixed(1)} LUFS`);
  else bad("innerhalb der Toleranz bleiben die Bytes unangetastet", `changed=${r2.changed}`);

  const silent = encodeMp3Mono(new Float32Array(SR * 3), SR);
  const r3 = await normalizeSpeechMp3(silent);
  if (!r3.changed) ok("Stille bleibt Stille");
  else bad("Stille bleibt Stille", "wurde verstaerkt");

  if (ffmpeg) {
    console.log("\n5. Gegenmessung mit ffmpeg ebur128 (" + ffmpeg + ")");
    const files: [string, Uint8Array][] = [
      ["sinus.mp3", encodeMp3Mono(sine(997, -20, 6), SR)],
      ["leise.mp3", quiet],
      ["normalisiert.mp3", r.bytes],
      ["passend.mp3", fine],
    ];
    for (const [name, bytes] of files) {
      const p = join(tmp, name);
      writeFileSync(p, bytes);
      const dec = await decodeMp3(bytes);
      near(`ffmpeg vs eigene Messung: ${name}`, integratedLoudness([dec.samples], dec.sampleRate), ffLufs(p), 0.4);
    }
    near("ffmpeg bestaetigt das Ziel der normalisierten Datei", ffLufs(join(tmp, "normalisiert.mp3")), LOUDNESS_TARGET_LUFS, 0.7);
  } else {
    console.log("\n5. ffmpeg nicht gefunden, Gegenmessung uebersprungen");
  }
}

console.log(failed ? `\n${failed} Prüfung(en) FEHLGESCHLAGEN` : "\nAlles in Ordnung.");
process.exit(failed ? 1 : 0);
