import "server-only";
import { createServiceClient } from "./supabase/service";
import { LEGAL } from "./legal";
import { siteUrl } from "./site-url";

// Die Umzugs-Mail an die Alt-Käufer: Texte aus dem Admin, Gestaltung aus dem Code.
//
// WARUM DER ADMIN NUR DIE TEXTE BEARBEITET UND NICHT DAS HTML:
// Anton wollte die Mail bearbeiten können. Ein Feld mit rohem HTML wäre die naheliegende
// Antwort und die falsche: Ein vergessenes </td> zerreisst die Mail in Outlook, und man
// sieht es erst, wenn sie bei 100 zahlenden Kunden liegt. Zurückholen kann man sie nicht.
// Also: Er schreibt die Worte, der Code baut den Rahmen. Was er tippen kann, kann nichts
// kaputtmachen — und die Vorschau zeigt genau das, was rausgeht.
//
// WARUM TABELLEN UND INLINE-STYLES (das sieht aus wie 2005, ist aber Absicht):
// Outlook rendert mit der Word-Engine. Kein flexbox, kein grid, keine externen Stylesheets,
// kein <style> im head, das man sich verlassen könnte. Was hier steht, ist der kleinste
// gemeinsame Nenner, der überall ankommt. Eine Mail, die nur in Gmail schön ist, ist keine
// schöne Mail.

/** Die Schlüssel in app_settings. Eine Stelle, damit Lesen und Schreiben nicht driften. */
export const MAIL_KEYS = {
  subject: "relaunch_mail_subject",
  headline: "relaunch_mail_headline",
  body: "relaunch_mail_body",
  cta: "relaunch_mail_cta",
} as const;

export type RelaunchMailTexts = {
  subject: string;
  headline: string;
  body: string;
  cta: string;
};

// Was drinsteht, wenn niemand etwas eingetragen hat. Nach BRAND_VOICE: Kumpel-Ton, du-Form,
// kurze Sätze, keine Marketing-Floskeln, kein Gedankenstrich.
export const MAIL_DEFAULTS: RelaunchMailTexts = {
  subject: "Das neue SalzGuide ist da 🏔️",
  headline: "Das neue SalzGuide ist da",
  body:
    "Wir haben SalzGuide von Grund auf neu gebaut. Eine echte Karte, alle Spots drauf, und Toni, unser KI-Guide, der jeden einzelnen davon kennt.\n\n" +
    "Dein Pro nehmen wir mit. Unbegrenzt, ohne dass du nochmal zahlst.\n\n" +
    "Ein Passwort brauchst du nicht mehr. Du gibst deine E-Mail ein, tippst auf den Link, den wir dir schicken, und bist drin. Dauert 20 Sekunden.",
  cta: "Rein ins neue SalzGuide",
};

/** Nur die Werte lesen, die jemand gesetzt hat; der Rest kommt aus MAIL_DEFAULTS. */
export async function getRelaunchMailTexts(): Promise<RelaunchMailTexts> {
  try {
    const { data } = await createServiceClient()
      .from("app_settings")
      .select("key, value")
      .in("key", Object.values(MAIL_KEYS));
    const map = new Map((data ?? []).map((r) => [r.key as string, r.value as string | null]));
    const pick = (k: string, fallback: string) => {
      const v = map.get(k);
      // Leerer String zählt NICHT als gepflegt: Ein leergeräumtes Feld soll auf den
      // Standard zurückfallen, statt eine Mail ohne Überschrift zu verschicken.
      return typeof v === "string" && v.trim() ? v : fallback;
    };
    return {
      subject: pick(MAIL_KEYS.subject, MAIL_DEFAULTS.subject),
      headline: pick(MAIL_KEYS.headline, MAIL_DEFAULTS.headline),
      body: pick(MAIL_KEYS.body, MAIL_DEFAULTS.body),
      cta: pick(MAIL_KEYS.cta, MAIL_DEFAULTS.cta),
    };
  } catch {
    return MAIL_DEFAULTS;
  }
}

/** Alles, was aus einem Text-Feld kommt, muss hier durch. Sonst wäre jedes < eine Lücke. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ACCENT = "#cc2924";
const INK = "#111111";
const MUTED = "#6C5B57";
const CREAM = "#faf6ec";

/**
 * Die HTML-Fassung. `email` ist die Adresse des Empfängers und steht in der Mail, damit
 * er sieht, WELCHE er eingeben muss. Genau da scheitert es sonst: Wer drei Adressen hat,
 * probiert die falsche und denkt, sein Pro sei weg.
 */
export function renderRelaunchMail(texts: RelaunchMailTexts, email: string, loginUrl: string): string {
  const paragraphs = texts.body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK};">${esc(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(texts.subject)}</title></head>
<body style="margin:0;padding:0;background:${CREAM};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:22px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;">
    <tr><td style="padding:36px 32px 8px;">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${ACCENT};">SalzGuide</p>
      <h1 style="margin:0 0 20px;font-size:28px;line-height:1.25;font-weight:800;color:${INK};">${esc(texts.headline)}</h1>
      ${paragraphs}
    </td></tr>

    <tr><td style="padding:8px 32px 4px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center"
        style="border-radius:999px;background:${ACCENT};">
        <a href="${esc(loginUrl)}" style="display:block;padding:15px 24px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">${esc(texts.cta)}</a>
      </td></tr></table>
    </td></tr>

    <tr><td style="padding:16px 32px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};border-radius:14px;">
        <tr><td style="padding:14px 16px;">
          <p style="margin:0;font-size:13px;line-height:1.5;color:${MUTED};">Melde dich mit dieser Adresse an:</p>
          <p style="margin:4px 0 0;font-size:15px;font-weight:700;color:${INK};word-break:break-all;">${esc(email)}</p>
        </td></tr>
      </table>
      <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:${MUTED};">
        Klappt was nicht? Antworte einfach auf diese Mail, wir lesen mit.
      </p>
      <p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:${MUTED};">
        ${esc(LEGAL.company)} · <a href="${esc(siteUrlSafe())}" style="color:${MUTED};">salzguide.com</a>
      </p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

// siteUrl() ist server-only und wirft im Zweifel nicht — aber die Vorschau soll auch dann
// rendern, wenn etwas fehlt.
function siteUrlSafe(): string {
  try {
    return siteUrl();
  } catch {
    return "https://salzguide.com";
  }
}

/** Die Reintext-Fassung. Kein Abklatsch: Sie muss für sich allein funktionieren. */
export function renderRelaunchText(texts: RelaunchMailTexts, email: string, loginUrl: string): string {
  return (
    `${texts.headline}\n\n` +
    `${texts.body}\n\n` +
    `${texts.cta}: ${loginUrl}\n\n` +
    `Melde dich mit dieser Adresse an: ${email}\n\n` +
    `Klappt was nicht? Antworte einfach auf diese Mail.\n\n` +
    `${LEGAL.company}`
  );
}
