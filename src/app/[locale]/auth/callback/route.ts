import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Magic-Link-Rücksprung: Code gegen Session tauschen, dann weiterleiten.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const { locale } = await params;
  // Wohin, wenn `next` fehlt oder unbrauchbar ist: auf die Karte, nicht auf „/" — dort
  // liegt seit 07/2026 die Verkaufs-Startseite, und wer sich gerade eingeloggt hat, ist
  // kein neuer Besucher mehr. Betrifft nur den blanken Magic-Link (LoginGate schickt
  // immer ein `next` mit) — also genau den Weg, den man am seltensten nachtestet.
  const fallback = `/${locale}/explore`;

  // Open-Redirect-Schutz (bulletproof): `next` gegen unsere Origin auflösen und die
  // RESULTIERENDE Origin prüfen. So entscheidet der WHATWG-Parser selbst — deckt
  // "//evil", "/\evil", Tab/Newline-Tricks und absolute URLs ab, ohne String-Raten.
  // Nur wenn das Ziel exakt auf unserer Origin liegt, wird der Pfad übernommen.
  const rawNext = searchParams.get("next") ?? fallback;
  let nextPath = fallback;
  try {
    const u = new URL(rawNext, origin);
    if (u.origin === origin) nextPath = u.pathname + u.search;
  } catch {
    /* ungültig -> fallback */
  }

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Newsletter-Einwilligung einlösen (`nl=1` hat der Login an diesen Link gehängt).
      //
      // WARUM ERST HIER: Das Häkchen im Formular ist eine Behauptung („mir gehört diese
      // Adresse"), der Klick auf den Link in DIESEM Postfach ist der Beweis. Erst beide
      // zusammen ergeben eine nachweisbare Einwilligung (Art. 7 Abs. 1 DSGVO, § 174 TKG).
      // Wer eine fremde Adresse einträgt, kommt hier nie an — genau das ist der Sinn.
      //
      // Nur von „nein" auf „ja": Das `.eq("newsletter_opt_in", false)` ist die halbe Miete.
      // Ohne das überschriebe jeder spätere Login den Zeitpunkt der Einwilligung, und der
      // Nachweis „seit wann" wäre wertlos.
      //
      // Ein Fehler hier darf den Login NICHT aufhalten: Wer sich anmeldet, kommt herein,
      // auch wenn das Häkchen verloren geht. Deshalb try/catch ohne Konsequenz.
      if (searchParams.get("nl") === "1" && data?.user) {
        try {
          await supabase
            .from("profiles")
            .update({ newsletter_opt_in: true, newsletter_opt_in_at: new Date().toISOString() })
            .eq("id", data.user.id)
            .eq("newsletter_opt_in", false);
        } catch (e) {
          console.error("newsletter opt-in:", e instanceof Error ? e.message : e);
        }
      }

      // Der Login bringt den Menschen nur noch dorthin, wo er hinwollte.
      //
      // Die einmalige Begrüssung "dein Pro ist da" hing bis 0044 hier: Wer als Alt-Käufer
      // hereinkam, wurde aufs Profil umgeleitet und in derselben Bewegung als informiert
      // markiert — auch wenn er den Gruss nie zu Gesicht bekam. Und für geschenktes Pro
      // gab es überhaupt keinen Weg, weil da niemand durch diese Route kommt.
      //
      // Jetzt entscheidet ein Zustand in der Datenbank, und ProNotice zeigt den Gruss
      // dort, wo der Mensch gerade ist (siehe lib/pro-notice-actions.ts). Die Begründung
      // aus Migration 0041 bleibt damit gewahrt: Persönliches erst NACH dem Login, nie
      // davor, sonst wäre es ein Orakel für fremde Adressen.
      return NextResponse.redirect(new URL(nextPath, origin));
    }
  }

  const errUrl = new URL(nextPath, origin);
  errUrl.searchParams.set("auth_error", "1");
  return NextResponse.redirect(errUrl);
}
