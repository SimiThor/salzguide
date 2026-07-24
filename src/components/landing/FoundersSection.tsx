import type { HomeTexts } from "@/lib/home-fields";
import type { HomeMedia } from "@/lib/home-content";
import LandingVideo from "./LandingVideo";
import MediaSlot from "./MediaSlot";
import { LANDING_CONTAINER } from "./layout";

// Anton & Simon. Das stärkste Asset der Seite und laut Recherche der zentrale Trust-Hebel:
// Leute zahlen für Tipps von jemandem, dessen Geschmack sie kennen. Zwei echte Gesichter
// schlagen jedes Stockvideo — deshalb stehen sie hier gross und nicht im Impressum.
export default function FoundersSection({
  texts,
  media,
}: {
  texts: HomeTexts;
  media: HomeMedia;
}) {
  return (
    <section className="bg-white/60 py-16 md:py-24">
      <div className={LANDING_CONTAINER}>
        <div className="mx-auto grid max-w-[1000px] items-center gap-10 md:grid-cols-2 md:gap-16">
          {/* Video links am Desktop, oben am Handy */}
          <div className="mx-auto w-full max-w-[380px]">
            <LandingVideo
              video={media.explainerVideo}
              hint="Erklär-/Gründervideo 9:16, max. ~2,5 MB, mit Ton"
              playLabel={texts.videoPlay}
            />
          </div>

          <div className="text-center md:text-left">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-accent">
              {texts.foundersEyebrow}
            </p>
            <h2 className="mt-2 text-balance text-[28px] font-bold leading-[1.15] tracking-tight text-ink md:text-[38px]">
              {texts.foundersTitle}
            </h2>
            <p className="mt-4 text-balance text-[16px] leading-relaxed text-muted md:text-[17px]">
              {texts.foundersBody}
            </p>

            {/* Jeder mit SEINEM Foto. Hier stand `media.founders` für beide, also zweimal
                dasselbe Gesicht neben zwei verschiedenen Namen. Das ist der Grund, warum
                der Slot pro Person existiert und nicht pro Section. */}
            <div className="mt-7 space-y-4">
              {(["anton", "simon"] as const).map((who) => (
                <div key={who} className="flex items-start gap-4 text-left">
                  <div className="h-12 w-12 shrink-0 transform-gpu isolate overflow-hidden rounded-full">
                    <MediaSlot
                      image={media[`${who}Photo`]}
                      hint=""
                      sizes="48px"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div>
                    <p className="text-[15px] font-semibold text-ink">{texts[`${who}Name`]}</p>
                    <p className="mt-0.5 text-[14px] leading-relaxed text-muted">
                      {texts[`${who}Body`]}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
