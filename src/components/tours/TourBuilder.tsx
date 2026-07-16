"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import TourView from "@/components/tours/TourView";
import BackButton from "@/components/BackButton";
import { generateTour } from "@/lib/tour-generate";
import AiButton from "@/components/admin/AiButton";
import { TAG_KEYS, TAG_EMOJI } from "@/lib/tour-tags";
import type { TourDetail } from "@/lib/tour-types";
import type { PublicArea } from "@/lib/tours";

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.28)]";

export default function TourBuilder({ areas }: { areas: PublicArea[] }) {
  const t = useTranslations("Tours");
  const locale = useLocale();
  const router = useRouter();
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [phase, setPhase] = useState<"pick" | "loading" | "result">("pick");
  const [result, setResult] = useState<TourDetail | null>(null);
  const [err, setErr] = useState("");

  const toggle = (k: string) =>
    setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  function onGenerate() {
    if (phase === "loading" || !areaId) return;
    setPhase("loading");
    setErr("");
    void (async () => {
      const interests = selected.map((k) => t(`chip.${k}`));
      const r = await generateTour({ areaId, interests, freeText, locale });
      if (r.ok && r.id) {
        // Automatisch gespeichert -> direkt auf die feste Seite der Runde.
        router.push(`/touren/meine/${r.id}`);
      } else if (r.ok && r.tour) {
        // Fallback (Speichern nicht möglich): Runde trotzdem anzeigen.
        setResult(r.tour);
        setPhase("result");
      } else {
        setErr(r.error === "too_few" ? t("genTooFew") : t("genError"));
        setPhase("pick");
      }
    })();
  }

  function reset() {
    setResult(null);
    setPhase("pick");
  }

  if (phase === "result" && result) {
    return <TourView tour={result} onRestart={reset} />;
  }

  return (
    <div className="mx-auto w-full max-w-[640px] px-4 pt-[calc(env(safe-area-inset-top)+1.25rem)] md:pt-6">
      <BackButton fallbackHref="/touren" label={t("backToList")} className="mb-3" />
      <h1 className="text-2xl font-bold text-ink">{t("buildTitle")}</h1>
      <p className="mt-1 text-[15px] leading-relaxed text-muted">{t("buildLead")}</p>

      {areas.length === 0 ? (
        <div className={`${CARD} mt-8 p-8 text-center`}>
          <p className="text-[15px] leading-relaxed text-muted">{t("listEmpty")}</p>
        </div>
      ) : (
        <>
          {areas.length > 1 && (
            <div className="mt-4">
              <label className="mb-1 block text-[13px] font-medium text-muted">{t("area")}</label>
              <select
                className="w-full rounded-[12px] border border-black/10 bg-white px-3 py-2 text-[15px] text-ink outline-none focus:border-accent"
                value={areaId}
                onChange={(e) => setAreaId(e.target.value)}
              >
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-5">
            <p className="mb-2 text-[13px] font-medium text-muted">{t("interests")}</p>
            <div className="flex flex-wrap gap-2">
              {TAG_KEYS.map((k) => {
                const on = selected.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggle(k)}
                    aria-pressed={on}
                    className={`rounded-full px-3.5 py-1.5 text-[14px] font-medium transition active:scale-95 ${
                      on ? "bg-ink text-white" : "bg-black/[0.06] text-ink/80 hover:bg-black/[0.1]"
                    }`}
                  >
                    <span aria-hidden>{TAG_EMOJI[k]}</span> {t(`chip.${k}`)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5">
            <label className="mb-1 block text-[13px] font-medium text-muted">{t("freeText")}</label>
            <input
              className="w-full rounded-[12px] border border-black/10 bg-white px-3 py-2 text-[15px] text-ink outline-none focus:border-accent"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder={t("freeTextPlaceholder")}
            />
          </div>

          {err && (
            <p className="mt-4 rounded-[12px] bg-accent/10 px-3 py-2 text-sm text-accent">{err}</p>
          )}

          <AiButton
            loading={phase === "loading"}
            loadingLabel={t("generating")}
            onClick={onGenerate}
            disabled={!areaId}
            className="mt-6 w-full rounded-full bg-accent px-5 py-3 text-[15px] font-semibold text-white sm:w-auto"
          >
            ✨ {t("generate")}
          </AiButton>
        </>
      )}
    </div>
  );
}
