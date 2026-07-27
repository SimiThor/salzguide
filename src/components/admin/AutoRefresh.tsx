"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useLatestRef } from "@/lib/use-latest-ref";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Eine Admin-Seite, die sich von selbst auf den neuesten Stand bringt.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// WOFÜR: Auf dem Logbuch schaut man nach, WEIL gerade etwas los ist. Eine Seite, die man
// dafür von Hand neu laden muss, zeigt genau in dem Moment veraltete Zahlen, in dem sie
// stimmen müssen — und man merkt es nicht, weil eine alte Zahl genauso aussieht wie eine
// frische.
//
// `router.refresh()` und NICHT `location.reload()`: Der Neuladen-Weg würde das ganze
// Dokument samt Skripten neu holen, die Scroll-Position verlieren und jeden aufgeklappten
// Zustand wegwerfen. `refresh()` lässt Next nur die Server-Komponenten neu rendern und
// tauscht das Ergebnis im Baum aus. Scroll-Position, Filter und Fokus bleiben, wo sie sind.
//
// ───────────────────────────────────────────────────────────────────────────────────────
//  WARUM NICHT EINFACH setInterval
// ───────────────────────────────────────────────────────────────────────────────────────
//
// Ein blanker Intervall läuft auch dann weiter, wenn der Tab seit drei Tagen im Hintergrund
// liegt. Jeder Lauf kostet hier drei Datenbank-Abfragen plus die Admin-Prüfung — für
// niemanden, der hinschaut. Ein Admin-Tab, den man morgens öffnet und abends noch offen hat,
// wäre so tausend Abfragen wert, von denen zwei jemand gesehen hat.
//
// Deshalb zwei Auslöser statt einem:
//
//   SICHTBAR GEWORDEN   Der wichtigste. Man wechselt zum Tab zurück und will das Aktuelle
//                       sehen, nicht den Stand von vorhin. Feuert sofort.
//   INTERVALL           Für den Fall, dass der Tab offen daneben liegt und man ihn im Blick
//                       hat. Läuft NUR, solange die Seite wirklich sichtbar ist.
//
// Browser drosseln Intervalle in Hintergrund-Tabs zwar ohnehin auf etwa einmal pro Minute,
// aber „gedrosselt" ist nicht „aus", und darauf verlassen sollte man sich nicht.

export default function AutoRefresh({
  /**
   * Abstand zwischen zwei Aktualisierungen, in Sekunden.
   *
   * 60 ist bewusst nicht schneller: Jede Runde sind mehrere Abfragen, und kein Vorfall auf
   * dieser Seite wird dadurch entschärft, dass man ihn zwanzig Sekunden früher sieht. Wer es
   * sofort braucht, wechselt kurz den Tab und kommt zurück.
   */
  seconds = 60,
}: {
  seconds?: number;
}) {
  const router = useRouter();
  // `useTransition` statt eines nackten Aufrufs: Die Aktualisierung läuft damit als
  // Übergang niedriger Priorität. Die Seite bleibt bedienbar, während im Hintergrund neu
  // gerendert wird, und `pending` sagt uns, wann wir es anzeigen dürfen.
  const [pending, startTransition] = useTransition();
  // Erst nach dem Mounten gesetzt. Käme die Uhrzeit schon aus dem Server-Rendering, stünde
  // dort eine andere als im Browser (der Server rechnet in UTC), und React meldete beim
  // Hydrieren einen Unterschied.
  const [lastAt, setLastAt] = useState<string | null>(null);

  // Der Effekt unten läuft EINMAL und lebt danach weiter. Ohne diesen Ref sähe er für immer
  // das `router`-Objekt vom ersten Render (veralteter Closure) — dasselbe Muster, aus dem
  // useLatestRef für die Karten-Handler entstanden ist.
  const refreshRef = useLatestRef(() => {
    startTransition(() => {
      router.refresh();
      setLastAt(
        new Intl.DateTimeFormat("de-AT", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZone: "Europe/Vienna",
        }).format(new Date()),
      );
    });
  });

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      refreshRef.current();
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") refreshRef.current();
    };

    const id = window.setInterval(tick, Math.max(10, seconds) * 1000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // `seconds` ist der einzige echte Auslöser für einen Neuaufbau. `refreshRef` ist stabil.
  }, [seconds, refreshRef]);

  return (
    <p className="flex items-center gap-1.5 text-[12px] text-muted" aria-live="polite">
      {/* Der Punkt ist die ganze Anzeige: grün und ruhig heisst „aktuell", während einer
          Aktualisierung pulst er. Ein Text wie „wird geladen" würde bei jeder Runde
          erscheinen und verschwinden und die Zeile unruhig machen. */}
      <span
        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 ${
          pending ? "animate-pulse" : ""
        }`}
        aria-hidden
      />
      {lastAt
        ? `Aktualisiert um ${lastAt} Uhr, danach automatisch`
        : `Aktualisiert sich automatisch (alle ${seconds} Sekunden)`}
    </p>
  );
}
