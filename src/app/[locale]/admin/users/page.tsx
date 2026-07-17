import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  getAdminUsers,
  getLatestProGrants,
  getOpenSupportCount,
  USER_PAGE_SIZE,
} from "@/lib/admin";
import AdminUserList from "@/components/admin/AdminUserList";

// Nutzer-Verwaltung: sehen, suchen, Pro schenken.
//
// Geschützt wie jede Admin-Seite durch das Layout-Guard (getAdminUserId + redirect). Die
// Aktion dahinter prüft NOCHMAL (requireAdmin), denn Server-Actions sind eigene Endpunkte
// und das Layout schützt sie nicht.
//
// force-dynamic: Eine Nutzerliste darf nie aus dem Cache kommen. Ein zwischengespeicherter
// Pro-Status wäre hier nicht nur veraltet, sondern eine falsche Auskunft über einen Menschen.
export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { q, page } = await searchParams;
  // Number("abc") ist NaN, Number("") ist 0 — beides fängt getAdminUsers ab und macht 1
  // daraus. Eine erfundene Seitenzahl in der URL soll keine leere Liste erzeugen.
  const { users, total, page: current, pages } = await getAdminUsers(q, Number(page) || 1);
  // Erst danach: die Protokollzeilen brauchen die IDs der Nutzer, die wirklich angezeigt
  // werden. Eine Abfrage für die ganze Liste, nicht eine pro Zeile.
  const grants = await getLatestProGrants(users.map((u) => u.id));
  const openSupport = await getOpenSupportCount();

  const proCount = users.filter((u) => u.isPro).length;
  const paidCount = users.filter((u) => u.paidPro).length;

  // Die Suche MUSS beim Blättern mitwandern, sonst springt man auf Seite 2 und die Liste
  // zeigt plötzlich alle — man hat dann gefiltert und merkt nicht, dass es weg ist.
  const pageHref = (p: number) =>
    `/${locale}/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <div className="space-y-4 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">Admin · Nutzer</h1>
        <span className="text-sm text-muted">
          {total} {q ? "Treffer" : "Nutzer"} · {proCount} mit Pro auf dieser Seite ({paidCount}{" "}
          bezahlt)
        </span>
      </div>

      <form className="flex gap-2" action={`/${locale}/admin/users`}>
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="E-Mail suchen …"
          className="w-full max-w-[320px] rounded-[14px] border border-black/10 bg-white px-4 py-2 text-sm text-ink outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-full bg-black/5 px-4 py-2 text-sm font-semibold text-ink active:scale-[0.98]"
        >
          Suchen
        </button>
      </form>

      {/* Support gehört hierher: Es sind die Nachrichten von genau diesen Menschen. Als
          eigener Reiter stand es oben und kostete bei jedem Blick Aufmerksamkeit — jetzt
          sagt der Zähler in der Navigation Bescheid, wenn jemand wartet, und man muss
          nicht mehr nachsehen. Gleiches Muster wie Events -> Jahres-Events. */}
      <Link
        href="/admin/users/support"
        className="flex items-center gap-4 rounded-[18px] bg-white p-5 shadow-sm ring-1 ring-black/5 transition hover:ring-black/15 active:scale-[0.995]"
      >
        <span className="text-[22px]" aria-hidden>
          ✉️
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[17px] font-bold text-ink">Support-Anfragen</span>
            {openSupport > 0 ? (
              <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-white">
                {openSupport} offen
              </span>
            ) : (
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-muted">
                nichts offen
              </span>
            )}
          </span>
          <span className="mt-1 block text-[13px] leading-relaxed text-muted">
            Nachrichten aus dem Formular auf /support.
          </span>
        </span>
        <span className="shrink-0 text-[18px] text-muted" aria-hidden>
          ›
        </span>
      </Link>

      {/* Map -> Array: Eine Map überlebt die Server/Client-Grenze nicht. */}
      <AdminUserList users={users} grants={Object.fromEntries(grants)} />

      {pages > 1 && (
        <nav className="flex items-center justify-between gap-2">
          {/* Kein Link statt eines toten Links: Ein ausgegrauter Knopf am Rand lädt zum
              Klicken ein und tut dann nichts. */}
          {current > 1 ? (
            <a
              href={pageHref(current - 1)}
              className="rounded-full bg-black/5 px-4 py-2 text-sm font-semibold text-ink active:scale-[0.98]"
            >
              ← Zurück
            </a>
          ) : (
            <span />
          )}
          <span className="text-[13px] text-muted">
            Seite {current} von {pages}
          </span>
          {current < pages ? (
            <a
              href={pageHref(current + 1)}
              className="rounded-full bg-black/5 px-4 py-2 text-sm font-semibold text-ink active:scale-[0.98]"
            >
              Weiter →
            </a>
          ) : (
            <span />
          )}
        </nav>
      )}

      <p className="px-1 text-xs leading-relaxed text-muted">
        {USER_PAGE_SIZE} pro Seite, neueste zuerst. Bezahltes Pro lässt sich hier bewusst
        nicht ändern: Eine Rückerstattung gehört in Stripe, dann entzieht der Webhook das Pro
        von selbst. Die Rolle (Admin) ändert man weiterhin nur direkt in der Datenbank.
      </p>
    </div>
  );
}
