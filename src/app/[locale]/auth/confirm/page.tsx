import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AUTH_ERROR_PARAM, OTP_TYPES } from "@/lib/auth-link";

// Hier landet der Link aus der Anmelde-Mail. Die Seite meldet NICHT an, sie zeigt einen
// Knopf, und erst der schickt den Nachweis per POST an auth/callback.
//
// Warum der Umweg: Outlook/Hotmail und andere Mail-Prüfer rufen jeden Link selbst auf und
// verbrauchten damit den einmaligen Anmeldelink, bevor der Mensch ihn öffnen konnte. Prüfer
// laden Seiten, sie drücken keine Knöpfe. Die ganze Geschichte steht in auth/callback/route.ts.
//
// BEWUSST OHNE JAVASCRIPT: ein nacktes <form>. Kein automatisches Abschicken, auch nicht
// „nach einer Sekunde": Manche Prüfer führen Skripte aus, dann wäre alles wie vorher.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return {
    title: t("confirmCta"),
    robots: { index: false, follow: false },
    // Der Nachweis steht in der Adresse. Kein Referer, nirgendwohin.
    referrer: "no-referrer",
  };
}

export default async function AuthConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string; nl?: string }>;
}) {
  const { locale } = await params;
  const { token_hash: tokenHash, type, next, nl } = await searchParams;
  setRequestLocale(locale);

  // Ohne verwertbaren Nachweis gibt es nichts zu bestätigen. Dann gleich aufs Login mit
  // dem Satz „Link abgelaufen", statt einen Knopf zu zeigen, der sicher scheitert.
  if (typeof tokenHash !== "string" || !OTP_TYPES.some((t) => t === type)) {
    redirect(`/${locale}/profil?${AUTH_ERROR_PARAM}=link`);
  }

  const t = await getTranslations("Auth");

  // Gleicher Aufbau wie der Verschickt-Screen im Login (Emoji, Überschrift, ein Satz), dann
  // der eine Knopf. Wer gerade „Schau in dein Postfach" gesehen hat, erkennt die Form wieder.
  return (
    <div className="mx-auto flex w-full max-w-[380px] flex-col items-center px-5 pb-10 pt-[calc(var(--sg-page-top)+32px)] text-center md:pt-16">
      <span
        className="grid h-16 w-16 place-items-center rounded-full bg-accent/10 text-[30px]"
        aria-hidden
      >
        🔑
      </span>
      <h1 className="mt-4 text-[22px] font-bold leading-tight tracking-tight text-ink">
        {t("confirmTitle")}
      </h1>
      <p className="mt-1.5 max-w-[19rem] text-[15px] leading-relaxed text-muted">
        {t("confirmBody")}
      </p>

      {/* Werte unverändert weiterreichen. Geprüft wird beim Einlösen (route.ts), nicht hier:
          eine Prüfstelle, nicht zwei. */}
      <form method="post" action={`/${locale}/auth/callback`} className="mt-7 w-full">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        {typeof next === "string" && <input type="hidden" name="next" value={next} />}
        {nl === "1" && <input type="hidden" name="nl" value="1" />}
        <button
          type="submit"
          className="sg-hit w-full cursor-pointer rounded-full bg-accent px-6 py-3.5 text-[15px] font-semibold text-white shadow-[0_10px_24px_-10px_rgba(204,41,36,0.55)] transition active:scale-[0.98]"
        >
          {t("confirmCta")}
        </button>
      </form>
    </div>
  );
}
