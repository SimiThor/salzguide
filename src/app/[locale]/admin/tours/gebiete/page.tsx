import { Link } from "@/i18n/navigation";
import { getAreasAdmin } from "@/lib/tour-pool";
import BackButton from "@/components/BackButton";

export const dynamic = "force-dynamic";

export default async function AreasPage() {
  const areas = await getAreasAdmin();
  return (
    <div className="space-y-4 pb-12">
      <BackButton fallbackHref="/admin/tours" label="Audio-Touren" />
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Gebiete & Punkte</h1>
          <p className="mt-1 text-[13px] text-muted">
            Pool aus dedizierten Audio-Punkten je Gebiet (Basis für kuratierte &amp; KI-Touren).
          </p>
        </div>
        <Link
          href="/admin/tours/gebiete/new"
          className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white active:scale-[0.98]"
        >
          + Neues Gebiet
        </Link>
      </div>

      <div className="divide-y divide-black/5 overflow-hidden rounded-[16px] bg-white shadow-sm">
        {areas.map((a) => (
          <Link
            key={a.id}
            href={`/admin/tours/gebiete/${a.id}`}
            className="flex items-center justify-between gap-3 px-4 py-3 active:bg-black/5"
          >
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-medium text-ink">{a.name}</span>
              <span className="text-xs text-muted">
                {a.key} · {a.pointCount} Punkte
              </span>
            </span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                a.status === "published"
                  ? "bg-green-600/10 text-green-700"
                  : "bg-black/5 text-muted"
              }`}
            >
              {a.status === "published" ? "live" : "Entwurf"}
            </span>
          </Link>
        ))}
        {areas.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">
            Noch keine Gebiete — leg das erste an (z.B. Salzburger Altstadt).
          </p>
        )}
      </div>
    </div>
  );
}
