"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createCheckoutSession } from "@/lib/stripe-actions";
import { Spinner } from "@/components/Busy";
import { ProWordmark } from "@/components/ProBadge";
import ProFeatureList from "@/components/ProFeatureList";

// Conversion-Landing für den Pro-Kauf (mobile-first, iOS-2026).
//
// ZWEI TIPPER ZUM ZIEL: Häkchen, Kauf-Knopf — dann ist man bei Stripe, wo Apple/Google Pay
// ein Tap sind. Kein Konto davor. Die E-Mail sammelt Stripe im Checkout ohnehin als
// Pflichtfeld ein, das Konto entsteht danach daraus (siehe lib/pro-purchase.ts).
//
// Was hier vorher stand und warum es weg ist: Ein Klick auf „Jetzt Pro freischalten" klappte
// für Gäste erst einen Login auf. Der Login ist ein Magic-Link, also lag zwischen Kaufabsicht
// und Kasse ein Postfach — App verlassen, Mail suchen, Link antippen, zurückkommen, Häkchen
// nochmal setzen (der Zustand war nach dem Seitenwechsel weg), Knopf nochmal. Sieben Schritte,
// von denen sechs nichts mit dem Bezahlen zu tun hatten.
//
// Der Preis kommt serverseitig aus Stripe -> nichts manipulierbar.

export default function ProLanding({
  price,
  canceled,
}: {
  price: string;
  canceled: boolean;
}) {
  const t = useTranslations("Pro");
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  // §18-FAGG-Zustimmung (sofortige Ausführung + Verzicht aufs Widerrufsrecht) – Pflicht vor Kauf.
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
      const r = await createCheckoutSession(locale, true);
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
  }, [locale, t]);

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
    <div className="mx-auto w-full max-w-[440px] px-4 pt-[var(--sg-page-top)] md:pt-8">
      {canceled && !pending && (
        <div className="mb-4 rounded-[18px] bg-black/[0.04] p-4 text-center">
          <p className="text-[15px] font-semibold text-ink">{t("canceledTitle")}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{t("canceledBody")}</p>
        </div>
      )}

      {/* EINE zusammenhängende Fläche mit drei klar getrennten Blöcken: was dir fehlt,
          was du bekommst, was es kostet. Getrennt durch Haarlinien statt durch Kacheln —
          gestapelte Kärtchen wären vier Flächen für eine Aussage (iOS macht das in
          gruppierten Listen genauso). */}
      <div className="overflow-hidden rounded-[28px] bg-gradient-to-b from-accent/[0.12] via-white to-white shadow-[0_24px_60px_-28px_rgba(204,41,36,0.45)] ring-1 ring-black/[0.05]">
        {/* 1. Was dir ohne Pro entgeht. Wortmarke klein darüber, Überschrift sagt die
            Sache selbst, und dann ist Schluss: Der erklärende Satz darunter ist weg. Er
            sagte, was die vier Zeilen gleich darunter ohnehin sagen, nur in Prosa. Weniger
            Text heisst hier auch, dass der Kauf-Knopf höher steht. */}
        <div className="px-7 pt-7 pb-6 text-center">
          <ProWordmark name={t("title")} className="text-[14px]" />
          <h1 className="mt-3 text-[27px] font-bold leading-[1.12] tracking-tight text-ink">
            {t("heroTitle")}
          </h1>
        </div>

        {/* 2. Was drin ist. Vier Zeilen, überall dieselben (ProFeatureList). */}
        <div className="border-t border-black/[0.06] px-6 py-3">
          <ProFeatureList density="page" />
        </div>

        {/* 3. Was es kostet. Der Preis steht ganz für sich, darunter nur noch der Weg
            zur Kasse und das Kleingedruckte. */}
        {/* Der Kauf-Knopf muss am iPhone ohne Scrollen ganz dastehen: Die Abstände oben sind
            genau so weit zusammengezogen, dass sein unterer Rand über der Tab-Leiste bleibt
            (gemessen, 390x844). Die Zustimmungs-Zeile bleibt davon ausgenommen, die ist eine
            Trefferfläche und darf die 44pt nicht unterschreiten. */}
        <div className="border-t border-black/[0.06] px-7 pt-5 pb-8">
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
              py-2.5 ist kein Abstand, sondern die Trefferfläche: angefasst wird die ganze
              Zeile, nicht das 16px-Kästchen (44pt-Regel, siehe .sg-hit). */}
          {price && (
            <label
              className={`mt-4 flex cursor-pointer items-start gap-2.5 rounded-[14px] px-2 py-2.5 text-left text-[12px] leading-snug transition ${
                nudge && !consent
                  ? "bg-accent/[0.07] text-ink ring-1 ring-accent/30"
                  : "text-muted"
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
              ausdrückt; „freischalten" tut das nicht, ebensowenig wie „Anmelden" oder
              „Weiter". Die Sanktion ist nicht kosmetisch: Der Vertrag wäre für den
              Verbraucher schlicht nicht bindend. Und laut EuGH (C-249/21, Fuhrmann-2) zählt
              AUSSCHLIESSLICH der Text im Knopf, nicht der Preis darüber und nicht das
              Häkchen daneben.
              Ob dieser Knopf oder Stripes Bezahl-Knopf der Bestellknopf im Rechtssinn ist,
              lässt sich streiten. Deshalb trägt dieser hier die eindeutige Beschriftung:
              Ist er es, passt sie; ist er es nicht, schadet sie nichts.
              „Pro freischalten" (Pro.cta) bleibt auf den Knöpfen, die nur auf diese Seite
              verlinken. Ein Knopf, der eine Seite öffnet, darf nicht „kaufen" heissen. */}
          <button
            type="button"
            onClick={onBuy}
            disabled={pending || !price}
            aria-busy={pending}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-accent px-5 py-4 text-[16px] font-semibold text-white shadow-[0_10px_24px_-8px_rgba(204,41,36,0.6)] transition active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
          >
            {pending && <Spinner />}
            {pending ? t("redirecting") : t("buy")}
          </button>

          {/* Unter dem Knopf steht nur noch das Vertrauens-Signal. Hier stand kurz „Kein
              Konto nötig": Das erklärt eine Hürde, die es nicht mehr gibt, und wer sie nie
              gesehen hat, fängt an sie zu suchen. Fehlende Reibung braucht keine Fussnote. */}
          <p className="mt-3.5 text-center text-[12px] text-muted/80">🔒 {t("securePay")}</p>

          {/* Das Kleingedruckte, und es MUSS hier stehen, seit der Kauf ohne Anmeldung läuft.
              Vorher kam vor jedem Kauf der Login-Screen, und dort stand der Satz „Mit dem
              Anmelden stimmst du den AGB … zu". Mit dem Login ist auch dieser Satz aus dem
              Kaufweg verschwunden — die AGB wären damit nicht mehr einbezogen, und § 4 FAGG
              verlangt die Angaben zum Rücktrittsrecht VOR der Bestellung. Gleiche Form wie
              der Hinweis im Login (Auth.legalHint), damit es dieselbe App bleibt. */}
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
      </div>
    </div>
  );
}
