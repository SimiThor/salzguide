import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import ToniAvatarSettings from "@/components/admin/ToniAvatarSettings";
import CategoryManager from "@/components/admin/CategoryManager";
import LocalManager from "@/components/admin/LocalManager";
import { getToniAvatarUrl } from "@/lib/settings";
import { getCategoriesAdmin, getLocalsFull, getHomeStatus } from "@/lib/admin";
import type { TranslationState } from "@/lib/spot-hash";
import { STATUS_NEUTRAL } from "@/lib/ui";

// Admin-Einstellungen. Zugriff ist über das Admin-Layout (Rollen-Guard) geschützt.
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [toniAvatar, categories, locals, home] = await Promise.all([
    getToniAvatarUrl(),
    getCategoriesAdmin(),
    getLocalsFull(),
    getHomeStatus(),
  ]);

  return (
    <div className="space-y-4 pb-12">
      <div>
        <h1 className="text-2xl font-bold text-ink">Einstellungen</h1>
        <p className="mt-1 text-[13px] text-muted">Allgemeine Einstellungen der Plattform.</p>
      </div>

      {/* Die Startseite hat eine eigene Seite: 40 Textfelder, vier Medien-Slots und die
          Spot-Auswahl. Stünden sie hier, wären Toni, Locals und Kategorien darunter ausser
          Sichtweite gescrollt.
          Der Status steht MIT hier: „Übersetzungen veraltet" nützt nichts, wenn man es erst
          sieht, nachdem man hineingeklickt hat. */}
      <Link
        href="/admin/settings/home"
        className="flex items-center gap-4 rounded-[18px] bg-white p-5 shadow-sm ring-1 ring-black/5 transition hover:ring-black/15 active:scale-[0.995]"
      >
        <span className="text-[22px]" aria-hidden>
          🏠
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[17px] font-bold text-ink">Startseite</span>
            <HomeBadge state={home.state} />
          </span>
          <span className="mt-1 block text-[13px] leading-relaxed text-muted">
            Texte, Bilder und die Spots auf salzguide.com.
          </span>
        </span>
        <span className="shrink-0 text-[18px] text-muted" aria-hidden>
          ›
        </span>
      </Link>

      {/* Analytics ist keine Einstellung, und das weiss ich. Es steht trotzdem hier, weil
          „Einstellungen" faktisch der Ort für alles ist, was man selten anfasst — und ein
          eigener Reiter kostet bei jedem Blick Aufmerksamkeit für etwas, das man ein paar
          Mal im Jahr anschaut. Wer es sucht, findet es hier; wer es nicht sucht, wird nicht
          davon abgelenkt. Anton hat das so entschieden, den Einwand kannte er. */}
      <Link
        href="/admin/settings/analytics"
        className="flex items-center gap-4 rounded-[18px] bg-white p-5 shadow-sm ring-1 ring-black/5 transition hover:ring-black/15 active:scale-[0.995]"
      >
        <span className="text-[22px]" aria-hidden>
          📈
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-[17px] font-bold text-ink">Analytics</span>
          <span className="mt-1 block text-[13px] leading-relaxed text-muted">
            Besucher, Spots, Kampagnen und die KI-Auswertung.
          </span>
        </span>
        <span className="shrink-0 text-[18px] text-muted" aria-hidden>
          ›
        </span>
      </Link>

      <ToniAvatarSettings current={toniAvatar} />
      <LocalManager locals={locals} />
      <CategoryManager categories={categories} />
    </div>
  );
}

function HomeBadge({ state }: { state: TranslationState }) {
  if (state === "stale")
    return (
      <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent">
        Übersetzungen veraltet
      </span>
    );
  if (state === "partial")
    return (
      <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent">
        Sprachen fehlen
      </span>
    );
  if (state === "none")
    return (
      <span className={STATUS_NEUTRAL}>
        Nur Deutsch
      </span>
    );
  return (
    <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
      Alle Sprachen aktuell
    </span>
  );
}
