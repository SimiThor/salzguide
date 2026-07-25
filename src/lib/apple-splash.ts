// Apples Startbildschirme („launch screens") für die App am iOS-Homescreen.
//
// WARUM DIESE TABELLE EXISTIERT
//
// Android nimmt sich den Startbildschirm selbst: background_color aus dem Manifest, Symbol
// in die Mitte, fertig. iOS will stattdessen ein FERTIGES BILD pro Bildschirmgrösse, jeweils
// hoch und quer, ausgewählt über eine Media-Bedingung, die exakt passen muss. Ein Pixel
// daneben und iOS nimmt das Bild nicht.
//
// DIESE DATEI IST DIE EINZIGE QUELLE
//
// Sie hat zwei Leser: das Layout hängt daraus die <link>-Zeilen in den Kopf, und
// scripts/make-icons.ts erzeugt daraus die Bilddateien. Stünde die Liste zweimal da, würde
// irgendwann ein Gerät nur in einer der beiden stehen — und der Fehler wäre unsichtbar, weil
// ein fehlendes Bild keine Fehlermeldung gibt, sondern nur einen leeren Startbildschirm.
//
// EIN NEUES IPHONE EINTRAGEN
//
// Eine Zeile hier, dann `npm run icons`. Die CSS-Punkte des Geräts stehen in Safari unter
// `screen.width` / `screen.height`, die Pixeldichte unter `devicePixelRatio`.
//
// WAS PASSIERT, WENN EIN GERÄT FEHLT
//
// Nichts Schlimmes: Findet iOS keine passende Bedingung, baut es sich selbst einen
// Startbildschirm aus background_color und Symbol des Manifests. Weil beides schon auf
// Creme und das rote S zeigt, sieht das fast gleich aus. Diese Tabelle ist also eine
// Verbesserung, keine Bedingung — deshalb steht hier auch bewusst kein geratenes Gerät.

/** Eine Bildschirmklasse. Masse IMMER im Hochformat, iOS dreht `device-width` nicht mit. */
export interface AppleScreen {
  /** CSS-Punkte quer (Hochformat) */
  width: number;
  /** CSS-Punkte hoch (Hochformat) */
  height: number;
  /** Pixel je CSS-Punkt */
  ratio: number;
  /** Wer diese Klasse teilt. Nur Doku, damit die Zahlen zuordenbar bleiben. */
  devices: string;
}

export const APPLE_SCREENS: readonly AppleScreen[] = [
  // iPhone
  { width: 375, height: 667, ratio: 2, devices: "iPhone SE (2./3. Gen), 6, 7, 8" },
  { width: 414, height: 736, ratio: 3, devices: "iPhone 6 Plus, 7 Plus, 8 Plus" },
  { width: 375, height: 812, ratio: 3, devices: "iPhone X, XS, 11 Pro, 12 mini, 13 mini, 16e" },
  { width: 414, height: 896, ratio: 2, devices: "iPhone XR, 11" },
  { width: 414, height: 896, ratio: 3, devices: "iPhone XS Max, 11 Pro Max" },
  { width: 390, height: 844, ratio: 3, devices: "iPhone 12, 12 Pro, 13, 13 Pro, 14" },
  { width: 428, height: 926, ratio: 3, devices: "iPhone 12 Pro Max, 13 Pro Max, 14 Plus" },
  { width: 393, height: 852, ratio: 3, devices: "iPhone 14 Pro, 15, 15 Pro, 16" },
  { width: 430, height: 932, ratio: 3, devices: "iPhone 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus" },
  { width: 402, height: 874, ratio: 3, devices: "iPhone 16 Pro, 17, 17 Pro" },
  { width: 440, height: 956, ratio: 3, devices: "iPhone 16 Pro Max, 17 Pro Max" },
  // iPad (alle mit doppelter Pixeldichte)
  { width: 768, height: 1024, ratio: 2, devices: "iPad 9,7\", iPad mini 5" },
  { width: 744, height: 1133, ratio: 2, devices: "iPad mini (6./7. Gen)" },
  { width: 810, height: 1080, ratio: 2, devices: "iPad 10,2\" (7.-9. Gen)" },
  { width: 820, height: 1180, ratio: 2, devices: "iPad (10. Gen), iPad Air 10,9\" und 11\"" },
  { width: 834, height: 1194, ratio: 2, devices: "iPad Pro 11\" (1.-4. Gen)" },
  { width: 834, height: 1210, ratio: 2, devices: "iPad Pro 11\" (M4)" },
  { width: 1024, height: 1366, ratio: 2, devices: "iPad Pro 12,9\", iPad Air 13\"" },
  { width: 1032, height: 1376, ratio: 2, devices: "iPad Pro 13\" (M4)" },
];

export const ORIENTATIONS = ["portrait", "landscape"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

/** Öffentlicher Pfad der Bilddatei. Erzeuger und Verlinker rechnen ihn identisch aus. */
export function splashPath(screen: AppleScreen, orientation: Orientation): string {
  return `/splash/${screen.width}x${screen.height}@${screen.ratio}x-${orientation}.png`;
}

/** Masse der Bilddatei in echten Pixeln. */
export function splashPixels(screen: AppleScreen, orientation: Orientation) {
  const portrait = orientation === "portrait";
  return {
    width: (portrait ? screen.width : screen.height) * screen.ratio,
    height: (portrait ? screen.height : screen.width) * screen.ratio,
  };
}

/**
 * Die Bedingung, mit der iOS genau EIN Bild auswählt.
 *
 * `device-width`/`device-height` beschreiben den Bildschirm, nicht das Fenster: Sie bleiben
 * beim Drehen gleich. Deshalb tragen beide Ausrichtungen dieselben Zahlen und unterscheiden
 * sich nur im `orientation`-Teil.
 */
export function splashMedia(screen: AppleScreen, orientation: Orientation): string {
  return [
    "screen",
    `(device-width: ${screen.width}px)`,
    `(device-height: ${screen.height}px)`,
    `(-webkit-device-pixel-ratio: ${screen.ratio})`,
    `(orientation: ${orientation})`,
  ].join(" and ");
}

/** Alle <link>-Angaben, fertig zum Rendern im Layout. */
export const APPLE_SPLASH_LINKS: readonly { href: string; media: string }[] =
  APPLE_SCREENS.flatMap((screen) =>
    ORIENTATIONS.map((orientation) => ({
      href: splashPath(screen, orientation),
      media: splashMedia(screen, orientation),
    })),
  );
