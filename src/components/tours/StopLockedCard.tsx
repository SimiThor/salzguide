"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

// Pro-Hinweis für einen gesperrten Stopp – aus TourView.tsx herausgezogen (stand dort
// inline im Peek-Anker), damit ArrivalSheet.tsx (S-Bike-Navigation) dieselbe Kauf-
// Oberfläche zeigt statt einer zweiten Kopie derselben, kaufkritischen Fläche.
export default function StopLockedCard({ freeStops, total }: { freeStops: number; total: number }) {
  const t = useTranslations("Tours");
  const tPro = useTranslations("Pro");
  return (
    <div className="rounded-[16px] bg-white/85 p-4 shadow-sm ring-1 ring-black/[0.04]">
      <p className="text-[14px] font-semibold text-ink">🔒 {t("lockedTitle")}</p>
      <p className="mt-1 text-[13px] leading-snug text-muted">
        {t("lockedFree", { free: freeStops, total })}
      </p>
      <Link
        href="/pro"
        className="mt-3 flex items-center justify-center rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98]"
      >
        {tPro("cta")}
      </Link>
    </div>
  );
}
