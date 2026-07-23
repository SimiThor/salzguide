"use client";

import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { CTA_COMPACT } from "./cta";

// Navigation NUR der Startseite (siehe lib/routes.ts): bewusst reduziert auf Logo, Sprache
// und den einen Weg nach vorn. Die App-Tab-Leiste würde neue Besucher wahllos in die App
// streuen, statt sie durch die Story zur Karte zu führen.
//
// Über dem Hero transparent (der Hero ist dunkel, Schrift weiss), ab dem ersten Scrollen
// dieselbe Glas-Leiste wie im Rest der App -> das Bild bleibt oben ungestört.
// ctaLabel als Prop statt useTranslations: Die Startseiten-Texte kommen aus der DB
// (home_content), nicht mehr aus messages/*.json. Der Server liest sie einmal und reicht
// durch, damit diese Client-Komponente keine eigene Quelle braucht.
export default function LandingNav({ ctaLabel }: { ctaLabel: string }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // 24px statt 0: sonst flackert die Leiste beim iOS-Gummiband-Scrollen am Seitenanfang.
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled
          ? "border-b border-black/5 bg-cream/80 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      {/* Eigener Rand statt LANDING_CONTAINER, und zwar mit Absicht: px-4 mobil ist exakt
          das, was der App-Header (MobileHeader) nutzt. Die Leiste soll sich wie die Leiste
          der App anfühlen, nicht wie ein Fremdkörper darüber. Ab md liegt sie auf px-6 und
          fluchtet dann mit dem Inhalt darunter. */}
      <div className="mx-auto flex h-[var(--sg-header-h)] max-w-[1200px] items-center justify-between px-4 pt-safe md:px-6">
        {/* flex h-full: Der Schriftzug ist 33px hoch, das Tap-Ziel damit unter Apples
            Mindestmass von 44px. Über die volle Leistenhöhe gezogen, trifft ihn der Daumen.
            Gleiches Muster wie MobileHeader. */}
        <Link
          href="/"
          className={`flex h-full items-center text-[22px] font-bold tracking-tight transition-colors md:text-[26px] ${
            scrolled ? "text-accent" : "text-white drop-shadow-sm"
          }`}
        >
          SalzGuide
        </Link>

        <div className="flex items-center gap-2 md:gap-3">
          {/* variant="glass": Der Sprachwähler liegt hier über dem dunklen Hero und muss
              seinen Kontrast selbst mitbringen -> weisse Glas-Pille mit Schatten (statt der
              flachen bg-black/5-Fläche, die er in den App-Headern trägt), über dem Hero wie
              über der hellen Leiste lesbar. Er wird NICHT von aussen umgefärbt: Hier stand
              `[&_button]:text-white`, solange die Leiste transparent war. Das hat den Auslöser
              gar nicht gebraucht und dafür das AUFKLAPP-MENÜ zerstört: Der Nachfahren-Selektor
              trifft jeden Button im Teilbaum, also auch die neun Sprach-Einträge im weissen
              Popover. Weiss auf Weiss, man sah nur noch Flaggen. Lehre daraus: Ein fremdes
              Bauteil von aussen einfärben heisst, jede seiner inneren Ebenen mitzufärben, die
              man gerade nicht sieht. */}
          <LanguageSwitcher variant="glass" />
          {/* Erscheint ERST beim Scrollen. Über dem Hero steht der gleiche rote CTA schon
              gross in der Bildmitte — zwei identische rote Pillen in einem Blick nehmen
              sich gegenseitig die Wirkung. Sobald der Hero-CTA rausgescrollt ist, übernimmt
              dieser hier: es ist immer genau EIN Weg nach vorn sichtbar.
              Echter Link, kein router.push: „/" verschwindet beim Umzug nicht, es ändert
              nur seine Bedeutung — es gibt also keine 301 auf /explore. Interne Links, die
              ein Crawler als solche sieht, sind der einzige Weg, wie dort Autorität ankommt. */}
          <Link
            href="/explore"
            tabIndex={scrolled ? undefined : -1}
            aria-hidden={!scrolled}
            className={`${CTA_COMPACT} duration-300 ${
              scrolled ? "opacity-100" : "pointer-events-none translate-y-1 opacity-0"
            }`}
          >
            {ctaLabel}
          </Link>
        </div>
      </div>
    </header>
  );
}
