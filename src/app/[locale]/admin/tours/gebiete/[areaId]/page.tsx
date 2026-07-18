import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getAreaForEdit, getAreaPoints } from "@/lib/tour-pool";
import AreaForm from "@/components/admin/AreaForm";
import BackButton from "@/components/BackButton";
import { STATUS_NEUTRAL } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function EditAreaPage({
  params,
}: {
  params: Promise<{ areaId: string }>;
}) {
  const { areaId } = await params;
  const [area, points] = await Promise.all([getAreaForEdit(areaId), getAreaPoints(areaId)]);
  if (!area) notFound();

  return (
    <div className="space-y-4 pb-12">
      <BackButton fallbackHref="/admin/tours/gebiete" />
      <h1 className="text-2xl font-bold text-ink">Gebiet bearbeiten</h1>
      <AreaForm initial={area} />

      <section className="space-y-3 rounded-[16px] bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-ink">Punkte-Pool ({points.length})</h2>
          <Link
            href={`/admin/tours/gebiete/${areaId}/punkt/neu`}
            className="shrink-0 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white active:scale-[0.98]"
          >
            + Neuer Punkt
          </Link>
        </div>
        <div className="divide-y divide-black/5 overflow-hidden rounded-[12px] border border-black/[0.06]">
          {points.map((p) => (
            <Link
              key={p.id}
              href={`/admin/tours/gebiete/${areaId}/punkt/${p.id}`}
              className="flex items-center justify-between gap-3 px-3.5 py-2.5 active:bg-black/5"
            >
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium text-ink">{p.title}</span>
                <span className="text-[11px] text-muted">
                  {p.tags.length ? p.tags.join(", ") : "keine Tags"}
                  {p.lat == null || p.lng == null ? " · ⚠︎ keine Position" : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {p.hasAudio && (
                  <span className={STATUS_NEUTRAL}>
                    🎧
                  </span>
                )}
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    p.trComplete
                      ? "bg-green-600/10 text-green-700"
                      : "bg-amber-500/10 text-amber-700"
                  }`}
                  title={`${p.trPresent}/${p.trTotal} Sprachen fertig (Titel + Audio)`}
                >
                  {p.trComplete ? "🌍 ✓" : `🌍 ${p.trPresent}/${p.trTotal}`}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    p.status === "published"
                      ? "bg-green-600/10 text-green-700"
                      : "bg-black/5 text-muted"
                  }`}
                >
                  {p.status === "published" ? "live" : "Entwurf"}
                </span>
              </span>
            </Link>
          ))}
          {points.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted">
              Noch keine Punkte — leg mehr Punkte an, als eine Tour braucht.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
