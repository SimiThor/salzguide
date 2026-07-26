import { useTranslations } from "next-intl";
import type { HomeTexts } from "@/lib/home-fields";
import { socialProfile, EXTERNAL_LINK_ATTRS, type SocialPost } from "@/lib/social";
import SmoothImage from "@/components/SmoothImage";
import Carousel from "@/components/Carousel";
import { Play } from "@/components/icons";
import { LANDING_CONTAINER_BLEED, LANDING_SECTION_Y } from "./layout";

// Unsere neuesten Instagram-Beiträge. Steht auf der Startseite (nach Pro, vor dem
// Schluss-CTA) und unter „Über uns" — EIN Bauteil, zwei Orte, dieselbe Quelle.
//
// WAS SIE BEWEISEN SOLL: Die ganze Startseite trägt eine Aussage, „Anton war an jedem Platz
// selbst". Ein Feed, in dem jede Woche neue Plätze auftauchen, ist der einzige Beleg dafür,
// den man nicht behaupten muss. Deshalb Bilder und sonst nichts.
//
// KEINE BILDTEXTE, KEINE LIKES, KEINE ZÄHLER:
// Eine Kachelreihe mit drei Zahlen pro Bild ist ein Dashboard, kein Feed. Wer den Text lesen
// will, tippt drauf und ist auf Instagram. Die Bildbeschreibung aus dem Admin dient nur als
// Ersatztext für Screenreader (siehe unten).
//
// KEIN INSTAGRAM-EMBED: Die Bilder liegen in unserem eigenen Speicher (Admin -> Einstellungen).
// Für den Browser ist diese Section ein Bilder-Karussell wie jedes andere: kein fremdes
// Skript, kein Cookie, kein Einwilligungs-Banner. Das ist der ganze Grund für den Aufbau.
export default function SocialSection({
  texts,
  posts,
  padClass = "px-6",
  scrollPadClass = "scroll-px-6",
  yClass = LANDING_SECTION_Y,
}: {
  texts: HomeTexts;
  posts: SocialPost[];
  /**
   * Seitlicher Rand von Überschrift und Kachel-Schiene. Standard ist der Rand der
   * Startseite (px-6, siehe layout.ts).
   *
   * WARUM DAS EIN PROP IST: Die Über-uns-Seite läuft auf px-5 (md:px-8). Mit dem festen
   * px-6 stand die Überschrift dieser Section dort 4px weiter aussen als der Text darüber
   * und am Desktop 8px weiter innen. Nachgemessen, nicht geschätzt. Genau diesen Versatz
   * beschreibt layout.ts als den Unterschied zwischen entworfen und zusammengetragen.
   * `scrollPadClass` MUSS dazu passen, daran richtet sich der Schnapp-Punkt aus.
   */
  padClass?: string;
  scrollPadClass?: string;
  /**
   * Senkrechter Abstand. Standard ist der Takt der Startseite (LANDING_SECTION_Y).
   *
   * Die Über-uns-Seite hat ihren eigenen, engeren Takt (mt-20 md:mt-28 zwischen den
   * Blöcken) und setzt deshalb "py-0": Dort bringen die Nachbarn den Abstand mit. Mit dem
   * Startseiten-Takt stand unter den Kacheln sonst fast doppelt so viel Luft wie zwischen
   * allen anderen Blöcken dieser Seite.
   */
  yClass?: string;
}) {
  const t = useTranslations("Social");
  const ig = socialProfile("instagram");

  // Nichts gespiegelt (Zugang fehlt, erster Abgleich noch nicht gelaufen, Konto leer)?
  // Dann blendet sich die Section aus, wie FeaturedSpots ohne Auswahl. Eine Überschrift über
  // einer leeren Reihe wäre schlimmer als keine Section.
  if (posts.length === 0) return null;

  return (
    // data-sg: Griff für die Browser-Proben (skills/verify), wie bei den Sheets. Ohne ihn
    // muss ein Test die Section über „irgendein Abschnitt mit einem Instagram-Link" suchen,
    // und der erste Treffer ist dann die Fusszeile.
    <section data-sg="social" className={yClass}>
      <div className={LANDING_CONTAINER_BLEED}>
        {/* Wie in FeaturedSpots: Die Überschrift trägt den Rand der Seite, das Karussell
            darunter darf bis an den Bildschirmrand anschneiden. */}
        <div className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-3 ${padClass}`}>
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-wider text-accent">
              {texts.socialEyebrow}
            </p>
            {/* Der Handle IST die Überschrift, und er kommt aus lib/social.ts, nicht aus einem
                Textfeld. Zwei Gründe:
                1. Hier stand ein Satz („Schau uns über die Schulter"). Er brach das Muster der
                   Seite, wo jede Überschrift eine knappe Aussage mit Punkt ist, und war für
                   eine Instagram-Reihe eine Erklärung, die niemand braucht: Die Bilder sagen
                   schon, was das ist.
                2. Als Textfeld stünde der Handle zweimal in der App (hier und in social.ts)
                   und beim Umbenennen bliebe eine Stelle stehen. */}
            <h2 className="mt-2 text-[28px] font-bold leading-[1.15] tracking-tight text-ink md:text-[38px]">
              @{ig.handle}
            </h2>
          </div>

          {/* Der Folgen-Knopf ist NICHT der rote Haupt-Knopf der Seite (CTA_PRIMARY). Auf
              dieser Seite gibt es genau einen Weg nach vorn, und der heisst „zur Karte".
              Ein zweites Rot direkt über dem Schluss-CTA würde sich mit ihm um den Blick
              streiten. Deshalb die ruhige Glas-Pille: erkennbar ein Angebot, kein Ruf.
              Nur das Wort, ohne Handle: Der steht jetzt als Überschrift daneben.
              Am Handy sitzt sie unter der Überschrift, am Desktop rechts auf der Grundlinie. */}
          <a
            href={ig.url}
            {...EXTERNAL_LINK_ATTRS}
            className="sg-hit inline-flex min-h-11 items-center rounded-full bg-black/[0.06] px-5 text-[14px] font-semibold text-ink transition hover:bg-black/[0.1] active:scale-[0.98]"
          >
            {texts.socialCta}
          </a>
        </div>

        <div className="mt-7">
          {/* Dasselbe Karussell wie bei den Spots: natives Wischen am Handy, Ziehen und
              Glas-Pfeile am Desktop, versteckte Scrollleiste. Kein zweites Layout fürs
              Raster: Sechs Kacheln à 182px plus fünf Lücken à 12px sind exakt die 1152px
              Innenbreite des Containers (1200 - 2x24). Am Desktop steht die Reihe damit
              randlos und das Karussell blendet seine Pfeile von selbst aus; am Handy
              schneidet die dritte Kachel an, und genau das ist der Hinweis zum Wischen.
              Ändert sich LANDING_CONTAINER oder gap-3, muss diese Zahl mit. */}
          <Carousel railPadClass={padClass} scrollPadClass={scrollPadClass}>
            {posts.map((p) => (
              <a
                key={p.id}
                href={p.permalink}
                {...EXTERNAL_LINK_ATTRS}
                className="sg-tap-card block w-[44vw] max-w-[190px] shrink-0 snap-start md:w-[182px] md:max-w-none"
              >
                <div className="relative">
                  <SmoothImage
                    src={p.imageUrl}
                    // Die Bildbeschreibung aus dem Admin, sonst der neutrale Satz aus den
                    // Übersetzungen. Leer lassen wäre falsch: Ein Bild-Link ohne Ersatztext
                    // ist für einen Screenreader ein Link ohne Text.
                    alt={p.alt || t("postAlt")}
                    sizes="(min-width: 768px) 182px, 44vw"
                    // 4:5 ist Instagrams Hochformat. Was quadratisch oder quer gepostet
                    // wurde, füllt die Kachel mittig (object-cover) — so bleibt die Reihe
                    // ruhig, egal welche Formate im Feed liegen.
                    className="aspect-[4/5] w-full overflow-hidden rounded-[16px] bg-black/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_-20px_rgba(0,0,0,0.45)]"
                  />

                  {/* Reel: Standbild plus Play-Zeichen. Ob es eines ist, verrät der Link
                      (/reel/), das wird beim Anlegen im Admin abgeleitet. Ohne das Zeichen
                      sieht ein Reel-Standbild wie ein misslungenes Foto aus. */}
                  {p.isReel && (
                    <span
                      className="pointer-events-none absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/35 text-white backdrop-blur-md"
                      aria-hidden
                    >
                      <Play className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>
              </a>
            ))}
          </Carousel>
        </div>
      </div>
    </section>
  );
}
