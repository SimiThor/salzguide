import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { localeDir } from "@/i18n/locales";
import AppChrome from "@/components/AppChrome";
import AiProvider from "@/components/ai/AiProvider";
import LoginGateProvider from "@/components/auth/LoginGate";
import ProGateProvider from "@/components/ProGate";
import { APPLE_SPLASH_LINKS } from "@/lib/apple-splash";
import { siteUrl } from "@/lib/site-url";
import "../globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: "SalzGuide", template: "%s · SalzGuide" },
    description: t("description"),
    // „Zum Home-Bildschirm" auf iOS. Ohne diesen Block landet dort ein Safari-Lesezeichen
    // mit Adressleiste; mit ihm startet die Seite ohne Browser-Rahmen wie eine App.
    //   title      — was unter dem Symbol steht (sonst nähme iOS den <title> der Seite,
    //                also je nach Unterseite etwas anderes)
    //   statusBarStyle „default" — undurchsichtige Systemleiste mit dunkler Schrift. Die
    //                Alternative black-translucent schöbe den Inhalt unter die Uhr UND
    //                machte deren Schrift weiss: unsichtbar auf unserem Creme.
    // Symbole selbst kommen aus den Dateien daneben (app/icon.svg, app/apple-icon.png,
    // app/favicon.ico) — die verlinkt Next von selbst und sie gehen VOR allem, was hier
    // stünde. Deshalb steht hier bewusst kein `icons`.
    appleWebApp: { capable: true, title: "SalzGuide", statusBarStyle: "default" },
    // `capable: true` schreibt nur das neutrale `mobile-web-app-capable` — und das
    // versteht Safari erst ab iOS 17.4. Auf allem davor startet die App ohne diese Zeile
    // trotzdem mit Adressleiste, also genau der Fehler, den wir vermeiden wollen. Beide
    // zusammen sind auch richtig herum: Chrome mahnt die Apple-Variante nur an, wenn die
    // neutrale FEHLT.
    other: { "apple-mobile-web-app-capable": "yes" },
    // BEWUSST KEIN `alternates` hier: Next vererbt Metadata nach unten, ein Canonical im
    // Layout gilt also für JEDE Unterseite und weist sie alle als Kopie der Startseite
    // aus -> sie werden nicht sauber indexiert. Jede Seite setzt ihr eigenes Canonical
    // über `alternatesFor(locale, path)` aus src/lib/metadata.ts.
  };
}

export const viewport: Viewport = {
  themeColor: "#faf6ec",
  viewportFit: "cover", // iOS Safe-Area aktivieren
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // Statisches Rendering der Locale-Routen ermöglichen.
  setRequestLocale(locale);

  const messages = await getMessages();

  // min-h-viewport (= var(--sg-vh) = 100svh) am body, NICHT min-h-dvh: Auf kurzen Seiten
  // bestimmt diese Zahl, wo die Fusszeile sitzt. Mit dvh wandert sie beim Scrollen mit
  // Safaris Leisten mit. svh ist der Bildschirm mit ausgefahrenen Leisten und steht
  // still – die Regel dazu steht in globals.css unter "VIEWPORT-HÖHE".
  return (
    <html lang={locale} dir={localeDir(locale)} className={`${inter.variable} h-full`}>
      <body className="flex min-h-viewport flex-col bg-cream text-ink antialiased">
        {/* iOS-Startbildschirme. React 19 hebt <link> von selbst in den <head>, deshalb
            stehen sie hier und nicht in generateMetadata: Sobald dort `icons` gesetzt ist,
            ERSETZT das die Dateikonvention und die Zeilen für icon.svg und apple-icon.png
            verschwinden ersatzlos. Getestet, nicht vermutet.
            Die Liste kommt aus lib/apple-splash.ts — dieselbe, aus der die Bilder
            entstehen, damit Datei und Verweis nicht auseinanderlaufen können. */}
        {APPLE_SPLASH_LINKS.map(({ href, media }) => (
          <link key={href} rel="apple-touch-startup-image" href={href} media={media} />
        ))}
        <NextIntlClientProvider messages={messages}>
          {/* LoginGateProvider MUSS aussen liegen: AiProvider rendert das Chat-Sheet
              als Geschwister von {children}. Laege das Gate innen, haetten die
              Spot-/Event-Karten IM Chat keinen Provider -> Absturz beim Merken. */}
          <LoginGateProvider>
            {/* Pro-Gate wie das Login-Gate: EIN Hinweis-Sheet für alles, was einen
                gesperrten Pro-Inhalt antippt. Innerhalb des Login-Gates und ausserhalb
                des Chats, damit auch die Karten IM Chat es später aufrufen können. */}
            <ProGateProvider>
              <AiProvider>
                {/* Kopf-/Fusszeile, Tab-Leiste und Analytics: AppChrome entscheidet an EINER
                    Stelle, ob eine Route App-Navigation trägt oder Marketing ist. */}
                <AppChrome>{children}</AppChrome>
              </AiProvider>
            </ProGateProvider>
          </LoginGateProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
