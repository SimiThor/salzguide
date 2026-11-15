"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { clearNavVoice, navVoicePlan, setNavVoice, voiceNavPrompt } from "@/lib/nav-voice-actions";
import { NAV_PROMPT_KEYS, navVoiceGate, type NavCell, type NavPlan, type NavPromptKey } from "@/lib/nav-voice-rules";
import { LOCALE_CODES } from "@/i18n/locales";
import { adminErrorText } from "@/lib/admin-errors";
import { STATUS_ACCENT } from "@/lib/ui";
import Busy from "@/components/Busy";

// Ansagen der Wanderführung (Migration 0077): Stimme wählen, Raster aus Ansage x Sprache,
// fehlende Dateien erzeugen, Stimme aktivieren. Still, ohne Erklärtexte: Die Regeln erzwingt
// der Server (setNavVoice prüft das Gate noch einmal). Eine Datei je Aufruf, die Schleife
// läuft hier im Browser.

export type NavVoiceChoice = { id: string; name: string };

const KEY_LABEL: Record<NavPromptKey, string> = {
  "hike.startReached": "Start erreicht",
  "hike.offTrail": "Vom Weg ab",
  "hike.backOnTrail": "Wieder auf dem Weg",
  "hike.turnaround": "Umkehrpunkt",
  "hike.wrongWay": "Falsche Richtung",
  "hike.arrived": "Ziel",
};

const STATE_MARK: Record<string, { mark: string; cls: string; title: string }> = {
  ok: { mark: "✓", cls: "bg-emerald-600/12 text-emerald-700", title: "aktuell" },
  unhashed: { mark: "✓", cls: "bg-emerald-600/12 text-emerald-700", title: "aktuell" },
  missing: { mark: "·", cls: "bg-black/5 text-muted", title: "fehlt" },
  object_missing: { mark: "!", cls: "bg-accent/12 text-accent", title: "Datei weg" },
  text_changed: { mark: "!", cls: "bg-amber-500/15 text-amber-700", title: "veraltet" },
  missing_text: { mark: "×", cls: "bg-accent/12 text-accent", title: "Text fehlt" },
};

const btnSoft =
  "cursor-pointer rounded-full bg-black/5 px-3 py-1.5 text-[12px] font-semibold text-ink transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50";
const btnAccent =
  "cursor-pointer rounded-full bg-accent px-3 py-1.5 text-[12px] font-semibold text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50";
const inputCls =
  "w-full rounded-[12px] border border-black/10 bg-white px-3 py-2 text-[15px] text-ink outline-none focus:border-accent";

export default function NavVoicePanel({
  voices,
  navVoiceId,
}: {
  voices: NavVoiceChoice[];
  navVoiceId: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [voiceId, setVoiceId] = useState<string>(navVoiceId ?? voices[0]?.id ?? "");
  const [plan, setPlan] = useState<NavPlan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ key: NavPromptKey; lang: string } | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [activeFetched, setActiveFetched] = useState<NavPlan | null>(null);
  const lock = useRef(false);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const r = await navVoicePlan(id);
      if (r.ok && r.plan) {
        setPlan(r.plan);
        setErr(null);
      } else setErr(adminErrorText(r.error));
    } catch {
      setErr("Gerade nicht erreichbar. Bitte nochmal versuchen.");
    }
  }, []);

  useEffect(() => {
    if (!voiceId) return;
    let cancelled = false;
    navVoicePlan(voiceId)
      .then((r) => {
        if (cancelled) return;
        if (r.ok && r.plan) {
          setPlan(r.plan);
          setErr(null);
        } else setErr(adminErrorText(r.error));
      })
      .catch(() => {
        if (!cancelled) setErr("Gerade nicht erreichbar. Bitte nochmal versuchen.");
      });
    return () => {
      cancelled = true;
    };
  }, [voiceId]);

  // Der Stand der AKTIVEN Stimme, auch wenn gerade eine andere gewählt ist: Ändert sich ein
  // Text nach dem Aktivieren, steht hier sofort, dass etwas offen ist.
  useEffect(() => {
    if (!navVoiceId || navVoiceId === voiceId) return;
    let cancelled = false;
    navVoicePlan(navVoiceId)
      .then((r) => {
        if (!cancelled && r.ok && r.plan) setActiveFetched(r.plan);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [navVoiceId, voiceId]);
  const activePlan = navVoiceId && navVoiceId === voiceId ? plan : activeFetched;
  const activeOpen = activePlan ? activePlan.items.length + activePlan.missingText : 0;

  const busy = progress !== null;
  const activeName = voices.find((v) => v.id === navVoiceId)?.name ?? null;

  async function guarded(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setErr(null);
    try {
      await fn();
    } catch {
      setErr("Gerade nicht erreichbar. Bitte nochmal versuchen.");
    } finally {
      lock.current = false;
      setProgress(null);
    }
  }

  function generate(cells: NavCell[], force: boolean) {
    return guarded(async () => {
      for (let i = 0; i < cells.length; i++) {
        setProgress(`${i + 1}/${cells.length}`);
        const c = cells[i];
        const r = await voiceNavPrompt({ voiceId, key: c.key, lang: c.lang, force });
        if (!r.ok) {
          setErr(`${c.lang} ${KEY_LABEL[c.key]}: ${adminErrorText(r.error)}`);
          break;
        }
      }
      await load(voiceId);
    });
  }

  function listen(c: NavCell) {
    return guarded(async () => {
      setProgress("…");
      const r = await voiceNavPrompt({ voiceId, key: c.key, lang: c.lang });
      if (r.ok && r.previewUrl) setPlayUrl(r.previewUrl);
      else setErr(adminErrorText(r.error));
      await load(voiceId);
    });
  }

  function activate() {
    return guarded(async () => {
      setProgress("…");
      const r = await setNavVoice(voiceId);
      if (!r.ok) setErr(adminErrorText(r.error));
      startTransition(() => router.refresh());
    });
  }

  function deactivate() {
    return guarded(async () => {
      setProgress("…");
      const r = await clearNavVoice();
      if (!r.ok) setErr(adminErrorText(r.error));
      startTransition(() => router.refresh());
    });
  }

  const cellAt = (key: NavPromptKey, lang: string) => plan?.cells.find((c) => c.key === key && c.lang === lang);
  const sel = selected ? cellAt(selected.key, selected.lang) : undefined;
  const selOk = sel && (sel.state === "ok" || sel.state === "unhashed");
  const regenerable = plan?.cells.filter((c) => c.state !== "missing_text") ?? [];

  return (
    <div className="rounded-[16px] bg-white p-5 shadow-sm ring-1 ring-black/[0.04]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-ink">Ansagen der Wanderführung</h2>
        {activeName ? (
          <span className="flex items-center gap-2">
            <span className={STATUS_ACCENT}>Aktiv: {activeName}</span>
            {activeOpen > 0 && <span className={STATUS_ACCENT}>{activeOpen} offen</span>}
          </span>
        ) : (
          <span className="text-[12px] text-muted">System-Stimme</span>
        )}
      </div>
      {err && <p className="mt-2 text-[13px] font-medium text-accent">{err}</p>}

      {voices.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">Keine Stimme mit ElevenLabs-ID angelegt.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <select className={inputCls} value={voiceId} onChange={(e) => {
              setVoiceId(e.target.value);
              setPlan(null);
              setSelected(null);
              setPlayUrl(null);
            }} disabled={busy}>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>

          {!plan ? (
            <p className="text-[13px] text-muted">
              <Busy>Lädt</Busy>
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="border-separate border-spacing-1 text-[11px]">
                  <thead>
                    <tr>
                      <th />
                      {LOCALE_CODES.map((l) => (
                        <th key={l} className="px-1 font-semibold uppercase text-muted">
                          {l}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {NAV_PROMPT_KEYS.map((k) => (
                      <tr key={k}>
                        <th className="whitespace-nowrap pr-2 text-left text-[12px] font-medium text-ink">{KEY_LABEL[k]}</th>
                        {LOCALE_CODES.map((l) => {
                          const c = cellAt(k, l);
                          const m = STATE_MARK[c?.state ?? "missing"];
                          const on = selected?.key === k && selected.lang === l;
                          return (
                            <td key={l}>
                              <button
                                type="button"
                                title={m.title}
                                aria-label={`${KEY_LABEL[k]} ${l}: ${m.title}`}
                                onClick={() => {
                                  setSelected({ key: k, lang: l });
                                  setPlayUrl(null);
                                }}
                                className={`h-7 w-7 cursor-pointer rounded-[8px] text-[13px] font-bold ${m.cls} ${on ? "ring-2 ring-accent" : ""}`}
                              >
                                {m.mark}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {sel && (
                <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-black/10 px-3 py-2">
                  <span className="text-[13px] font-semibold text-ink">
                    {KEY_LABEL[sel.key]} · {sel.lang}
                  </span>
                  {selOk && (
                    <button type="button" className={btnSoft} disabled={busy} onClick={() => listen(sel)}>
                      Anhören
                    </button>
                  )}
                  {sel.state !== "missing_text" && (
                    <button
                      type="button"
                      className={btnSoft}
                      disabled={busy}
                      onClick={() => {
                        if (confirm(`${KEY_LABEL[sel.key]} (${sel.lang}) neu aufnehmen?`)) void generate([sel], true);
                      }}
                    >
                      Neu aufnehmen
                    </button>
                  )}
                  {playUrl && <audio controls autoPlay src={playUrl} className="h-8 w-full" />}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={btnAccent}
                  disabled={busy || plan.items.length === 0}
                  onClick={() => generate(plan.items, false)}
                >
                  {progress !== null ? (
                    <Busy>{progress}</Busy>
                  ) : (
                    `Fehlende erzeugen (${plan.items.length} Dateien, ca. ${plan.chars} Zeichen)`
                  )}
                </button>
                <button
                  type="button"
                  className={btnSoft}
                  disabled={busy || regenerable.length === 0}
                  onClick={() => {
                    if (confirm(`Alle ${regenerable.length} Ansagen neu aufnehmen?`)) void generate(regenerable, true);
                  }}
                >
                  Alle neu aufnehmen
                </button>
                <button
                  type="button"
                  className={btnAccent}
                  disabled={busy || !navVoiceGate(plan) || voiceId === navVoiceId}
                  onClick={activate}
                >
                  Als Ansage-Stimme aktivieren
                </button>
                {navVoiceId && (
                  <button type="button" className={btnSoft} disabled={busy} onClick={deactivate}>
                    System-Stimme
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
