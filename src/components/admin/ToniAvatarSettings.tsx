"use client";

import { useRef, useState } from "react";
import { setToniAvatarUrl } from "@/lib/admin-actions";
import { compressSquareImage, uploadImage } from "@/lib/image-upload";
import Busy from "@/components/Busy";

export default function ToniAvatarSettings({ current }: { current: string | null }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(current);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const { blob } = await compressSquareImage(file);
      const publicUrl = await uploadImage(blob, "site");
      // Speicher-Fehler bewusst GETRENNT: Dessen Text kommt vom Server und gehört nicht
      // ungefiltert in den Admin. Die Upload-Meldungen (zu gross, kein Bild, HEIC) dagegen
      // sind für genau diesen Moment geschrieben und werden unten durchgereicht.
      const r = await setToniAvatarUrl(publicUrl);
      if (!r.ok) {
        setErr("Konnte nicht gespeichert werden. Bitte erneut versuchen.");
        return;
      }
      setUrl(publicUrl);
      setMsg("Profilbild aktualisiert. Es erscheint im KI-Chat.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload hat nicht geklappt. Bitte erneut versuchen.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onRemove() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    // try/finally wie in onFile direkt darüber: Wirft die Action, bliebe der Button
    // sonst für immer auf „Lädt …" und disabled.
    try {
      const r = await setToniAvatarUrl(null);
      if (r.ok) {
        setUrl(null);
        setMsg("Auf Standard-Platzhalter zurückgesetzt.");
      } else {
        setErr("Konnte nicht zurücksetzen.");
      }
    } catch {
      setErr("Gerade nicht erreichbar. Bitte nochmal versuchen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[16px] bg-white p-5 shadow-sm ring-1 ring-black/[0.04]">
      <h2 className="text-[15px] font-semibold text-ink">KI-Chat-Profilbild (Toni)</h2>
      <p className="mt-1 text-[13px] text-muted">
        Wird oben im Chat-Fenster angezeigt. Quadratische Fotos wirken am besten.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-2xl ring-1 ring-black/10">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : (
            "👨🏼‍🦳"
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="cursor-pointer rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <Busy>Lädt</Busy> : url ? "Bild ersetzen" : "Bild wählen"}
          </button>
          {url && (
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              className="cursor-pointer rounded-full bg-black/5 px-4 py-2 text-[13px] font-semibold text-muted transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Entfernen
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFile}
        />
      </div>
      {msg && <p className="mt-3 text-[13px] font-medium text-emerald-700">{msg}</p>}
      {err && <p className="mt-3 text-[13px] font-medium text-accent">{err}</p>}
    </div>
  );
}
