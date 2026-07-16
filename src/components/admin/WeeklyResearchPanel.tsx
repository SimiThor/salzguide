"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { runWeekResearchNow } from "@/lib/event-actions";
import AiButton from "./AiButton";

export type WeekInfo = {
  offset: number; // 0 = diese, 1 = nächste, 2 = übernächste Woche
  label: string; // "07.07.–13.07."
  researchedLabel: string | null; // "06.07. 05:00" oder null (noch nicht)
  inserted: number | null;
};

const TITLES = ["Diese Woche", "Nächste Woche", "Übernächste Woche"];

// KI-Wochenrecherche pro Kalenderwoche (Mo–So). Jede Woche wird nur einmal
// automatisch gesucht (Cron); hier manuell auslösbar. Zeigt "zuletzt recherchiert".
export default function WeeklyResearchPanel({ weeks }: { weeks: WeekInfo[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  function run(offset: number, already: boolean) {
    if (
      already &&
      !confirm(
        "Diese Woche wurde schon recherchiert. Nochmal suchen? (Dubletten werden automatisch übersprungen.)",
      )
    )
      return;
    setMsg("");
    setBusy(offset);
    start(async () => {
      const r = await runWeekResearchNow(offset);
      setBusy(null);
      if (r.ok) {
        setMsg(
          `✓ ${r.inserted} neue Entwürfe – gleich in alle Sprachen übersetzt${r.skipped ? ` · ${r.skipped} übersprungen` : ""}.`,
        );
        router.refresh();
      } else {
        setMsg(r.error ?? "Fehler bei der Recherche");
      }
    });
  }

  return (
    <section className="space-y-3 rounded-[16px] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-ink">
          ✨ KI-Wochenrecherche
        </h2>
        {msg && <span className="text-xs text-muted">{msg}</span>}
      </div>

      <div className="space-y-2">
        {weeks.map((w) => {
          const already = w.researchedLabel != null;
          const isBusy = pending && busy === w.offset;
          return (
            <div
              key={w.offset}
              className="flex items-center justify-between gap-3 rounded-[12px] bg-black/[0.03] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-ink">
                  {TITLES[w.offset] ?? "Woche"}
                  <span className="ml-2 text-xs font-normal text-muted">
                    {w.label}
                  </span>
                </p>
                <p className="text-[11px] text-muted">
                  {already
                    ? `zuletzt: ${w.researchedLabel} · ${w.inserted ?? 0} neu hinzugefügt`
                    : "noch nicht recherchiert"}
                </p>
              </div>
              <AiButton
                loading={isBusy}
                loadingLabel="Sucht"
                onClick={() => run(w.offset, already)}
                disabled={pending}
                // Ruhezustand: „Nochmal" dezent hell, sonst Akzent-Rot. Während der
                // Recherche übernimmt .sg-ai-btn (KI-Gradient) den Button komplett.
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                  already ? "bg-black/5 text-ink" : "bg-accent text-white"
                }`}
              >
                {already ? "Nochmal" : "Recherchieren"}
              </AiButton>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted">
        Findet Events, legt sie als Entwurf an und übersetzt sie gleich in alle Sprachen –
        du musst nur noch prüfen & veröffentlichen. Automatisch jede Woche (Cron, montags);
        manuell hier für aktuelle, nächste & übernächste Woche. Nie doppelt gesucht.
      </p>
    </section>
  );
}
