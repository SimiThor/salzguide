"use client";

import { useState } from "react";
import BottomSheet from "./BottomSheet";

// Kleiner Client-Wrapper: Button öffnet das BottomSheet (Demo).
export default function SheetDemo({
  buttonLabel,
  sheetTitle,
  sheetBody,
}: {
  buttonLabel: string;
  sheetTitle: string;
  sheetBody: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white shadow-sm active:scale-[0.98]"
      >
        {buttonLabel}
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title={sheetTitle}>
        <p className="text-[15px] leading-relaxed text-muted">{sheetBody}</p>
        <div className="mt-4 space-y-3">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div
              key={n}
              className="rounded-card bg-white/70 px-4 py-3 text-sm text-ink shadow-sm"
            >
              Beispiel-Inhalt {n}
            </div>
          ))}
        </div>
      </BottomSheet>
    </>
  );
}
