import { NextResponse } from "next/server";
import type { EmailOtpType, SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { claimVerifiedLogin } from "@/lib/pro-purchase";
import { logOps, subjectFromRequest } from "@/lib/ops";
import { safeLocale } from "@/i18n/locales";
import { AUTH_ERROR_PARAM, CONFIRM_PATH, OTP_TYPES } from "@/lib/auth-link";

// Rücksprung nach der Anmeldung: Nachweis gegen Sitzung tauschen, dann weiterleiten.
//
// ZWEI SORTEN NACHWEIS KOMMEN HIER AN, auf zwei verschiedenen Wegen:
//
//   `token_hash` + `type` — unsere eigene Anmelde-Mail (lib/login-link.ts). Wird NUR per
//       POST eingelöst, also erst, wenn ein Mensch auf der Bestätigungsseite den Knopf
//       drückt (auth/confirm). Ein GET mit token_hash wird dorthin umgeleitet.
//   `code` — der PKCE-Weg (Google-Login, Supabases eigene Notausgang-Mail). Per GET wie
//       bisher: Google leitet direkt hierher, und der Code allein nützt niemandem, der den
//       PKCE-Schlüssel aus dem Cookie des Browsers nicht hat.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
//  WARUM DER MAIL-LINK NICHT MEHR SELBST ANMELDET
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Am 18.10.2026 kam ein Alt-Käufer mit Hotmail-Adresse nicht in sein Konto, fünf Versuche
// in vier Minuten, jeder mit „Email link is invalid or has expired". In Supabase stand
// dabei: Konto bestätigt um 18:55:35.7, unser Fehler um 18:55:37.6; letzte Anmeldung um
// 18:58:40.6, unser Fehler um 18:58:42.0. Jedes Mal hatte JEMAND den Link 1,5 Sekunden vor
// dem Menschen erfolgreich eingelöst.
//
// Das war Microsoft. Outlook/Hotmail (Safe Links, Defender) ruft jeden Link in einer Mail
// selbst auf, bevor oder während es den Menschen weiterlässt. Andere Postfächer mit
// Link-Prüfung (Firmen-Mailfilter, manche Virenscanner) tun dasselbe. Ein Anmeldelink ist
// einmalig: Der Prüfer verbraucht ihn, der Mensch bekommt „abgelaufen". Hotmail ist kein
// Randfall, sondern ein grosser Teil gerade der älteren Käufer von der WordPress-Seite.
//
// Die Prüfer laden Seiten (GET), sie drücken aber keine Knöpfe und schicken keine Formulare
// ab. Deshalb: GET zeigt nur, POST löst ein. Das kostet einen Tipp mehr und ist der Weg,
// den Supabase selbst für genau dieses Problem empfiehlt. NIE per JavaScript automatisch
// abschicken: Manche Prüfer führen Skripte aus, dann wäre alles wie vorher.
//
// Der Rest (Newsletter, Sprache merken, geliehene Sitzungen kappen) ist für beide Wege
// gleich und steht deshalb in finishLogin(), nicht doppelt.

type Params = { params: Promise<{ locale: string }> };

/**
 * Wohin es nach dem Anmelden geht, gegen Open-Redirects geprüft.
 *
 * `next` gegen unsere Origin auflösen und die RESULTIERENDE Origin prüfen. So entscheidet
 * der WHATWG-Parser selbst — deckt "//evil", "/\evil", Tab/Newline-Tricks und absolute URLs
 * ab, ohne String-Raten. Nur wenn das Ziel exakt auf unserer Origin liegt, gilt der Pfad.
 *
 * Fallback auf die Karte, nicht auf „/": Dort liegt seit 07/2026 die Verkaufs-Startseite,
 * und wer sich gerade eingeloggt hat, ist kein neuer Besucher mehr. Betrifft nur den
 * blanken Magic-Link (LoginGate schickt immer ein `next` mit).
 */
function safeNextPath(rawNext: string | null, origin: string, locale: string): string {
  const fallback = `/${locale}/explore`;
  try {
    const u = new URL(rawNext ?? fallback, origin);
    if (u.origin === origin) return u.pathname + u.search;
  } catch {
    /* ungültig -> fallback */
  }
  return fallback;
}

/** Die Art kommt von aussen. Gegen die bekannte Liste prüfen statt roh an die Auth-API. */
function safeOtpType(raw: string | null): EmailOtpType | undefined {
  return OTP_TYPES.find((t) => t === raw);
}

/**
 * Kommt dieses Formular von unserer eigenen Seite?
 *
 * Schutz gegen Login-CSRF: Eine fremde Seite könnte sonst ein Formular mit IHREM
 * token_hash an uns schicken und den Besucher unbemerkt in ein fremdes Konto setzen (dessen
 * Merkliste er dann füllt, in das er dann zahlt). Browser schicken bei Formularen `Origin`
 * mit; fehlt es, sagt `Sec-Fetch-Site` dasselbe. Fehlt beides (sehr alter Browser), lassen
 * wir durch: Ein Login, der dort scheitert, ist der grössere Schaden als ein Angriff, den
 * es so praktisch nicht gibt.
 *
 * `Origin: null` heisst NICHT „fremd", sondern „verschwiegen": Der Browser schickt es so,
 * wenn die Seite eine strenge Referrer-Regel hat (no-referrer), aus Datenschutzgründen und
 * mancher In-App-Browser von sich aus. Am 18.10.2026 stand genau das auf auth/confirm, und
 * diese Prüfung hat ab dem Deploy JEDE Anmeldung per Mail abgelehnt. Bei `null` deshalb
 * auf Sec-Fetch-Site ausweichen, das der Browser unabhängig von der Referrer-Regel setzt.
 */
function isSameOrigin(request: Request, origin: string): boolean {
  const o = request.headers.get("origin");
  if (o && o !== "null") return o === origin;
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  return true;
}

export async function GET(request: Request, { params }: Params) {
  const { searchParams, origin } = new URL(request.url);
  const { locale } = await params;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const otpType = safeOtpType(searchParams.get("type"));
  const nextPath = safeNextPath(searchParams.get("next"), origin, locale);

  // Mail-Link, per GET: nicht einlösen, nur zur Bestätigungsseite weiterreichen. Kommt vor
  // von Mails, die vor diesem Umbau verschickt wurden (ihr Link zeigt noch hierher), und von
  // Supabases Notausgang-Mail, falls deren Vorlage auf {{ .TokenHash }} umgestellt ist.
  // Die Parameter gehen unverändert mit, geprüft wird beim Einlösen.
  if (tokenHash && otpType) {
    const confirm = new URL(`/${locale}/${CONFIRM_PATH}`, origin);
    for (const key of ["token_hash", "type", "next", "nl"]) {
      const v = searchParams.get(key);
      if (v !== null) confirm.searchParams.set(key, v);
    }
    return NextResponse.redirect(confirm, 303);
  }

  let verifyError: string | null = null;
  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      await finishLogin(supabase, data.user, locale, searchParams.get("nl") === "1");
      return NextResponse.redirect(new URL(nextPath, origin), 303);
    }
    verifyError = error?.message ?? null;
  }

  return fail(request, {
    locale,
    origin,
    nextPath,
    verifyError,
    linkart: tokenHash ? "unbekannt" : code ? "pkce" : "keiner",
  });
}

export async function POST(request: Request, { params }: Params) {
  const { origin } = new URL(request.url);
  const { locale } = await params;
  const form = await request.formData().catch(() => null);
  const field = (k: string) => {
    const v = form?.get(k);
    return typeof v === "string" ? v : null;
  };
  const tokenHash = field("token_hash");
  const otpType = safeOtpType(field("type"));
  const nextPath = safeNextPath(field("next"), origin, locale);

  if (!isSameOrigin(request, origin)) {
    return fail(request, {
      locale,
      origin,
      nextPath,
      verifyError: "Formular von fremder Herkunft",
      linkart: otpType ?? "unbekannt",
    });
  }

  let verifyError: string | null = null;
  if (tokenHash && otpType) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({
      type: otpType,
      token_hash: tokenHash,
    });
    if (!error && data.user) {
      await finishLogin(supabase, data.user, locale, field("nl") === "1");
      return NextResponse.redirect(new URL(nextPath, origin), 303);
    }
    verifyError = error?.message ?? null;
  }

  return fail(request, {
    locale,
    origin,
    nextPath,
    verifyError,
    linkart: tokenHash ? (otpType ?? "unbekannt") : "keiner",
  });
}

/** Alles, was nach einer gelungenen Anmeldung passiert. Für beide Wege gleich. */
async function finishLogin(
  supabase: SupabaseClient,
  user: User,
  locale: string,
  newsletter: boolean,
) {
  // Die Sprache merken, in der sich dieser Mensch anmeldet.
  //
  // WOZU: Es ist der einzige verlässliche Zeitpunkt, an dem wir Konto UND Sprache
  // gleichzeitig in der Hand haben. Jede spätere Mail (Kaufbestätigung, geschenktes Pro)
  // entsteht ohne offene Seite und ohne Sprache in der Adresse — der Stripe-Webhook
  // kommt von Stripes Servern, der Admin-Klick vom Schreibtisch in Salzburg. Ohne diesen
  // Vermerk stünde `profiles.locale` für immer auf dem Standard 'de', und ein Koreaner
  // bekäme deutsche Post.
  //
  // Ein Fehler hier darf den Login NICHT aufhalten: Wer sich anmeldet, kommt herein, auch
  // wenn der Vermerk danebengeht. Dann ist die nächste Mail in der falschen Sprache, und
  // das ist deutlich billiger als eine gescheiterte Anmeldung.
  try {
    await supabase
      .from("profiles")
      .update({ locale: safeLocale(locale) })
      .eq("id", user.id);
  } catch (e) {
    console.error("locale merken:", e instanceof Error ? e.message : e);
  }

  // Newsletter-Einwilligung einlösen (`nl=1` hat der Login an diesen Link gehängt).
  //
  // WARUM ERST HIER: Das Häkchen im Formular ist eine Behauptung („mir gehört diese
  // Adresse"), der Klick auf den Link in DIESEM Postfach ist der Beweis. Erst beide
  // zusammen ergeben eine nachweisbare Einwilligung (Art. 7 Abs. 1 DSGVO, § 174 TKG).
  // Wer eine fremde Adresse einträgt, kommt hier nie an — genau das ist der Sinn.
  //
  // Nur von „nein" auf „ja": Das `.eq("newsletter_opt_in", false)` ist die halbe Miete.
  // Ohne das überschriebe jeder spätere Login den Zeitpunkt der Einwilligung, und der
  // Nachweis „seit wann" wäre wertlos.
  //
  // Ein Fehler hier darf den Login NICHT aufhalten: Wer sich anmeldet, kommt herein,
  // auch wenn das Häkchen verloren geht. Deshalb try/catch ohne Konsequenz.
  if (newsletter) {
    try {
      await supabase
        .from("profiles")
        .update({ newsletter_opt_in: true, newsletter_opt_in_at: new Date().toISOString() })
        .eq("id", user.id)
        .eq("newsletter_opt_in", false);
    } catch (e) {
      console.error("newsletter opt-in:", e instanceof Error ? e.message : e);
    }
  }

  // Geliehene Sitzungen aus einem Gast-Kauf kappen.
  //
  // Wer als Gast kauft, bekommt sofort eine Sitzung, ohne sein Postfach bewiesen zu
  // haben — der Nachweis war das Cookie aus dem Checkout (siehe pro/aktivieren). Das ist
  // der richtige Tausch, hat aber eine offene Kante: Wer an Stripes Kasse eine fremde
  // Adresse eintippt, sitzt danach in einem Konto, das diese fremde Adresse trägt.
  //
  // HIER wird das Postfach bewiesen — anders kommt niemand durch diese Route. Ab jetzt
  // gilt nur noch diese Sitzung, alle älteren fliegen raus. Für den Käufer selbst ist
  // das unsichtbar: Seine neue Sitzung ist die, die bleibt.
  if (await claimVerifiedLogin(user.id)) {
    try {
      // scope "others" lässt die gerade entstandene Sitzung ausdrücklich stehen.
      await supabase.auth.signOut({ scope: "others" });
    } catch (e) {
      // Ein Login darf hieran nicht scheitern.
      console.error("signOut(others):", e instanceof Error ? e.message : e);
    }
  }

  // Der Login bringt den Menschen danach nur noch dorthin, wo er hinwollte.
  //
  // Die einmalige Begrüssung "dein Pro ist da" hing bis 0044 hier: Wer als Alt-Käufer
  // hereinkam, wurde aufs Profil umgeleitet und in derselben Bewegung als informiert
  // markiert — auch wenn er den Gruss nie zu Gesicht bekam. Jetzt entscheidet ein Zustand
  // in der Datenbank, und ProNotice zeigt den Gruss dort, wo der Mensch gerade ist (siehe
  // lib/pro-notice-actions.ts). Persönliches erst NACH dem Login, nie davor, sonst wäre
  // es ein Orakel für fremde Adressen (Migration 0041).
}

/**
 * Hier landet jeder, dessen Anmeldung nicht durchging.
 *
 * EINZELN IST DAS ALLTAG und kein Fehler: ein Link von gestern, ein zweiter Tipp auf
 * denselben Knopf (Supabase löst jeden Nachweis nur einmal ein). Deshalb steht die Schwelle
 * im Katalog bei fünf, nicht bei eins.
 *
 * ALS WELLE ist es der Ausfall, den man am spätesten bemerkt und am teuersten bezahlt:
 * Niemand kommt mehr herein, und niemand beschwert sich, weil man sich beim Anbieter, bei
 * dem man nicht einloggen kann, auch nicht beschweren kann. Genau dieses Muster meint
 * OWASP A09 mit „alert on auth failure spikes".
 *
 * Der Nachweis selbst (token_hash/code) darf NICHT ins Log: Wer ihn dort findet, ist
 * eingeloggt. Gemeldet wird nur, WELCHE Art Link es war und WAS Supabase gesagt hat.
 */
async function fail(
  request: Request,
  f: { locale: string; origin: string; nextPath: string; verifyError: string | null; linkart: string },
) {
  // Schon angemeldet? Dann war es der zweite Tipp auf denselben Link oder Knopf, und der
  // Mensch ist längst drin. Kein Fehler für ihn, und keiner fürs Logbuch.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return NextResponse.redirect(new URL(f.nextPath, f.origin), 303);

  await logOps("auth_callback_failed", {
    message: f.verifyError
      ? `Anmeldung abgelehnt: ${f.verifyError}`
      : "Rücksprung ohne verwertbaren Nachweis.",
    path: `/${f.locale}/auth/callback`,
    subject: subjectFromRequest(request),
    group: `auth:callback:${f.verifyError ?? "kein_nachweis"}`,
    detail: { linkart: f.linkart },
  });

  // Aufs Login, nicht aufs Ziel. Bis 10/2026 ging es mit `?auth_error=1` zurück aufs Ziel,
  // meist die Karte, und dort liest niemand diesen Parameter: Der Mensch stand ohne ein Wort
  // auf der Karte, nicht angemeldet, und wusste nicht, warum. Das Login zeigt den Grund und
  // hat das Feld für den neuen Link gleich darunter. `next` reist mit, damit es nach dem
  // zweiten Anlauf dorthin geht, wo der erste hinwollte.
  const errUrl = new URL(`/${f.locale}/profil`, f.origin);
  errUrl.searchParams.set(AUTH_ERROR_PARAM, f.linkart === "pkce" ? "1" : "link");
  errUrl.searchParams.set("next", f.nextPath);
  return NextResponse.redirect(errUrl, 303);
}
