import { getTranslations } from "next-intl/server";
import { bcp47 } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { getLakeReadingByName } from "@/lib/water-temp";

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.28)]";

// Async Server-Component: aktuelle Wassertemperatur eines Sees (nur wenn der Spot
// ein lake_name hat und Daten vorliegen). Quelle: Land Salzburg bzw. AGES.
export default async function SpotWaterTemp({
  lakeName,
  locale,
}: {
  lakeName: string;
  locale: string;
}) {
  const res = await getLakeReadingByName(lakeName);
  if (!res?.reading) return null;
  const { lake, reading } = res;

  const t = await getTranslations({ locale, namespace: "Detail.water" });
  const loc = bcp47(locale);
  const dateLabel = new Intl.DateTimeFormat(loc, {
    day: "numeric",
    month: "long",
  }).format(new Date(reading.at));
  const temp = reading.tempC.toLocaleString(loc, { maximumFractionDigits: 1 });
  const sourceLabel =
    reading.source === "salzburg" ? "Land Salzburg" : "AGES Badegewässer";

  return (
    <section className={`${CARD} p-5`}>
      <h2 className="mb-3 text-[17px] font-semibold text-ink">{t("title")}</h2>
      <div className="flex items-center gap-3">
        <span className="text-[#3b82c4]" aria-hidden>
          <svg width="28" height="28" viewBox="0 0 256 256" fill="currentColor">
            <path d="M174,47.75a254.19,254.19,0,0,0-41.45-38.3,8,8,0,0,0-9.18,0A254.19,254.19,0,0,0,82,47.75C54.51,79.32,40,112.6,40,144a88,88,0,0,0,176,0C216,112.6,201.49,79.32,174,47.75ZM128,216a72.08,72.08,0,0,1-72-72c0-57.23,55.47-105,72-118,16.53,13,72,60.77,72,118A72.08,72.08,0,0,1,128,216Z" />
          </svg>
        </span>
        <div className="leading-tight">
          <span className="text-[26px] font-semibold text-ink">{temp}&nbsp;°C</span>
          <Link
            href="/wasser"
            className="ml-2 text-[15px] text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            {lake.name} ›
          </Link>
        </div>
      </div>
      <p className="mt-2 text-[12px] text-muted">
        {t("asOf", { date: dateLabel })} · {t("source")}: {sourceLabel}
      </p>
    </section>
  );
}
