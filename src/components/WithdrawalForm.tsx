"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import TurnstileWidget from "@/components/TurnstileWidget";
import {
  submitWithdrawal,
  type WithdrawalState,
} from "@/app/[locale]/rechtliches/widerruf/actions";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

function Spinner() {
  return (
    <svg
      className="h-[18px] w-[18px] shrink-0 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" />
      <path
        className="opacity-90"
        d="M12 3a9 9 0 0 1 9 9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

const ERRORS: Record<string, string> = {
  name: "Bitte gib deinen Namen an.",
  email: "Bitte gib eine gültige E-Mail-Adresse an.",
  contract: "Bitte gib eine Bestell-/Vertragskennung an (z. B. Bestellnummer oder Konto-E-Mail).",
  captcha: "Bitte bestätige kurz, dass du kein Roboter bist, und versuch's nochmal.",
};

const inputCls =
  "w-full rounded-[14px] border border-black/10 bg-white px-4 py-3 text-[15px] text-ink outline-none focus:border-accent";

// Zweistufiger Online-Widerruf (EU-RL 2023/2673 / § 13a FAGG): Der Einstiegs-Link
// „Vertrag widerrufen" (im globalen Footer) führt DIREKT hierher, wo das Formular sofort
// sichtbar ist (Schritt 1). Schritt 2 = „Widerruf bestätigen" sendet ab. Danach geht die
// Eingangsbestätigung per E-Mail raus. Bot-Schutz via Turnstile; Button ist nie „tot".
export default function WithdrawalForm() {
  const [state, formAction, pending] = useActionState<WithdrawalState, FormData>(
    submitWithdrawal,
    null,
  );

  const captchaOn = !!TURNSTILE_SITE_KEY;
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);
  const [captchaFailed, setCaptchaFailed] = useState(false);
  const [seenError, setSeenError] = useState<string | undefined>(undefined);
  if (state?.error !== seenError) {
    setSeenError(state?.error);
    if (state?.error === "captcha") {
      setCaptchaToken("");
      setCaptchaKey((k) => k + 1);
    }
  }

  const formRef = useRef<HTMLFormElement>(null);
  const [awaitingCaptcha, setAwaitingCaptcha] = useState(false);

  // Frühzeitiger Klick, bevor der Roboter-Check fertig ist -> automatisch absenden, sobald da.
  useEffect(() => {
    if (awaitingCaptcha && captchaToken) formRef.current?.requestSubmit();
  }, [awaitingCaptcha, captchaToken]);

  const checking = awaitingCaptcha && !captchaToken && !captchaFailed;
  const busy = pending || checking;

  if (state?.ok) {
    return (
      <div className="mt-4 rounded-[16px] bg-accent/[0.06] p-5">
        <p className="text-2xl" aria-hidden>
          ✅
        </p>
        <p className="mt-2 text-[15px] font-semibold text-ink">Widerruf eingegangen</p>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">
          Wir haben deinen Widerruf erhalten. Eine Eingangsbestätigung mit Datum und Uhrzeit geht
          dir per E-Mail zu. Etwaige Rückzahlungen erfolgen unverzüglich, spätestens binnen 14 Tagen.
        </p>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={(e) => {
        if (captchaOn && !captchaToken && !captchaFailed) {
          e.preventDefault();
          setAwaitingCaptcha(true);
        } else if (awaitingCaptcha) {
          setAwaitingCaptcha(false);
        }
      }}
      className="mt-4 flex flex-col gap-3 rounded-[16px] bg-white/60 p-5"
    >
      <label className="text-[13px] font-medium text-ink">
        Name*
        <input name="name" required maxLength={120} autoComplete="name" className={`mt-1 ${inputCls}`} />
      </label>
      <label className="text-[13px] font-medium text-ink">
        E-Mail (für die Eingangsbestätigung)*
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          inputMode="email"
          className={`mt-1 ${inputCls}`}
        />
      </label>
      <label className="text-[13px] font-medium text-ink">
        Bestell-/Vertragskennung* (z. B. Bestellnummer oder deine Konto-E-Mail)
        <input name="contract" required maxLength={200} className={`mt-1 ${inputCls}`} />
      </label>
      <label className="text-[13px] font-medium text-ink">
        Anschrift (optional)
        <input name="address" maxLength={300} autoComplete="street-address" className={`mt-1 ${inputCls}`} />
      </label>
      <label className="text-[13px] font-medium text-ink">
        Bestellt/erhalten am (optional)
        <input name="orderDate" maxLength={60} placeholder="TT.MM.JJJJ" className={`mt-1 ${inputCls}`} />
      </label>
      <label className="text-[13px] font-medium text-ink">
        Nachricht (optional)
        <textarea name="note" maxLength={1000} rows={2} className={`mt-1 ${inputCls}`} />
      </label>

      {captchaOn && (
        <>
          <input type="hidden" name="cf-turnstile-response" value={captchaToken} />
          <TurnstileWidget
            key={captchaKey}
            siteKey={TURNSTILE_SITE_KEY!}
            onToken={(tok) => {
              setCaptchaToken(tok);
              if (tok) setCaptchaFailed(false);
            }}
            onError={() => setCaptchaFailed(true)}
          />
        </>
      )}

      {state?.error && (
        <p className="text-[13px] text-accent">{ERRORS[state.error] ?? "Das hat nicht geklappt. Bitte nochmal versuchen."}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        aria-busy={busy}
        className={`inline-flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-[15px] font-semibold text-white transition active:scale-[0.98] ${
          busy ? "cursor-wait" : ""
        }`}
      >
        {busy && <Spinner />}
        {pending ? "Wird gesendet …" : checking ? "Roboter-Check … 🤖" : "Widerruf bestätigen"}
      </button>
      <p className="text-[12px] leading-snug text-muted">
        Mit „Widerruf bestätigen“ senden wir dir unverzüglich eine Eingangsbestätigung per E-Mail.
      </p>
    </form>
  );
}
