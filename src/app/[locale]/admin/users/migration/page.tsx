import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getProMigrations } from "@/lib/admin";
import { getRelaunchNotice } from "@/lib/settings";
import { getRelaunchMailTexts } from "@/lib/relaunch-mail";
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
  const [list, noticeOn, mailTexts] = await Promise.all([
    getProMigrations(),
    getRelaunchNotice(),
    getRelaunchMailTexts(),
  ]);

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
        {/* Kurz halten. Die Begründungen (warum keine Konten vorab, warum der Hinweis für
            alle gilt) stehen bei den Funktionen, die sie umsetzen — hier kosten sie nur den
            Blick auf die Knöpfe. */}
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Wer sich mit einer Adresse von dieser Liste anmeldet, bekommt Pro im selben Moment.
          Per Magic-Link wie per Google, ohne Konten vorab anzulegen.
        </p>
      </div>

      <ProMigrationManager list={list} noticeOn={noticeOn} mailTexts={mailTexts} />
    </div>
  );
}
