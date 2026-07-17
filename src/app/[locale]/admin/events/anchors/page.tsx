import { Link } from "@/i18n/navigation";
import { getAdminAnchors, defaultAnchorCount } from "@/lib/anchors";
import AdminNav from "@/components/admin/AdminNav";
import AnchorManager from "@/components/admin/AnchorManager";

// Admin · Jahres-Events (Anker): pflegbare Erinnerungsliste für die KI-Wochenrecherche.
//
// Liegt unter /admin/events, nicht mehr als eigener Reiter: Die Anker sind kein eigener
// Bereich, sondern die Zutat für die Wochenrecherche der Events — und man fasst sie
// vielleicht zweimal im Jahr an. Ein Reiter in der Hauptnavigation kostet dagegen bei JEDEM
// Blick Aufmerksamkeit. Gleiches Muster wie Einstellungen -> Startseite.
export default async function AdminAnchorsPage() {
  const anchors = await getAdminAnchors();
  return (
    <div className="space-y-4 pb-12">
      {/* „events" bleibt aktiv: Man ist hier IN den Events, nur eine Ebene tiefer. */}
      <AdminNav active="events" />
      <div>
        <Link
          href="/admin/events"
          className="text-[13px] font-semibold text-muted transition hover:text-ink"
        >
          ← Events
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-ink">Jahres-Events (Anker)</h1>
        <p className="mt-1 text-sm text-muted">
          Bekannte jährliche Highlights, an die die KI bei JEDER Wochenrecherche
          erinnert wird – damit kein wichtiges Event übersehen wird. Du brauchst
          KEIN Datum: nur „gibt es · in welchen Monaten · offizielle Quelle“. Das
          genaue Datum & die Uhrzeit prüft die KI pro Woche selbst über die Quelle.
        </p>
      </div>
      <AnchorManager initial={anchors} defaultCount={defaultAnchorCount()} />
    </div>
  );
}
