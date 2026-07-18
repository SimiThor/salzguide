"use client";

import { useEffect, useRef } from "react";
import { Link, usePathname } from "@/i18n/navigation";

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

type Tab = { href: string; label: string };

// Reihenfolge = Häufigkeit. Was man täglich braucht, steht links.
const TABS: readonly Tab[] = [
  { href: "/admin", label: "Spots" },
  { href: "/admin/events", label: "Events" },
  { href: "/admin/tours", label: "Audio-Touren" },
  { href: "/admin/users", label: "Nutzer" },
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

export default function AdminNav({ supportCount = 0 }: { supportCount?: number }) {
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
    // Karten wanderten mit, obwohl nur die Leiste zu breit war. Der Streifen fängt das
    // Überbreite jetzt selbst ab: er scrollt, die Seite steht still.
    // -mx-4/px-4 spiegelt das px-4 des Admin-Rahmens (layout.tsx), damit die Pillen bis an
    // den Bildschirmrand laufen statt vorher hart abzureissen — dasselbe Muster wie bei den
    // Event-Filtern (EventsWeek.tsx).
    <div
      ref={strip}
      className="-mx-4 overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {/* w-max: der Streifen darf die Reiter NICHT zusammenquetschen. Ohne das würde Flex
          sie schmal rechnen und „Audio-Touren" umbrechen, statt zu scrollen. */}
      <nav className="flex w-max rounded-full bg-black/5 p-1">
        {TABS.map((t) => {
          // Der Zähler hängt an Nutzer, weil Support dort drinsteckt. Ohne ihn müsste man
          // hineinklicken, um zu sehen, dass jemand wartet — und dann klickt man jedes Mal
          // umsonst, oder man vergisst es.
          const badge = t.href === "/admin/users" ? supportCount : 0;
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
                  // Ohne Text wäre die Zahl für Screenreader ein nacktes „3".
                  aria-label={`${badge} offene Support-Anfrage${badge === 1 ? "" : "n"}`}
                >
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
