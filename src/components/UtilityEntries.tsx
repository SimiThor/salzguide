import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { UtilitySummary } from "@/lib/utility-summary-types";

// Zwei kleine Einstiegs-Karten über den Regalen von "Alle" (Pendant zur iOS-App):
// Events und Wassertemperaturen. Jede erscheint nur, wenn es Daten dafür gibt; ohne
// beide fehlt die ganze Zeile. Die Daten kommen gecacht vom Server (lib/utility-summary.ts),
// also kein Nachladen und kein Verspringen.
function Entry({
  href,
  emoji,
  title,
  detail,
}: {
  href: "/events" | "/wasser";
  emoji: string;
  title: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="sg-hit sg-native-tap flex min-h-[92px] min-w-0 flex-1 cursor-pointer flex-col items-start gap-1 rounded-card bg-white p-3.5 text-left shadow-sm transition-transform active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      <span aria-hidden="true" className="text-2xl leading-none">
        {emoji}
      </span>
      <span className="line-clamp-2 text-[15px] font-semibold leading-tight text-ink">{title}</span>
      <span className="line-clamp-2 text-[13px] leading-snug text-muted">{detail}</span>
    </Link>
  );
}

export default function UtilityEntries({ summary }: { summary: UtilitySummary }) {
  const tEvents = useTranslations("Events");
  const tWater = useTranslations("Water");
  const locale = useLocale();
  const { hasEvents, water } = summary;
  if (!hasEvents && !water) return null;

  let range = "";
  if (water) {
    const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    range =
      water.min === water.max
        ? `${n.format(water.min)} °C`
        : `${n.format(water.min)}–${n.format(water.max)} °C`;
  }

  return (
    <div className="flex items-stretch gap-3 px-4">
      {hasEvents && (
        <Entry href="/events" emoji="🎉" title={tEvents("title")} detail={tEvents("subtitle")} />
      )}
      {water && <Entry href="/wasser" emoji="💧" title={tWater("title")} detail={range} />}
    </div>
  );
}
