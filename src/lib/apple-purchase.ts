import "server-only";
import {
  Environment,
  NotificationTypeV2,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
} from "@apple/app-store-server-library";
import { appleRootCertificates } from "./apple-roots/index";
import {
  applyAppleRevocation,
  bindAndGrantApplePro,
  type AppleStore,
  type AppleTx,
  type GrantOptions,
  type GrantResult,
  type PurchaseRow,
  type RevokeResult,
} from "./apple-purchase-core";
import { isRealSite, logOps, opsSubject } from "./ops";
import { errorMessage } from "./ops-scrub";
import { createServiceClient } from "./supabase/service";
import { trackConversion } from "./analytics";
import type { AppApplePurchaseResult } from "./app-api-types";

// Apple-Kauf, Server-Seite (docs/41 Abschnitt 7). Diese Datei prüft Apples Signaturen, bindet
// an die Datenbank und meldet. Die ENTSCHEIDUNGEN (wem gehört der Kauf, wann Pro) stehen in
// apple-purchase-core.ts und sind dort ohne Datenbank durchspielbar.
//
// ENV (alle nur in Vercel, nie im Repo; keine davon ist ein Geheimnis im engeren Sinn, aber sie
// legen fest, was als gültiger Kauf gilt):
//   APPLE_IAP_BUNDLE_ID       Bundle-ID der App (Pflicht)
//   APPLE_IAP_PRODUCT_ID      Produkt-ID des Pro-Kaufs (Pflicht)
//   APPLE_IAP_APP_APPLE_ID    numerische App-ID aus App Store Connect (Pflicht bei Production/Both)
//   APPLE_IAP_ENVIRONMENT     Production (Standard) | Sandbox | Both
//   APPLE_IAP_ONLINE_CHECKS   "1" schaltet die Widerrufsprüfung der Zertifikate (OCSP) ein
//   APPLE_IAP_SANDBOX_USERS   optional, Komma-getrennte Konto-IDs: Sandbox-Käufe schalten dann NUR
//                             diese Konten frei (leer = alle, nötig für die App-Store-Prüfung)
// Der App-Store-Server-API-Schlüssel (.p8) wird NICHT gebraucht: Wir rufen Apple nie an. Alles,
// was wir wissen müssen, steht signiert in der Transaktion bzw. in der Benachrichtigung.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ── Konfiguration ────────────────────────────────────────────────────────────────────────

export type AppleIapConfig = {
  bundleId: string;
  productId: string;
  /** Reihenfolge = Reihenfolge der Prüfversuche. */
  environments: ("Production" | "Sandbox")[];
  appAppleId: number | null;
  onlineChecks: boolean;
  /** null = jedes Konto darf mit Sandbox-Käufen Pro bekommen. [] = niemand. */
  sandboxUsers: string[] | null;
  /** Die Liste war kaputt: Sandbox ist für niemanden erlaubt, Production läuft normal weiter. */
  sandboxUsersInvalid: boolean;
};

/** Konfiguration fehlt oder ist unbrauchbar. Die Route meldet config_missing und antwortet 503. */
export class AppleConfigError extends Error {}
/** Apple (Zertifikatsprüfung) war nicht erreichbar. Wiederholbar: Route antwortet 503. */
export class AppleUnavailableError extends Error {}

/**
 * Konfiguration lesen. Wirft AppleConfigError mit den Namen der fehlenden Werte (nie mit Werten).
 *
 * "Both" ist für TestFlight und App-Store-Prüfung nötig: Deren Käufe laufen in Apples Sandbox,
 * obwohl die App gegen den Produktions-Server spricht. Der Standard "Production" lehnt
 * Sandbox-Transaktionen ab. Sandbox-Käufe sind kein Geld, aber sie schalten echtes Pro frei;
 * wer sie annehmen will, entscheidet das ausdrücklich.
 */
export function readAppleConfig(env: Record<string, string | undefined> = process.env): AppleIapConfig {
  const bundleId = env.APPLE_IAP_BUNDLE_ID?.trim() ?? "";
  const productId = env.APPLE_IAP_PRODUCT_ID?.trim() ?? "";
  const mode = (env.APPLE_IAP_ENVIRONMENT?.trim() || "Production");
  const appIdRaw = env.APPLE_IAP_APP_APPLE_ID?.trim() ?? "";

  const problems: string[] = [];
  if (!bundleId) problems.push("APPLE_IAP_BUNDLE_ID");
  if (!productId) problems.push("APPLE_IAP_PRODUCT_ID");

  let environments: AppleIapConfig["environments"] = ["Production"];
  if (mode === "Production") environments = ["Production"];
  else if (mode === "Sandbox") environments = ["Sandbox"];
  else if (mode === "Both") environments = ["Production", "Sandbox"];
  else problems.push("APPLE_IAP_ENVIRONMENT (Production, Sandbox oder Both)");

  // Nur Ziffern: parseInt("123abc") wäre 123 und würde einen Tippfehler still durchlassen.
  const appAppleId = /^[0-9]{1,15}$/.test(appIdRaw) ? Number(appIdRaw) : null;
  if (environments.includes("Production") && appAppleId === null) {
    problems.push("APPLE_IAP_APP_APPLE_ID (nur Ziffern)");
  }

  // Erlaubnisliste für Sandbox-Käufe. Ein Tippfehler darf sie nicht aufweichen (kaputte Liste
  // ignoriert = alle erlaubt), aber auch nicht ALLES lahmlegen (Production-Käufe und
  // Erstattungen müssen weiterlaufen). Darum: kaputt = Sandbox für niemanden, Production normal,
  // und settleAppleTransactions meldet es einmal je Anfrage, wenn es einen Kauf trifft.
  const sandboxRaw = env.APPLE_IAP_SANDBOX_USERS?.trim() ?? "";
  let sandboxUsers: string[] | null = null;
  let sandboxUsersInvalid = false;
  if (sandboxRaw) {
    sandboxUsers = sandboxRaw.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (sandboxUsers.length === 0 || sandboxUsers.some((x) => !UUID_RE.test(x))) {
      sandboxUsers = [];
      sandboxUsersInvalid = true;
    }
  }

  if (problems.length > 0) {
    throw new AppleConfigError(`Apple-Kauf nicht konfiguriert: ${problems.join(", ")}`);
  }

  return {
    bundleId,
    productId,
    environments,
    appAppleId,
    // Entscheidung: standardmäßig AUS. Die Online-Prüfung fragt bei Apple per OCSP nach, ob ein
    // Zertifikat der Kette widerrufen wurde (bis 30 s je Frage, zwei Fragen je neuer Kette).
    // Das hängt jeden Kauf an Apples Erreichbarkeit und an unserer Funktionslaufzeit, und das
    // Risiko, das sie abdeckt (ein kompromittiertes Apple-Zwischenzertifikat) ist kein Fall,
    // den wir an dieser Stelle besser bemerken als Apple selbst. Ohne sie prüft die Bibliothek
    // weiterhin die volle Kette gegen unsere festen Wurzeln, die Gültigkeitszeiträume (zum
    // Signaturzeitpunkt) und Apples eigene Zertifikatserweiterungen. "1" schaltet sie zu.
    onlineChecks: env.APPLE_IAP_ONLINE_CHECKS?.trim() === "1",
    sandboxUsers,
    sandboxUsersInvalid,
  };
}

// ── Prüfung der Signaturen ───────────────────────────────────────────────────────────────

type VerifierFactory = (env: "Production" | "Sandbox") => SignedDataVerifier;

/**
 * Prüfer bauen. `roots` ist NUR für Tests austauschbar (Prüf-Skript mit eigener Kette); im
 * Betrieb kommen die Wurzeln ausschließlich aus ./apple-roots.
 */
export function makeVerifierFactory(
  cfg: AppleIapConfig,
  roots: Buffer[] = appleRootCertificates(),
): VerifierFactory {
  const cache = new Map<string, SignedDataVerifier>();
  return (env) => {
    let v = cache.get(env);
    if (!v) {
      v = new SignedDataVerifier(
        roots,
        cfg.onlineChecks,
        env === "Production" ? Environment.PRODUCTION : Environment.SANDBOX,
        cfg.bundleId,
        // Die Bibliothek verlangt die App-ID in Production und lässt sie in Sandbox weg.
        env === "Production" ? (cfg.appAppleId ?? undefined) : undefined,
      );
      cache.set(env, v);
    }
    return v;
  };
}

let defaultFactory: { key: string; make: VerifierFactory } | null = null;

// Der Prüfer mit den echten Wurzeln, einmal je Konfiguration pro Instanz.
function defaultVerifiers(cfg: AppleIapConfig): VerifierFactory {
  const key = JSON.stringify(cfg);
  if (defaultFactory?.key !== key) defaultFactory = { key, make: makeVerifierFactory(cfg) };
  return defaultFactory.make;
}

export type VerifyFailure =
  | "invalid"
  | "environment"
  | "wrong_product"
  | "wrong_app"
  | "family_shared";

export type VerifiedTransaction =
  | { ok: true; tx: AppleTx }
  | { ok: false; reason: VerifyFailure };


// Aus Apples entschlüsselter Nutzlast das Nötige ziehen. null = es fehlt etwas Wesentliches
// oder es ist unbrauchbar: lieber ablehnen als mit Standardwerten raten.
function toAppleTx(d: {
  originalTransactionId?: string;
  productId?: string;
  environment?: string;
  purchaseDate?: number;
  appAccountToken?: string;
  revocationDate?: number;
  inAppOwnershipType?: string;
}, requirePurchased: boolean): AppleTx | null | "family_shared" {
  if (!d.originalTransactionId || !/^[0-9]{1,32}$/.test(d.originalTransactionId)) return null;
  if (!d.productId) return null;
  if (d.environment !== "Production" && d.environment !== "Sandbox") return null;
  if (typeof d.purchaseDate !== "number" || !Number.isFinite(d.purchaseDate)) return null;
  // Familienfreigabe wird im Code abgelehnt, nicht nur in App Store Connect: Ein
  // Familienmitglied hat die Transaktion NICHT gekauft (FAMILY_SHARED), und der Server kennt
  // nur einen Käufer je Transaktion. Fehlt die Angabe, wird ebenfalls abgelehnt.
  // Bei Benachrichtigungen gilt das nicht (requirePurchased false): Eine Erstattung gilt immer,
  // auch für eine Transaktion, die wir nie freigeschaltet hätten.
  if (requirePurchased && d.inAppOwnershipType !== "PURCHASED") return "family_shared";

  let token: string | null = null;
  if (d.appAccountToken !== undefined && d.appAccountToken !== "") {
    token = d.appAccountToken.toLowerCase();
    // Kaputter Token: nicht "wie keiner" behandeln (das würde an das angemeldete Konto binden),
    // sondern ablehnen.
    if (!UUID_RE.test(token)) return null;
  }

  let revokedAt: string | null = null;
  if (d.revocationDate !== undefined) {
    if (typeof d.revocationDate !== "number" || !Number.isFinite(d.revocationDate)) return null;
    revokedAt = new Date(d.revocationDate).toISOString();
  }

  return {
    originalTransactionId: d.originalTransactionId,
    productId: d.productId,
    environment: d.environment,
    purchasedAt: new Date(d.purchaseDate).toISOString(),
    appAccountToken: token,
    revokedAt,
  };
}

// Eine Ausnahme der Bibliothek in eine Entscheidung übersetzen.
//   "retry"       Apple nicht erreichbar (nur mit Online-Prüfung): wiederholbar, kein Urteil.
//   "environment" echte Apple-Signatur, aber andere Umgebung als dieser Prüfer: nächsten probieren.
//   "app"         echte Apple-Signatur, aber andere App (Bundle-ID/App-ID).
//   "invalid"     alles andere (Signatur, Kette, Form).
function classify(e: unknown): "retry" | "environment" | "app" | "invalid" {
  if (e instanceof VerificationException) {
    if (e.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE) return "retry";
    if (e.status === VerificationStatus.INVALID_ENVIRONMENT) return "environment";
    if (e.status === VerificationStatus.INVALID_APP_IDENTIFIER) return "app";
  }
  return "invalid";
}

/**
 * Eine vom Gerät geschickte signierte Transaktion prüfen: Signaturkette gegen Apples Wurzeln,
 * Bundle-ID, Umgebung, dann die Produkt-ID. Gibt nur Angaben zurück, die in der Signatur stehen.
 *
 * Wirft AppleUnavailableError (Apple nicht erreichbar, wiederholbar) oder AppleConfigError.
 * Eine ungültige Transaktion ist ein ERGEBNIS, kein Wurf.
 */
export async function verifyAppleTransaction(
  signedTransaction: string,
  cfg: AppleIapConfig = readAppleConfig(),
  verifiers: VerifierFactory = defaultVerifiers(cfg),
): Promise<VerifiedTransaction> {
  let sawEnvironmentMismatch = false;
  let sawAppMismatch = false;
  for (const env of cfg.environments) {
    try {
      const decoded = await verifiers(env).verifyAndDecodeTransaction(signedTransaction);
      const tx = toAppleTx(decoded, true);
      if (tx === "family_shared") return { ok: false, reason: "family_shared" };
      if (!tx) return { ok: false, reason: "invalid" };
      if (tx.productId !== cfg.productId) return { ok: false, reason: "wrong_product" };
      return { ok: true, tx };
    } catch (e) {
      const kind = classify(e);
      if (kind === "retry") throw new AppleUnavailableError(errorMessage(e));
      if (kind === "environment" || kind === "app") {
        // Nächste Umgebung probieren. "app" gehört mit hierher: Der Production-Prüfer verlangt in
        // Benachrichtigungen die App-ID, die Sandbox-Benachrichtigungen nicht tragen, und wirft
        // deshalb "andere App", BEVOR er die Umgebung vergleicht.
        if (kind === "environment") sawEnvironmentMismatch = true;
        else sawAppMismatch = true;
        continue;
      }
      return { ok: false, reason: "invalid" };
    }
  }
  return {
    ok: false,
    reason: sawAppMismatch ? "wrong_app" : sawEnvironmentMismatch ? "environment" : "invalid",
  };
}

export type VerifiedNotification =
  | {
      ok: true;
      type: string;
      subtype: string | null;
      notificationUUID: string | null;
      /** Die Transaktion der Benachrichtigung, geprüft, oder null (z. B. TEST). */
      tx: AppleTx | null;
      /** Die Transaktion gehört zu einem anderen Produkt dieser App: ignorieren. */
      otherProduct: boolean;
    }
  | { ok: false; reason: VerifyFailure };

/**
 * Eine App Store Server Notification V2 prüfen (signedPayload) und ihre Transaktion
 * (data.signedTransactionInfo) mit DEMSELBEN Prüfer. Unsignierte Felder werden nie benutzt.
 */
export async function verifyAppleNotification(
  signedPayload: string,
  cfg: AppleIapConfig = readAppleConfig(),
  verifiers: VerifierFactory = defaultVerifiers(cfg),
): Promise<VerifiedNotification> {
  let sawEnvironmentMismatch = false;
  let sawAppMismatch = false;
  for (const env of cfg.environments) {
    const verifier = verifiers(env);
    try {
      const n = await verifier.verifyAndDecodeNotification(signedPayload);
      const type = typeof n.notificationType === "string" ? n.notificationType : "";
      const base = {
        type,
        subtype: typeof n.subtype === "string" ? n.subtype : null,
        notificationUUID: n.notificationUUID ?? null,
      };
      const signedTx = n.data?.signedTransactionInfo;
      if (!signedTx) return { ok: true, ...base, tx: null, otherProduct: false };
      const decoded = await verifier.verifyAndDecodeTransaction(signedTx);
      const tx = toAppleTx(decoded, false);
      if (!tx || tx === "family_shared") return { ok: false, reason: "invalid" };
      if (tx.productId !== cfg.productId) return { ok: true, ...base, tx, otherProduct: true };
      return { ok: true, ...base, tx, otherProduct: false };
    } catch (e) {
      const kind = classify(e);
      if (kind === "retry") throw new AppleUnavailableError(errorMessage(e));
      if (kind === "environment" || kind === "app") {
        // Nächste Umgebung probieren. "app" gehört mit hierher: Der Production-Prüfer verlangt in
        // Benachrichtigungen die App-ID, die Sandbox-Benachrichtigungen nicht tragen, und wirft
        // deshalb "andere App", BEVOR er die Umgebung vergleicht.
        if (kind === "environment") sawEnvironmentMismatch = true;
        else sawAppMismatch = true;
        continue;
      }
      return { ok: false, reason: "invalid" };
    }
  }
  return {
    ok: false,
    reason: sawAppMismatch ? "wrong_app" : sawEnvironmentMismatch ? "environment" : "invalid",
  };
}

/** Typen, bei denen der Server handelt. Alle anderen werden nur notiert. */
export const REVOCATION_NOTIFICATIONS: readonly string[] = [
  NotificationTypeV2.REFUND,
  NotificationTypeV2.REVOKE,
];
export const REFUND_REVERSED_NOTIFICATION: string = NotificationTypeV2.REFUND_REVERSED;

// ── Speicher: Supabase ───────────────────────────────────────────────────────────────────

type Row = {
  original_transaction_id: string;
  user_id: string | null;
  product_id: string;
  environment: "Production" | "Sandbox";
  purchased_at: string;
  revoked_at: string | null;
  app_account_token: string | null;
};

const COLUMNS =
  "original_transaction_id, user_id, product_id, environment, purchased_at, revoked_at, app_account_token";

function fromRow(r: Row): PurchaseRow {
  return {
    originalTransactionId: r.original_transaction_id,
    userId: r.user_id,
    productId: r.product_id,
    environment: r.environment,
    purchasedAt: new Date(r.purchased_at).toISOString(),
    revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
    appAccountToken: r.app_account_token,
  };
}

/** Der echte Speicher: Service-Client (umgeht RLS, deshalb NUR hier und nur für verifizierte Daten). */
export function supabaseAppleStore(): AppleStore {
  const svc = createServiceClient();
  return {
    async getPurchase(id) {
      const { data, error } = await svc
        .from("apple_purchases")
        .select(COLUMNS)
        .eq("original_transaction_id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? fromRow(data as Row) : null;
    },
    async insertPurchase(row) {
      const { error } = await svc.from("apple_purchases").insert({
        original_transaction_id: row.originalTransactionId,
        user_id: row.userId,
        product_id: row.productId,
        environment: row.environment,
        purchased_at: row.purchasedAt,
        revoked_at: row.revokedAt,
        app_account_token: row.appAccountToken,
      });
      if (!error) return true;
      // 23505 = unique_violation: die Zeile gibt es schon, ein anderer Aufruf war schneller.
      if ((error as { code?: string }).code === "23505") return false;
      throw error;
    },
    async bindPurchase(id, userId) {
      const { data, error } = await svc
        .from("apple_purchases")
        .update({ user_id: userId })
        .eq("original_transaction_id", id)
        .is("user_id", null)
        .is("revoked_at", null)
        .select("original_transaction_id");
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    async markRevoked(id, at) {
      const { error } = await svc
        .from("apple_purchases")
        .update({ revoked_at: at })
        .eq("original_transaction_id", id)
        .is("revoked_at", null);
      if (error) throw error;
    },
    async getProfile(userId) {
      const { data, error } = await svc
        .from("profiles")
        .select("is_pro, pro_source")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return data
        ? { isPro: data.is_pro === true, proSource: (data.pro_source as string | null) ?? null }
        : null;
    },
    async grantProIfNotPro(userId, at) {
      // `is_pro = false` im UPDATE: Hat das Konto zwischenzeitlich Pro (Stripe, Geschenk), ändert
      // das hier nichts, und pro_source bleibt. pro_notice_seen_at gleich mit: Der Käufer hat den
      // Kauf in der App gerade selbst erlebt, das Web braucht ihm das nicht nochmal als
      // Willkommensgruß zu zeigen (und schon gar nicht den Geschenk-Text).
      const { data, error } = await svc
        .from("profiles")
        .update({ is_pro: true, pro_since: at, pro_source: "apple", pro_notice_seen_at: at })
        .eq("id", userId)
        .eq("is_pro", false)
        .select("id");
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    async hasOtherActivePurchase(userId, exceptId, refundedEnvironment) {
      let q = svc
        .from("apple_purchases")
        .select("original_transaction_id")
        .eq("user_id", userId)
        .is("revoked_at", null)
        .neq("original_transaction_id", exceptId);
      // Nach einer Production-Erstattung hält nur ein anderer Production-Kauf das Pro am Leben.
      if (refundedEnvironment === "Production") q = q.eq("environment", "Production");
      const { data, error } = await q.limit(1);
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    async hasActiveStripePurchase(userId) {
      // Aktiv = eingelöst (granted_at) und nicht erstattet (refunded_at), wie die Webhook-Logik.
      const { data, error } = await svc
        .from("pro_purchases")
        .select("stripe_session_id, stripe_customer_id")
        .eq("user_id", userId)
        .not("granted_at", "is", null)
        .is("refunded_at", null)
        .limit(10);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      // Ein Kauf mit Kunden-ID bevorzugen: nur mit ihr lässt sich das Profil umstellen.
      const withId = data.find((r) => typeof r.stripe_customer_id === "string" && r.stripe_customer_id);
      return { customerId: (withId?.stripe_customer_id as string | undefined) ?? null };
    },
    async switchAppleProToStripe(userId, customerId) {
      const { data, error } = await svc
        .from("profiles")
        .update({ pro_source: "stripe", stripe_customer_id: customerId })
        .eq("id", userId)
        .eq("pro_source", "apple")
        .eq("is_pro", true)
        .select("id");
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    async removeStripeProForCustomer(userId, customerId) {
      const { data, error } = await svc
        .from("profiles")
        .update({ is_pro: false })
        .eq("id", userId)
        .eq("pro_source", "stripe")
        .eq("stripe_customer_id", customerId)
        .eq("is_pro", true)
        .select("id");
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    async profileExists(userId) {
      const { data, error } = await svc.from("profiles").select("id").eq("id", userId).maybeSingle();
      if (error) throw error;
      return data !== null;
    },
    async removeAppleProIfApple(userId) {
      // Nur wo pro_source = 'apple' (im UPDATE). Wie revokePro() für Stripe: pro_source und
      // pro_since bleiben stehen, damit die Herkunft nicht verloren geht.
      const { data, error } = await svc
        .from("profiles")
        .update({ is_pro: false })
        .eq("id", userId)
        .eq("pro_source", "apple")
        .eq("is_pro", true)
        .select("id");
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
  };
}

// ── Die zwei Einstiege für Routen ────────────────────────────────────────────────────────

/**
 * Pro aus einer geprüften Transaktion freischalten. NEUE Funktion, NICHT grantPro() erweitert:
 * grantPro ist Stripe-spezifisch (Idempotenz über pro_source = 'stripe', überschreibt jede
 * andere Quelle, setzt stripe_customer_id). Hier gilt: ist is_pro schon true, bleibt
 * pro_source, wie es ist. Regeln und Rückgabe: apple-purchase-core.ts.
 */
export async function grantApplePro(
  userId: string,
  tx: AppleTx,
  store: AppleStore = supabaseAppleStore(),
  opts: GrantOptions = { sandboxUsers: null },
): Promise<GrantResult> {
  return bindAndGrantApplePro(store, userId, tx, undefined, opts);
}

/**
 * Erstattung/Entzug verbuchen. Pro wird nur entzogen, wenn pro_source = 'apple' und kein anderer
 * nicht erstatteter Apple-Kauf des Kontos bleibt. `tx` (aus einer geprüften Benachrichtigung)
 * legt bei unbekannter Transaktion eine erstattete Zeile an.
 */
export async function revokeApplePro(
  originalTransactionId: string,
  tx: AppleTx | null = null,
  store: AppleStore = supabaseAppleStore(),
): Promise<RevokeResult> {
  const at = tx?.revokedAt ?? new Date().toISOString();
  return applyAppleRevocation(store, originalTransactionId, tx, at);
}

/**
 * Mehrere vom Gerät geschickte Transaktionen verarbeiten (Kauf oder "Käufe wiederherstellen").
 * Jede für sich: Eine ungültige reißt die anderen nicht mit. Ergebnis i gehört zu Eingabe i.
 *
 * Wirft bei Speicher-/Apple-Ausfall (die Route antwortet 503); bereits verbuchte bleiben
 * verbucht, die Wiederholung ist idempotent.
 *
 * `deps` ist für Tests (Speicher und Prüfer austauschbar); die Routen übergeben nichts.
 */
export async function settleAppleTransactions(
  userId: string,
  signedTransactions: string[],
  locale: string,
  cfg: AppleIapConfig = readAppleConfig(),
  deps: { store?: AppleStore; verifiers?: VerifierFactory } = {},
): Promise<AppApplePurchaseResult[]> {
  const store = deps.store ?? supabaseAppleStore();
  const results: AppApplePurchaseResult[] = [];
  // Abgelehnte Transaktionen werden gezählt und GENAU EINMAL je Anfrage gemeldet. Ein
  // "Käufe wiederherstellen" mit 50 abgelehnten Einträgen soll 1 Logzeile ergeben, nicht 50.
  const invalid = new Map<string, number>();
  let sandboxListBroken = false;
  const rejected = (reason: string) => invalid.set(reason, (invalid.get(reason) ?? 0) + 1);

  for (const signed of signedTransactions) {
    const verified = await verifyAppleTransaction(signed, cfg, deps.verifiers ?? defaultVerifiers(cfg));
    if (!verified.ok) {
      rejected(verified.reason);
      results.push({ originalTransactionId: null, status: "invalid" });
      continue;
    }

    const r = await bindAndGrantApplePro(store, userId, verified.tx, undefined, {
      sandboxUsers: cfg.sandboxUsers,
    });
    const id = r.originalTransactionId;

    if (r.status === "invalid") {
      rejected(r.reason);
      if (r.reason === "sandbox_not_allowed" && cfg.sandboxUsersInvalid) sandboxListBroken = true;
      results.push({ originalTransactionId: id, status: "invalid" });
      continue;
    }

    if (r.status === "foreign") {
      await logOps("apple_purchase_foreign", {
        message:
          r.reason === "token_mismatch"
            ? "Apple-Kauf mit fremdem Konto-Token eingereicht, nichts verbucht."
            : "Apple-Kauf gehört zu einem anderen, noch bestehenden Konto, nichts umgebunden.",
        subject: opsSubject("user", userId),
        group: `apple:foreign:${r.reason}`,
        detail: { originalTransactionId: id, grund: r.reason },
      });
      results.push({ originalTransactionId: id, status: "foreign" });
      continue;
    }

    if (r.status === "revoked") {
      results.push({ originalTransactionId: id, status: "revoked" });
      continue;
    }

    // Doppelt bezahlt: Das Konto hatte schon Pro aus anderer Quelle (Stripe, Geschenk, Übernahme),
    // und jetzt gibt es einen Apple-Kauf dazu. pro_source bleibt (Regel), aber jemand sollte die
    // Erstattung prüfen. Nur beim ersten Verbuchen, nicht bei jedem Wiederherstellen.
    if (r.alreadyEntitledBy && (r.newPurchase || r.rebound)) {
      await logOps("apple_purchase_manual", {
        message: `Apple-Kauf, obwohl das Konto schon Pro hat (Quelle ${r.alreadyEntitledBy}). Erstattung prüfen.`,
        subject: opsSubject("user", userId),
        group: "apple:double",
        detail: { originalTransactionId: id, quelle: r.alreadyEntitledBy },
      });
    }

    // Der Token zeigte auf ein gelöschtes Konto: an das angemeldete Konto gebunden. Nur das Gerät
    // des Zahlenden hat diese Transaktion, aber ein Mensch soll es gesehen haben.
    if (r.status === "granted" && r.tokenAccountDeleted) {
      await logOps("apple_purchase_manual", {
        message: "Apple-Kauf mit Token eines gelöschten Kontos an das angemeldete Konto gebunden.",
        subject: opsSubject("user", userId),
        group: "apple:token_deleted",
        detail: { originalTransactionId: id },
      });
    }

    // Die Zählung steht an der Stelle, die pro Kauf genau einmal "neu" sagt (Zeile neu angelegt UND
    // Pro dadurch wirklich gesetzt), nie bei Wiederherstellen oder Umbinden. Nur echte Produktion
    // und echtes Geld: kein Sandbox-Kauf, kein Vorschau-Deployment. Mit await: serverlose
    // Funktionen frieren nach der Antwort ein (siehe pro-purchase.ts).
    if (
      r.newPurchase &&
      r.proChanged &&
      verified.tx.environment === "Production" &&
      isRealSite()
    ) {
      await trackConversion({ locale, device: "other" });
    }

    results.push({ originalTransactionId: id, status: r.status });
  }

  if (sandboxListBroken) {
    // Nicht kritisch: Production läuft, nur Sandbox-Käufe (Tester, App-Prüfung) werden abgewiesen.
    await logOps("apple_purchase_manual", {
      message:
        "APPLE_IAP_SANDBOX_USERS ist unbrauchbar (Komma-getrennte Konto-IDs erwartet): Sandbox-Käufe werden für niemanden freigeschaltet. Variable in Vercel korrigieren.",
      group: "apple:sandbox_users_invalid",
    });
  }

  if (invalid.size > 0) {
    const total = [...invalid.values()].reduce((a, b) => a + b, 0);
    await logOps("apple_purchase_invalid", {
      message: `${total} Apple-Transaktion(en) abgelehnt (${[...invalid.keys()].join(", ")})`,
      subject: opsSubject("user", userId),
      group: `apple:invalid:${[...invalid.keys()].sort().join("+")}`,
      detail: { anzahl: total, ...Object.fromEntries(invalid) },
    });
  }

  return results;
}

/** Eine Benachrichtigung bearbeiten, nachdem sie geprüft ist. Wirft bei Speicherfehlern. */
export async function handleAppleNotification(
  n: Extract<VerifiedNotification, { ok: true }>,
  store: AppleStore = supabaseAppleStore(),
): Promise<"revoked" | "ignored"> {
  if (REVOCATION_NOTIFICATIONS.includes(n.type) && n.tx && !n.otherProduct) {
    const r = await revokeApplePro(n.tx.originalTransactionId, n.tx, store);
    console.info("[apple] Entzug verbucht", n.type, r.status, r.proRemoved);
    if (r.stripeWithoutCustomer) {
      await logOps("apple_purchase_manual", {
        message:
          "Apple-Erstattung, Konto hat auch bei Stripe bezahlt, aber ohne Kunden-ID: Pro wurde entzogen. Pro von Hand setzen oder die Stripe-Zahlung erstatten.",
        group: "apple:double_refund_nocustomer",
        detail: { originalTransactionId: n.tx.originalTransactionId },
      });
    }
    if (r.switchedToStripe) {
      await logOps("apple_purchase_manual", {
        message:
          "Apple-Erstattung, aber das Konto hat auch bei Stripe bezahlt: Pro bleibt (Quelle jetzt stripe). Eine der beiden Zahlungen erstatten.",
        group: "apple:double_refund",
        detail: { originalTransactionId: n.tx.originalTransactionId },
      });
    }
    if (r.status === "environment_mismatch") {
      await logOps("apple_notification_invalid", {
        message: "Apple-Erstattung für eine Transaktion in anderer Umgebung als gespeichert, nichts geändert.",
        group: "apple:notification:env_mismatch",
        detail: { originalTransactionId: n.tx.originalTransactionId },
      });
    }
    return "revoked";
  }

  if (n.type === REFUND_REVERSED_NOTIFICATION && n.tx && !n.otherProduct) {
    // Apple hat eine Erstattung zurückgenommen. Automatisch wieder freischalten wäre
    // gefährlich (siehe Regel 6: erstattete Zeilen bleiben erstattet); ein Mensch entscheidet.
    await logOps("apple_purchase_manual", {
      message: "Apple hat eine Erstattung rückgängig gemacht (REFUND_REVERSED). Pro ggf. von Hand setzen.",
      group: "apple:refund_reversed",
      detail: { originalTransactionId: n.tx.originalTransactionId },
    });
    return "ignored";
  }

  await logOps("apple_notification_ignored", {
    message: `Apple-Benachrichtigung ohne Aktion (${n.type}${n.subtype ? "/" + n.subtype : ""})`,
    group: `apple:ignored:${n.type}`,
    detail: { typ: n.type, anderesProdukt: n.otherProduct },
  });
  return "ignored";
}
