import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { localeDir } from "@/i18n/locales";
import BottomNav from "@/components/BottomNav";
import DesktopHeader from "@/components/DesktopHeader";
import MobileHeader from "@/components/MobileHeader";
import LegalFooter from "@/components/LegalFooter";
import AiProvider from "@/components/ai/AiProvider";
import LoginGateProvider from "@/components/auth/LoginGate";
import Analytics from "@/components/Analytics";
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
    metadataBase: new URL(
      process.env.NEXT_PUBLIC_SITE_URL ?? "https://salzguide.com",
    ),
    title: { default: "SalzGuide", template: "%s · SalzGuide" },
    description: t("description"),
    alternates: {
      canonical: `/${locale}`,
      // hreflang für ALLE Sprachen (dynamisch aus der Config) + x-default -> vollständige
      // Sprach-Auszeichnung für Suchmaschinen. Neue Sprache in locales.ts = automatisch dabei.
      languages: {
        ...Object.fromEntries(routing.locales.map((l) => [l, `/${l}`])),
        "x-default": `/${routing.defaultLocale}`,
      },
    },
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
          <AiProvider>
            <LoginGateProvider>
              <MobileHeader />
              <DesktopHeader />
              {/* Mobile: Platz unten für BottomNav. Desktop: Platz oben für Header. */}
              <main className="flex flex-1 flex-col md:pt-14">
                {children}
                {/* Globaler Footer inkl. gesetzlichem Widerruf-Zugang (§ 13a FAGG) auf jeder
                    Seite; blendet sich auf der vollflächigen Karten-Startseite selbst aus. */}
                <LegalFooter />
              </main>
              <BottomNav />
              <Analytics />
            </LoginGateProvider>
          </AiProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
