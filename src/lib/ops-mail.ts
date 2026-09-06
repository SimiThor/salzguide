import "server-only";
import { createServiceClient } from "./supabase/service";
import { sendEmail } from "./email";
import { esc, ACCENT, INK, MUTED, CREAM } from "./mail-layout";
import { adminRecipient } from "./admin-recipient";
import { siteUrl } from "./site-url";
import { OPS_EVENTS, SEVERITY_LOOK, type OpsKind } from "./ops-events";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Die Alarm-Mail. Was tatsächlich im Postfach landet.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// WARUM MAIL UND NICHT PUSH, SLACK ODER EIN DASHBOARD:
// Weil Mail der einzige Kanal ist, den es schon gibt, der auf jedem Gerät ankommt und für den
// niemand ein Konto anlegen, eine App installieren oder eine Rechnung bezahlen muss. Ein
// Dashboard nützt nur dem, der hineinschaut — und die Fehler, um die es hier geht, sind
// genau die, bei denen niemand hineinschaut. Resend läuft ohnehin (Anmeldelink, Kaufbestätigung),
// es kommt also kein neuer Auftragsverarbeiter dazu und kein neuer Punkt in die
// Datenschutzerklärung. Die Mail geht an uns selbst, nicht an Nutzer.
//
// WARUM NICHT renderMailShell() AUS mail-layout.ts:
// Der Rahmen dort ist für Nutzer-Mails gebaut: Begrüssung, Unterschrift von Anton, Links zu
// Instagram und TikTok, Abmelde-Zeile, alles in dreizehn Sprachen. Eine Betriebsmeldung mit
// „Liebe Grüsse, Anton" darunter wäre absurd, und der Aufwand, den Rahmen für beides passend
// zu machen, wäre grösser als diese vierzig Zeilen. Was ÜBERNOMMEN wird, sind die Farben und
// die Bauweise (Tabellen, Inline-Styles, weil Outlook mit der Word-Engine rendert) — die
// Marke bleibt also erkennbar, ohne dass zwei Dinge aneinandergekettet werden, die
// verschiedenen Zwecken dienen.

/**
 * Höchstens so viele Alarm-Mails pro Stunde, über ALLE Vorfälle zusammen.
 *
 * Das ist der Notausgang für den schlimmsten Fall: Ein Deploy, der jede Seite kaputtmacht,
 * erzeugt Fehler in einem Dutzend verschiedener Ecken gleichzeitig. Jeder davon hat einen
 * eigenen Fingerabdruck, also greift die Ruhefenster-Bremse NICHT — sie wirkt je Vorfall,
 * nicht insgesamt. Ohne diese zweite Grenze kämen in fünf Minuten hundert Mails, das
 * Resend-Kontingent wäre verbrannt (dasselbe, aus dem der Anmeldelink kommt!), und die
 * Information wäre trotzdem nicht besser als nach der ersten Mail.
 *
 * Zwölf pro Stunde heisst: Man wird geweckt, aber nicht begraben.
 */
const MAX_ALERT_MAILS_PER_HOUR = 12;

/** Schlüssel des Stundenzählers in `rate_limits`. Fest, damit alle Vorfälle ihn teilen. */
const GLOBAL_CAP_SUBJECT = "ops-alert-mails";

export type OpsAlertInput = {
  kind: OpsKind;
  message: string;
  path: string | null;
  detail: Record<string, unknown> | null;
  /** Vorfälle im laufenden Ruhefenster (inklusive diesem). */
  seen: number;
  /** Vorfälle insgesamt, seit es diesen Fingerabdruck gibt. */
  total: number;
  /** Vorfälle im vorherigen Fenster, über die nicht gemailt wurde. */
  suppressed: number;
};

/**
 * Einen Alarm verschicken. Wirft nie.
 *
 * Ob überhaupt alarmiert wird (Schwelle, Ruhefenster), hat lib/ops.ts bereits atomar in der
 * Datenbank entschieden. Hier steht nur noch die globale Stundengrenze und das Schreiben
 * selbst — die Trennung ist gewollt: „ist das ein Alarm?" ist eine Frage an den Zustand,
 * „wie sieht er aus?" eine an die Gestaltung.
 */
export async function sendOpsAlert(input: OpsAlertInput): Promise<void> {
  try {
    const policy = OPS_EVENTS[input.kind];

    // Die Stundengrenze. Bewusst NACH der Entscheidung und VOR dem Versand: Der Vorfall
    // steht dann bereits im Logbuch, es geht nur die Mail verloren.
    const sentThisHour = await bumpGlobalCap();
    if (sentThisHour > MAX_ALERT_MAILS_PER_HOUR) {
      // Genau EINE Zeile beim Überschreiten, nicht bei jeder weiteren — sonst ersetzt man
      // die Mailflut durch eine Logflut.
      if (sentThisHour === MAX_ALERT_MAILS_PER_HOUR + 1) {
        console.error(
          `[ops] Stundengrenze erreicht (${MAX_ALERT_MAILS_PER_HOUR} Alarm-Mails). Weitere Alarme stehen nur noch im Logbuch.`,
        );
      }
      return;
    }

    const look = SEVERITY_LOOK[policy.severity];
    const subject = `[SalzGuide] ${look.label}: ${policy.title}`;
    // Der Logbuch-Link. Die Route MUSS existieren: Bis 08/2026 stand hier /de/admin/system,
    // eine Seite, die es nie gab. Jeder Klick aus einer Alarm-Mail landete damit auf der
    // Abbruch-Stream-404 (siehe [locale]/[...rest]/page.tsx) und produzierte dort selbst
    // wieder client_errors, mitten im Vorfall. routes:check prüft diesen Link jetzt mit.
    const admin = `${siteUrl()}/de/admin/settings/system`;

    const ok = await sendEmail({
      to: adminRecipient(),
      subject,
      text: renderText(input, admin),
      html: renderHtml(input, admin),
      // KEIN Neu-Melden, wenn diese Mail scheitert: sendEmail würde `mail_send_failed`
      // melden, das wäre wieder ein Alarm, der wieder eine Mail schicken will. Genau hier
      // bricht die Schleife. Was übrig bleibt, ist die Konsolenzeile unten.
      quiet: true,
    });
    if (!ok) {
      console.error(`[ops] ALARM NICHT ZUSTELLBAR: ${subject} — ${input.message}`);
    }
  } catch (e) {
    console.error("[ops] Alarm-Versand fehlgeschlagen", e instanceof Error ? e.message : e);
  }
}

/**
 * Der Stundenzähler über alle Alarme. Gibt den Stand nach der Erhöhung zurück.
 *
 * Direkt hier statt über lib/ops.ts, weil ein Import in die andere Richtung ein Ringschluss
 * wäre (ops.ts holt sendOpsAlert von hier).
 */
async function bumpGlobalCap(): Promise<number> {
  try {
    const { data } = await createServiceClient().rpc("bump_ops_counter", {
      p_subject: GLOBAL_CAP_SUBJECT,
      p_window_seconds: 3600,
    });
    return typeof data === "number" ? data : 1;
  } catch {
    // Zähler nicht erreichbar -> durchlassen. Ein Alarm, der wegen eines Zählerfehlers
    // ausbleibt, ist der teurere Fehler.
    return 1;
  }
}

/** Zeitstempel in der Sprache, in der Anton liest. Feste Zone, damit Vercel (UTC) nicht lügt. */
function stamp(): string {
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Vienna",
  }).format(new Date());
}

/** Die Zeilen des Datenblocks. Eine Quelle für HTML und Reintext. */
function rows(input: OpsAlertInput): [string, string][] {
  const out: [string, string][] = [["Wann", `${stamp()} Uhr`]];
  if (input.path) out.push(["Wo", input.path]);
  out.push(["Meldung", input.message]);

  // Die Zahlen nur, wenn sie etwas sagen. „1 von 1" unter jedem Alarm ist Rauschen.
  if (input.seen > 1) out.push(["Im Zeitfenster", `${input.seen}×`]);
  if (input.total > input.seen) out.push(["Insgesamt schon", `${input.total}×`]);
  if (input.suppressed > 0) {
    out.push(["Ohne Mail geblieben", `${input.suppressed}× seit dem letzten Alarm`]);
  }

  for (const [key, value] of Object.entries(input.detail ?? {})) {
    // `stack` steht separat unten, `imFenster`/`gesamt` sind oben schon als Zahlen drin.
    if (key === "stack" || key === "imFenster" || key === "gesamt") continue;
    out.push([key, String(value)]);
  }
  const stack = input.detail?.stack;
  if (typeof stack === "string" && stack) out.push(["Spur", stack]);
  return out;
}

/**
 * Reintext. PFLICHT, nicht Kür — siehe lib/email.ts: Ohne Textteil steht die Vorschauzeile
 * im Posteingang leer, und genau die liest man bei einem Alarm zuerst.
 */
function renderText(input: OpsAlertInput, admin: string): string {
  const policy = OPS_EVENTS[input.kind];
  const look = SEVERITY_LOOK[policy.severity];
  const lines = [
    `${look.label.toUpperCase()}: ${policy.title}`,
    "",
    ...rows(input).map(([k, v]) => `${k}: ${v}`),
    "",
    "WAS JETZT ZU TUN IST",
    policy.hint,
    "",
    `Logbuch: ${admin}`,
    "",
    `(Ereignis-Art: ${input.kind}. Diese Mail kommt automatisch vom SalzGuide-Server.)`,
  ];
  return lines.join("\n");
}

function renderHtml(input: OpsAlertInput, admin: string): string {
  const policy = OPS_EVENTS[input.kind];
  const look = SEVERITY_LOOK[policy.severity];

  const dataRows = rows(input)
    .map(
      ([key, value]) => `
        <tr>
          <td style="padding:8px 12px 8px 0;color:${MUTED};font-size:13px;vertical-align:top;white-space:nowrap;">${esc(key)}</td>
          <td style="padding:8px 0;color:${INK};font-size:13px;vertical-align:top;word-break:break-word;">${esc(value)}</td>
        </tr>`,
    )
    .join("");

  // Ein durchgehender Farbbalken oben statt eines Warn-Emojis: Er ist auf dem Sperrbildschirm
  // eines iPhones schon in der Vorschau zu sehen und braucht keine Bilder, die viele
  // Mail-Programme blockieren.
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(policy.title)}</title></head>
<body style="margin:0;padding:0;background:${CREAM};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:22px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;">

    <tr><td style="background:${look.hex};height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>

    <tr><td style="padding:24px 24px 4px 24px;">
      <div style="color:${look.hex};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">${esc(look.label)}</div>
      <div style="margin-top:6px;color:${INK};font-size:20px;font-weight:700;line-height:1.3;">${esc(policy.title)}</div>
    </td></tr>

    <tr><td style="padding:12px 24px 0 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${dataRows}</table>
    </td></tr>

    <tr><td style="padding:20px 24px 0 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fcf2f2;border:1px solid #f5d4d3;border-radius:14px;">
        <tr><td style="padding:14px 16px;">
          <div style="color:${MUTED};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Was jetzt zu tun ist</div>
          <div style="margin-top:6px;color:${INK};font-size:14px;line-height:1.55;">${esc(policy.hint)}</div>
        </td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:20px 24px 24px 24px;">
      <a href="${esc(admin)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:999px;">Logbuch öffnen</a>
    </td></tr>

    <tr><td style="padding:0 24px 22px 24px;">
      <div style="border-top:1px solid #ebe6dc;padding-top:12px;color:${MUTED};font-size:11px;line-height:1.5;">
        Ereignis-Art: ${esc(input.kind)}. Automatische Meldung vom SalzGuide-Server.
      </div>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`;
}
