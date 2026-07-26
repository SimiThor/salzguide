// Der Anlass, aus dem jemand vor dem Login steht. EINE Liste für alle Login-Flächen.
//
// Vorher hatte jede Fläche ihre eigene Überschrift und ihren eigenen Erklärtext:
// /profil sagte "Anmelden oder Konto erstellen", /gespeichert sagte etwas anderes, die
// Pro-Seite ein Drittes und das Login-Gate ein Viertes. Vier Texte, die dasselbe meinen,
// in neun Sprachen. Jetzt wechselt nur noch Emoji + Überschrift, alles darunter ist überall
// gleich — und wer eine neue login-pflichtige Stelle baut, hängt einen Eintrag hier an.
export type LoginReason =
  | "default"
  | "saveSpot"
  | "saveEvent"
  | "buildTour"
  | "saved";

export const LOGIN_REASONS: readonly LoginReason[] = [
  "default",
  "saveSpot",
  "saveEvent",
  "buildTour",
  "saved",
] as const;

// KEIN Anlass „pro": Vor dem Kauf wird niemand mehr angemeldet. Der Pro-Kauf läuft ohne
// Konto (lib/pro-purchase.ts), das Konto entsteht danach aus der bezahlten E-Mail. Käme je
// wieder eine kostenpflichtige Stelle hinter einen Login, muss mit dem Anlass auch der
// Untertitel des Login-Screens zurückkommen: „Kostenlos, ohne Passwort" wäre dort eine
// Lüge, und zwar an der teuersten Stelle des Wegs.

// Emoji gehört in den Code, nicht in messages/*.json: sprachneutral, sonst 9x pflegen.
//
// Bewusst die Emojis, die die App für DIESE Inhalte ohnehin schon nutzt: 📍 als
// Spot-Platzhalter (SpotCard, LockedMedia), 📅 für Events (EventCard), 🎧 für Audio-Runden
// (touren/bauen). Das Emoji zeigt, worum es GEHT, die Überschrift sagt, was passiert.
//
// KEIN ✨: Das Funkeln ist bei SalzGuide die Marke der KI-Funktionen (AiSparkle.tsx) und
// darf nirgends sonst auftauchen, sonst verliert es genau die Bedeutung, für die es da ist.
//
// KEIN ⭐: Der Stern heisst in dieser App schon etwas anderes — „bekannt" bei den
// Spot-Fakten und „Highlight" bei den Events. Zweimal dasselbe Zeichen für zwei Sachen ist
// schlimmer als ein Zeichen zu wenig.
//
// „saved" FEHLT HIER MIT ABSICHT, und der Typ erzwingt das (Exclude). Die Merkliste hat
// bereits ein Zeichen: das Lesezeichen, das auf jedem Spot als Merken-Knopf sitzt und
// unten in der Leiste steht. Ein Emoji daneben wäre ein zweites Symbol für dieselbe Sache.
// Gezeichnet statt Emoji ist ausserdem das Ehrlichere: Es ist genau der Knopf, den man
// drückt. Gerendert wird es in LoginPanel (ReasonSymbol) und in gespeichert/page.tsx.
export const LOGIN_EMOJI: Record<Exclude<LoginReason, "saved">, string> = {
  default: "👋",
  saveSpot: "📍",
  saveEvent: "📅",
  buildTour: "🎧",
};

/**
 * Anlass aus einem URL-Parameter (`?for=saveSpot`) auf einen bekannten Wert festnageln.
 *
 * MUSS sein: Der Anlass wird als Übersetzungs-Schlüssel benutzt (`reasonTitle.<reason>`).
 * Ein durchgereichter Fremdwert liesse next-intl auf einen Schlüssel greifen, den es nicht
 * gibt — die Loginseite würfe dann einen Fehler, und zwar über eine Adresse, die jeder
 * frei tippen kann.
 */
export function safeLoginReason(v: string | undefined): LoginReason {
  return LOGIN_REASONS.includes(v as LoginReason) ? (v as LoginReason) : "default";
}
