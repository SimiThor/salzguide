import { getAreasAdmin } from "@/lib/tour-pool";
import { getDefaultVoice, getVoices } from "@/lib/tts-voices";
import TourForm from "@/components/admin/TourForm";
import BackButton from "@/components/BackButton";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // siehe tours/[id]/page.tsx

export default async function NewTourPage() {
  const [areas, voices, defaultVoice] = await Promise.all([getAreasAdmin(), getVoices(), getDefaultVoice()]);
  return (
    <div className="space-y-4">
      <BackButton fallbackHref="/admin/tours" />
      <h1 className="text-2xl font-bold text-ink">Neue kuratierte Runde</h1>
      {areas.length === 0 ? (
        <p className="rounded-[12px] bg-black/5 p-4 text-sm text-muted">
          Lege zuerst ein Gebiet mit ein paar Pool-Punkten an (Gebiete &amp; Punkte).
        </p>
      ) : (
        <TourForm
          areas={areas.map((a) => ({ id: a.id, name: a.name }))}
          voices={voices}
          defaultVoiceId={defaultVoice?.id ?? null}
        />
      )}
    </div>
  );
}
