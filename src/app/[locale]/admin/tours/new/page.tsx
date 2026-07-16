import { getAreasAdmin } from "@/lib/tour-pool";
import TourForm from "@/components/admin/TourForm";
import BackButton from "@/components/BackButton";

export const dynamic = "force-dynamic";

export default async function NewTourPage() {
  const areas = await getAreasAdmin();
  return (
    <div className="space-y-4">
      <BackButton fallbackHref="/admin/tours" />
      <h1 className="text-2xl font-bold text-ink">Neue kuratierte Runde</h1>
      {areas.length === 0 ? (
        <p className="rounded-[12px] bg-black/5 p-4 text-sm text-muted">
          Lege zuerst ein Gebiet mit ein paar Pool-Punkten an (Gebiete &amp; Punkte).
        </p>
      ) : (
        <TourForm areas={areas.map((a) => ({ id: a.id, name: a.name }))} />
      )}
    </div>
  );
}
