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

  return (
    <html lang={locale} dir={localeDir(locale)} className={`${inter.variable} h-full`}>
      <body className="flex min-h-dvh flex-col bg-cream text-ink antialiased">
        <NextIntlClientProvider messages={messages}>
          {/* LoginGateProvider MUSS aussen liegen: AiProvider rendert das Chat-Sheet
              als Geschwister von {children}. Laege das Gate innen, haetten die
              Spot-/Event-Karten IM Chat keinen Provider -> Absturz beim Merken. */}
          <LoginGateProvider>
            <AiProvider>
              {/* Kopf-/Fusszeile, Tab-Leiste und Analytics: AppChrome entscheidet an EINER
                  Stelle, ob eine Route App-Navigation trägt oder Marketing ist. */}
              <AppChrome>{children}</AppChrome>
            </AiProvider>
          </LoginGateProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
