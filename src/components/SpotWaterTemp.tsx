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
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3.5c3.2 4.3 5.8 7 5.8 10.2a5.8 5.8 0 0 1-11.6 0C6.2 10.5 8.8 7.8 12 3.5Z" />
            <path d="M9 14.2c.8.9 2 1 3 .4" />
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
