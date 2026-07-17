import { setRequestLocale } from "next-intl/server";
import { getAdminUsers, getLatestProGrants } from "@/lib/admin";
import AdminNav from "@/components/admin/AdminNav";
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
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { q } = await searchParams;
  const users = await getAdminUsers(q);
  // Erst danach: die Protokollzeilen brauchen die IDs der Nutzer, die wirklich angezeigt
  // werden. Eine Abfrage für die ganze Liste, nicht eine pro Zeile.
  const grants = await getLatestProGrants(users.map((u) => u.id));

  const proCount = users.filter((u) => u.isPro).length;
  const paidCount = users.filter((u) => u.paidPro).length;

  return (
    <div className="space-y-4 pb-12">
      <AdminNav active="users" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">Admin · Nutzer</h1>
        <span className="text-sm text-muted">
          {users.length} angezeigt · {proCount} mit Pro ({paidCount} bezahlt)
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

      {/* Map -> Array: Eine Map überlebt die Server/Client-Grenze nicht. */}
      <AdminUserList users={users} grants={Object.fromEntries(grants)} />

      <p className="px-1 text-xs leading-relaxed text-muted">
        Es werden höchstens 50 Nutzer gezeigt, neueste zuerst — such nach der E-Mail, wenn
        jemand fehlt. Bezahltes Pro lässt sich hier bewusst nicht ändern: Eine Rückerstattung
        gehört in Stripe, dann entzieht der Webhook das Pro von selbst. Die Rolle (Admin)
        ändert man weiterhin nur direkt in der Datenbank.
      </p>
    </div>
  );
}
