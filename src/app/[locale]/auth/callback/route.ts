import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Wohin nach dem Login? Normalerweise `next`. Beim ERSTEN Mal für einen übernommenen
 * Alt-Käufer aber aufs Profil, mit `?welcome=pro` — dort steht dann „dein Pro ist da".
 *
 * Warum wir `next` dafür überschreiben: Dieser Mensch hat auf der alten Plattform bezahlt
 * und sieht gerade zum ersten Mal eine völlig fremde Seite. Die eine Sache, die er wissen
 * muss, ist „dein Pro ist mitgekommen". Das wiegt schwerer als die Seite, auf die er
 * ohnehin gerade wollte — und es passiert genau einmal in seinem Leben.
 *
 * Markiert wird SOFORT: Ein Hinweis, der bei jedem Login wieder auftaucht, ist kein
 * Willkommen mehr, sondern eine Belästigung. Wer den Tab zumacht, verpasst ihn — sein Pro
 * ist trotzdem da, der Hinweis war eine Höflichkeit, keine Bedingung.
 *
 * Fehlertolerant: Geht hier irgendwas schief (Spalte fehlt, weil 0041 noch nicht
 * eingespielt ist), landet er einfach normal auf `next`. Ein kaputter Willkommensgruss darf
 * kein kaputter Login sein.
 */
async function migrationWelcomeTarget(
  supabase: ServerClient,
  userId: string | undefined,
  locale: string,
  nextPath: string,
): Promise<string> {
  if (!userId) return nextPath;
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_pro, pro_source, migration_notice_seen_at")
      .eq("id", userId)
      .maybeSingle();

    const owed =
      profile?.is_pro === true &&
      profile?.pro_source === "migration" &&
      profile?.migration_notice_seen_at == null;
    if (!owed) return nextPath;

    const { error } = await supabase
      .from("profiles")
      .update({ migration_notice_seen_at: new Date().toISOString() })
      .eq("id", userId);
    // Konnte nicht markiert werden -> lieber gar nicht zeigen als bei jedem Login wieder.
    if (error) return nextPath;

    return `/${locale}/profil?welcome=pro`;
  } catch {
    return nextPath;
  }
}

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
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Einmalige Begrüssung für die Alt-Käufer: „dein Pro ist übernommen".
      //
      // HIER und nicht am Login-Formular, weil das der Punkt ist, an dem der Mensch
      // BEWIESEN hat, dass ihm die Adresse gehört. Vor dem Login wäre jede persönliche
      // Auskunft ein Orakel — jeder könnte fremde Adressen eintippen und erführe, wer
      // zahlender Kunde ist (siehe Migration 0041).
      //
      // Läuft für JEDEN Weg herein: Magic-Link wie Google gehen beide hier durch.
      const target = await migrationWelcomeTarget(supabase, data?.user?.id, locale, nextPath);
      return NextResponse.redirect(new URL(target, origin));
    }
  }

  const errUrl = new URL(nextPath, origin);
  errUrl.searchParams.set("auth_error", "1");
  return NextResponse.redirect(errUrl);
}
