"use client";

import Image from "next/image";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import type { ExploreSpot } from "@/lib/spots";
import { toggleSaved } from "@/lib/saved-actions";
import { Bookmark, BookmarkFilled } from "./icons";

function X() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// Desktop-Spot-Karte (kein Bottom-Sheet): schwebt oben im Kartenbereich, kein Backdrop.
export default function SpotCardDesktop({
  spot,
  onClose,
  loggedIn = false,
  saved = false,
  onSavedChange,
}: {
  spot: ExploreSpot;
  onClose: () => void;
  loggedIn?: boolean;
  saved?: boolean; // controlled durch Explore (Quelle der Wahrheit)
  onSavedChange?: (slug: string, saved: boolean) => void;
}) {
  const t = useTranslations("Explore");
  const router = useRouter();
  const [, startTransition] = useTransition();

  function onSave() {
    if (!loggedIn) {
      router.push("/profil");
      return;
    }
    const next = !saved;
    // Optimistisch: Explore aktualisiert die Quelle der Wahrheit -> Icon flippt sofort.
    onSavedChange?.(spot.slug, next);
    startTransition(async () => {
      const r = await toggleSaved(spot.slug);
      if (typeof r.saved === "boolean" && r.saved !== next) {
        onSavedChange?.(spot.slug, r.saved);
      }
      if (r.needLogin) router.push("/profil");
    });
  }

  const btn =
    "flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow backdrop-blur text-ink";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[55] px-4 md:left-[var(--sg-panel)] md:right-0">
      <div className="pointer-events-auto mx-auto w-full max-w-sm overflow-hidden rounded-[20px] bg-white shadow-[0_18px_50px_-12px_rgba(0,0,0,0.4)]">
        <div className="relative">
          {!spot.isPro && spot.imageUrl ? (
            <div className="relative aspect-[16/10] w-full overflow-hidden">
              <Image
                src={spot.imageUrl}
                alt={spot.title}
                fill
                sizes="384px"
                className="object-cover"
              />
            </div>
          ) : (
            <div className="flex aspect-[16/10] w-full items-center justify-center bg-gradient-to-br from-accent/20 to-muted/20">
              <span className="text-5xl" aria-hidden>
                {spot.isPro ? "🤫" : (spot.emoji ?? "📍")}
              </span>
            </div>
          )}
          <div className="absolute right-3 top-3 flex gap-2">
            {!spot.isPro && (
              <button
                type="button"
                onClick={onSave}
                aria-label={t("save")}
                aria-pressed={saved}
                className={btn}
              >
                {saved ? (
                  <BookmarkFilled className="h-[17px] w-[17px] text-accent" />
                ) : (
                  <Bookmark className="h-[17px] w-[17px]" />
                )}
              </button>
            )}
            <button type="button" onClick={onClose} aria-label={t("close")} className={btn}>
              <X />
            </button>
          </div>
        </div>
        <div className="p-4">
          {spot.isPro ? (
            <>
              <h3 className="text-[15px] font-semibold text-ink">{t("lockedTitle")}</h3>
              <p className="mt-1 text-[13px] leading-snug text-muted">{t("proTeaser")}</p>
              <Link
                href="/pro"
                className="mt-3 inline-block rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white active:scale-[0.98]"
              >
                {t("unlock")}
              </Link>
            </>
          ) : (
            <>
              <h3 className="text-[17px] font-semibold text-ink">{spot.title}</h3>
              {spot.shortDesc && (
                <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">
                  {spot.shortDesc}
                </p>
              )}
              <Link
                href={`/spot/${spot.slug}`}
                className="mt-3 inline-block rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white active:scale-[0.98]"
              >
                {t("more")}
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
