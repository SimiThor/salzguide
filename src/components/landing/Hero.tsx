import { Link } from "@/i18n/navigation";
import type { HomeTexts } from "@/lib/home-fields";
import type { HomeMedia } from "@/lib/home-content";
import HeroImage from "./HeroImage";
import AiImageBadge from "@/components/AiImageBadge";
import { CTA_PRIMARY } from "./cta";
import { LANDING_CONTAINER } from "./layout";

// Hero: EIN Gedanke, ein Weg nach vorn. Kein Feature-Gewitter über der Falz — wer hier
// landet, soll in drei Sekunden wissen, was das ist und wo es weitergeht.
//
// Zwei Bilder statt eines: mobil Hochformat (die Mehrheit kommt übers iPhone), am Desktop
// Querformat. Ein zugeschnittenes Querformat-Bild auf dem Handy wäre entweder winzig oder
// beschnitten — beides kostet genau die Wirkung, für die das Bild da ist.
export default function Hero({ texts, media }: { texts: HomeTexts; media: HomeMedia }) {
  return (
    // min-h-viewport (= var(--sg-vh) = 100svh), NICHT min-h-dvh: Der Hero ist das erste
    // Element im Dokumentfluss, alles andere hängt an seiner Unterkante. Mit dvh wächst
    // er genau dann, wenn Safari beim Scrollen seine Leisten einfährt – der Inhalt
    // darunter rutscht einem mitten in der Bewegung weg, und durch justify-end wandert
    // sogar der Hero-Text selbst mit. svh ist der Bildschirm mit ausgefahrenen Leisten
    // und damit konstant. Siehe globals.css, Abschnitt "VIEWPORT-HÖHE".
    <section className="relative flex min-h-viewport flex-col justify-end overflow-hidden">
      {/* Bild-Ebene. Das Umschalten Hoch-/Querformat sitzt auf WRAPPERN, nicht auf dem
          MediaSlot selbst: eine durchgereichte `md:block`-Klasse würde sonst das `grid`
          des Platzhalters überschreiben und sein `place-items-center` wirkungslos machen.
          (Genau das war der Fall — nur fällt es auf, solange der Platzhalter sichtbar ist.) */}
      <div className="absolute inset-0 -z-10">
        {/* EIN Bild, zwei Zuschnitte: Die Auswahl fällt in <picture>, also VOR dem Laden.
            Vorher standen hier zwei versteckte/sichtbare <Image> mit je `priority` — CSS
            versteckte eines, geladen wurden beide (nachgemessen 128 KB + 55 KB). */}
        <HeroImage
          portrait={media.heroPortrait}
          landscape={media.heroLandscape}
          className="h-full w-full object-cover"
        />
        {/* Verlauf, damit die Schrift auf JEDEM Bild lesbar bleibt — auch auf einem hellen
            Himmel. Ohne den hängt die Lesbarkeit am Motiv, und das nächste Bild kippt sie. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/30" />
      </div>

      {/* KI-Label je Bild-VARIANTE (Art. 50 KI-VO, freiwillig; Entscheidung Anton
          03.08.2026, Einstufung docs/39 §5): Das Querformat ist an den Rändern mit KI
          verbreitert, das Hochformat ist das echte Foto. <picture> wählt bei md
          (LANDSCAPE_FROM in HeroImage.tsx) — die Sichtbarkeit der Labels folgt EXAKT
          derselben Grenze, sonst stünde das Label am falschen Bild. Sitzt AUSSERHALB
          der -z-10-Bildebene, sonst läge es unter dem Verlauf. */}
      {media.heroLandscape?.aiOrigin && (
        <AiImageBadge
          origin={media.heroLandscape.aiOrigin}
          className="absolute bottom-3 right-3 z-10 hidden md:inline-flex"
        />
      )}
      {media.heroPortrait?.aiOrigin && (
        <AiImageBadge
          origin={media.heroPortrait.aiOrigin}
          className="absolute bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] right-3 z-10 inline-flex md:hidden"
        />
      )}

      <div className={`${LANDING_CONTAINER} pb-[calc(env(safe-area-inset-bottom)+3.5rem)] text-center md:pb-24`}>
        <h1 className="mx-auto max-w-[15ch] text-balance text-[40px] font-bold leading-[1.05] tracking-tight text-white drop-shadow-md md:text-[68px]">
          {texts.heroTitle}
        </h1>
        <p className="mx-auto mt-4 max-w-[32ch] text-balance text-[17px] leading-relaxed text-white/90 drop-shadow md:mt-5 md:text-[21px]">
          {texts.heroSubtitle}
        </p>

        {/* EIN Weg nach vorn. Hier stand mal ein zweiter Knopf („Was drinsteht"), der auf
            einen Erklär-Abschnitt sprang. Ein Knopf, der „erklär's mir erst" anbietet, auf
            einer Seite, deren ganzes Versprechen Schnelligkeit ist, arbeitet gegen sie. */}
        <div className="mt-8 flex flex-col items-center gap-3 md:mt-10">
          <Link
            href="/explore"
            className={`w-full max-w-[320px] text-center md:w-auto md:px-8 ${CTA_PRIMARY}`}
          >
            {texts.heroCta}
          </Link>
        </div>
      </div>
    </section>
  );
}
