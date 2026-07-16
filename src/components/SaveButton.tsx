"use client";

import { useState, useTransition } from "react";
import { toggleSaved } from "@/lib/saved-actions";
import { Bookmark, BookmarkFilled } from "./icons";
import { useLoginGate } from "./auth/LoginGate";

// Speichern-Button im Hero (docs/30). Speichert echt in die Merkliste (Auftrag G).
// Ohne Konto -> Login-Gate (erklärt kurz, statt hart auf /profil zu springen).
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
  const gate = useLoginGate();

  function onClick() {
    if (loggedIn) setSaved((s) => !s); // optimistisch
    startTransition(async () => {
      // Die Detailseite steht selbst in der URL – kein eigenes next nötig, das Gate
      // nimmt die aktuelle Adresse und schickt den Nutzer nach dem Login hierher zurück.
      const r = await gate.run({ loggedIn, reason: "saveSpot" }, () => toggleSaved(slug));
      if (r && typeof r.saved === "boolean") setSaved(r.saved);
      if (!r || r.needLogin) setSaved(initialSaved); // optimistischen Flip zurücknehmen
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
