import { setRequestLocale } from "next-intl/server";
import BackButton from "@/components/BackButton";
import { getIntroRenderList } from "@/lib/admin";
import IntroRenderManager from "@/components/admin/IntroRenderManager";
import IntroCleanExportList from "@/components/admin/IntroCleanExportList";

// Intro-Videos (nur Admin): oben rendern, unten die Clean-Fassung (ohne Text-Overlay,
// fürs Schneiden eigener Werbevideos) AUF ABRUF exportieren. Clean-Dateien liegen seit
// 10.08.2026 nicht mehr im Storage (waren mit 551 MB der grösste Posten); der Export
// rendert frisch und hängt das MP4 als GitHub-Artefakt an den Lauf (5 Tage, dann weg).
export const dynamic = "force-dynamic";

export default async function IntroVideosPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const renderList = await getIntroRenderList();
  const githubConfigured = !!process.env.GITHUB_ACTIONS_TOKEN && !!process.env.GITHUB_REPO;
  // Übersicht der Export-Läufe auf GitHub: Dort liegt der fertige Download (Artefakt).
  const runsUrl = process.env.GITHUB_REPO
    ? `https://github.com/${process.env.GITHUB_REPO}/actions/workflows/export-intro-clean.yml`
    : null;

  return (
    <div className="space-y-4 pb-12">
      <BackButton fallbackHref="/admin/settings" label="Einstellungen" />
      <div>
        <h1 className="text-2xl font-bold text-ink">Intro-Videos</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Oben erzeugst du die Intros per Button. Unten forderst du die Clean-Fassung ohne
          Text-Overlay an: Sie wird frisch gerendert und liegt danach 5 Tage als Download
          beim GitHub-Lauf, gespeichert wird sie nicht.
        </p>
      </div>

      <IntroRenderManager initial={renderList} configured={githubConfigured} />

      <h2 className="pt-2 text-[15px] font-bold text-ink">Clean-Export (ohne Text)</h2>

      <IntroCleanExportList
        items={renderList
          .filter((v) => v.hasVideo)
          .map((v) => ({ slug: v.slug, title: v.title }))}
        runsUrl={runsUrl}
        configured={githubConfigured}
      />
    </div>
  );
}
