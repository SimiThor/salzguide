"use client";

import { useState, useTransition } from "react";
import {
  addProMigrations,
  removeProMigration,
  parseEmails,
  sendMigrationAnnouncement,
  setRelaunchNotice,
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

export default function ProMigrationManager({
  list,
  noticeOn,
}: {
  list: ProMigrationList;
  noticeOn: boolean;
}) {
  const [notice, setNotice] = useState(noticeOn);
  const [announce, setAnnounce] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);
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

  function toggleNotice() {
    setErr("");
    const next = !notice;
    start(async () => {
      const r = await setRelaunchNotice(next);
      if (r.ok) setNotice(next);
      else setErr(r.error ?? "Fehlgeschlagen");
    });
  }

  function sendAll() {
    setErr("");
    setAnnounce("");
    setConfirmSend(false);
    start(async () => {
      const r = await sendMigrationAnnouncement();
      if (!r.ok) {
        setErr(r.error ?? "Fehlgeschlagen");
        return;
      }
      setAnnounce(
        r.sent === 0 && r.failed === 0
          ? "Alle haben die Ankündigung schon."
          : `${r.sent} verschickt` +
              (r.failed ? `, ${r.failed} fehlgeschlagen (beim nächsten Klick nochmal)` : "") +
              ". Lade die Seite neu.",
      );
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

      {/* Ankündigung. Steht ÜBER dem Einfügen, weil das die Reihenfolge am Umzugstag ist:
          erst Adressen rein, dann Mail raus, dann Hinweis an. */}
      <div className="space-y-3 rounded-[16px] bg-white p-5 shadow-sm">
        <h2 className="text-[15px] font-semibold text-ink">Ankündigung verschicken</h2>
        <p className="text-xs leading-relaxed text-muted">
          Eine Mail an alle, die sie noch nicht haben: Was neu ist, dass ihr Pro unbegrenzt
          bleibt, und wie sie sich anmelden (E-Mail eingeben, Link antippen, kein Passwort
          mehr). Wer schon angeschrieben wurde, bekommt sie <strong>nicht nochmal</strong> —
          jede Adresse wird einzeln vermerkt, sobald ihre Mail draußen ist. Bricht der Lauf
          ab, schickt der nächste Klick genau den Rest.
        </p>
        {confirmSend ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-ink">
              An {list.total - list.claimed} Menschen wirklich senden?
            </span>
            <button
              type="button"
              onClick={sendAll}
              disabled={pending}
              className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {pending ? "sendet …" : "Ja, senden"}
            </button>
            <button type="button" onClick={() => setConfirmSend(false)} className="text-xs text-muted">
              Abbrechen
            </button>
          </div>
        ) : (
          // Zweistufig: Eine Mail an 100 zahlende Kunden holt man nicht zurück.
          <button
            type="button"
            onClick={() => setConfirmSend(true)}
            disabled={pending || list.total === 0}
            className="rounded-full bg-black/5 px-4 py-2 text-xs font-semibold text-ink disabled:opacity-50"
          >
            ✉️ Ankündigung senden
          </button>
        )}
        {announce && <p className="text-[12px] text-ink">{announce}</p>}
      </div>

      {/* Der Hinweis am Login. */}
      <div className="space-y-2 rounded-[16px] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-ink">Hinweis auf der Anmeldeseite</h2>
          <button
            type="button"
            onClick={toggleNotice}
            disabled={pending}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
              notice ? "bg-accent text-white" : "bg-black/5 text-ink"
            }`}
          >
            {notice ? "An" : "Aus"}
          </button>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Zeigt beim Anmelden für <strong>alle</strong> einen Satz: {"„"}SalzGuide ist neu
          gebaut. Schon auf der alten Seite gekauft? Melde dich mit derselben E-Mail an, dein
          Pro ist da.{"“"}
        </p>
        <p className="text-xs leading-relaxed text-muted">
          Für alle, weil wir die eingegebene Adresse bewusst <strong>nicht</strong> prüfen:
          Ein Hinweis, der nur bei Alt-Käufern erschiene, wäre ein Automat, der jedem verrät,
          ob eine beliebige Adresse zahlender Kunde ist. Schalt ihn aus, wenn die alte Seite
          vergessen ist — für Leute, die uns zum ersten Mal besuchen, ist der Satz dann nur
          noch Ballast.
        </p>
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
