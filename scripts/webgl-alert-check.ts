// Prüft, dass eine fehlende Karte und ein fehlender Daten-Strom (getReader) am Desktop nur ins
// Logbuch gehen und vom Handy weiter mailen.
// Aufruf: npm run webgl-alert:check
//
// Hintergrund: Am 07.11.2026 kamen zwei Alarm-Mails „Karte nicht darstellbar", ausgelöst von
// einer Maschine mit Desktop-Browser-Kennung. Echte Besucher waren nicht betroffen. Läuft ohne
// Netz und ohne Schlüssel.
import { classifyDevice } from "@/lib/analytics";
import { OPS_EVENTS, isStreamReaderMissing, streamOpsKind, webglOpsKind } from "@/lib/ops-events";

let okCount = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    okCount++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FEHLT ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

const UA = {
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};
const kindFor = (ua: string | null) => webglOpsKind(classifyDevice(ua));
const mails = (kind: keyof typeof OPS_EVENTS) => OPS_EVENTS[kind].alertAfter > 0;

console.log("\nFehlende Karte: welche Art, ob Mail");
check("Desktop-Chrome -> nur Logbuch", kindFor(UA.desktopChrome) === "client_webgl_desktop" && !mails(kindFor(UA.desktopChrome)), kindFor(UA.desktopChrome));
check("Mac-Safari -> nur Logbuch", kindFor(UA.mac) === "client_webgl_desktop", kindFor(UA.mac));
check("iPhone -> zählt für die Mail", kindFor(UA.iphone) === "client_webgl" && mails(kindFor(UA.iphone)), kindFor(UA.iphone));
check("Android -> zählt für die Mail", kindFor(UA.android) === "client_webgl", kindFor(UA.android));
check("iPad -> zählt für die Mail", kindFor(UA.ipad) === "client_webgl", kindFor(UA.ipad));
check("ohne Kennung -> zählt für die Mail (lieber eine Mail zu viel)", kindFor(null) === "client_webgl", kindFor(null));
check("Handy-Schwelle liegt über dem Normalfall (max. 5 in 6 h)", OPS_EVENTS.client_webgl.alertAfter > 5, String(OPS_EVENTS.client_webgl.alertAfter));
check("Hinweistexte ohne Gedankenstrich",
  !OPS_EVENTS.client_webgl.hint.includes("—") && !OPS_EVENTS.client_webgl_desktop.hint.includes("—"));

// 25.11.2026: Maschine mit Desktop-Kennung ohne lesbaren Daten-Strom, 12 Meldungen auf /pro.
console.log("\nFehlender Daten-Strom (getReader): welche Art, ob Mail");
const chrome = "Cannot read properties of undefined (reading 'getReader')";
const safari = "undefined is not an object (evaluating 'e.body.getReader')";
const streamKind = (msg: string, ua: string | null) =>
  isStreamReaderMissing(msg) ? streamOpsKind(classifyDevice(ua)) : "client_error";
check("Chrome-Wortlaut erkannt", isStreamReaderMissing(chrome));
check("Safari-Wortlaut erkannt", isStreamReaderMissing(safari));
check("anderer Fehler mit getReader im Text bleibt normal", !isStreamReaderMissing("getReader failed: network error"));
check("fremder Fehler bleibt normal", !isStreamReaderMissing("Cannot read properties of undefined (reading 'map')"));
check("Desktop -> nur Logbuch", streamKind(chrome, UA.desktopChrome) === "client_stream_desktop" && !mails("client_stream_desktop"));
check("iPhone -> normaler Fehler mit Mail", streamKind(safari, UA.iphone) === "client_error" && mails("client_error"));
check("Android -> normaler Fehler mit Mail", streamKind(chrome, UA.android) === "client_error");
check("ohne Kennung -> normaler Fehler mit Mail", streamKind(chrome, null) === "client_error");
check("Hinweistext ohne Gedankenstrich", !OPS_EVENTS.client_stream_desktop.hint.includes("—"));

console.log(`\n${okCount} ok, ${failed} fehlgeschlagen`);
if (failed) process.exit(1);
