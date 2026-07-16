import { notFound } from "next/navigation";
import { getAreasAdmin, getAreaPoints } from "@/lib/tour-pool";
import { getTourForEdit } from "@/lib/tours";
import TourForm from "@/components/admin/TourForm";
import BackButton from "@/components/BackButton";

export const dynamic = "force-dynamic";

export default async function EditTourPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tour = await getTourForEdit(id);
  if (!tour) notFound();
  const areas = await getAreasAdmin();
  const initialAreaPoints = tour.areaId
    ? (await getAreaPoints(tour.areaId)).map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        hasAudio: p.hasAudio,
      }))
    : [];
  return (
    <div className="space-y-4">
      <BackButton fallbackHref="/admin/tours" />
      <h1 className="text-2xl font-bold text-ink">Kuratierte Runde bearbeiten</h1>
      <TourForm
        initial={tour}
        areas={areas.map((a) => ({ id: a.id, name: a.name }))}
        initialAreaPoints={initialAreaPoints}
      />
    </div>
  );
}
