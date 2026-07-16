"use client";

import { useState, useTransition } from "react";
import { runAiInsightsSummary } from "@/lib/ai-insights-summary";
import type { AiInsightsQuery } from "@/lib/ai-insights";

// KI-Zusammenfassung der Chatbot-Nachfrage (docs/34 §I): schickt auf Knopfdruck NUR
// anonyme Aggregate an die KI und zeigt umsetzbare Stichpunkte. Admin-only (Action prüft).
export default function AiInsightsSummary({ query }: { query: AiInsightsQuery }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, start] = useTransition();

  function run() {
    setError(false);
    start(async () => {
      const r = await runAiInsightsSummary(query);
      if (r.ok) setText(r.text);
      else setError(true);
    });
  }

  return (
    <div className="rounded-[16px] border border-accent/20 bg-accent/[0.04] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">KI-Auswertung der Chatbot-Nachfrage</h2>
          <p className="text-[11px] text-muted">
            Umsetzbare Tipps aus den (anonymen) Anfragen dieses Zeitraums.
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
          Analyse hat nicht geklappt (evtl. noch zu wenige Anfragen). Bitte später erneut versuchen.
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
