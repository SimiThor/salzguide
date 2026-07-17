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
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(nextPath, origin));
  }

  const errUrl = new URL(nextPath, origin);
  errUrl.searchParams.set("auth_error", "1");
  return NextResponse.redirect(errUrl);
}
