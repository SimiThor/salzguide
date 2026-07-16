"use client";

import { useState } from "react";

// Tracking-Link-Generator für IG/TikTok-Ads (docs/34 §H). Erzeugt saubere Kurz-URLs
// (?s=&c=), die /api/track als Kampagne erfasst. Rein clientseitig, kein Storage.
const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export default function AdLinkBuilder({ baseUrl }: { baseUrl: string }) {
  const [campaign, setCampaign] = useState("");
  const [source, setSource] = useState("");
  const [copied, setCopied] = useState(false);

  const c = slug(campaign);
  const s = slug(source);
  const base = baseUrl.replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (s) params.set("s", s);
  if (c) params.set("c", c);
  const url = c ? `${base}/?${params.toString()}` : "";

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="rounded-[16px] bg-white p-4 shadow-sm ring-1 ring-black/[0.04]">
      <h2 className="text-[15px] font-semibold text-ink">Ad-Link erstellen</h2>
      <p className="text-[11px] text-muted">
        Erzeuge einen Tracking-Link für deine IG/TikTok-Ads. Klicks darüber landen in den
        Kampagnen-Kennzahlen.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <label className="flex flex-1 flex-col gap-1 text-[11px] font-medium text-muted">
          Kampagne *
          <input
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            placeholder="z.B. Sommer 2026"
            className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[13px] font-normal text-ink outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-[11px] font-medium text-muted">
          Quelle (optional)
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="z.B. instagram"
            className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[13px] font-normal text-ink outline-none focus:border-accent"
          />
        </label>
      </div>
      {url ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-black/[0.04] p-2">
          <code className="min-w-0 flex-1 truncate text-[12px] text-ink">{url}</code>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white active:scale-95"
          >
            {copied ? "Kopiert ✓" : "Kopieren"}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-muted">Gib einen Kampagnennamen ein …</p>
      )}
    </div>
  );
}
