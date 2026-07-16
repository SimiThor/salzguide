"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { fillSpotTranslations, fillCategoryTranslations } from "@/lib/admin-actions";
import { fillEventTranslations } from "@/lib/event-actions";
import AiButton from "./AiButton";

type Item = { id: string; label: string };

// Dezente Sekundär-Aktion: füllt bei allen noch nicht vollständig übersetzten Einträgen NUR die
// fehlenden/veralteten Sprachen aus dem Deutschen nach – ohne jeden Eintrag einzeln zu öffnen.
// Jeder Eintrag ist eine eigene, robuste Server-Aktion (Fehler isoliert); begrenzte Parallelität.
// Fortschritt steht im Button-Label; am Ende Seite aktualisieren -> Zähler/Badges stimmen wieder.
export default function BulkTranslateButton({
  kind,
  items,
  noun,
}: {
  kind: "spot" | "event" | "category";
  items: Item[];
  noun: string; // z.B. "Spots" / "Events" / "Kategorien"
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);

  const total = items.length;
  if (total === 0) return null; // alles vollständig -> kein Button nötig

  const fill =
    kind === "spot"
      ? fillSpotTranslations
      : kind === "event"
        ? fillEventTranslations
        : fillCategoryTranslations;

  async function run() {
    if (running) return;
    if (
      !confirm(
        `Bei ${total} ${noun} die fehlenden Sprachen aus dem Deutschen ergänzen? Das kann je nach Menge etwas dauern.`,
      )
    )
      return;
    setRunning(true);
    setDone(0);

    let d = 0;
    let filledTotal = 0;
    const fails: string[] = [];
    const queue = [...items];

    async function worker() {
      for (;;) {
        const item = queue.shift();
        if (!item) break;
        const r = await fill(item.id);
        d++;
        setDone(d);
        if (r.ok) {
          filledTotal += r.filled ?? 0;
          if (r.failed?.length) fails.push(item.label);
        } else {
          fails.push(item.label);
        }
      }
    }

    // Begrenzte Parallelität (schont das Rate-Limit; jeder Eintrag übersetzt selbst mehrere Sprachen).
    const CONC = Math.min(2, items.length);
    await Promise.all(Array.from({ length: CONC }, () => worker()));

    setRunning(false);
    // Rückmeldung nur, wenn etwas offen blieb (Erfolg zeigt sich am aktualisierten Zähler).
    if (fails.length)
      alert(
        `${filledTotal} Sprachen in ${d} ${noun} ergänzt. ${fails.length} noch unvollständig – nochmal klicken versucht es erneut.`,
      );
    router.refresh();
  }

  return (
    <AiButton
      loading={running}
      loadingLabel={`Übersetzt ${done}/${total}`}
      onClick={run}
      title="Bei allen noch nicht vollständig übersetzten Einträgen die fehlenden Sprachen aus dem Deutschen ergänzen"
      className="rounded-full bg-black/[0.06] px-3.5 py-2 text-[13px] font-semibold text-ink transition hover:bg-black/10 active:scale-[0.98]"
    >
      🌍 Fehlende Sprachen füllen ({total})
    </AiButton>
  );
}
