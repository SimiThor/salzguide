// Prüft den Anmelde-Code der iOS-App (docs/41, Abschnitt 5) gegen das ECHTE Supabase.
// Aufruf: npm run app-login-code:check
//
// Braucht KEINEN Server und verschickt KEINE Mail: createLoginCode() erzeugt den Code nur
// (generateLink), die Mail baut previewLoginCodeMail() ohne Versand. sendLoginCode() wird
// bewusst NICHT aufgerufen, denn .env.local trägt einen echten Resend-Schlüssel, und Mails
// an example.com prallen ab (schadet dem Absender-Ruf).
//
// Was bewiesen wird:
//  1. Bestehende Adresse: Code mit 6-8 Stellen (Länge ist eine Dashboard-Einstellung, docs/41 Abschnitt 5), verifyOtp(type "email") liefert eine Sitzung
//     für DASSELBE Konto.
//  2. Nagelneue Adresse (docs/41, Falle 1): generateLink legt das Konto an, der Code lässt sich
//     trotzdem mit type "email" einlösen.
//  3. Falscher Code scheitert, ein benutzter Code lässt sich nicht noch einmal einlösen.
//  4. Die Code-Mail rendert in allen 13 Sprachen, enthält den Code, keinen /auth/-Link und
//     keinen Gedankenstrich (ausser zh).
//  5. App und Web zählen mit denselben Schlüsseln (importierte subject()/withinLimit()).
//
// AUFRÄUMEN: Alle Konten tragen das Muster app-api-check+...@example.com und werden im finally
// gelöscht (bestätigt), dazu die Zähler-Zeilen aus rate_limits. Ausgegeben wird nie eine
// Adresse (nur "Wegwerf-Adresse"), nie ein Code, nie ein Token.
import { readFileSync } from "node:fs";
import { LOCALE_CODES } from "../src/i18n/locales.ts";
import { createLoginCode, ipv6Prefix64, strictAppAddress } from "../src/lib/login-code.ts";
import { previewLoginCodeMail } from "../src/lib/login-code.ts";
import { subject, withinLimit } from "../src/lib/login-link.ts";
import {
  anonClient,
  createTempUser,
  deleteTempUser,
  deleteTempUserByEmail,
  newTempEmail,
  serviceClient,
  sweepTempUsers,
} from "./lib/temp-user.ts";
import type { TempUser } from "./lib/temp-user.ts";

let okCount = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): boolean {
  if (cond) {
    okCount++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FEHLT ${name}${detail ? `\n        ${detail}` : ""}`);
  }
  return cond;
}
const head = (msg: string) => console.log(`\n${msg}`);

async function obtainCode(email: string): Promise<string | null> {
  const made = await createLoginCode(email);
  return made.ok ? made.code : null;
}

let existing: TempUser | null = null;
let freshEmail: string | null = null;
let ratePair: string[] = [];
let cleaned = false;

async function cleanup(): Promise<void> {
  if (cleaned) return;
  cleaned = true;
  try {
    if (existing) check("Konto (bestehende Adresse) gelöscht, bestätigt", await deleteTempUser(existing.id));
    if (freshEmail) check("Konto (neue Adresse) gelöscht, bestätigt", await deleteTempUserByEmail(freshEmail));
    if (ratePair.length) {
      await serviceClient().from("rate_limits").delete().in("subject", ratePair);
    }
    const swept = await sweepTempUsers();
    console.log(`  ..    ${swept} liegengebliebene Wegwerf-Konten früherer Läufe entfernt`);
  } catch (e) {
    failed++;
    console.log(`  FEHLT Aufräumen: ${e instanceof Error ? e.message : "unbekannt"}`);
  }
}
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => void cleanup().finally(() => process.exit(130)));
}

try {
  head("0. Supabase-Einstellung");
  existing = await createTempUser();
  const probe = await serviceClient().auth.admin.generateLink({ type: "magiclink", email: existing.email });
  const probeLen = probe.data?.properties?.email_otp?.length ?? 0;
  // Die Länge ist eine Dashboard-Einstellung (Soll laut docs/41: 6). Nur melden, nicht scheitern.
  console.log(`  ..    Email-OTP-Laenge: ${probeLen}, Soll laut docs/41: 6 (Dashboard)`);
  const viaCore = await createLoginCode(existing.email);
  check("createLoginCode akzeptiert die konfigurierte Länge (6 bis 8 Ziffern)", viaCore.ok && /^\d{6,8}$/.test(viaCore.code));

  head("1. Bestehende Adresse");
  const code1 = await obtainCode(existing.email);
  check("ein Code kommt zurück", !!code1);
  if (code1) {
    const made = { code: code1 };
    const res = await anonClient().auth.verifyOtp({ email: existing.email, token: made.code, type: "email" });
    check("verifyOtp(type email) liefert eine Sitzung", !!res.data.session, res.error?.message);
    check("Sitzung gehört zum selben Konto", res.data.user?.id === existing.id);

    head("3a. Benutzter Code");
    const again = await anonClient().auth.verifyOtp({ email: existing.email, token: made.code, type: "email" });
    check("derselbe Code lässt sich nicht ein zweites Mal einlösen", !again.data.session && !!again.error);
  }

  head("3b. Falscher Code");
  const secondCode = await obtainCode(existing.email);
  if (secondCode) {
    const second = { code: secondCode };
    // Eine Ziffernfolge gleicher Länge, die garantiert nicht der echte Code ist.
    const wrong = second.code.replace(/./g, second.code[0] === "0" ? "1" : "0");
    const bad = await anonClient().auth.verifyOtp({ email: existing.email, token: wrong, type: "email" });
    check("falscher Code scheitert", !bad.data.session && !!bad.error);
    const good = await anonClient().auth.verifyOtp({ email: existing.email, token: second.code, type: "email" });
    check("der richtige Code gilt danach noch (falscher Versuch verbraucht ihn nicht)", !!good.data.session);
  } else {
    check("zweiter Code erzeugbar", false);
  }

  head("2. Nagelneue Adresse (Signup-Token)");
  freshEmail = newTempEmail();
  const before = await deleteTempUserByEmail(freshEmail);
  check("Adresse hat vorher kein Konto", before);
  const freshCode = await obtainCode(freshEmail);
  check("für eine neue Adresse kommt ein Code", !!freshCode);
  if (freshCode) {
    const fresh = { code: freshCode };
    const res = await anonClient().auth.verifyOtp({ email: freshEmail, token: fresh.code, type: "email" });
    check("verifyOtp(type email) löst den Signup-Code ein", !!res.data.session, res.error?.message);
    check("dabei ist das Konto entstanden", !!res.data.user?.id);
  }

  head("4. Mail vorschauen, alle 13 Sprachen");
  check("alle 13 Sprachen geprüft", LOCALE_CODES.length === 13, `${LOCALE_CODES.length}`);
  for (const l of LOCALE_CODES) {
    const code = "482913";
    const m = await previewLoginCodeMail(l, code);
    const both = `${m.subject}\n${m.html}\n${m.text}`;
    const dash = l !== "zh" && both.includes(String.fromCharCode(0x2014));
    const ok = m.html.includes(code) && m.text.includes(code) && !both.includes("/auth/") && !dash && m.subject.length > 0;
    check(`${l}: Code drin, kein /auth/-Link, kein Gedankenstrich`, ok);
    // Der Betreff darf nicht Deutsch sein, wenn die Sprache nicht Deutsch ist (Lader fällt sonst still zurück).
    if (l !== "de") {
      const de = await previewLoginCodeMail("de", code);
      check(`${l}: eigener Betreff (nicht der deutsche)`, m.subject !== de.subject);
    }
  }

  head("4b. App-eigene Grenzen und Adresspruefung");
  check("IPv6 -> /64-Praefix", ipv6Prefix64("2001:db8:1:2:aaaa:bbbb:cccc:dddd") === "2001:0db8:0001:0002");
  check("IPv6 mit :: wird ausgeschrieben", ipv6Prefix64("2001:db8::1") === "2001:0db8:0000:0000");
  check("IPv4 hat keinen Eimer", ipv6Prefix64("203.0.113.7") === null);
  check("IPv4-in-IPv6 hat keinen Eimer", ipv6Prefix64("::ffff:203.0.113.7") === null);
  // Nur die reine Adresspruefung, NIE sendLoginCode (echter Resend-Schluessel in .env.local).
  for (const bad of ["a..b@example.com", "a@-example.com", "a@example-.com", ".a@example.com", "a.@example.com", "a@b@example.com", "a@example..com"]) {
    check("abgelehnt: " + bad.replace(/^[^@]*/, "x"), !strictAppAddress(bad));
  }
  for (const good of ["anna@example.com", "anna+salz@example.com", "a.b@mail.example.co.at", "anna@xn--mnchen-3ya.de"]) {
    check("angenommen: " + good.replace(/^[^@]*/, "x"), strictAppAddress(good));
  }

  head("5. Gemeinsame Limit-Schlüssel mit dem Web");
  const src = readFileSync("src/lib/login-code.ts", "utf8");
  check(
    "login-code.ts nimmt withinLimit aus login-link.ts (keine eigenen Web-Schlüssel)",
    /import\s*\{[^}]*\bwithinLimit\b[^}]*\}\s*from\s*"\.\/login-link"/.test(src) && !/["']login-(mail|ip)/.test(src),
  );
  const mailKey = subject("mail", "x@example.com");
  const ipKey = subject("ip", "203.0.113.7");
  check("Schlüsselform login-mail:<32 hex>", /^login-mail:[0-9a-f]{32}$/.test(mailKey));
  check("Schlüsselform login-ip:<32 hex>", /^login-ip:[0-9a-f]{32}$/.test(ipKey));
  // Echter Beweis: withinLimit schreibt GENAU diese Schlüssel in rate_limits.
  const probeEmail = newTempEmail();
  const probeIp = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
  ratePair = [subject("mail", probeEmail), subject("ip", probeIp)];
  const allowed = await withinLimit(probeEmail, probeIp);
  check("withinLimit erlaubt den ersten Versuch", allowed);
  const rows = await serviceClient().from("rate_limits").select("subject").in("subject", ratePair);
  check("rate_limits trägt beide Schlüssel in der Web-Form", (rows.data?.length ?? 0) === 2, rows.error?.message);
} catch (e) {
  failed++;
  console.log(`  FEHLT Abbruch: ${e instanceof Error ? e.message : "unbekannt"}`);
} finally {
  head("Aufräumen");
  await cleanup();
}

console.log(`\n${okCount} ok, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
