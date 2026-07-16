import type { ReactNode } from "react";
import { ChevronRight } from "./icons";
import { safeHref } from "@/lib/url";

// Action-Tile (docs/21): Icon (im weichen Kreis) + Label + Sub + Chevron.
// SVG-Icon statt Emoji, Apple-Listen-Look.
export default function ActionTile({
  href,
  icon,
  label,
  sub,
  ad,
  newTab = true,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  sub?: string;
  ad?: string; // Werbekennzeichnung (Pflicht bei Affiliate)
  newTab?: boolean;
}) {
  // Nur sichere Schemata als Link rendern (http/https/tel/mailto). Unsicheres
  // (z.B. javascript:) -> nicht klickbar, aber weiterhin sichtbar (kein XSS).
  const safe = safeHref(href);
  const Tag = safe ? "a" : "div";
  return (
    <Tag
      href={safe ?? undefined}
      target={safe && newTab ? "_blank" : undefined}
      rel={safe && newTab ? "noopener noreferrer" : undefined}
      className="flex items-center gap-3.5 rounded-[16px] bg-white p-4 shadow-sm transition-transform active:scale-[0.98]"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-xl">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          {label}
          {ad && (
            <span className="rounded bg-black/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
              {ad}
            </span>
          )}
        </span>
        {sub && <span className="truncate text-xs text-muted">{sub}</span>}
      </span>
      <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-black/25" />
    </Tag>
  );
}
