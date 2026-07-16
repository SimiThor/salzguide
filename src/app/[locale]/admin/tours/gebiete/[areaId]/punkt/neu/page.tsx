import { getAreaForEdit } from "@/lib/tour-pool";
import PointForm from "@/components/admin/PointForm";
import BackButton from "@/components/BackButton";

export const dynamic = "force-dynamic";

export default async function NewPointPage({
  params,
}: {
  params: Promise<{ areaId: string }>;
}) {
  const { areaId } = await params;
  const area = await getAreaForEdit(areaId);
  return (
    <div className="space-y-4">
      <BackButton fallbackHref={`/admin/tours/gebiete/${areaId}`} />
      <h1 className="text-2xl font-bold text-ink">Neuer Punkt</h1>
      <PointForm areaId={areaId} areaName={area?.de.name ?? ""} />
    </div>
  );
}
