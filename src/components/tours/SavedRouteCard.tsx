"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { BookmarkFilled } from "@/components/icons";
import type { UserTourSummary } from "@/lib/user-tours";

// Eine gespeicherte User-Runde als Kachel. Entfernen = EIN Tipp auf das gefüllte
// Lesezeichen (identisch zum Merken/Entfernen von Spots & Events) — kein Papierkorb,
// kein Bestätigen. Das Ausblenden/Server-Löschen macht die Liste (SavedRoutesList).
export default function SavedRouteCard({
  route,
  onRemove,
}: {
  route: UserTourSummary;
  onRemove: () => void;
}) {
  const t = useTranslations("Tours");

  const meta = [
    t("stops", { count: route.stopCount }),
    route.durationMin != null ? t("minutes", { count: route.durationMin }) : null,
    route.distanceKm != null ? `${route.distanceKm} km` : null,
  ].filter(Boolean);

  return (
    <div className="flex items-center gap-3 rounded-[16px] bg-white p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.28)]">
      <Link href={`/touren/meine/${route.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/10 text-2xl">
          {route.emoji ?? "🎧"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-bold text-ink">{route.name}</span>
          <span className="block truncate text-[12px] text-muted">
            {route.areaName ? `${route.areaName} · ` : ""}
            {meta.join(" · ")}
          </span>
        </span>
      </Link>

      <button
        type="button"
        onClick={onRemove}
        aria-label={t("deleteRoute")}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition active:scale-90 active:bg-black/5"
      >
        <BookmarkFilled className="h-[18px] w-[18px] text-accent" />
      </button>
    </div>
  );
}
