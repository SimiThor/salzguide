"use client";

import { useEffect, useRef } from "react";

// Cloudflare-Turnstile-Widget (explizites Rendern -> robust bei Client-Navigation).
// Lädt das CF-Skript einmal, rendert die Challenge und meldet das Token per onToken zurück
// (leerer String bei Ablauf/Fehler). Ohne Token bleibt der Login-Button gesperrt.
type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reset: (id?: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export default function TurnstileWidget({
  siteKey,
  onToken,
  onError,
  theme = "light",
  size = "flexible",
  // "interaction-only": Widget bleibt unsichtbar, solange Cloudflare keine Interaktion
  // verlangt (stiller Pass liefert trotzdem ein Token) -> cleanste UX, keine Box.
  appearance = "interaction-only",
  className = "",
}: {
  siteKey: string;
  onToken: (token: string) => void;
  onError?: () => void;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "compact" | "flexible";
  appearance?: "always" | "execute" | "interaction-only";
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // Callbacks in Refs halten -> Effekt hängt nur an siteKey/Optionen, kein Re-Render.
  const onTokenRef = useRef(onToken);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onTokenRef.current = onToken;
    onErrorRef.current = onError;
  }, [onToken, onError]);

  useEffect(() => {
    let cancelled = false;

    function render() {
      if (cancelled || !boxRef.current || !window.turnstile || widgetId.current) return;
      widgetId.current = window.turnstile.render(boxRef.current, {
        sitekey: siteKey,
        theme,
        size,
        appearance,
        callback: (token: string) => onTokenRef.current(token),
        // Ablauf: nur Token leeren, Widget fordert selbst eine neue Challenge an.
        "expired-callback": () => onTokenRef.current(""),
        // Echter Fehler/Timeout: Token leeren UND Fehler melden (Fallback-Hinweis anzeigen).
        "error-callback": () => {
          onTokenRef.current("");
          onErrorRef.current?.();
        },
        "timeout-callback": () => {
          onTokenRef.current("");
          onErrorRef.current?.();
        },
      });
    }

    if (window.turnstile) {
      render();
    } else {
      const sel = `script[src^="${SCRIPT_SRC.split("?")[0]}"]`;
      const existing = document.querySelector<HTMLScriptElement>(sel);
      if (existing) {
        existing.addEventListener("load", render, { once: true });
      } else {
        const s = document.createElement("script");
        s.src = SCRIPT_SRC;
        s.async = true;
        s.defer = true;
        s.addEventListener("load", render, { once: true });
        document.head.appendChild(s);
      }
    }

    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* Widget bereits weg */
        }
        widgetId.current = null;
      }
    };
  }, [siteKey, theme, size, appearance]);

  // Nur bei „always" Platz reservieren (kein Layout-Sprung). Bei „interaction-only" bleibt
  // die Box unsichtbar/kollabiert -> keine leere Lücke im Formular.
  const reserve = appearance === "always" ? "min-h-[65px]" : "";
  return <div ref={boxRef} className={`${reserve} ${className}`.trim()} />;
}
