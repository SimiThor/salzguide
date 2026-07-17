"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { routing } from "@/i18n/routing";
import { localeMeta } from "@/i18n/locales";
import { saveLocal, deleteLocal, translateLocalRole } from "@/lib/admin-actions";
import type { AdminLocalFull } from "@/lib/admin";
import AiButton from "./AiButton";
import { IMMUTABLE_CACHE_SECONDS } from "@/lib/storage";

const LOCALES = routing.locales;
const TARGET_LOCALES = LOCALES.filter((l) => l !== "de");

const inputCls =
  "w-full rounded-[10px] bg-white px-3 py-2 text-[14px] text-ink ring-1 ring-black/[0.08] outline-none focus:ring-2 focus:ring-accent/40";

// Foto clientseitig auf WebP + max. Kantenlänge verkleinern (wie AreaForm-Cover).
async function fileToWebp(file: File, maxDim = 512, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob: Blob | null = await new Promise((res) =>
    canvas.toBlob((b) => res(b), "image/webp", quality),
  );
  if (!blob) throw new Error("webp");
  return blob;
}

function LocalForm({
  initial,
  onDone,
  onCancel,
}: {
  initial?: AdminLocalFull;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initial?.avatarUrl ?? null);
  const [roles, setRoles] = useState<Record<string, string>>(() => {
    const r: Record<string, string> = {};
    for (const l of LOCALES) r[l] = initial?.roleI18n[l] ?? "";
    return r;
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const translatedCount = TARGET_LOCALES.filter((l) => roles[l]?.trim()).length;

  async function onUpload(file: File) {
    setErr(null);
    setUploading(true);
    try {
      const supabase = createClient();
      const blob = await fileToWebp(file);
      const path = `locals/local-${crypto.randomUUID()}.webp`;
      const { error } = await supabase.storage
        .from("spot-media")
        .upload(path, blob, { contentType: "image/webp", upsert: false, cacheControl: IMMUTABLE_CACHE_SECONDS });
      if (error) throw new Error(error.message);
      setAvatarUrl(supabase.storage.from("spot-media").getPublicUrl(path).data.publicUrl);
    } catch {
      setErr("Foto-Upload hat nicht geklappt.");
    } finally {
      setUploading(false);
    }
  }

  async function onTranslate() {
    setErr(null);
    if (!roles.de?.trim()) return setErr("Bitte zuerst die deutsche Rolle eingeben.");
    setTranslating(true);
    const r = await translateLocalRole(roles.de);
    setTranslating(false);
    if (r.ok && r.translations) setRoles((p) => ({ ...p, ...r.translations }));
    else setErr(r.error === "ai" ? "Übersetzen hat nicht geklappt." : (r.error ?? "Fehler"));
  }

  async function onSave() {
    setErr(null);
    if (!name.trim()) return setErr("Bitte einen Namen eingeben.");
    setBusy(true);
    const r = await saveLocal({
      id: initial?.id,
      name,
      role: roles.de ?? "",
      roleI18n: roles,
      avatarUrl,
    });
    setBusy(false);
    if (r.ok) onDone();
    else
      setErr(
        r.error === "db" || r.error === "bad_url"
          ? "Speichern hat nicht geklappt."
          : (r.error ?? "Fehler"),
      );
  }

  const initialLetter = (name.trim() || "?").charAt(0).toUpperCase();

  return (
    <div className="rounded-[14px] bg-black/[0.02] p-4 ring-1 ring-black/[0.05]">
      {/* Name + Foto */}
      <div className="flex items-center gap-4">
        <div className="shrink-0">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/15 text-lg font-semibold text-accent">
              {initialLetter}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <span className="mb-1 block text-[12px] font-medium text-muted">
            Name <span className="text-accent">*</span>
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z.B. Anton"
            className={inputCls}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-full bg-black/5 px-3 py-1.5 text-[12px] font-semibold text-ink">
              {uploading ? "Lädt …" : avatarUrl ? "Foto ersetzen" : "Foto wählen"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onUpload(f);
                  e.target.value = "";
                }}
              />
            </label>
            {avatarUrl && (
              <button
                type="button"
                onClick={() => setAvatarUrl(null)}
                className="rounded-full px-2 py-1 text-[12px] font-medium text-muted"
              >
                entfernen
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Rolle je Sprache */}
      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] font-medium text-muted">
            Rolle (z.B. Local aus Salzburg) · {translatedCount}/{TARGET_LOCALES.length} Sprachen
          </span>
          <AiButton
            loading={translating}
            loadingLabel="Übersetzt"
            onClick={onTranslate}
            disabled={!roles.de?.trim()}
            className="rounded-full bg-black/5 px-3 py-1.5 text-[12px] font-semibold text-ink"
          >
            🌍 In alle Sprachen übersetzen
          </AiButton>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {LOCALES.map((l) => (
            <label key={l} className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted">
                {localeMeta(l).flag} {localeMeta(l).english}
                {l === "de" && <span className="text-accent"> (Quelle)</span>}
              </span>
              <input
                value={roles[l] ?? ""}
                onChange={(e) => setRoles((p) => ({ ...p, [l]: e.target.value }))}
                placeholder={l === "de" ? "Local aus Salzburg" : ""}
                className={inputCls}
              />
            </label>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-muted">
          Fehlt eine Sprache, wird die deutsche Rolle angezeigt. Name & Foto gelten für alle Sprachen.
        </p>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-3 py-1.5 text-[13px] font-medium text-muted"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy || uploading}
          className="rounded-full bg-accent px-4 py-1.5 text-[13px] font-semibold text-white transition active:scale-95 disabled:opacity-50"
        >
          {busy ? "Speichert …" : "Speichern"}
        </button>
      </div>
      {err && <p className="mt-2 text-[13px] font-medium text-accent">{err}</p>}
    </div>
  );
}

export default function LocalManager({ locals }: { locals: AdminLocalFull[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [delErr, setDelErr] = useState<string | null>(null);

  const done = () => {
    setEditingId(null);
    setCreating(false);
    router.refresh();
  };

  async function onDelete(id: string) {
    setDelErr(null);
    const r = await deleteLocal(id);
    setConfirmDelete(null);
    if (r.ok) router.refresh();
    else if (r.error?.startsWith("in_use:"))
      setDelErr(
        `Dieser Local wird noch bei ${r.error.split(":")[1]} Spot(s) verwendet – dort erst einen anderen Local wählen.`,
      );
    else setDelErr("Löschen hat nicht geklappt.");
  }

  return (
    <div className="rounded-[16px] bg-white p-5 shadow-sm ring-1 ring-black/[0.04]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">Locals (Insider-Tipp-Autoren)</h2>
        <button
          type="button"
          onClick={() => {
            setCreating(true);
            setEditingId(null);
          }}
          className="rounded-full bg-black/5 px-3 py-1 text-[12px] font-semibold text-ink transition active:scale-95"
        >
          + Neuer Local
        </button>
      </div>
      <p className="mt-1 text-[13px] text-muted">
        Empfehlende mit Foto & Rolle. Beim Spot wählst du den Local aus – die Rolle erscheint
        in der Sprache des Nutzers. Name & Foto gelten überall.
      </p>

      <div className="mt-4 space-y-2">
        {creating && <LocalForm onDone={done} onCancel={() => setCreating(false)} />}

        {locals.length === 0 && !creating && (
          <p className="py-2 text-[13px] text-muted">Noch keine Locals.</p>
        )}

        {locals.map((l) =>
          editingId === l.id ? (
            <LocalForm
              key={l.id}
              initial={l}
              onDone={done}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div
              key={l.id}
              className="flex items-center gap-3 rounded-[12px] bg-black/[0.02] px-3 py-2.5 ring-1 ring-black/[0.04]"
            >
              {l.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
                  {(l.name.trim() || "?").charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-ink">{l.name}</p>
                <p className="truncate text-[11px] text-muted">
                  {l.role || "keine Rolle"}
                  {" · "}
                  <span
                    className={
                      TARGET_LOCALES.every((t) => l.roleI18n[t]?.trim())
                        ? "text-green-700"
                        : "text-amber-700"
                    }
                  >
                    🌍 {TARGET_LOCALES.filter((t) => l.roleI18n[t]?.trim()).length}/
                    {TARGET_LOCALES.length}
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {confirmDelete === l.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onDelete(l.id)}
                      className="rounded-full bg-accent px-3 py-1 text-[12px] font-semibold text-white"
                    >
                      Löschen
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      className="rounded-full px-2 py-1 text-[12px] font-medium text-muted"
                    >
                      Abbrechen
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(l.id);
                        setCreating(false);
                      }}
                      className="rounded-full bg-black/5 px-3 py-1 text-[12px] font-semibold text-ink transition active:scale-95"
                    >
                      Bearbeiten
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDelErr(null);
                        setConfirmDelete(l.id);
                      }}
                      aria-label="Löschen"
                      className="rounded-full px-2 py-1 text-[12px] font-medium text-muted transition hover:text-accent"
                    >
                      Löschen
                    </button>
                  </>
                )}
              </div>
            </div>
          ),
        )}
        {delErr && <p className="text-[13px] font-medium text-accent">{delErr}</p>}
      </div>
    </div>
  );
}
