"use server";

// Der einmalige "dein Pro ist da"-Gruss. EINE Quelle für alle drei Wege zu Pro
// (Migration 0044): selbst gekauft ('stripe'), von der alten Plattform übernommen
// ('migration'), von uns geschenkt ('comp').
//
// WARUM DAS EINE SERVER ACTION IST UND NICHT IM LAYOUT STEHT, und das ist die wichtigste
// Zeile hier: app/[locale]/layout.tsx holt bewusst KEINE Supabase-Daten. Die Locale-Routen
// werden statisch gerendert (generateStaticParams + setRequestLocale). Ein
// supabase.auth.getUser() dort liest Cookies und nähme der GANZEN App das statische
// Rendering — für einen Hinweis, den die allermeisten Aufrufe nie zu sehen bekommen.
// Deshalb der Weg über den Client wie bei getSavedSets() in saved-state-actions.ts: die
// Seite bleibt statisch, der Hinweis kommt nach dem Hydrieren nach.
//
// Markiert wird ERST beim Wegklicken (dismissProNotice), nicht beim Anzeigen. Vorher
// setzte auth/callback die Spalte schon bei der Weiterleitung: wer den Tab zumachte, hatte
// seinen Gruss für immer verpasst.

import { createClient } from "./supabase/server";
import { isProSource, type ProSource } from "./pro-source";

/**
 * Antwort der Nachfrage. `guest` ist bewusst getrennt von "eingeloggt, aber nichts offen":
 * Nur beim Gast darf der Client aufhören zu fragen. Wer eingeloggt ist, kann jederzeit Pro
 * geschenkt bekommen oder seinen Kauf bestätigt sehen, ohne dass der Browser etwas davon
 * mitbekommt — dort muss weiter nachgefragt werden.
 */
export type ProNoticeCheck = { source: ProSource | null; guest: boolean };

/**
 * Steht für den eingeloggten Nutzer noch der Gruss aus? Herkunft (bestimmt den Text)
 * oder null, wenn es nichts zu sagen gibt.
 *
 * Für Gäste kostet das nichts, die steigen in Zeile eins aus. Für Eingeloggte ist es eine
 * Suche über den Primärschlüssel auf drei kleine Spalten; dafür gibt es zusätzlich den
 * Teilindex aus 0044.
 *
 * Fehlertolerant, und das ist Absicht: Fehlt die Spalte (0044 noch nicht eingespielt) oder
 * hakt die Datenbank, gibt es eben keinen Gruss. Ein Hinweis, der ausfällt, darf nichts
 * mitreissen.
 */
export async function getPendingProNotice(): Promise<ProNoticeCheck> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // Gast: Ohne Anmeldung kann niemand Pro bekommen, und Anmelden ist immer ein echter
    // Seitenaufruf (auth/callback leitet um). Der Client darf deshalb aufhören zu fragen —
    // das spart den Grossteil aller Anfragen, denn Gäste sind der Grossteil des Verkehrs.
    if (!user) return { source: null, guest: true };

    const { data } = await supabase
      .from("profiles")
      .select("is_pro, pro_source, pro_notice_seen_at")
      .eq("id", user.id)
      .maybeSingle();

    if (!data?.is_pro) return { source: null, guest: false };
    if (data.pro_notice_seen_at != null) return { source: null, guest: false };

    // Pro ohne Herkunft ist ein Datenfehler und sollte nicht vorkommen. Dann lieber
    // schweigen als raten: "wir haben dir Pro geschenkt" an jemanden, der bezahlt hat,
    // wäre schlimmer als gar kein Gruss.
    return { source: isProSource(data.pro_source) ? data.pro_source : null, guest: false };
  } catch {
    // Fehler ist nicht "Gast": Sonst hörte der Client nach einem einzigen Aussetzer für
    // immer auf zu fragen.
    return { source: null, guest: false };
  }
}

/**
 * "Gesehen und weggeklickt." Danach kommt der Gruss nie wieder.
 *
 * Das `.is("pro_notice_seen_at", null)` ist kein Schmuck, sondern der Grund, warum zwei
 * offene Tabs (oder ein Doppelklick) hier nichts kaputt machen: Die Bedingung steckt im
 * UPDATE selbst, die Datenbank entscheidet. Ein zweiter Aufruf trifft schlicht keine Zeile
 * mehr und überschreibt insbesondere nicht den ursprünglichen Zeitpunkt.
 *
 * Kein Spaltenschutz nötig (0016 lässt diese Spalte bewusst frei): Wer sich das selbst
 * setzt, hat nur seinen eigenen Gruss weggeklickt.
 */
export async function dismissProNotice(): Promise<void> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from("profiles")
      .update({ pro_notice_seen_at: new Date().toISOString() })
      .eq("id", user.id)
      .is("pro_notice_seen_at", null);
  } catch {
    // Weggeklickt ist weggeklickt. Der Hinweis verschwindet im Browser so oder so; hakt
    // das Speichern, kommt er beim nächsten Laden nochmal. Lieber einmal zu viel als eine
    // Fehlermeldung für etwas, das der Mensch gerade schliessen wollte.
  }
}
