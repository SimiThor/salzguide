import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

// Die 404-Seite für alles unterhalb von /[locale]. Greift bei `notFound()` (Spot/Tour/Event
// ohne Treffer) und über die Catch-all-Route ([...rest]/page.tsx) für jede URL, zu der es
// gar keine Route gibt.
//
// Kein async, kein Supabase, keine Params: `useTranslations` funktioniert in einer
// synchronen Server-Komponente, die Sprache kommt aus dem Request-Kontext des Layouts.
// So bleibt die Seite frei von Daten und kippt nichts am statischen Rendering.
//
// Gestaltung wie die Fehlerseite (error.tsx), nur verspielter: Wer hier landet, hat nichts
// kaputt gemacht, er ist nur falsch abgebogen. Deshalb Wanderschild-Ton statt Fehler-Ton.

// Gleiche Karten-Schatten wie überall (Spot-Seite, Sheets) -> die zwei Emoji-Kacheln sehen
// aus wie verlegte Foto-Karten aus der App, nicht wie ein neues Gestaltungselement.
const TILE =
  "grid place-items-center rounded-[22px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.28)]";

export default function NotFound() {
  const t = useTranslations("NotFound");

  return (
    // flex-1 statt min-h: Die Seite rendert im <main> von AppChrome (flex flex-col) und
    // füllt so genau den Platz zwischen Kopfzeile und Tab-Leiste. pb > pt: Die Tab-Leiste
    // liegt fixed über dem unteren Rand, das Plus unten rückt die optische Mitte hoch.
    <div className="flex flex-1 flex-col items-center justify-center px-6 pb-24 pt-14 text-center md:pb-16">
      {/* Zwei leicht verdrehte Kacheln wie verstreute Karten: der Wanderschuh lugt hinter
          dem Kompass hervor. Rein dekorativ, deshalb aria-hidden. */}
      <div className="relative" aria-hidden>
        <span className={`${TILE} absolute -right-7 -top-3 h-14 w-14 rotate-12 rounded-[16px] text-[26px]`}>
          🥾
        </span>
        <span className={`${TILE} relative h-24 w-24 -rotate-6 text-[46px]`}>🧭</span>
      </div>

      {/* „404" sprachneutral als kleine Kennzeile (gleicher Stil wie die Subtype-Zeile im
          Spot-Hero) — wer den Code sucht, findet ihn, er schreit aber nicht. */}
      <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted/80">
        404
      </p>
      <h1 className="mt-1 text-[24px] font-bold leading-tight text-ink">{t("title")}</h1>
      <p className="mt-2 max-w-[24rem] text-[15px] leading-relaxed text-muted">{t("body")}</p>

      <Link
        href="/"
        className="sg-hit mt-7 rounded-full bg-accent px-6 py-3.5 text-[15px] font-semibold text-white shadow-[0_10px_24px_-10px_rgba(204,41,36,0.55)] transition active:scale-[0.98]"
      >
        {t("home")}
      </Link>
    </div>
  );
}
