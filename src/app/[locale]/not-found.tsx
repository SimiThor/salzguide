import { useLocale, useTranslations } from "next-intl";
import { getPathname } from "@/i18n/navigation";

// Die In-App-404 unterhalb von /[locale]. Greift bei `notFound()` einer echten Seite
// (Spot/Tour ohne Treffer) und über die Catch-all-Route ([...rest]/page.tsx) als
// Sicherheitsnetz. Müll-Adressen fängt davor schon der Proxy ab und schickt sie an
// den 404-Handler (app/404/route.ts) – der liefert den echten 404-Status und trägt
// dieselbe Optik wie diese Datei. Wer hier die Gestaltung ändert, ändert BEIDE.
//
// Kein async, kein Supabase, keine Params: `useTranslations`/`useLocale` funktionieren
// in einer synchronen Server-Komponente, die Sprache kommt aus dem Request-Kontext des
// Layouts. So bleibt die Seite frei von Daten und kippt nichts am statischen Rendering.
//
// Gestaltung wie die Fehlerseite (error.tsx), nur verspielter: Wer hier landet, hat nichts
// kaputt gemacht, er ist nur falsch abgebogen. Deshalb Wanderschild-Ton statt Fehler-Ton.

// Gleiche Karten-Schatten wie überall (Spot-Seite, Sheets) -> die zwei Emoji-Kacheln sehen
// aus wie verlegte Foto-Karten aus der App, nicht wie ein neues Gestaltungselement.
const TILE =
  "grid place-items-center rounded-[22px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.28)]";

export default function NotFound() {
  const t = useTranslations("NotFound");
  const locale = useLocale();

  return (
    // min-h-[100svh] statt flex-1 (Fall 2 der Viewport-Regel in globals.css,
    // bildschirmfüllende Fläche im Fluss): Seit der Footer mit in AppChromes <main>
    // wohnt, hat flex-1 nichts mehr zum Füllen – der 404-Inhalt blieb inhaltshoch,
    // der Footer rückte in den Viewport und seine letzte Zeile stand hinter der
    // Tab-Leiste (am iPhone-Viewport nachgemessen, 955px Dokument auf 844px Fenster).
    // Mit voller Viewport-Höhe ist der Inhalt echt mittig und der Footer liegt wie auf
    // den Lade-Gerüsten unter der Falte. pb > pt: Die Tab-Leiste liegt fixed über dem
    // unteren Rand, das Plus unten rückt die optische Mitte hoch.
    <div className="flex min-h-[100svh] flex-col items-center justify-center px-6 pb-24 pt-14 text-center md:pb-16">
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

      {/* Bewusst <a> statt next-intl <Link>: Diese Seite kommt aus einer ABGERISSENEN
          Streaming-Antwort (notFound nach Antwortbeginn), die Hydration ist danach
          kaputt (React #419) und eine Client-Navigation von hier kippte in die
          Fehlerseite. Ein harter Seitenwechsel kann nicht kippen – und schneller
          als die Startseite frisch zu laden muss eine 404 nichts sein. Das Ziel
          baut getPathname aus der zentralen Routing-Config (kein handgebautes
          `/${locale}`, das bei einem localePrefix-Wechsel still driftete). */}
      <a
        href={getPathname({ locale, href: "/" })}
        className="sg-hit mt-7 rounded-full bg-accent px-6 py-3.5 text-[15px] font-semibold text-white shadow-[0_10px_24px_-10px_rgba(204,41,36,0.55)] transition active:scale-[0.98]"
      >
        {t("home")}
      </a>
    </div>
  );
}
