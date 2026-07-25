"use client";

import { useState, useTransition } from "react";
import { triggerIntroRender, refreshIntroRenderList } from "@/lib/admin-actions";
import type { IntroRenderItem } from "@/lib/admin";
import { introBadge, IntroRenderButton, useIntroRenderItems } from "./intro-render";
import IntroVideoPreview from "./IntroVideoPreview";
import { slugify } from "@/lib/slug";
import Busy from "@/components/Busy";

// Admin-Panel: alle Wanderungen mit Route, je Zeile ein Knopf, oben einer für alle fälligen.
// Zustände, Knopf und Nachladen kommen aus intro-render.tsx, damit die Spot-Unterseite
// dasselbe zeigt und dasselbe tut. Hier lebt nur das Listen-Drumherum.

export default function IntroRenderManager({
  initial,
  configured,
}: {
  initial: IntroRenderItem[];
  configured: boolean;
}) {
  const { items, markQueued, anyBusy } = useIntroRenderItems(initial, refreshIntroRenderList);
  const [pendingAll, setPendingAll] = useState(false);
  const [msg, setMsg] = useState<{ slug: string; text: string } | null>(null);
  const [, startTransition] = useTransition();

  // introNeedsRender() hat das schon entschieden (src/lib/intro-hash.ts), hier nur zählen.
  const due = items.filter((i) => i.due);

  // Ein Druck, alle fälligen Videos. Der Workflow verteilt sie auf je einen Runner, sie
  // laufen also nebeneinander: sechs Videos dauern so lange wie eines.
  const onGenerateAll = () => {
    setMsg(null);
    setPendingAll(true);
    const slugs = due.map((i) => i.slug);
    startTransition(async () => {
      try {
        const res = await triggerIntroRender();
        if (!res.ok) {
          setMsg({ slug: "", text: res.error ?? "Konnte nicht gestartet werden." });
          return;
        }
        markQueued(slugs);
      } catch {
        setMsg({ slug: "", text: "Gerade nicht erreichbar. Bitte nochmal versuchen." });
      } finally {
        setPendingAll(false);
      }
    });
  };

  return (
    <div className="rounded-[18px] bg-white p-5 shadow-sm ring-1 ring-black/5">
      <h2 className="text-[17px] font-bold text-ink">Intro-Video rendern</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Erzeugt das Wander-Intro (Karte + animierte Route) und lädt Video + Standbild automatisch
        hoch, kein Terminal nötig. Ein Druck auf „Alle fälligen rendern“ genügt: Der Rest läuft
        von selbst, jeder Spot auf einem eigenen Rechner, alle gleichzeitig. Rechne mit einer
        guten halben Stunde, egal ob eines oder sechs. Der Status hier aktualisiert sich selbst,
        die Seite darf zu.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={onGenerateAll}
          disabled={!configured || anyBusy || pendingAll || due.length === 0}
          className="sg-hit rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
        >
          {pendingAll ? <Busy>Wird gestartet</Busy> : `Alle fälligen rendern (${due.length})`}
        </button>
        {due.length === 0 && !anyBusy && (
          <span className="text-[12px] text-muted">Alle Videos sind aktuell.</span>
        )}
        {anyBusy && <span className="text-[12px] text-muted">Läuft gerade, bitte abwarten.</span>}
      </div>

      {msg?.slug === "" && (
        <p className="mt-2 text-[12px] leading-snug text-accent">{msg.text}</p>
      )}

      {!configured && (
        <p className="mt-3 rounded-[12px] bg-accent/8 px-3 py-2 text-[12px] leading-relaxed text-accent ring-1 ring-accent/15">
          GitHub ist noch nicht verbunden. Setze in Vercel <code>GITHUB_ACTIONS_TOKEN</code> und{" "}
          <code>GITHUB_REPO</code> und hinterlege die Repo-Secrets (siehe{" "}
          <code>.github/workflows/render-intro.yml</code>).
        </p>
      )}

      {items.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted">Keine Wanderungen mit Route gefunden.</p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {items.map((item) => {
            const b = introBadge(item);
            return (
              <li
                key={item.slug}
                className="flex flex-wrap items-center gap-3 rounded-[14px] bg-black/[0.02] p-3 ring-1 ring-black/5"
              >
                <IntroVideoPreview
                  src={item.videoUrl}
                  poster={item.posterUrl}
                  title={item.title}
                  className="h-[54px] w-[30px]"
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-ink">{item.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {/* Slug nur zeigen, wenn er NICHT bloss der kleingeschriebene Titel ist:
                        sonst steht derselbe Name zweimal untereinander. Weicht er ab (Titel
                        später umbenannt), ist er echte Information und bleibt sichtbar. */}
                    {slugify(item.title) !== item.slug && (
                      <span className="truncate text-[12px] text-muted">{item.slug}</span>
                    )}
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none ring-1 ring-inset ${b.cls}`}
                    >
                      {b.label}
                    </span>
                  </div>
                  {item.status === "error" && item.error && (
                    <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-accent">{item.error}</p>
                  )}
                  {msg && msg.slug === item.slug && (
                    <p className="mt-1 text-[11px] leading-snug text-accent">{msg.text}</p>
                  )}
                </div>

                <IntroRenderButton
                  item={item}
                  configured={configured}
                  onQueued={markQueued}
                  className="shrink-0 text-right"
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
