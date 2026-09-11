"use client";

import { useTranslations } from "next-intl";
import { ProWordmark } from "@/components/ProBadge";
import ProFeatureList from "@/components/ProFeatureList";
import ProPurchase from "@/components/ProPurchase";
import ProShowcase, { type ProShowcaseData } from "@/components/ProShowcase";

// Conversion-Landing für den Pro-Kauf (mobile-first, iOS-2026).
//
// ZWEI TIPPER ZUM ZIEL: Häkchen, Kauf-Knopf — dann ist man bei Stripe, wo Apple/Google Pay
// ein Tap sind. Kein Konto davor. Die E-Mail sammelt Stripe im Checkout ohnehin als
// Pflichtfeld ein, das Konto entsteht danach daraus (siehe lib/pro-purchase.ts).
//
// Die Seite besteht aus vier Blöcken: was dir ohne Pro entgeht, was drin ist (in Bildern und
// Zahlen, dann in Worten), was es kostet. Der letzte ist der gemeinsame Kaufblock
// (ProPurchase), den auch die Karte auf /profil benutzt — dort hing vorher eine zweite
// Kopie, der der Hinweis auf AGB und Widerrufsbelehrung fehlte.

export default function ProLanding({
  price,
  canceled,
  showcase,
}: {
  price: string;
  canceled: boolean;
  /** Motive und Zahlen (lib/pro-showcase.ts). null = Block fehlt, die Seite bleibt wie früher. */
  showcase: ProShowcaseData | null;
}) {
  const t = useTranslations("Pro");

  // Die Zeilen, überall dieselben (ProFeatureList). EINMAL gebaut, weil sie je nach Lage an
  // zwei Stellen stehen können (siehe Block 2 und 4 unten), nie an beiden.
  const features = (
    <div className="border-t border-black/[0.06] px-6 py-3">
      <ProFeatureList density="page" />
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[440px] px-4 pt-[var(--sg-page-top)] md:pt-8">
      {canceled && (
        <div className="mb-4 rounded-[18px] bg-black/[0.04] p-4 text-center">
          <p className="text-[15px] font-semibold text-ink">{t("canceledTitle")}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{t("canceledBody")}</p>
        </div>
      )}

      {/* EINE zusammenhängende Fläche mit klar getrennten Blöcken: was dir fehlt, was du
          bekommst, was es kostet, und warum es taugt. Getrennt durch Haarlinien statt durch Kacheln —
          gestapelte Kärtchen wären vier Flächen für eine Aussage (iOS macht das in
          gruppierten Listen genauso). */}
      <div className="overflow-hidden rounded-[28px] bg-gradient-to-b from-accent/[0.12] via-white to-white shadow-[0_24px_60px_-28px_rgba(204,41,36,0.45)] ring-1 ring-black/[0.05]">
        {/* 1. Was dir ohne Pro entgeht. Wortmarke klein darüber, Überschrift sagt die
            Sache selbst, und dann ist Schluss: Der erklärende Satz darunter ist weg. Er
            sagte, was die vier Zeilen gleich darunter ohnehin sagen, nur in Prosa. Weniger
            Text heisst hier auch, dass der Kauf-Knopf höher steht. */}
        <div className="px-7 pt-7 pb-6 text-center">
          <ProWordmark name={t("title")} className="text-[14px]" />
          <h1 className="mt-3 text-[27px] font-bold leading-[1.12] tracking-tight text-ink">
            {t("heroTitle")}
          </h1>
        </div>

        {/* 2. Was drin ist, konkret: verschwommene Motive und die echten Zahlen. Ein Bild
            und eine Zahl überzeugen schneller als ein Satz. Fehlen sie (Abfrage gescheitert),
            übernehmen die Zeilen diese Rolle an ihrem alten Platz vor dem Preis. */}
        {showcase ? <ProShowcase data={showcase} /> : features}

        {/* 3. Was es kostet. Preis, Zustimmung, Knopf und Kleingedrucktes kommen aus dem
            gemeinsamen Kaufblock (ProPurchase) — dieselbe Strecke wie in der Karte auf
            /profil, damit an beiden Kaufflächen dasselbe steht. */}
        <ProPurchase price={price} className="border-t border-black/[0.06] px-7 pt-5 pb-8" />

        {/* 4. Was drin ist, in Worten. UNTER dem Kaufblock, sobald die Motive darüber
            stehen. Die Regel seit 09/2026: Der Kauf-Knopf steht nicht tiefer als vor den
            Motiven, in keiner der 13 Sprachen (mit Motiven UND Zeilen über dem Preis rutschte
            er am iPhone 15 hinter die Tab-Leiste). Oben zeigen die Bilder, WAS drin ist; hier
            steht für alle, die weiterlesen, WARUM es etwas taugt. Ohne Motive stehen die
            Zeilen oben in Block 2 und hier nicht. */}
        {showcase && features}
      </div>
    </div>
  );
}
