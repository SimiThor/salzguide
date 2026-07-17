import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { alternatesFor } from "@/lib/metadata";
import SupportForm from "@/components/SupportForm";

// Kontaktseite. BEWUSST ohne Login-Zwang: Der häufigste Support-Fall ist „ich komme nicht
// rein" — genau die Person ist nicht angemeldet. Ein Formular, das nur Angemeldete
// erreichen, hilft allen ausser denen, die es brauchen.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Support" });
  return {
    title: t("title"),
    description: t("subtitle"),
    alternates: alternatesFor(locale, "/support"),
  };
}

export default async function SupportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Support" });

  // Angemeldet? Dann die E-Mail vorbefüllen. Erspart Tippen und verhindert Tippfehler in
  // genau dem Feld, über das die Antwort zurückkommt.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto w-full max-w-[560px] px-4 pb-[calc(env(safe-area-inset-bottom)+6rem)] pt-8 md:pb-16">
      <h1 className="text-[28px] font-bold leading-tight text-ink">{t("title")}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">{t("subtitle")}</p>
      <div className="mt-5">
        <SupportForm defaultEmail={user?.email ?? undefined} />
      </div>
    </main>
  );
}
