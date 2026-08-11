"use client";

import { Link } from "@/i18n/navigation";
import AiSparkle from "./ai/AiSparkle";
import { useAi } from "./ai/AiProvider";
import { CTA_PRIMARY } from "./landing/cta";

// Abschluss von „Gut zu wissen": der Weg weiter, wenn die Seite eine Frage nicht
// beantwortet hat. Zwei Wege, kein dritter — Toni für alles Persönliche, die Karte für
// alles Örtliche.
//
// Das ist die EINZIGE Client-Komponente dieser Seite. Sie muss es sein, weil der
// Toni-Knopf das Chat-Sheet öffnet (useAi), und sie darf es sein, weil hier kein Inhalt
// steht, den eine Suchmaschine lesen müsste. Alles darüber bleibt Server-HTML.
export default function TravelInfoOutro({
  title,
  body,
  ai,
  cta,
}: {
  title: string;
  body: string;
  ai: string;
  cta: string;
}) {
  const { open } = useAi();

  return (
    <section className="mt-14 md:mt-20">
      <div className="mx-auto overflow-hidden rounded-[30px] bg-gradient-to-b from-white to-accent/[0.07] px-6 py-10 text-center ring-1 ring-black/[0.05] md:py-12">
        <h2 className="text-[24px] font-bold leading-tight tracking-tight text-ink md:text-[30px]">
          {title}
        </h2>
        <p className="mx-auto mt-3 max-w-[36ch] text-balance text-[15px] leading-relaxed text-muted">
          {body}
        </p>

        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {/* Toni trägt das gebrandete Sparkle-Symbol, nie ein Emoji, und der Knopf ist
              NICHT rot: Rot heisst in dieser App „aktive Seite". Deshalb hier der helle
              Knopf mit Verlaufs-Sparkle und daneben der rote Weg zur Karte. */}
          <button
            type="button"
            onClick={open}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-white px-5 py-4 text-[16px] font-semibold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_30px_-24px_rgba(0,0,0,0.5)] transition active:scale-[0.98]"
          >
            <AiSparkle gradient className="h-[18px] w-[18px]" />
            {ai}
          </button>
          <Link href="/explore" className={CTA_PRIMARY}>
            {cta}
          </Link>
        </div>
      </div>
    </section>
  );
}
