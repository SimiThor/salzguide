import { Link } from "@/i18n/navigation";
import { getMailHealth } from "@/lib/ops-read";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Der zweite Kanal. Die eine Meldung, die nicht per Mail kommen kann.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Das ganze Meldewesen (lib/ops.ts) hängt an einem einzigen Weg nach draussen: einer Mail
// über Resend. Für jeden Ausfall ist das richtig — ausser für einen. Am 19.09.2026 hat
// Resend unseren Schlüssel abgewiesen, und damit fiel nicht nur der Anmeldelink aus,
// sondern auch die Alarm-Mail ÜBER den Ausfall. Vier kritische Meldungen liefen ins Leere.
// Zwei Tage später ist es aufgefallen, und zwar nicht durch ein Signal, sondern durch das
// Fehlen eines gewohnten: Die Montags-Mail über wartende Events kam nicht.
//
// Dagegen hilft keine bessere Mail, sondern nur ein Weg, der nicht über Mail läuft. Das
// hier ist dieser Weg: Der Zustand des Mailkanals steht im Admin-Rahmen und damit auf JEDER
// Admin-Seite, nicht nur im Logbuch unter Einstellungen. Wer irgendetwas im Admin tut,
// sieht ihn.
//
// WARUM ES NICHTS ANZEIGT, SOLANGE ALLES GEHT: Ein Kasten, der immer „alles gut" sagt, wird
// nach einer Woche nicht mehr gelesen, und dann hilft er an dem Tag nicht, an dem er etwas
// anderes sagt. Genau dieselbe Begründung steht über der Hintergrund-Läufe-Karte.
export default async function MailChannelBanner() {
  const health = await getMailHealth();
  if (health.ok) return null;

  return (
    <div className="rounded-[18px] bg-accent/10 p-4 ring-1 ring-accent/25">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[18px]" aria-hidden>
          🚨
        </span>
        <span className="text-[15px] font-bold text-ink">Mailversand ist blockiert</span>
      </div>

      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        {health.reason ? `${health.reason}. ` : ""}
        Solange das anliegt, kommt kein Anmeldelink, keine Kaufbestätigung und kein Alarm an.
        {health.lastOkAt ? ` Zuletzt ging eine Mail am ${when(health.lastOkAt)} raus.` : ""}
      </p>

      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        Neuen Schlüssel in Resend anlegen, in Vercel als RESEND_KEY eintragen und neu
        deployen. Steht er auch in Supabase als SMTP-Passwort, dort mit tauschen.
      </p>

      <Link
        href="/admin/settings/system"
        className="mt-3 inline-block rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white active:scale-[0.98]"
      >
        Logbuch öffnen
      </Link>
    </div>
  );
}

/** Feste Zone, wie im Logbuch und in der Alarm-Mail: Vercel läuft in UTC. */
function when(iso: string): string {
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Vienna",
  }).format(new Date(iso));
}
