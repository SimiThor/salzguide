import { useTranslations } from "next-intl";
import { PARTNERS, partner, type PartnerKey } from "@/lib/partners";
import { EXTERNAL_LINK_ATTRS } from "@/lib/social";

// Der Copyright-Satz zu den Spot-Fotos/-Videos plus die vier Partner-Logos. EIN Bauteil
// für alle Stellen: den LegalFooter (jede normale Seite) und die Panels der
// Vollbild-Karten (Explore, Wasser, Touren), wo der LegalFooter bewusst nicht rendert.
// Warum es die Nennung gibt und warum sie Pflicht ist: lib/partners.ts.
//
// Bewusst OHNE "use client" (dasselbe Muster wie SocialLinks): kein Zustand, keine
// Events — ein Absatz und vier <a>.
//
// Optik: leiser als der Inhalt (Fussnoten-Ton). Die Logos stehen klein, per opacity
// gedämpft und werden erst unterm Zeiger voll. Gedämpft, nicht verfremdet: Die Logos
// bleiben im Original (kein Grau-Filter, keine Umfärbung) — fremde Marken werden nicht
// angefasst, nur zurückhaltend gezeigt.

export default function PartnerCredits({ className = "" }: { className?: string }) {
  const t = useTranslations("Legal");

  // Die Verbands-Namen im Satz verlinken auf dieselben Ziele wie ihre Logos darunter.
  const nameLink = (key: PartnerKey) =>
    function NameLink(chunks: React.ReactNode) {
      return (
        <a
          href={partner(key).url}
          {...EXTERNAL_LINK_ATTRS}
          className="underline decoration-muted/40 underline-offset-2 transition-colors hover:text-ink"
        >
          {chunks}
        </a>
      );
    };

  return (
    <div className={`text-center ${className}`}>
      <p className="mx-auto max-w-[440px] text-[11px] leading-relaxed text-muted/80">
        {t.rich("partnerCredit", {
          slt: nameLink("salzburgerland"),
          gastein: nameLink("gastein"),
        })}
      </p>
      {/* max-w am Handy: Alle vier passen dort nicht in eine Zeile, und der freie
          Umbruch liesse das letzte Logo allein unter dreien hängen. So bricht die
          Reihe ausgewogen 2+2 — oben die beiden Verbände, unten die beiden Firmen. */}
      <div className="mx-auto mt-4 flex max-w-[240px] flex-wrap items-center justify-center gap-x-7 gap-y-3 sm:max-w-none">
        {PARTNERS.map((p) => (
          <a
            key={p.key}
            href={p.url}
            {...EXTERNAL_LINK_ATTRS}
            // sg-hit: 44pt Trefferfläche um die kleinen Logos (globals.css). Der Link
            // erbt seinen zugänglichen Namen vom alt-Text des Bilds.
            // sg-own-layer: eigene Ebene fürs Ein-/Ausblenden. In den Panels der
            // Vollbild-Karten steht diese Reihe in einer Fläche mit `backdrop-filter`, und
            // dort blieb in Safari nach dem Hover das helle Logo stehen, obwohl der Stil
            // längst wieder gedämpft war. Begründung in globals.css.
            className="sg-hit sg-own-layer flex items-center opacity-70 transition-opacity hover:opacity-100"
          >
            {/* Bewusst <img>, nicht next/image: Die Dateien sind schon in Zielgrösse
                und Zielformat (SVG/WebP, zusammen ~40 KB); der Optimierer hätte hier
                nichts zu tun. Explizite Masse + feste Anzeigehöhe = kein Springen. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.logo}
              alt={p.name}
              width={p.width}
              height={p.height}
              loading="lazy"
              decoding="async"
              style={{ height: p.displayHeight, width: "auto" }}
            />
          </a>
        ))}
      </div>
    </div>
  );
}
