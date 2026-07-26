import { useTranslations } from "next-intl";
import { SOCIAL_PROFILES, EXTERNAL_LINK_ATTRS, type SocialKey } from "@/lib/social";
import { Instagram, TikTok } from "./icons";

// Die Icon-Reihe zu unseren Profilen. EIN Bauteil für alle Stellen (Fusszeile,
// iPhone-Burger, PC-„Mehr"-Menü, Profil-Seite), gefüttert aus lib/social.ts.
//
// Bewusst OHNE "use client": Die Komponente hat keinen Zustand und kein Ereignis, es sind
// zwei <a>. So kann sie eine Server-Komponente sein, wo sie in einer Server-Komponente
// steckt (Profil-Seite: kein Gramm JavaScript), und wird Teil des Client-Bündels, wo eine
// Client-Komponente sie einbindet (Fusszeile, Menüs). next-intls useTranslations kann
// beides.
//
// Kein <Link> aus @/i18n/navigation: Das ist für UNSERE Seiten mit Sprach-Präfix. Ein
// fremdes Profil bekommt kein /de davor.

const GLYPHS: Record<SocialKey, (p: { className?: string }) => React.ReactElement> = {
  instagram: Instagram,
  tiktok: TikTok,
};

export default function SocialLinks({
  className = "",
  iconClassName = "h-[22px] w-[22px]",
  tone = "muted",
  dense = false,
}: {
  /** Umgebung: Ausrichtung und Abstand kommen von aussen, das Bauteil bringt keine mit. */
  className?: string;
  iconClassName?: string;
  /** „muted" = zweite Reihe (Fusszeile, Menüs). „ink" = gleichwertig (Profil-Seite). */
  tone?: "muted" | "ink";
  /**
   * Kleinere Fläche für reine Maus-Umgebungen (PC-„Mehr"-Menü). Dieselbe Begründung, die
   * dort schon für die kompakte Rechtslink-Zeile steht: Am PC trifft der Zeiger aufs Pixel,
   * Apples 44pt sind eine FINGER-Regel. Am Handy niemals setzen.
   */
  dense?: boolean;
}) {
  const t = useTranslations("Social");

  return (
    <div className={`flex items-center ${className}`}>
      {SOCIAL_PROFILES.map((p) => {
        const Glyph = GLYPHS[p.key];
        return (
          <a
            key={p.key}
            href={p.url}
            {...EXTERNAL_LINK_ATTRS}
            // aria-label statt sichtbarem Text: Das Glyph allein ist für Screenreader
            // stumm (aria-hidden im Icon). „SalzGuide auf Instagram" sagt Ziel UND Zweck.
            aria-label={t("profileAria", { platform: p.label })}
            // sg-hit: 44x44 Trefferfläche (Apples Mindestmass) um ein 22px-Glyph, ohne dass
            // die Reihe optisch auseinanderfällt. Siehe globals.css.
            className={`flex items-center justify-center rounded-full transition-colors active:bg-black/5 ${
              dense ? "h-8 w-8" : "sg-hit h-11 w-11"
            } ${tone === "ink" ? "text-ink hover:text-accent" : "text-muted hover:text-ink"}`}
          >
            <Glyph className={iconClassName} />
          </a>
        );
      })}
    </div>
  );
}
