import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BackButton from "@/components/BackButton";
import AccountDataControls from "@/components/AccountDataControls";

// Eigene, datenschutzkonforme Seite für die DSGVO-Selbstbedienung (Newsletter-
// Widerruf, Datenexport Art. 15/20, Konto-Löschung Art. 17). Vom Profil per Button
// verlinkt; Widerruf/Auskunft/Löschung bleiben so leicht auffindbar (Art. 7(3)).

// Private Seite: kein Suchtreffer (noindex), Links folgen erlaubt.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Account" });
  return { title: t("title"), robots: { index: false, follow: true } };
}

export default async function AccountDataPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Account");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/profil`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("newsletter_opt_in")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div className="mx-auto w-full max-w-[440px] px-4 pt-[var(--sg-page-top)] md:pt-6">
      <BackButton fallbackHref="/profil" label={t("back")} />

      <h1 className="mt-4 text-2xl font-bold text-ink">{t("title")}</h1>
      <p className="mt-1.5 mb-5 text-[14px] leading-relaxed text-muted">{t("intro")}</p>

      <AccountDataControls newsletter={profile?.newsletter_opt_in ?? false} />
    </div>
  );
}
