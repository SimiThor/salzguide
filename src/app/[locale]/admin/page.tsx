import { Link } from "@/i18n/navigation";
import { getAdminSpots } from "@/lib/admin";
import BulkTranslateButton from "@/components/admin/BulkTranslateButton";
import ProBadge from "@/components/ProBadge";

export default async function AdminPage() {
  const spots = await getAdminSpots();
  // Noch nicht vollständig übersetzte Spots (für den Sammel-Übersetzen-Button oben).
  const incomplete = spots
    .filter((s) => s.trState !== "complete")
    .map((s) => ({ id: s.id, label: s.title }));

  return (
    <div className="space-y-4 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">Admin · Spots</h1>
        <div className="flex flex-wrap items-center gap-2">
          <BulkTranslateButton kind="spot" items={incomplete} noun="Spots" />
          <Link
            href="/admin/spots/new"
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white active:scale-[0.98]"
          >
            + Neuer Spot
          </Link>
        </div>
      </div>

      <div className="divide-y divide-black/5 overflow-hidden rounded-[16px] bg-white shadow-sm">
        {spots.map((s) => (
          <Link
            key={s.id}
            href={`/admin/spots/${s.id}`}
            className="flex items-center justify-between gap-3 px-4 py-3 active:bg-black/5"
          >
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-medium text-ink">
                {s.title}
              </span>
              <span className="text-xs text-muted">
                {s.type} · {s.slug}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {s.is_pro && <ProBadge />}
              {/* Übersetzungs-Status: grün=alle aktuell, rot=veraltet, gelb=teilweise/keine */}
              <span
                title={`${s.trPresent}/${s.trTotal} Sprachen übersetzt`}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  s.trState === "complete"
                    ? "bg-green-600/10 text-green-700"
                    : s.trState === "stale"
                      ? "bg-accent/10 text-accent"
                      : "bg-amber-500/10 text-amber-700"
                }`}
              >
                {s.trState === "complete"
                  ? "🌍 ✓"
                  : s.trState === "stale"
                    ? "🌍 ⚠ veraltet"
                    : `🌍 ${s.trPresent}/${s.trTotal}`}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  s.status === "published"
                    ? "bg-green-600/10 text-green-700"
                    : "bg-black/5 text-muted"
                }`}
              >
                {s.status === "published" ? "live" : "Entwurf"}
              </span>
            </span>
          </Link>
        ))}
        {spots.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">
            Noch keine Spots — leg den ersten an.
          </p>
        )}
      </div>
    </div>
  );
}
