"use client";

import { useEffect, useRef, useState } from "react";
import { triggerIntroRender } from "@/lib/admin-actions";
import type { IntroRenderItem } from "@/lib/admin";

// Alles, was ein Intro-Render dem Admin GEGENÜBER tut, liegt in dieser Datei: wie ein
// Zustand heisst, was der Knopf macht und wie lange nachgeladen wird. Die Sammelseite
// (IntroRenderManager) benutzt es je Zeile, die Spot-Unterseite (SpotForm) genau einmal.
//
// Bewusst NICHT geteilt ist das Layout drumherum: Die Liste zeigt Standbild und Titel, die
// Spot-Seite eine Überschrift mit Beschreibung. Geteilt gehört das Verhalten, nicht das
// Aussehen. Wer morgen einen Zustand ergänzt (etwa „Frame 120 von 300"), ändert nur hier
// und es steht an beiden Stellen.

export function introBadge(item: IntroRenderItem): { label: string; cls: string; busy: boolean } {
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

// Nachladen, solange etwas läuft; das Render-Skript schreibt den Stand in die DB. Die
// beiden Seiten holen ihre Daten unterschiedlich (ganze Liste vs. ein Spot), deshalb kommt
// die Ladefunktion herein.
export function useIntroRenderItems(
  initial: IntroRenderItem[],
  refresh: () => Promise<IntroRenderItem[]>,
) {
  const [items, setItems] = useState<IntroRenderItem[]>(initial);
  // refresh landet NICHT in der Abhängigkeitsliste des Takts: Eine an Ort und Stelle
  // geschriebene Funktion wäre bei jedem Render neu und würde ihn endlos neu starten.
  // Nachziehen im Effekt, nicht während des Renderns (React darf Renders verwerfen).
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  const anyBusy = items.some((i) => i.status === "queued" || i.status === "rendering");

  // .catch: Ein Netz-Schluckauf im 5-Sekunden-Takt wäre sonst je eine unhandled rejection;
  // der nächste Takt versucht es ohnehin erneut.
  useEffect(() => {
    if (!anyBusy) return;
    const id = setInterval(() => {
      void refreshRef
        .current()
        .then((fresh) => {
          if (fresh.length) setItems(fresh);
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [anyBusy]);

  // Optimistisch auf „in Warteschlange", das Nachladen übernimmt danach.
  const markQueued = (slugs: string[]) =>
    setItems((prev) =>
      prev.map((i) => (slugs.includes(i.slug) ? { ...i, status: "queued", error: null } : i)),
    );

  return { items, markQueued, anyBusy };
}

export function IntroRenderButton({
  item,
  configured,
  // Grund, warum gerade nicht gerendert werden darf (Spot-Seite: ungespeicherte
  // Änderungen). Steht einer da, ist der Knopf gesperrt und der Grund sichtbar.
  blockedReason = null,
  onQueued,
  className = "",
}: {
  item: IntroRenderItem;
  configured: boolean;
  blockedReason?: string | null;
  onQueued: (slugs: string[]) => void;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const b = introBadge(item);
  const busy = b.busy || pending;

  const start = () => {
    setMsg(null);
    setPending(true);
    void (async () => {
      try {
        const res = await triggerIntroRender(item.slug);
        if (!res.ok) {
          setMsg(res.error ?? "Konnte nicht gestartet werden.");
          return;
        }
        onQueued([item.slug]);
      } catch {
        setMsg("Gerade nicht erreichbar. Bitte nochmal versuchen.");
      } finally {
        setPending(false);
      }
    })();
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={start}
        disabled={busy || !configured || !!blockedReason}
        className={`sg-hit shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold transition active:scale-[0.97] disabled:opacity-40 ${
          item.due || item.status === "error" ? "bg-accent text-white" : "bg-black/5 text-ink"
        }`}
      >
        {b.busy ? "läuft …" : pending ? "starte …" : item.hasVideo ? "Neu rendern" : "Generieren"}
      </button>
      {blockedReason && !busy && (
        <p className="mt-1 text-[11px] leading-snug text-muted">{blockedReason}</p>
      )}
      {msg && <p className="mt-1 text-[11px] leading-snug text-accent">{msg}</p>}
    </div>
  );
}
