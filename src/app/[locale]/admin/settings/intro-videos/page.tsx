import { setRequestLocale } from "next-intl/server";
import BackButton from "@/components/BackButton";
import { getIntroVideos, getIntroRenderList } from "@/lib/admin";
import IntroRenderManager from "@/components/admin/IntroRenderManager";
import IntroVideoPreview from "@/components/admin/IntroVideoPreview";
import { slugify } from "@/lib/slug";

// Download-Center (nur Admin): die "clean"-Variante der Intro-Videos ohne Text-Overlay
// (kein Titel, keine Werte, kein Logo – nur Karte, Route und die Attribution unten), fürs
// Schneiden eigener Werbevideos. Die normale Variante mit Overlay läuft weiter auf den
// Spot-Seiten für die User; hier liegt bewusst nur die saubere Fassung zum Herunterladen.
export const dynamic = "force-dynamic";

export default async function IntroVideosPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [videos, renderList] = await Promise.all([getIntroVideos(), getIntroRenderList()]);
  const githubConfigured = !!process.env.GITHUB_ACTIONS_TOKEN && !!process.env.GITHUB_REPO;

  return (
    <div className="space-y-4 pb-12">
      <BackButton fallbackHref="/admin/settings" label="Einstellungen" />
      <div>
        <h1 className="text-2xl font-bold text-ink">Intro-Videos</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Oben erzeugst du die Intros per Button. Unten liegt die saubere Variante ohne
          Text-Overlay (nur Karte, Route und Attribution) zum Download für die eigene
          Videoproduktion; die normale Fassung mit Overlay läuft weiter auf den Spot-Seiten.
        </p>
      </div>

      <IntroRenderManager initial={renderList} configured={githubConfigured} />

      <h2 className="pt-2 text-[15px] font-bold text-ink">Download (Clean-Fassung)</h2>

      {videos.length === 0 ? (
        <div className="rounded-[18px] bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
          <div className="text-[28px]" aria-hidden>
            🎬
          </div>
          <p className="mt-2 text-[14px] font-semibold text-ink">Noch keine Intro-Videos</p>
          <p className="mx-auto mt-1 max-w-[420px] text-[13px] leading-relaxed text-muted">
            Sobald du oben ein Intro erzeugt hast, erscheint hier die Clean-Fassung (ohne
            Text-Overlay) zum Download.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {videos.map((v) => (
            <li
              key={v.slug}
              className="flex flex-wrap items-center gap-4 rounded-[18px] bg-white p-3 pr-4 shadow-sm ring-1 ring-black/5"
            >
              {/* Klick aufs Standbild spielt die Clean-Fassung ab, also genau die Datei,
                  die der Knopf daneben herunterlädt. Anschauen vor dem Laden. */}
              <IntroVideoPreview
                src={v.cleanUrl}
                poster={v.posterUrl}
                title={v.title}
                className="h-[76px] w-[43px]"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[16px] font-bold text-ink">{v.title}</p>
                {/* Der Slug steht nur da, wenn er nicht bloss der kleingeschriebene Titel
                    ist: sonst liest man denselben Namen zweimal untereinander. */}
                <p className="truncate text-[12px] text-muted">
                  {[slugify(v.title) === v.slug ? null : v.slug, "1080×1920", "ohne Text"]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {/* Supabase erzwingt per ?download den Datei-Download (Content-Disposition),
                  auch cross-origin. Kein Client-JS nötig. */}
              <a
                href={`${v.cleanUrl}?download=salzguide-intro-${v.slug}.mp4`}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-[14px] font-semibold text-white transition active:scale-[0.97]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Laden
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
