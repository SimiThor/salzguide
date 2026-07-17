import "server-only";

// Transaktionaler E-Mail-Versand über Resend. SERVER-ONLY (Key nie im Client). Degradiert
// sauber: ohne RESEND_KEY wird nichts gesendet (return false), der Aufrufer entscheidet.
// Absender: EMAIL_FROM (verifizierte Domain in Resend, z. B. "SalzGuide <no-reply@salzguide.com>");
// Fallback ist Resends Test-Absender (nur an die eigene Account-Adresse zustellbar).
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function emailEnabled(): boolean {
  return !!process.env.RESEND_KEY?.trim();
}

export async function sendEmail(mail: {
  to: string;
  subject: string;
  /**
   * Reintext. PFLICHT, auch wenn `html` dabei ist.
   *
   * Nicht aus Prinzip, sondern weil sonst zwei Dinge passieren: Mail-Programme, die kein
   * HTML zeigen (und Vorschau-Zeilen im Posteingang), stehen leer da, und Spamfilter werten
   * eine Mail ohne Textteil ab. Bei 100 zahlenden Kunden ist der Spam-Ordner die teuerste
   * Zustellart.
   */
  text: string;
  /** Optionale HTML-Fassung. Wer beides schickt, überlässt dem Programm die Wahl. */
  html?: string;
  replyTo?: string;
}): Promise<boolean> {
  const key = process.env.RESEND_KEY?.trim();
  if (!key) {
    console.warn("[email] RESEND_KEY nicht gesetzt – E-Mail wird nicht gesendet:", mail.subject);
    return false;
  }
  const from = process.env.EMAIL_FROM?.trim() || "SalzGuide <onboarding@resend.dev>";
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        ...(mail.html ? { html: mail.html } : {}),
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error("[email] Resend-Fehler", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[email] Versand fehlgeschlagen", e);
    return false;
  }
}
