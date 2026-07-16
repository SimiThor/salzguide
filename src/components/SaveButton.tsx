"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { toggleSaved } from "@/lib/saved-actions";
import { Bookmark, BookmarkFilled } from "./icons";

// Speichern-Button im Hero (docs/30). Speichert echt in die Merkliste (Auftrag G).
// Nicht eingeloggt -> zum Login (Profil).
export default function SaveButton({
  label,
  slug,
  initialSaved = false,
  loggedIn = false,
}: {
  label: string;
  slug: string;
  initialSaved?: boolean;
  loggedIn?: boolean;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    if (!loggedIn) {
      router.push("/profil");
      return;
    }
    setSaved((s) => !s); // optimistisch
    startTransition(async () => {
      const r = await toggleSaved(slug);
      if (typeof r.saved === "boolean") setSaved(r.saved);
      if (r.needLogin) router.push("/profil");
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={saved}
      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/85 text-ink shadow-md backdrop-blur-md transition-transform active:scale-95"
    >
      {saved ? (
        <BookmarkFilled className="h-[18px] w-[18px] text-accent" />
      ) : (
        <Bookmark className="h-[18px] w-[18px]" />
      )}
    </button>
  );
}
