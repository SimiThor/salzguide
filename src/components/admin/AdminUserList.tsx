"use client";

import { useState, useTransition } from "react";
import { setUserPro } from "@/lib/user-actions";
import { proSourceLabel } from "@/lib/pro-source";
import type { AdminUser, ProGrantEntry } from "@/lib/admin";

// Nutzerliste mit Pro-Schalter.
//
// Die Sicherheit liegt NICHT hier: Diese Datei entscheidet nichts, sie zeigt nur an und
// ruft. Wer Pro bekommt, entscheidet set_user_pro in der Datenbank (Migration 0038), und
// die Aktion davor prüft die Admin-Rolle nochmal. Was hier steht, ist Bequemlichkeit —
// ein deaktivierter Knopf ist kein Schutz, sondern eine Ansage an den, der ihn drückt.

const dateFmt = new Intl.DateTimeFormat("de-AT", {
  timeZone: "Europe/Vienna",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const fmt = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : "–");

const ERRORS: Record<string, string> = {
  stripe_pro: "Das ist bezahltes Pro. Rückerstattung in Stripe, dann entzieht der Webhook es selbst.",
  forbidden: "Keine Admin-Rechte.",
  auth: "Nicht angemeldet.",
  not_found: "Nutzer nicht gefunden.",
  bad_id: "Ungültige ID.",
  db: "Datenbank-Fehler. Steht Migration 0038 schon drin?",
};

function ProBadge({ user }: { user: AdminUser }) {
  if (!user.isPro) return <span className="text-muted">–</span>;
  // Rot hervorgehoben ist nur bezahltes Pro: Das ist das einzige, das der Admin nicht
  // anfassen darf, und genau das soll man auf einen Blick sehen.
  const label = `Pro · ${proSourceLabel(user.proSource)}`;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        user.paidPro ? "bg-accent/10 text-accent" : "bg-black/5 text-ink"
      }`}
    >
      {label}
    </span>
  );
}

function UserRow({ user, grant }: { user: AdminUser; grant?: ProGrantEntry }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  // Optimistisch NICHT: Der Server entscheidet, und bei Pro will man sehen, was WIRKLICH
  // gilt. Nach Erfolg lädt die Seite neu (router.refresh über revalidate der Action).
  const [done, setDone] = useState<boolean | null>(null);

  const isPro = done ?? user.isPro;

  function submit(next: boolean) {
    setErr("");
    start(async () => {
      const r = await setUserPro(user.id, next, note);
      if (r.ok) {
        setDone(next);
        setOpen(false);
        setNote("");
      } else {
        setErr(ERRORS[r.error ?? ""] ?? r.error ?? "Fehlgeschlagen");
      }
    });
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{user.email ?? "(keine E-Mail)"}</p>
          <p className="text-[12px] text-muted">
            seit {fmt(user.createdAt)}
            {user.role === "admin" && " · Admin"}
            {user.newsletter && " · Newsletter"}
            {isPro && user.proSince && ` · Pro seit ${fmt(user.proSince)}`}
          </p>
          {/* Die Antwort auf „warum hat der Pro?", direkt an der Zeile. Ohne sie wäre das
              Protokoll zwar da, aber niemand würde es je aufmachen. */}
          {grant && (
            <p className="mt-0.5 truncate text-[11px] text-muted/80">
              {grant.granted ? "geschenkt" : "entzogen"} {fmt(grant.createdAt)}
              {grant.adminEmail && ` von ${grant.adminEmail}`}
              {grant.note && ` · „${grant.note}"`}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ProBadge user={{ ...user, isPro }} />
          {user.paidPro ? (
            // Kein Knopf, sondern der Grund. Ein ausgegrauter Knopf sagt „geht nicht",
            // dieser Text sagt „geht woanders" — das ist die Auskunft, die man braucht.
            <span className="text-[11px] text-muted">nur über Stripe</span>
          ) : (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              disabled={pending}
              className="rounded-full bg-black/5 px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
            >
              {isPro ? "Pro entziehen" : "Pro schenken"}
            </button>
          )}
        </div>
      </div>

      {open && !user.paidPro && (
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] bg-black/[0.03] p-2">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="Warum? z. B. Gewinnspiel Juli"
            className="min-w-0 flex-1 rounded-[10px] border border-black/10 bg-white px-3 py-1.5 text-xs text-ink outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => submit(!isPro)}
            disabled={pending}
            className="rounded-full bg-accent px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {pending ? "…" : isPro ? "Entziehen" : "Schenken"}
          </button>
        </div>
      )}

      {err && <p className="text-[12px] text-accent">{err}</p>}
    </li>
  );
}

export default function AdminUserList({
  users,
  grants,
}: {
  users: AdminUser[];
  /** Jüngste Protokollzeile je Nutzer-ID. Leer, solange Migration 0038 fehlt. */
  grants: Record<string, ProGrantEntry>;
}) {
  if (users.length === 0) {
    return (
      <p className="rounded-[16px] bg-white p-5 text-sm text-muted shadow-sm">
        Keine Nutzer gefunden.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-black/5 overflow-hidden rounded-[16px] bg-white shadow-sm">
      {users.map((u) => (
        <UserRow key={u.id} user={u} grant={grants[u.id]} />
      ))}
    </ul>
  );
}
