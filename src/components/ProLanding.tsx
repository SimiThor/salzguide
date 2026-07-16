"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createCheckoutSession } from "@/lib/stripe-actions";
import LoginForm from "@/components/LoginForm";
import { ProWordmark } from "@/components/ProBadge";
import { PRO_FEATURES } from "@/components/proFeatures";

// Conversion-Landing für den Pro-Kauf (mobile-first, iOS-2026). Das Angebot ist SOFORT
// sichtbar (keine Login-Wall davor). Erst beim Kauf-Klick wird – falls ausgeloggt – die
// E-Mail abgefragt: Magic-Link bringt den User zurück auf /pro?checkout=1 und startet den
// Checkout automatisch. Der Preis kommt serverseitig aus Stripe -> nichts manipulierbar.

export default function ProLanding({
  price,
  isLoggedIn,
  autoCheckout,
  canceled,
}: {
  price: string;
  isLoggedIn: boolean;
  autoCheckout: boolean;
  canceled: boolean;
}) {
  const t = useTranslations("Pro");
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  // §18-FAGG-Zustimmung (sofortige Ausführung + Verzicht aufs Widerrufsrecht) – Pflicht vor Kauf.
  const [consent, setConsent] = useState(false);
  const started = useRef(false);

  const startCheckout = useCallback(() => {
    if (started.current) return;
    started.current = true;
    setErr("");
    start(async () => {
      const r = await createCheckoutSession(locale, true);
      if (r.ok && r.url) {
        window.location.href = r.url;
      } else {
        started.current = false;
        setErr(
          r.error === "unconfigured" || r.error === "no_price"
            ? t("unavailable")
            : r.error === "already_pro"
              ? t("alreadyPro")
              : r.error === "consent"
                ? t("consentRequired")
                : t("error"),
        );
      }
    });
  }, [locale, t]);

  // Rücksprung aus dem Login (?checkout=1): NICHT automatisch abbuchen – die §18-Zustimmung
  // muss beim Kauf gesetzt sein. Der/die eingeloggte Nutzer:in setzt das Häkchen und kauft.
  useEffect(() => {
    if (autoCheckout && isLoggedIn && price && consent) startCheckout();
  }, [autoCheckout, isLoggedIn, price, consent, startCheckout]);

  function onBuy() {
    if (pending) return;
    if (!consent) {
      setErr(t("consentRequired"));
      return;
    }
    if (!isLoggedIn) {
      setShowLogin(true);
      return;
    }
    startCheckout();
  }

  const busy = pending;

  return (
    <div className="mx-auto w-full max-w-[440px] px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] md:pt-8">
      {canceled && !busy && (
        <div className="mb-4 rounded-[18px] bg-black/[0.04] p-4 text-center">
          <p className="text-[15px] font-semibold text-ink">{t("canceledTitle")}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{t("canceledBody")}</p>
        </div>
      )}

      {/* EINE zusammenhängende Fläche: warmer Salzburg-Verlauf oben, fließend nach unten
          zu Features und Kauf. Keine abgesetzten Einzel-Kacheln -> ruhig & Apple-artig. */}
      <div className="overflow-hidden rounded-[28px] bg-gradient-to-b from-accent/[0.12] via-white to-white shadow-[0_24px_60px_-28px_rgba(204,41,36,0.45)] ring-1 ring-black/[0.05]">
        {/* Hero */}
        <div className="px-7 pt-8 text-center">
          <ProWordmark name={t("title")} className="text-[15px]" />
          <h1 className="mt-5 text-[27px] font-bold leading-[1.15] tracking-tight text-ink">
            {t("heroTitle")}
          </h1>
          <p className="mx-auto mt-3 max-w-[20rem] text-[15px] leading-relaxed text-muted">
            {t("heroSubtitle")}
          </p>
        </div>

        {/* Features als warme iOS-Zeilen mit Emoji-Chips */}
        <ul className="mt-7 space-y-1 px-5">
          {PRO_FEATURES.map((f) => (
            <li key={f.key} className="flex items-center gap-3.5 rounded-2xl px-2 py-2.5">
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/10 text-[19px]"
                aria-hidden
              >
                {f.icon}
              </span>
              <span className="text-[15px] font-medium leading-snug text-ink">{t(f.key)}</span>
            </li>
          ))}
        </ul>

        {/* Preis + CTA als Höhepunkt derselben Fläche */}
        <div className="mt-6 px-7 pb-8">
          <div className="flex items-baseline justify-center gap-2">
            {price ? (
              <>
                <span className="text-[34px] font-bold tracking-tight text-ink">{price}</span>
                <span className="text-[14px] text-muted">{t("oneTime")}</span>
              </>
            ) : (
              <span className="text-[15px] text-muted">{t("unavailable")}</span>
            )}
          </div>

          {/* §18-FAGG-Zustimmung – Pflicht vor dem Kauf digitaler Inhalte */}
          {price && (
            <label className="mt-4 flex items-start gap-2.5 text-left text-[12px] leading-snug text-muted">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => {
                  setConsent(e.target.checked);
                  if (e.target.checked) setErr("");
                }}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#cc2924]"
              />
              <span>
                {t.rich("consentLabel", {
                  w: (c) => (
                    <Link
                      href="/rechtliches/widerruf"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      {c}
                    </Link>
                  ),
                })}
              </span>
            </label>
          )}

          <button
            type="button"
            onClick={onBuy}
            disabled={busy || !price}
            className="mt-4 w-full rounded-full bg-accent px-5 py-4 text-[16px] font-semibold text-white shadow-[0_10px_24px_-8px_rgba(204,41,36,0.6)] transition active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
          >
            {busy ? t("redirecting") : t("cta")}
          </button>

          {/* Gast: E-Mail-Abfrage erst nach Kauf-Klick (Progressive Disclosure). */}
          {showLogin && !isLoggedIn && (
            <div className="mt-4 border-t border-black/[0.06] pt-4">
              <p className="mb-3 text-center text-[13px] leading-relaxed text-muted">
                {t("loginNudge")}
              </p>
              <LoginForm next={`/${locale}/pro?checkout=1`} />
            </div>
          )}

          <p className="mt-3.5 text-center text-[12px] text-muted/80">🔒 {t("securePay")}</p>
          {err && <p className="mt-2 text-center text-[13px] text-accent">{err}</p>}
        </div>
      </div>

      <p className="mt-5 text-center text-[13px] text-muted">💛 {t("trustLocal")}</p>
    </div>
  );
}
