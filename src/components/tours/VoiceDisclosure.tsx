"use client";

import { useTranslations } from "next-intl";
import { disclosureOf, type VoiceInfo } from "@/lib/tts-rules";

// Der Satz unter dem Play-Knopf: wer hier spricht (Ehrlichkeit + Art. 50 KI-VO, docs/39).
//
// EIN Bauteil für alle Player (Tour-Peek, Ankunfts-Sheet der Radnavigation), damit die drei
// Fälle überall gleich heissen: KI-Stimme, „Die Stimme von Simon, per KI gesprochen" bei
// einer geklonten Stimme (Art. 50(4): Offenlegung ist dort Pflicht, nicht Kür) und
// „Gesprochen von …" bei einer echten Aufnahme. `data-ai-voice` ist die maschinenlesbare
// Fassung, wie data-ai-origin bei Bildern. Steht IM Peek-Anker und damit sichtbar, BEVOR
// jemand auf Play drückt.
export default function VoiceDisclosure({
  voice,
  className = "",
}: {
  voice?: VoiceInfo | null;
  className?: string;
}) {
  const t = useTranslations("Tours");
  const d = disclosureOf(voice);
  return (
    <p
      className={`mt-1.5 text-[11px] leading-snug text-muted/80 ${className}`}
      data-ai-voice={voice?.kind ?? "synthetic"}
    >
      {d.name ? t(d.key, { name: d.name }) : t(d.key)}
    </p>
  );
}
