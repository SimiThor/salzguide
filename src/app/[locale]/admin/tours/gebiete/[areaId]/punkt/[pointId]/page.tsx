import { notFound } from "next/navigation";
import { getPointForEdit, getAreaForEdit } from "@/lib/tour-pool";
import PointForm from "@/components/admin/PointForm";
import BackButton from "@/components/BackButton";

export const dynamic = "force-dynamic";

export default async function EditPointPage({
  params,
}: {
  params: Promise<{ areaId: string; pointId: string }>;
}) {
  const { areaId, pointId } = await params;
  const [point, area] = await Promise.all([getPointForEdit(pointId), getAreaForEdit(areaId)]);
  if (!point) notFound();
  return (
    <div className="space-y-4">
      <BackButton fallbackHref={`/admin/tours/gebiete/${areaId}`} />
      <h1 className="text-2xl font-bold text-ink">Punkt bearbeiten</h1>
      <PointForm areaId={areaId} areaName={area?.de.name ?? ""} initial={point} />
    </div>
  );
}
