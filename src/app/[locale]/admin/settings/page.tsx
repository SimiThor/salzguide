import { setRequestLocale } from "next-intl/server";
import AdminNav from "@/components/admin/AdminNav";
import ToniAvatarSettings from "@/components/admin/ToniAvatarSettings";
import CategoryManager from "@/components/admin/CategoryManager";
import LocalManager from "@/components/admin/LocalManager";
import HomeFeaturedManager from "@/components/admin/HomeFeaturedManager";
import HomeContentManager from "@/components/admin/HomeContentManager";
import { getToniAvatarUrl } from "@/lib/settings";
import {
  getCategoriesAdmin,
  getLocalsFull,
  getHomeFeaturedAdmin,
  getHomeContentAdmin,
} from "@/lib/admin";

// Admin-Einstellungen. Zugriff ist über das Admin-Layout (Rollen-Guard) geschützt.
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [toniAvatar, categories, locals, homeSpots, homeContent] = await Promise.all([
    getToniAvatarUrl(),
    getCategoriesAdmin(),
    getLocalsFull(),
    getHomeFeaturedAdmin(),
    getHomeContentAdmin(),
  ]);

  return (
    <div className="space-y-4 pb-12">
      <AdminNav active="settings" />
      <div>
        <h1 className="text-2xl font-bold text-ink">Einstellungen</h1>
        <p className="mt-1 text-[13px] text-muted">Allgemeine Einstellungen der Plattform.</p>
      </div>
      <HomeContentManager {...homeContent} />
      <HomeFeaturedManager {...homeSpots} />
      <ToniAvatarSettings current={toniAvatar} />
      <LocalManager locals={locals} />
      <CategoryManager categories={categories} />
    </div>
  );
}
