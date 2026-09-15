"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { deleteVoice, previewVoice, saveVoice, setDefaultVoice } from "@/lib/tts-voice-actions";
import type { VoiceUsage } from "@/lib/tts-voices";
import { VOICE_KINDS, type VoiceKind, type VoiceRow } from "@/lib/tts-rules";
import { adminErrorText } from "@/lib/admin-errors";
import { STATUS_ACCENT, STATUS_NEUTRAL } from "@/lib/ui";
import AiButton from "./AiButton";
import { blockEnterSubmit } from "./form-utils";
import Busy from "@/components/Busy";

// Liste der Stimmen mit Anlegen/Bearbeiten in der Zeile (Muster CategoryManager). Still,
// ohne Erklärtexte: Die Regeln erzwingt das Speichern (saveVoice), das Wissen steht in
// tts-rules.ts. Was man hier braucht, ist die ID aus ElevenLabs, ein Name und die Art.

const KIND_LABEL: Record<VoiceKind, string> = {
  synthetic: "Kunststimme",
  cloned: "Geklonte Stimme einer echten Person",
  human: "Echte Aufnahme (selbst hochgeladen)",
};

const inputCls =
  "w-full rounded-[12px] border border-black/10 bg-white px-3 py-2 text-[15px] text-ink outline-none focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-muted";

function VoiceForm({
  initial,
  envVoiceId,
  onDone,
  onCancel,
}: {
  initial?: VoiceRow;
  envVoiceId: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<VoiceKind>(initial?.kind ?? "cloned");
  const [personName, setPersonName] = useState(initial?.personName ?? "");
  // Die Standard-Stimme ohne ID bekommt den ENV-Wert vorbelegt (einmal speichern, fertig).
  const [elevenVoiceId, setElevenVoiceId] = useState(
    initial?.elevenVoiceId ?? (initial?.isDefault ? (envVoiceId ?? "") : ""),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const idLocked = Boolean(initial?.elevenVoiceId);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr("");
    // try/finally: Wirft die Action, bliebe der Knopf sonst für immer auf „Speichert".
    try {
      const r = await saveVoice({ id: initial?.id, name, kind, elevenVoiceId, personName });
      if (r.ok) onDone();
      else setErr(adminErrorText(r.error));
    } catch {
      setErr("Gerade nicht erreichbar. Bitte nochmal versuchen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      onKeyDown={blockEnterSubmit}
      className="space-y-3 rounded-[12px] border border-black/10 bg-black/[0.02] p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>
            Name <span className="text-accent">*</span>
          </label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Simon" />
        </div>
        <div>
          <label className={labelCls}>Art</label>
          <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as VoiceKind)}>
            {VOICE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        {kind !== "synthetic" && (
          <div>
            <label className={labelCls}>
              Name der Person (steht im Player) <span className="text-accent">*</span>
            </label>
            <input
              className={inputCls}
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="z. B. Simon"
            />
          </div>
        )}
        {kind !== "human" && (
          <div>
            <label className={labelCls}>ElevenLabs Voice-ID</label>
            <input
              className={`${inputCls} font-mono text-[13px]`}
              value={elevenVoiceId}
              onChange={(e) => setElevenVoiceId(e.target.value)}
              disabled={idLocked}
              title={idLocked ? "Mit dieser Stimme gibt es schon Dateien; für eine neue ID eine neue Stimme anlegen." : undefined}
              placeholder="21m00Tcm4TlvDq8ikWAM"
              spellCheck={false}
              autoCapitalize="off"
            />
          </div>
        )}
      </div>
      {err && <p className="text-[13px] font-medium text-accent">{err}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="cursor-pointer rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {busy ? <Busy>Speichert</Busy> : "Speichern"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="cursor-pointer rounded-full bg-black/5 px-4 py-2 text-[13px] font-semibold text-ink transition active:scale-[0.98]"
        >
          Abbrechen
        </button>
      </div>
    </form>
  );
}

export default function VoiceManager({
  voices,
  usage,
  envVoiceId,
}: {
  voices: VoiceRow[];
  usage: Record<string, VoiceUsage>;
  envVoiceId: string | null;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<Record<string, string>>({});
  const [listErr, setListErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const done = () => {
    setEditingId(null);
    setCreating(false);
    startTransition(() => router.refresh());
  };

  async function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    if (busyId) return;
    setListErr(null);
    setBusyId(id);
    try {
      const r = await fn();
      if (r.ok) {
        setConfirmDelete(null);
        startTransition(() => router.refresh());
      } else {
        setConfirmDelete(null);
        setListErr(adminErrorText(r.error));
      }
    } catch {
      setListErr("Gerade nicht erreichbar. Bitte nochmal versuchen.");
    } finally {
      setBusyId(null);
    }
  }

  async function onPreview(id: string) {
    if (previewing) return;
    setListErr(null);
    setPreviewing(id);
    try {
      const r = await previewVoice(id);
      if (r.ok && r.dataUrl) setPreviewUrl((p) => ({ ...p, [id]: r.dataUrl! }));
      else setListErr(adminErrorText(r.error));
    } catch {
      setListErr("Gerade nicht erreichbar. Bitte nochmal versuchen.");
    } finally {
      setPreviewing(null);
    }
  }

  const usageText = (id: string) => {
    const u = usage[id] ?? { tours: 0, files: 0 };
    if (!u.tours && !u.files) return "ungenutzt";
    return `${u.tours} ${u.tours === 1 ? "Runde" : "Runden"} · ${u.files} ${u.files === 1 ? "Datei" : "Dateien"}`;
  };

  return (
    <div className="rounded-[16px] bg-white p-5 shadow-sm ring-1 ring-black/[0.04]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-ink">Stimmen ({voices.length})</h2>
        <button
          type="button"
          onClick={() => {
            setCreating(true);
            setEditingId(null);
          }}
          className="cursor-pointer rounded-full bg-black/5 px-3 py-1 text-[12px] font-semibold text-ink transition active:scale-95"
        >
          + Neue Stimme
        </button>
      </div>
      {listErr && <p className="mt-2 text-[13px] font-medium text-accent">{listErr}</p>}

      <div className="mt-3 space-y-2">
        {creating && (
          <VoiceForm envVoiceId={envVoiceId} onDone={done} onCancel={() => setCreating(false)} />
        )}

        {voices.length === 0 && !creating && (
          <p className="py-2 text-[13px] text-muted">Noch keine Stimme angelegt.</p>
        )}

        {voices.map((v) =>
          editingId === v.id ? (
            <VoiceForm
              key={v.id}
              initial={v}
              envVoiceId={envVoiceId}
              onDone={done}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div key={v.id} className="rounded-[12px] border border-black/10 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-semibold text-ink">{v.name}</span>
                {v.isDefault && <span className={STATUS_ACCENT}>Standard</span>}
                <span className={STATUS_NEUTRAL}>{KIND_LABEL[v.kind]}</span>
                {v.kind !== "synthetic" && v.personName && v.personName !== v.name && (
                  <span className="text-[12px] text-muted">Person: {v.personName}</span>
                )}
              </div>
              <p className="mt-1 text-[12px] text-muted">
                {usageText(v.id)}
                {v.kind !== "human" && (
                  <>
                    {" · ID "}
                    <span className="font-mono">{v.elevenVoiceId ?? (v.isDefault && envVoiceId ? `${envVoiceId} (aus ENV)` : "fehlt")}</span>
                  </>
                )}
              </p>
              {previewUrl[v.id] && (
                <audio controls autoPlay src={previewUrl[v.id]} className="mt-2 h-8 w-full" />
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {v.kind !== "human" && (
                  <AiButton
                    loading={previewing === v.id}
                    loadingLabel="Spricht"
                    onClick={() => onPreview(v.id)}
                    disabled={Boolean(previewing) || Boolean(busyId)}
                    className="rounded-full bg-accent px-3 py-1.5 text-[12px] font-semibold text-white"
                  >
                    Probehören
                  </AiButton>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(v.id);
                    setCreating(false);
                  }}
                  disabled={Boolean(busyId)}
                  className="cursor-pointer rounded-full bg-black/5 px-3 py-1.5 text-[12px] font-semibold text-ink transition active:scale-95"
                >
                  Bearbeiten
                </button>
                {!v.isDefault && (
                  <button
                    type="button"
                    onClick={() => run(v.id, () => setDefaultVoice(v.id))}
                    disabled={Boolean(busyId)}
                    className="cursor-pointer rounded-full bg-black/5 px-3 py-1.5 text-[12px] font-semibold text-ink transition active:scale-95"
                  >
                    {busyId === v.id ? <Busy>Setzt</Busy> : "Als Standard"}
                  </button>
                )}
                {confirmDelete === v.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => run(v.id, () => deleteVoice(v.id))}
                      disabled={Boolean(busyId)}
                      className="cursor-pointer rounded-full bg-accent px-3 py-1.5 text-[12px] font-semibold text-white transition active:scale-95"
                    >
                      {busyId === v.id ? <Busy>Löscht</Busy> : "Wirklich löschen"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      className="cursor-pointer rounded-full bg-black/5 px-3 py-1.5 text-[12px] font-semibold text-ink transition active:scale-95"
                    >
                      Abbrechen
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(v.id)}
                    disabled={Boolean(busyId) || v.isDefault || Boolean(usage[v.id]?.tours || usage[v.id]?.files)}
                    title={
                      v.isDefault
                        ? "Die Standard-Stimme kann nicht gelöscht werden."
                        : usage[v.id]?.tours || usage[v.id]?.files
                          ? "Diese Stimme spricht noch in Runden oder Dateien."
                          : undefined
                    }
                    className="cursor-pointer rounded-full bg-black/5 px-3 py-1.5 text-[12px] font-semibold text-accent transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Löschen
                  </button>
                )}
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
