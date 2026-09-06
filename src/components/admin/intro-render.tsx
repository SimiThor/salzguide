"use client";

import { useEffect, useRef, useState } from "react";
import { triggerIntroRender, triggerIntroCleanExport } from "@/lib/admin-actions";
import type { IntroRenderItem } from "@/lib/admin";
import Busy from "@/components/Busy";

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
        className={`cursor-pointer sg-hit shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold transition active:scale-[0.97] disabled:opacity-40 ${
          item.due || item.status === "error" ? "bg-accent text-white" : "bg-black/5 text-ink"
        } disabled:cursor-not-allowed`}
      >
        {b.busy ? <Busy>läuft</Busy> : pending ? <Busy>starte</Busy> : item.hasVideo ? "Neu rendern" : "Generieren"}
      </button>
      {blockedReason && !busy && (
        <p className="mt-1 text-[11px] leading-snug text-muted">{blockedReason}</p>
      )}
      {msg && <p className="mt-1 text-[11px] leading-snug text-accent">{msg}</p>}
    </div>
  );
}

/**
 * Der Knopf für die Clean-Fassung (ohne Text-Overlay), auf beiden Seiten derselbe.
 *
 * ER HAT KEINE WARTESCHLANGEN-ANZEIGE, und das ist Absicht: Es gibt keinen Zustand in der
 * Datenbank, den man nachladen könnte, und es soll auch keinen geben. Der Lauf dauert eine
 * halbe Stunde, danach kommt eine Mail mit dem Download-Link. Eine Fortschrittsanzeige wäre
 * genau das Nachsehen, das dieser Weg abschaffen soll. Was der Knopf schuldet, ist die
 * Bestätigung, dass er ausgelöst hat, und die Ansage, worauf man jetzt wartet.
 */
export function IntroCleanExportButton({
  slug,
  configured,
  blockedReason = null,
  className = "",
}: {
  slug: string;
  configured: boolean;
  /** Wie beim Render-Knopf: Gerendert wird die GESPEICHERTE Route. */
  blockedReason?: string | null;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "starting" | "started">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  const start = () => {
    setMsg(null);
    setState("starting");
    void (async () => {
      try {
        const res = await triggerIntroCleanExport(slug);
        if (!res.ok) {
          setMsg(res.error ?? "Konnte nicht gestartet werden.");
          setState("idle");
          return;
        }
        setState("started");
      } catch {
        setMsg("Gerade nicht erreichbar. Bitte nochmal versuchen.");
        setState("idle");
      }
    })();
  };

  // Nach dem Start KEIN Knopf mehr, sondern eine Plakette in derselben Grösse.
  //
  // Vorher stand die Ansage als Satz UNTER dem Knopf. In der Liste hat das die eine Zeile,
  // die man gerade angetippt hatte, doppelt so hoch gemacht wie ihre Nachbarn und den Satz
  // rechtsbündig unter den Knopf gehängt. Die Information gehört dorthin, wo vorher der
  // Knopf war: gleiche Höhe, gleiche Zeile, nichts springt. Ausgeschrieben statt „läuft",
  // weil genau das die Frage ist, die man sich sonst stellt (wie lange, und woher weiss
  // ich, dass es fertig ist).
  if (state === "started") {
    return (
      <div className={className}>
        <span className="inline-flex shrink-0 items-center rounded-full bg-black/5 px-4 py-2 text-[13px] font-semibold text-muted">
          Mail kommt in ~30 Min
        </span>
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={start}
        disabled={!configured || !!blockedReason || state !== "idle"}
        className="cursor-pointer sg-hit shrink-0 rounded-full bg-black/5 px-4 py-2 text-[13px] font-semibold text-ink transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {state === "starting" ? <Busy>starte</Busy> : "Clean-Export"}
      </button>
      {blockedReason && (
        <p className="mt-1 text-[11px] leading-snug text-muted">{blockedReason}</p>
      )}
      {msg && <p className="mt-1 text-[11px] leading-snug text-accent">{msg}</p>}
    </div>
  );
}
