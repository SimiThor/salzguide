// Die EINE Prüfung für Adressen, die an den Anmeldeweg gehen: Web-Formular (profil/actions.ts)
// und App-Route (api/app/v1/auth/email-code). Stand vorher als lokale Funktion in einer
// "use server"-Datei und war damit nicht teilbar: Ein Export von dort wäre ein öffentlicher
// POST-Endpunkt. Hier ist sie ein gewöhnliches Modul, ohne Server-Bezug.

// Strikte E-Mail-Validierung (Defense-in-Depth). Die Eingabe geht ohnehin nur an die
// GoTrue-Auth-API (parametrisiert) und via gebundenem Trigger-Insert in die DB -> KEINE
// SQL-Injection möglich. Diese Prüfung wehrt zusätzlich ab: Fehlformate, E-Mail-Header-
// Injection (CR/LF/Steuerzeichen), Homograph-/Whitespace-Tricks und übergroße Payloads.
// Regex bewusst LINEAR (negierte Zeichenklassen, kein verschachtelter Quantor) -> kein ReDoS.
// Praxissicherer ASCII-Zeichensatz: deckt real zustellbare E-Mails (Gmail/Outlook/… lassen
// im Local-Part nur ASCII zu, IDN-Domains kommen als Punycode xn--). Blockt HTML-/Injection-
// Metazeichen (< > " ' ; ( ) [ ] \ etc.), Whitespace und Steuerzeichen implizit.
const EMAIL_RE =
  /^[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,255}\.[a-zA-Z]{2,}$/;
// Steuerzeichen/CRLF explizit verbieten (Defense-in-Depth, ohne von der Regex abzuhängen).
const CONTROL_RE = /[\x00-\x1f\x7f]/;
export function isValidEmail(email: string): boolean {
  return (
    email.length >= 6 &&
    email.length <= 254 && // RFC 5321 Obergrenze
    EMAIL_RE.test(email) &&
    !CONTROL_RE.test(email)
  );
}
