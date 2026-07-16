import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProPrice, formatProPrice } from "@/lib/pro";
import LoginForm from "@/components/LoginForm";
import ProUpgrade from "@/components/ProUpgrade";
import ProBadge from "@/components/ProBadge";
import { signOut } from "./actions";

export default async function ProfilPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ checkout?: string; auth_error?: string }>;
}) {
  const { locale } = await params;
  const { checkout, auth_error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("Auth");
  const tA = await getTranslations("Account");
  const tPro = await getTranslations("Pro");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Ausgeloggt -> Login/Join
  if (!user) {
    return (
      <div className="mx-auto w-full max-w-[440px] px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] md:pt-6">
        <h1 className="text-2xl font-bold text-ink">{t("joinTitle")}</h1>
        <p className="mt-1.5 mb-5 text-[15px] leading-relaxed text-muted">
          {t("joinSubtitle")}
        </p>
        <LoginForm authError={auth_error === "1"} />
      </div>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, is_pro, role")
    .eq("id", user.id)
    .maybeSingle();

  const isPro = profile?.is_pro ?? false;
  const isAdmin = profile?.role === "admin";
  // Preis kommt serverseitig aus Stripe (Single Source of Truth) – nur laden, wenn nötig.
  const priceStr = isPro ? "" : formatProPrice(await getProPrice(), locale);

  return (
    <div className="mx-auto w-full max-w-[440px] px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] md:pt-6">
      <h1 className="text-2xl font-bold text-ink">{t("profileTitle")}</h1>

      {checkout === "success" && (
        <div className="mt-4 rounded-[16px] bg-accent/10 p-4">
          <p className="text-[15px] font-semibold text-accent">{tPro("successTitle")}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{tPro("successBody")}</p>
        </div>
      )}
      {checkout === "cancel" && !isPro && (
        <div className="mt-4 rounded-[16px] bg-black/[0.04] p-4">
          <p className="text-[15px] font-semibold text-ink">{tPro("canceledTitle")}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{tPro("canceledBody")}</p>
        </div>
      )}

      <div className="mt-5 space-y-3">
        <div className="rounded-[18px] bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            {t("loggedInAs")}
          </p>
          <p className="mt-0.5 text-[15px] font-medium text-ink">
            {profile?.email ?? user.email}
          </p>
        </div>

        <div className="flex items-center justify-between rounded-[18px] bg-white p-5 shadow-sm">
          <span className="text-[15px] font-medium text-ink">
            {isPro ? t("proStatus") : t("freeStatus")}
          </span>
          {isPro ? (
            <ProBadge size="md" />
          ) : (
            <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-medium text-muted">
              {t("free")}
            </span>
          )}
        </div>

        {/* Pro-Upgrade (nur für Nicht-Pro). Preis + Zahlung laufen über Stripe. */}
        {!isPro && <ProUpgrade price={priceStr} />}

        {/* DSGVO-Selbstbedienung auf eigener Seite (Widerruf/Auskunft/Löschung, Art. 7(3)/15/17) */}
        <Link
          href="/profil/daten"
          className="flex items-center justify-between rounded-[18px] bg-white p-5 shadow-sm active:scale-[0.99]"
        >
          <span className="text-[15px] font-medium text-ink">{tA("linkLabel")}</span>
          <span className="text-lg text-muted" aria-hidden>
            ›
          </span>
        </Link>

        {isAdmin && (
          <Link
            href="/admin"
            className="flex items-center justify-between rounded-[18px] bg-ink p-5 shadow-sm active:scale-[0.99]"
          >
            <span className="text-[15px] font-medium text-white">⚙️ Admin</span>
            <span className="text-lg text-white/50" aria-hidden>
              ›
            </span>
          </Link>
        )}

        <form action={signOut}>
          <input type="hidden" name="locale" value={locale} />
          <button
            type="submit"
            className="w-full rounded-full bg-black/5 px-5 py-3 text-sm font-semibold text-ink active:scale-[0.98]"
          >
            {t("logout")}
          </button>
        </form>
      </div>
    </div>
  );
}
