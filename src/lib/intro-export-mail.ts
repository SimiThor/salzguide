import "server-only";
import { esc, ACCENT, INK, MUTED, CREAM } from "./mail-layout";
import { EXPORT_TTL_DAYS } from "./intro-export";

// Die Mail, die kommt, wenn eine Clean-Fassung fertig gerendert ist.
//
// WARUM ES SIE GIBT: Der Export dauert auf dem GitHub-Runner eine halbe Stunde (keine GPU,
// WebGL in Software). Eine halbe Stunde ist genau die Länge, nach der man vergisst, dass man
// etwas angestossen hat. Vorher war der einzige Ort mit dem Ergebnis der GitHub-Lauf: selbst
// nachsehen, einloggen, ans Ende scrollen, ZIP laden, entpacken. Am Handy hat das dazu
// geführt, dass die Fassung praktisch nie geholt wurde.
//
// WARUM NICHT renderMailShell() AUS mail-layout.ts: Dieselbe Begründung wie bei der
// Alarm-Mail (lib/ops-mail.ts). Der Rahmen dort ist für Nutzer-Mails gebaut, mit Begrüssung,
// Unterschrift, Social-Links und Abmeldezeile in dreizehn Sprachen. Diese Mail geht an uns
// selbst, immer auf Deutsch, und hat genau einen Zweck: den Knopf zum Laden. Übernommen sind
// Farben und Bauweise (Tabellen, Inline-Styles, weil Outlook mit der Word-Engine rendert).
//
// WARUM KEIN Ops-EREIGNIS für den Erfolgsfall: Das Meldewesen ist für Vorfälle da. Ein
// planmässig fertiger Export ist keiner. Der FEHLER-Fall dagegen geht sehr wohl ins Logbuch,
// siehe die Route.

/** Zeitpunkt in der Sprache und Zone, in der Anton liest. Vercel läuft auf UTC. */
function stamp(d: Date, withTime = true): string {
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone: "Europe/Vienna",
  }).format(d);
}

function megabytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`.replace(".", ",");
}

export type IntroExportMail = { subject: string; html: string; text: string };

export type IntroExportReadyInput = {
  slug: string;
  /** Titel des Spots, falls bekannt. Sonst steht der Slug in der Überschrift. */
  title: string | null;
  /** Die fertige Signed-URL. Enthält bereits den erzwungenen Dateinamen. */
  downloadUrl: string;
  expiresAt: Date;
  bytes: number;
};

/**
 * Die Erfolgs-Mail: eine Überschrift, ein Knopf, drei Zahlen.
 *
 * Bewusst ohne Erklärtexte. Wer sie liest, hat den Export selbst angefordert und weiss, was
 * darin ist; er will wissen, ob er jetzt tippen kann und wie lange noch.
 */
export function renderIntroExportReady(input: IntroExportReadyInput): IntroExportMail {
  const name = input.title || input.slug;
  const subject = `[SalzGuide] Clean-Fassung fertig: ${name}`;
  const bis = stamp(input.expiresAt, false);

  const rows: [string, string][] = [
    ["Spot", `${name} (${input.slug})`],
    ["Datei", `1080×1920, ohne Text, ${megabytes(input.bytes)}`],
    ["Abholbar bis", `${bis} (${EXPORT_TTL_DAYS} Tage)`],
  ];

  const text = [
    `CLEAN-FASSUNG FERTIG: ${name}`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    `Video laden: ${input.downloadUrl}`,
    "",
    `Danach wird die Datei gelöscht und der Link läuft ins Leere. Ein neuer Export dauert rund eine halbe Stunde.`,
    "",
    "(Automatische Meldung vom SalzGuide-Server.)",
  ].join("\n");

  const dataRows = rows
    .map(
      ([key, value]) => `
        <tr>
          <td style="padding:8px 12px 8px 0;color:${MUTED};font-size:13px;vertical-align:top;white-space:nowrap;">${esc(key)}</td>
          <td style="padding:8px 0;color:${INK};font-size:13px;vertical-align:top;word-break:break-word;">${esc(value)}</td>
        </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${CREAM};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:22px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;">

    <tr><td style="background:${ACCENT};height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>

    <tr><td style="padding:24px 24px 4px 24px;">
      <div style="color:${MUTED};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Clean-Export</div>
      <div style="margin-top:6px;color:${INK};font-size:20px;font-weight:700;line-height:1.3;">${esc(name)} ist fertig</div>
    </td></tr>

    <tr><td style="padding:12px 24px 0 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${dataRows}</table>
    </td></tr>

    <tr><td style="padding:20px 24px 0 24px;">
      <a href="${esc(input.downloadUrl)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 26px;border-radius:999px;">Video laden</a>
    </td></tr>

    <tr><td style="padding:14px 24px 24px 24px;">
      <div style="color:${MUTED};font-size:13px;line-height:1.55;">
        Am iPhone landet die Datei in „Downloads“ und lässt sich von dort in Fotos sichern.
        Nach dem ${esc(bis)} ist sie gelöscht, ein neuer Export dauert rund eine halbe Stunde.
      </div>
    </td></tr>

    <tr><td style="padding:0 24px 22px 24px;">
      <div style="border-top:1px solid #ebe6dc;padding-top:12px;color:${MUTED};font-size:11px;line-height:1.5;">
        Automatische Meldung vom SalzGuide-Server.
      </div>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`;

  return { subject, html, text };
}

export type IntroExportFailedInput = {
  slug: string;
  title: string | null;
  /** Der GitHub-Lauf, in dem das Protokoll steht. */
  runUrl: string | null;
  /** Was der Runner gemeldet hat, falls er noch dazu kam. */
  reason: string | null;
  at: Date;
};

/**
 * Die Fehler-Mail.
 *
 * SIE IST DER WICHTIGERE TEIL. Beim Intro-Rendern war Stille dreimal der schlimmste Fehler
 * (fehlende Mapbox-Kacheln, ungelesene Promises, ein await ohne Frist). Ein Export, der
 * scheitert und nichts sagt, ist genau derselbe Fehler in neu: Man wartet auf eine Mail, die
 * nie kommt, und merkt es Tage später. Deshalb schickt der Workflow auch im Fehlerfall.
 */
export function renderIntroExportFailed(input: IntroExportFailedInput): IntroExportMail {
  const name = input.title || input.slug;
  const subject = `[SalzGuide] Clean-Export fehlgeschlagen: ${name}`;

  const rows: [string, string][] = [
    ["Spot", `${name} (${input.slug})`],
    ["Wann", `${stamp(input.at)} Uhr`],
    ["Meldung", input.reason || "Der Lauf ist abgebrochen, ohne einen Grund zu hinterlassen."],
  ];

  const hint =
    "Meist eine fehlende Mapbox-Kachel oder das 45-Minuten-Limit des Runners. Ein zweiter Versuch hilft in den meisten Fällen; das Protokoll im Lauf sagt, ob es etwas anderes war.";

  const text = [
    `CLEAN-EXPORT FEHLGESCHLAGEN: ${name}`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "WAS JETZT ZU TUN IST",
    hint,
    ...(input.runUrl ? ["", `Protokoll: ${input.runUrl}`] : []),
    "",
    "(Automatische Meldung vom SalzGuide-Server.)",
  ].join("\n");

  const dataRows = rows
    .map(
      ([key, value]) => `
        <tr>
          <td style="padding:8px 12px 8px 0;color:${MUTED};font-size:13px;vertical-align:top;white-space:nowrap;">${esc(key)}</td>
          <td style="padding:8px 0;color:${INK};font-size:13px;vertical-align:top;word-break:break-word;">${esc(value)}</td>
        </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${CREAM};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:22px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;">

    <tr><td style="background:${ACCENT};height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>

    <tr><td style="padding:24px 24px 4px 24px;">
      <div style="color:${ACCENT};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Fehler</div>
      <div style="margin-top:6px;color:${INK};font-size:20px;font-weight:700;line-height:1.3;">Clean-Export von ${esc(name)} ist gescheitert</div>
    </td></tr>

    <tr><td style="padding:12px 24px 0 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${dataRows}</table>
    </td></tr>

    <tr><td style="padding:20px 24px 0 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fcf2f2;border:1px solid #f5d4d3;border-radius:14px;">
        <tr><td style="padding:14px 16px;">
          <div style="color:${MUTED};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Was jetzt zu tun ist</div>
          <div style="margin-top:6px;color:${INK};font-size:14px;line-height:1.55;">${esc(hint)}</div>
        </td></tr>
      </table>
    </td></tr>
${
  input.runUrl
    ? `
    <tr><td style="padding:20px 24px 24px 24px;">
      <a href="${esc(input.runUrl)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:999px;">Protokoll öffnen</a>
    </td></tr>`
    : `
    <tr><td style="padding:8px 24px 16px 24px;">&nbsp;</td></tr>`
}
    <tr><td style="padding:0 24px 22px 24px;">
      <div style="border-top:1px solid #ebe6dc;padding-top:12px;color:${MUTED};font-size:11px;line-height:1.5;">
        Automatische Meldung vom SalzGuide-Server.
      </div>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`;

  return { subject, html, text };
}
