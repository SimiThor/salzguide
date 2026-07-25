"use client";

import { useEffect, useState, useTransition } from "react";
import { triggerIntroRender, refreshIntroRenderList } from "@/lib/admin-actions";
import type { IntroRenderItem } from "@/lib/admin";

// Admin-Panel: alle Wanderungen mit Route, je Zeile ein Button „Generieren / Neu rendern".
// Der Klick stösst den GitHub-Actions-Workflow an (Server-Action), der Render läuft off-Vercel;
// den Fortschritt (queued -> rendering -> idle/error) pollt diese Komponente aus der DB.
function badge(item: IntroRenderItem): { label: string; cls: string; busy: boolean } {
  if (item.status === "queued")
    return { label: "In Warteschlange", cls: "bg-amber-500/12 text-amber-700 ring-amber-600/25", busy: true };
  if (item.status === "rendering")
    return { label: "Wird gerendert …", cls: "bg-blue-500/12 text-blue-700 ring-blue-600/25", busy: true };
  if (item.status === "error")
    return { label: "Fehler", cls: "bg-accent/12 text-accent ring-accent/25", busy: false };
  if (!item.hasVideo)
    return { label: "Kein Video", cls: "bg-muted/12 text-muted ring-muted/25", busy: false };
  if (item.outdated)
    return { label: "Veraltet", cls: "bg-accent/12 text-accent ring-accent/25", busy: false };
  return { label: "Aktuell", cls: "bg-emerald-600/12 text-emerald-700 ring-emerald-600/25", busy: false };
}

export default function IntroRenderManager({
  initial,
  configured,
}: {
  initial: IntroRenderItem[];
  configured: boolean;
}) {
  const [items, setItems] = useState<IntroRenderItem[]>(initial);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ slug: string; text: string } | null>(null);
  const [, startTransition] = useTransition();

  const anyBusy = items.some((i) => i.status === "queued" || i.status === "rendering");

  // Solange etwas läuft: alle 5 s den Stand nachladen (das Skript schreibt ihn in die DB).
  // .catch: Ein Netz-Schluckauf im 5-Sekunden-Takt wäre sonst je eine unhandled
  // rejection; der nächste Tick versucht es ohnehin erneut.
  useEffect(() => {
    if (!anyBusy) return;
    const id = setInterval(() => {
      void refreshIntroRenderList()
        .then((fresh) => {
          if (fresh.length) setItems(fresh);
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [anyBusy]);

  const onGenerate = (slug: string) => {
    setMsg(null);
    setPendingSlug(slug);
    startTransition(async () => {
      try {
        const res = await triggerIntroRender(slug);
        if (!res.ok) {
          setMsg({ slug, text: res.error ?? "Konnte nicht gestartet werden." });
          return;
        }
        // Optimistisch auf „queued" – das Polling übernimmt danach.
        setItems((prev) =>
          prev.map((i) => (i.slug === slug ? { ...i, status: "queued", error: null } : i)),
        );
      } catch {
        setMsg({ slug, text: "Gerade nicht erreichbar. Bitte nochmal versuchen." });
      } finally {
        setPendingSlug(null);
      }
    });
  };

  return (
    <div className="rounded-[18px] bg-white p-5 shadow-sm ring-1 ring-black/5">
      <h2 className="text-[17px] font-bold text-ink">Intro-Video rendern</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Erzeugt das Wander-Intro (Karte + animierte Route) für einen Spot. Der Render läuft auf
        einem GitHub-Runner gegen die Live-Seite und lädt Video + Standbild automatisch hoch –
        kein Terminal nötig. Dauert pro Video rund 25 bis 30 Minuten (der Runner rechnet die
        Karte ohne Grafikkarte); der Status hier aktualisiert sich von selbst.
      </p>

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
            const b = badge(item);
            const busy = b.busy || pendingSlug === item.slug;
            return (
              <li
                key={item.slug}
                className="flex items-center gap-3 rounded-[14px] bg-black/[0.02] p-3 ring-1 ring-black/5"
              >
                <div className="h-[54px] w-[30px] shrink-0 overflow-hidden rounded-[8px] bg-black/5">
                  {item.posterUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-ink">{item.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-[12px] text-muted">{item.slug}</span>
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

                <button
                  type="button"
                  onClick={() => onGenerate(item.slug)}
                  disabled={busy || !configured}
                  className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold transition active:scale-[0.97] disabled:opacity-40 ${
                    item.outdated || item.status === "error" || !item.hasVideo
                      ? "bg-accent text-white"
                      : "bg-black/5 text-ink"
                  }`}
                >
                  {b.busy
                    ? "läuft …"
                    : pendingSlug === item.slug
                      ? "starte …"
                      : item.hasVideo
                        ? "Neu rendern"
                        : "Generieren"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
