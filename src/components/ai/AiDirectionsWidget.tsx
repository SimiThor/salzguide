"use client";

import { useTranslations } from "next-intl";
import type { AiDirections } from "@/lib/ai-types";

// Kompaktes iOS-Anfahrts-Widget im Chat: Auto- und/oder Öffi-Button, die die
// fertige (korrekte) Google-Maps-Route öffnen. Minimalistisch, brand-konform.
function ModeButton({
  emoji,
  label,
  href,
}: {
  emoji: string;
  label: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-black/[0.03] px-3 py-2.5 text-[13px] font-semibold text-ink ring-1 ring-black/[0.03] transition active:scale-[0.97]"
    >
      <span aria-hidden>{emoji}</span>
      {label}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-muted" aria-hidden>
        <path d="M7 17L17 7M9 7h8v8" />
      </svg>
    </a>
  );
}

export default function AiDirectionsWidget({ directions }: { directions: AiDirections }) {
  const t = useTranslations("Ai");
  const { carUrl, transitUrl } = directions;
  if (!carUrl && !transitUrl) return null;

  return (
    <div className="rounded-[16px] bg-white p-3 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.04]">
      <p className="mb-2 text-[12px] font-semibold text-muted">{t("directions")}</p>
      <div className="flex gap-2">
        {carUrl && <ModeButton emoji="🚗" label={t("byCar")} href={carUrl} />}
        {transitUrl && <ModeButton emoji="🚌" label={t("byTransit")} href={transitUrl} />}
      </div>
    </div>
  );
}
