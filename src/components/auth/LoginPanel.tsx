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
import { Spinner } from "@/components/Busy";
import { BookmarkFilled } from "@/components/icons";
import { LOGIN_EMOJI, isPaidReason, type LoginReason } from "./loginReasons";

// ═══════════════════════════════════════════════════════════════════════════════
//  DER Login-Screen. Einer. Für alle vier Stellen.
// ═══════════════════════════════════════════════════════════════════════════════
//
// /profil, /gespeichert, der Pro-Kauf und das Login-Gate hatten vorher je eigene
// Überschriften, eigene Erklärtexte und eigene Abstände. Wer sich über das Gate anmeldete,
// las dieselbe Sache dreimal hintereinander in drei Formulierungen. Jetzt gibt es eine
// Form, und der Anlass wechselt nur Emoji und Überschrift (siehe loginReasons.ts).
//
// AUFBAU, und die Reihenfolge ist Absicht:
//
//   ( Emoji )        <- gross, zeigt worum es geht, keine Schriftgrösse
//   Überschrift      <- was du bekommst
//   Kostenlos, ohne Passwort.   <- der EINE Satz, der die zwei Fragen beantwortet,
//                                  an denen Anmeldungen scheitern
//   [Weiter mit Google]
//   ── oder ──
//   [E-Mail]
//   ☐ Newsletter     <- freiwillig, entkoppelt, nicht vorangehakt
//   [Anmelden]
//   Kleingedrucktes
//
// Nichts davon erklärt sich selbst zweimal. Das Formular sagt durch seine Felder, was es
// will; deshalb steht darüber kein Absatz mehr, der dasselbe in Prosa wiederholt.

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

// Eingabefeld-Schrift: 16px, und das ist keine Geschmacksfrage. Safari auf dem iPhone
// zoomt die ganze Seite hinein, sobald ein fokussiertes Feld kleiner als 16px schreibt.
// Vorher stand hier 15px — der Login sprang beim Antippen des E-Mail-Felds also jedes Mal
// auf und blieb verschoben stehen. Der übliche "Gegengift"-Trick (maximum-scale=1 im
// Viewport) kommt nicht in Frage: der sperrt das Zoomen für alle, die es brauchen.
const FIELD =
  "w-full rounded-[14px] border border-black/10 bg-white px-4 py-3.5 text-[16px] text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10";

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

/**
 * Das Zeichen im Kreis über der Überschrift.
 *
 * Fast überall ein Emoji (siehe loginReasons.ts). Die Merkliste macht die eine Ausnahme:
 * Sie trägt das Lesezeichen, das die App ohnehin schon für „gemerkt" zeichnet — als
 * Merken-Knopf auf jedem Spot und jedem Event und als Symbol in der unteren Leiste. Ein
 * Emoji-Lesezeichen daneben wäre dieselbe Sache in zwei Formen; wer es sähe, müsste kurz
 * überlegen, ob zwei verschiedene Dinge gemeint sind.
 *
 * Gefüllt statt Umriss: Im Kreis steht ein Symbol, kein Knopf. Der Umriss ist in dieser App
 * der UNgemerkte Zustand — hier wäre er die falsche Aussage.
 */
function ReasonSymbol({ reason }: { reason: LoginReason }) {
  if (reason === "saved") return <BookmarkFilled className="h-7 w-7 text-accent" />;
  return <span className="text-[30px] leading-none">{LOGIN_EMOJI[reason]}</span>;
}

/**
 * Kopf des Login-Screens: Zeichen, Überschrift, EIN Untertitel.
 *
 * Auch vom Login-Gate benutzt (das Sheet zeigt denselben Kopf und darunter nur einen
 * Knopf) — deshalb exportiert. So sieht der Weg "Spot merken antippen -> Sheet -> Login"
 * wie ein Weg aus und nicht wie zwei Seiten, die dasselbe fragen.
 */
export function LoginHeader({
  reason,
  as: Tag = "h2",
}: {
  reason: LoginReason;
  as?: "h1" | "h2";
}) {
  const t = useTranslations("Auth");
  return (
    <div className="flex flex-col items-center text-center">
      <span
        className="grid h-16 w-16 place-items-center rounded-full bg-accent/10"
        aria-hidden
      >
        <ReasonSymbol reason={reason} />
      </span>
      <Tag className="mt-4 text-[22px] font-bold leading-tight tracking-tight text-ink">
        {t(`reasonTitle.${reason}`)}
      </Tag>
      {/* Der eine Satz, der über die Anmeldung entscheidet. "Kostet das was?" und "muss
          ich mir wieder ein Passwort merken?" sind die zwei Gründe, aus denen Leute an
          dieser Stelle abbrechen. Beide hier beantwortet, bevor sie gestellt werden. */}
      <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
        {t(isPaidReason(reason) ? "subtitlePaid" : "subtitleFree")}
      </p>
    </div>
  );
}

type LoginPanelProps = {
  /** Woraus die Anmeldung entstanden ist -> Emoji + Überschrift. Siehe loginReasons.ts. */
  reason?: LoginReason;
  next?: string;
  authError?: boolean;
  /**
   * Den Umzugs-Hinweis zeigen (Admin-Einstellung `relaunch_notice`).
   *
   * Für ALLE gleich, bewusst OHNE Prüfung der eingegebenen E-Mail: Ein Hinweis, der nur bei
   * Alt-Käufern erschiene, wäre ein Orakel — jeder könnte beliebige Adressen eintippen und
   * erführe „ist diese Person zahlender SalzGuide-Kunde?". Das wäre eine abfragbare
   * Kundenliste und eine perfekte Phishing-Vorlage. Der Login verrät heute nichts, und das
   * bleibt so.
   *
   * Default false: Wer es vergisst durchzureichen, zeigt einen Hinweis zu wenig statt einen
   * zu viel.
   */
  relaunchNotice?: boolean;
  /**
   * Ist Google in Supabase wirklich eingeschaltet? Kommt aus googleLoginEnabled()
   * (lib/auth-providers.ts) und MUSS von der Server-Komponente durchgereicht werden.
   *
   * Default false, weil das die sichere Richtung ist: Wer es vergisst, zeigt einen Knopf
   * zu wenig. Andersherum zeigte er einen, der auf Supabases JSON-Fehlerseite endet.
   */
  googleEnabled?: boolean;
  /** h1 auf eigenen Seiten, h2 wenn schon eine Überschrift darübersteht (Pro-Seite). */
  titleAs?: "h1" | "h2";
  className?: string;
};

/**
 * Der Login-Screen.
 *
 * Aussen sitzt nur ein Zähler. Er hat einen einzigen Zweck: „Adresse ändern" auf dem
 * Verschickt-Screen setzt das Formular komplett zurück, indem er die innere Komponente
 * über einen neuen `key` neu aufbaut. Ohne das gäbe es keinen Weg zurück — useActionState
 * behält sein Ergebnis, bis die Komponente verschwindet, und wer sich vertippt hatte, stand
 * bis zum nächsten Seitenwechsel vor einem Screen, der auf eine Mail wartet, die nie kommt.
 * (React nennt genau das „State über einen key zurücksetzen"; ein zweiter Zustand neben
 * useActionState liefe früher oder später auseinander.)
 */
export default function LoginPanel(props: LoginPanelProps = {}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <LoginPanelForm
      key={attempt}
      {...props}
      onRestart={() => setAttempt((a) => a + 1)}
    />
  );
}

function LoginPanelForm({
  reason = "default",
  next,
  authError = false,
  googleEnabled = false,
  relaunchNotice = false,
  titleAs = "h2",
  className = "",
  onRestart,
}: LoginPanelProps & { onRestart: () => void }) {
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
  // Fehler-Code aus dem Ergebnis herausschälen. Der Zustand ist bewusst eine Entweder-Oder-
  // Form (Erfolg MIT Adresse / Fehler MIT Code) — so kann es den halben Zustand
  // „ok und trotzdem ein Fehler" gar nicht geben.
  const err = state && !state.ok ? state.error : undefined;

  // Widget bei Captcha-Fehler neu aufsetzen (Token ist einmalig) -> frische Challenge.
  // React-Muster „State beim Rendern anpassen" (kein Effect nötig).
  const [seenError, setSeenError] = useState<string | undefined>(undefined);
  if (err !== seenError) {
    setSeenError(err);
    if (err === "captcha") {
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

  // ── Verschickt: derselbe Aufbau wie der Login selbst ──────────────────────────
  // Emoji, Überschrift, ein Satz. Der Screen wechselt den Inhalt, nicht die Form — man
  // sieht sofort, dass man weitergekommen ist, und muss sich nicht neu zurechtfinden.
  if (state?.ok) {
    return (
      <div className={`flex flex-col items-center text-center ${className}`}>
        <span
          className="grid h-16 w-16 place-items-center rounded-full bg-accent/10 text-[30px]"
          aria-hidden
        >
          ✉️
        </span>
        <h2 className="mt-4 text-[22px] font-bold leading-tight tracking-tight text-ink">
          {t("sentTitle")}
        </h2>
        {/* Die Adresse zurückzeigen beendet die häufigste Panik ("hab ich mich vertippt?")
            und deckt den Tippfehler auf, ohne dass jemand nochmal absenden muss. Kommt vom
            Server zurück, also exakt die Adresse, an die auch wirklich gesendet wurde. */}
        <p className="mt-1.5 max-w-[19rem] text-[15px] leading-relaxed text-muted">
          {t.rich("sentBody", {
            email: state.email,
            mail: (c) => <span className="font-semibold break-words text-ink">{c}</span>,
          })}
        </p>
        {/* Der Notausgang. Wer sich vertippt hat, sieht die falsche Adresse oben stehen und
            wartet sonst auf eine Mail, die nie ankommt — ohne Weg zurück, denn das Formular
            ist weg. Bewusst leise (kein zweiter roter Knopf): Für die Mehrheit, bei der
            alles stimmt, soll hier nichts um Aufmerksamkeit buhlen. */}
        <button
          type="button"
          onClick={onRestart}
          className="mt-5 rounded-full px-4 py-2 text-[13px] font-medium text-muted underline transition active:scale-[0.98]"
        >
          {t("changeEmail")}
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${className}`}>
      <LoginHeader reason={reason} as={titleAs} />

      {authError && (
        <p className="mt-5 rounded-[14px] bg-accent/10 px-4 py-3 text-center text-[13px] leading-snug text-accent">
          {t("error")}
        </p>
      )}

      {/* Umzugs-Hinweis. Emoji gross und links, Überschrift, ein Satz darunter — die
          iOS-Zeile mit Symbol. Vorher stand hier ein Fliesstext-Absatz, in dem die einzige
          wichtige Information ("dein Pro läuft weiter") in der Mitte begraben lag.
          Die Überschrift ist eine FRAGE an genau die Gruppe, die es angeht: Wer die alte
          Seite nie gesehen hat, liest "Schon länger dabei?", denkt "nein" und liest weiter.
          Warm statt grau: Das ist eine gute Nachricht, keine Warnung. Ein grauer Kasten
          liest sich wie Kleingedrucktes und wird überblättert. */}
      {relaunchNotice && (
        <div className="mt-6 flex items-start gap-3.5 rounded-[18px] bg-accent/[0.06] p-4 ring-1 ring-accent/10">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-[20px] shadow-sm"
            aria-hidden
          >
            💛
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold leading-snug text-ink">
              {t("relaunchTitle")}
            </p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
              {t("relaunchBody")}
            </p>
          </div>
        </div>
      )}

      {/* Google zuerst: 1 Klick, kein E-Mail-Warten -> conversion-stärker.
          Aber NUR, wenn der Anbieter in Supabase auch läuft: Sonst führt der bequemste
          Weg auf eine JSON-Fehlerseite (siehe lib/auth-providers.ts). Mit dem Knopf
          verschwindet auch der Trenner — „oder" ohne ein Davor ist keine Wahl. */}
      <div className="mt-7 flex flex-col gap-3">
        {googleEnabled && (
          <>
            <form action={signInWithGoogle}>
              <input type="hidden" name="locale" value={locale} />
              {next && <input type="hidden" name="next" value={next} />}
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2.5 rounded-full border border-black/10 bg-white px-5 py-3.5 text-[15px] font-semibold text-ink shadow-sm transition active:scale-[0.98]"
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
          </>
        )}

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
          {/* autoCapitalize/autoCorrect aus: iOS schreibt sonst „Deine@email.at" gross und
              korrigiert den Domain-Teil, und der Mensch sucht den Fehler bei sich. */}
          <input
            type="email"
            name="email"
            required
            maxLength={254}
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder={t("emailPlaceholder")}
            aria-label={t("emailLabel")}
            className={FIELD}
          />

          {/* ───────────────────────────────────────────────────────────────────────
              NEWSLETTER — die rechtlichen Regeln stehen hier, weil sie hier brechen.

              1. NICHT vorangehakt. Ein vorangehaktes Kästchen ist keine Einwilligung
                 (EuGH C-673/17 „Planet49"), und ein Widerruf wäre nie beweisbar.
              2. NICHT in die AGB und nicht in den Anmelde-Knopf. Art. 7 Abs. 2 DSGVO
                 verlangt, dass die Einwilligung von anderen Sachverhalten „klar
                 unterscheidbar" ist; eine gemeinsame AGB-und-Newsletter-Klausel ist
                 unwirksam. Und wer die Anmeldung an Werbung koppelt, verliert die
                 Freiwilligkeit (Art. 7 Abs. 4) — dann ist die Einwilligung nichts wert
                 UND das Konto steht auf wackeligem Grund.
              3. Der Satz muss selbst sagen, WER schreibt, WORÜBER und WIE man rauskommt
                 (§ 174 Abs. 1 TKG 2021 verlangt vorherige, jederzeit widerrufliche
                 Zustimmung). Deshalb steht „von SalzGuide" darin und nicht nur „Tipps".
              4. Gespeichert wird die Zustimmung erst, wenn der Link in der Mail geklickt
                 wurde (siehe actions.ts + auth/callback). Damit ist es ein echtes
                 Double-Opt-in: Wer fremde Adressen einträgt, erzeugt keine Einwilligung.

              „Ja, ..." statt „Ich möchte ...": Der Satz ist eine Antwort, keine Erklärung.
              ─────────────────────────────────────────────────────────────────────── */}
          {/* py-2 ist kein Abstand, sondern die Trefferfläche: Das Kästchen selbst misst
              18px, angefasst wird aber die ganze Zeile. Mit dem alten py-0.5 war sie 40px
              hoch und blieb damit unter den 44pt, die Apple für alles verlangt, was ein
              Finger treffen soll. Wer daneben tippt, hakt nichts an und merkt es nicht. */}
          <label className="flex cursor-pointer items-start gap-3 rounded-[14px] px-1 py-2 text-[13px] leading-snug text-muted">
            <input
              type="checkbox"
              name="newsletter"
              className="mt-px h-[18px] w-[18px] shrink-0 accent-[#cc2924]"
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

          {err && (
            <p className="px-1 text-[13px] leading-snug text-accent">
              {t(ERROR_KEY[err] ?? "error")}
            </p>
          )}

          {/* Nie „tot": immer voll klickbar. Bei frühem Klick zeigt er den Roboter-Check und
              schickt automatisch ab, sobald das Token da ist. Nur beim aktiven Senden gesperrt
              (kein Doppel-Submit). */}
          <button
            type="submit"
            disabled={pending}
            aria-busy={busy}
            className={`mt-1 flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-4 text-[16px] font-semibold text-white shadow-[0_10px_24px_-10px_rgba(204,41,36,0.55)] transition active:scale-[0.98] ${
              busy ? "cursor-wait" : ""
            }`}
          >
            {busy && <Spinner />}
            {pending ? t("sending") : checking ? t("preparing") : t("submit")}
          </button>

          {/* Ohne Google-Knopf darf hier NICHT „nutze den Google-Login oben" stehen: Das
              schickte die Leute auf einen Knopf, den es nicht gibt — der Notausgang wäre
              dann die zweite Sackgasse hinter der ersten. */}
          {captchaFailed && (
            <p className="px-1 text-center text-[12px] leading-snug text-muted">
              {t(googleEnabled ? "captchaUnavailableGoogle" : "captchaUnavailable")}
            </p>
          )}

          <p className="px-2 text-center text-[11px] leading-relaxed text-muted/90">
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
    </div>
  );
}

// Fehler-Code vom Server -> Textschlüssel. Der Server schickt nur noch diese Handvoll
// Codes (siehe actions.ts), nie mehr die rohe Supabase-Meldung. Unbekannt -> "error".
const ERROR_KEY: Record<string, string> = {
  captcha: "captchaError",
  email: "emailError",
  rate: "rateError",
  send: "error",
};
