import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getProMigrations } from "@/lib/admin";
import ProMigrationManager from "@/components/admin/ProMigrationManager";

// Freischaltung der Käufer von der alten WordPress-Plattform.
//
// Liegt unter Nutzer, weil es genau darum geht: Menschen, die schon bezahlt haben und
// wiederkommen sollen. Es ist eine Umzugs-Sache — man braucht sie einmal, deshalb ein
// Unterpunkt und kein Reiter.
export const dynamic = "force-dynamic";

export default async function ProMigrationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const list = await getProMigrations();

  return (
    <div className="space-y-4 pb-12">
      <div>
        <Link
          href="/admin/users"
          className="text-[13px] font-semibold text-muted transition hover:text-ink"
        >
          ← Nutzer
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-ink">Alt-Käufer freischalten</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          E-Mail-Adressen der Käufer von salzguide.com (WordPress). Wer sich mit einer davon
          anmeldet, bekommt Pro automatisch im selben Moment — per Magic-Link genauso wie per
          Google. Es werden bewusst <strong>keine Konten vorab angelegt</strong>: Deine Käufer
          haben den AGB der alten Seite zugestimmt, nicht der neuen, und das holen sie mit
          ihrer Anmeldung selbst nach.
        </p>
      </div>

      <ProMigrationManager list={list} />
    </div>
  );
}
