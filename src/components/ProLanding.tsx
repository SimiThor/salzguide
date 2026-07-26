"use client";

import { useTranslations } from "next-intl";
import { ProWordmark } from "@/components/ProBadge";
import ProFeatureList from "@/components/ProFeatureList";
import ProPurchase from "@/components/ProPurchase";

// Conversion-Landing für den Pro-Kauf (mobile-first, iOS-2026).
//
// ZWEI TIPPER ZUM ZIEL: Häkchen, Kauf-Knopf — dann ist man bei Stripe, wo Apple/Google Pay
// ein Tap sind. Kein Konto davor. Die E-Mail sammelt Stripe im Checkout ohnehin als
// Pflichtfeld ein, das Konto entsteht danach daraus (siehe lib/pro-purchase.ts).
//
// Die Seite besteht aus drei Blöcken: was dir ohne Pro entgeht, was drin ist, was es kostet.
// Der dritte ist der gemeinsame Kaufblock (ProPurchase), den auch die Karte auf /profil
// benutzt — dort hing vorher eine zweite Kopie, der der Hinweis auf AGB und
// Widerrufsbelehrung fehlte.

export default function ProLanding({
  price,
  canceled,
}: {
  price: string;
  canceled: boolean;
}) {
  const t = useTranslations("Pro");

  return (
    <div className="mx-auto w-full max-w-[440px] px-4 pt-[var(--sg-page-top)] md:pt-8">
      {canceled && (
        <div className="mb-4 rounded-[18px] bg-black/[0.04] p-4 text-center">
          <p className="text-[15px] font-semibold text-ink">{t("canceledTitle")}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{t("canceledBody")}</p>
        </div>
      )}

      {/* EINE zusammenhängende Fläche mit drei klar getrennten Blöcken: was dir fehlt,
          was du bekommst, was es kostet. Getrennt durch Haarlinien statt durch Kacheln —
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

        {/* 2. Was drin ist. Vier Zeilen, überall dieselben (ProFeatureList). */}
        <div className="border-t border-black/[0.06] px-6 py-3">
          <ProFeatureList density="page" />
        </div>

        {/* 3. Was es kostet. Preis, Zustimmung, Knopf und Kleingedrucktes kommen aus dem
            gemeinsamen Kaufblock (ProPurchase) — dieselbe Strecke wie in der Karte auf
            /profil, damit an beiden Kaufflächen dasselbe steht. */}
        <ProPurchase price={price} className="border-t border-black/[0.06] px-7 pt-5 pb-8" />
      </div>
    </div>
  );
}
