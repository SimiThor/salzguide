import { LOCALE_CODES } from "@/i18n/locales";
import { clientIp } from "@/lib/analytics";
import { appError, appFailure, appJson, appRateLimit } from "@/lib/app-api";
import type { AppEmailCodeSent } from "@/lib/app-api-types";
import { isValidEmail } from "@/lib/email-valid";
import { sendLoginCode } from "@/lib/login-code";

export const runtime = "nodejs";

// Ein Body aus Adresse und Sprachkürzel braucht keine 2 KB. Alles darüber ist kein Login.
const MAX_BODY_BYTES = 2000;

/**
 * Anmelde-Code per Mail an die App schicken (docs/41, Abschnitt 5). Ohne Bearer: Wer sich
 * anmelden will, hat noch keinen. Ein mitgeschickter Authorization-Header wird ignoriert.
 *
 * Antwortet für bekannte und unbekannte Adressen GLEICH ("sent"), damit niemand erfährt, wer
 * ein Konto hat. Das Limit teilt sich die App mit dem Web-Login (siehe lib/login-code.ts).
 */
export async function POST(req: Request) {
  try {
    // Nur die native App darf hier anklopfen. URLSession schickt keinen Origin-Header, ein
    // Browser schickt ihn bei jedem seitenübergreifenden POST. Und ein Content-Type
    // application/json erzwingt im Browser eine Preflight-Anfrage, die scheitert, weil wir
    // keine CORS-Header senden. Das blockt "irgendeine Webseite lässt die Browser ihrer
    // Besucher uns anrufen", was die IP-Limits auf viele fremde IPs verteilen würde.
    if (req.headers.has("origin")) return appError("invalid", 400);
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return appError("invalid", 400);

    // SCHALTER: Die Route bleibt in Produktion dunkel, bis die App in TestFlight geht; Simon
    // setzt dann APP_EMAIL_CODE_ENABLED=1. Aus = 503, ohne Ops-Meldung und ohne Datenbankzugriff.
    if (process.env.APP_EMAIL_CODE_ENABLED !== "1") return appError("unavailable", 503);

    // IP-Bremse der App-API (wie appGuard), erst danach der Body.
    if (!(await appRateLimit(req))) return appError("rate_limit", 429);

    const declared = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return appError("invalid", 400);

    // Auch ohne (oder mit gelogenem) Content-Length nie mehr als die Grenze verarbeiten.
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return appError("invalid", 400);

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return appError("invalid", 400);
    }
    if (typeof body !== "object" || body === null) return appError("invalid", 400);
    const { email: rawEmail, locale } = body as { email?: unknown; locale?: unknown };
    if (typeof rawEmail !== "string" || typeof locale !== "string") return appError("invalid", 400);
    // Sprache nur aus der festen Liste (wie appLang), kein Durchreichen eines fremden Werts.
    if (!LOCALE_CODES.includes(locale)) return appError("invalid", 400);
    // Dieselbe Aufbereitung wie im Web-Formular: Länge VOR dem Trim kappen, dann klein.
    if (rawEmail.length > 320) return appError("invalid", 400);
    const email = rawEmail.trim().toLowerCase();
    if (!isValidEmail(email)) return appError("invalid", 400);

    const result = await sendLoginCode({ email, locale, ip: clientIp(req) });
    if (result === "invalid") return appError("invalid", 400);
    if (result === "rate") return appError("rate_limit", 429);
    if (result === "failed") return appError("unavailable", 503);

    const sent: AppEmailCodeSent = { ok: true };
    return appJson(sent, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}
