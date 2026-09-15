import { notFound } from "next/navigation";
import { getAreasAdmin, getAreaPoints } from "@/lib/tour-pool";
import { getTourForEdit } from "@/lib/tours";
import { getDefaultVoice, getVoices } from "@/lib/tts-voices";
import TourForm from "@/components/admin/TourForm";
import BackButton from "@/components/BackButton";

export const dynamic = "force-dynamic";
// Die Server-Actions der Seite (Vertonen je Datei) erben diese Grenze: ein ElevenLabs-Aufruf
// plus Upload passt in 60 s, auch ohne Fluid Compute.
export const maxDuration = 60;

export default async function EditTourPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tour = await getTourForEdit(id);
  if (!tour) notFound();
  const [areas, voices, defaultVoice] = await Promise.all([getAreasAdmin(), getVoices(), getDefaultVoice()]);
  const initialAreaPoints = tour.areaId
    ? (await getAreaPoints(tour.areaId)).map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        voicedLangs: p.voicedLangs,
        // Koordinaten braucht der Editor für die Linie über die Stationen.
        lat: p.lat,
        lng: p.lng,
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
        voices={voices}
        defaultVoiceId={defaultVoice?.id ?? null}
      />
    </div>
  );
}
