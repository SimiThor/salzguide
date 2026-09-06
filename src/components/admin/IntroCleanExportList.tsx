"use client";

import { IntroCleanExportButton } from "./intro-render";

// Clean-Fassungen (ohne Text-Overlay) AUF ABRUF: Der Knopf stösst den Workflow
// export-intro-clean.yml an. Der rendert frisch, legt die Datei befristet in den privaten
// Bucket `exports` und lässt die App einen Download-Link mailen (siehe lib/intro-export.ts).
//
// WARUM HIER KEINE FORTSCHRITTSANZEIGE UND KEIN DOWNLOAD-LINK STEHT: Der Lauf dauert eine
// halbe Stunde. Wer so lange auf eine Seite schaut, tut das nicht, und wer sie zumacht,
// vergisst die Sache. Genau das war der Grund, warum die Clean-Fassungen nie geholt wurden,
// obwohl sie fertig am GitHub-Lauf hingen. Der Ort mit dem Ergebnis ist deshalb das
// Postfach, nicht diese Liste.
type Item = { slug: string; title: string };

export default function IntroCleanExportList({
  items,
  runsUrl,
  configured,
}: {
  items: Item[];
  /** Übersicht der Workflow-Läufe auf GitHub. Nur noch der Blick ins Protokoll. */
  runsUrl: string | null;
  configured: boolean;
}) {
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

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {items.map((v) => (
          <li
            key={v.slug}
            className="flex flex-wrap items-center gap-4 rounded-[18px] bg-white p-4 shadow-sm ring-1 ring-black/5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-bold text-ink">{v.title}</p>
              <p className="truncate text-[12px] text-muted">{v.slug} · 1080×1920 · ohne Text</p>
            </div>
            <IntroCleanExportButton slug={v.slug} configured={configured} />
          </li>
        ))}
      </ul>
      {runsUrl && (
        <p className="text-[12px] text-muted">
          <a href={runsUrl} target="_blank" rel="noreferrer" className="underline">
            Läufe auf GitHub
          </a>{" "}
          zeigen das Protokoll, falls einmal keine Mail kommt.
        </p>
      )}
    </div>
  );
}
