"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import TurnstileWidget from "@/components/TurnstileWidget";
import { submitSupportRequest, type SupportState } from "@/lib/support-actions";

// Kontaktformular. Turnstile-Handhabung bewusst identisch zu WithdrawalForm und LoginForm:
// Der Knopf ist NIE tot — klickt jemand, bevor der Roboter-Check fertig ist, halten wir das
// Abschicken kurz zurück und senden automatisch, sobald das Token da ist. Die Sicherheit
// liegt nicht hier: Ohne gültiges Token blockt der Server ohnehin.
//
// Anders als beim Widerruf sind die Texte übersetzt. Der Widerruf ist ein rechtsverbindlicher
// Text (deshalb dort bewusst nur Deutsch, mit übersetztem Hinweis) — ein Kontaktformular ist
// das Gegenteil: Wer nicht weiterkommt, muss uns in SEINER Sprache erreichen können.

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

function Spinner() {
  return (
    <svg className="h-[18px] w-[18px] shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
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

const inputCls =
  "w-full rounded-[14px] border border-black/10 bg-white px-4 py-3 text-[15px] text-ink outline-none focus:border-accent";

export default function SupportForm({ defaultEmail }: { defaultEmail?: string }) {
  const t = useTranslations("Support");
  const locale = useLocale();
  const [state, formAction, pending] = useActionState<SupportState, FormData>(
    submitSupportRequest,
    null,
  );

  const captchaOn = !!TURNSTILE_SITE_KEY;
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);
  const [captchaFailed, setCaptchaFailed] = useState(false);

  // Widget nach einem Captcha-Fehler neu aufsetzen (Token ist einmalig).
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
  useEffect(() => {
    if (awaitingCaptcha && captchaToken) formRef.current?.requestSubmit();
  }, [awaitingCaptcha, captchaToken]);

  const checking = awaitingCaptcha && !captchaToken && !captchaFailed;
  const busy = pending || checking;

  if (state?.ok) {
    return (
      <div className="rounded-[16px] bg-accent/[0.06] p-5 text-center">
        <p className="text-2xl" aria-hidden>
          ✅
        </p>
        <p className="mt-2 text-[15px] font-semibold text-ink">{t("sentTitle")}</p>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">{t("sentBody")}</p>
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
      className="flex flex-col gap-3 rounded-[16px] bg-white p-5 shadow-sm"
    >
      {/* Die Sprache mitschicken: Sie verrät im Admin, worin geantwortet werden muss.
          Der Server nimmt sie nur an, wenn sie eine echte Sprache ist. */}
      <input type="hidden" name="locale" value={locale} />

      <label className="text-[13px] font-medium text-ink">
        {t("name")}
        <input name="name" maxLength={120} autoComplete="name" className={`mt-1 ${inputCls}`} />
      </label>

      <label className="text-[13px] font-medium text-ink">
        {t("email")}*
        <input
          type="email"
          name="email"
          required
          maxLength={254}
          autoComplete="email"
          defaultValue={defaultEmail}
          className={`mt-1 ${inputCls}`}
        />
      </label>

      <label className="text-[13px] font-medium text-ink">
        {t("message")}*
        <textarea
          name="message"
          required
          minLength={10}
          maxLength={4000}
          rows={6}
          placeholder={t("messagePlaceholder")}
          className={`mt-1 ${inputCls} resize-y`}
        />
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
        <p className="px-1 text-[13px] text-accent">
          {t.has(`error.${state.error}`) ? t(`error.${state.error}`) : t("error.generic")}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        aria-busy={busy}
        className={`flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white transition active:scale-[0.98] ${
          busy ? "cursor-wait" : ""
        }`}
      >
        {busy && <Spinner />}
        {pending ? t("sending") : checking ? t("preparing") : t("submit")}
      </button>

      {captchaFailed && (
        <p className="px-1 text-[12px] leading-snug text-muted">{t("captchaUnavailable")}</p>
      )}
      <p className="px-1 text-[11px] leading-snug text-muted">{t("privacyHint")}</p>
    </form>
  );
}
