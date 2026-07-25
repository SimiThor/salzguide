// App-Symbole erzeugen: Favicon, iOS-Homescreen-Symbol, Android-/PWA-Symbole.
//
//   node scripts/make-icons.mjs
//
// WARUM EIN SKRIPT UND NICHT EINFACH SECHS BILDDATEIEN
//
// Ein Symbol liegt am Ende in sechs Grössen und drei Formaten vor. Wer die von Hand
// exportiert, hat sechs Gelegenheiten, eine Grösse zu vergessen oder den Rotton eine
// Nuance danebenzulegen — und niemand sieht es, weil ein Favicon 16 Pixel gross ist.
// Hier steht die Form EINMAL (unten als Pfad), alles andere wird daraus gerechnet.
// Farbe oder Buchstabe ändern heisst: hier eine Zeile ändern, Skript laufen lassen.
//
// DER BUCHSTABE IST EIN PFAD, KEIN TEXT
//
// Das "S" ist die Kontur aus Inter ExtraBold, mit fontTools aus der Schriftdatei geholt
// und hier als Pfad eingefroren. Als <text> im SVG wäre es das nicht: Ein Favicon rendert
// der Browser ohne unsere Webfont, ein PNG-Rasterer nimmt irgendeine installierte Schrift.
// Beides ergibt ein anderes S als das im Schriftzug "SalzGuide" — oder gar keins.
//
// ExtraBold statt Bold (der Schriftzug ist Bold): Bei 16 px verliert eine dünnere Kontur
// die Rundungen, das S wird zum Klecks. Der Kontaktbogen bei 16/32/64/180 px hat das
// entschieden, nicht die Ansicht in Originalgrösse.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Design-Tokens aus CLAUDE.md. Creme auf Rot, nicht Weiss auf Rot: dasselbe Paar wie in
// der App.
const RED = "#cc2924";
const CREAM = "#faf6ec";

const CANVAS = 512; // Bezugsgrösse; alles darunter wird herunterskaliert.

// Ecken-Radius für alles, was der Browser UNGEMASKT anzeigt (Tab, Lesezeichen). 22 % ist
// Apples Kachel-Rundung; bei 16 px sind das 3,5 px und es sieht nach App aus statt nach
// Aufkleber. iOS und Android bekommen die eckige Variante, die schneiden selbst zu.
const RADIUS = 112;

// Inter ExtraBold, Glyphe "S" (Schrift-Einheiten, y zeigt nach oben).
const GLYPH =
  "M689 -23Q494 -23 355.0 36.5Q216 96 142.5 211.0Q69 326 68 492H410Q413 421 448.0 370.5Q483 320 545.0 293.5Q607 267 691 267Q767 267 822.5 287.0Q878 307 909.0 343.5Q940 380 940 428Q940 471 913.5 502.0Q887 533 831.0 556.5Q775 580 687 598L534 631Q321 675 210.0 780.5Q99 886 99 1050Q99 1189 173.0 1293.0Q247 1397 379.0 1455.0Q511 1513 684 1513Q861 1513 990.0 1454.5Q1119 1396 1190.5 1288.0Q1262 1180 1266 1030H931Q924 1120 859.0 1171.5Q794 1223 687 1223Q620 1223 568.5 1203.5Q517 1184 489.0 1149.0Q461 1114 461 1069Q461 1026 486.0 996.5Q511 967 563.5 945.0Q616 923 697 906L828 879Q948 855 1036.0 817.0Q1124 779 1182.0 726.0Q1240 673 1268.0 604.0Q1296 535 1296 448Q1296 300 1224.0 194.5Q1152 89 1016.0 33.0Q880 -23 689 -23Z";

// Kontur-Grenzen derselben Glyphe. Ober- und Unterkante liegen je 23 Einheiten über der
// Versalhöhe bzw. unter der Grundlinie — die Überschneidung, die runde Buchstaben
// brauchen, damit sie neben geraden nicht kleiner wirken. Genau deshalb wird hier der
// KASTEN zentriert und nicht die Grundlinie ausgerichtet: So sitzt das S optisch mittig.
const GLYPH_BOUNDS = { xMin: 68, yMin: -23, xMax: 1296, yMax: 1513 };

// Höhe des S auf der 512er-Fläche (59 %). Kleiner wirkt es verloren, grösser drängt es in
// die Ecken — und in Androids maskierbarem Symbol würde es angeschnitten.
const GLYPH_HEIGHT = 304;

/** Ein Symbol als SVG. `radius` = 0 für die randlose Variante. */
function icon({ radius, size }) {
  const { xMin, yMin, xMax, yMax } = GLYPH_BOUNDS;
  const scale = GLYPH_HEIGHT / (yMax - yMin);
  const width = (xMax - xMin) * scale;
  // scale(s, -s) dreht die Schrift-Achse (y nach oben) auf die SVG-Achse (y nach unten).
  const tx = (CANVAS - width) / 2 - scale * xMin;
  const ty = (CANVAS - GLYPH_HEIGHT) / 2 + scale * yMax;
  const dim = size ? ` width="${size}" height="${size}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg"${dim} viewBox="0 0 ${CANVAS} ${CANVAS}" role="img" aria-label="SalzGuide">
  <rect width="${CANVAS}" height="${CANVAS}" rx="${radius}" fill="${RED}"/>
  <path transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(6)} ${(-scale).toFixed(6)})" fill="${CREAM}" d="${GLYPH}"/>
</svg>
`;
}

/** SVG in ein PNG der gewünschten Kantenlänge rastern. */
function png(size, radius) {
  // Die Grösse steht IM SVG, statt ein 512er-PNG hinterher zu verkleinern: So rastert
  // sharp direkt in der Zielauflösung und die Kanten bleiben bei 16 px sauber.
  const raster = sharp(Buffer.from(icon({ radius, size })));
  // Randlos heisst auch: ohne Alpha-Kanal. iOS und ältere Android-Launcher füllen
  // Transparenz mit Schwarz — hier ist zwar nichts durchsichtig, aber ein Symbol, das
  // gar keinen Alpha-Kanal mitbringt, kann auch keiner falsch interpretieren.
  return (radius === 0 ? raster.flatten({ background: RED }) : raster)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Mehrere PNGs in einen ICO-Container packen.
 *
 * sharp kann kein ICO schreiben, das Format ist aber trivial: 6 Byte Kopf, je 16 Byte
 * Verzeichniseintrag, dann die Bilddaten am Stück. PNG statt BMP im Inneren beherrscht
 * jeder Browser seit IE 11.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserviert
  header.writeUInt16LE(1, 2); // 1 = Symbol (2 wäre ein Mauszeiger)
  header.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  let offset = header.length + dir.length;
  images.forEach(({ size, data }, i) => {
    const at = i * 16;
    // 256 px werden als 0 notiert — mehr passt nicht in ein Byte.
    dir.writeUInt8(size >= 256 ? 0 : size, at);
    dir.writeUInt8(size >= 256 ? 0 : size, at + 1);
    dir.writeUInt8(0, at + 2); // Palettenfarben: keine
    dir.writeUInt8(0, at + 3); // reserviert
    dir.writeUInt16LE(1, at + 4); // Farbebenen
    dir.writeUInt16LE(32, at + 6); // Bit pro Pixel (RGBA)
    dir.writeUInt32LE(data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });

  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

async function write(relative, data) {
  const file = path.join(ROOT, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
  console.log(`  ${relative}  (${(data.length / 1024).toFixed(1)} kB)`);
}

console.log("Symbole werden erzeugt:");

// 1. Vektor-Favicon. Moderne Browser bevorzugen es gegenüber der .ico und zeigen es auf
//    jedem Bildschirm scharf. Ohne width/height, damit es in jede Kachel skaliert.
await write("src/app/icon.svg", icon({ radius: RADIUS }));

// 2. favicon.ico für alles Ältere und für Lesezeichen-Leisten. Drei Grössen, weil
//    Browser sich die passende aussuchen statt zu skalieren.
await write(
  "src/app/favicon.ico",
  ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(size, RADIUS) })))),
);

// 3. iOS-Homescreen. RANDLOS und ohne Transparenz: iOS legt seine eigene Maske darüber:
//    eigene Rundungen würden doppelt beschnitten, transparente Ecken würden schwarz.
await write("src/app/apple-icon.png", await png(180, 0));

// 4. Android/PWA. "any" = so wie es ist (deshalb gerundet), "maskable" = Android schneidet
//    selbst zu (deshalb randlos). Das S bleibt mit 304 px innerhalb der Sicherheitszone
//    (mittlerer Kreis, 80 % der Kante), wird also von keiner Maske angeschnitten.
await write("public/icons/icon-192.png", await png(192, RADIUS));
await write("public/icons/icon-512.png", await png(512, RADIUS));
await write("public/icons/icon-maskable-512.png", await png(512, 0));
