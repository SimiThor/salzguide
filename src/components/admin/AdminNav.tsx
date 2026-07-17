import { Link } from "@/i18n/navigation";

// Kleine Admin-Navigation (Spots | Events | Anker). `active` markiert die aktuelle Seite.
export default function AdminNav({
  active,
}: {
  active:
    | "spots"
    | "events"
    | "anchors"
    | "tours"
    | "users"
    | "support"
    | "analytics"
    | "settings";
}) {
  const tabs = [
    { key: "spots", href: "/admin" as const, label: "Spots" },
    { key: "events", href: "/admin/events" as const, label: "Events" },
    { key: "anchors", href: "/admin/anchors" as const, label: "Jahres-Events" },
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
