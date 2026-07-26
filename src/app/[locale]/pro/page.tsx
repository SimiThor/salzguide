import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProPrice, formatProPrice } from "@/lib/pro";
import { getProSpotCount } from "@/lib/spots";
import { alternatesFor } from "@/lib/metadata";
import ProLanding from "@/components/ProLanding";
import { ProWordmark } from "@/components/ProBadge";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  // Nicht Pro.title nehmen: das ist „SalzGuide" und würde mit dem Titel-Template aus dem
  // Layout zu „SalzGuide · SalzGuide". Seiten-Titel leben im Meta-Namespace.
  const t = await getTranslations({ locale, namespace: "Meta" });
  return {
    title: t("proTitle"),
    description: t("proDescription"),
    alternates: alternatesFor(locale, "/pro"),
  };
}

/**
 * Was nach dem Checkout passiert ist. Setzt die Rücksprung-Route (pro/aktivieren), nachdem
 * sie die Zahlung bei Stripe geprüft und freigeschaltet hat — diese Seite zeigt nur noch.
 *
 *   success    — Pro ist aktiv und der Mensch ist eingeloggt. Fertig.
 *   mail       — bezahlt; der Zugang liegt in seinem Postfach (fremde/vorhandene Adresse,
 *                anderes Gerät, abgelaufener Kauf-Nachweis).
 *   processing — Zahlung noch nicht bestätigt (SEPA, Klarna). Der Webhook schaltet nach.
 *   help       — bezahlt, aber die Freischaltung hat gehakt. Der einzige Zustand, der eine
 *                Person auf unserer Seite braucht.
 *   cancel     — bei Stripe abgebrochen. Zeigt wieder das Angebot.
 */
const RESULT_STATES = ["success", "mail", "processing", "help"] as const;
type ResultState = (typeof RESULT_STATES)[number];

function isResultState(v: string | undefined): v is ResultState {
  return !!v && (RESULT_STATES as readonly string[]).includes(v);
}

// Dedizierte, conversion-starke Pro-Kaufseite. Ziel aller „Freischalten"-CTAs (Pro-Spots,
// Touren, Chat) -> hier landet der User, NICHT auf der Login-/Profilseite. Gekauft wird ohne
// Konto davor; das Konto entsteht aus der Zahlung (siehe lib/pro-purchase.ts).
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

  // ── Ergebnis eines Checkouts ──────────────────────────────────────────────────────────
  if (isResultState(checkout)) {
    if (checkout === "success") {
      return (
        <ProResult emoji="🎉" title={t("successTitle")} body={t("successBody")}>
          {/* Welche Adresse sein Konto trägt, weiss der Käufer nach einem Gast-Kauf sonst
              nur aus dem Stripe-Formular. Sie steht hier, damit er auf jedem weiteren
              Gerät weiss, womit er sich anmeldet. */}
          {user?.email && (
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              {t("accountIs", { email: user.email })}
            </p>
          )}
          <Cta href="/explore" label={t("exploreCta")} />
        </ProResult>
      );
    }
    if (checkout === "mail") {
      return (
        <ProResult emoji="✉️" title={t("mailTitle")} body={t("mailBody")}>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            {t.rich("mailFallback", {
              login: (c) => (
                <Link href="/profil" className="font-semibold text-ink underline">
                  {c}
                </Link>
              ),
            })}
          </p>
        </ProResult>
      );
    }
    if (checkout === "processing") {
      return (
        <ProResult
          emoji="⏳"
          title={t("processingTitle")}
          body={t("processingBody")}
        />
      );
    }
    return (
      <ProResult emoji="🛠️" title={t("helpTitle")} body={t("helpBody")}>
        <Cta href="/support" label={t("helpCta")} />
      </ProResult>
    );
  }

  const { data: profile } = user
    ? await supabase.from("profiles").select("is_pro").eq("id", user.id).maybeSingle()
    : { data: null };

  // Schon Pro -> kein Kauf nötig.
  if (profile?.is_pro) {
    return (
      <ProResult emoji={null} wordmark={t("title")} title={t("alreadyPro")} body={null}>
        <Cta href="/explore" label={t("exploreCta")} />
      </ProResult>
    );
  }

  // Preis = Single Source of Truth aus Stripe (server-seitig), die Zahl der gesperrten
  // Spots = Single Source of Truth aus der Datenbank. Beides parallel, beides nie im Text.
  const [price, locked] = await Promise.all([getProPrice(), getProSpotCount()]);

  return (
    <ProLanding
      price={formatProPrice(price, locale)}
      canceled={checkout === "cancel"}
      lockedSpots={locked}
    />
  );
}

/**
 * Die eine Karte für jedes Ergebnis dieser Seite.
 *
 * Vorher stand derselbe Kasten mit demselben Verlauf zweimal in dieser Datei (Erfolg,
 * „schon Pro"), und jeder neue Zustand hätte eine dritte Kopie gebraucht. Ein Emoji, eine
 * Überschrift, ein Satz, optional ein Knopf — genau der Aufbau, den auch der Login-Screen
 * hat, damit ein Weg wie ein Weg aussieht und nicht wie drei Seiten.
 */
function ProResult({
  emoji,
  wordmark,
  title,
  body,
  children,
}: {
  /** Das Zeichen im Kreis. null = statt dessen die Wortmarke (der Fall „schon Pro"). */
  emoji: string | null;
  wordmark?: string;
  title: string;
  body: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[480px] px-4 pt-[var(--sg-page-top)] md:pt-8">
      <div className="rounded-[28px] bg-gradient-to-b from-accent/[0.12] via-white to-white p-8 text-center shadow-[0_24px_60px_-28px_rgba(204,41,36,0.45)] ring-1 ring-black/[0.05]">
        {emoji ? (
          <span
            className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-accent/10 text-[30px] leading-none"
            aria-hidden
          >
            {emoji}
          </span>
        ) : (
          wordmark && <ProWordmark name={wordmark} className="text-[15px]" />
        )}
        <h1 className="mt-4 text-[24px] font-bold leading-tight tracking-tight text-ink">
          {title}
        </h1>
        {body && (
          <p className="mx-auto mt-2 max-w-[22rem] text-[15px] leading-relaxed text-muted">
            {body}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}

function Cta({ href, label }: { href: "/explore" | "/support"; label: string }) {
  return (
    <Link
      href={href}
      className="mt-6 inline-block rounded-full bg-accent px-6 py-3 text-[15px] font-semibold text-white active:scale-[0.98]"
    >
      {label}
    </Link>
  );
}
