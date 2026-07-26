// Die EINE Quelle der Haupt-Navigation (Seiten). Beide Header lesen daraus, damit PC und
// iPhone garantiert dieselben Menüpunkte tragen - kein doppeltes Pflegen zweier Listen.
//
// - Reihenfolge = die Reihenfolge im iPhone-Burger (dort stehen alle untereinander).
// - primary: am PC sofort in der Leiste sichtbar. Der Rest (primary: false) landet am PC
//   im "Mehr"-Untermenü. Am iPhone spielt primary keine Rolle - dort ist alles gelistet.
// - emoji: nur fürs PC-"Mehr"-Untermenü (Apple-Dropdown mit Icons). Der iPhone-Burger und
//   die PC-Hauptleiste bleiben reiner Text.
//
// KI/Toni steht bewusst NICHT hier: das ist eine Aktion (öffnet den Chat), keine Seite. Am
// PC ist es ein eigener Sparkle-Knopf, am iPhone sitzt es in der unteren Leiste - im
// Burger-Menü wäre es doppelt.

export type NavHref =
  | "/explore"
  | "/touren"
  | "/wasser"
  | "/events"
  | "/gespeichert"
  | "/profil";

export type NavItem = {
  /** Nav.<key> in den Übersetzungen. */
  key: string;
  href: NavHref;
  /**
   * Icon fürs PC-"Mehr"-Untermenü.
   *
   * Optional, weil nicht jeder Punkt ein Emoji verträgt: "Gespeichert" trägt in der ganzen
   * App ein gezeichnetes Lesezeichen (Merken-Knopf, untere Leiste, Login-Screen). Das
   * Emoji-Lesezeichen wäre dieselbe Sache in einer zweiten Form. Fehlt das Emoji, zeichnet
   * DesktopHeader das echte Symbol.
   */
  emoji?: string;
  /** Am PC sofort in der Leiste (true) oder im "Mehr"-Untermenü (false). */
  primary: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { key: "explore", href: "/explore", emoji: "🧭", primary: true },
  { key: "tours", href: "/touren", emoji: "🎧", primary: false },
  { key: "water", href: "/wasser", emoji: "🌊", primary: false },
  { key: "events", href: "/events", emoji: "🎫", primary: true },
  { key: "saved", href: "/gespeichert", primary: true },
  { key: "profile", href: "/profil", emoji: "👤", primary: true },
];
