import { setRequestLocale } from "next-intl/server";
import AdminNav from "@/components/admin/AdminNav";
import ToniAvatarSettings from "@/components/admin/ToniAvatarSettings";
import CategoryManager from "@/components/admin/CategoryManager";
import LocalManager from "@/components/admin/LocalManager";
import { getToniAvatarUrl } from "@/lib/settings";
import { getCategoriesAdmin, getLocalsFull } from "@/lib/admin";

// Admin-Einstellungen. Zugriff ist über das Admin-Layout (Rollen-Guard) geschützt.
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [toniAvatar, categories, locals] = await Promise.all([
    getToniAvatarUrl(),
    getCategoriesAdmin(),
    getLocalsFull(),
  ]);

  return (
    <div className="space-y-4 pb-12">
      <AdminNav active="settings" />
      <div>
        <h1 className="text-2xl font-bold text-ink">Einstellungen</h1>
        <p className="mt-1 text-[13px] text-muted">Allgemeine Einstellungen der Plattform.</p>
      </div>
      <ToniAvatarSettings current={toniAvatar} />
      <LocalManager locals={locals} />
      <CategoryManager categories={categories} />
    </div>
  );
}
