import { Link } from "@/i18n/navigation";
import { getAdminSpots } from "@/lib/admin";
import BulkTranslateButton from "@/components/admin/BulkTranslateButton";
import AdminSpotList from "@/components/admin/AdminSpotList";

export default async function AdminPage() {
  const spots = await getAdminSpots();
  // Noch nicht vollständig übersetzte Spots (für den Sammel-Übersetzen-Button oben).
  const incomplete = spots
    .filter((s) => s.trState !== "complete")
    .map((s) => ({ id: s.id, label: s.title }));

  return (
    <div className="space-y-4 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">Admin · Spots</h1>
        <div className="flex flex-wrap items-center gap-2">
          <BulkTranslateButton kind="spot" items={incomplete} noun="Spots" />
          <Link
            href="/admin/spots/new"
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white active:scale-[0.98]"
          >
            + Neuer Spot
          </Link>
        </div>
      </div>

      {/* Suche + Filter + Liste leben im Client: die ganze Liste ist schon geladen, also wird
          im Browser gefiltert (sofort, kein zweiter Rundweg, keine Abfrage zum Angreifen). */}
      <AdminSpotList spots={spots} />
    </div>
  );
}
