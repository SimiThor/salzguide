"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createCheckoutSession } from "@/lib/stripe-actions";
import { Spinner } from "@/components/Busy";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  DER Kaufblock. Einer. Für beide Stellen, an denen man Pro kaufen kann.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Preis, §-18-Häkchen, Kauf-Knopf, Vertrauenszeile, Kleingedrucktes: Das stand zweimal im
// Code, auf /pro und in der Karte auf /profil. Zwei Kopien einer Kaufstrecke sind nicht nur
// doppelte Arbeit, sie sind eine Rechtslücke mit Ansage, und genau so ist es gekommen:
//
//   · Die Profil-Karte trug KEINEN Hinweis auf AGB und Widerrufsbelehrung. Wer dort kaufte,
//     bekam die AGB nie zu Gesicht (Einbeziehung) und die Angaben zum Rücktrittsrecht nicht
//     vor der Bestellung (§ 4 FAGG).
//   · Sie kannte die Fehlermeldung für zu viele Versuche nicht.
//   · Sie hob die Zustimmungszeile nicht hervor, wenn jemand ohne Häkchen kaufen wollte.
//
// Jetzt gibt es einen Block. Was rechtlich am Kauf hängt, hängt damit an einer Stelle, und
// eine neue Kauffläche kann es nicht mehr vergessen.

export default function ProPurchase({
  price,
  className = "",
  returnTour = null,
}: {
  /** Kommt serverseitig aus Stripe. Leer = Kauf gerade nicht möglich. */
  price: string;
  className?: string;
  /**
   * Slug der Runde, aus der der Kauf kommt. Gesetzt heisst: Nach dem Bezahlen geht es dorthin
   * zurück statt auf /pro. Nur der Slug, den Pfad baut der Server (siehe safeTourSlug).
   *
   * Ohne das endet ein Kauf im Fahrbetrieb auf der Verkaufsseite, und der Gast steht mit
   * einem Rad an der Strasse und ohne Navigation da.
   */
  returnTour?: string | null;
}) {
  const t = useTranslations("Pro");
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  // §18-FAGG-Zustimmung (sofortige Ausführung + Verlust des Rücktrittsrechts) – Pflicht vor Kauf.
  const [consent, setConsent] = useState(false);
  // Wer ohne Häkchen auf Kaufen tippt, sucht den Grund. Deshalb wird die Zeile selbst einmal
  // hervorgehoben, statt nur einen Satz weiter unten einzublenden.
  const [nudge, setNudge] = useState(false);
  const started = useRef(false);

  const startCheckout = useCallback(() => {
    if (started.current) return;
    started.current = true;
    setErr("");
    start(async () => {
      // Klappt es, kehrt die Aktion NIE zurück: Sie leitet serverseitig zu Stripe weiter
      // (siehe stripe-actions.ts). Alles, was hier ankommt, ist ein Fehler.
      const r = await createCheckoutSession(locale, true, returnTour);
      started.current = false;
      setErr(
        r.error === "unconfigured" || r.error === "no_price"
          ? t("unavailable")
          : r.error === "already_pro"
            ? t("alreadyPro")
            : r.error === "consent"
              ? t("consentRequired")
              : r.error === "rate"
                ? t("tooMany")
                : t("error"),
      );
    });
  }, [locale, t, returnTour]);

  function onBuy() {
    if (pending) return;
    if (!consent) {
      setNudge(true);
      setErr(t("consentRequired"));
      return;
    }
    startCheckout();
  }

  return (
    <div className={className}>
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

      {/* §18-FAGG-Zustimmung – Pflicht vor dem Kauf digitaler Inhalte.
          py-2.5 ist kein Abstand, sondern die Trefferfläche: angefasst wird die ganze Zeile,
          nicht das 16px-Kästchen (44pt-Regel, siehe .sg-hit). */}
      {price && (
        <label
          className={`mt-4 flex cursor-pointer items-start gap-2.5 rounded-[14px] px-2 py-2.5 text-left text-[12px] leading-snug transition ${
            nudge && !consent ? "bg-accent/[0.07] text-ink ring-1 ring-accent/30" : "text-muted"
          }`}
        >
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              if (e.target.checked) {
                setErr("");
                setNudge(false);
              }
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

      {/* „Jetzt kaufen" und nicht „Pro freischalten", und das ist keine Geschmacksfrage.
          § 8 FAGG verlangt, dass der Knopf, mit dem bestellt wird, die Zahlungspflicht
          ausdrückt; „freischalten" tut das nicht, ebensowenig wie „Anmelden" oder „Weiter".
          Die Sanktion ist nicht kosmetisch: Der Vertrag wäre für den Verbraucher schlicht
          nicht bindend. Und laut EuGH (C-249/21, Fuhrmann-2) zählt AUSSCHLIESSLICH der Text
          im Knopf, nicht der Preis darüber und nicht das Häkchen daneben. */}
      <button
        type="button"
        onClick={onBuy}
        disabled={pending || !price}
        aria-busy={pending}
        className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-accent px-5 py-4 text-[16px] font-semibold text-white shadow-[0_10px_24px_-8px_rgba(204,41,36,0.6)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
      >
        {pending && <Spinner />}
        {pending ? t("redirecting") : t("buy")}
      </button>

      <p className="mt-3.5 text-center text-[12px] text-muted/80">🔒 {t("securePay")}</p>

      {/* Das Kleingedruckte, und es MUSS an JEDER Kauffläche stehen: Seit der Kauf ohne
          Anmeldung läuft, gibt es keinen Login-Screen mehr, der die AGB einbezieht, und
          § 4 FAGG verlangt die Angaben zum Rücktrittsrecht VOR der Bestellung. */}
      <p className="mt-2 px-2 text-center text-[11px] leading-relaxed text-muted/90">
        {t.rich("legalHint", {
          terms: (c) => (
            <Link href="/rechtliches/agb" className="underline">
              {c}
            </Link>
          ),
          cancel: (c) => (
            <Link href="/rechtliches/widerruf" className="underline">
              {c}
            </Link>
          ),
        })}
      </p>

      {err && <p className="mt-2 text-center text-[13px] text-accent">{err}</p>}
    </div>
  );
}
