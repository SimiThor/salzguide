import "server-only";
import { fetchWithRetry } from "./ai-fetch";
import { scrubText } from "./ops-scrub";

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
//
// ═══════════════════════════════════════════════════════════════════════════════════════
//  UND WARUM JEDER VERSUCH SEINEN ZUSTAND HINTERLÄSST (noteChannel)
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Diese Datei ist der einzige Weg nach draussen, den die App hat — für den Anmeldelink, die
// Kaufbestätigung UND für jeden Alarm des Meldewesens. Daraus folgt der eine Ausfall, der
// sich nicht selbst melden kann: Ist der Kanal zu, ist auch die Nachricht darüber zu.
// Genau das ist am 19.09.2026 passiert (Resend wies den Schlüssel ab), und aufgefallen ist
// es erst am 21.09. durch das AUSBLEIBEN einer erwarteten Mail.
//
// Seither schreibt jeder Versuch mit, ob er durchkam. Der Zustand liegt in ops_heartbeats
// (MAIL_CHANNEL_JOB in lib/ops.ts), gelesen wird er im Admin-Rahmen, der ihn auf jeder
// Admin-Seite anzeigt. Ein zweiter Weg, der ohne Resend auskommt.
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
  /**
   * Diesen Versand NICHT ans Meldewesen weitergeben. Genau ein Aufrufer setzt das: die
   * Alarm-Mail selbst (lib/ops-mail.ts).
   *
   * Ohne diesen Riegel gäbe es eine Schleife, und zwar ausgerechnet im schlimmsten Fall:
   * Resend ist down -> Versand scheitert -> `mail_send_failed` wird gemeldet -> das Meldewesen
   * schickt eine Alarm-Mail -> die scheitert auch -> nächste Meldung. Bei einem Ausfall des
   * Mail-Anbieters würde die App sich selbst beschäftigen, bis etwas nachgibt.
   */
  quiet?: boolean;
}): Promise<boolean> {
  const key = process.env.RESEND_KEY?.trim();
  if (!key) {
    console.warn("[email] RESEND_KEY nicht gesetzt – E-Mail wird nicht gesendet:", mail.subject);
    // Auch das ist ein geschlossener Kanal, und zwar der lauteste: Es wird nicht einmal
    // versucht. Lokal passiert hier trotzdem nichts, weil der Stempel nur auf der echten
    // Seite geschrieben wird (active() in lib/ops.ts) — ein frischer Klon ohne Schlüssel
    // soll nicht das Banner der Produktion anwerfen.
    await noteChannel(false, { grund: "RESEND_KEY fehlt" });
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
      //
      // Der Vorsatz stand hier schon, die Antwort von Resend unterlief ihn trotzdem: Bei
      // einer abgelehnten Zustellung nennt sie die Adresse im Klartext („Invalid `to`
      // field: …"), und die ging bis hierher ungefiltert in die Konsole. Jetzt läuft sie
      // durch denselben Schwärzer wie alles andere.
      const body = scrubText(await res.text().catch(() => ""), 300);
      console.error("[email] Resend-Fehler", res.status, body);
      const fault = channelFault(res.status);
      if (fault) await noteChannel(false, { grund: fault, status: res.status });
      await report(mail, `Resend antwortet mit ${res.status}`, { status: res.status, body }, fault);
      return false;
    }
    await noteChannel(true, { art: "versand" });
    return true;
  } catch (e) {
    console.error("[email] Versand fehlgeschlagen", e);
    // Netzfehler und Zeitlimit, NACH den Wiederholungen von fetchWithRetry. Wenn drei
    // Anläufe hintereinander nicht einmal eine Antwort bekommen, ist das der Kanal und
    // nicht diese eine Mail.
    await noteChannel(false, { grund: "Resend nicht erreichbar" });
    await report(
      mail,
      "Versand fehlgeschlagen",
      { fehler: e instanceof Error ? e.message : "" },
      "Resend nicht erreichbar",
    );
    return false;
  }
}

/**
 * Meint dieser Statuscode den KANAL oder nur diese eine Mail? Null heisst: nur diese Mail.
 *
 * Die Unterscheidung ist der Unterschied zwischen einem Banner, das stimmt, und einem, das
 * man nach dem dritten Mal wegsieht. Ein Tippfehler in einer Empfänger-Adresse (Resend
 * antwortet 422) darf nicht tagelang „Mailversand ist blockiert" im Admin stehen lassen —
 * die nächste Mail an eine richtige Adresse geht ja raus.
 */
function channelFault(status: number): string | null {
  if (status === 401 || status === 403) return "Schlüssel wird abgelehnt";
  // 429 kommt hier erst an, NACHDEM fetchWithRetry es zweimal erneut versucht hat. Dann ist
  // es keine Taktgrenze mehr, sondern eine Wand (Kontingent des Monats aufgebraucht).
  if (status === 429) return "Kontingent erschöpft";
  if (status >= 500) return "Resend antwortet nicht";
  return null;
}

/**
 * Den Zustand des Mailkanals festhalten. Wirft nie, wartet auf nichts Wichtiges.
 *
 * Dynamisch importiert wie `report()` darunter, und aus demselben Grund: lib/ops.ts holt
 * über ops-mail.ts `sendEmail` von hier, ein fester Import zurück wäre ein Ringschluss.
 *
 * Das passiert AUCH bei `quiet`-Versänden (der Alarm-Mail). Eine Zeile in einer Tabelle
 * verschickt nichts, kann also keine Schleife auslösen — und ausgerechnet der gescheiterte
 * Alarm ist der beste Beweis, dass der Kanal zu ist.
 */
async function noteChannel(ok: boolean, detail?: Record<string, unknown>): Promise<void> {
  try {
    const { writeMailChannelState } = await import("./ops");
    await writeMailChannelState(ok, detail);
  } catch {
    /* Die Konsolenzeile beim Aufrufer steht bereits. */
  }
}

/**
 * Anklopfen, ohne etwas zu verschicken. Für den täglichen Aufräum-Lauf.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  WARUM ES DEN KLOPFTEST BRAUCHT, obwohl jeder Versand den Zustand schon mitschreibt
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Weil die App wochenlang keine einzige Mail verschicken kann, ohne dass etwas fehlt: Wenn
 * niemand Neues sich anmeldet, niemand kauft und kein Alarm auslöst, gibt es keinen Versuch,
 * an dem ein kaputter Schlüssel auffallen würde. Er fällt dann erst auf, wenn er das erste
 * Mal wirklich gebraucht wird — also im schlechtestmöglichen Moment, beim Anmeldelink eines
 * Kunden. Der Klopftest macht daraus eine Frage, die jeden Tag von selbst gestellt wird.
 *
 * WARUM AUSGERECHNET EIN POST AUF /emails MIT LEEREM KÖRPER:
 * Resend prüft zuerst den Schlüssel und erst danach den Inhalt. Ein leerer Körper ohne
 * Empfänger und ohne Absender kann deshalb nie eine Mail auslösen, beantwortet aber genau
 * die Frage, die zählt:
 *   401/403  Schlüssel abgelehnt. Genau der Ausfall vom 19.09.2026.
 *   4xx      Schlüssel gültig, nur der Inhalt fehlt (422). Das ist das gute Ergebnis.
 *   5xx      Resend hat gerade selbst ein Problem. Dazu sagen wir NICHTS, siehe unten.
 *
 * Der naheliegende Weg (GET /domains) taugt nicht: Ein Resend-Schlüssel mit „Sending
 * access" darf Domains nicht lesen und bekommt dort auch mit gültigem Schlüssel eine
 * Ablehnung. Der Klopftest würde dann jeden Tag einen Ausfall melden, den es nicht gibt.
 *
 * Was der Test NICHT beweist: dass eine Mail auch ankommt (Domain verifiziert, nicht im
 * Spam). Er beantwortet die eine Frage, an der es diesmal lag, und die ist es wert.
 */
export async function probeMailChannel(): Promise<{ ok: boolean; reason?: string }> {
  const key = process.env.RESEND_KEY?.trim();
  if (!key) {
    await noteChannel(false, { grund: "RESEND_KEY fehlt", art: "probe" });
    await reportChannelDown("RESEND_KEY ist nicht gesetzt. Es kann keine einzige Mail rausgehen.");
    return { ok: false, reason: "RESEND_KEY fehlt" };
  }
  try {
    const res = await fetchWithRetry(
      RESEND_ENDPOINT,
      {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: "{}",
        cache: "no-store",
      },
      SEND_RETRIES,
      SEND_TIMEOUT_MS,
    );
    if (res.status === 401 || res.status === 403) {
      await noteChannel(false, { grund: "Schlüssel wird abgelehnt", status: res.status, art: "probe" });
      await reportChannelDown(`Resend weist unseren Schlüssel ab (${res.status}).`);
      return { ok: false, reason: "Schlüssel wird abgelehnt" };
    }
    if (res.status === 429 || res.status >= 500) {
      // Bewusst KEIN Urteil: Ein Schluckauf bei Resend ist kein kaputter Schlüssel, und ein
      // Banner, das über Nacht von selbst wieder verschwindet, ist ein Banner, dem man beim
      // nächsten Mal nicht glaubt. Der Zustand von gestern bleibt stehen. Die 429 gehört
      // dazu: Sie sagt „zu schnell", nicht „falscher Schlüssel", und der Klopftest selbst
      // ist eine Anfrage mehr im selben Takt.
      console.warn("[email] Klopftest ohne Urteil, Resend antwortet mit", res.status);
      return { ok: true, reason: "keine Antwort von Resend" };
    }
    await noteChannel(true, { art: "probe" });
    return { ok: true };
  } catch (e) {
    console.warn("[email] Klopftest nicht durchgekommen", e instanceof Error ? e.message : e);
    return { ok: true, reason: "Klopftest nicht durchgekommen" };
  }
}

/** Den geschlossenen Kanal ins Logbuch schreiben. Diese Art mailt nie (siehe Katalog). */
async function reportChannelDown(message: string): Promise<void> {
  try {
    const { logOps } = await import("./ops");
    await logOps("mail_channel_down", { message, group: "mail:channel" });
  } catch {
    /* siehe noteChannel */
  }
}

/**
 * Einen gescheiterten Versand ans Meldewesen geben.
 *
 * Dynamisch importiert, damit die Ladereihenfolge sauber bleibt: lib/ops-mail.ts holt
 * `sendEmail` von HIER, ein fester Import in die Gegenrichtung wäre ein Ringschluss. Der
 * Import passiert ausserdem nur im Fehlerfall, kostet im Normalbetrieb also nichts.
 *
 * Was gemeldet wird, ist bewusst dünn: Betreff und Statuscode, NIE der Empfänger und nie der
 * Inhalt. Eine Mail ist ihrem Wesen nach personenbezogen, ein Fehler beim Verschicken nicht.
 */
async function report(
  mail: { subject: string; quiet?: boolean },
  what: string,
  detail: Record<string, unknown>,
  fault: string | null,
): Promise<void> {
  if (mail.quiet) return;
  try {
    const { logOps } = await import("./ops");

    // Ein abgelehnter Schlüssel ist kein Zustellproblem, sondern ein Konfigurationsfehler,
    // und er geht nie von selbst weg. Deshalb eine eigene Art mit eigener Stufe: Am
    // 19.09.2026 standen fünf gleich aussehende „E-Mail konnte nicht zugestellt werden"
    // zwischen vierzig CSP-Zeilen, und keines davon sagte, dass ab jetzt GAR nichts mehr
    // rausgeht. EIN Fingerabdruck für alle Betreffzeilen, denn es ist ein Zustand und
    // nicht eine Reihe von Vorfällen.
    if (fault === "Schlüssel wird abgelehnt") {
      await logOps("mail_channel_down", {
        message: `Resend weist unseren Schlüssel ab. Betroffen war zuletzt: ${mail.subject}`,
        group: "mail:channel",
        detail,
      });
      return;
    }

    await logOps("mail_send_failed", {
      message: `${what} (Betreff: ${mail.subject})`,
      // Nach Betreff gruppieren: Ein Ausfall beim Anmeldelink ist etwas anderes als einer
      // bei der Umzugs-Ankündigung, und beide sollen sich nicht gegenseitig stumm schalten.
      group: `mail:${mail.subject}`,
      detail,
    });
  } catch {
    /* Meldewesen nicht erreichbar: Die Konsolenzeile oben steht ja bereits. */
  }
}
