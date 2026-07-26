"use client";

import { useTranslations } from "next-intl";
import { ProWordmark } from "@/components/ProBadge";
import ProFeatureList from "@/components/ProFeatureList";
import ProPurchase from "@/components/ProPurchase";

// Pro-Karte auf /profil (eingeloggter Nutzer). Dieselbe Design-Familie wie die Seite /pro,
// nur kompakter, und seit dem Umbau auch derselbe Kaufblock: Preis, §-18-Häkchen, Knopf und
// Kleingedrucktes kommen aus ProPurchase. Vorher stand hier eine eigene Kopie, und der
// fehlte der Hinweis auf AGB und Widerrufsbelehrung — an einer Fläche, an der man kaufen
// kann, ist das keine Kleinigkeit.
export default function ProUpgrade({ price }: { price: string }) {
  const t = useTranslations("Pro");

  return (
    <div className="overflow-hidden rounded-[28px] bg-gradient-to-b from-accent/[0.12] via-white to-white shadow-[0_24px_60px_-28px_rgba(204,41,36,0.45)] ring-1 ring-black/[0.05]">
      {/* Kopf: Wortmarke und darunter dieselbe Überschrift wie auf /pro, nur kleiner.
          Hier stand „Ohne Pro bleibt dieser Teil der Karte zu." (Pro.subtitle). Der Satz
          sitzt richtig im Karten-Sheet, wo man gerade einen gesperrten Spot angetippt hat
          und die Karte hinter dem Sheet liegt. Auf dem Profil zeigt „dieser Teil der Karte"
          auf nichts: Da ist keine Karte, der Mensch schaut auf sein Konto. Deshalb trägt
          diese Karte jetzt den Satz, der überall funktioniert, weil er das Produkt selbst
          benennt statt den Ort, an dem man gerade steht. */}
      <div className="px-6 pt-6 text-center">
        <ProWordmark name={t("title")} className="text-[14px]" />
        <h2 className="mx-auto mt-3 max-w-[17rem] text-[19px] font-bold leading-[1.2] tracking-tight text-ink">
          {t("heroTitle")}
        </h2>
      </div>

      {/* Dieselben vier Zeilen wie überall (ProFeatureList). */}
      <div className="mt-5 border-t border-black/[0.06] px-5 py-3">
        <ProFeatureList density="page" />
      </div>

      <ProPurchase price={price} className="border-t border-black/[0.06] px-6 pt-5 pb-7" />
    </div>
  );
}
