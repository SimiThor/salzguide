"use client";

import { useState, useTransition } from "react";
import { setSupportStatus, deleteSupportRequest } from "@/lib/support-actions";
import type { AdminSupportRequest } from "@/lib/admin";

// Arbeitsliste der Service-Anfragen. Entscheidet nichts — beide Aktionen prüfen die
// Admin-Rolle serverseitig, und RLS prüft nochmal.

const dtFmt = new Intl.DateTimeFormat("de-AT", {
  timeZone: "Europe/Vienna",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const fmt = (iso: string) => dtFmt.format(new Date(iso));

// Wie lange wartet die Person schon? Die Zahl, die man beim Draufschauen braucht.
function waitedDays(iso: string): number {
  return Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
}

function Row({ r }: { r: AdminSupportRequest }) {
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);
  const [done, setDone] = useState(r.status === "done");
  const [err, setErr] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

  if (gone) return null;

  const days = waitedDays(r.createdAt);
  const foreign = r.locale && r.locale !== "de";

  function toggle() {
    setErr("");
    start(async () => {
      const res = await setSupportStatus(r.id, !done);
      if (res.ok) setDone(!done);
      else setErr(res.error ?? "Fehlgeschlagen");
    });
  }

  function remove() {
    setErr("");
    start(async () => {
      const res = await deleteSupportRequest(r.id);
      if (res.ok) setGone(true);
      else setErr(res.error ?? "Fehlgeschlagen");
    });
  }

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            {r.name || "(kein Name)"}{" "}
            <a href={`mailto:${r.email}`} className="font-normal text-muted underline">
              {r.email}
            </a>
          </p>
          <p className="text-[12px] text-muted">
            {fmt(r.createdAt)}
            {!done && days > 0 && ` · wartet ${days} Tag${days === 1 ? "" : "e"}`}
            {r.hasAccount ? " · hat Konto" : " · kein Konto"}
            {/* Die Sprache ist keine Deko: Sie sagt, worin geantwortet werden muss. */}
            {foreign && ` · schreibt ${r.locale}`}
            {done && r.handledByEmail && ` · erledigt von ${r.handledByEmail}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            disabled={pending}
            className="rounded-full bg-black/5 px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
          >
            {done ? "Wieder öffnen" : "Erledigt"}
          </button>
          {confirmDel ? (
            <>
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Wirklich löschen
              </button>
              <button
                type="button"
                onClick={() => setConfirmDel(false)}
                className="text-xs text-muted"
              >
                Abbrechen
              </button>
            </>
          ) : (
            // Zweistufig: Hier stehen fremde Daten, und Löschen ist endgültig.
            <button
              type="button"
              onClick={() => setConfirmDel(true)}
              disabled={pending}
              className="rounded-full px-2 py-1.5 text-xs text-muted disabled:opacity-50"
              title="Löschen (Art. 17 DSGVO)"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* whitespace-pre-line: Die Nachricht behält ihre Absätze. Sie ist Text vom Menschen,
          kein Datensatz — als Wurst gelesen verliert man den Sinn. */}
      <p className="whitespace-pre-line rounded-[12px] bg-black/[0.03] p-3 text-[13px] leading-relaxed text-ink">
        {r.message}
      </p>

      {err && <p className="text-[12px] text-accent">{err}</p>}
    </li>
  );
}

export default function AdminSupportList({ requests }: { requests: AdminSupportRequest[] }) {
  if (requests.length === 0) {
    return (
      <p className="rounded-[16px] bg-white p-5 text-sm text-muted shadow-sm">
        Nichts hier. Keine Anfrage offen.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-black/5 overflow-hidden rounded-[16px] bg-white shadow-sm">
      {requests.map((r) => (
        <Row key={r.id} r={r} />
      ))}
    </ul>
  );
}
