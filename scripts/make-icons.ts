// App-Symbole und iOS-Startbildschirme erzeugen:
//
//   npm run icons
//
// WARUM EIN SKRIPT UND NICHT EINFACH EIN HAUFEN BILDDATEIEN
//
// Am Ende liegen über vierzig Dateien da: Favicon in drei Grössen, Symbole für iOS und
// Android, und für jede iPhone- und iPad-Grösse ein Startbildschirm hoch und quer. Wer die
// von Hand exportiert, hat vierzig Gelegenheiten, eine Grösse zu vergessen oder den Rotton
// eine Nuance danebenzulegen — und niemand sieht es, weil ein Favicon 16 Pixel gross ist.
// Hier stehen Form und Farbe EINMAL, alles andere wird daraus gerechnet.
//
// DIE BUCHSTABEN SIND PFADE, KEIN TEXT
//
// „S" und „SalzGuide" sind die Konturen aus Inter, mit fontTools aus der Schriftdatei geholt
// (inklusive Unterschneidung) und hier als Pfad eingefroren. Als <text> im SVG wären sie das
// nicht: Ein Favicon rendert der Browser ohne unsere Webfont, ein PNG-Rasterer nimmt
// irgendeine installierte Schrift. Beides ergäbe andere Buchstaben als im Schriftzug der
// App — oder gar keine. Eingefroren braucht dieses Skript keine installierte Schrift und
// läuft auf jedem Rechner gleich.
//
// Das Symbol trägt ExtraBold statt des Bold aus dem Schriftzug: Bei 16 px verliert eine
// dünnere Kontur die Rundungen, das S wird zum Klecks. Der Startbildschirm hat den Platz
// und trägt deshalb den echten Schriftzug in Bold.
//
// WELCHE GERÄTE EINEN STARTBILDSCHIRM BEKOMMEN, STEHT NICHT HIER
//
// Das steht in src/lib/apple-splash.ts, weil das Layout dieselbe Liste braucht, um die
// <link>-Zeilen zu setzen. Eine Liste, zwei Leser.

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  APPLE_SCREENS,
  ORIENTATIONS,
  splashPath,
  splashPixels,
  type AppleScreen,
  type Orientation,
} from "../src/lib/apple-splash.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Design-Tokens aus CLAUDE.md. Creme auf Rot, nicht Weiss auf Rot: dasselbe Paar wie in
// der App.
const RED = "#cc2924";
const CREAM = "#faf6ec";

const CANVAS = 512; // Bezugsgrösse des Symbols; alles darunter wird herunterskaliert.

// Ecken-Radius für alles, was der Browser UNGEMASKT anzeigt (Tab, Lesezeichen). 22 % ist
// Apples Kachel-Rundung; bei 16 px sind das 3,5 px und es sieht nach App aus statt nach
// Aufkleber. iOS und Android bekommen die eckige Variante, die schneiden selbst zu.
const RADIUS_FRACTION = 0.2237;
const RADIUS = Math.round(CANVAS * RADIUS_FRACTION);

/** Eine Kontur in Schrift-Einheiten samt ihrer Grenzen. */
interface Glyphs {
  d: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

// Inter ExtraBold, Glyphe „S". Ober- und Unterkante liegen je 23 Einheiten über der
// Versalhöhe bzw. unter der Grundlinie — die Überschneidung, die runde Buchstaben brauchen,
// damit sie neben geraden nicht kleiner wirken. Genau deshalb wird unten der KASTEN
// zentriert und nicht die Grundlinie ausgerichtet: So sitzt das S optisch mittig.
const MARK: Glyphs = {
  xMin: 68,
  yMin: -23,
  xMax: 1296,
  yMax: 1513,
  d: "M689 -23Q494 -23 355.0 36.5Q216 96 142.5 211.0Q69 326 68 492H410Q413 421 448.0 370.5Q483 320 545.0 293.5Q607 267 691 267Q767 267 822.5 287.0Q878 307 909.0 343.5Q940 380 940 428Q940 471 913.5 502.0Q887 533 831.0 556.5Q775 580 687 598L534 631Q321 675 210.0 780.5Q99 886 99 1050Q99 1189 173.0 1293.0Q247 1397 379.0 1455.0Q511 1513 684 1513Q861 1513 990.0 1454.5Q1119 1396 1190.5 1288.0Q1262 1180 1266 1030H931Q924 1120 859.0 1171.5Q794 1223 687 1223Q620 1223 568.5 1203.5Q517 1184 489.0 1149.0Q461 1114 461 1069Q461 1026 486.0 996.5Q511 967 563.5 945.0Q616 923 697 906L828 879Q948 855 1036.0 817.0Q1124 779 1182.0 726.0Q1240 673 1268.0 604.0Q1296 535 1296 448Q1296 300 1224.0 194.5Q1152 89 1016.0 33.0Q880 -23 689 -23Z",
};

// Inter Bold, das Wort „SalzGuide" am Stück, mit derselben leichten Verengung wie der
// Schriftzug im Kopf der App (Tailwind `tracking-tight`, -0,025 em).
const WORDMARK: Glyphs = {
  xMin: 74,
  yMin: -24,
  xMax: 9270.4,
  yMax: 1518,
  d: "M676.0 -23.0Q488.0 -23.0 353.5 36.0Q219.0 95.0 147.0 208.5Q75.0 322.0 74.0 483.0H371.0Q373.0 403.0 411.0 346.5Q449.0 290.0 517.0 260.0Q585.0 230.0 677.0 230.0Q762.0 230.0 825.0 254.0Q888.0 278.0 923.0 321.0Q958.0 364.0 958.0 421.0Q958.0 470.0 930.0 505.5Q902.0 541.0 843.5 567.0Q785.0 593.0 693.0 614.0L535.0 649.0Q321.0 697.0 213.0 799.0Q105.0 901.0 105.0 1061.0Q105.0 1197.0 176.0 1298.5Q247.0 1400.0 374.5 1456.5Q502.0 1513.0 669.0 1513.0Q840.0 1513.0 964.5 1455.5Q1089.0 1398.0 1158.0 1292.0Q1227.0 1186.0 1231.0 1040.0H942.0Q934.0 1143.0 861.5 1201.0Q789.0 1259.0 670.0 1259.0Q594.0 1259.0 536.0 1236.0Q478.0 1213.0 446.0 1172.0Q414.0 1131.0 414.0 1077.0Q414.0 1029.0 441.5 995.0Q469.0 961.0 525.5 936.5Q582.0 912.0 667.0 893.0L808.0 861.0Q921.0 837.0 1006.5 800.0Q1092.0 763.0 1149.5 711.0Q1207.0 659.0 1235.5 591.0Q1264.0 523.0 1264.0 437.0Q1264.0 295.0 1193.0 191.5Q1122.0 88.0 990.5 32.5Q859.0 -23.0 676.0 -23.0ZM1715.8 -19.0Q1610.8 -19.0 1528.3 16.5Q1445.8 52.0 1398.3 123.5Q1350.8 195.0 1350.8 301.0Q1350.8 392.0 1383.8 452.0Q1416.8 512.0 1474.8 548.5Q1532.8 585.0 1607.8 604.5Q1682.8 624.0 1764.8 632.0Q1861.8 641.0 1919.3 650.0Q1976.8 659.0 2002.3 676.5Q2027.8 694.0 2027.8 728.0V734.0Q2027.8 776.0 2007.3 806.0Q1986.8 836.0 1948.3 853.0Q1909.8 870.0 1854.8 870.0Q1799.8 870.0 1757.8 853.0Q1715.8 836.0 1691.3 805.5Q1666.8 775.0 1660.8 735.0L1383.8 745.0Q1395.8 852.0 1455.8 929.0Q1515.8 1006.0 1618.8 1048.0Q1721.8 1090.0 1861.8 1090.0Q1965.8 1090.0 2050.8 1066.0Q2135.8 1042.0 2196.3 995.5Q2256.8 949.0 2288.8 881.0Q2320.8 813.0 2320.8 724.0V0.0H2033.8V150.0H2028.8Q2000.8 99.0 1958.8 61.0Q1916.8 23.0 1857.3 2.0Q1797.8 -19.0 1715.8 -19.0ZM1797.8 187.0Q1868.8 187.0 1921.3 213.5Q1973.8 240.0 2001.8 286.0Q2029.8 332.0 2029.8 389.0V498.0Q2017.8 491.0 1995.3 484.5Q1972.8 478.0 1943.8 472.0Q1914.8 466.0 1881.8 460.5Q1848.8 455.0 1815.8 450.0Q1764.8 442.0 1723.3 425.5Q1681.8 409.0 1657.8 380.5Q1633.8 352.0 1633.8 309.0Q1633.8 271.0 1654.3 243.5Q1674.8 216.0 1711.8 201.5Q1748.8 187.0 1797.8 187.0ZM2784.6 1490.0V0.0H2489.6V1490.0ZM2944.4 0.0V194.0L3474.4 830.0V834.0H2948.4V1070.0H3825.4V863.0L3310.4 239.0V235.0H3835.4V0.0ZM4662.2 -23.0Q4451.2 -23.0 4292.2 72.5Q4133.2 168.0 4044.2 340.5Q3955.2 513.0 3955.2 744.0Q3955.2 983.0 4047.2 1155.5Q4139.2 1328.0 4298.2 1420.5Q4457.2 1513.0 4657.2 1513.0Q4785.2 1513.0 4896.7 1476.0Q5008.2 1439.0 5095.2 1369.5Q5182.2 1300.0 5237.7 1205.5Q5293.2 1111.0 5307.2 995.0H4995.2Q4982.2 1051.0 4954.2 1096.5Q4926.2 1142.0 4883.2 1174.5Q4840.2 1207.0 4785.7 1224.5Q4731.2 1242.0 4665.2 1242.0Q4542.2 1242.0 4452.2 1181.5Q4362.2 1121.0 4313.2 1010.0Q4264.2 899.0 4264.2 744.0Q4264.2 591.0 4313.2 479.5Q4362.2 368.0 4453.2 308.0Q4544.2 248.0 4669.2 248.0Q4774.2 248.0 4852.7 288.0Q4931.2 328.0 4975.2 399.0Q5019.2 470.0 5019.2 565.0L5090.2 559.0H4694.2V792.0H5319.2V603.0Q5319.2 416.0 5234.7 275.0Q5150.2 134.0 5002.2 55.5Q4854.2 -23.0 4662.2 -23.0ZM5831.0 -20.0Q5719.0 -20.0 5634.5 29.0Q5550.0 78.0 5504.0 171.5Q5458.0 265.0 5458.0 397.0V1070.0H5753.0V451.0Q5753.0 346.0 5805.0 289.5Q5857.0 233.0 5949.0 233.0Q6011.0 233.0 6058.0 258.5Q6105.0 284.0 6132.0 337.0Q6159.0 390.0 6159.0 470.0V1070.0H6454.0V0.0H6166.0L6165.0 276.0H6208.0Q6159.0 136.0 6067.0 58.0Q5975.0 -20.0 5831.0 -20.0ZM6622.8 0.0V1070.0H6917.8V0.0ZM6769.8 1205.0Q6697.8 1205.0 6650.3 1250.0Q6602.8 1295.0 6602.8 1362.0Q6602.8 1429.0 6650.3 1473.5Q6697.8 1518.0 6769.8 1518.0Q6841.8 1518.0 6889.8 1473.5Q6937.8 1429.0 6937.8 1362.0Q6937.8 1295.0 6889.8 1250.0Q6841.8 1205.0 6769.8 1205.0ZM7496.6 -21.0Q7360.6 -21.0 7257.6 47.0Q7154.6 115.0 7097.1 240.0Q7039.6 365.0 7039.6 535.0Q7039.6 704.0 7098.1 828.5Q7156.6 953.0 7259.6 1021.5Q7362.6 1090.0 7494.6 1090.0Q7568.6 1090.0 7628.1 1068.5Q7687.6 1047.0 7732.1 1008.0Q7776.6 969.0 7806.6 914.0H7810.6V1490.0H8105.6V0.0H7814.6V166.0H7810.6Q7781.6 108.0 7736.6 66.0Q7691.6 24.0 7631.1 1.5Q7570.6 -21.0 7496.6 -21.0ZM7575.6 219.0Q7651.6 219.0 7706.6 258.0Q7761.6 297.0 7792.1 368.5Q7822.6 440.0 7822.6 536.0Q7822.6 632.0 7792.1 702.5Q7761.6 773.0 7706.6 812.0Q7651.6 851.0 7575.6 851.0Q7503.6 851.0 7450.1 813.0Q7396.6 775.0 7368.1 704.5Q7339.6 634.0 7339.6 536.0Q7339.6 437.0 7368.1 366.0Q7396.6 295.0 7450.1 257.0Q7503.6 219.0 7575.6 219.0ZM8761.400000000001 -24.0Q8598.400000000001 -24.0 8478.400000000001 47.0Q8358.400000000001 118.0 8292.900000000001 243.5Q8227.400000000001 369.0 8227.400000000001 533.0Q8227.400000000001 697.0 8293.900000000001 823.0Q8360.400000000001 949.0 8477.900000000001 1020.5Q8595.400000000001 1092.0 8750.400000000001 1092.0Q8865.400000000001 1092.0 8960.400000000001 1053.0Q9055.400000000001 1014.0 9124.900000000001 941.5Q9194.400000000001 869.0 9232.400000000001 767.5Q9270.400000000001 666.0 9270.400000000001 540.0V460.0H8336.400000000001V648.0H9127.400000000001L8993.400000000001 602.0Q8993.400000000001 684.0 8964.900000000001 743.0Q8936.400000000001 802.0 8883.400000000001 834.5Q8830.400000000001 867.0 8755.400000000001 867.0Q8681.400000000001 867.0 8627.900000000001 834.5Q8574.400000000001 802.0 8545.400000000001 743.5Q8516.400000000001 685.0 8516.400000000001 605.0V475.0Q8516.400000000001 390.0 8546.400000000001 328.0Q8576.400000000001 266.0 8633.400000000001 232.5Q8690.400000000001 199.0 8769.400000000001 199.0Q8825.400000000001 199.0 8869.900000000001 215.0Q8914.400000000001 231.0 8944.900000000001 261.5Q8975.400000000001 292.0 8989.400000000001 333.0L9258.400000000001 321.0Q9237.400000000001 219.0 9168.400000000001 141.5Q9099.400000000001 64.0 8994.400000000001 20.0Q8889.400000000001 -24.0 8761.400000000001 -24.0Z",
};

/**
 * Eine Kontur so einsetzen, dass ihr Kasten `height` hoch ist, waagrecht um `centerX`
 * zentriert und mit der Oberkante auf `top`.
 *
 * scale(s, -s) dreht die Schrift-Achse (y nach oben) auf die SVG-Achse (y nach unten).
 */
function glyphs(g: Glyphs, centerX: number, top: number, height: number, fill: string): string {
  const scale = height / (g.yMax - g.yMin);
  const width = (g.xMax - g.xMin) * scale;
  const tx = centerX - width / 2 - scale * g.xMin;
  const ty = top + height + scale * g.yMin;
  return `<path transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(6)} ${(-scale).toFixed(6)})" fill="${fill}" d="${g.d}"/>`;
}

/** Die rote Kachel mit dem S, an beliebiger Stelle und Grösse. */
function tile(x: number, y: number, size: number, radius: number): string {
  const markHeight = size * (304 / CANVAS); // 59 % der Kachelhöhe, siehe unten
  return (
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${radius.toFixed(2)}" fill="${RED}"/>` +
    glyphs(MARK, x + size / 2, y + (size - markHeight) / 2, markHeight, CREAM)
  );
}

// Höhe des S auf der 512er-Kachel (59 %). Kleiner wirkt es verloren, grösser drängt es in
// die Ecken — und in Androids maskierbarem Symbol würde es angeschnitten.
const MARK_HEIGHT = 304;

/** Das App-Symbol als SVG. `radius` = 0 für die randlose Variante. */
function appIcon({ radius, size }: { radius: number; size?: number }): string {
  const dim = size ? ` width="${size}" height="${size}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg"${dim} viewBox="0 0 ${CANVAS} ${CANVAS}" role="img" aria-label="SalzGuide">
  <rect width="${CANVAS}" height="${CANVAS}" rx="${radius}" fill="${RED}"/>
  ${glyphs(MARK, CANVAS / 2, (CANVAS - MARK_HEIGHT) / 2, MARK_HEIGHT, CREAM)}
</svg>
`;
}

// Aufbau des Startbildschirms, in Anteilen der Kachel — so sieht er auf jedem Gerät gleich
// aus. Ruhig und mittig, wie Apples eigene: Cremefläche, Kachel, Schriftzug, sonst nichts.
// Kein Ladebalken und kein Spruch: Das Bild steht nur eine knappe Sekunde und darf beim
// Übergang in die Karte nicht springen — deshalb ist der Hintergrund auch exakt das Creme
// aus background_color des Manifests.
const SPLASH = {
  tileFraction: 0.28, // Kachelgrösse, gemessen an der KURZEN Bildschirmseite
  tileMax: 200, // Deckel, sonst wird die Kachel am iPad zur Litfasssäule
  gap: 0.3, // Abstand Kachel -> Schriftzug, in Kachelhöhen
  wordmark: 0.21, // Höhe des Schriftzugs, in Kachelhöhen
  centerY: 0.47, // Mitte des Blocks; leicht über der Mitte wirkt ruhiger als exakt mittig
};

/** Ein Startbildschirm in CSS-Punkten, gerastert auf die echte Pixelgrösse. */
function splashScreen(cssWidth: number, cssHeight: number, pixels: { width: number; height: number }) {
  const size = Math.min(Math.min(cssWidth, cssHeight) * SPLASH.tileFraction, SPLASH.tileMax);
  const wordmarkHeight = size * SPLASH.wordmark;
  const block = size + size * SPLASH.gap + wordmarkHeight;
  const top = cssHeight * SPLASH.centerY - block / 2;
  const centerX = cssWidth / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels.width}" height="${pixels.height}" viewBox="0 0 ${cssWidth} ${cssHeight}">
  <rect width="${cssWidth}" height="${cssHeight}" fill="${CREAM}"/>
  ${tile(centerX - size / 2, top, size, size * RADIUS_FRACTION)}
  ${glyphs(WORDMARK, centerX, top + size + size * SPLASH.gap, wordmarkHeight, RED)}
</svg>
`;
}

/** SVG in ein PNG rastern. `flat` entfernt den Alpha-Kanal. */
function png(svg: string, flat: boolean): Promise<Buffer> {
  const raster = sharp(Buffer.from(svg));
  // Randlos heisst auch: ohne Alpha-Kanal. iOS und ältere Android-Launcher füllen
  // Transparenz mit Schwarz — hier ist zwar nichts durchsichtig, aber ein Bild, das gar
  // keinen Alpha-Kanal mitbringt, kann auch keiner falsch interpretieren.
  return (flat ? raster.flatten({ background: RED }) : raster)
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
}

/**
 * Mehrere PNGs in einen ICO-Container packen.
 *
 * sharp kann kein ICO schreiben, das Format ist aber trivial: 6 Byte Kopf, je 16 Byte
 * Verzeichniseintrag, dann die Bilddaten am Stück. PNG statt BMP im Inneren beherrscht
 * jeder Browser seit IE 11.
 */
function ico(images: { size: number; data: Buffer }[]): Buffer {
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

let bytes = 0;
async function write(relative: string, data: Buffer | string) {
  const file = path.join(ROOT, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
  bytes += Buffer.byteLength(data);
}

console.log("App-Symbole:");

// 1. Vektor-Favicon. Moderne Browser bevorzugen es gegenüber der .ico und zeigen es auf
//    jedem Bildschirm scharf. Ohne width/height, damit es in jede Kachel skaliert.
await write("src/app/icon.svg", appIcon({ radius: RADIUS }));

// 2. favicon.ico für alles Ältere und für Lesezeichen-Leisten. Drei Grössen, weil
//    Browser sich die passende aussuchen statt zu skalieren.
await write(
  "src/app/favicon.ico",
  ico(
    await Promise.all(
      [16, 32, 48].map(async (size) => ({
        size,
        data: await png(appIcon({ radius: RADIUS, size }), false),
      })),
    ),
  ),
);

// 3. iOS-Homescreen. RANDLOS und ohne Transparenz: iOS legt seine eigene Maske darüber,
//    eigene Rundungen würden doppelt beschnitten und transparente Ecken würden schwarz.
await write("src/app/apple-icon.png", await png(appIcon({ radius: 0, size: 180 }), true));

// 4. Android/PWA. „any" = so wie es ist (deshalb gerundet), „maskable" = Android schneidet
//    selbst zu (deshalb randlos). Das S bleibt mit 59 % innerhalb der Sicherheitszone
//    (mittlerer Kreis, 80 % der Kante), wird also von keiner Maske angeschnitten.
await write("public/icons/icon-192.png", await png(appIcon({ radius: RADIUS, size: 192 }), false));
await write("public/icons/icon-512.png", await png(appIcon({ radius: RADIUS, size: 512 }), false));
await write("public/icons/icon-maskable-512.png", await png(appIcon({ radius: 0, size: 512 }), true));

console.log(`  6 Dateien, ${(bytes / 1024).toFixed(0)} kB`);

// 5. Startbildschirme. Der Ordner wird vorher geleert: Fällt ein Gerät aus der Liste,
//    bliebe seine Datei sonst für immer liegen und niemand wüsste, wozu sie gehört.
const before = bytes;
const splashDir = path.join(ROOT, "public/splash");
await rm(splashDir, { recursive: true, force: true });
await mkdir(splashDir, { recursive: true });

const jobs: { screen: AppleScreen; orientation: Orientation }[] = APPLE_SCREENS.flatMap((screen) =>
  ORIENTATIONS.map((orientation) => ({ screen, orientation })),
);

for (const { screen, orientation } of jobs) {
  const pixels = splashPixels(screen, orientation);
  const portrait = orientation === "portrait";
  const svg = splashScreen(
    portrait ? screen.width : screen.height,
    portrait ? screen.height : screen.width,
    pixels,
  );
  await write(`public${splashPath(screen, orientation)}`, await png(svg, true));
}

console.log(
  `Startbildschirme:\n  ${jobs.length} Dateien für ${APPLE_SCREENS.length} Bildschirmgrössen, ${((bytes - before) / 1024).toFixed(0)} kB`,
);

// 6. Open-Graph-Standardbild (Link-Vorschau in WhatsApp, iMessage, Slack & Co.).
//    1200×630 ist das Format, das alle Messenger erwarten. Gleiche Bausteine wie der
//    Startbildschirm: Creme, Kachel, Schriftzug — die Schrift als eingefrorene Pfade,
//    damit das Bild auf jedem Rechner identisch rastert. Spot-Seiten schicken ihr
//    echtes Foto (lib/metadata.ts ogFor()); dieses Bild tragen alle anderen Seiten.
function ogImage(): string {
  const W = 1200;
  const H = 630;
  const size = 200; // Kachel wie am Startbildschirm-Deckel
  const wordmarkHeight = 92; // grösser als am Splash: das Bild steht in der Vorschau allein
  const gap = 56;
  const block = size + gap + wordmarkHeight;
  const top = (H - block) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${CREAM}"/>
  ${tile(W / 2 - size / 2, top, size, size * RADIUS_FRACTION)}
  ${glyphs(WORDMARK, W / 2, top + size + gap, wordmarkHeight, RED)}
</svg>
`;
}

const beforeOg = bytes;
await write("public/og-default.png", await png(ogImage(), true));
console.log(`Open-Graph-Bild:\n  1 Datei, ${((bytes - beforeOg) / 1024).toFixed(0)} kB`);

// Gegenprobe: liegt für jede Zeile der Tabelle auch wirklich eine Datei da? Ein fehlendes
// Bild gibt keine Fehlermeldung, sondern nur einen leeren Startbildschirm am iPhone.
const written = new Set(await readdir(splashDir));
const missing = jobs
  .map(({ screen, orientation }) => path.basename(splashPath(screen, orientation)))
  .filter((name) => !written.has(name));
if (missing.length || written.size !== jobs.length) {
  console.error(`  FEHLER: ${missing.length} fehlen, ${written.size - jobs.length} zu viel`);
  process.exit(1);
}
console.log("  Tabelle und Ordner stimmen überein.");
