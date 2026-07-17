import { Link } from "@/i18n/navigation";

// Kleine Admin-Navigation. `active` markiert die aktuelle Seite.
//
// HIER STEHT NUR, WAS MAN OFT BRAUCHT. Was man zweimal im Jahr anfasst, lebt als Kachel auf
// der Seite, zu der es gehört — so wie „Startseite" unter Einstellungen und „Jahres-Events"
// unter Events. Jeder Reiter kostet bei JEDEM Blick Aufmerksamkeit, auch der, den man nie
// drückt. Wer hier etwas hinzufügt, sollte sich fragen, ob es diesen Preis wert ist.
export default function AdminNav({
  active,
}: {
  active: "spots" | "events" | "tours" | "users" | "support" | "analytics" | "settings";
}) {
  const tabs = [
    { key: "spots", href: "/admin" as const, label: "Spots" },
    { key: "events", href: "/admin/events" as const, label: "Events" },
    { key: "tours", href: "/admin/tours" as const, label: "Audio-Touren" },
    { key: "users", href: "/admin/users" as const, label: "Nutzer" },
    { key: "support", href: "/admin/support" as const, label: "Support" },
    { key: "analytics", href: "/admin/analytics" as const, label: "Analytics" },
    { key: "settings", href: "/admin/settings" as const, label: "Einstellungen" },
  ];
  return (
    <nav className="inline-flex rounded-full bg-black/5 p-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
            active === t.key ? "bg-white text-ink shadow-sm" : "text-muted"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
