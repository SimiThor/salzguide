"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createCheckoutSession } from "@/lib/stripe-actions";
import { ProWordmark } from "@/components/ProBadge";
import { PRO_FEATURES } from "@/components/proFeatures";

// Pro-Upgrade-Karte auf /profil (eingeloggter Nutzer). Gleiche Design-Familie wie die
// /pro-Landing (warme, zusammenhängende Fläche, Emoji-Chips, Preis+CTA), nur kompakter.
// Der User ist bereits eingeloggt -> Klick startet direkt die Stripe-Checkout-Session.
// Der Preis kommt serverseitig aus Stripe -> kein Betrag im Client, nichts manipulierbar.
export default function ProUpgrade({ price }: { price: string }) {
  const t = useTranslations("Pro");
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  // §18-FAGG-Zustimmung (sofortige Ausführung + Verzicht aufs Widerrufsrecht) – Pflicht vor Kauf.
  const [consent, setConsent] = useState(false);

  function onBuy() {
    if (pending) return;
    if (!consent) {
      setErr(t("consentRequired"));
      return;
    }
    setErr("");
    start(async () => {
      const r = await createCheckoutSession(locale, true);
      if (r.ok && r.url) {
        window.location.href = r.url; // Weiterleitung zur gehosteten Stripe-Checkout
      } else {
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
  }

  return (
    <div className="overflow-hidden rounded-[28px] bg-gradient-to-b from-accent/[0.12] via-white to-white shadow-[0_24px_60px_-28px_rgba(204,41,36,0.45)] ring-1 ring-black/[0.05]">
      {/* Kopf */}
      <div className="px-6 pt-6 text-center">
        <ProWordmark name={t("title")} className="text-[15px]" />
        <p className="mx-auto mt-3 max-w-[18rem] text-[15px] leading-relaxed text-muted">
          {t("subtitle")}
        </p>
      </div>

      {/* Vorteile als warme iOS-Zeilen mit Emoji-Chips (identisch zu /pro) */}
      <ul className="mt-5 space-y-1 px-4">
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

      {/* Preis + CTA */}
      <div className="mt-5 px-6 pb-7">
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
          disabled={pending || !price}
          className="mt-4 w-full rounded-full bg-accent px-5 py-4 text-[16px] font-semibold text-white shadow-[0_10px_24px_-8px_rgba(204,41,36,0.6)] transition active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
        >
          {pending ? t("redirecting") : t("cta")}
        </button>

        <p className="mt-3.5 text-center text-[12px] text-muted/80">🔒 {t("securePay")}</p>
        {err && <p className="mt-2 text-center text-[13px] text-accent">{err}</p>}
      </div>
    </div>
  );
}
