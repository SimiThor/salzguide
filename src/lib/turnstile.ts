import "server-only";
import { logOps, opsSubject } from "./ops";

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
//
// GEMELDET WIRD HIER UND NICHT BEI DEN VIER AUFRUFERN: Anmeldung, Profil, Support und
// Widerruf prüfen alle denselben Roboter-Check. Vier Kopien einer Meldezeile wären vier
// Gelegenheiten, sie unterschiedlich zu formulieren, und beim fünften Formular vergisst sie
// jemand ganz. `where` sagt trotzdem, WELCHES Formular betroffen war — ob Bots am Login oder
// am Support-Formular klopfen, ist der Unterschied zwischen Kontoklau und Spam.
export async function verifyTurnstile(
  token: string | null,
  remoteip?: string | null,
  where = "unbekannt",
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return true; // nicht konfiguriert -> kein Gate (Dev)

  const fail = async (grund: string): Promise<false> => {
    await logOps("turnstile_failed", {
      message: `Roboter-Check am Formular „${where}" nicht bestanden (${grund}).`,
      subject: remoteip ? opsSubject("ip", remoteip) : null,
      // Je Formular ein Fingerabdruck, nicht je Grund: Die Schwelle soll „am Login ist was
      // los" erkennen, nicht „es gab fünfzigmal ein fehlendes Token".
      group: `turnstile:${where}`,
      detail: { formular: where, grund },
    });
    return false;
  };

  if (!token || token.length > 2048) return fail(token ? "Token zu lang" : "kein Token");

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
    if (!res.ok) return fail(`Cloudflare antwortet mit ${res.status}`);
    const data = (await res.json()) as { success?: boolean };
    if (data.success === true) return true;
    return fail("abgelehnt");
  } catch {
    return fail("Cloudflare nicht erreichbar"); // Netzwerk-/Parsingfehler -> sicher blocken
  }
}
