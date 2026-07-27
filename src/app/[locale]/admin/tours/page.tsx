import { Link } from "@/i18n/navigation";
import { getToursAdmin } from "@/lib/tours";
import { getAreasAdmin } from "@/lib/tour-pool";
import AdminNavCard from "@/components/admin/AdminNavCard";
import ProBadge from "@/components/ProBadge";
import { STATUS_NEUTRAL } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function AdminToursPage() {
  const [tours, areas] = await Promise.all([getToursAdmin(), getAreasAdmin()]);
  const points = areas.reduce((n, a) => n + a.pointCount, 0);

  return (
    <div className="space-y-4 pb-12">
      {/* Überschrift zuerst, wie auf Spots, Events, Nutzer und Einstellungen. Hier fing die
          Seite als einzige mit einer Kachel an und trug ihre Überschrift eine Stufe kleiner
          mittendrin. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">Admin · Audio-Touren</h1>
        <Link
          href="/admin/tours/new"
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white active:scale-[0.98]"
        >
          + Neue Tour
        </Link>
      </div>

      {/* Neues Pool-Modell: Gebiete + dedizierte Audio-Punkte (Basis für kuratierte & KI-Touren).
          Dieselbe Kachel wie Einstellungen -> Startseite oder Events -> Jahres-Events. Sie war
          hier als Einzelstück gebaut (dunkel, ohne Emoji, kleinere Schrift) und damit das
          einzige Ding im Admin, das aussah, als gehörte es woanders hin.

          Die Zahlen stehen MIT drauf: Ob der Pool überhaupt schon gefüllt ist, ist die Frage,
          die man von aussen stellt. Der Zähler kostet eine Abfrage, die die Seite ohnehin
          dynamisch macht. */}
      <AdminNavCard
        href="/admin/tours/gebiete"
        emoji="🗺️"
        title="Gebiete & Punkte (Pool)"
        badge={
          <span className={STATUS_NEUTRAL}>
            {areas.length === 0
              ? "noch nichts angelegt"
              : `${areas.length} ${areas.length === 1 ? "Gebiet" : "Gebiete"} · ${points} ${points === 1 ? "Punkt" : "Punkte"}`}
          </span>
        }
        description="Dedizierte Audio-Punkte je Gebiet. Die Basis für kuratierte und KI-Touren."
      />

      <h2 className="text-xl font-bold text-ink">Kuratierte Touren</h2>

      <div className="divide-y divide-black/5 overflow-hidden rounded-[16px] bg-white shadow-sm">
        {tours.map((t) => (
          <Link
            key={t.id}
            href={`/admin/tours/${t.id}`}
            className="flex items-center justify-between gap-3 px-4 py-3 active:bg-black/5"
          >
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-medium text-ink">{t.title}</span>
              <span className="text-xs text-muted">
                {t.region} · {t.stopCount} Stopps
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {t.isPro && <ProBadge />}
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  t.status === "published"
                    ? "bg-green-600/10 text-green-700"
                    : "bg-black/5 text-muted"
                }`}
              >
                {t.status === "published" ? "live" : "Entwurf"}
              </span>
            </span>
          </Link>
        ))}
        {tours.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">
            Noch keine Audio-Touren. Leg die erste an.
          </p>
        )}
      </div>
    </div>
  );
}
