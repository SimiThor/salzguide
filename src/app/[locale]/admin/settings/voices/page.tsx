import { setRequestLocale } from "next-intl/server";
import BackButton from "@/components/BackButton";
import VoiceManager from "@/components/admin/VoiceManager";
import { getVoices, voiceUsageAll } from "@/lib/tts-voices";

// Die Stimmen der Audio-Runden (tts_voices, Migration 0068): anlegen, Standard setzen,
// probehören, löschen. Gewählt wird eine Stimme nicht hier, sondern an der Runde
// (TourForm); hier steht nur, welche es gibt. Zugriff über das Admin-Layout (Rollen-Guard).
export const dynamic = "force-dynamic";

export default async function AdminVoicesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [voices, usage] = await Promise.all([getVoices(), voiceUsageAll()]);
  // Die Erzählstimme von heute hat ihre ID noch in der ENV. Sie wird hier als Vorbelegung
  // mitgegeben, damit Anton sie mit einem Klick übernimmt; danach ist die ENV nur noch
  // die Brücke, falls das Feld leer bleibt (tts-rules.ts, elevenIdOf).
  const envVoiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || null;

  return (
    <div className="space-y-4 pb-12">
      <BackButton fallbackHref="/admin/settings" label="Einstellungen" />
      <div>
        <h1 className="text-2xl font-bold text-ink">Stimmen</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Welche Stimme spricht, wählst du an der Runde.
        </p>
      </div>
      <VoiceManager voices={voices} usage={usage} envVoiceId={envVoiceId} />
    </div>
  );
}
