"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import ProPurchase from "@/components/ProPurchase";

// Pro-Hinweis für einen gesperrten Stopp, aus TourView.tsx herausgezogen (stand dort inline
// im Peek-Anker), damit ArrivalSheet.tsx (S-Bike-Navigation) dieselbe Kauf-Oberfläche zeigt
// statt einer zweiten Kopie derselben, kaufkritischen Fläche.
//
// WARUM HIER JETZT DER ECHTE KAUFBLOCK STEHT: Vorher war das ein `<Link href="/pro">`. Auf
// einer Tour-Seite ist ein Seitensprung unschön, im FAHRBETRIEB ist er ein Ausfall: Karte,
// Route, Ortung und Wake Lock sind weg, und die Navigation muss am Straßenrand neu gestartet
// werden. Wer bezahlen wollte, verlor dafür seine Fahrt. Mit `price` bleibt der Kauf da, wo
// der Gast ist, und `returnTour` bringt ihn nach Stripe genau hierher zurück.
export default function StopLockedCard({
  freeStops,
  total,
  price,
  returnTour = null,
}: {
  freeStops: number;
  total: number;
  /** Preis aus Stripe, serverseitig geholt. Gesetzt = Kauf an Ort und Stelle. */
  price?: string;
  /** Slug der Runde, in die der Kauf zurückführen soll. Nur der Slug (siehe safeTourSlug). */
  returnTour?: string | null;
}) {
  const t = useTranslations("Tours");
  const tPro = useTranslations("Pro");
  return (
    <div className="overflow-hidden rounded-[16px] bg-white/85 shadow-sm ring-1 ring-black/[0.04]">
      <div className="p-4">
        <p className="text-[14px] font-semibold text-ink">🔒 {t("lockedTitle")}</p>
        <p className="mt-1 text-[13px] leading-snug text-muted">
          {t("lockedFree", { free: freeStops, total })}
        </p>
      </div>
      {price ? (
        <ProPurchase price={price} returnTour={returnTour} className="px-4 pb-4" />
      ) : (
        // Ohne Preis (Stripe nicht erreichbar) bleibt der alte Weg. Besser ein Seitensprung
        // als eine Kauffläche, die keinen Preis nennen kann: § 8 Abs. 1 FAGG verlangt ihn
        // unmittelbar vor der Vertragserklärung.
        <Link
          href="/pro"
          className="m-4 mt-0 flex items-center justify-center rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98]"
        >
          {tPro("cta")}
        </Link>
      )}
    </div>
  );
}
