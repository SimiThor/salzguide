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
//  DIESER KNOPF IST DER EINZIGE. Auch im Admin.
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
// Ein „← Zurück" im Blätterwerk (Seite 2 von 5) ist etwas anderes und bleibt Text: Das ist
// keine Rückkehr, sondern eine Richtung, und es hat sein Gegenstück in „Weiter →".
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
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
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
