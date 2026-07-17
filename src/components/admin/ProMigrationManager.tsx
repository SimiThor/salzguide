"use client";

import { useState, useTransition } from "react";
import {
  addProMigrations,
  removeProMigration,
  parseEmails,
} from "@/lib/migration-actions";
import type { ProMigrationList } from "@/lib/admin";

// Adressen einfügen, prüfen, speichern.
//
// DIE VORSCHAU IST DER PUNKT: Wer 100 Adressen aus einem WordPress-Export hineinkopiert,
// soll VOR dem Speichern sehen, wie viele gültig sind und was verworfen wird. Ohne sie
// klickt man auf Speichern und hofft — und ein Tippfehler in einer Adresse heisst, dass ein
// zahlender Kunde vor der Tür steht und keiner weiss warum.

const dtFmt = new Intl.DateTimeFormat("de-AT", {
  timeZone: "Europe/Vienna",
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});
const fmt = (iso: string) => dtFmt.format(new Date(iso));

export default function ProMigrationManager({ list }: { list: ProMigrationList }) {
  const [raw, setRaw] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<{ valid: string[]; invalid: string[] } | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  function check() {
    setErr("");
    setMsg("");
    start(async () => setPreview(await parseEmails(raw)));
  }

  function save() {
    setErr("");
    setMsg("");
    start(async () => {
      const r = await addProMigrations(raw, note);
      if (!r.ok) {
        setErr(r.error === "empty" ? "Keine gültige Adresse dabei." : (r.error ?? "Fehlgeschlagen"));
        return;
      }
      setMsg(
        `${r.added} eingetragen` +
          (r.skipped ? `, ${r.skipped} standen schon drauf` : "") +
          ". Lade die Seite neu, um sie unten zu sehen.",
      );
      setRaw("");
      setPreview(null);
    });
  }

  function remove(email: string) {
    setErr("");
    start(async () => {
      const r = await removeProMigration(email);
      if (!r.ok) setErr(r.error ?? "Fehlgeschlagen");
      else setMsg(`${email} entfernt. Lade die Seite neu.`);
    });
  }

  return (
    <div className="space-y-4">
      {/* Fortschritt: die eine Zahl, die man am Umzugstag wirklich braucht. */}
      <div className="flex flex-wrap gap-3">
        {[
          { label: "auf der Liste", value: list.total },
          { label: "haben sich angemeldet", value: list.claimed },
          { label: "stehen noch aus", value: list.open },
        ].map((s) => (
          <div key={s.label} className="flex-1 rounded-[16px] bg-white p-4 shadow-sm">
            <p className="text-[22px] font-bold leading-none text-ink">{s.value}</p>
            <p className="mt-1 text-[12px] text-muted">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-3 rounded-[16px] bg-white p-5 shadow-sm">
        <h2 className="text-[15px] font-semibold text-ink">Adressen einfügen</h2>
        <p className="text-xs text-muted">
          Eine pro Zeile, Komma oder Semikolon gehen auch — so exportieren die meisten
          Plugins. Gross/klein ist egal, wir schreiben alles klein. Wer schon draufsteht,
          wird übersprungen, nicht überschrieben.
        </p>
        <textarea
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setPreview(null);
          }}
          rows={7}
          placeholder={"anna@example.at\nberni@example.at, chris@example.at"}
          className="w-full resize-y rounded-[12px] border border-black/10 bg-white px-3 py-2 font-mono text-[13px] text-ink outline-none focus:border-accent"
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder="Notiz, z. B. „Export Membership-Plugin 17.07.2026“"
          className="w-full rounded-[12px] border border-black/10 bg-white px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={check}
            disabled={pending || !raw.trim()}
            className="rounded-full bg-black/5 px-4 py-2 text-xs font-semibold text-ink disabled:opacity-50"
          >
            Prüfen
          </button>
          {/* Speichern erst NACH dem Prüfen: Man soll die Zahl gesehen haben. */}
          <button
            type="button"
            onClick={save}
            disabled={pending || !preview || preview.valid.length === 0}
            className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {pending ? "…" : preview ? `${preview.valid.length} eintragen` : "Erst prüfen"}
          </button>
        </div>

        {preview && (
          <div className="rounded-[12px] bg-black/[0.03] p-3 text-[12px] leading-relaxed">
            <p className="font-semibold text-ink">
              {preview.valid.length} gültige Adresse{preview.valid.length === 1 ? "" : "n"}
            </p>
            {preview.invalid.length > 0 && (
              <p className="mt-1 text-accent">
                {preview.invalid.length} verworfen: {preview.invalid.join(", ")}
              </p>
            )}
            <p className="mt-1 break-all text-muted">
              {preview.valid.slice(0, 5).join(", ")}
              {preview.valid.length > 5 && ` … und ${preview.valid.length - 5} weitere`}
            </p>
          </div>
        )}

        {msg && <p className="text-[12px] text-ink">{msg}</p>}
        {err && <p className="text-[12px] text-accent">{err}</p>}
      </div>

      {list.rows.length > 0 && (
        <ul className="divide-y divide-black/5 overflow-hidden rounded-[16px] bg-white shadow-sm">
          {list.rows.map((r) => (
            <li key={r.email} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[13px] text-ink">{r.email}</p>
                <p className="text-[11px] text-muted">
                  {r.claimedAt
                    ? `angemeldet ${fmt(r.claimedAt)}`
                    : `wartet seit ${fmt(r.createdAt)}`}
                  {r.note && ` · ${r.note}`}
                </p>
              </div>
              {r.claimedAt ? (
                <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-muted">
                  eingelöst
                </span>
              ) : (
                // Nur offene lassen sich entfernen. Eine eingelöste Zeile ist der Beleg,
                // warum dieser Mensch Pro hat — die löscht man nicht nebenbei weg.
                <button
                  type="button"
                  onClick={() => remove(r.email)}
                  disabled={pending}
                  className="shrink-0 rounded-full px-2 py-1 text-[11px] text-muted disabled:opacity-50"
                  title="Von der Liste nehmen"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
