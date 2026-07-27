"use server";

import { createClient } from "./supabase/server";
import { safeLocale } from "@/i18n/locales";

/**
 * Die gewählte Sprache am Konto vermerken.
 *
 * WOZU: `profiles.locale` entscheidet, in welcher Sprache unsere Mails ankommen (geschenktes
 * Pro und alles, was später dazukommt). Beim Anmelden wird der Wert gesetzt (auth/callback),
 * aber wer sich vor zwei Monaten auf Deutsch angemeldet hat und die App seither auf Englisch
 * benutzt, bekäme sonst weiter deutsche Post. Die Sprache, die jemand HEUTE benutzt, ist das
 * ehrlichere Signal.
 *
 * WIRD ABSICHTLICH IGNORIERT, WENN NIEMAND ANGEMELDET IST: Ohne Konto gibt es keine Zeile,
 * in die es gehört, und ein Cookie dafür wäre ein Zustand mehr für eine Sache, die nur Mails
 * betrifft. Gäste bekommen ohnehin nur die Anmelde-Mail, und deren Sprache steht im Formular.
 *
 * WIRFT NIE: Ein Sprachwechsel darf nicht daran scheitern, dass die Datenbank hakt. Im
 * schlimmsten Fall kommt die nächste Mail in der vorherigen Sprache.
 */
export async function rememberLocale(code: string): Promise<void> {
  const locale = safeLocale(code);
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("profiles").update({ locale }).eq("id", user.id);
  } catch (e) {
    console.error("rememberLocale:", e instanceof Error ? e.message : e);
  }
}
