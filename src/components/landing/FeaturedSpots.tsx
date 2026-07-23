import { Link } from "@/i18n/navigation";
import { getFeaturedSpots } from "@/lib/spots";
import type { HomeTexts } from "@/lib/home-fields";
import SpotCard from "@/components/SpotCard";
import Carousel from "@/components/Carousel";
import { CTA_PRIMARY } from "./cta";
import { LANDING_CONTAINER_BLEED } from "./layout";

// Echte Plätze auf der Startseite. Welche, entscheidet der Admin unter
// Einstellungen -> „Spots auf der Startseite" (spots.home_rank).
//
// Warum es diese Section gibt: Vier Persona-Tester haben unabhängig denselben Einwand
// gehabt, „eine Seite über schöne Orte, auf der KEIN EINZIGER Ort zu sehen ist". Ein Foto
// mit Namen überzeugt mehr als jeder Satz darüber, dass wir gute Plätze kennen.
//
// KARUSSELL STATT GRID, und zwar EINES für beide Geräte:
// Hier stand ein Grid, das am iPhone drei Karten untereinander stapelte und damit drei
// Bildschirme frass. Jetzt dieselbe Mechanik wie auf der Entdecken-Karte: natives Scrollen
// am Touch, Drag + Glas-Pfeile am Desktop, Snap.
//
// Kein zweites Grid für den Desktop, obwohl es dort nicht scrollen muss: Das Karussell
// blendet seine Pfeile selbst aus, sobald alles hineinpasst (atStart && atEnd), und sieht
// dann exakt wie eine Reihe aus. Zwei Layouts nebeneinander hiessen dagegen, die Karten
// doppelt ins DOM zu rendern, also jeden Spot-Link zweimal für Screenreader und Crawler.
// Featuret Anton mehr Spots, als nebeneinander passen, scrollt es am Desktop eben auch,
// genau wie auf der Karte.
// featuredEyebrow darf KEINE Anzahl nennen. Hier stand „Drei Beispiele", während der
// Admin bis zu MAX_HOME_FEATURED (6) Spots auswählen darf: Beim vierten Spot hätte die
// Zeile gelogen, ohne dass irgendetwas kaputtgegangen wäre.
export default async function FeaturedSpots({
  texts,
  locale,
}: {
  texts: HomeTexts;
  /** Nur für die Spot-Abfrage: die Spot-Titel kommen weiterhin aus spot_translations. */
  locale: string;
}) {
  const spots = await getFeaturedSpots(locale);

  if (spots.length === 0) return null;

  return (
    <section className="py-14 md:py-20">
      <div className={LANDING_CONTAINER_BLEED}>
        <div className="px-6">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-accent">
            {texts.featuredEyebrow}
          </p>
          <h2 className="mt-2 max-w-[24ch] text-balance text-[28px] font-bold leading-[1.15] tracking-tight text-ink md:text-[38px]">
            {texts.featuredTitle}
          </h2>
        </div>

        {/* railPad/scrollPad auf px-6, damit die erste Karte exakt unter der Überschrift
            beginnt und die letzte am Rand anschneidet („da geht noch was"). Das Anschneiden
            IST der Hinweis zum Wischen, deshalb steht das Karussell ausserhalb des px-6. */}
        <div className="mt-7">
          <Carousel railPadClass="px-6" scrollPadClass="scroll-px-6">
            {spots.map((s) => (
              // Echter Link auf die Spot-Seite: Ein Crawler sieht damit von der Startseite
              // aus in den Katalog, und der Besucher landet dort, wo alles steht.
              // Template-String wie überall sonst (MapCard, SavedSpots, SpotSheet …).
              <Link
                key={s.slug}
                href={`/spot/${s.slug}`}
                className="sg-tap-card block text-left transition-transform duration-200 ease-out active:scale-[0.96] md:hover:-translate-y-1"
              >
                <SpotCard
                  title={s.title}
                  shortDesc={s.shortDesc}
                  emoji={s.emoji}
                  imageUrl={s.imageUrl}
                  previewUrl={s.previewUrl}
                  isPro={s.isPro}
                  locked={s.locked}
                  // Mobil 76vw, dieselbe Breite wie auf der Entdecken-Karte: die nächste
                  // Karte schaut an, und genau das ist der Hinweis zum Wischen.
                  //
                  // Am Desktop 376px, und die Zahl ist NICHT geraten, sondern aus dem
                  // Container abgeleitet: LANDING_CONTAINER ist max-w-[1200px] px-6, also
                  // 1200 - 48 = 1152px Inhalt. Drei Karten mit zwei Lücken à 12px (gap-3
                  // im Karussell): (1152 - 24) / 3 = 376. Damit füllen drei Karten die
                  // Zeile exakt bis zum rechten Rand und fluchten mit der Überschrift.
                  // Vorher standen hier 340px: das liess 108px Loch rechts, und weil das
                  // Karussell seine Pfeile ausblendet sobald alles hineinpasst, sah die
                  // Reihe abgerissen aus statt scrollbar.
                  // Ändert sich der Container oder gap-3, muss diese Zahl mit.
                  sizeClassName="w-[76vw] max-w-[300px] md:w-[376px] md:max-w-none"
                />
              </Link>
            ))}
          </Carousel>
        </div>

        <div className="px-6">
          <Link href="/explore" className={`mt-8 inline-block ${CTA_PRIMARY}`}>
            {texts.featuredCta}
          </Link>
        </div>
      </div>
    </section>
  );
}
