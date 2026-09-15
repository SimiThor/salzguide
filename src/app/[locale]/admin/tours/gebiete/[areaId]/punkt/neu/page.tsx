import { getAreaForEdit, getVoiceDataForNewPoint } from "@/lib/tour-pool";
import PointForm from "@/components/admin/PointForm";
import BackButton from "@/components/BackButton";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vertonen je Datei, siehe tours/[id]/page.tsx

export default async function NewPointPage({
  params,
}: {
  params: Promise<{ areaId: string }>;
}) {
  const { areaId } = await params;
  const [area, voice] = await Promise.all([getAreaForEdit(areaId), getVoiceDataForNewPoint()]);
  return (
    <div className="space-y-4">
      <BackButton fallbackHref={`/admin/tours/gebiete/${areaId}`} />
      <h1 className="text-2xl font-bold text-ink">Neuer Punkt</h1>
      <PointForm areaId={areaId} areaName={area?.de.name ?? ""} voice={voice} />
    </div>
  );
}
