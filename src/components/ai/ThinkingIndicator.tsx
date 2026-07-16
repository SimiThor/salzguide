"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";

// Verspielte, hochwertige „Toni denkt"-Animation (iOS 2026 / Apple-Intelligence-Feel):
// federnde Punkte (Overshoot-Bounce wie Airbnb) in einer Typing-Bubble + schimmernder
// Marken-Text. Brand-Akzent, minimalistisch, premium.

// Overshoot-Easing -> spielerischer „Pop" statt gleichförmigem Wippen.
const BOUNCE = [0.34, 1.56, 0.64, 1] as const;

export function PlayfulDots({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-1.5 ${className}`} aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block h-2 w-2 rounded-full bg-accent"
          animate={{ y: [0, -6, 0], scale: [1, 1.32, 1], opacity: [0.5, 1, 0.5] }}
          transition={{
            duration: 0.75,
            repeat: Infinity,
            ease: BOUNCE,
            delay: i * 0.14,
          }}
        />
      ))}
    </span>
  );
}

export default function ThinkingIndicator() {
  const t = useTranslations("Ai");
  return (
    <div className="flex items-center gap-2.5 pl-1">
      <div className="flex items-center rounded-[18px] rounded-bl-md bg-white px-3.5 py-3 shadow-sm ring-1 ring-black/[0.04]">
        <PlayfulDots />
      </div>
      <span className="sg-ai-text text-[13px] font-semibold">{t("thinking")}</span>
    </div>
  );
}
