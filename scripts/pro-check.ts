// Prüft die Rückkehr aus dem Kauf. Aufruf: npm run pro:check
//
// WARUM ES DIESE PRÜFUNG GIBT: Nach dem Bezahlen soll der Gast dorthin zurück, wo er
// aufgehört hat, also in seine laufende Radrunde. Ein Rücksprungziel, das von aussen kommt,
// ist die klassische offene Weiterleitung: Wer den Wert setzen kann, schickt den frisch
// bezahlten Käufer auf eine fremde Seite, die aussieht wie unsere und nach seinen
// Zugangsdaten fragt. Genau in dem Moment ist er dafür am empfänglichsten, denn er hat
// gerade bezahlt und erwartet, dass jetzt etwas passiert.
//
// Die Abwehr ist, dass NUR EIN SLUG mitreist und der Server den Pfad selbst baut. Diese
// Prüfung hält fest, dass der Slug-Filter hält und dass aus dem, was er durchlässt, kein
// Pfad entstehen kann, der unsere Seite verlässt.
import { safeTourSlug } from "@/lib/url";
import { stopAudioAccess } from "@/lib/tour-audio-gate";

let failed = 0;
const ok = (name: string) => console.log(`  ok    ${name}`);
const bad = (name: string, detail: string) => {
  console.log(`  FEHLT ${name}\n        ${detail}`);
  failed++;
};

console.log("1. Der Slug-Filter laesst nur harmlose Werte durch");
{
  const erlaubt = ["die-stadt-von-aussen", "runde2", "a", "x".repeat(80)];
  for (const v of erlaubt) {
    if (safeTourSlug(v) === v.toLowerCase()) ok(`durchgelassen: ${v.slice(0, 28)}`);
    else bad(`faelschlich abgewiesen: ${v.slice(0, 28)}`, String(safeTourSlug(v)));
  }
}

console.log("\n2. Alles, womit man aus dem Pfad ausbrechen koennte, wird abgewiesen");
{
  const angriffe: [string, string][] = [
    ["//evil.com", "protokollrelativ, landet auf fremder Domain"],
    ["/\\evil.com", "Backslash, den Browser zu / normalisieren"],
    ["https://evil.com", "absolute Adresse"],
    ["../../evil", "Pfad-Aufstieg"],
    ["a/../../b", "Aufstieg in der Mitte"],
    ["a?next=https://evil.com", "angehaengte Abfrage"],
    ["a#/../evil", "Fragment"],
    ["a%2f%2eevil", "prozentkodiert"],
    ["javascript:alert(1)", "Skript-Schema"],
    ["data:text/html,x", "data-Schema"],
    ["a b", "Leerzeichen"],
    ["a\nb", "Zeilenumbruch"],
    ["-fuehrender-strich", "beginnt mit Strich"],
    ["x".repeat(81), "zu lang"],
    ["", "leer"],
  ];
  for (const [v, warum] of angriffe) {
    if (safeTourSlug(v) === null) ok(`abgewiesen (${warum})`);
    else bad(`DURCHGELASSEN (${warum})`, `"${v}" -> "${safeTourSlug(v)}"`);
  }
}

console.log("\n3. Aus einem durchgelassenen Slug entsteht immer ein Pfad auf UNSERER Seite");
{
  // Genau die beiden Ziele, die stripe-actions.ts und die Aktivieren-Route bauen.
  const bauen = (locale: string, slug: string) => [
    `/${locale}/touren/${slug}/navigation?checkout=success`,
    `/${locale}/touren/${slug}/navigation?checkout=cancel`,
  ];
  const proben = ["die-stadt-von-aussen", "a", "runde-2"];
  let alleGut = true;
  for (const s of proben) {
    const slug = safeTourSlug(s);
    if (!slug) { bad("Probe faelschlich abgewiesen", s); alleGut = false; continue; }
    for (const pfad of bauen("de", slug)) {
      // Gegen eine fremde Basis aufloesen: Bleibt der Host fremd, hat der Pfad die Seite
      // verlassen. Genau das darf nie passieren.
      const u = new URL(pfad, "https://salzguide.com");
      if (u.origin !== "https://salzguide.com") {
        bad("Pfad verlaesst die Seite", `${pfad} -> ${u.href}`);
        alleGut = false;
      }
      if (!u.pathname.startsWith("/de/touren/")) {
        bad("Pfad zeigt nicht auf eine Runde", `${pfad} -> ${u.pathname}`);
        alleGut = false;
      }
    }
  }
  if (alleGut) ok("jeder gebaute Pfad bleibt auf salzguide.com und zeigt auf eine Runde");
}

console.log("\n4. Ohne Slug bleibt es beim alten Weg auf /pro");
{
  for (const v of [null, undefined, ""]) {
    if (safeTourSlug(v) === null) ok(`kein Rücksprungziel bei ${JSON.stringify(v)}`);
    else bad("unerwartetes Ziel", String(safeTourSlug(v)));
  }
}

console.log("\n5. Ein gesperrter Stopp bekommt NIE die Volldatei");
{
  const voll = "punkt/de.mp3";
  const probe = "punkt/de-kostprobe.mp3";

  const gesperrt = stopAudioAccess({ locked: true, audioUrl: voll, teaserUrl: probe });
  if (gesperrt.signPath === probe && gesperrt.isTeaser) ok("gesperrt + Kostprobe -> nur die Kostprobe");
  else bad("gesperrter Stopp bekommt die falsche Datei", JSON.stringify(gesperrt));

  // Der gefaehrlichste Fall: Kostprobe fehlt. Dann darf NICHTS signiert werden, nicht
  // ersatzweise die Volldatei.
  const ohneProbe = stopAudioAccess({ locked: true, audioUrl: voll, teaserUrl: null });
  if (ohneProbe.signPath === null) ok("gesperrt ohne Kostprobe -> gar nichts");
  else bad("FALLBACK AUF DIE VOLLDATEI", JSON.stringify(ohneProbe));

  const offen = stopAudioAccess({ locked: false, audioUrl: voll, teaserUrl: probe });
  if (offen.signPath === voll && !offen.isTeaser) ok("offen -> die Volldatei, nicht die Kostprobe");
  else bad("offener Stopp bekommt die falsche Datei", JSON.stringify(offen));

  const leer = stopAudioAccess({ locked: false, audioUrl: null, teaserUrl: probe });
  if (leer.signPath === null) ok("offen ohne Vertonung -> gar nichts");
  else bad("unerwarteter Pfad ohne Vertonung", JSON.stringify(leer));
}

console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen.` : "\nAlles grün.");
process.exitCode = failed ? 1 : 0;
