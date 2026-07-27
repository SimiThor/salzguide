"use client";

import { useRouter } from "@/i18n/navigation";
import { ChevronLeft } from "@/components/icons";

// Einheitlicher Zurück-Button (Stil wie auf den Spot-Unterseiten): rundes
// ChevronLeft-Icon. Geht auf die Seite davor (Browser-Historie); gibt es keine
// (Direktaufruf/geteilter Link), fällt er auf `fallbackHref` zurück -> robust,
// verlässt nie versehentlich die App. Positionierung via className (z.B. absolut
// über einem Hero, sonst in-flow oben links).
//
// ═══════════════════════════════════════════════════════════════════════════════════════
//  DIESER KNOPF IST DER EINZIGE. Auch im Admin, auch auf den Rechtstexten.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Im Admin-Bereich standen daneben drei selbstgebaute Varianten als Text-Links: „← Einstellungen",
// „← Nutzer", „← Events" und einmal „‹ Einstellungen" mit einem anderen Pfeil-Zeichen. Vier
// Fassungen derselben Sache, jede mit eigener Schriftgrösse und eigener Trefferfläche, und
// die letzte fiel bei der Suche nach „←" nicht einmal auf. Auf den Formularseiten (Spot,
// Tour, Event) stand längst dieser Knopf hier, also sprang die Optik je nach Unterseite.
//
// REGEL FÜR DEN ADMIN, damit es nicht wieder auseinanderläuft:
//
//   • Jede UNTERSEITE bekommt `<BackButton fallbackHref="<Elternpfad>" label="<Eltern>" />`
//     als erstes Kind des Seitencontainers. Kein Text daneben, der Pfeil genügt.
//   • Die fünf REITER-SEITEN aus AdminNav (/admin, /admin/events, /admin/tours,
//     /admin/users, /admin/settings) bekommen KEINEN. Dort ist die Reiterleiste die
//     Navigation; ein Zurück daneben führte aus dem Admin heraus.
//   • `label` ist nur für Screenreader (aria-label), es steht nirgends auf dem Bildschirm.
//     Deshalb der Name des ZIELS („Einstellungen"), nicht das Wort „Zurück".
//
// Die vier RECHTSTEXTE (Impressum, Datenschutz, AGB, Widerruf) hatten eine fünfte Fassung:
// „‹ Zurück zur App" in LegalShell, mit dem einfachen Anführungszeichen als Pfeil (fiel
// deshalb, wie die Admin-Variante, bei der Suche nach „←" nicht auf) und nur einer Textzeile
// als Trefferfläche. Sie ging zusätzlich IMMER fest auf /explore statt eine Ebene zurück: Wer
// aus dem Kauf-Ablauf in die AGB sah, kam nicht dorthin zurück, wo er war. Jetzt steht dort
// dieser Knopf, mit /explore nur noch als `fallbackHref`.
//
// WAS KEIN ZURÜCK-KNOPF IST, damit die Regel nicht zu weit greift:
//
//   • „← Zurück / Weiter →" im Blätterwerk (Seite 2 von 5, /admin/users) bleibt Text. Das ist
//     keine Rückkehr, sondern eine Richtung, und es hat sein Gegenstück in „Weiter →".
//   • Ein Schritt zurück INNERHALB einer Ansicht bleibt ein normaler Knopf: der Abbrechen-Knopf
//     im ClipTrimmer, das „Zurück" aus Tonis Verlaufsliste. Dort wechselt die Seite nicht,
//     ein Verlaufs-Pfeil führte also in die Irre.
//   • Die Fehlerseite (error.tsx) bietet „Nochmal" + „Startseite" als Handlungs-Knöpfe an.
//     Sie ist ein Ausweg, keine Navigationsebene.
/**
 * Die Navigation-API, soweit wir sie brauchen. Sie steht (Juli 2026) nicht in TypeScripts
 * DOM-Typen, deshalb hier so eng wie möglich deklariert statt per `any`.
 */
type NavigationApi = { canGoBack?: boolean };

/**
 * Gibt es einen vorherigen Eintrag, der UNS gehört?
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  WARUM `history.length > 1` HIER NICHT REICHT — am Browser nachgemessen
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Genau das stand hier vorher, und im Test landete der Pfeil auf `about:blank`: Ein frisch
 * geöffneter Tab bringt seinen leeren Starteintrag mit, `history.length` ist also schon 2,
 * bevor man irgendwo war. `back()` geht dann auf diese leere Seite, und der Fallback greift
 * nie, weil die Bedingung ja erfüllt war.
 *
 * Das ist kein Testartefakt, sondern genau der Weg, den Anton geht: In der Alarm-Mail steht
 * „Logbuch öffnen", das Mailprogramm öffnet einen NEUEN Tab, und der erste Klick auf den
 * Pfeil führt aus der App heraus statt eine Ebene höher.
 *
 * `navigation.canGoBack` beantwortet die Frage richtig: Es zählt nur Einträge dieses
 * Verlaufs, und ein fremder Starteintrag gehört nicht dazu. Verfügbar in Chrome und in
 * Safari ab 18 — also dort, wo diese App tatsächlich läuft.
 *
 * Wo es die API nicht gibt, bleibt die alte Schätzung. Sie ist nicht schlechter als vorher,
 * und im häufigsten Fall (man ist innerhalb der App hierhergeklickt) stimmt sie ohnehin.
 */
function hasOwnHistory(): boolean {
  const nav = (window as unknown as { navigation?: NavigationApi }).navigation;
  if (nav && typeof nav.canGoBack === "boolean") return nav.canGoBack;
  return window.history.length > 1;
}

export default function BackButton({
  fallbackHref = "/explore",
  label = "Zurück",
  className = "",
}: {
  fallbackHref?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();

  function goBack() {
    if (typeof window === "undefined") return;
    if (hasOwnHistory()) router.back();
    else router.push(fallbackHref);
  }
  return (
    <button
      type="button"
      onClick={goBack}
      aria-label={label}
      className={`cursor-pointer flex h-10 w-10 items-center justify-center rounded-full bg-white/85 text-ink shadow-md backdrop-blur-md transition active:scale-95 ${className}`}
    >
      <ChevronLeft className="h-5 w-5" />
    </button>
  );
}
