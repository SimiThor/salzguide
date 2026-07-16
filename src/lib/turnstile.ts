import "server-only";

// Cloudflare Turnstile (Bot-Schutz am Login). Verifiziert das Widget-Token SERVER-SEITIG
// gegen Cloudflare, bevor wir eine Magic-Link-Mail auslösen -> schützt das Supabase-Mail-
// Kontingent vor automatisiertem Massenversand (E-Mail-Bombing) durch Bots.
//
// Degradiert sauber: ohne TURNSTILE_SECRET_KEY (z.B. lokal) ist das Gate AUS -> Dev bleibt
// bequem. In Produktion beide Keys setzen, dann greift der Schutz automatisch.
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileEnabled(): boolean {
  return (
    !!process.env.TURNSTILE_SECRET_KEY?.trim() &&
    !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()
  );
}

// true = Token gültig ODER Gate nicht konfiguriert. false = konfiguriert, aber Token
// fehlt/ungültig -> Aufrufer bricht ab. Im Zweifel (Netzwerkfehler) wird geblockt.
export async function verifyTurnstile(
  token: string | null,
  remoteip?: string | null,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return true; // nicht konfiguriert -> kein Gate (Dev)
  if (!token || token.length > 2048) return false;

  try {
    const body = new URLSearchParams();
    body.set("secret", secret);
    body.set("response", token);
    if (remoteip) body.set("remoteip", remoteip);

    const res = await fetch(SITEVERIFY, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      // Kein Cache; kurzer Timeout-Schutz über AbortSignal.
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false; // Netzwerk-/Parsingfehler -> sicher blocken
  }
}
