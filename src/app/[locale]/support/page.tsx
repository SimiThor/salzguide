import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { alternatesFor, ogFor } from "@/lib/metadata";
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
  // SEO-Texte aus dem Meta-Namensraum, die sichtbare Überschrift bleibt Support.title.
  const t = await getTranslations({ locale, namespace: "Meta" });
  return {
    title: t("supportTitle"),
    description: t("supportDescription"),
    alternates: alternatesFor(locale, "/support"),
    ...ogFor({
      locale,
      path: "/support",
      title: t("supportTitle"),
      description: t("supportDescription"),
    }),
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
    // pt-[var(--sg-page-top)]: Am Handy liegt der App-Header `fixed` über dem Inhalt. Hier
    // stand nur `pt-8` — die Überschrift lag damit 29px HINTER dem Balken und war nicht zu
    // sehen. Der Abstand kommt aus der einen Quelle (globals.css), nicht als eigene Zahl.
    // Kein eigenes pb: Den Platz über der Tab-Leiste bringt die Rechts-Fusszeile für ALLE
    // Seiten mit (LegalFooter, pb aus --sg-nav-h) — das env()-Polster hier war ein zweiter,
    // handgerechneter Nav-Ausgleich und stapelte sich mit dem Footer-Abstand.
    <main className="mx-auto w-full max-w-[560px] px-4 pt-[var(--sg-page-top)] md:pt-8">
      <h1 className="text-[28px] font-bold leading-tight text-ink">{t("title")}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">{t("subtitle")}</p>
      <div className="mt-5">
        <SupportForm defaultEmail={user?.email ?? undefined} />
      </div>
    </main>
  );
}
