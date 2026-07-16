import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProPrice, formatProPrice } from "@/lib/pro";
import ProLanding from "@/components/ProLanding";
import { ProWordmark } from "@/components/ProBadge";

// Dedizierte, conversion-starke Pro-Kaufseite. Ziel aller „Freischalten"-CTAs (Pro-Spots,
// Touren, Chat) -> hier landet der User, NICHT auf der Login-/Profilseite. Das Angebot ist
// sofort sichtbar; Login passiert erst beim Kauf (siehe ProLanding).
export default async function ProPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { locale } = await params;
  const { checkout } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("Pro");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("is_pro").eq("id", user.id).maybeSingle()
    : { data: null };
  const isPro = profile?.is_pro ?? false;

  // Erfolgsbestätigung nach Zahlung (Freischaltung läuft per Webhook, ggf. minimal verzögert).
  if (checkout === "success") {
    return (
      <div className="mx-auto w-full max-w-[480px] px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] md:pt-8">
        <div className="rounded-[28px] bg-gradient-to-b from-accent/[0.12] via-white to-white p-8 text-center shadow-[0_24px_60px_-28px_rgba(204,41,36,0.45)] ring-1 ring-black/[0.05]">
          <p className="text-5xl" aria-hidden>
            🎉
          </p>
          <h1 className="mt-4 text-[24px] font-bold text-ink">{t("successTitle")}</h1>
          <p className="mx-auto mt-2 max-w-[22rem] text-[15px] leading-relaxed text-muted">
            {t("successBody")}
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-full bg-accent px-6 py-3 text-[15px] font-semibold text-white active:scale-[0.98]"
          >
            {t("exploreCta")}
          </Link>
        </div>
      </div>
    );
  }

  // Schon Pro -> kein Kauf nötig.
  if (isPro) {
    return (
      <div className="mx-auto w-full max-w-[480px] px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] md:pt-8">
        <div className="rounded-[28px] bg-gradient-to-b from-accent/[0.12] via-white to-white p-8 text-center shadow-[0_24px_60px_-28px_rgba(204,41,36,0.45)] ring-1 ring-black/[0.05]">
          <ProWordmark name={t("title")} className="text-[15px]" />
          <p className="mt-4 text-[17px] font-semibold text-ink">{t("alreadyPro")}</p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-full bg-accent px-6 py-3 text-[15px] font-semibold text-white active:scale-[0.98]"
          >
            {t("exploreCta")}
          </Link>
        </div>
      </div>
    );
  }

  // Preis = Single Source of Truth aus Stripe (server-seitig).
  const priceStr = formatProPrice(await getProPrice(), locale);

  return (
    <ProLanding
      price={priceStr}
      isLoggedIn={!!user}
      autoCheckout={checkout === "1"}
      canceled={checkout === "cancel"}
    />
  );
}
