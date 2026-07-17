"use client";

import { useState, useTransition } from "react";
import {
  addProMigrations,
  removeProMigration,
  parseEmails,
  sendMigrationAnnouncement,
  sendTestAnnouncement,
  setRelaunchNotice,
  saveRelaunchMailTexts,
  previewRelaunchMail,
} from "@/lib/migration-actions";
import type { ProMigrationList } from "@/lib/admin";
import type { RelaunchMailTexts } from "@/lib/relaunch-mail";

// Der Umzug in vier Schritten, in der Reihenfolge, in der man sie wirklich macht:
// Adressen rein, Mail ansehen, Mail raus, Hinweis an.
//
// Hier stand vorher viel Fliesstext, der die Entscheidungen dahinter erklärte (warum keine
// Konten vorab, warum der Hinweis für alle gilt). Das gehört in den Code, nicht auf den
// Bildschirm: Wer diese Seite öffnet, will Adressen eintragen. Die Begründungen stehen in
// migration-actions.ts und relaunch-mail.ts, wo sie jemand liest, der sie ändern will.

const dtFmt = new Intl.DateTimeFormat("de-AT", {
  timeZone: "Europe/Vienna",
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});
const fmt = (iso: string) => dtFmt.format(new Date(iso));

const CARD = "space-y-3 rounded-[18px] bg-white p-5 shadow-sm";
const FIELD =
  "w-full rounded-[12px] border border-black/10 bg-white px-3 py-2 text-[13px] text-ink outline-none focus:border-accent";
const BTN = "rounded-full px-4 py-2 text-xs font-semibold transition disabled:opacity-50";
const BTN_SOFT = `${BTN} bg-black/5 text-ink`;
const BTN_ACCENT = `${BTN} bg-accent text-white`;

function Step({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        aria-hidden
        className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white"
      >
        {n}
      </span>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold leading-tight text-ink">{title}</h2>
        {hint && <p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p>}
      </div>
    </div>
  );
}

export default function ProMigrationManager({
  list,
  noticeOn,
  mailTexts,
}: {
  list: ProMigrationList;
  noticeOn: boolean;
  mailTexts: RelaunchMailTexts;
}) {
  const [notice, setNotice] = useState(noticeOn);
  const [texts, setTexts] = useState(mailTexts);
  const [dirty, setDirty] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [raw, setRaw] = useState("");
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState<{ valid: string[]; invalid: string[] } | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  // Eine Stelle fürs Aufräumen: Jede Aktion löscht erst die Meldung der vorigen. Sonst
  // steht nach einem Fehler noch das „Gespeichert" von davor daneben.
  const run = (fn: () => Promise<void>) => {
    setErr("");
    setMsg("");
    start(fn);
  };

  const edit = (patch: Partial<RelaunchMailTexts>) => {
    setTexts((t) => ({ ...t, ...patch }));
    setDirty(true);
  };

  return (
    <div className="space-y-4">
      {/* Der Fortschritt: die Zahlen, um die es am Umzugstag geht. */}
      <div className="flex gap-3">
        {[
          { label: "auf der Liste", value: list.total, hot: false },
          { label: "angemeldet", value: list.claimed, hot: false },
          { label: "stehen aus", value: list.open, hot: list.open > 0 },
        ].map((s) => (
          <div key={s.label} className="flex-1 rounded-[18px] bg-white p-4 shadow-sm">
            <p className={`text-[26px] font-bold leading-none ${s.hot ? "text-accent" : "text-ink"}`}>
              {s.value}
            </p>
            <p className="mt-1 text-[12px] text-muted">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── 1 ── */}
      <div className={CARD}>
        <Step
          n={1}
          title="Adressen eintragen"
          hint="Eine pro Zeile, Komma und Semikolon gehen auch. Gross/klein egal, doppelte werden übersprungen."
        />
        <textarea
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setChecked(null); // Die Prüfung gehört zum alten Text. Sonst trägt man ein, was man nicht gesehen hat.
          }}
          rows={5}
          placeholder={"anna@example.at\nberni@example.at, chris@example.at"}
          className={`${FIELD} resize-y font-mono`}
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder="Notiz (optional), z. B. Export vom 17.07."
          className={FIELD}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => run(async () => setChecked(await parseEmails(raw)))}
            disabled={pending || !raw.trim()}
            className={BTN_SOFT}
          >
            Prüfen
          </button>
          {/* Erst prüfen, dann eintragen: Man soll die Zahl gesehen haben, bevor 100
              Adressen in der Datenbank landen. */}
          <button
            type="button"
            onClick={() =>
              run(async () => {
                const r = await addProMigrations(raw, note);
                if (!r.ok) {
                  setErr(r.error === "empty" ? "Keine gültige Adresse dabei." : (r.error ?? "Fehlgeschlagen"));
                  return;
                }
                setMsg(
                  `${r.added} eingetragen${r.skipped ? `, ${r.skipped} standen schon drauf` : ""}. Seite neu laden.`,
                );
                setRaw("");
                setChecked(null);
              })
            }
            disabled={pending || !checked || checked.valid.length === 0}
            className={BTN_ACCENT}
          >
            {checked ? `${checked.valid.length} eintragen` : "Erst prüfen"}
          </button>
        </div>
        {checked && (
          <div className="rounded-[12px] bg-black/[0.03] p-3 text-[12px] leading-relaxed">
            <p>
              <span className="font-semibold text-ink">
                {checked.valid.length} gültig{checked.valid.length === 1 ? "e Adresse" : "e Adressen"}
              </span>
              {checked.invalid.length > 0 && (
                <span className="text-accent">
                  {" · "}
                  {checked.invalid.length} verworfen: {checked.invalid.join(", ")}
                </span>
              )}
            </p>
            {checked.valid.length > 0 && (
              <p className="mt-1 break-all text-muted">
                {checked.valid.slice(0, 4).join(", ")}
                {checked.valid.length > 4 && ` … +${checked.valid.length - 4}`}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── 2 ── */}
      <div className={CARD}>
        <Step
          n={2}
          title="Mail schreiben und ansehen"
          hint="Du schreibst die Worte, das Aussehen kommt aus dem Code. Ein leeres Feld nimmt den Standardtext."
        />
        <input
          type="text"
          value={texts.subject}
          onChange={(e) => edit({ subject: e.target.value })}
          maxLength={200}
          placeholder="Betreff"
          aria-label="Betreff"
          className={FIELD}
        />
        <input
          type="text"
          value={texts.headline}
          onChange={(e) => edit({ headline: e.target.value })}
          maxLength={200}
          placeholder="Überschrift"
          aria-label="Überschrift"
          className={FIELD}
        />
        <textarea
          value={texts.body}
          onChange={(e) => edit({ body: e.target.value })}
          rows={7}
          placeholder="Text. Leerzeile macht einen neuen Absatz."
          aria-label="Text"
          className={`${FIELD} resize-y leading-relaxed`}
        />
        <input
          type="text"
          value={texts.cta}
          onChange={(e) => edit({ cta: e.target.value })}
          maxLength={80}
          placeholder="Knopf-Text"
          aria-label="Knopf-Text"
          className={FIELD}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              run(async () => {
                const r = await previewRelaunchMail(texts);
                if (!r.ok) {
                  setErr(r.error ?? "Fehlgeschlagen");
                  return;
                }
                setHtml(r.html ?? null);
              })
            }
            disabled={pending}
            className={BTN_SOFT}
          >
            {html ? "Vorschau aktualisieren" : "Vorschau zeigen"}
          </button>
          <button
            type="button"
            onClick={() =>
              run(async () => {
                const r = await saveRelaunchMailTexts(texts);
                if (!r.ok) {
                  setErr(r.error ?? "Fehlgeschlagen");
                  return;
                }
                setDirty(false);
                setMsg("Gespeichert.");
              })
            }
            disabled={pending || !dirty}
            className={dirty ? BTN_ACCENT : BTN_SOFT}
          >
            {dirty ? "Speichern" : "Gespeichert"}
          </button>
          {/* Der Testknopf geht NUR an dich und markiert nichts. Die Alternative wäre
              „trag dich in die Liste ein, sende, nimm dich raus" — und beim Senden
              erwischt man dann gleich alle 100. */}
          <button
            type="button"
            onClick={() =>
              run(async () => {
                const r = await sendTestAnnouncement();
                if (!r.ok) {
                  setErr(
                    r.error === "send_failed"
                      ? "Versand fehlgeschlagen. Steht RESEND_KEY?"
                      : r.error === "no_email"
                        ? "Zu deinem Konto liegt keine Adresse vor."
                        : (r.error ?? "Fehlgeschlagen"),
                  );
                  return;
                }
                setMsg("Testmail an dich unterwegs.");
              })
            }
            disabled={pending}
            className={`${BTN} border border-accent/30 text-accent`}
          >
            ✉️ Test an mich
          </button>
        </div>
        {/* Die Testmail liest die GESPEICHERTEN Texte (sie läuft auf dem Server, ohne die
            Eingabefelder). Ungespeichert bekäme man den alten Text und hielte ihn für den
            neuen — das muss dranstehen, solange es so ist. */}
        {dirty && (
          <p className="text-[12px] text-muted">
            Noch nicht gespeichert. Die Vorschau zeigt deine Änderung, die Testmail noch nicht.
          </p>
        )}
        {html && (
          // iframe: Das Mail-CSS bleibt in der Mail und färbt nicht das Admin ein. Und es
          // ist dasselbe HTML, das rausgeht, keine Nachbildung.
          <iframe
            title="Vorschau der Umzugs-Mail"
            srcDoc={html}
            sandbox=""
            className="h-[540px] w-full rounded-[12px] border border-black/10 bg-white"
          />
        )}
      </div>

      {/* ── 3 ── */}
      <div className={CARD}>
        <Step
          n={3}
          title="An alle senden"
          hint={
            list.total === 0
              ? "Sobald Adressen auf der Liste stehen, geht die Mail von hier raus."
              : `Geht an die ${list.open}, die noch keine haben. Wer schon angeschrieben wurde, bekommt sie nicht nochmal.`
          }
        />
        {confirmSend ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-ink">
              An {list.open} {list.open === 1 ? "Menschen" : "Menschen"} senden?
            </span>
            <button
              type="button"
              onClick={() =>
                run(async () => {
                  setConfirmSend(false);
                  const r = await sendMigrationAnnouncement();
                  if (!r.ok) {
                    setErr(r.error ?? "Fehlgeschlagen");
                    return;
                  }
                  setMsg(
                    r.sent === 0 && r.failed === 0
                      ? "Alle haben sie schon."
                      : `${r.sent} verschickt${
                          r.failed ? `, ${r.failed} fehlgeschlagen (der nächste Klick versucht es nochmal)` : ""
                        }. Seite neu laden.`,
                  );
                })
              }
              disabled={pending}
              className={BTN_ACCENT}
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
            disabled={pending || list.open === 0}
            className={BTN_SOFT}
          >
            ✉️ Ankündigung an alle
          </button>
        )}
      </div>

      {/* ── 4 ── */}
      <div className={CARD}>
        <div className="flex items-start justify-between gap-3">
          <Step
            n={4}
            title="Hinweis am Login"
            hint="Steht für alle da, nicht nur für Alt-Käufer. Schalt ihn wieder aus, wenn die alte Seite vergessen ist."
          />
          <button
            type="button"
            onClick={() =>
              run(async () => {
                const next = !notice;
                const r = await setRelaunchNotice(next);
                if (!r.ok) {
                  setErr(r.error ?? "Fehlgeschlagen");
                  return;
                }
                setNotice(next);
              })
            }
            disabled={pending}
            aria-pressed={notice}
            className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
              notice ? "bg-accent text-white" : "bg-black/5 text-ink"
            }`}
          >
            {notice ? "An" : "Aus"}
          </button>
        </div>
      </div>

      {/* Eine Stelle für Meldungen, ganz unten: Vorher hatte jede Karte ihre eigene, und
          man suchte nach dem Klick, wo die Antwort steht. */}
      {msg && <p className="px-1 text-[13px] font-medium text-ink">{msg}</p>}
      {err && <p className="px-1 text-[13px] text-accent">{err}</p>}

      {list.rows.length > 0 && (
        <ul className="divide-y divide-black/5 overflow-hidden rounded-[18px] bg-white shadow-sm">
          {list.rows.map((r) => (
            <li key={r.email} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[13px] text-ink">{r.email}</p>
                <p className="text-[11px] text-muted">
                  {r.claimedAt ? `angemeldet ${fmt(r.claimedAt)}` : `wartet seit ${fmt(r.createdAt)}`}
                  {r.note && ` · ${r.note}`}
                </p>
              </div>
              {r.claimedAt ? (
                <span className="shrink-0 text-[11px] font-semibold text-muted">eingelöst</span>
              ) : (
                // Nur offene lassen sich entfernen: Eine eingelöste Zeile ist der Beleg,
                // warum dieser Mensch Pro hat.
                <button
                  type="button"
                  onClick={() =>
                    run(async () => {
                      const res = await removeProMigration(r.email);
                      if (!res.ok) {
                        setErr(res.error ?? "Fehlgeschlagen");
                        return;
                      }
                      setMsg(`${r.email} entfernt. Seite neu laden.`);
                    })
                  }
                  disabled={pending}
                  className="shrink-0 rounded-full px-2 py-1 text-[11px] text-muted disabled:opacity-50"
                  title={`${r.email} von der Liste nehmen`}
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
