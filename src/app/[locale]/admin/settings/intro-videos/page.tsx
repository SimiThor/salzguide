import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getIntroVideos } from "@/lib/admin";

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
  const videos = await getIntroVideos();

  return (
    <div className="space-y-4 pb-12">
      <div>
        <Link
          href="/admin/settings"
          className="text-[13px] font-medium text-muted transition hover:text-ink"
        >
          ‹ Einstellungen
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-ink">Intro-Videos</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Die saubere Variante ohne Text-Overlay (kein Titel, keine Werte, kein Logo – nur Karte,
          Route und Attribution) für die eigene Videoproduktion. Die normale Fassung mit Overlay
          läuft weiter auf den Spot-Seiten.
        </p>
      </div>

      {videos.length === 0 ? (
        <div className="rounded-[18px] bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
          <div className="text-[28px]" aria-hidden>
            🎬
          </div>
          <p className="mt-2 text-[14px] font-semibold text-ink">Noch keine Intro-Videos</p>
          <p className="mx-auto mt-1 max-w-[420px] text-[13px] leading-relaxed text-muted">
            Sobald ein Spot mit Route gerendert ist, erscheint hier die Clean-Fassung zum Download.
            Gerendert wird lokal mit{" "}
            <code className="rounded bg-black/5 px-1.5 py-0.5 text-[12px]">
              npm run render:intro -- &lt;slug&gt; --upload
            </code>
            .
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {videos.map((v) => (
            <li
              key={v.slug}
              className="flex items-center gap-4 rounded-[18px] bg-white p-3 pr-4 shadow-sm ring-1 ring-black/5"
            >
              <div className="h-[76px] w-[43px] shrink-0 overflow-hidden rounded-[10px] bg-black/5">
                {v.posterUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={v.posterUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[16px] font-bold text-ink">{v.title}</p>
                <p className="truncate text-[12px] text-muted">{v.slug} · 1080×1920 · ohne Text</p>
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
