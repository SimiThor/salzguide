import { Link } from "@/i18n/navigation";
import { getToursAdmin } from "@/lib/tours";
import AdminNav from "@/components/admin/AdminNav";
import ProBadge from "@/components/ProBadge";

export const dynamic = "force-dynamic";

export default async function AdminToursPage() {
  const tours = await getToursAdmin();

  return (
    <div className="space-y-4 pb-12">
      <AdminNav active="tours" />

      {/* Neues Pool-Modell: Gebiete + dedizierte Audio-Punkte (Basis für kuratierte & KI-Touren). */}
      <Link
        href="/admin/tours/gebiete"
        className="flex items-center justify-between gap-3 rounded-[16px] bg-ink px-5 py-4 text-white active:scale-[0.99]"
      >
        <span>
          <span className="block text-[15px] font-semibold">Gebiete &amp; Punkte (Pool)</span>
          <span className="block text-[12px] text-white/70">
            Dedizierte Audio-Punkte je Gebiet verwalten – Basis für kuratierte &amp; KI-Touren
          </span>
        </span>
        <span className="text-[18px]" aria-hidden>
          ›
        </span>
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">Kuratierte Touren</h1>
        <Link
          href="/admin/tours/new"
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white active:scale-[0.98]"
        >
          + Neue Tour
        </Link>
      </div>

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
            Noch keine Audio-Touren — leg die erste an.
          </p>
        )}
      </div>
    </div>
  );
}
