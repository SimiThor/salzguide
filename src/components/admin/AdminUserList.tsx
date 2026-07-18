"use client";

import { useState, useTransition } from "react";
import { setUserPro, type ProMailState } from "@/lib/user-actions";
import { proSourceLabel } from "@/lib/pro-source";
import { BTN_DANGER_SM, BTN_PRIMARY_SM, BTN_SECONDARY_SM, STATUS_ACCENT, STATUS_NEUTRAL } from "@/lib/ui";
import ProBadge from "@/components/ProBadge";
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

// Was aus der Mail an den Beschenkten wurde. Als Record über die Union: Kommt ein Zustand
// dazu, meckert TypeScript hier, statt ihn still verschwinden zu lassen.
const MAIL_STATE: Record<ProMailState, string> = {
  sent: "✉️ Mail ist raus.",
  failed: "Pro gilt, aber die Mail ging nicht raus. Nochmal schenken schickt sie erneut.",
  already: "Keine Mail: Dieser Person wurde schon einmal geschrieben.",
  no_address: "Keine Mail: Zu diesem Konto ist keine Adresse hinterlegt.",
  disabled: "Keine Mail: Es ist kein RESEND_KEY gesetzt (lokal normal).",
};

// Der Pro-Zustand einer Zeile: das echte Pro-Zeichen der Plattform plus die Herkunft
// als Status daneben.
//
// Hier stand eine EIGENE Funktion, die auch ProBadge hiess, den geteilten Baustein nicht
// importierte und anders aussah (flach statt Verlauf). components/ProBadge.tsx sagt in
// seinem Kopf "PLATTFORMWEIT die EINZIGE Quelle für den Pro-Look" — das stimmte nicht.
// Jetzt stimmt es.
//
// Die Herkunft ist bewusst umrandet statt gefüllt: Direkt daneben sitzt der Knopf
// "Pro schenken". Vorher trugen beide dieselbe graue Kapsel und man musste raten, welches
// davon man drücken kann (siehe lib/ui.ts).
function ProState({ user }: { user: AdminUser }) {
  if (!user.isPro) return <span className="text-muted">–</span>;
  return (
    <span className="flex items-center gap-1.5">
      <ProBadge />
      {/* Bezahltes Pro rot: Das ist das einzige, das der Admin nicht anfassen darf. */}
      <span className={user.paidPro ? STATUS_ACCENT : STATUS_NEUTRAL}>
        {proSourceLabel(user.proSource)}
      </span>
    </span>
  );
}

function UserRow({ user, grant }: { user: AdminUser; grant?: ProGrantEntry }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  // Vorausgewählt: Wer Pro verschenkt, will das dem Menschen fast immer sagen. Der Haken
  // ist für den Ausnahmefall da (Testkonto), nicht für den Normalfall.
  const [mail, setMail] = useState(true);
  const [mailState, setMailState] = useState<ProMailState | null>(null);
  // Optimistisch NICHT: Der Server entscheidet, und bei Pro will man sehen, was WIRKLICH
  // gilt. Nach Erfolg lädt die Seite neu (router.refresh über revalidate der Action).
  const [done, setDone] = useState<boolean | null>(null);

  const isPro = done ?? user.isPro;

  function submit(next: boolean) {
    setErr("");
    setMailState(null);
    start(async () => {
      const r = await setUserPro(user.id, next, note, next && mail);
      if (r.ok) {
        setDone(next);
        setOpen(false);
        setNote("");
        // Nur melden, wenn es etwas zu melden gibt. Ein „Mail ist raus" nach jedem Entzug
        // wäre Rauschen.
        setMailState(r.mail ?? null);
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
          <ProState user={{ ...user, isPro }} />
          {user.paidPro ? (
            // Kein Knopf, sondern der Grund. Ein ausgegrauter Knopf sagt „geht nicht",
            // dieser Text sagt „geht woanders" — das ist die Auskunft, die man braucht.
            <span className="text-[11px] text-muted">nur über Stripe</span>
          ) : (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              disabled={pending}
              className={BTN_SECONDARY_SM}
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
          {/* Nur beim Schenken. Beim Entziehen gibt es keine Mail, und ein Kästchen, das
              nichts tut, ist schlimmer als keins. */}
          {!isPro && (
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-ink">
              <input
                type="checkbox"
                checked={mail}
                onChange={(e) => setMail(e.target.checked)}
                className="h-3.5 w-3.5 accent-accent"
              />
              Mail schicken
            </label>
          )}
          <button
            type="button"
            onClick={() => submit(!isPro)}
            disabled={pending}
            // Entziehen ist die Handlung, die man bereuen kann. Rot umrandet statt rot
            // gefüllt: erkennbar, ohne wie die Haupt-Aktion zu rufen.
            className={isPro ? BTN_DANGER_SM : BTN_PRIMARY_SM}
          >
            {pending ? "…" : isPro ? "Entziehen" : "Schenken"}
          </button>
        </div>
      )}

      {err && <p className="text-[12px] text-accent">{err}</p>}
      {/* Was aus der Mail geworden ist. Ohne diese Zeile bliebe nach dem Schenken die
          Frage offen, ob der Mensch überhaupt etwas mitbekommen hat. */}
      {mailState && (
        <p
          className={`text-[12px] ${mailState === "sent" ? "text-muted" : "text-accent"}`}
        >
          {MAIL_STATE[mailState]}
        </p>
      )}
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
