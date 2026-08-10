"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { triggerIntroCleanExport } from "@/lib/admin-actions";

// Clean-Fassungen (ohne Text-Overlay) AUF ABRUF: Der Knopf stösst den Workflow
// export-intro-clean.yml an; das fertige MP4 hängt als Artefakt am GitHub-Lauf und
// verfällt dort nach 5 Tagen von selbst. Gespeichert wird nichts mehr (der Grund steht
// am Clean-Block in scripts/render-intro.ts). Deshalb gibt es hier auch keine
// Warteschlangen-Anzeige wie beim normalen Render: Der eine Ort mit Fortschritt UND
// Download ist der GitHub-Lauf, und genau dorthin führt der Link nach dem Start.
type Item = { slug: string; title: string };

export default function IntroCleanExportList({
  items,
  runsUrl,
  configured,
}: {
  items: Item[];
  /** Übersicht der Workflow-Läufe auf GitHub (dort liegt der Download). */
  runsUrl: string | null;
  configured: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [started, setStarted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  if (!items.length) {
    return (
      <div className="rounded-[18px] bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
        <div className="text-[28px]" aria-hidden>
          🎬
        </div>
        <p className="mt-2 text-[14px] font-semibold text-ink">Noch keine Intros</p>
        <p className="mx-auto mt-1 max-w-[420px] text-[13px] leading-relaxed text-muted">
          Sobald oben ein Intro erzeugt ist, kannst du hier seine Clean-Fassung exportieren.
        </p>
      </div>
    );
  }

  const start = async (slug: string) => {
    setBusy(slug);
    setError(null);
    const res = await triggerIntroCleanExport(slug);
    setBusy(null);
    if (!res.ok) {
      setError(res.error ?? "Unbekannter Fehler.");
      return;
    }
    setStarted((prev) => new Set(prev).add(slug));
    router.refresh();
  };

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-[14px] bg-accent/10 px-4 py-3 text-[13px] font-medium text-accent">
          {error}
        </p>
      )}
      <ul className="space-y-3">
        {items.map((v) => (
          <li
            key={v.slug}
            className="flex flex-wrap items-center gap-4 rounded-[18px] bg-white p-4 shadow-sm ring-1 ring-black/5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-bold text-ink">{v.title}</p>
              <p className="truncate text-[12px] text-muted">
                {v.slug} · 1080×1920 · ohne Text
              </p>
            </div>
            {started.has(v.slug) ? (
              <a
                href={runsUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center rounded-full bg-black/[0.06] px-4 py-2.5 text-[14px] font-semibold text-ink transition active:scale-[0.97]"
              >
                Läuft · Download auf GitHub
              </a>
            ) : (
              <button
                type="button"
                onClick={() => start(v.slug)}
                disabled={!configured || busy !== null}
                className="inline-flex shrink-0 cursor-pointer items-center rounded-full bg-ink px-4 py-2.5 text-[14px] font-semibold text-white transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === v.slug ? "Startet …" : "Export starten"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
