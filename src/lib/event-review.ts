import "server-only";
import { createServiceClient } from "./supabase/service";
import { sendEmail } from "./email";
import { adminRecipient } from "./admin-recipient";
import { siteUrl } from "./site-url";
import { adminWhenLabel, startOfViennaDayIso } from "./events-format";
import {
  EVENTS_REVIEW_ENTRY,
  renderEventReviewMail,
  type ReviewLine,
} from "./event-review-mail";

// Die Serverseite der Freigabe-Erinnerung: nachsehen, was offen ist, und genau dann eine
// Mail schicken. Getrennt von lib/event-review-mail.ts, weil dort nur Worte stehen und die
// Vorschau unter /admin/settings/mails sie ohne Datenbank rendern können muss.
//
// SERVICE-CLIENT, nicht der Sitzungs-Client: Der Aufrufer ist der Montags-Cron, also eine
// Maschine ohne Anmeldung. Mit dem Betrachter-Client käme aus einer Tabelle voller Entwürfe
// eine leere Liste zurück, ohne Fehlermeldung, und die Mail behauptete jede Woche, es sei
// nichts zu tun. Dieselbe Falle wie beim Zählen der Spots mit dem Anon-Key.

/** So viele Zeilen stehen in der Mail. Der Rest wird als „und N weitere" gezählt. */
const LIST_LIMIT = 12;

const DAY_MS = 86400000;

export type ReviewMailResult = {
  sent: boolean;
  /** Offene Entwürfe ab heute. Steht auch im Lebenszeichen des Laufs. */
  pending: number;
  /** Warum nicht gesendet wurde. Nur gesetzt, wenn `sent` false ist. */
  reason?: string;
  /**
   * Es lag etwas zur Freigabe bereit und die Erinnerung ist trotzdem nicht rausgegangen.
   *
   * Die Unterscheidung zu `!sent` ist der Punkt: An einem Montag, an dem nichts offen ist,
   * geht bewusst keine Mail raus, und das ist kein Fehler. Nur DIESES Feld darf den Lauf
   * rot färben (siehe api/cron/events).
   */
  failed: boolean;
};

type DraftRow = {
  title: string;
  starts_at: string;
  all_day: boolean;
  location_name: string | null;
};

/** Tag und Monat für den Zeitraum in der Kopfzeile („08.09."). */
const rangeFmt = new Intl.DateTimeFormat("de-AT", {
  timeZone: "Europe/Vienna",
  day: "2-digit",
  month: "2-digit",
});

/**
 * Der durchsuchte Zeitraum als eine Spanne, aus den Montagen der Wochen dieses Laufs.
 *
 * EINE Spanne statt einer Aufzählung von Kalenderwochen: „08.09. bis 21.09." beantwortet die
 * Frage „wie weit voraus ist das jetzt geplant?" ohne dass jemand Wochennummern in Datümer
 * übersetzen muss. Null, wenn der Lauf keine Woche zu tun hatte (alle schon protokolliert).
 */
function searchedRange(weekStarts: string[]): string | null {
  if (weekStarts.length === 0) return null;
  const sorted = [...weekStarts].sort();
  const first = new Date(`${sorted[0]}T12:00:00Z`);
  const last = new Date(Date.parse(`${sorted[sorted.length - 1]}T12:00:00Z`) + 6 * DAY_MS);
  return `${rangeFmt.format(first)} bis ${rangeFmt.format(last)}`;
}

/**
 * Alles, was gerade auf Freigabe wartet: Entwürfe, deren Tag noch nicht vorbei ist.
 *
 * AB HEUTE, nicht alles: Ein Entwurf für vorgestern ist keine Aufgabe mehr, er ist Abfall
 * (purgeStaleDrafts räumt ihn nach vierzehn Tagen weg). Stünde er in der Mail, wäre die Zahl
 * oben eine Zahl, an der man nichts mehr ändern kann, und die Erinnerung würde unglaubwürdig.
 */
async function pendingDrafts(): Promise<{ total: number; rows: DraftRow[] }> {
  const { data, count, error } = await createServiceClient()
    .from("events")
    .select("title, starts_at, all_day, location_name", { count: "exact" })
    .eq("status", "draft")
    .gte("starts_at", startOfViennaDayIso(new Date()))
    .order("starts_at", { ascending: true })
    .limit(LIST_LIMIT);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as DraftRow[];
  // `count` zählt ALLE Treffer, `limit` schneidet nur die Ausgabe ab. Ohne das exakte
  // Zählen stünde in der Mail immer höchstens LIST_LIMIT, egal wie hoch der Stapel wirklich ist.
  return { total: count ?? rows.length, rows };
}

/**
 * Die Freigabe-Erinnerung verschicken. WIRFT NIE.
 *
 * Sie ist das Ergebnis des Laufs, nicht seine Aufgabe: Ein Fehler hier darf den Cron nicht
 * rot färben, und ein leerer Stapel ist kein Fehler, sondern der Normalfall an einem Montag,
 * an dem schon alles freigegeben ist. Dann kommt keine Mail. Eine wöchentliche Nachricht mit
 * dem Inhalt „nichts zu tun" wäre nach dem dritten Mal eine, die man nicht mehr öffnet, und
 * beim vierten Mal stünde etwas drin.
 *
 * `research` ist absichtlich nur die Form, die gebraucht wird, und nicht der volle
 * AutoResult: So hängt dieses Modul nicht an lib/event-research.ts.
 */
export async function sendEventReviewMail(research: {
  weeks: { weekStart: string; inserted: number }[];
}): Promise<ReviewMailResult> {
  try {
    const { total, rows } = await pendingDrafts();
    if (total === 0) return { sent: false, pending: 0, reason: "nichts offen", failed: false };

    const lines: ReviewLine[] = rows.map((r) => ({
      when: adminWhenLabel(r.starts_at, r.all_day),
      title: r.title,
      where: r.location_name,
    }));

    const mail = renderEventReviewMail({
      pending: total,
      lines,
      found: research.weeks.reduce((n, w) => n + w.inserted, 0),
      range: searchedRange(research.weeks.map((w) => w.weekStart)),
      reviewUrl: `${siteUrl()}${EVENTS_REVIEW_ENTRY}`,
      at: new Date(),
    });

    // NICHT `quiet`: Bleibt diese Mail aus, soll das im Logbuch stehen. Die Schleifen-Gefahr,
    // wegen der die Alarm-Mail selbst schweigt, gibt es hier nicht.
    const ok = await sendEmail({
      to: adminRecipient(),
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    return ok
      ? { sent: true, pending: total, failed: false }
      : { sent: false, pending: total, reason: "Versand abgelehnt", failed: true };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "unbekannt";
    console.error("[events] Freigabe-Mail fehlgeschlagen:", reason);
    return { sent: false, pending: 0, reason, failed: true };
  }
}

/**
 * Wie viele Entwürfe warten gerade auf Freigabe? Wirft nie.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  WARUM DIESELBE ZAHL NOCH EINMAL, WO SIE DOCH IN DER MAIL STEHT
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Weil die Mail am 21.09.2026 nicht angekommen ist und elf recherchierte Events damit
 * unsichtbar im Admin lagen: Die Liste zeigt sie erst, wenn man den Reiter öffnet, und
 * öffnen tut man ihn, wenn man einen Grund dazu hat. Der Grund war die Mail. Ein Kanal,
 * der ausfällt, hat damit eine ganze Arbeitswoche verschluckt.
 *
 * Das Abzeichen an der Navigation ist der zweite Weg zu derselben Information, und zwar
 * der, der keinen Anbieter braucht. Die Mail bleibt die Erinnerung, das Abzeichen ist die
 * Wahrheit. Dasselbe Muster trägt schon der Support-Zähler daneben.
 *
 * Die Zahl geht über pendingDrafts(), damit „wartet auf Freigabe" genau EINE Definition
 * hat: Entwurf, dessen Tag noch nicht vorbei ist. Die paar Zeilen, die dabei mitkommen,
 * sind billiger als zwei Abfragen, die eines Tages verschieden zählen.
 */
export async function countPendingEventDrafts(): Promise<number> {
  try {
    return (await pendingDrafts()).total;
  } catch (e) {
    // Der Admin-Rahmen darf an einem Zähler nicht sterben.
    console.error("[events] Zählen der offenen Entwürfe:", e instanceof Error ? e.message : e);
    return 0;
  }
}
