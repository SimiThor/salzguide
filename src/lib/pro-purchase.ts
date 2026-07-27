import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type Stripe from "stripe";
import { createServiceClient } from "./supabase/service";
import { formatProPrice } from "./pro";
import { LEGAL } from "./legal";
import { sendEmail } from "./email";
import { logOps } from "./ops";
import { renderProPurchase } from "./pro-purchase-mail";
import { safeLocale } from "@/i18n/locales";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  DIE EINE STELLE, an der ein bezahlter Stripe-Kauf zu Pro wird.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Zwei Wege führen hierher, und das ist Absicht:
//
//   1. Der Rücksprung von Stripe (/[locale]/pro/aktivieren) — der schnelle Weg. Er läuft,
//      während der Mensch auf den Bildschirm schaut, und nur er kann ihn sofort einloggen.
//   2. Der Webhook (/api/stripe/webhook) — der verlässliche Weg. Er kommt auch an, wenn der
//      Tab zu ist, das Handy im Tunnel war oder die Zahlung erst Stunden später bestätigt
//      wird (SEPA, Klarna). Stripe stellt ihn bis zu drei Tage lang erneut zu.
//
// Beide rufen fulfillPaidCheckout() auf, und die ist idempotent: Der Primärschlüssel
// pro_purchases.stripe_session_id ist der Türsteher. Wer als Zweiter kommt, liest den
// Zustand, den der Erste hergestellt hat, statt ein zweites Mal freizuschalten.
//
// SICHERHEIT, die drei Regeln, die hier nicht verhandelbar sind:
//
//   Der BETRAG kommt nie von hier und nie vom Client, sondern aus der Stripe-Price-ID
//   (lib/stripe.ts). Diese Datei prüft nur, ob Stripe „paid" sagt.
//
//   Die E-MAIL AUS DEM CHECKOUT IST GETIPPT, NICHT BEWIESEN. Stripe verlangt sie, prüft
//   aber nicht, ob das Postfach dem Zahler gehört. Deshalb wird aus ihr NIE ein Einstieg
//   in ein Konto, das es schon gab (siehe „linked" unten) — sonst könnte man sich für den
//   Preis eines Pro-Zugangs in ein fremdes Konto kaufen.
//
//   FREISCHALTEN macht ausschliesslich der Service-Client. Der Spaltenschutz (Migration
//   0016/0045) lässt `is_pro` von einer normalen Sitzung ohnehin nicht schreiben.

/** Cookie mit dem Kauf-Nachweis. Klartext lebt nur im Browser des Käufers. */
export const PRO_CLAIM_COOKIE = "sg_buy";

/**
 * Wie lange der Nachweis gilt. Er IST das Zeitfenster für den Auto-Login: Läuft das Cookie
 * ab, gibt es keinen zweiten Faktor mehr, und der Rücksprung fällt auf den Weg per E-Mail
 * zurück. Zwei Stunden sind grosszügig für „bezahlen und zurückkommen" und kurz genug,
 * dass ein vergessenes Cookie auf einem geteilten Gerät nichts mehr aufmacht.
 */
export const PRO_CLAIM_MAX_AGE = 2 * 60 * 60;

/** Frischer Kauf-Nachweis für den Browser (nur er bekommt den Klartext). */
export function newClaimSecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Was in der Datenbank und in den Stripe-Metadaten landet: nur der Hash. Ein Blick in die
 * DB (oder ins Stripe-Dashboard) reicht damit nicht, um sich als der Browser auszugeben,
 * der bezahlt hat.
 */
export function hashClaim(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * Zwei Nachweise vergleichen, ohne über die Laufzeit zu verraten, wie weit man gekommen ist.
 * Bei einem 32-Byte-Zufallswert ist das Theorie, aber es kostet eine Zeile.
 */
export function claimMatches(secret: string | undefined, hash: string | null): boolean {
  if (!secret || !hash) return false;
  const a = hashClaim(secret);
  if (a.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

/**
 * Ergebnis der Freischaltung.
 *
 * `kind` sagt dem Rücksprung, welchen Bildschirm der Mensch als nächstes sieht:
 *
 *   member  — war beim Kauf eingeloggt. Pro ist da, es ist nichts mehr zu tun.
 *   created — das Konto ist DURCH diesen Kauf entstanden. Nur hier ist ein Auto-Login
 *             erlaubt, denn dieses Konto kann niemand anderem gehören.
 *   linked  — die Adresse hatte schon ein Konto. Pro liegt drauf, der Einstieg läuft über
 *             das Postfach. Bewusst KEIN Auto-Login: siehe Kopf dieser Datei.
 */
export type Fulfillment =
  | { ok: true; kind: "member"; userId: string; email: string }
  | { ok: true; kind: "linked"; email: string; userId: string | null }
  | {
      ok: true;
      kind: "created";
      email: string;
      userId: string;
      claimHash: string | null;
      autoLoginUsed: boolean;
    }
  | { ok: false; reason: "unpaid" | "no_email" | "error" };

type PurchaseRow = {
  stripe_session_id: string;
  email: string;
  stripe_customer_id: string | null;
  user_id: string | null;
  granted_at: string | null;
  account_created: boolean;
  claim_hash: string | null;
  auto_login_at: string | null;
};

const PURCHASE_COLUMNS =
  "stripe_session_id, email, stripe_customer_id, user_id, granted_at, account_created, claim_hash, auto_login_at";

/** Kunden-ID aus einem Stripe-Objekt schälen (String oder aufgelöstes Objekt). */
function customerIdOf(customer: Stripe.Checkout.Session["customer"]): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

function paymentIntentOf(session: Stripe.Checkout.Session): string | null {
  const pi = session.payment_intent;
  if (!pi) return null;
  return typeof pi === "string" ? pi : pi.id;
}

/**
 * Einen bezahlten Checkout in Pro verwandeln. Idempotent, mehrfach aufrufbar.
 *
 * Nur „paid" zählt. Bewusst nicht `status === "complete"`: Ein 100%-Gutschein
 * („no_payment_required") oder eine noch laufende Zahlung („unpaid") darf kein Pro
 * auslösen — dieselbe Regel wie im Webhook seit dem ersten Tag.
 */
export async function fulfillPaidCheckout(
  session: Stripe.Checkout.Session,
): Promise<Fulfillment> {
  if (session.payment_status !== "paid") return { ok: false, reason: "unpaid" };

  const svc = createServiceClient();
  const customerId = customerIdOf(session.customer);
  // Der eingeloggte Kauf trägt die User-ID zweimal (Metadaten + client_reference_id), damit
  // ein Kauf auch dann zuzuordnen ist, wenn eines von beiden verloren geht.
  const memberId =
    (session.metadata?.supabase_user_id as string | undefined) ??
    session.client_reference_id ??
    null;

  // ── Fall 1: eingeloggt gekauft ────────────────────────────────────────────────────────
  if (memberId) {
    // ES GIBT NUR EINE ADRESSE, und das ist keine Vereinfachung, sondern nachgeprüft.
    //
    // Hier standen einmal zwei: die Kontoadresse (dort liegt der Zugang, Pro hängt an der
    // User-ID) und die Zahladresse (die Stripe erhoben hat). Die Kaufbestätigung nannte beide,
    // wenn sie auseinandergingen. Auseinandergehen können sie nicht mehr, aus zwei Gründen,
    // die unabhängig voneinander halten:
    //
    //   1. Ein eingeloggter Käufer hat IMMER einen Stripe-Kunden, der die Kontoadresse trägt:
    //      stripe-actions.ts legt ihn genau dafür an (`email: user.email ?? profile.email`),
    //      bevor die Session entsteht. Und Stripe schreibt zu einem übergebenen Kunden mit
    //      gültiger Adresse: „the email will be prefilled and not editable in Checkout."
    //      An der Kasse ist das Feld also nur noch Anzeige.
    //   2. Die Kontoadresse selbst kann sich nicht ändern. Die App hat keinen
    //      E-Mail-Wechsel — nachgesehen am 2026-07-27, es gibt keinen Aufruf von
    //      updateUser({ email }) und keine Stelle, die profiles.email neu schreibt.
    //
    // Beim Gast-Kauf sind beide ohnehin dieselbe: Das Konto entsteht AUS der Zahladresse.
    //
    // WENN SIE TROTZDEM AUSEINANDERGEHEN, erfährt es das Log und nicht der Käufer. Ein Satz
    // in der Mail über zwei Adressen ist für 999 von 1000 Menschen eine Verwirrung, die es
    // nicht braucht; für den tausendsten wäre er eine Erklärung, die er ohnehin nicht
    // einordnen kann. Diese Annahme kippt genau dann, wenn jemand einen E-Mail-Wechsel
    // einbaut (dann gehört sie neu bedacht) — bis dahin ist eine laute Logzeile die richtige
    // Antwort. Verschickt und angezeigt wird die KONTOadresse: Dort liegt der Zugang.
    const accountEmail = await profileEmail(svc, memberId);
    const payerEmail = emailOf(session);
    if (payerEmail && accountEmail && payerEmail !== accountEmail) {
      console.error(
        "[pro] Zahladresse weicht von der Kontoadresse ab — sollte unmöglich sein, siehe fulfillPaidCheckout",
        session.id,
        { payerEmail, accountEmail },
      );
    }
    const email = accountEmail || payerEmail;
    const firstTime = await recordPurchase(svc, session, {
      email,
      userId: memberId,
      granted: true,
      accountCreated: false,
      customerId,
    });
    // Nur beim ersten Mal: Die Zeile ist neu, also hat noch niemand bestätigt. Beim zweiten
    // Weg (Webhook nach Rücksprung) wäre es dieselbe Mail ein zweites Mal.
    if (firstTime) await sendPurchaseConfirmation(session, email, false);
    await grantPro(memberId, customerId);
    return { ok: true, kind: "member", userId: memberId, email };
  }

  // ── Fall 2 & 3: als Gast gekauft ──────────────────────────────────────────────────────
  const email = emailOf(session);
  if (!email) {
    // Darf nicht vorkommen (Stripe erhebt die Adresse im Checkout), wäre aber ein bezahlter
    // Kauf ohne jede Zuordnung -> laut ins Log, damit es jemand von Hand klären kann.
    console.error("[pro] bezahlter Checkout ohne E-Mail", session.id);
    // „laut ins Log" hiess bis hier: eine graue Zeile, die niemand liest. Jetzt kommt eine
    // Mail, denn dieser Fall lässt sich NUR von Hand lösen und nur, wenn jemand davon weiss.
    // Die Sitzungs-ID gehört mit hinein, sie ist der Schlüssel im Stripe-Dashboard.
    await logOps("stripe_fulfillment_failed", {
      message: "Bezahlter Kauf ohne E-Mail-Adresse. Ohne Adresse gibt es niemanden freizuschalten.",
      detail: { stripeSession: session.id },
      group: "pro:no_email",
    });
    return { ok: false, reason: "no_email" };
  }

  // Schon verbucht? Dann hat der andere Weg (Webhook oder Rücksprung) gewonnen; wir geben
  // seinen Zustand zurück, statt irgendetwas doppelt zu tun.
  const known = await readPurchase(svc, session.id);
  if (known) return stateOf(known);

  const claimHash = (session.metadata?.claim_hash as string | undefined) ?? null;

  // Die Zeile MUSS vor dem Anlegen des Kontos stehen: handle_new_user (Migration 0053)
  // schaut beim Entstehen des Profils genau hier nach und schreibt Pro in derselben
  // Transaktion. Andersherum entstünde ein Konto ohne Pro.
  const inserted = await recordPurchase(svc, session, {
    email,
    userId: null,
    granted: false,
    accountCreated: false,
    customerId,
    claimHash,
  });
  if (!inserted) {
    // Kollision mit dem parallel laufenden anderen Weg -> dessen Zustand gilt.
    const row = await readPurchase(svc, session.id);
    if (row) return stateOf(row);
    return { ok: false, reason: "error" };
  }

  // Bestätigung nach § 7 Abs. 3 FAGG, BEVOR freigeschaltet wird — „spätestens vor dem Beginn
  // der Dienstleistungserbringung" steht so im Gesetz, und ohne sie erlischt das
  // Rücktrittsrecht nicht (§ 18 Abs. 1 Z 11 lit. c). Der Kauf hängt trotzdem nicht daran:
  // Geht die Mail nicht raus, wird trotzdem freigeschaltet und der Fehler steht im Log.
  // Bezahlte Leistung zurückzuhalten, weil ein Mailserver hustet, wäre die falsche Reihenfolge.
  await sendPurchaseConfirmation(session, email, true);

  // Konto anlegen. createUser IST die Prüfung „gibt es die Adresse schon?" — und zwar eine
  // ohne Wettlauf: Die Eindeutigkeit von auth.users entscheidet, nicht ein Blick davor, der
  // eine Millisekunde später falsch sein kann. Genau daran hängt die Sicherheit des
  // Auto-Logins: Nur wenn WIR das Konto in diesem Moment erzeugt haben, kann es niemand
  // anderem gehören.
  //
  // email_confirm: true, weil dieses Konto keinen Bestätigungsschritt vor sich hat — der
  // Nachweis für den Auto-Login ist das Cookie, nicht das Postfach. Wer sich später über
  // Magic-Link oder Google anmeldet, beweist das Postfach nach (auth/callback).
  const created = await svc.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  if (created.data?.user && !created.error) {
    const userId = created.data.user.id;
    // Der Trigger sollte Pro jetzt gesetzt und den Kauf abgehakt haben. Nachfassen, falls
    // nicht (z.B. Code deployt, Migration noch nicht eingespielt): Ein bezahlter Kauf darf
    // an einer nicht eingespielten Migration nicht scheitern.
    const row = await readPurchase(svc, session.id);
    if (!row?.granted_at) {
      await grantPro(userId, customerId);
      await svc
        .from("pro_purchases")
        .update({ granted_at: new Date().toISOString(), user_id: userId })
        .eq("stripe_session_id", session.id)
        .is("granted_at", null);
    }
    await svc
      .from("pro_purchases")
      .update({ account_created: true })
      .eq("stripe_session_id", session.id);

    return { ok: true, kind: "created", email, userId, claimHash, autoLoginUsed: false };
  }

  // Die Adresse hatte schon ein Konto (oder das Anlegen ging schief). Pro gehört trotzdem
  // sofort auf dieses Konto — der Mensch hat bezahlt. Der EINSTIEG läuft aber über das
  // Postfach, nicht über diesen Rücksprung.
  const profileId = await findProfileByEmail(svc, email);
  if (!profileId) {
    // Weder anlegbar noch findbar. Der Anspruch steht in pro_purchases und wird beim
    // nächsten Login dieser Adresse eingelöst — verloren ist nichts, aber es gehört ins Log.
    console.error(
      "[pro] Konto weder anlegbar noch auffindbar",
      session.id,
      created.error?.message,
    );
    return { ok: true, kind: "linked", email, userId: null };
  }

  await warnIfAlreadyEntitled(svc, profileId, email, session.id);
  await grantPro(profileId, customerId);
  await svc
    .from("pro_purchases")
    .update({ granted_at: new Date().toISOString(), user_id: profileId })
    .eq("stripe_session_id", session.id)
    .is("granted_at", null);

  return { ok: true, kind: "linked", email, userId: profileId };
}

/** Zustand einer bereits verbuchten Zeile in dieselbe Antwort übersetzen. */
function stateOf(row: PurchaseRow): Fulfillment {
  if (row.account_created && row.user_id) {
    return {
      ok: true,
      kind: "created",
      email: row.email,
      userId: row.user_id,
      claimHash: row.claim_hash,
      autoLoginUsed: row.auto_login_at != null,
    };
  }
  return { ok: true, kind: "linked", email: row.email, userId: row.user_id };
}

function emailOf(session: Stripe.Checkout.Session): string {
  const raw = session.customer_details?.email ?? session.customer_email ?? "";
  return raw.trim().toLowerCase();
}

async function readPurchase(
  svc: ReturnType<typeof createServiceClient>,
  sessionId: string,
): Promise<PurchaseRow | null> {
  const { data } = await svc
    .from("pro_purchases")
    .select(PURCHASE_COLUMNS)
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  return (data as PurchaseRow | null) ?? null;
}

/**
 * Kauf verbuchen. Rückgabe: true = diese Zeile ist neu (wir haben das Rennen gewonnen).
 * Eine Kollision auf dem Primärschlüssel ist kein Fehler, sondern die Antwort „der andere
 * Weg war schneller".
 */
async function recordPurchase(
  svc: ReturnType<typeof createServiceClient>,
  session: Stripe.Checkout.Session,
  opts: {
    email: string;
    userId: string | null;
    granted: boolean;
    accountCreated: boolean;
    customerId: string | null;
    claimHash?: string | null;
  },
): Promise<boolean> {
  const now = new Date().toISOString();
  const { error } = await svc.from("pro_purchases").insert({
    stripe_session_id: session.id,
    email: opts.email,
    stripe_customer_id: opts.customerId,
    stripe_payment_intent: paymentIntentOf(session),
    amount_minor: session.amount_total,
    currency: session.currency,
    paid_at: now,
    user_id: opts.userId,
    granted_at: opts.granted ? now : null,
    account_created: opts.accountCreated,
    claim_hash: opts.claimHash ?? null,
  });
  if (!error) return true;
  // 23505 = unique_violation -> schon verbucht. Das ist der NORMALFALL, wenn Webhook und
  // Rücksprung gleichzeitig ankommen, und kein Fehler: Es wird nicht gemeldet.
  if ((error as { code?: string }).code !== "23505") {
    console.error("[pro] Kauf konnte nicht verbucht werden", session.id, error.message);
    await logOps("stripe_fulfillment_failed", {
      message: "Ein bezahlter Kauf konnte nicht in die Datenbank geschrieben werden.",
      error,
      detail: { stripeSession: session.id },
      group: "pro:record_failed",
    });
  }
  return false;
}

async function profileEmail(
  svc: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<string> {
  const { data } = await svc.from("profiles").select("email").eq("id", userId).maybeSingle();
  return ((data?.email as string | undefined) ?? "").trim().toLowerCase();
}

async function findProfileByEmail(
  svc: ReturnType<typeof createServiceClient>,
  email: string,
): Promise<string | null> {
  const { data } = await svc
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Bezahlt, obwohl schon Pro? Das ist ein Rückerstattungsfall, und niemand ausser dem Log
 * würde ihn je bemerken: Die App zeigt einem eingeloggten Pro-Nutzer keinen Kauf-Knopf,
 * aber als Gast kann man an der Kasse jede Adresse eintippen — auch die eigene, mit der man
 * längst Pro hat.
 */
async function warnIfAlreadyEntitled(
  svc: ReturnType<typeof createServiceClient>,
  profileId: string,
  email: string,
  sessionId: string,
): Promise<void> {
  const { data } = await svc
    .from("profiles")
    .select("is_pro, pro_source")
    .eq("id", profileId)
    .maybeSingle();
  if (data?.is_pro) {
    console.error(
      "[pro] Kauf, obwohl bereits Pro (Rückerstattung prüfen)",
      sessionId,
      email,
      data.pro_source,
    );
  }
}

/**
 * Den Auto-Login einlösen — genau einmal.
 *
 * Die Bedingung steckt im UPDATE selbst, nicht in einem gelesenen Zustand davor: Zwei
 * gleichzeitige Aufrufe (Doppeltap, zwei Tabs, Vorlade-Anfrage des Browsers) treffen damit
 * die Datenbank, und die Datenbank entscheidet. Rückgabe true = dieser Aufruf darf einloggen.
 */
export async function consumeAutoLogin(sessionId: string): Promise<boolean> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("pro_purchases")
    .update({ auto_login_at: new Date().toISOString() })
    .eq("stripe_session_id", sessionId)
    .is("auto_login_at", null)
    .select("stripe_session_id");
  if (error) {
    console.error("[pro] Auto-Login-Einlösung fehlgeschlagen", sessionId, error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Beim ersten bewiesenen Login: geliehene Sitzungen kappen.
 *
 * Nach dem Kauf bekommt der Käufer eine Sitzung, ohne sein Postfach bewiesen zu haben — der
 * Nachweis war das Cookie. Das ist der richtige Tausch (niemand soll nach dem Bezahlen noch
 * Mails suchen müssen), aber er hat eine offene Kante: Wer an der Kasse eine fremde Adresse
 * eintippt, sitzt danach in einem Konto, das diese fremde Adresse trägt.
 *
 * Sobald sich jemand mit dieser Adresse über Magic-Link oder Google anmeldet, ist bewiesen,
 * wem das Postfach gehört. Ab dem Moment gilt nur noch dessen Sitzung; alle anderen fliegen
 * raus. Rückgabe: true = es gab so eine Sitzung (Aufrufer soll `signOut({scope:"others"})`).
 *
 * Für den Käufer selbst ist das unsichtbar: Klickt er den Link im selben Browser, ist seine
 * neue Sitzung die verbleibende.
 */
export async function claimVerifiedLogin(userId: string): Promise<boolean> {
  try {
    const svc = createServiceClient();
    const { data } = await svc
      .from("pro_purchases")
      .update({ verified_at: new Date().toISOString() })
      .eq("user_id", userId)
      .not("auto_login_at", "is", null)
      .is("verified_at", null)
      .select("stripe_session_id");
    return (data?.length ?? 0) > 0;
  } catch (e) {
    // Ein Login darf hieran nie scheitern.
    console.error("[pro] verified-Login konnte nicht vermerkt werden", e);
    return false;
  }
}

/**
 * Die Vertragsbestätigung verschicken (§ 7 Abs. 3 FAGG). Siehe pro-purchase-mail.ts, dort
 * steht, warum das eine Pflicht und keine Höflichkeit ist.
 *
 * `email` ist die Adresse des Kontos, und dieselbe wurde bezahlt (siehe oben, warum das
 * keine Annahme mehr ist). Dorthin geht die Mail, und dieselbe steht darin.
 *
 * `guest` = ohne Konto gekauft. Wer eingeloggt gekauft hat, soll in seiner Bestätigung nicht
 * lesen, wie er sich anmeldet.
 *
 * Wirft nie: Der Kauf ist bezahlt und verbucht. Ein Mailproblem gehört ins Log, nicht in den
 * Weg des Käufers.
 */
async function sendPurchaseConfirmation(
  session: Stripe.Checkout.Session,
  email: string,
  guest: boolean,
): Promise<void> {
  if (!email) return;
  try {
    // Die Sprache des Käufers, wie sie beim Anlegen der Session mitgegeben wurde
    // (stripe-actions.ts). Fehlt sie (Session aus der Zeit davor), nagelt safeLocale() sie
    // auf Deutsch fest. Der Preis wird in derselben Sprache geschrieben wie die Mail,
    // sonst steht „19,90 €" mitten in einem koreanischen Satz nach deutscher Regel da.
    const locale = safeLocale(session.metadata?.locale);
    const price =
      session.amount_total != null && session.currency
        ? formatProPrice(
            { amountMinor: session.amount_total, currency: session.currency },
            locale,
          )
        : "";
    const receipt = {
      email,
      locale,
      price,
      paidAt: new Date().toISOString(),
      consentAt: (session.metadata?.withdrawal_waiver_at as string | undefined) ?? null,
      // Die Zahlungskennung, nicht die Session-ID: Sie steht auch auf Stripes Belegen und
      // in der Rechnung, ist also die Referenz, mit der eine Rückfrage überhaupt auffindbar
      // ist. Fällt sie aus, nehmen wir die Session-ID.
      reference: paymentIntentOf(session) ?? session.id,
      guest,
    };
    const mail = await renderProPurchase(receipt);
    const ok = await sendEmail({
      to: email,
      subject: mail.subject,
      replyTo: LEGAL.email,
      text: mail.text,
      html: mail.html,
    });
    if (!ok) {
      // Laut, mit Bestellreferenz: Diese Mail ist die dritte Bedingung dafür, dass das
      // Rücktrittsrecht erlischt. Fehlt sie, muss sie von Hand nachgeschickt werden.
      console.error(
        "[pro] Kaufbestätigung NICHT versendet (RESEND_KEY/Domain prüfen)",
        session.id,
        email,
      );
    }
  } catch (e) {
    console.error("[pro] Kaufbestätigung fehlgeschlagen", session.id, e);
  }
}

/**
 * Pro setzen. Die EINZIGE Stelle, die `is_pro` aus einer Stripe-Zahlung schreibt.
 *
 * Idempotent: Wer per Stripe schon Pro hat, wird nicht angefasst (pro_since bleibt der
 * ursprüngliche Zeitpunkt).
 */
export async function grantPro(
  userId: string | null,
  customerId: string | null,
): Promise<void> {
  const svc = createServiceClient();
  const id = userId ?? (customerId ? await findProfileByCustomer(svc, customerId) : null);
  if (!id) {
    console.error("[pro] bezahlt, aber kein passendes Profil", { userId, customerId });
    // Der Fall, um den es bei diesem ganzen Meldewesen eigentlich geht: Jemand hat gezahlt
    // und bekommt nichts. Ohne Mail merkt man es erst, wenn er sich beschwert.
    await logOps("stripe_fulfillment_failed", {
      message: "Bezahlt, aber es gibt kein Profil zum Freischalten.",
      detail: { stripeCustomer: customerId, userId },
      group: "pro:no_profile",
    });
    return;
  }
  const { data: cur } = await svc
    .from("profiles")
    .select("is_pro, pro_source")
    .eq("id", id)
    .maybeSingle();
  if (cur?.is_pro && cur?.pro_source === "stripe") return;
  await svc
    .from("profiles")
    .update({
      is_pro: true,
      pro_since: new Date().toISOString(),
      pro_source: "stripe",
      ...(customerId ? { stripe_customer_id: customerId } : {}),
    })
    .eq("id", id);
}

/**
 * Pro entziehen — nur, was aus Stripe stammt. Geschenktes ('comp') und übernommenes
 * ('migration') Pro bleibt stehen, auch wenn derselbe Mensch einmal etwas zurückerstattet
 * bekommt.
 */
export async function revokePro(customerId: string): Promise<void> {
  const svc = createServiceClient();
  await svc
    .from("profiles")
    .update({ is_pro: false })
    .eq("stripe_customer_id", customerId)
    .eq("pro_source", "stripe");

  // Und den ANSPRUCH abräumen, nicht nur das Profil.
  //
  // Das Profil ist die eine Quelle für Pro, pro_purchases ist die zweite: handle_new_user
  // (Migration 0053) schaltet beim Anlegen eines Kontos frei, wenn dort ein bezahlter Kauf
  // offen steht. Wurde das Konto nie angelegt — ein Aussetzer im richtigen Moment reicht —,
  // findet die Zeile darüber niemanden, dem sie Pro entziehen könnte. Der Anspruch blieb
  // dann liegen, und die nächste Anmeldung mit dieser Adresse machte daraus Pro. Bezahlt
  // war da längst nichts mehr.
  //
  // Reihenfolge egal, beide Aufräumarbeiten sind unabhängig und wiederholbar.
  const { error } = await svc
    .from("pro_purchases")
    .update({ refunded_at: new Date().toISOString() })
    .eq("stripe_customer_id", customerId)
    .is("refunded_at", null);
  if (error) console.error("[pro] Anspruch nach Rückerstattung nicht abgeräumt", customerId, error.message);
}

async function findProfileByCustomer(
  svc: ReturnType<typeof createServiceClient>,
  customerId: string,
): Promise<string | null> {
  const { data } = await svc
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Den Willkommensgruss als „gesehen" abhaken.
 *
 * Nach dem Kauf sagt die Erfolgsseite dem Menschen selbst, dass Pro aktiv ist. Ohne das
 * hier käme derselbe Satz kurz danach nochmal als Hinweis-Sheet (ProNotice) — zweimal
 * dieselbe Nachricht in zwei Formen. Nur für den, der jetzt eingeloggt vor dem Bildschirm
 * sitzt: Wer seinen Zugang erst per Mail holt, soll den Gruss beim Einstieg sehr wohl sehen.
 */
export async function markProNoticeSeen(userId: string): Promise<void> {
  try {
    const svc = createServiceClient();
    await svc
      .from("profiles")
      .update({ pro_notice_seen_at: new Date().toISOString() })
      .eq("id", userId)
      .is("pro_notice_seen_at", null);
  } catch {
    /* Ein nicht abgehakter Gruss ist harmlos. */
  }
}
