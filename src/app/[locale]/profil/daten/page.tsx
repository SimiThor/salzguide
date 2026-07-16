import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BackButton from "@/components/BackButton";
import AccountDataControls from "@/components/AccountDataControls";

// Eigene, datenschutzkonforme Seite für die DSGVO-Selbstbedienung (Newsletter-
// Widerruf, Datenexport Art. 15/20, Konto-Löschung Art. 17). Vom Profil per Button
// verlinkt; Widerruf/Auskunft/Löschung bleiben so leicht auffindbar (Art. 7(3)).
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
    <div className="mx-auto w-full max-w-[440px] px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] md:pt-6">
      <BackButton fallbackHref="/profil" label={t("back")} />

      <h1 className="mt-4 text-2xl font-bold text-ink">{t("title")}</h1>
      <p className="mt-1.5 mb-5 text-[14px] leading-relaxed text-muted">{t("intro")}</p>

      <AccountDataControls newsletter={profile?.newsletter_opt_in ?? false} />
    </div>
  );
}
