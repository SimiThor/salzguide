import type { ReactNode } from "react";

// Schwebende Quick-Facts-Pille (docs/11/12), iOS-2026: Icon + Wert, ohne Labels.
export type Fact = { icon: ReactNode; value: string; label?: string };

export default function QuickFacts({ facts }: { facts: Fact[] }) {
  if (facts.length === 0) return null;
  return (
    <div className="flex items-stretch justify-around rounded-full bg-white px-3 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_14px_36px_-20px_rgba(0,0,0,0.3)]">
      {facts.map((f, i) => (
        <div
          key={i}
          className={`flex flex-1 flex-col items-center justify-center gap-1 px-2 text-center ${
            i > 0 ? "border-l border-black/[0.06]" : ""
          }`}
        >
          <span className="text-[20px] leading-none">{f.icon}</span>
          <span className="text-[13px] font-semibold leading-tight text-ink">
            {f.value}
          </span>
        </div>
      ))}
    </div>
  );
}
