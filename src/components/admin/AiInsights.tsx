"use client";

import { useState, useTransition } from "react";
import { runAnalyticsInsights } from "@/lib/analytics-ai";
import type { AnalyticsQuery } from "@/lib/analytics-queries";

// KI-Auswertung (docs/34 §H): schickt auf Knopfdruck NUR anonyme Aggregate an die
// KI und zeigt eine kurze, umsetzbare Einschätzung. Admin-only (Server-Action prüft).
export default function AiInsights({ query }: { query: AnalyticsQuery }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, start] = useTransition();

  function run() {
    setError(false);
    start(async () => {
      const r = await runAnalyticsInsights(query);
      if (r.ok) setText(r.text);
      else setError(true);
    });
  }

  return (
    <div className="rounded-[16px] border border-accent/20 bg-accent/[0.04] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">KI-Auswertung</h2>
          <p className="text-[11px] text-muted">
            Kurze Einschätzung aus den (anonymen) Kennzahlen dieses Zeitraums.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="shrink-0 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white transition active:scale-95 disabled:opacity-50"
        >
          {busy ? "Analysiere …" : text ? "Neu analysieren" : "✨ KI-Analyse starten"}
        </button>
      </div>

      {error && (
        <p className="mt-3 text-[13px] text-accent">
          Analyse hat nicht geklappt. Bitte später erneut versuchen.
        </p>
      )}
      {text && (
        <div className="mt-3 space-y-1.5 text-[14px] leading-relaxed text-ink">
          {text
            .split("\n")
            .filter((l) => l.trim())
            .map((line, i) => (
              <p key={i}>{line}</p>
            ))}
        </div>
      )}
    </div>
  );
}
