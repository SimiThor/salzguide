"use client";

import { useEffect, useRef } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import ScrollStrip from "@/components/ScrollStrip";

// Die Admin-Navigation. Steht EINMAL im Layout, nicht in jeder Seite.
//
// HIER STEHT NUR, WAS MAN OFT BRAUCHT.
// Was man selten anfasst, lebt als Kachel auf der Seite, zu der es gehört:
//   Events        -> Jahres-Events (die Zutat für die Wochenrecherche)
//   Nutzer        -> Support (Nachrichten von genau diesen Menschen)
//   Einstellungen -> Startseite, Analytics
// Jeder Reiter kostet bei JEDEM Blick Aufmerksamkeit, auch der, den man nie drückt. Wer
// hier etwas hinzufügt, sollte sich fragen, ob es diesen Preis wert ist.
//
// WARUM `active` NICHT MEHR ALS PROP KOMMT:
// Vorher stand `<AdminNav active="..." />` in zehn Seiten, jede mit einem handgepflegten
// Schlüssel. Zehn Stellen sind zehn Gelegenheiten, den falschen zu tippen — und niemand
// merkt es, weil ein falsch markierter Reiter nichts kaputtmacht, nur verwirrt. Der Pfad
// weiss ohnehin, wo man ist.

// `badgeWord`: [Einzahl, Mehrzahl] für die Vorlesehilfe. Ohne Text wäre die Zahl im
// Screenreader ein nacktes „3", und zwei Abzeichen an zwei Reitern klängen gleich.
type Tab = { href: string; label: string; badgeWord?: readonly [string, string] };

// Reihenfolge = Häufigkeit. Was man täglich braucht, steht links.
const TABS: readonly Tab[] = [
  { href: "/admin", label: "Spots" },
  {
    href: "/admin/events",
    label: "Events",
    badgeWord: ["Event wartet auf Freigabe", "Events warten auf Freigabe"],
  },
  { href: "/admin/tours", label: "Audio-Touren" },
  {
    href: "/admin/users",
    label: "Nutzer",
    badgeWord: ["offene Support-Anfrage", "offene Support-Anfragen"],
  },
  { href: "/admin/settings", label: "Einstellungen" },
];

/**
 * Welcher Reiter ist aktiv? Der mit dem LÄNGSTEN passenden Pfad-Anfang.
 *
 * "/admin/events/anchors" passt auf "/admin" (6 Zeichen) und "/admin/events" (13) — der
 * längere gewinnt, also Events. Ohne diese Regel wäre auf jeder Unterseite „Spots"
 * markiert, weil "/admin" auf alles passt.
 */
function activeHref(pathname: string): string {
  let best = "";
  for (const t of TABS) {
    const hit = pathname === t.href || pathname.startsWith(`${t.href}/`);
    if (hit && t.href.length > best.length) best = t.href;
  }
  return best;
}

/**
 * `badges`: Zahl je Reiter, geholt im Admin-Layout. Zwei Reiter tragen heute eine:
 * Nutzer (offener Support) und Events (Entwürfe, die auf Freigabe warten).
 *
 * WARUM EINE TABELLE UND KEIN PROP JE ZÄHLER: Beim zweiten Zähler stünde sonst schon
 * `supportCount` neben `eventCount` in der Signatur, beim dritten drei — und jedes davon
 * müsste unten in einer Kette von Ternären dem richtigen Reiter zugeordnet werden. Der
 * Reiter kennt seinen Schlüssel selbst, das genügt.
 */
export default function AdminNav({ badges = {} }: { badges?: Record<string, number> }) {
  const pathname = usePathname();
  const active = activeHref(pathname);
  const strip = useRef<HTMLDivElement>(null);
  const activeTab = useRef<HTMLAnchorElement>(null);

  // Der aktive Reiter kann ausserhalb des sichtbaren Streifens liegen — auf dem Handy ist
  // „Einstellungen" ganz rechts und damit genau dann abgeschnitten, wenn man dort ist.
  // Nicht scrollIntoView: das scrollt auch die SEITE (vertikal, und in jedem Vorfahren mit
  // Overflow). Hier wird nur der Streifen selbst verschoben, sonst nichts.
  useEffect(() => {
    const box = strip.current;
    const tab = activeTab.current;
    if (!box || !tab) return;
    const b = box.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    const air = 16; // damit die Pille nicht am Rand klebt
    if (t.right > b.right) box.scrollLeft += t.right - b.right + air;
    else if (t.left < b.left) box.scrollLeft -= b.left - t.left + air;
  }, [active]);

  return (
    // WARUM EIN EIGENER SCROLL-STREIFEN:
    // Die fünf Reiter sind zusammen breiter als ein iPhone. Vorher war das eine schlichte
    // `inline-flex`-Leiste — die hörte nicht am Rand auf, sondern schob das DOKUMENT breiter.
    // Ergebnis: die ganze Admin-Seite liess sich seitlich wegschieben, Überschriften und
    // Karten wanderten mit, obwohl nur die Leiste zu breit war.
    // Die Klassenliste dafür stand hier von Hand und war eine von vier leicht verschiedenen
    // Fassungen derselben Sache; jetzt kommt sie aus ScrollStrip, samt Maus-Ziehen und dem
    // Verlauf am Rand. `scrollRef` gibt das scrollende Element zurück, weil der Effekt oben
    // den aktiven Reiter selbst in den Blick holen muss.
    <ScrollStrip scrollRef={strip}>
      {/* w-max: der Streifen darf die Reiter NICHT zusammenquetschen. Ohne das würde Flex
          sie schmal rechnen und „Audio-Touren" umbrechen, statt zu scrollen. */}
      <nav className="flex w-max rounded-full bg-black/5 p-1">
        {TABS.map((t) => {
          // Ein Abzeichen sagt, dass dort Arbeit liegt, ohne dass man hineinklicken muss.
          // Ohne es klickt man jedes Mal umsonst — oder man vergisst es. Bei den Events
          // hing diese Information bis 09/2026 allein an der Montags-Mail, und als die
          // ausfiel, lagen elf Entwürfe eine Woche lang unbemerkt da.
          const badge = badges[t.href] ?? 0;
          return (
            <Link
              key={t.href}
              href={t.href}
              ref={active === t.href ? activeTab : undefined}
              // shrink-0 + whitespace-nowrap: eine Pille bleibt eine Pille, auch wenn der
              // Platz knapp wird. Genau das ist der Unterschied zwischen „scrollt" und
              // „quetscht sich zu zweizeiligem Kleinkram".
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                active === t.href ? "bg-white text-ink shadow-sm" : "text-muted"
              }`}
            >
              {t.label}
              {badge > 0 && (
                <span
                  className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold leading-none text-white"
                  aria-label={`${badge} ${t.badgeWord?.[badge === 1 ? 0 : 1] ?? ""}`.trim()}
                >
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </ScrollStrip>
  );
}
