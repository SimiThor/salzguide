// Die EINE Quelle für die Anzeigenamen der Ticket-Partner — dasselbe Muster wie
// lib/partners.ts (Inhalte-Partner), nur für die Buchungs-Shops hinter der
// Ticket-Kachel auf den Spot-Seiten.
//
// Warum es diese Datei gibt: In `spots.ticket_partner` stehen rohe Codes aus den
// Shortcodes der alten WordPress-Seite ([sg_tickets partner="gyg" ...]) — beim
// Import 1:1 übernommen, im Altbestand in zwei Schreibweisen ("gyg" und
// "getyourguide"). So ein Code ist ein internes Kürzel und darf nie unübersetzt
// in der Oberfläche landen.
//
// Unbekannter oder leerer Code -> null: Die Kachel zeigt dann schlicht keinen
// Untertitel, statt ein internes Kürzel zu verraten. Neuer Ticket-Partner?
// Eine Zeile hier ergänzen — sonst nichts.
const TICKET_PARTNER_NAMES: Record<string, string> = {
  gyg: "GetYourGuide",
  getyourguide: "GetYourGuide",
};

/** Anzeigename zu einem rohen Partner-Code aus der DB (z. B. "gyg" -> "GetYourGuide"). */
export function ticketPartnerName(code: string | null): string | null {
  if (!code) return null;
  return TICKET_PARTNER_NAMES[code.trim().toLowerCase()] ?? null;
}
