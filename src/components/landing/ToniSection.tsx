import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import ToniAvatar from "@/components/ai/ToniAvatar";
import { CTA_PRIMARY } from "./cta";
import { LANDING_CONTAINER } from "./layout";

// Toni, der KI-Local. Auf der Startseite als eigene Section statt als schwebende Blase
// (die ist hier bewusst aus, siehe lib/routes.ts): hier ist er das Argument, nicht Chrome.
//
// Nur belegbare Aussagen. Hier stand mal „Dann nennt er dir einen Platz. Nicht zehn."
// Klang gut, war aber falsch: ai-assistant.ts:269 sagt „Wähle ehrlich die BESTEN 1-3
// Treffer". Es sind also nicht genau einer, und der Nutzen ist ohnehin die Passung, nicht
// die Anzahl. Wer eine Zahl in den Text schreibt, muss sie im Prompt nachlesen.
// Toni heisst nutzersichtbar Toni, nicht Anton, wie ältere Docs behaupten.
export default async function ToniSection({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "Home" });

  return (
    <section className="py-16 md:py-24">
      <div className={LANDING_CONTAINER}>
        <div className="mx-auto max-w-[900px] overflow-hidden rounded-[28px] bg-gradient-to-b from-accent/[0.10] via-white to-white p-8 shadow-[0_24px_60px_-28px_rgba(204,41,36,0.45)] ring-1 ring-black/[0.05] md:p-12">
          <div className="flex flex-col items-center gap-8 md:flex-row md:gap-12">
            {/* ToniAvatar nimmt eine Pixel-Zahl, keine Klassen — das Bild kommt aus den
                Admin-Einstellungen (app_settings), ist also schon pflegbar. */}
            <div className="shrink-0">
              <ToniAvatar size={112} />
            </div>
            <div className="text-center md:text-left">
              <p className="text-[13px] font-semibold uppercase tracking-wider text-accent">
                {t("toniEyebrow")}
              </p>
              <h2 className="mt-2 text-balance text-[26px] font-bold leading-[1.15] tracking-tight text-ink md:text-[34px]">
                {t("toniTitle")}
              </h2>
              <p className="mt-3 text-balance text-[16px] leading-relaxed text-muted md:text-[17px]">
                {t("toniBody")}
              </p>
              <Link
                href="/explore"
                className={`mt-6 inline-block ${CTA_PRIMARY}`}
              >
                {t("toniCta")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
