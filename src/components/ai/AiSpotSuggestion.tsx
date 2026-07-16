"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import SpotCard from "@/components/SpotCard";
import { toggleSaved } from "@/lib/saved-actions";
import { Bookmark, BookmarkFilled } from "@/components/icons";
import type { AiSpotCard } from "@/lib/ai-types";

// Ein von Toni vorgeschlagener Spot: Karte (verlinkt zur Detailseite) + Speichern-
// Button oben rechts (iOS-Stil, wie bei Events). Der Button fängt den Klick ab,
// damit man nicht zur Detailseite navigiert. Der Merk-Status kommt vom Chat
// (echter Zustand) und wird bei Änderung nach oben gemeldet -> überlebt Wieder-Öffnen.
export default function AiSpotSuggestion({
  spot,
  loggedIn,
  onNavigate,
  saved: initialSaved = false,
  onSavedChange,
}: {
  spot: AiSpotCard;
  loggedIn: boolean;
  onNavigate?: () => void;
  saved?: boolean;
  onSavedChange?: (saved: boolean) => void;
}) {
  const t = useTranslations("Explore");
  const router = useRouter();
  const [saved, setSaved] = useState(initialSaved);
  const [prevInitial, setPrevInitial] = useState(initialSaved);
  const [busy, start] = useTransition();

  // Merk-Status übernehmen, wenn sich der Prop ändert (React-Muster „State beim
  // Rendern anpassen" statt Effekt) -> greift nur bei echter Wertänderung.
  if (initialSaved !== prevInitial) {
    setPrevInitial(initialSaved);
    setSaved(initialSaved);
  }

  function onSave(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!loggedIn) {
      onNavigate?.();
      router.push("/profil");
      return;
    }
    const next = !saved;
    setSaved(next); // optimistisch
    onSavedChange?.(next);
    start(async () => {
      const r = await toggleSaved(spot.slug);
      if (r.needLogin) {
        onNavigate?.();
        router.push("/profil");
        return;
      }
      if (typeof r.saved === "boolean" && r.saved !== next) {
        setSaved(r.saved);
        onSavedChange?.(r.saved);
      }
    });
  }

  return (
    <Link
      href={`/spot/${spot.slug}`}
      onClick={onNavigate}
      className="relative block active:opacity-80"
    >
      <SpotCard
        title={spot.title}
        shortDesc={spot.shortDesc}
        emoji={spot.emoji}
        imageUrl={spot.imageUrl}
        sizeClassName="w-[210px]"
      />
      <button
        type="button"
        onClick={onSave}
        disabled={busy}
        aria-label={saved ? t("saved") : t("save")}
        aria-pressed={saved}
        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-md transition active:scale-90"
      >
        {saved ? (
          <BookmarkFilled className="h-[17px] w-[17px] text-white" />
        ) : (
          <Bookmark className="h-[17px] w-[17px]" />
        )}
      </button>
    </Link>
  );
}
