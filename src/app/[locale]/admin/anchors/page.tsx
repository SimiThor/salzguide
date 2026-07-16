import { getAdminAnchors, defaultAnchorCount } from "@/lib/anchors";
import AdminNav from "@/components/admin/AdminNav";
import AnchorManager from "@/components/admin/AnchorManager";

// Admin · Jahres-Events (Anker): pflegbare Erinnerungsliste für die KI-Wochenrecherche.
export default async function AdminAnchorsPage() {
  const anchors = await getAdminAnchors();
  return (
    <div className="space-y-4 pb-12">
      <AdminNav active="anchors" />
      <div>
        <h1 className="text-2xl font-bold text-ink">Jahres-Events (Anker)</h1>
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
