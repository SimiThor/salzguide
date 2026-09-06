import { NextResponse } from "next/server";
import { getAdminUserId } from "@/lib/admin-guard";
import { EVENTS_REVIEW_TARGET } from "@/lib/event-review-mail";
import { routing } from "@/i18n/routing";

// Der Knopf aus der Freigabe-Mail. Eine Weiche, sonst nichts.
//
// WARUM DIESE ROUTE EXISTIERT und die Mail nicht einfach auf /de/admin/events zeigt:
// Der Admin-Rahmen wirft jeden, der nicht angemeldet ist, wortlos auf /profil (siehe
// [locale]/admin/layout.tsx) und verliert dabei das Ziel. Nach dem Anmelden landet man auf
// der Karte. Genau der Fall, der am Handy Wochen nach dem Deploy eintritt: Mail auf, Knopf
// gedrückt, und dann sucht man sich den Weg selbst. Ein Layout kann das nicht besser machen,
// weil es in Next seinen eigenen Pfad nicht kennt. Ein Route Handler kennt ihn.
//
// SICHERHEIT: Hier wird nichts freigeschaltet und nichts gelesen. Wer nicht Admin ist, wird
// zum Login geschickt; das Gate an der Seite selbst und die RLS-Policies in Postgres bleiben
// unverändert die Stellen, die entscheiden. Die Route sagt nur, wohin man gehen wollte.
//
// Immer Deutsch: Diese Mail geht an uns, und das Admin ist ohnehin nur auf Deutsch geschrieben.
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const { origin } = new URL(req.url);
  const target = `/${routing.defaultLocale}${EVENTS_REVIEW_TARGET}`;

  const url = await (async () => {
    if (await getAdminUserId()) return new URL(target, origin);
    // `next` ist ein relativer Pfad auf unserer eigenen Seite; safeNext() im Login prüft ihn
    // ein zweites Mal, bevor daraus die Rücksprung-Adresse des Anmeldelinks wird.
    const login = new URL(`/${routing.defaultLocale}/profil`, origin);
    login.searchParams.set("next", target);
    return login;
  })();

  // no-store, weil die Antwort davon abhängt, WER fragt. Eine zwischengespeicherte
  // Weiterleitung würde den nächsten Besucher auf das Ergebnis des vorigen schicken.
  return NextResponse.redirect(url, { status: 307, headers: { "cache-control": "no-store" } });
}
