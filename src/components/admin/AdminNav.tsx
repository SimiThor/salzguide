"use client";

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

  return (
    <nav className="inline-flex rounded-full bg-black/5 p-1">
      {TABS.map((t) => {
        // Der Zähler hängt an Nutzer, weil Support dort drinsteckt. Ohne ihn müsste man
        // hineinklicken, um zu sehen, dass jemand wartet — und dann klickt man jedes Mal
        // umsonst, oder man vergisst es.
        const badge = t.href === "/admin/users" ? supportCount : 0;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
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
  );
}
