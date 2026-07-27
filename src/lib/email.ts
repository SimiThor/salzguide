import "server-only";
import { fetchWithRetry } from "./ai-fetch";

// Transaktionaler E-Mail-Versand über Resend. SERVER-ONLY (Key nie im Client). Degradiert
// sauber: ohne RESEND_KEY wird nichts gesendet (return false), der Aufrufer entscheidet.
// Absender: EMAIL_FROM (verifizierte Domain in Resend, z. B. "SalzGuide <no-reply@salzguide.com>");
// Fallback ist Resends Test-Absender (nur an die eigene Account-Adresse zustellbar).
//
// ═══════════════════════════════════════════════════════════════════════════════════════
//  WARUM HIER EINE BREMSE UND EIN ZWEITER VERSUCH STEHEN
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Resend lässt standardmässig ZWEI Anfragen pro Sekunde durch. Ein einzelner Versand merkt
// davon nie etwas — die Umzugs-Ankündigung schon: Sie schickt bis zu 100 Mails in einer
// Schleife, jede dauert ~250 ms, das sind vier pro Sekunde. Jede zweite lief also in ein
// HTTP 429, und ein 429 war hier bis 07/2026 dasselbe wie „kaputt": `return false`, Mail
// verloren, Zeile wieder freigegeben. Der nächste Lauf hätte dieselbe Wand getroffen.
//
// Deshalb zwei Dinge, und beide bewusst HIER statt beim Aufrufer:
//
// 1. PACER: Zwischen zwei Versänden liegen mindestens MIN_GAP_MS. Er wirkt prozessweit,
//    also auch dann, wenn eine Anmelde-Mail zufällig mitten in einen Massenlauf fällt.
//    Wer allein sendet, wartet nie (der letzte Versand liegt dann längst zurück).
// 2. WIEDERHOLUNG über fetchWithRetry, wie bei JEDEM anderen externen Aufruf dieser App
//    (Anthropic, ORS, Wetter). Mail war die einzige Ausnahme, ausgerechnet beim Anmeldelink:
//    Ein einzelner Schluckauf bei Resend sperrte jemanden aus seinem Konto aus, denn diese
//    Mail ist der einzige Weg hinein.
//
// Was der Pacer NICHT kann: Er zählt pro Instanz. Laufen zwei Vercel-Instanzen gleichzeitig,
// sind es in der Spitze doppelt so viele Anfragen. Das fängt die Wiederholung ab — und die
// Massen-Mail läuft ohnehin nur, wenn ein Admin auf den Knopf drückt.
const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Mindestabstand zwischen zwei Versänden (Resend: 2 Anfragen/Sekunde -> 550 ms mit Luft). */
const MIN_GAP_MS = 550;

/** Zeitlimit pro Versuch. Resend antwortet normal in <500 ms; 10 s ist die Notbremse. */
const SEND_TIMEOUT_MS = 10_000;

/** Ein zweiter und dritter Versuch bei 429/5xx/Netzfehler (fetchWithRetry wartet dazwischen). */
const SEND_RETRIES = 2;

// Der Pacer verteilt SENDESLOTS, statt eine Warteschlange zu bauen: Jeder Aufruf greift
// sich den nächsten freien Zeitpunkt und schiebt den Zeiger um MIN_GAP_MS weiter.
//
// Wer allein sendet, wartet dadurch NICHT: Der Zeiger liegt in der Vergangenheit, der Slot
// ist „jetzt", die Anmelde-Mail geht ohne eine Millisekunde Verzögerung raus. Erst wer
// hintereinander sendet, stellt sich an. Eine Versprechen-Kette hätte hier auch die erste
// Mail um 550 ms verzögert, für die es keinen Grund gibt.
let nextSlot = 0;

function pace(): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + MIN_GAP_MS;
  const delay = start - now;
  return delay > 0 ? new Promise<void>((r) => setTimeout(r, delay)) : Promise.resolve();
}

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
    await pace();
    const res = await fetchWithRetry(
      RESEND_ENDPOINT,
      {
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
      },
      SEND_RETRIES,
      SEND_TIMEOUT_MS,
    );
    if (!res.ok) {
      // Die Adresse NICHT mitloggen: Logs sind kein Ort für Empfänger-Adressen.
      console.error("[email] Resend-Fehler", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[email] Versand fehlgeschlagen", e);
    return false;
  }
}
