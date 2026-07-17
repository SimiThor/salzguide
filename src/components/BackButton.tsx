"use client";

import { useRouter } from "@/i18n/navigation";
import { ChevronLeft } from "@/components/icons";

// Einheitlicher Zurück-Button (Stil wie auf den Spot-Unterseiten): rundes
// ChevronLeft-Icon. Geht auf die Seite davor (Browser-Historie); gibt es keine
// (Direktaufruf/geteilter Link), fällt er auf `fallbackHref` zurück -> robust,
// verlässt nie versehentlich die App. Positionierung via className (z.B. absolut
// über einem Hero, sonst in-flow oben links).
export default function BackButton({
  fallbackHref = "/explore",
  label = "Zurück",
  className = "",
}: {
  fallbackHref?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  }
  return (
    <button
      type="button"
      onClick={goBack}
      aria-label={label}
      className={`flex h-10 w-10 items-center justify-center rounded-full bg-white/85 text-ink shadow-md backdrop-blur-md transition active:scale-95 ${className}`}
    >
      <ChevronLeft className="h-5 w-5" />
    </button>
  );
}
