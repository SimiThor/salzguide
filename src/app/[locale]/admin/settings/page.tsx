import { setRequestLocale } from "next-intl/server";
import AdminNavCard from "@/components/admin/AdminNavCard";
import ToniAvatarSettings from "@/components/admin/ToniAvatarSettings";
import CategoryManager from "@/components/admin/CategoryManager";
import LocalManager from "@/components/admin/LocalManager";
import SocialSettings from "@/components/admin/SocialSettings";
import { getToniAvatarUrl } from "@/lib/settings";
import { getSocialPostsAdmin } from "@/lib/social-feed";
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
  const [toniAvatar, categories, locals, home, socialPosts] = await Promise.all([
    getToniAvatarUrl(),
    getCategoriesAdmin(),
    getLocalsFull(),
    getHomeStatus(),
    getSocialPostsAdmin(),
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
      <AdminNavCard
        href="/admin/settings/home"
        emoji="🏠"
        title="Startseite"
        badge={<HomeBadge state={home.state} />}
        description="Texte, Bilder und die Spots auf salzguide.com."
      />

      {/* Analytics ist keine Einstellung, und das weiss ich. Es steht trotzdem hier, weil
          „Einstellungen" faktisch der Ort für alles ist, was man selten anfasst — und ein
          eigener Reiter kostet bei jedem Blick Aufmerksamkeit für etwas, das man ein paar
          Mal im Jahr anschaut. Wer es sucht, findet es hier; wer es nicht sucht, wird nicht
          davon abgelenkt. Anton hat das so entschieden, den Einwand kannte er. */}
      <AdminNavCard
        href="/admin/settings/analytics"
        emoji="📈"
        title="Analytics"
        description="Besucher, Spots, Kampagnen und die KI-Auswertung."
      />

      {/* Das Logbuch. Steht bewusst WEIT OBEN, direkt nach Startseite und Analytics: Wer
          eine Alarm-Mail bekommen hat, klickt zwar den Link darin — aber wer ohne Anlass
          nachsehen will, ob alles läuft, soll nicht scrollen müssen. Es ist die einzige
          Kachel hier, die eine Frage beantwortet statt eine Einstellung anzubieten. */}
      <AdminNavCard
        href="/admin/settings/system"
        emoji="🩺"
        title="System"
        description="Fehler, Missbrauchsversuche und die Hintergrund-Läufe."
      />

      {/* Vorschau aller Mails, in allen dreizehn Sprachen. Steht hier und nicht unter Nutzer,
          weil man sie nicht bei einer bestimmten Person braucht, sondern beim Nachschauen,
          was eigentlich rausgeht. Verschickt nichts. */}
      <AdminNavCard
        href="/admin/settings/mails"
        emoji="✉️"
        title="Mails"
        description="Anmeldelink, Kaufbestätigung und der Rest, in jeder Sprache zum Anschauen."
      />

      {/* Download-Center für die Clean-Intro-Videos (ohne Text-Overlay), für die eigene
          Werbevideo-Produktion. Bewusst versteckt in den Einstellungen: selten gebraucht. */}
      <AdminNavCard
        href="/admin/settings/intro-videos"
        emoji="🎬"
        title="Intro-Videos"
        description="Die Wander-Animationen ohne Text-Overlay herunterladen (für eigene Videos)."
      />

      {/* Instagram-Kacheln: Bild hochladen, Link einfügen, fertig. Bewusst ohne Meta-App und
          ohne Token — die Einrichtung dort war der Grund, den automatischen Abgleich wieder
          auszubauen (siehe Migration 0052). */}
      <SocialSettings posts={socialPosts} />

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
