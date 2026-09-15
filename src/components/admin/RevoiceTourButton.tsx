"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { revoicePlan, voicePointFile } from "@/lib/tts-actions";
import type { PlanItem, PlanReason, VoicePlan } from "@/lib/tts-rules";
import { adminErrorText } from "@/lib/admin-errors";
import AiButton from "./AiButton";
import Busy from "@/components/Busy";

// „Prüfen", dann „Vertonen": alle Stationen einer Runde mit EINER Stimme, in allen Sprachen,
// Kostproben mit. Zwei Stufen, weil Vertonen Geld kostet: Erst steht da, wie viele Dateien
// fehlen oder veraltet sind und wie viele Zeichen das sind, dann erst der Knopf.
//
// Die Schleife läuft im Browser (Muster BulkTranslateButton): jede Datei ist ein eigener,
// kurzer Server-Aufruf, unter jeder Vercel-Zeitgrenze, Fehler bleiben je Datei isoliert.
// Nochmal klicken vertont nur die Reste, weil der Kern (lib/tts-files.ts) fertige Dateien
// überspringt. Läuft mit der IM FORMULAR gewählten Stimme, auch vor dem Speichern: So kann
// eine Live-Runde ihre neue Stimme komplett bekommen, bevor sie umgestellt wird.

const REASON: Record<PlanReason, string> = {
  missing: "fehlt",
  text_changed: "Text geändert",
  object_missing: "Datei weg",
};

export default function RevoiceTourButton({
  pointIds,
  voiceId,
  voiceName,
  titles,
  disabled = false,
}: {
  pointIds: string[];
  voiceId: string;
  voiceName: string;
  /** pointId -> Titel, für die Liste und die Fehlermeldungen. */
  titles: Record<string, string>;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "checking" | "planned" | "running">("idle");
  const [plan, setPlan] = useState<VoicePlan | null>(null);
  const [done, setDone] = useState(0);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function onCheck() {
    if (phase !== "idle" || !voiceId || !pointIds.length) return;
    setPhase("checking");
    setMsg("");
    setErr("");
    try {
      const r = await revoicePlan({ pointIds, voiceId });
      if (!r.ok || !r.plan) {
        setErr(adminErrorText(r.error));
        setPhase("idle");
        return;
      }
      if (r.plan.items.length === 0) {
        setMsg(`Alle Stationen sprechen schon mit ${voiceName} (${r.plan.wanted} Dateien).`);
        setPhase("idle");
        return;
      }
      setPlan(r.plan);
      setPhase("planned");
    } catch {
      setErr("Gerade nicht erreichbar. Bitte nochmal versuchen.");
      setPhase("idle");
    }
  }

  async function onRun() {
    if (phase !== "planned" || !plan) return;
    const n = plan.items.length;
    if (
      !confirm(
        `${n} ${n === 1 ? "Datei" : "Dateien"} (${plan.chars.toLocaleString("de-AT")} Zeichen) mit ${voiceName} vertonen? Das kostet ElevenLabs-Guthaben.`,
      )
    )
      return;
    setPhase("running");
    setDone(0);
    setMsg("");
    setErr("");
    let d = 0;
    let made = 0;
    const fails: string[] = [];
    const queue: PlanItem[] = [...plan.items];

    async function worker() {
      for (;;) {
        const item = queue.shift();
        if (!item) break;
        const label = `${titles[item.pointId] ?? item.pointId} · ${item.lang.toUpperCase()}${
          item.kind === "kostprobe" ? " (Kostprobe)" : ""
        }`;
        // try/catch PRO Datei: Wirft ein Aufruf (Netz weg), rejected sonst das ganze
        // Promise.all und der Knopf bliebe für immer bei „Vertont n/m" hängen.
        try {
          const r = await voicePointFile({ pointId: item.pointId, lang: item.lang, kind: item.kind, voiceId });
          if (r.ok) {
            if (!r.skipped) made++;
          } else fails.push(`${label}: ${adminErrorText(r.error)}`);
        } catch {
          fails.push(label);
        }
        d++;
        setDone(d);
      }
    }

    try {
      // Zwei parallel: bleibt unter der kleinsten ElevenLabs-Gleichzeitigkeitsgrenze.
      const CONC = Math.min(2, queue.length);
      await Promise.all(Array.from({ length: CONC }, () => worker()));
    } finally {
      setPhase("idle");
      setPlan(null);
    }
    if (fails.length) {
      setErr(`${fails.length} nicht vertont. Nochmal „Prüfen" versucht es erneut. ${fails.slice(0, 3).join(" · ")}`);
    }
    setMsg(`✓ ${made} ${made === 1 ? "Datei" : "Dateien"} mit ${voiceName} vertont.`);
    router.refresh();
  }

  // Für die Liste je Station zusammenfassen, sonst stehen bei 7 Stationen 98 Zeilen da.
  const byPoint = new Map<string, PlanItem[]>();
  for (const it of plan?.items ?? []) byPoint.set(it.pointId, [...(byPoint.get(it.pointId) ?? []), it]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {phase === "planned" && plan ? (
          <>
            <AiButton
              loading={false}
              onClick={onRun}
              className="rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white"
            >
              Vertonen ({plan.items.length} {plan.items.length === 1 ? "Datei" : "Dateien"},{" "}
              {plan.chars.toLocaleString("de-AT")} Zeichen)
            </AiButton>
            <button
              type="button"
              onClick={() => {
                setPlan(null);
                setPhase("idle");
              }}
              className="cursor-pointer rounded-full bg-black/5 px-4 py-2 text-[13px] font-semibold text-ink transition active:scale-[0.98]"
            >
              Abbrechen
            </button>
          </>
        ) : phase === "running" ? (
          <AiButton
            loading
            loadingLabel={`Vertont ${done}/${plan?.items.length ?? 0}`}
            onClick={() => {}}
            className="rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white"
          >
            Vertonen
          </AiButton>
        ) : (
          <button
            type="button"
            onClick={onCheck}
            disabled={disabled || phase !== "idle" || !voiceId || !pointIds.length}
            className="cursor-pointer rounded-full bg-black/5 px-4 py-2 text-[13px] font-semibold text-ink transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === "checking" ? <Busy>Prüft</Busy> : `Stimme prüfen (${voiceName})`}
          </button>
        )}
      </div>

      {phase === "planned" && plan && (
        <ul className="space-y-1 rounded-[12px] bg-black/[0.03] p-3 text-[12px] text-ink">
          {[...byPoint.entries()].map(([pid, items]) => (
            <li key={pid}>
              <span className="font-semibold">{titles[pid] ?? pid}</span>{" "}
              <span className="text-muted">
                {items
                  .map(
                    (it) =>
                      `${it.lang.toUpperCase()}${it.kind === "kostprobe" ? " Kostprobe" : ""} (${REASON[it.reason]})`,
                  )
                  .join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}

      {err && <p className="rounded-[12px] bg-accent/10 px-3 py-2 text-[12px] text-accent">{err}</p>}
      {msg && <p className="text-[12px] font-medium text-emerald-700">{msg}</p>}
    </div>
  );
}
