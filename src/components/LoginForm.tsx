"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  sendMagicLink,
  signInWithGoogle,
  type MagicLinkState,
} from "@/app/[locale]/profil/actions";
import TurnstileWidget from "@/components/TurnstileWidget";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

// Feiner iOS-2026-Spinner: dünner Ring + rotierender Bogen mit runden Enden (erbt die
// Button-Textfarbe). Kein Layout-Ruck durch feste Größe.
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

// Mehrfarbiges Google-„G" (offizielle Markenfarben), inline -> keine externe Ressource (CSP).
function GoogleIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 18 18" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

export default function LoginForm({
  next,
  authError = false,
}: { next?: string; authError?: boolean } = {}) {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const [state, formAction, pending] = useActionState<MagicLinkState, FormData>(
    sendMagicLink,
    null,
  );

  // Turnstile-Bot-Schutz: nur aktiv, wenn ein Site-Key gesetzt ist (sonst degradiert es
  // sauber, Login funktioniert lokal ohne Keys). Token wird für den Server mitgesendet.
  const captchaOn = !!TURNSTILE_SITE_KEY;
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);
  const [captchaFailed, setCaptchaFailed] = useState(false);
  // Widget bei Captcha-Fehler neu aufsetzen (Token ist einmalig) -> frische Challenge.
  // React-Muster „State beim Rendern anpassen" (kein Effect nötig).
  const [seenError, setSeenError] = useState<string | undefined>(undefined);
  if (state?.error !== seenError) {
    setSeenError(state?.error);
    if (state?.error === "captcha") {
      setCaptchaToken("");
      setCaptchaKey((k) => k + 1);
    }
  }

  function handleCaptchaToken(tok: string) {
    setCaptchaToken(tok);
    if (tok) setCaptchaFailed(false); // erfolgreicher (auch stiller) Pass -> Fehler weg
  }

  // Button ist NIE „tot": Klickt jemand, bevor der Roboter-Check fertig ist, halten wir das
  // Abschicken kurz zurück (formRef), zeigen einen Lade-Hinweis und schicken automatisch ab,
  // sobald das Token da ist. Sicherheit bleibt: ohne gültiges Token blockt der Server ohnehin.
  const formRef = useRef<HTMLFormElement>(null);
  const [awaitingCaptcha, setAwaitingCaptcha] = useState(false);

  useEffect(() => {
    // Token ist eingetroffen, während wir auf den Check gewartet haben -> jetzt abschicken.
    if (awaitingCaptcha && captchaToken) formRef.current?.requestSubmit();
  }, [awaitingCaptcha, captchaToken]);

  // Zeigt der Button gerade „arbeitet"? (Roboter-Check läuft nach einem frühen Klick.)
  const checking = awaitingCaptcha && !captchaToken && !captchaFailed;
  const busy = pending || checking;

  if (state?.ok) {
    return (
      <div className="rounded-[18px] bg-white p-5 text-center shadow-sm">
        <p className="text-2xl" aria-hidden>
          📧
        </p>
        <p className="mt-2 text-[15px] font-medium text-ink">{t("sentTitle")}</p>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">{t("sentBody")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {authError && (
        <p className="rounded-[14px] bg-accent/10 px-4 py-3 text-[13px] leading-snug text-accent">
          {t("error")}
        </p>
      )}

      {/* Google zuerst: 1 Klick, kein E-Mail-Warten -> conversion-stärker. */}
      <form action={signInWithGoogle}>
        <input type="hidden" name="locale" value={locale} />
        {next && <input type="hidden" name="next" value={next} />}
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2.5 rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-semibold text-ink shadow-sm transition active:scale-[0.98]"
        >
          <GoogleIcon className="h-[18px] w-[18px]" />
          {t("googleCta")}
        </button>
      </form>

      {/* Trenner ohne Hintergrund-Trick -> passt auf Creme UND Weiß */}
      <div className="flex items-center gap-3 py-0.5 text-[12px] text-muted">
        <span className="h-px flex-1 bg-black/10" />
        {t("or")}
        <span className="h-px flex-1 bg-black/10" />
      </div>

      <form
        ref={formRef}
        action={formAction}
        onSubmit={(e) => {
          // Noch kein Token (Check läuft) -> Absenden zurückhalten und auf Token warten.
          // Ausnahme: Check ist fehlgeschlagen -> durchlassen, der Server meldet's sauber.
          if (captchaOn && !captchaToken && !captchaFailed) {
            e.preventDefault();
            setAwaitingCaptcha(true);
          } else if (awaitingCaptcha) {
            setAwaitingCaptcha(false); // wir fahren fort -> kein erneutes Auto-Submit
          }
        }}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="locale" value={locale} />
        {next && <input type="hidden" name="next" value={next} />}
        <input
          type="email"
          name="email"
          required
          maxLength={254}
          autoComplete="email"
          inputMode="email"
          placeholder={t("emailPlaceholder")}
          className="w-full rounded-[14px] border border-black/10 bg-white px-4 py-3 text-[15px] text-ink outline-none focus:border-accent"
        />
        <label className="flex items-start gap-2.5 px-1 text-[13px] leading-snug text-muted">
          <input
            type="checkbox"
            name="newsletter"
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#cc2924]"
          />
          <span>{t("newsletter")}</span>
        </label>

        {/* Bot-Schutz: Token als Hidden-Field an die Server-Action; Widget läuft (bei
            interaction-only meist unsichtbar) still im Hintergrund. */}
        {captchaOn && (
          <>
            <input type="hidden" name="cf-turnstile-response" value={captchaToken} />
            <TurnstileWidget
              key={captchaKey}
              siteKey={TURNSTILE_SITE_KEY!}
              onToken={handleCaptchaToken}
              onError={() => setCaptchaFailed(true)}
            />
          </>
        )}

        {state?.error && (
          <p className="px-1 text-[13px] text-accent">
            {state.error === "captcha" ? t("captchaError") : t("error")}
          </p>
        )}
        {/* Nie „tot": immer voll klickbar. Bei frühem Klick zeigt er den Roboter-Check und
            schickt automatisch ab, sobald das Token da ist. Nur beim aktiven Senden gesperrt
            (kein Doppel-Submit). */}
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
        <p className="px-1 text-[11px] leading-snug text-muted">
          {t.rich("legalHint", {
            terms: (c) => (
              <Link href="/rechtliches/agb" className="underline">
                {c}
              </Link>
            ),
            privacy: (c) => (
              <Link href="/rechtliches/datenschutz" className="underline">
                {c}
              </Link>
            ),
          })}
        </p>
      </form>
    </div>
  );
}
