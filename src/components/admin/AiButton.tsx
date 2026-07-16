"use client";

import type { ReactNode } from "react";

// Button mit integriertem „KI arbeitet"-Zustand: dezenter Licht-Schimmer wandert
// über den Button, Label wechselt auf den Lade-Text + pulsierende Punkte
// (iOS-2026-Stil, Text bleibt gut lesbar). So passiert die Animation GENAU dort,
// wo die KI-Aktion gestartet wurde. `className` liefert Farbe/Radius/Padding.
export default function AiButton({
  loading,
  loadingLabel,
  onClick,
  disabled = false,
  className = "",
  title,
  children,
}: {
  loading: boolean;
  loadingLabel?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading}
      title={title}
      className={`relative isolate overflow-hidden transition ${
        loading ? "sg-ai-btn" : ""
      } ${disabled && !loading ? "opacity-60" : ""} ${className}`}
    >
      <span className="relative z-10 inline-flex items-center justify-center gap-1.5">
        {loading ? (
          <>
            {loadingLabel}
            <span className="flex items-center gap-[3px]" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="sg-ai-dot h-[3px] w-[3px] rounded-full bg-current"
                  style={{ animationDelay: `${i * 0.18}s` }}
                />
              ))}
            </span>
          </>
        ) : (
          children
        )}
      </span>
    </button>
  );
}
