// Prüft den Apple-Kauf OHNE echten Apple-Verkehr. Aufruf: npm run app-purchase:check
//
// WARUM ES DIESE PRÜFUNG GIBT (docs/41 Abschnitt 7): Hier hängt Geld dran, und die Regeln
// sind fein. Wem gehört ein Kauf, wenn jemand "Käufe wiederherstellen" tippt? Darf ein
// Admin-Geschenk bezahltes Pro überschreiben? Entzieht eine Apple-Erstattung versehentlich
// das Pro eines Stripe-Käufers? Jede dieser Fragen hat eine Antwort im Code, und jede
// Antwort ist hier festgenagelt, gegen die ECHTEN Module (kein Nachbau).
//
// Drei Teile:
//   1. Wurzelzertifikate: Datei, Modul und festgeschriebene Prüfsumme sind dieselben Bytes.
//   2. Signaturprüfung: mit einer EIGENEN Testkette (openssl, im Arbeitsverzeichnis des
//      Laufs, danach gelöscht). Apple liefert keine Testvektoren mit. Die Testkette wird NUR
//      hier eingespeist (makeVerifierFactory mit fremden Wurzeln); der Betriebsweg kennt nur
//      Apples gebündelte Wurzeln, und genau das wird hier mit bewiesen: Die Testkette muss
//      im Betriebsweg ABGELEHNT werden.
//   3. Entscheidungskern: Bindung, pro_source-Regel, Entzug, Rennen, gegen einen Speicher
//      im Arbeitsspeicher. Dazu der Stripe-Weg (grantPro) gegen einen Attrappen-Server.
//
// Die SQL-Seite (RLS, set_user_pro) beweist ein getrenntes Verfahren: lokales Postgres mit
// den Migrationen 0001 bis 0075 (siehe Bericht zu diesem Schritt / rls-lokal-beweisen).
import { execFileSync } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  randomUUID,
  sign,
  type KeyObject,
  X509Certificate,
} from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APPLE_ROOT_SHA256, appleRootCertificates } from "@/lib/apple-roots/index";
import {
  applyAppleRevocation,
  bindAndGrantApplePro,
  retireGuestAccount,
  MAX_ANON_HOLDERS,
  type AppleStore,
  type AppleTx,
  type PurchaseRow,
  type ProfileState,
  type GrantOptions,
} from "@/lib/apple-purchase-core";
import { applyStripeRefund, type StripeRefundStore } from "@/lib/stripe-refund-core";
import {
  AppleConfigError,
  makeVerifierFactory,
  readAppleConfig,
  settleAppleTransactions,
  verifyAppleNotification,
  verifyAppleTransaction,
} from "@/lib/apple-purchase";
import { OPS_EVENTS } from "@/lib/ops-events";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

let failed = 0;
let passed = 0;
const ok = (name: string) => {
  passed++;
  console.log(`  ok    ${name}`);
};
const bad = (name: string, detail: string) => {
  failed++;
  console.log(`  FEHLT ${name}\n        ${detail}`);
};
function check(name: string, cond: boolean, detail = "") {
  if (cond) ok(name);
  else bad(name, detail || "Bedingung verletzt");
}
function eq<T>(name: string, got: T, want: T) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) ok(name);
  else bad(name, `erwartet ${w}, bekommen ${g}`);
}
async function throws(name: string, fn: () => Promise<unknown>, match?: RegExp) {
  try {
    await fn();
    bad(name, "es wurde nichts geworfen");
  } catch (e) {
    if (match && !match.test(String((e as Error)?.message))) bad(name, `falscher Fehler: ${(e as Error)?.message}`);
    else ok(name);
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════
console.log("1. Wurzelzertifikate: Datei = Modul = festgeschriebene Pruefsumme");
{
  const dir = join(process.cwd(), "src", "lib", "apple-roots");
  const files: Record<string, string> = {
    "Apple Root CA - G3": "AppleRootCA-G3.cer",
    "Apple Root CA - G2": "AppleRootCA-G2.cer",
  };
  const fromModule = appleRootCertificates();
  eq("zwei Wurzeln im Modul", fromModule.length, 2);
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  for (const [name, file] of Object.entries(files)) {
    const bytes = readFileSync(join(dir, file));
    const sha = createHash("sha256").update(bytes).digest("hex");
    check(`${file}: Pruefsumme = festgeschrieben`, sha === APPLE_ROOT_SHA256[name], sha);
    check(`${file}: Modul traegt dieselben Bytes`, fromModule.some((b) => b.equals(bytes)));
    check(`${file}: README nennt die Pruefsumme`, readme.includes(sha));
    const x = new X509Certificate(bytes);
    check(`${file}: selbstsigniert, Name stimmt`, x.subject === x.issuer && x.subject.includes(name.replace("Apple Root CA - ", "Apple Root CA - ")), x.subject);
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════
console.log("\n2. Konfiguration aus ENV");
{
  const base = {
    APPLE_IAP_BUNDLE_ID: "at.example.app",
    APPLE_IAP_PRODUCT_ID: "at.example.app.pro",
    APPLE_IAP_APP_APPLE_ID: "123456789",
  };
  const c = readAppleConfig(base);
  eq("Standard ist Production", c.environments, ["Production"]);
  eq("App-ID numerisch", c.appAppleId, 123456789);
  eq("Online-Pruefung standardmaessig aus", c.onlineChecks, false);
  eq("Both: Production zuerst, dann Sandbox", readAppleConfig({ ...base, APPLE_IAP_ENVIRONMENT: "Both" }).environments, ["Production", "Sandbox"]);
  eq("Sandbox braucht keine App-ID", readAppleConfig({ APPLE_IAP_BUNDLE_ID: "a", APPLE_IAP_PRODUCT_ID: "b", APPLE_IAP_ENVIRONMENT: "Sandbox" }).appAppleId, null);
  eq("ONLINE_CHECKS=1 schaltet ein", readAppleConfig({ ...base, APPLE_IAP_ONLINE_CHECKS: "1" }).onlineChecks, true);
  eq("Sandbox-Liste leer -> null (alle erlaubt)", c.sandboxUsers, null);
  for (const raw of [`${USER_A},nicht-uuid`, ",,"]) {
    const bad = readAppleConfig({ ...base, APPLE_IAP_SANDBOX_USERS: raw });
    eq(`kaputte Sandbox-Liste "${raw}": wirft NICHT, Sandbox fuer niemanden, Production normal`, [bad.sandboxUsers, bad.sandboxUsersInvalid, bad.environments], [[], true, ["Production"]]);
  }
  eq("Sandbox-Liste: getrimmt und klein geschrieben", readAppleConfig({ ...base, APPLE_IAP_SANDBOX_USERS: ` ${USER_A.toUpperCase()} , ${USER_B}` }).sandboxUsers, [USER_A, USER_B]);
  for (const [name, env] of [
    ["ohne Bundle-ID", { ...base, APPLE_IAP_BUNDLE_ID: "" }],
    ["ohne Produkt-ID", { ...base, APPLE_IAP_PRODUCT_ID: undefined }],
    ["Production ohne App-ID", { ...base, APPLE_IAP_APP_APPLE_ID: "" }],
    ["App-ID mit Buchstaben", { ...base, APPLE_IAP_APP_APPLE_ID: "123abc" }],
    ["unbekannte Umgebung", { ...base, APPLE_IAP_ENVIRONMENT: "Xcode" }],
    ["Umgebung kleingeschrieben", { ...base, APPLE_IAP_ENVIRONMENT: "production" }],
  ] as [string, Record<string, string | undefined>][]) {
    try {
      readAppleConfig(env);
      bad(`Konfiguration abgelehnt: ${name}`, "keine Ausnahme");
    } catch (e) {
      check(`Konfiguration abgelehnt: ${name}`, e instanceof AppleConfigError);
      if (name === "App-ID mit Buchstaben") check("Fehlertext nennt nie den Wert", !String((e as Error).message).includes("123abc"));
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════
console.log("\n3. Signaturpruefung mit eigener Testkette (openssl)");

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

type Chain = { leafKey: KeyObject; x5c: string[]; root: Buffer; dir: string };

function makeChain(): Chain {
  const dir = mkdtempSync(join(tmpdir(), "apple-chain-"));
  const sh = (...a: string[]) => execFileSync("openssl", a, { cwd: dir, stdio: "pipe" });
  // Apples Bibliothek verlangt zwei Apple-Erweiterungen (OIDs) im Blatt- und Zwischenzertifikat.
  writeFileSync(join(dir, "int.ext"), "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign\n1.2.840.113635.100.6.2.1=ASN1:NULL\n");
  writeFileSync(join(dir, "leaf.ext"), "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n1.2.840.113635.100.6.11.1=ASN1:NULL\n");
  for (const n of ["root", "int", "leaf"]) sh("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", `${n}.key`);
  sh("req", "-new", "-x509", "-key", "root.key", "-subj", "/CN=Testwurzel (nicht Apple)", "-days", "3650", "-out", "root.pem", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign");
  sh("req", "-new", "-key", "int.key", "-subj", "/CN=Test-Zwischenzertifikat", "-out", "int.csr");
  sh("x509", "-req", "-in", "int.csr", "-CA", "root.pem", "-CAkey", "root.key", "-CAcreateserial", "-days", "3000", "-extfile", "int.ext", "-out", "int.pem");
  sh("req", "-new", "-key", "leaf.key", "-subj", "/CN=Test-Blatt", "-out", "leaf.csr");
  sh("x509", "-req", "-in", "leaf.csr", "-CA", "int.pem", "-CAkey", "int.key", "-CAcreateserial", "-days", "2000", "-extfile", "leaf.ext", "-out", "leaf.pem");
  const der = (f: string) => new X509Certificate(readFileSync(join(dir, f))).raw;
  return {
    dir,
    leafKey: createPrivateKey(readFileSync(join(dir, "leaf.key"))),
    x5c: [der("leaf.pem"), der("int.pem"), der("root.pem")].map((d) => d.toString("base64")),
    root: der("root.pem"),
  };
}

function jws(chain: Chain, payload: object, opts: { x5c?: string[]; alg?: string; tamper?: boolean } = {}): string {
  const header = b64u(JSON.stringify({ alg: opts.alg ?? "ES256", typ: "JWT", x5c: opts.x5c ?? chain.x5c }));
  let body = b64u(JSON.stringify(payload));
  const sig = sign("sha256", Buffer.from(`${header}.${body}`), { key: chain.leafKey, dsaEncoding: "ieee-p1363" });
  if (opts.tamper) body = b64u(JSON.stringify({ ...payload, productId: "at.example.app.other-but-signed-before" }));
  return `${header}.${body}.${b64u(sig)}`;
}

const BUNDLE = "at.example.app";
const PRODUCT = "at.example.app.pro";
const APP_ID = 123456789;
const NOW = Date.now();

const cfgProd = readAppleConfig({ APPLE_IAP_BUNDLE_ID: BUNDLE, APPLE_IAP_PRODUCT_ID: PRODUCT, APPLE_IAP_APP_APPLE_ID: String(APP_ID) });
const cfgBoth = { ...cfgProd, environments: ["Production", "Sandbox"] as ("Production" | "Sandbox")[] };

const txPayload = (over: Record<string, unknown> = {}) => ({
  originalTransactionId: "2000000000000001",
  transactionId: "2000000000000001",
  bundleId: BUNDLE,
  productId: PRODUCT,
  purchaseDate: NOW - 5000,
  originalPurchaseDate: NOW - 5000,
  type: "Non-Consumable",
  inAppOwnershipType: "PURCHASED",
  environment: "Production",
  signedDate: NOW,
  appAccountToken: USER_A,
  ...over,
});

const chain = makeChain();
try {
  const verifiers = makeVerifierFactory(cfgProd, [chain.root]);
  const verifiersBoth = makeVerifierFactory(cfgBoth, [chain.root]);
  const vt = (s: string, cfg = cfgProd, v = verifiers) => verifyAppleTransaction(s, cfg, v);

  const good = await vt(jws(chain, txPayload()));
  check("gueltige Transaktion wird angenommen", good.ok, JSON.stringify(good));
  if (good.ok) {
    eq("Felder uebernommen (id, Produkt, Umgebung, Token)", [good.tx.originalTransactionId, good.tx.productId, good.tx.environment, good.tx.appAccountToken], ["2000000000000001", PRODUCT, "Production", USER_A]);
    eq("kein revokedAt bei normalem Kauf", good.tx.revokedAt, null);
  }
  const upper = await vt(jws(chain, txPayload({ appAccountToken: USER_A.toUpperCase() })));
  check("Token wird klein geschrieben", upper.ok && upper.tx.appAccountToken === USER_A);
  const noToken = await vt(jws(chain, txPayload({ appAccountToken: undefined })));
  check("fehlender Token -> null", noToken.ok && noToken.tx.appAccountToken === null);
  const rev = await vt(jws(chain, txPayload({ revocationDate: NOW - 1000, revocationReason: 0 })));
  check("revocationDate -> revokedAt gesetzt", rev.ok && rev.tx.revokedAt === new Date(NOW - 1000).toISOString());

  eq("veraenderte Nutzlast (Signatur passt nicht) -> invalid", await vt(jws(chain, txPayload(), { tamper: true })), { ok: false, reason: "invalid" });
  eq("andere Bundle-ID -> wrong_app", await vt(jws(chain, txPayload({ bundleId: "at.fremd.app" }))), { ok: false, reason: "wrong_app" });
  eq("anderes Produkt -> wrong_product", await vt(jws(chain, txPayload({ productId: "at.example.app.other" }))), { ok: false, reason: "wrong_product" });
  eq("Sandbox-Transaktion bei Production -> environment", await vt(jws(chain, txPayload({ environment: "Sandbox" }))), { ok: false, reason: "environment" });
  const sbBoth = await vt(jws(chain, txPayload({ environment: "Sandbox" })), cfgBoth, verifiersBoth);
  check("Sandbox-Transaktion bei Both -> angenommen als Sandbox", sbBoth.ok && sbBoth.tx.environment === "Sandbox");
  eq("Xcode-Umgebung -> abgelehnt", (await vt(jws(chain, txPayload({ environment: "Xcode" })), cfgBoth, verifiersBoth)).ok, false);
  eq("nur zwei Zertifikate in x5c -> invalid", await vt(jws(chain, txPayload(), { x5c: chain.x5c.slice(0, 2) })), { ok: false, reason: "invalid" });
  eq("ohne x5c -> invalid", await vt(jws(chain, txPayload(), { x5c: [] })), { ok: false, reason: "invalid" });
  eq("Signaturzeit vor Gueltigkeit der Zertifikate -> invalid", await vt(jws(chain, txPayload({ signedDate: Date.UTC(1995, 0, 1) }))), { ok: false, reason: "invalid" });
  eq("Muell statt JWS -> invalid", await vt("kein.jws.hier"), { ok: false, reason: "invalid" });
  eq("kaputter Token (kein UUID) -> invalid", await vt(jws(chain, txPayload({ appAccountToken: "nicht-uuid" }))), { ok: false, reason: "invalid" });
  eq("originalTransactionId fehlt -> invalid", await vt(jws(chain, txPayload({ originalTransactionId: undefined }))), { ok: false, reason: "invalid" });
  eq("originalTransactionId mit Buchstaben -> invalid", await vt(jws(chain, txPayload({ originalTransactionId: "20x" }))), { ok: false, reason: "invalid" });
  eq("purchaseDate fehlt -> invalid", await vt(jws(chain, txPayload({ purchaseDate: undefined }))), { ok: false, reason: "invalid" });

  // Der Betriebsweg kennt nur Apples gebuendelte Wurzeln: Die Testkette MUSS dort durchfallen.
  const prodResult = await verifyAppleTransaction(jws(chain, txPayload()), cfgProd);
  eq("BETRIEBSWEG: Testkette (fremde Wurzel) wird abgelehnt", prodResult, { ok: false, reason: "invalid" });

  // Benachrichtigungen
  const note = (type: string, over: Record<string, unknown> = {}, tx: object | null = txPayload({ revocationDate: NOW - 100 }), env = "Production") =>
    jws(chain, {
      notificationType: type,
      notificationUUID: randomUUID(),
      version: "2.0",
      signedDate: NOW,
      data: {
        environment: env,
        bundleId: BUNDLE,
        ...(env === "Production" ? { appAppleId: APP_ID } : {}),
        ...(tx ? { signedTransactionInfo: jws(chain, tx) } : {}),
        ...over,
      },
    });
  const vn = (s: string, cfg = cfgProd, v = verifiers) => verifyAppleNotification(s, cfg, v);
  const refund = await vn(note("REFUND"));
  check("REFUND angenommen, Transaktion mitgeprueft", refund.ok && refund.type === "REFUND" && refund.tx?.revokedAt !== null && !refund.otherProduct, JSON.stringify(refund));
  const other = await vn(note("REFUND", {}, txPayload({ productId: "at.example.app.other" })));
  check("Benachrichtigung zu anderem Produkt -> otherProduct", other.ok && other.otherProduct);
  const test = await vn(note("TEST", {}, null));
  check("TEST ohne Transaktion -> ok, tx null", test.ok && test.tx === null);
  eq("falsche App-ID -> wrong_app", await vn(note("REFUND", { appAppleId: 999 })), { ok: false, reason: "wrong_app" });
  eq("falsche Bundle-ID -> wrong_app", await vn(note("REFUND", { bundleId: "at.fremd.app" })), { ok: false, reason: "wrong_app" });
  eq("Sandbox-Benachrichtigung bei Production -> abgelehnt (andere/keine App-ID)", (await vn(note("REFUND", {}, txPayload({ environment: "Sandbox", revocationDate: NOW }), "Sandbox"))).ok, false);
  const sbn = await vn(note("REFUND", {}, txPayload({ environment: "Sandbox", revocationDate: NOW }), "Sandbox"), cfgBoth, verifiersBoth);
  check("Sandbox-Benachrichtigung bei Both -> angenommen", sbn.ok && sbn.tx?.environment === "Sandbox", JSON.stringify(sbn));
  eq("veraenderte Benachrichtigung -> invalid", (await vn(note("REFUND").replace(/\.[^.]+\./, "." + b64u('{"notificationType":"REFUND","data":{}}') + "."))).ok, false);
  eq("BETRIEBSWEG: Benachrichtigung mit Testkette abgelehnt", (await verifyAppleNotification(note("REFUND"), cfgProd)).ok, false);

  // Familienfreigabe wird im Code abgelehnt
  eq("FAMILY_SHARED -> family_shared", await vt(jws(chain, txPayload({ inAppOwnershipType: "FAMILY_SHARED" }))), { ok: false, reason: "family_shared" });
  eq("Besitzart fehlt -> family_shared (abgelehnt)", await vt(jws(chain, txPayload({ inAppOwnershipType: undefined }))), { ok: false, reason: "family_shared" });
  const famRefund = await vn(note("REFUND", {}, txPayload({ inAppOwnershipType: "FAMILY_SHARED", revocationDate: NOW })));
  check("Erstattung einer FAMILY_SHARED-Transaktion wird angenommen (Entzug gilt immer)", famRefund.ok && famRefund.tx?.revokedAt !== null, JSON.stringify(famRefund));
  const extra = await vn(note("REFUND", { zusatzFeld: 1 }));
  check("zusaetzliche Felder in data stoeren die Pruefung nicht", extra.ok);
} finally {
  rmSync(chain.dir, { recursive: true, force: true });
}

// ═════════════════════════════════════════════════════════════════════════════════════
console.log("\n4. Ops-Katalog kennt die neuen Arten");
for (const k of ["apple_purchase_failed", "apple_purchase_invalid", "apple_purchase_foreign", "apple_purchase_manual", "apple_notification_invalid", "apple_notification_ignored", "apple_anon_cleanup_failed", "stripe_refund_kept", "stripe_dispute"]) {
  check(`Katalog: ${k}`, k in OPS_EVENTS);
}
eq("apple_purchase_failed meldet sofort (error, alertAfter 1)", [OPS_EVENTS.apple_purchase_failed.severity, OPS_EVENTS.apple_purchase_failed.alertAfter], ["error", 1]);

// ═════════════════════════════════════════════════════════════════════════════════════
console.log("\n5. Entscheidungskern gegen Speicher im Arbeitsspeicher");

class FakeStore implements AppleStore {
  purchases = new Map<string, PurchaseRow>();
  profiles = new Map<string, ProfileState>();
  // Konten mit aktivem Stripe-Kauf (pro_purchases: eingelöst, nicht erstattet).
  activeStripe = new Map<string, string | null>();
  // Haken fuer Rennen: laufen EINMAL, direkt bevor die Methode ihre Arbeit tut.
  before: Partial<Record<keyof AppleStore, () => void>> = {};
  failOn: Partial<Record<keyof AppleStore, boolean>> = {};
  private hook(name: keyof AppleStore) {
    if (this.failOn[name]) throw new Error(`Speicher ${name} faellt aus`);
    const h = this.before[name];
    if (h) {
      delete this.before[name];
      h();
    }
  }
  async getPurchase(id: string) {
    this.hook("getPurchase");
    const r = this.purchases.get(id);
    return r ? { ...r, anonHolders: [...r.anonHolders] } : null;
  }
  async insertPurchase(row: PurchaseRow) {
    this.hook("insertPurchase");
    if (this.purchases.has(row.originalTransactionId)) return false;
    this.purchases.set(row.originalTransactionId, { ...row });
    return true;
  }
  async bindPurchase(id: string, userId: string, clearHolders: boolean) {
    this.hook("bindPurchase");
    const r = this.purchases.get(id);
    if (!r || r.userId !== null || r.revokedAt !== null) return false;
    r.userId = userId;
    if (clearHolders) r.anonHolders = [];
    return true;
  }
  async markRevoked(id: string, at: string) {
    this.hook("markRevoked");
    const r = this.purchases.get(id);
    if (r && r.revokedAt === null) r.revokedAt = at;
  }
  async getProfile(userId: string) {
    this.hook("getProfile");
    const p = this.profiles.get(userId);
    return p ? { ...p } : null;
  }
  async grantProIfNotPro(userId: string) {
    this.hook("grantProIfNotPro");
    const p = this.profiles.get(userId);
    if (!p || p.isPro) return false;
    p.isPro = true;
    p.proSource = "apple";
    return true;
  }
  async hasOtherActivePurchase(userId: string, except: string, env: "Production" | "Sandbox") {
    this.hook("hasOtherActivePurchase");
    return [...this.purchases.values()].some(
      (r) =>
        (r.userId === userId || r.anonHolders.includes(userId)) &&
        r.revokedAt === null &&
        r.originalTransactionId !== except &&
        (env === "Sandbox" || r.environment === "Production"),
    );
  }
  async hasActiveStripePurchase(userId: string) {
    this.hook("hasActiveStripePurchase");
    return this.activeStripe.has(userId) ? { customerId: this.activeStripe.get(userId) ?? null } : null;
  }
  async switchAppleProToStripe(userId: string, customerId: string) {
    this.hook("switchAppleProToStripe");
    const p = this.profiles.get(userId);
    if (!p || p.proSource !== "apple" || !p.isPro) return false;
    p.proSource = "stripe";
    p.stripeCustomerId = customerId;
    return true;
  }
  async removeStripeProForCustomer(userId: string, customerId: string) {
    this.hook("removeStripeProForCustomer");
    const p = this.profiles.get(userId);
    if (!p || p.proSource !== "stripe" || p.stripeCustomerId !== customerId || !p.isPro) return false;
    p.isPro = false;
    return true;
  }
  async profileExists(userId: string) {
    this.hook("profileExists");
    return this.profiles.has(userId);
  }
  // Konten aus einem Kauf ohne Konto (Supabase is_anonymous).
  anonymous = new Set<string>();
  async isAnonymousAccount(userId: string) {
    this.hook("isAnonymousAccount");
    return this.profiles.has(userId) && this.anonymous.has(userId);
  }
  // Gelöschte Konten (Regel 2a, Aufräumen). Wie in Supabase: Profil weg, Kauf-Zeilen auf null.
  retired: string[] = [];
  async retireAnonymousAccount(userId: string) {
    this.hook("retireAnonymousAccount");
    if (!this.profiles.has(userId) || !this.anonymous.has(userId)) return false;
    for (const r of this.purchases.values()) {
      if (r.userId === userId || r.anonHolders.includes(userId)) return false;
    }
    this.profiles.delete(userId);
    this.anonymous.delete(userId);
    this.retired.push(userId);
    return true;
  }
  async moveFromAccount(id: string, from: string, to: string, expected: string[]) {
    this.hook("moveFromAccount");
    const r = this.purchases.get(id);
    if (!r || r.userId !== from || r.revokedAt !== null) return false;
    if (JSON.stringify(r.anonHolders) !== JSON.stringify(expected)) return false;
    r.userId = to;
    r.anonHolders = [];
    return true;
  }
  async addAnonHolder(id: string, owner: string, holder: string) {
    this.hook("addAnonHolder");
    const r = this.purchases.get(id);
    if (!r || r.userId !== owner || r.revokedAt !== null) return false;
    if (!r.anonHolders.includes(holder) && r.anonHolders.length >= MAX_ANON_HOLDERS) return false;
    if (!r.anonHolders.includes(holder)) r.anonHolders = [...r.anonHolders, holder];
    return true;
  }
  async listHeldPurchases(userId: string) {
    this.hook("listHeldPurchases");
    return [...this.purchases.values()].filter((r) => r.userId === userId || r.anonHolders.includes(userId)).map((r) => ({ ...r, anonHolders: [...r.anonHolders] }));
  }
  async dropHolder(id: string, holder: string, expected: string[]) {
    this.hook("dropHolder");
    const r = this.purchases.get(id);
    if (!r || JSON.stringify(r.anonHolders) !== JSON.stringify(expected)) return false;
    r.anonHolders = r.anonHolders.filter((h) => h !== holder);
    return true;
  }
  async dropAnonHolder(id: string, owner: string, holder: string, expected: string[]) {
    this.hook("dropAnonHolder");
    const r = this.purchases.get(id);
    if (!r || r.userId !== owner || r.revokedAt !== null) return false;
    if (JSON.stringify(r.anonHolders) !== JSON.stringify(expected)) return false;
    r.anonHolders = r.anonHolders.filter((h) => h !== holder);
    return true;
  }
  async removeAppleProIfApple(userId: string) {
    this.hook("removeAppleProIfApple");
    const p = this.profiles.get(userId);
    if (!p || p.proSource !== "apple" || !p.isPro) return false;
    p.isPro = false;
    return true;
  }
}

const tx = (over: Partial<AppleTx> = {}): AppleTx => ({
  originalTransactionId: "100",
  productId: PRODUCT,
  environment: "Production",
  purchasedAt: new Date(NOW).toISOString(),
  appAccountToken: USER_A,
  revokedAt: null,
  ...over,
});
const fresh = (profiles: Record<string, ProfileState> = {}) => {
  const s = new FakeStore();
  s.profiles.set(USER_A, { isPro: false, proSource: null });
  s.profiles.set(USER_B, { isPro: false, proSource: null });
  for (const [k, v] of Object.entries(profiles)) s.profiles.set(k, v);
  return s;
};
const now = () => new Date(NOW).toISOString();

console.log(" a) Neuer Kauf");
{
  const s = fresh();
  const r = await bindAndGrantApplePro(s, USER_A, tx(), now);
  eq("granted, neu angelegt, Pro geaendert", [r.status, r.status === "granted" && r.newPurchase, r.status === "granted" && r.proChanged], ["granted", true, true]);
  eq("Profil: Pro, Quelle apple", s.profiles.get(USER_A), { isPro: true, proSource: "apple" });
  eq("Zeile gehoert dem Konto", s.purchases.get("100")?.userId, USER_A);
  const again = await bindAndGrantApplePro(s, USER_A, tx(), now);
  eq("zweiter Aufruf: already, keine Aenderung", [again.status, again.status === "already" && again.newPurchase, again.status === "already" && again.proChanged], ["already", false, false]);
  eq("genau eine Zeile", s.purchases.size, 1);
}
{
  const s = fresh();
  const r = await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: null }), now);
  eq("alte Transaktion ohne Token -> an angemeldetes Konto gebunden", [r.status, s.purchases.get("100")?.userId], ["granted", USER_A]);
}

console.log(" b) Zuordnung zum Konto");
{
  const s = fresh();
  const r = await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: USER_B }), now);
  eq("Token zeigt auf anderes Konto -> foreign (token_mismatch)", r, { status: "foreign", originalTransactionId: "100", reason: "token_mismatch" });
  eq("nichts verbucht, niemand Pro", [s.purchases.size, s.profiles.get(USER_A)?.isPro, s.profiles.get(USER_B)?.isPro], [0, false, false]);
}
{
  const s = fresh();
  await bindAndGrantApplePro(s, USER_B, tx({ appAccountToken: USER_B }), now);
  const r = await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: null }), now);
  eq("gehoert lebendem anderem Konto -> foreign (owned_by_other_account)", r, { status: "foreign", originalTransactionId: "100", reason: "owned_by_other_account" });
  eq("Zeile bleibt bei B, A ohne Pro, B behaelt Pro", [s.purchases.get("100")?.userId, s.profiles.get(USER_A)?.isPro, s.profiles.get(USER_B)?.isPro], [USER_B, false, true]);
  const r2 = await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: USER_A }), now);
  eq("auch mit passendem Token: bestehende Zeile hat Vorrang -> foreign", r2.status, "foreign");
}
{
  const s = fresh();
  s.purchases.set("100", { originalTransactionId: "100", userId: null, productId: PRODUCT, environment: "Production", purchasedAt: now(), revokedAt: null, appAccountToken: "99999999-9999-4999-8999-999999999999", anonHolders: [] });
  const r = await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: "99999999-9999-4999-8999-999999999999" }), now);
  eq("user_id null (Konto geloescht) -> an angemeldetes Konto gebunden", [r.status, r.status === "granted" && r.rebound, r.status === "granted" && r.newPurchase, s.purchases.get("100")?.userId], ["granted", true, false, USER_A]);
  eq("... und Pro gesetzt", s.profiles.get(USER_A), { isPro: true, proSource: "apple" });
}

console.log(" b2) Kauf ohne Konto (anonymes Konto, Apple 5.1.1)");
const ANON = "33333333-3333-4333-8333-333333333333";
const ANON2 = "44444444-4444-4444-8444-444444444444";
const withAnon = (...ids: string[]) => {
  const s = fresh();
  for (const id of ids) {
    s.profiles.set(id, { isPro: false, proSource: null });
    s.anonymous.add(id);
  }
  return s;
};
const row = (over: Partial<PurchaseRow> = {}): PurchaseRow => ({
  originalTransactionId: "100", userId: ANON, productId: PRODUCT, environment: "Production", purchasedAt: now(),
  revokedAt: null, appAccountToken: ANON, anonHolders: [], ...over,
});
{
  const s = withAnon(ANON);
  const r = await bindAndGrantApplePro(s, ANON, tx({ appAccountToken: ANON }), now);
  eq("anonymes Konto kauft -> granted, Pro", [r.status, s.profiles.get(ANON)?.isPro], ["granted", true]);
  const moved = await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: ANON }), now);
  eq(
    "2a Anmeldung: Kauf wandert vom anonymen ins echte Konto",
    [moved.status, moved.status === "granted" && moved.fromAnonymous, moved.status === "granted" && moved.rebound, s.purchases.get("100")?.userId],
    ["granted", true, true, USER_A],
  );
  eq("echtes Konto Pro, anonymes nicht mehr", [s.profiles.get(USER_A)?.isPro, s.profiles.get(ANON)?.isPro], [true, false]);
  s.profiles.set(ANON2, { isPro: false, proSource: null });
  s.anonymous.add(ANON2);
  const back = await bindAndGrantApplePro(s, ANON2, tx({ appAccountToken: ANON }), now);
  // Abgemeldetes Geraet derselben Apple-ID (App Review 27.11.2026): teilt mit, Besitzer bleibt das echte Konto.
  eq("2b auch beim echten Besitzer: anonymes Geraet teilt, Zeile bleibt beim echten Konto", [back.status, s.purchases.get("100")?.userId, s.purchases.get("100")?.anonHolders, s.profiles.get(ANON2)?.isPro, s.profiles.get(USER_A)?.isPro], ["granted", USER_A, [ANON2], true, true]);
  const realAgain = await bindAndGrantApplePro(s, USER_B, tx({ appAccountToken: ANON }), now);
  eq("anderes echtes Konto bleibt aussen vor", [realAgain.status === "foreign" && realAgain.reason, s.purchases.get("100")?.userId], ["owned_by_other_account", USER_A]);
  await applyAppleRevocation(s, "100", null, now());
  eq("Erstattung nimmt dem echten Besitzer und dem Mit-Inhaber Pro", [s.profiles.get(USER_A)?.isPro, s.profiles.get(ANON2)?.isPro], [false, false]);
}
{
  const s = withAnon(ANON, ANON2);
  await bindAndGrantApplePro(s, ANON, tx({ appAccountToken: ANON }), now);
  const r = await bindAndGrantApplePro(s, ANON2, tx({ appAccountToken: ANON }), now);
  eq(
    "2b zweites Geraet ohne Konto: Pro geteilt, erstes Geraet behaelt Pro",
    [r.status, s.purchases.get("100")?.userId, s.purchases.get("100")?.anonHolders, s.profiles.get(ANON2)?.isPro, s.profiles.get(ANON)?.isPro],
    ["granted", ANON, [ANON2], true, true],
  );
  const again = await bindAndGrantApplePro(s, ANON2, tx({ appAccountToken: ANON }), now);
  eq("2b wiederholt: already, kein zweiter Eintrag", [again.status, s.purchases.get("100")?.anonHolders], ["already", [ANON2]]);
  const first = await bindAndGrantApplePro(s, ANON, tx({ appAccountToken: ANON }), now);
  eq("erstes Geraet gleicht ab: already, behaelt Pro", [first.status, s.profiles.get(ANON)?.isPro], ["already", true]);
  const moved = await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: ANON }), now);
  eq(
    "2a mit Mit-Inhaber: echtes Konto uebernimmt, beide anonymen verlieren Pro, Liste leer",
    [moved.status, s.purchases.get("100")?.userId, s.purchases.get("100")?.anonHolders, s.profiles.get(ANON)?.isPro, s.profiles.get(ANON2)?.isPro, s.profiles.get(USER_A)?.isPro],
    ["granted", USER_A, [], false, false, true],
  );
}
{
  const s = withAnon(ANON, ANON2);
  await bindAndGrantApplePro(s, ANON, tx({ appAccountToken: ANON }), now);
  await bindAndGrantApplePro(s, ANON2, tx({ appAccountToken: ANON }), now);
  const rv = await applyAppleRevocation(s, "100", null, now());
  eq("Erstattung erreicht Besitzer UND Mit-Inhaber", [rv.status, rv.proRemoved, s.profiles.get(ANON)?.isPro, s.profiles.get(ANON2)?.isPro], ["revoked", true, false, false]);
}
{
  const s = withAnon(ANON);
  const r = await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: ANON }), now);
  eq(
    "ohne Konto gekauft, erst nach der Anmeldung verbucht (Token anonym) -> gebunden",
    [r.status, r.status === "granted" && r.fromAnonymous, r.status === "granted" && r.newPurchase, s.purchases.get("100")?.userId, s.profiles.get(USER_A)?.isPro],
    ["granted", true, true, USER_A, true],
  );
}
{
  const s = withAnon(ANON);
  const r = await bindAndGrantApplePro(s, ANON, tx({ appAccountToken: USER_B }), now);
  eq("Token eines echten Kontos, gefragt anonym -> needs_sign_in, nichts verbucht", [r.status === "foreign" && r.reason, s.purchases.size], ["needs_sign_in", 0]);
  const real = await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: USER_B }), now);
  eq("dasselbe von einem echten Konto -> token_mismatch (bleibt laut)", real.status === "foreign" && real.reason, "token_mismatch");
}
{
  const s = withAnon(ANON);
  s.profiles.set(ANON, { isPro: true, proSource: "apple" });
  s.purchases.set("100", row());
  s.purchases.set("101", row({ originalTransactionId: "101" }));
  await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: ANON }), now);
  eq("anderer Kauf haelt das anonyme Pro am Leben", s.profiles.get(ANON)?.isPro, true);
}
{
  const s = withAnon(ANON);
  s.profiles.set(ANON, { isPro: true, proSource: "comp" });
  s.purchases.set("100", row());
  await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: ANON }), now);
  eq("Pro aus anderer Quelle am anonymen Konto bleibt (nur pro_source apple endet)", s.profiles.get(ANON), { isPro: true, proSource: "comp" });
}
{
  const s = withAnon(ANON);
  s.purchases.set("100", row({ revokedAt: now() }));
  const r = await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: ANON }), now);
  eq("erstattete Zeile eines anonymen Kontos wandert nicht", [r.status, s.purchases.get("100")?.userId], ["revoked", ANON]);
}
{
  // Rennen: Zwischen Lesen und Umbinden bindet ein anderes Geraet (echtes Konto B) die Zeile um.
  const s = withAnon(ANON);
  s.purchases.set("100", row());
  s.before.moveFromAccount = () => {
    s.purchases.get("100")!.userId = USER_B;
  };
  const r = await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: ANON }), now);
  eq("Rennen beim Umbinden: neu bewertet -> gehoert jetzt B -> foreign", [r.status, s.purchases.get("100")?.userId], ["foreign", USER_B]);
}
{
  // Ausfall zwischen Wegnehmen und Umbinden: Der anonyme Besitzer hat Pro verloren, die Zeile ist
  // noch seine. Sein naechster Abgleich heilt das (already + ensurePro).
  const s = withAnon(ANON);
  s.profiles.set(ANON, { isPro: true, proSource: "apple" });
  s.purchases.set("100", row());
  s.failOn.moveFromAccount = true;
  let threw = false;
  try {
    await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: ANON }), now);
  } catch {
    threw = true;
  }
  s.failOn.moveFromAccount = false;
  eq("Ausfall beim Umbinden: Fehler, Zeile bleibt beim anonymen, dessen Pro vorerst weg", [threw, s.purchases.get("100")?.userId, s.profiles.get(ANON)?.isPro], [true, ANON, false]);
  const heal = await bindAndGrantApplePro(s, ANON, tx({ appAccountToken: ANON }), now);
  eq("  naechster Abgleich des anonymen Geraets heilt (already, Pro wieder da)", [heal.status, s.profiles.get(ANON)?.isPro], ["already", true]);
}
{
  // Rennen Erstattung gegen Umbinden: Die Erstattung liest Besitzer ANON, dann bindet ein echtes
  // Konto um und bekommt Pro, erst dann markiert die Erstattung. Der frisch gelesene Besitzer
  // verliert Pro.
  const s = withAnon(ANON);
  s.profiles.set(ANON, { isPro: true, proSource: "apple" });
  s.purchases.set("100", row());
  s.before.markRevoked = () => {
    const r = s.purchases.get("100")!;
    r.userId = USER_A;
    s.profiles.set(USER_A, { isPro: true, proSource: "apple" });
    s.profiles.set(ANON, { isPro: false, proSource: "apple" });
  };
  const rv = await applyAppleRevocation(s, "100", null, now());
  eq("Erstattung nach Umbinden trifft den neuen Besitzer", [rv.status, s.profiles.get(USER_A)?.isPro], ["revoked", false]);
}
{
  const s = withAnon(ANON);
  await bindAndGrantApplePro(s, ANON, tx({ appAccountToken: ANON }), now);
  await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: ANON }), now);
  const rv = await applyAppleRevocation(s, "100", null, now());
  eq("Erstattung nach dem Umzug: echtes Konto verliert Pro", [rv.status, s.profiles.get(USER_A)?.isPro], ["revoked", false]);
}
{
  const s = withAnon(ANON);
  s.purchases.set("100", row());
  const extra = ["a1", "a2", "a3", "a4", "a5"].map((x, i) => `6666666${i}-6666-4666-8666-666666666666`);
  for (const id of extra) {
    s.profiles.set(id, { isPro: false, proSource: null });
    s.anonymous.add(id);
  }
  const out: string[] = [];
  for (const id of extra) {
    const r = await bindAndGrantApplePro(s, id, tx({ appAccountToken: ANON }), now);
    out.push(r.status === "foreign" ? r.reason : r.status);
  }
  eq(`Grenze: hoechstens ${MAX_ANON_HOLDERS} anonyme Mit-Inhaber, der naechste bekommt holder_limit`, out, ["granted", "granted", "granted", "granted", "holder_limit"]);
  eq("  der abgewiesene bekommt kein Pro", s.profiles.get(extra[4])?.isPro, false);
}
{
  // Echter Besitzer: Jedes Abmelden legt in der App ein neues anonymes Konto an. Die Liste darf nicht
  // volllaufen: Das neue Geraet verdraengt den aeltesten Mit-Inhaber (App-Review-Pruefung 27.11.2026).
  const s = withAnon(ANON);
  s.purchases.set("100", row({ userId: USER_A, appAccountToken: USER_A }));
  s.profiles.set(USER_A, { isPro: true, proSource: "apple" });
  const extra = ["b1", "b2", "b3", "b4", "b5"].map((x, i) => `7777777${i}-7777-4777-8777-777777777777`);
  for (const id of extra) {
    s.profiles.set(id, { isPro: false, proSource: null });
    s.anonymous.add(id);
  }
  const out: string[] = [];
  for (const id of extra) {
    const r = await bindAndGrantApplePro(s, id, tx({ appAccountToken: USER_A }), now);
    out.push(r.status === "foreign" ? r.reason : r.status);
  }
  eq("Echter Besitzer, volle Liste: das fuenfte Geraet verdraengt das aelteste", out, ["granted", "granted", "granted", "granted", "granted"]);
  eq("  Liste: die vier juengsten, Besitzer unveraendert", [s.purchases.get("100")?.anonHolders, s.purchases.get("100")?.userId], [extra.slice(1), USER_A]);
  eq("  der verdraengte verliert Pro, der neue und der Besitzer haben es", [s.profiles.get(extra[0])?.isPro, s.profiles.get(extra[4])?.isPro, s.profiles.get(USER_A)?.isPro], [false, true, true]);
  // Besitzer loescht sein Konto (Zeile auf null), dann bindet ein neues echtes Konto (Regel 3):
  // Die uebrigen anonymen Mit-Inhaber verlieren Pro.
  s.purchases.get("100")!.userId = null;
  s.profiles.delete(USER_A);
  const rebound = await bindAndGrantApplePro(s, USER_B, tx({ appAccountToken: USER_A }), now);
  eq("  nach Loeschung bindet ein neues echtes Konto, Mit-Inhaber verlieren Pro", [rebound.status, s.purchases.get("100")?.userId, extra.slice(1).map((id) => s.profiles.get(id)?.isPro)], ["granted", USER_B, [false, false, false, false]]);
}
{
  // Rennen A: Zwischen Lesen und Umzug traegt sich ein weiteres anonymes Geraet ein (mit Pro).
  const ANON3 = "77777777-7777-4777-8777-777777777777";
  const s = withAnon(ANON, ANON3);
  s.profiles.set(ANON, { isPro: true, proSource: "apple" });
  s.purchases.set("100", row());
  s.before.moveFromAccount = () => {
    s.purchases.get("100")!.anonHolders = [ANON3];
    s.profiles.set(ANON3, { isPro: true, proSource: "apple" });
  };
  const r = await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: ANON }), now);
  eq(
    "Rennen A: Umzug scheitert an der neuen Liste, neu bewertet, auch der neue Mit-Inhaber verliert Pro",
    [r.status, s.purchases.get("100")?.userId, s.purchases.get("100")?.anonHolders, s.profiles.get(ANON3)?.isPro, s.profiles.get(USER_A)?.isPro],
    ["granted", USER_A, [], false, true],
  );
}
{
  // Rennen B: Ein anonymes Geraet traegt sich ein, dann zieht der Kauf ins echte Konto um (Liste
  // geleert), und erst danach schaltet das Geraet sein Pro frei. Die Nachpruefung nimmt es zurueck.
  const s = withAnon(ANON, ANON2);
  s.purchases.set("100", row());
  s.before.getProfile = () => {
    const r = s.purchases.get("100")!;
    r.userId = USER_A;
    r.anonHolders = [];
  };
  const r = await bindAndGrantApplePro(s, ANON2, tx({ appAccountToken: ANON }), now);
  // Nach dem Umzug neu bewertet: Das Geraet teilt jetzt mit dem echten Konto (Regel 2b), steht also wieder in einer Zeile.
  eq("Rennen B: neu bewertet, Mit-Inhaber beim echten Konto", [r.status, s.purchases.get("100")?.userId, s.purchases.get("100")?.anonHolders, s.profiles.get(ANON2)?.isPro], ["granted", USER_A, [ANON2], true]);
}
{
  // Rennen B2: Ein eingetragener Mit-Inhaber holt sich Pro NACH der ersten Freigabe, aber VOR dem
  // Umzug (seine Nachpruefung sah ihn noch in der Liste). Die zweite Freigabe nach dem Umzug greift.
  const ANON3 = "77777777-7777-4777-8777-777777777777";
  const s = withAnon(ANON, ANON3);
  s.purchases.set("100", row({ anonHolders: [ANON3] }));
  s.before.moveFromAccount = () => {
    s.profiles.set(ANON3, { isPro: true, proSource: "apple" });
  };
  const r = await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: ANON }), now);
  eq("Rennen B2: Mit-Inhaber verliert Pro trotz spaeter Freischaltung", [r.status, s.purchases.get("100")?.anonHolders, s.profiles.get(ANON3)?.isPro], ["granted", [], false]);
}
{
  // Regel 3 mit Mit-Inhabern: Der anonyme Besitzer wurde geloescht, ein echtes Konto bindet.
  const s = withAnon(ANON2);
  s.profiles.set(ANON2, { isPro: true, proSource: "apple" });
  s.purchases.set("100", row({ userId: null, anonHolders: [ANON2] }));
  const r = await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: ANON }), now);
  eq("Regel 3: echtes Konto bindet, uebrige anonyme Mit-Inhaber verlieren Pro, Liste leer", [r.status, s.purchases.get("100")?.userId, s.purchases.get("100")?.anonHolders, s.profiles.get(ANON2)?.isPro], ["granted", USER_A, [], false]);
}
{
  const s = fresh();
  s.anonymous.add("55555555-5555-4555-8555-555555555555");
  eq("Konto ohne Profil zaehlt nie als anonym", await s.isAnonymousAccount("55555555-5555-4555-8555-555555555555"), false);
}

console.log(" c) Wiederherstellen: viele Transaktionen, jede fuer sich");
{
  const s = fresh();
  s.purchases.set("200", { originalTransactionId: "200", userId: USER_B, productId: PRODUCT, environment: "Production", purchasedAt: now(), revokedAt: null, appAccountToken: USER_B, anonHolders: [] });
  s.purchases.set("300", { originalTransactionId: "300", userId: null, productId: PRODUCT, environment: "Production", purchasedAt: now(), revokedAt: null, appAccountToken: null, anonHolders: [] });
  const inputs = [tx({ originalTransactionId: "100", appAccountToken: USER_A }), tx({ originalTransactionId: "200", appAccountToken: null }), tx({ originalTransactionId: "300", appAccountToken: null }), tx({ originalTransactionId: "400", appAccountToken: USER_B })];
  const out: string[] = [];
  for (const t of inputs) out.push((await bindAndGrantApplePro(s, USER_A, t, now)).status);
  eq("neu / fremd / gebunden / Token-fremd, unabhaengig voneinander", out, ["granted", "foreign", "granted", "foreign"]);
  eq("B unberuehrt", s.purchases.get("200")?.userId, USER_B);
  eq("A besitzt 100 und 300", [s.purchases.get("100")?.userId, s.purchases.get("300")?.userId], [USER_A, USER_A]);
}

console.log(" d) pro_source-Regel: ist is_pro schon true, bleibt die Quelle");
for (const source of ["stripe", "comp", "migration", "apple"]) {
  const s = fresh({ [USER_A]: { isPro: true, proSource: source } });
  const r = await bindAndGrantApplePro(s, USER_A, tx(), now);
  eq(`Quelle ${source} bleibt`, s.profiles.get(USER_A), { isPro: true, proSource: source });
  eq(`  Pro nicht von Apple gesetzt (proChanged false, keine Conversion)`, r.status === "granted" && r.proChanged, false);
  eq(`  Kauf ist trotzdem verbucht${source === "apple" ? "" : " und als doppelt gemeldet"}`, [s.purchases.has("100"), r.status === "granted" && r.alreadyEntitledBy], [true, source === "apple" ? null : source]);
}
{
  // Nach Erstattung steht pro_source weiter auf stripe, aber is_pro ist false: Apple darf dann.
  const s = fresh({ [USER_A]: { isPro: false, proSource: "stripe" } });
  await bindAndGrantApplePro(s, USER_A, tx(), now);
  eq("is_pro false (alte Stripe-Herkunft) -> wird apple", s.profiles.get(USER_A), { isPro: true, proSource: "apple" });
}
{
  const s = fresh();
  s.before.grantProIfNotPro = () => s.profiles.set(USER_A, { isPro: true, proSource: "comp" });
  const r = await bindAndGrantApplePro(s, USER_A, tx(), now);
  eq("Rennen: Geschenk kommt zwischen Lesen und Schreiben -> comp bleibt", [s.profiles.get(USER_A), r.status === "granted" && r.alreadyEntitledBy], [{ isPro: true, proSource: "comp" }, "comp"]);
}
{
  const s = fresh();
  await bindAndGrantApplePro(s, USER_A, tx(), now);
  s.profiles.set(USER_A, { isPro: false, proSource: "apple" });
  const r = await bindAndGrantApplePro(s, USER_A, tx(), now);
  eq("Reparatur: Zeile da, Schalter aus -> wiederholter Aufruf schaltet", [r.status, s.profiles.get(USER_A)?.isPro], ["already", true]);
}

console.log(" e) Entzug (REFUND/REVOKE)");
{
  const s = fresh();
  await bindAndGrantApplePro(s, USER_A, tx(), now);
  const r = await applyAppleRevocation(s, "100", tx(), now());
  eq("einziger Kauf, Quelle apple -> Pro weg", [r.status, r.proRemoved, s.profiles.get(USER_A)], ["revoked", true, { isPro: false, proSource: "apple" }]);
  eq("revoked_at gesetzt", s.purchases.get("100")?.revokedAt, now());
  const r2 = await applyAppleRevocation(s, "100", tx(), now());
  eq("zweite Zustellung: idempotent", [r2.status, r2.proRemoved], ["already_revoked", false]);
}
for (const source of ["stripe", "comp", "migration"]) {
  const s = fresh({ [USER_A]: { isPro: true, proSource: source } });
  await bindAndGrantApplePro(s, USER_A, tx(), now);
  const r = await applyAppleRevocation(s, "100", tx(), now());
  eq(`Quelle ${source}: Apple-Erstattung entzieht NICHTS`, [r.proRemoved, s.profiles.get(USER_A)], [false, { isPro: true, proSource: source }]);
  eq(`  ... aber die Zeile ist erstattet`, s.purchases.get("100")?.revokedAt !== null, true);
}
{
  const s = fresh();
  await bindAndGrantApplePro(s, USER_A, tx({ originalTransactionId: "100" }), now);
  await bindAndGrantApplePro(s, USER_A, tx({ originalTransactionId: "101" }), now);
  const r1 = await applyAppleRevocation(s, "100", tx({ originalTransactionId: "100" }), now());
  eq("zwei Kaeufe: erste Erstattung -> Pro bleibt", [r1.proRemoved, s.profiles.get(USER_A)?.isPro], [false, true]);
  const r2 = await applyAppleRevocation(s, "101", tx({ originalTransactionId: "101" }), now());
  eq("zweite Erstattung -> Pro weg", [r2.proRemoved, s.profiles.get(USER_A)?.isPro], [true, false]);
}
{
  const s = fresh();
  const r = await applyAppleRevocation(s, "555", tx({ originalTransactionId: "555" }), now());
  eq("unbekannte Transaktion: erstattete Zeile ohne Konto angelegt", [r.status, s.purchases.get("555")?.userId, s.purchases.get("555")?.revokedAt], ["tombstoned", null, now()]);
  const late = await bindAndGrantApplePro(s, USER_A, tx({ originalTransactionId: "555", appAccountToken: null }), now);
  eq("... eine spaet eingereichte, vor der Erstattung signierte Transaktion bringt KEIN Pro", [late.status, s.profiles.get(USER_A)?.isPro], ["revoked", false]);
  eq("... Zeile bleibt ohne Konto", s.purchases.get("555")?.userId, null);
  eq("Entzug ohne Wissen und ohne Transaktion: unknown, nichts angelegt", (await applyAppleRevocation(s, "777", null, now())).status, "unknown");
  eq("... keine Zeile 777", s.purchases.has("777"), false);
}
{
  const s = fresh();
  await bindAndGrantApplePro(s, USER_A, tx(), now);
  await applyAppleRevocation(s, "100", tx(), now());
  const again = await bindAndGrantApplePro(s, USER_A, tx(), now);
  eq("nach Erstattung: dieselbe Transaktion nochmal -> revoked, kein Pro", [again.status, s.profiles.get(USER_A)?.isPro], ["revoked", false]);
  const other = await bindAndGrantApplePro(s, USER_B, tx({ appAccountToken: null }), now);
  eq("nach Erstattung: anderes Konto -> revoked", [other.status, s.profiles.get(USER_B)?.isPro], ["revoked", false]);
}
{
  const s = fresh();
  await bindAndGrantApplePro(s, USER_A, tx(), now);
  const r = await bindAndGrantApplePro(s, USER_A, tx({ revokedAt: now() }), now);
  eq("signierte Transaktion mit revocationDate -> Entzug", [r.status, s.profiles.get(USER_A)?.isPro, s.purchases.get("100")?.revokedAt], ["revoked", false, now()]);
  const fresh2 = fresh();
  const r2 = await bindAndGrantApplePro(fresh2, USER_A, tx({ revokedAt: now() }), now);
  eq("neue, schon erstattete Transaktion -> revoked, nichts verbucht", [r2.status, fresh2.purchases.size, fresh2.profiles.get(USER_A)?.isPro], ["revoked", 0, false]);
}
{
  const s = fresh();
  s.before.grantProIfNotPro = () => {
    const r = s.purchases.get("100");
    if (r) r.revokedAt = now();
  };
  const r = await bindAndGrantApplePro(s, USER_A, tx(), now);
  eq("Rennen Kauf gegen Erstattung: Pro wird zurueckgenommen", [r.status === "granted" && r.proChanged, s.profiles.get(USER_A)?.isPro], [false, false]);
}
{
  const s = fresh();
  await bindAndGrantApplePro(s, USER_A, tx(), now);
  s.failOn.removeAppleProIfApple = true;
  await throws("Entzug scheitert mitten drin -> wirft (Apple stellt erneut zu)", () => applyAppleRevocation(s, "100", tx(), now()), /faellt aus/);
  eq("... revoked_at steht, Pro noch an", [s.purchases.get("100")?.revokedAt !== null, s.profiles.get(USER_A)?.isPro], [true, true]);
  s.failOn.removeAppleProIfApple = false;
  const heal = await applyAppleRevocation(s, "100", tx(), now());
  eq("Wiederholung heilt: Pro weg", [heal.status, heal.proRemoved, s.profiles.get(USER_A)?.isPro], ["already_revoked", true, false]);
}

console.log(" f) Rennen und Ausfaelle beim Zuordnen");
{
  const s = fresh();
  s.before.insertPurchase = () => {
    s.purchases.set("100", { originalTransactionId: "100", userId: USER_B, productId: PRODUCT, environment: "Production", purchasedAt: now(), revokedAt: null, appAccountToken: null, anonHolders: [] });
  };
  const r = await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: null }), now);
  eq("Einfuegen verliert das Rennen gegen anderes Konto -> foreign", [r.status, s.purchases.get("100")?.userId, s.profiles.get(USER_A)?.isPro], ["foreign", USER_B, false]);
}
{
  const s = fresh();
  s.purchases.set("100", { originalTransactionId: "100", userId: null, productId: PRODUCT, environment: "Production", purchasedAt: now(), revokedAt: null, appAccountToken: null, anonHolders: [] });
  s.before.bindPurchase = () => {
    s.purchases.get("100")!.userId = USER_B;
  };
  const r = await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: null }), now);
  eq("Binden verliert das Rennen -> neu bewertet, foreign", [r.status, s.purchases.get("100")?.userId], ["foreign", USER_B]);
}
{
  const s = fresh();
  s.profiles.delete(USER_A);
  await throws("Konto ohne Profil -> Fehler statt falschem 'granted'", () => bindAndGrantApplePro(s, USER_A, tx(), now), /kein Profil/);
}
for (const m of ["getPurchase", "insertPurchase", "getProfile", "grantProIfNotPro"] as const) {
  const s = fresh();
  s.failOn[m] = true;
  await throws(`Speicherausfall in ${m} -> wirft (Route: 503, App wiederholt)`, () => bindAndGrantApplePro(s, USER_A, tx(), now), /faellt aus/);
}
{
  const s = fresh();
  s.failOn.grantProIfNotPro = true;
  await throws("Schalter scheitert nach Verbuchen -> wirft", () => bindAndGrantApplePro(s, USER_A, tx(), now));
  s.failOn.grantProIfNotPro = false;
  const r = await bindAndGrantApplePro(s, USER_A, tx(), now);
  eq("... Wiederholung stellt den Schalter fertig", [r.status, s.profiles.get(USER_A)], ["already", { isPro: true, proSource: "apple" }]);
}

console.log(" g) Doppelt bezahlt (Stripe + Apple): Erstattung bei Apple nimmt Pro nicht weg");
{
  const s = fresh();
  await bindAndGrantApplePro(s, USER_A, tx(), now);
  s.activeStripe.set(USER_A, "cus_1");
  const r = await applyAppleRevocation(s, "100", tx(), now());
  eq("Apple-Erstattung, aktiver Stripe-Kauf -> Quelle stripe MIT Kunden-ID, Pro bleibt", [r.proRemoved, r.switchedToStripe, s.profiles.get(USER_A)], [false, true, { isPro: true, proSource: "stripe", stripeCustomerId: "cus_1" }]);
  const again = await applyAppleRevocation(s, "100", tx(), now());
  eq("... zweite Zustellung aendert nichts mehr", [again.proRemoved, again.switchedToStripe, s.profiles.get(USER_A)?.proSource], [false, false, "stripe"]);
}
{
  const s = fresh();
  await bindAndGrantApplePro(s, USER_A, tx(), now);
  const r = await applyAppleRevocation(s, "100", tx(), now());
  eq("ohne Stripe-Kauf: Entzug wie gehabt", [r.proRemoved, r.switchedToStripe, r.stripeWithoutCustomer], [true, false, false]);
}
{
  const s = fresh();
  await bindAndGrantApplePro(s, USER_A, tx(), now);
  s.activeStripe.set(USER_A, null);
  const r = await applyAppleRevocation(s, "100", tx(), now());
  eq("aktiver Stripe-Kauf OHNE Kunden-ID: nicht umstellbar -> Pro entzogen und gemeldet", [r.proRemoved, r.switchedToStripe, r.stripeWithoutCustomer, s.profiles.get(USER_A)?.isPro], [true, false, true, false]);
}
{
  // Rennen: Die Stripe-Erstattung kommt zwischen Pruefung und Umstellung. revokePro() fand
  // noch pro_source = 'apple' (nichts zu tun); nach der Umstellung muss der Apple-Weg selbst entziehen.
  const s = fresh();
  await bindAndGrantApplePro(s, USER_A, tx(), now);
  s.activeStripe.set(USER_A, "cus_1");
  s.before.switchAppleProToStripe = () => s.activeStripe.delete(USER_A);
  const r = await applyAppleRevocation(s, "100", tx(), now());
  eq("Rennen zwei Erstattungen: Pro wird entzogen, nichts bleibt stehen", [r.proRemoved, r.switchedToStripe, s.profiles.get(USER_A)], [true, false, { isPro: false, proSource: "stripe", stripeCustomerId: "cus_1" }]);
}
{
  // Stripe-Erstattung nach der Umstellung entzieht (echtes revokePro gegen Attrappen-Tabellen)
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-key";
  const realFetch = globalThis.fetch;
  const tables: Record<string, Record<string, unknown>[]> = { profiles: [], pro_purchases: [], apple_purchases: [] };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const table = url.pathname.split("/").pop() as string;
    const rows = tables[table] ?? [];
    const match = (r: Record<string, unknown>) =>
      [...url.searchParams.entries()].every(([k, v]) => {
        if (k === "select" || k === "limit") return true;
        if (k === "or") {
          // Nur was revokePro braucht: "spalte.eq.wert,spalte.in.(a,b)".
          const parts = v.replace(/^\(|\)$/g, "").match(/[a-z_]+\.(eq\.[^,]+|in\.\([^)]*\))/g) ?? [];
          return parts.some((part) => {
            const [col, op, ...rest] = part.split(".");
            const val = rest.join(".");
            if (op === "eq") return String(r[col]) === val;
            return val.replace(/[()]/g, "").split(",").includes(String(r[col]));
          });
        }
        if (v.startsWith("eq.")) return String(r[k]) === v.slice(3);
        if (v.startsWith("in.")) return v.slice(4, -1).split(",").includes(String(r[k]));
        if (v === "is.null") return r[k] == null;
        if (v === "not.is.null") return r[k] != null;
        throw new Error(`Filter ${k}=${v} kennt die Attrappe nicht`);
      });
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PATCH") {
      const hit = rows.filter(match);
      for (const r of hit) Object.assign(r, JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(hit), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (method === "GET") {
      return new Response(JSON.stringify(rows.filter(match)), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unerwartet ${url.href}`);
  }) as typeof fetch;
  try {
    const { revokePro } = await import("@/lib/pro-purchase");
    const s = fresh();
    await bindAndGrantApplePro(s, USER_A, tx(), now);
    s.activeStripe.set(USER_A, "cus_1");
    await applyAppleRevocation(s, "100", tx(), now());
    const p = s.profiles.get(USER_A)!;
    const row: Record<string, unknown> = { id: USER_A, is_pro: p.isPro, pro_source: p.proSource, stripe_customer_id: p.stripeCustomerId ?? null };
    tables.profiles = [row];
    await revokePro("cus_1");
    eq("danach Stripe-Erstattung (echtes revokePro) -> Pro weg", row.is_pro, false);
    // Gegenprobe: ohne die Kunden-ID am Profil (alter Stand) bliebe Pro stehen
    const old: Record<string, unknown> = { id: USER_A, is_pro: true, pro_source: "stripe", stripe_customer_id: null };
    tables.profiles = [old];
    await revokePro("cus_1");
    eq("GEGENPROBE: ohne Kunden-ID am Profil greift revokePro nicht", old.is_pro, true);
    // Doppelt gekauft (Anton 27.11.2026): Web-Pro plus bezahlter Apple-Kauf. Stripe erstattet, Pro
    // laeuft ueber Apple weiter, Quelle wird 'apple', der Anspruch ist abgeraeumt.
    const both: Record<string, unknown> = { id: USER_B, is_pro: true, pro_source: "stripe", stripe_customer_id: "cus_2" };
    const claim: Record<string, unknown> = { stripe_customer_id: "cus_2", refunded_at: null };
    tables.profiles = [both];
    tables.pro_purchases = [claim];
    tables.apple_purchases = [{ original_transaction_id: "200", user_id: USER_B, environment: "Production", revoked_at: null }];
    await revokePro("cus_2");
    eq("echtes revokePro: bezahlter Apple-Kauf haelt Pro, Quelle apple, Anspruch erstattet", [both.is_pro, both.pro_source, claim.refunded_at !== null], [true, "apple", true]);
    // Nur ein Sandbox-Kauf (TestFlight, kostet nichts): Pro geht.
    const sb: Record<string, unknown> = { id: USER_B, is_pro: true, pro_source: "stripe", stripe_customer_id: "cus_3" };
    tables.profiles = [sb];
    tables.apple_purchases = [{ original_transaction_id: "201", user_id: USER_B, environment: "Sandbox", revoked_at: null }];
    await revokePro("cus_3");
    eq("echtes revokePro: Sandbox-Kauf haelt kein Pro", [sb.is_pro, sb.pro_source], [false, "stripe"]);
    // Je Zahlung im echten Speicher-Code: Kauf 1 erstattet (zweimal zugestellt), Kauf 2 bezahlt.
    const two: Record<string, unknown> = { id: USER_A, is_pro: true, pro_source: "stripe", stripe_customer_id: "cus_4" };
    const k1: Record<string, unknown> = { stripe_session_id: "cs_1", stripe_payment_intent: "pi_1", stripe_customer_id: "cus_4", user_id: USER_A, granted_at: "x", refunded_at: null };
    const k2: Record<string, unknown> = { stripe_session_id: "cs_2", stripe_payment_intent: "pi_2", stripe_customer_id: "cus_4", user_id: USER_A, granted_at: "x", refunded_at: null };
    tables.profiles = [two];
    tables.pro_purchases = [k1, k2];
    tables.apple_purchases = [];
    await revokePro("cus_4", "pi_1");
    await revokePro("cus_4", "pi_1");
    eq("echtes revokePro je Zahlung: Kauf 1 erstattet (zweimal), Kauf 2 und Pro bleiben", [k1.refunded_at !== null, k2.refunded_at, two.is_pro], [true, null, true]);
    await revokePro("cus_4", "pi_2");
    eq("echtes revokePro je Zahlung: Kauf 2 erstattet, Pro weg", [k2.refunded_at !== null, two.is_pro], [true, false]);
    // Alter Kauf ohne payment_intent: unbekannte Zahlung erstattet die ganze Kunden-ID.
    const old2: Record<string, unknown> = { id: USER_A, is_pro: true, pro_source: "stripe", stripe_customer_id: "cus_5" };
    const k3: Record<string, unknown> = { stripe_session_id: "cs_3", stripe_payment_intent: null, stripe_customer_id: "cus_5", user_id: USER_A, granted_at: "x", refunded_at: null };
    tables.profiles = [old2];
    tables.pro_purchases = [k3];
    await revokePro("cus_5", "pi_neu");
    eq("echtes revokePro: alter Kauf ohne payment_intent wird ueber die Kunden-ID erstattet", [k3.refunded_at !== null, old2.is_pro], [true, false]);
    // Zwei Gast-Kaeufe mit zwei Kunden-IDs im echten Speicher-Code.
    const guest: Record<string, unknown> = { id: USER_A, is_pro: true, pro_source: "stripe", stripe_customer_id: "cus_6" };
    const g1: Record<string, unknown> = { stripe_session_id: "cs_6", stripe_payment_intent: "pi_6", stripe_customer_id: "cus_6", user_id: USER_A, granted_at: "x", refunded_at: null };
    const g2: Record<string, unknown> = { stripe_session_id: "cs_7", stripe_payment_intent: "pi_7", stripe_customer_id: "cus_7", user_id: USER_A, granted_at: "x", refunded_at: null };
    tables.profiles = [guest];
    tables.pro_purchases = [g1, g2];
    await revokePro("cus_6", "pi_6");
    eq("echtes revokePro: zwei Gast-Kaeufe, erster erstattet, Pro bleibt", guest.is_pro, true);
    await revokePro("cus_7", "pi_7");
    eq("echtes revokePro: zweiter (andere Kunden-ID) erstattet, Pro weg", guest.is_pro, false);
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log(" h) Umgebungen bleiben getrennt");
{
  const s = fresh();
  await bindAndGrantApplePro(s, USER_A, tx(), now);
  const sb = await bindAndGrantApplePro(s, USER_A, tx({ environment: "Sandbox" }), now);
  eq("gleiche ID in Sandbox bei Production-Zeile -> invalid (environment_mismatch)", sb, { status: "invalid", originalTransactionId: "100", reason: "environment_mismatch" });
  const rv = await applyAppleRevocation(s, "100", tx({ environment: "Sandbox" }), now());
  eq("Sandbox-ID kann Production-Zeile nicht erstatten", [rv.status, s.purchases.get("100")?.revokedAt, s.profiles.get(USER_A)?.isPro], ["environment_mismatch", null, true]);
}
{
  const s = fresh();
  await bindAndGrantApplePro(s, USER_A, tx({ originalTransactionId: "P1" }), now);
  await bindAndGrantApplePro(s, USER_A, tx({ originalTransactionId: "S1", environment: "Sandbox" }), now);
  const r = await applyAppleRevocation(s, "P1", tx({ originalTransactionId: "P1" }), now());
  eq("Production-Erstattung: Sandbox-Kauf haelt Pro NICHT am Leben", [r.proRemoved, s.profiles.get(USER_A)?.isPro], [true, false]);
}
{
  const s = fresh();
  await bindAndGrantApplePro(s, USER_A, tx({ originalTransactionId: "P1" }), now);
  await bindAndGrantApplePro(s, USER_A, tx({ originalTransactionId: "S1", environment: "Sandbox" }), now);
  const r = await applyAppleRevocation(s, "S1", tx({ originalTransactionId: "S1", environment: "Sandbox" }), now());
  eq("Sandbox-Erstattung: Production-Kauf haelt Pro am Leben", [r.proRemoved, s.profiles.get(USER_A)?.isPro], [false, true]);
}

console.log(" i) Sandbox-Erlaubnisliste");
{
  const only: GrantOptions = { sandboxUsers: [USER_B] };
  const s = fresh();
  const r = await bindAndGrantApplePro(s, USER_A, tx({ environment: "Sandbox" }), now, only);
  eq("Sandbox-Kauf, Konto nicht gelistet -> invalid, nichts verbucht", [r, s.purchases.size, s.profiles.get(USER_A)?.isPro], [{ status: "invalid", originalTransactionId: "100", reason: "sandbox_not_allowed" }, 0, false]);
  const ok2 = await bindAndGrantApplePro(s, USER_B, tx({ environment: "Sandbox", appAccountToken: USER_B }), now, only);
  eq("Sandbox-Kauf, Konto gelistet -> granted", [ok2.status, s.profiles.get(USER_B)?.isPro], ["granted", true]);
  const prod = await bindAndGrantApplePro(s, USER_A, tx({ originalTransactionId: "300" }), now, only);
  eq("Production-Kauf ist von der Liste unberuehrt", prod.status, "granted");
  const open = fresh();
  eq("ohne Liste: alle Sandbox-Kaeufe erlaubt", (await bindAndGrantApplePro(open, USER_A, tx({ environment: "Sandbox" }), now)).status, "granted");
}

console.log(" j) Token zeigt auf geloeschtes Konto");
{
  const ghost = "99999999-9999-4999-8999-999999999999";
  const s = fresh();
  const r = await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: ghost }), now);
  eq("neue Transaktion, Token-Konto geloescht -> an angemeldetes Konto gebunden, gemeldet", [r.status, r.status === "granted" && r.tokenAccountDeleted, s.purchases.get("100")?.userId, s.profiles.get(USER_A)?.isPro], ["granted", true, USER_A, true]);
  const live = fresh();
  eq("Token-Konto lebt -> weiter foreign", (await bindAndGrantApplePro(live, USER_A, tx({ appAccountToken: USER_B }), now)).status, "foreign");
}

console.log(" k) settleAppleTransactions: Meldungen, Conversion-Bedingung, Sandbox-Liste");
{
  const verifiersK = makeVerifierFactory(cfgProd, [chain.root]);
  const verifiersKBoth = makeVerifierFactory(cfgBoth, [chain.root]);
  // Konsole mitschneiden: logOps schreibt jede Meldung zuerst als "[ops] ..."-Zeile.
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const grab = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  const s = fresh();
  const run = async (signed: string[], cfg = cfgProd, v = verifiersK) => {
    console.log = console.warn = console.error = grab;
    try {
      return await settleAppleTransactions(USER_A, signed, "de", cfg, { store: s, verifiers: v });
    } finally {
      console.log = orig.log;
      console.warn = orig.warn;
      console.error = orig.error;
    }
  };
  const bad = Array.from({ length: 7 }, (_, i) => jws(chain, txPayload({ originalTransactionId: `90${i}`, productId: "x.other" })));
  const out = await run([...bad, "kein.jws.hier", jws(chain, txPayload({ inAppOwnershipType: "FAMILY_SHARED", originalTransactionId: "910" }))]);
  eq("9 abgelehnte -> 9 Ergebnisse invalid", out.map((o) => o.status), Array(9).fill("invalid"));
  eq("... aber nur EINE Meldung fuer die ganze Anfrage", lines.filter((l) => l.includes("apple_purchase_invalid")).length, 1);
  check("... mit Anzahl im Text", lines.some((l) => l.includes("9 Apple-Transaktion")), lines.join(" | "));
  lines.length = 0;
  const good = await run([jws(chain, txPayload({ originalTransactionId: "920" }))]);
  eq("gueltiger Kauf -> granted, keine Ablehnungsmeldung", [good[0].status, lines.filter((l) => l.includes("apple_purchase_invalid")).length], ["granted", 0]);
  // Sandbox-Liste ueber die Konfiguration
  lines.length = 0;
  const sbTx = jws(chain, txPayload({ environment: "Sandbox", originalTransactionId: "930", appAccountToken: USER_A }));
  const listed = await run([sbTx], { ...cfgBoth, sandboxUsers: [USER_B] }, verifiersKBoth);
  eq("Sandbox-Kauf, Liste ohne dieses Konto -> invalid", listed.map((o) => o.status), ["invalid"]);
  eq("... und einmal gemeldet", lines.filter((l) => l.includes("apple_purchase_invalid")).length, 1);
  const open = await run([sbTx], cfgBoth, verifiersKBoth);
  eq("Sandbox-Kauf ohne Liste -> granted", open.map((o) => o.status), ["granted"]);

  // Kaputte Liste: Sandbox fuer niemanden, Production laeuft, einmal gemeldet; Erstattungen unberuehrt
  const brokenCfg = readAppleConfig({
    APPLE_IAP_BUNDLE_ID: BUNDLE,
    APPLE_IAP_PRODUCT_ID: PRODUCT,
    APPLE_IAP_APP_APPLE_ID: String(APP_ID),
    APPLE_IAP_ENVIRONMENT: "Both",
    APPLE_IAP_SANDBOX_USERS: "kaputt",
  });
  lines.length = 0;
  const brokenOut = await run(
    [
      jws(chain, txPayload({ environment: "Sandbox", originalTransactionId: "940", appAccountToken: USER_A })),
      jws(chain, txPayload({ environment: "Sandbox", originalTransactionId: "941", appAccountToken: USER_A })),
      jws(chain, txPayload({ originalTransactionId: "950", appAccountToken: USER_A })),
    ],
    brokenCfg,
    verifiersKBoth,
  );
  eq("kaputte Liste: Sandbox abgewiesen, Production-Kauf geht durch", brokenOut.map((o) => o.status), ["invalid", "invalid", "granted"]);
  eq("... Hinweis auf die kaputte Variable genau einmal", lines.filter((l) => l.includes("APPLE_IAP_SANDBOX_USERS ist unbrauchbar")).length, 1);
  const refundJws = jws(chain, {
    notificationType: "REFUND",
    notificationUUID: randomUUID(),
    version: "2.0",
    signedDate: NOW,
    data: { environment: "Sandbox", bundleId: BUNDLE, signedTransactionInfo: jws(chain, txPayload({ environment: "Sandbox", originalTransactionId: "940", revocationDate: NOW })) },
  });
  const brokenNote = await verifyAppleNotification(refundJws, brokenCfg, verifiersKBoth);
  check("kaputte Liste: Benachrichtigung (Erstattung) wird trotzdem angenommen", brokenNote.ok && brokenNote.type === "REFUND", JSON.stringify(brokenNote));
}

console.log(" k1) Doppelt bezahlt: Meldung nur bei echtem Geld (Anton 27.11.2026)");
{
  const v = makeVerifierFactory(cfgBoth, [chain.root]);
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const settle = async (store: FakeStore, signed: string) => {
    console.log = console.warn = console.error = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
    try {
      return await settleAppleTransactions(USER_A, [signed], "de", cfgBoth, { store, verifiers: v });
    } finally {
      console.log = orig.log;
      console.warn = orig.warn;
      console.error = orig.error;
    }
  };
  const webPro = () => fresh({ [USER_A]: { isPro: true, proSource: "stripe", stripeCustomerId: "cus_1" } });
  const prod = await settle(webPro(), jws(chain, txPayload({ originalTransactionId: "960", appAccountToken: USER_A })));
  eq("Web-Pro plus Production-Apple-Kauf: granted und als doppelt bezahlt gemeldet", [prod.map((o) => o.status), lines.filter((l) => l.includes("Doppelt bezahlt")).length], [["granted"], 1]);
  lines.length = 0;
  const sb = await settle(webPro(), jws(chain, txPayload({ environment: "Sandbox", originalTransactionId: "961", appAccountToken: USER_A })));
  eq("Web-Pro plus Sandbox-Kauf (TestFlight): keine Meldung", [sb.map((o) => o.status), lines.filter((l) => l.includes("apple:double") || l.includes("Doppelt bezahlt")).length], [["granted"], 0]);
  lines.length = 0;
  const store = webPro();
  const tx970 = jws(chain, txPayload({ originalTransactionId: "970", appAccountToken: USER_A }));
  await settle(store, tx970);
  lines.length = 0;
  const restored = await settle(store, tx970);
  eq("Wiederherstellen desselben Kaufs: keine zweite Doppelt-Meldung", [restored.map((o) => o.status), lines.filter((l) => l.includes("Doppelt bezahlt")).length], [["already"], 0]);
  // Ohne Anmeldung gekauft (anonym), dann mit dem Web-Pro-Konto angemeldet (Regel 2a): gemeldet.
  lines.length = 0;
  const moved = webPro();
  moved.profiles.set(ANON, { isPro: false, proSource: null });
  moved.anonymous.add(ANON);
  await bindAndGrantApplePro(moved, ANON, tx({ originalTransactionId: "980", appAccountToken: ANON }), now);
  const mv = await settle(moved, jws(chain, txPayload({ originalTransactionId: "980", appAccountToken: ANON })));
  eq("Gast-Kauf, dann Anmeldung mit Web-Pro-Konto (2a): als doppelt bezahlt gemeldet", [mv.map((o) => o.status), lines.filter((l) => l.includes("Doppelt bezahlt")).length, moved.purchases.get("980")?.userId], [["granted"], 1, USER_A]);
  lines.length = 0;
  const mig = await settle(fresh({ [USER_A]: { isPro: true, proSource: "migration" } }), jws(chain, txPayload({ originalTransactionId: "990", appAccountToken: USER_A })));
  eq("Pro von der alten Seite plus Apple-Kauf: als doppelt bezahlt gemeldet", [mig.map((o) => o.status), lines.filter((l) => l.includes("alten Seite")).length], [["granted"], 1]);
  lines.length = 0;
  const gift = await settle(fresh({ [USER_A]: { isPro: true, proSource: "comp" } }), jws(chain, txPayload({ originalTransactionId: "962", appAccountToken: USER_A })));
  eq("Geschenk-Pro plus Production-Kauf: gemeldet, aber nicht als doppelt bezahlt", [gift.map((o) => o.status), lines.filter((l) => l.includes("Quelle comp")).length, lines.filter((l) => l.includes("Doppelt bezahlt")).length], [["granted"], 1, 0]);
}

console.log(" k2) Nach dem Umzug: leeres anonymes Konto wird abgeraeumt (Anton 26.11.2026)");
{
  const verifiersK2 = makeVerifierFactory(cfgProd, [chain.root]);
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const grab = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  const settle = async (s: FakeStore, signed: string[]) => {
    console.log = console.warn = console.error = grab;
    try {
      return await settleAppleTransactions(USER_A, signed, "de", cfgProd, { store: s, verifiers: verifiersK2 });
    } finally {
      console.log = orig.log;
      console.warn = orig.warn;
      console.error = orig.error;
    }
  };
  const anonRow = (over: Partial<PurchaseRow> = {}): PurchaseRow => ({
    originalTransactionId: "960", userId: ANON, productId: PRODUCT, environment: "Production", purchasedAt: now(),
    revokedAt: null, appAccountToken: ANON, anonHolders: [], ...over,
  });
  const signed = jws(chain, txPayload({ originalTransactionId: "960", appAccountToken: ANON }));

  const s1 = withAnon(ANON);
  s1.profiles.set(ANON, { isPro: true, proSource: "apple" });
  s1.purchases.set("960", anonRow());
  const out1 = await settle(s1, [signed]);
  eq("Umzug ins echte Konto: granted, Zeile bei A, A Pro", [out1.map((o) => o.status), s1.purchases.get("960")?.userId, s1.profiles.get(USER_A)?.isPro], [["granted"], USER_A, true]);
  eq("... anonymes Konto geloescht (Profil weg)", [s1.retired, s1.profiles.has(ANON)], [[ANON], false]);

  // Gleicher Umzug, aber das anonyme Konto besitzt noch einen ZWEITEN Kauf: bleibt stehen.
  const s2 = withAnon(ANON);
  s2.profiles.set(ANON, { isPro: true, proSource: "apple" });
  s2.purchases.set("960", anonRow());
  s2.purchases.set("961", anonRow({ originalTransactionId: "961", appAccountToken: ANON }));
  await settle(s2, [signed]);
  eq("anonymes Konto mit weiterem Kauf bleibt", [s2.retired, s2.profiles.has(ANON), s2.purchases.get("961")?.userId], [[], true, ANON]);

  // ... oder ist anderswo noch Mit-Inhaber: bleibt stehen.
  const s3 = withAnon(ANON, ANON2);
  s3.profiles.set(ANON, { isPro: true, proSource: "apple" });
  s3.purchases.set("960", anonRow());
  s3.purchases.set("962", anonRow({ originalTransactionId: "962", userId: ANON2, appAccountToken: ANON2, anonHolders: [ANON] }));
  await settle(s3, [signed]);
  eq("anonymes Konto, anderswo Mit-Inhaber, bleibt", [s3.retired, s3.profiles.has(ANON)], [[], true]);

  // Ein echtes Konto wird nie geloescht, auch wenn der Speicher danach gefragt wird.
  const s4 = fresh();
  eq("echtes Konto: retireAnonymousAccount loescht nie", [await s4.retireAnonymousAccount(USER_B), s4.profiles.has(USER_B)], [false, true]);

  // Loeschen scheitert: Der Kauf gilt trotzdem, leise gemeldet (nur Logbuch).
  const s5 = withAnon(ANON);
  s5.profiles.set(ANON, { isPro: true, proSource: "apple" });
  s5.purchases.set("960", anonRow());
  s5.failOn.retireAnonymousAccount = true;
  lines.length = 0;
  const out5 = await settle(s5, [signed]);
  eq("Loeschen scheitert -> Kauf trotzdem granted, A Pro", [out5.map((o) => o.status), s5.profiles.get(USER_A)?.isPro], [["granted"], true]);
  eq("... genau eine leise Meldung", lines.filter((l) => l.includes("apple_anon_cleanup_failed")).length, 1);
  eq("... und die Art mailt nie", OPS_EVENTS.apple_anon_cleanup_failed.alertAfter, 0);

  // Wiederholter Abgleich desselben Kaufs im echten Konto: nichts mehr abzuraeumen.
  const out6 = await settle(s1, [signed]);
  eq("erneuter Abgleich: already, kein zweites Loeschen", [out6.map((o) => o.status), s1.retired.length], [["already"], 1]);
}

// ═════════════════════════════════════════════════════════════════════════════════════
console.log("\n6. Stripe-Weg (grantPro): ueberschreibt Apple-Pro nie, Rest unveraendert");
{
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-key";
  const realFetch = globalThis.fetch;
  type ProfileRow = { is_pro: boolean; pro_source: string | null };
  let profile = null as ProfileRow | null;
  const patches: unknown[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.hostname !== "supabase.invalid") throw new Error(`unerwarteter Aufruf ${url.href}`);
    if (method === "GET") {
      const wantsObject = String(new Headers(init?.headers).get("accept")).includes("vnd.pgrst.object");
      const body = wantsObject ? profile : profile ? [profile] : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (method === "PATCH") {
      patches.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    }
    throw new Error(`unerwartete Methode ${method}`);
  }) as typeof fetch;
  try {
    const { grantPro } = await import("@/lib/pro-purchase");
    const cases: [string, ProfileRow, boolean][] = [
      ["aktives apple-Pro", { is_pro: true, pro_source: "apple" }, false],
      ["aktives stripe-Pro (wie bisher: nichts tun)", { is_pro: true, pro_source: "stripe" }, false],
      ["comp-Pro (wie bisher: Stripe gewinnt)", { is_pro: true, pro_source: "comp" }, true],
      ["migration-Pro (wie bisher: Stripe gewinnt)", { is_pro: true, pro_source: "migration" }, true],
      ["kein Pro", { is_pro: false, pro_source: null }, true],
      ["kein Pro, alte apple-Herkunft (erstattet)", { is_pro: false, pro_source: "apple" }, true],
    ];
    for (const [name, p, expectPatch] of cases) {
      profile = p;
      patches.length = 0;
      await grantPro(USER_A, "cus_test");
      check(`grantPro bei ${name}: ${expectPatch ? "schreibt" : "schreibt nicht"}`, (patches.length > 0) === expectPatch, JSON.stringify(patches));
      if (expectPatch) eq("  ... setzt pro_source stripe", (patches[0] as { pro_source?: string }).pro_source, "stripe");
    }
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════

console.log("\n8. Stripe-Erstattung bei doppeltem Kauf (Anton 27.11.2026): nie Pro ohne Bezahlung");
{
  // Beide Erstattungswege auf DEMSELBEN Stand: der Apple-Weg (FakeStore) und der Stripe-Weg ueber
  // einen Adapter auf dieselben Tabellen. So lassen sich auch Rennen zwischen beiden pruefen.
  type Hooks = Partial<Record<keyof StripeRefundStore, () => void | Promise<void>>>;
  // Web-Kaeufe (pro_purchases) je Zahlung. s.activeStripe (das sieht der Apple-Weg) folgt daraus.
  type Claim = { pi: string | null; customer: string; userId: string; refunded: boolean };
  const refundStore = (
    s: FakeStore,
    hooks: Hooks = {},
    fail: Partial<Record<keyof StripeRefundStore, boolean>> = {},
    claims: Claim[] = [...s.activeStripe].map(([u, c]) => ({ pi: null, customer: c ?? "", userId: u, refunded: false })),
  ): StripeRefundStore => {
    const run = async (name: keyof StripeRefundStore) => {
      if (fail[name]) throw new Error(`Speicher ${name} faellt aus`);
      const h = hooks[name];
      if (h) {
        delete hooks[name];
        await h();
      }
    };
    const sync = () => {
      for (const c of claims) {
        const open = claims.find((x) => x.userId === c.userId && !x.refunded);
        if (open) s.activeStripe.set(c.userId, open.customer);
        else s.activeStripe.delete(c.userId);
      }
    };
    return {
      async markClaimsRefunded(customerId, pi) {
        await run("markClaimsRefunded");
        const byPi = pi ? claims.filter((c) => c.pi === pi) : [];
        const hit = byPi.length > 0 ? byPi : claims.filter((c) => c.customer === customerId);
        for (const c of hit) c.refunded = true;
        sync();
        return [...new Set(hit.map((c) => c.userId))];
      },
      async proAccounts(customerId, userIds) {
        await run("proAccounts");
        return [...s.profiles]
          .filter(([u, p]) => p.isPro && (p.proSource === "stripe" || p.proSource === "apple") && (p.stripeCustomerId === customerId || userIds.includes(u)))
          .map(([u, p]) => ({ id: u, source: p.proSource as "stripe" | "apple" }));
      },
      async hasPaidStripePurchase(userId) {
        await run("hasPaidStripePurchase");
        return claims.some((c) => c.userId === userId && !c.refunded);
      },
      async hasPaidApplePurchase(userId) {
        await run("hasPaidApplePurchase");
        return [...s.purchases.values()].some((r) => r.userId === userId && r.revokedAt === null && r.environment === "Production");
      },
      async switchStripeProToApple(userId) {
        await run("switchStripeProToApple");
        const p = s.profiles.get(userId);
        if (!p || !p.isPro || p.proSource !== "stripe") return false;
        p.proSource = "apple";
        return true;
      },
      async removeStripePro(userId) {
        await run("removeStripePro");
        const p = s.profiles.get(userId);
        if (!p || p.proSource !== "stripe" || !p.isPro) return false;
        p.isPro = false;
        return true;
      },
      async removeApplePro(userId) {
        await run("removeApplePro");
        const p = s.profiles.get(userId);
        if (!p || p.proSource !== "apple" || !p.isPro) return false;
        p.isPro = false;
        return true;
      },
    };
  };
  // Web-Pro (Stripe, cus_1) und danach ein Apple-Kauf desselben Kontos.
  const doublePaid = async (env: "Production" | "Sandbox" = "Production") => {
    const s = fresh({ [USER_A]: { isPro: true, proSource: "stripe", stripeCustomerId: "cus_1" } });
    s.activeStripe.set(USER_A, "cus_1");
    const r = await bindAndGrantApplePro(s, USER_A, tx({ environment: env }), now);
    return { s, r };
  };
  {
    const { s, r } = await doublePaid();
    eq("Ausgang: Apple-Kauf verbucht, Pro bleibt Stripe, als doppelt erkannt", [r.status, s.profiles.get(USER_A)?.proSource, r.status === "granted" && r.alreadyEntitledBy], ["granted", "stripe", "stripe"]);
    const out = await applyStripeRefund(refundStore(s), "cus_1", null);
    eq("Stripe erstattet: Pro laeuft ueber Apple weiter", [out.keptByApple, out.removed, s.profiles.get(USER_A)?.isPro, s.profiles.get(USER_A)?.proSource], [[USER_A], [], true, "apple"]);
    eq("  Stripe-Anspruch ist abgeraeumt", s.activeStripe.has(USER_A), false);
    const rv = await applyAppleRevocation(s, "100", null, now());
    eq("  danach erstattet auch Apple: Pro weg (nichts mehr bezahlt)", [rv.proRemoved, s.profiles.get(USER_A)?.isPro], [true, false]);
    const again = await applyStripeRefund(refundStore(s), "cus_1", null);
    eq("  Wiederholung der Stripe-Erstattung aendert nichts", [again.keptByApple, again.removed, s.profiles.get(USER_A)?.isPro], [[], [], false]);
  }
  {
    // Umgekehrte Reihenfolge: erst Apple, dann Stripe.
    const { s } = await doublePaid();
    await applyAppleRevocation(s, "100", null, now());
    eq("erst Apple erstattet: Pro bleibt ueber Stripe", [s.profiles.get(USER_A)?.isPro, s.profiles.get(USER_A)?.proSource], [true, "stripe"]);
    const out = await applyStripeRefund(refundStore(s), "cus_1", null);
    eq("  dann Stripe: Pro weg, kein Apple-Kauf haelt es", [out.removed, out.keptByApple, s.profiles.get(USER_A)?.isPro], [[USER_A], [], false]);
  }
  {
    const { s } = await doublePaid("Sandbox");
    const out = await applyStripeRefund(refundStore(s), "cus_1", null);
    eq("Sandbox-Apple-Kauf (TestFlight, gratis) haelt nach Stripe-Erstattung kein Pro", [out.removed, s.profiles.get(USER_A)?.isPro], [[USER_A], false]);
  }
  {
    const s = fresh({ [USER_A]: { isPro: true, proSource: "stripe", stripeCustomerId: "cus_1" } });
    s.activeStripe.set(USER_A, "cus_1");
    const out = await applyStripeRefund(refundStore(s), "cus_1", null);
    eq("nur Web-Kauf, erstattet: Pro weg wie bisher", [out.removed, s.profiles.get(USER_A)?.isPro], [[USER_A], false]);
  }
  {
    // Apple-Kauf gehoert jemand anderem, dieses Konto ist dort nur anonymer Mit-Inhaber: zaehlt nicht.
    const { s } = await doublePaid();
    s.purchases.get("100")!.userId = USER_B;
    s.purchases.get("100")!.anonHolders = [USER_A];
    const out = await applyStripeRefund(refundStore(s), "cus_1", null);
    eq("Mit-Inhaber eines fremden Apple-Kaufs haelt kein Pro", [out.removed, s.profiles.get(USER_A)?.isPro], [[USER_A], false]);
  }
  {
    const { s } = await doublePaid();
    s.purchases.get("100")!.revokedAt = now();
    const out = await applyStripeRefund(refundStore(s), "cus_1", null);
    eq("schon erstatteter Apple-Kauf haelt kein Pro", [out.removed, s.profiles.get(USER_A)?.isPro], [[USER_A], false]);
  }
  {
    const s = fresh({ [USER_A]: { isPro: true, proSource: "comp", stripeCustomerId: "cus_1" } });
    const out = await applyStripeRefund(refundStore(s), "cus_1", null);
    eq("geschenktes Pro bleibt unberuehrt", [out.removed, out.keptByApple, s.profiles.get(USER_A)], [[], [], { isPro: true, proSource: "comp", stripeCustomerId: "cus_1" }]);
  }
  {
    const { s } = await doublePaid();
    let threw = false;
    try {
      await applyStripeRefund(refundStore(s, {}, { markClaimsRefunded: true }), "cus_1", null);
    } catch {
      threw = true;
    }
    eq("Anspruch laesst sich nicht abraeumen: Fehler (Stripe stellt erneut zu), Profil unberuehrt", [threw, s.profiles.get(USER_A)?.proSource, s.activeStripe.has(USER_A)], [true, "stripe", true]);
  }
  {
    // Rennen 1: Apple erstattet GANZ zwischen der ersten Pruefung und der Umstellung. Der Apple-Entzug
    // fand noch pro_source = 'stripe' vor (und den Stripe-Anspruch schon erstattet): er tat nichts.
    // Die Nachpruefung nach der Umstellung muss entziehen.
    const { s } = await doublePaid();
    const out = await applyStripeRefund(refundStore(s, {
      switchStripeProToApple: async () => {
        await applyAppleRevocation(s, "100", null, now());
      },
    }), "cus_1", null);
    eq("Rennen 1: Apple erstattet waehrend der Stripe-Erstattung: Pro weg", [out.removed, out.keptByApple, s.profiles.get(USER_A)?.isPro], [[USER_A], [], false]);
  }
  {
    // Rennen 2: Apple erstattet NACH der Umstellung, vor der Nachpruefung. Der Apple-Entzug findet
    // pro_source = 'apple' und keinen aktiven Stripe-Kauf mehr: er entzieht selbst.
    const { s } = await doublePaid();
    let calls = 0;
    const hooks: Hooks = {};
    const store = refundStore(s, hooks);
    const wrapped: StripeRefundStore = {
      ...store,
      async hasPaidApplePurchase(u) {
        calls += 1;
        if (calls === 2) await applyAppleRevocation(s, "100", null, now());
        return store.hasPaidApplePurchase(u);
      },
    };
    const out = await applyStripeRefund(wrapped, "cus_1", null);
    eq("Rennen 2: Apple erstattet zwischen Umstellung und Nachpruefung: Pro weg", [out.keptByApple, s.profiles.get(USER_A)?.isPro], [[], false]);
  }
  {
    // Rennen 3: Apple-Entzug laeuft, BEVOR der Stripe-Anspruch abgeraeumt ist: Er sieht Stripe noch
    // aktiv und laesst Pro bei Stripe. Die Stripe-Erstattung danach findet keinen bezahlten Apple-Kauf.
    const { s } = await doublePaid();
    const out = await applyStripeRefund(refundStore(s, {
      markClaimsRefunded: async () => {
        await applyAppleRevocation(s, "100", null, now());
      },
    }), "cus_1", null);
    eq("Rennen 3: Apple-Entzug vor dem Abraeumen des Anspruchs: Pro weg", [out.removed, s.profiles.get(USER_A)?.isPro], [[USER_A], false]);
  }
  {
    // Rennen 4: Zwischen Pruefung und Umstellung aendert sich das Profil (z. B. Pro von Hand entzogen):
    // Die Umstellung trifft nichts, und es wird nichts zurueckgegeben.
    const { s } = await doublePaid();
    const out = await applyStripeRefund(refundStore(s, {
      switchStripeProToApple: () => {
        s.profiles.get(USER_A)!.isPro = false;
      },
    }), "cus_1", null);
    eq("Rennen 4: Profil zwischendurch ohne Pro: bleibt ohne Pro", [out.keptByApple, out.removed, s.profiles.get(USER_A)?.isPro], [[], [], false]);
  }
  {
    // Selbstheilung (Pruefung 27.11.2026): Apple erstattet zwischen Pruefung und Umstellung, dann
    // faellt die Nachpruefung aus (Datenbankfehler, Webhook 500). Die Quelle steht schon auf 'apple'.
    // Die Wiederholung durch Stripe muss das Konto trotzdem finden und Pro nehmen.
    const { s } = await doublePaid();
    const store = refundStore(s, { switchStripeProToApple: async () => void (await applyAppleRevocation(s, "100", null, now())) });
    let calls = 0;
    const flaky: StripeRefundStore = {
      ...store,
      async hasPaidApplePurchase(u) {
        calls += 1;
        if (calls === 2) throw new Error("Datenbank weg");
        return store.hasPaidApplePurchase(u);
      },
    };
    let threw = false;
    try {
      await applyStripeRefund(flaky, "cus_1", null);
    } catch {
      threw = true;
    }
    eq("  Abbruch nach der Umstellung: Fehler, Quelle apple, Pro noch da", [threw, s.profiles.get(USER_A)?.proSource, s.profiles.get(USER_A)?.isPro], [true, "apple", true]);
    const retry = await applyStripeRefund(refundStore(s), "cus_1", null);
    eq("Selbstheilung: Stripe stellt erneut zu, Pro weg (nichts mehr bezahlt)", [retry.removed, s.profiles.get(USER_A)?.isPro], [[USER_A], false]);
  }
  {
    // Apple-Kaeufer mit einer alten Web-Kunden-ID: Die Erstattung des alten Web-Kaufs nimmt ihm nichts.
    const s = fresh({ [USER_A]: { isPro: true, proSource: "apple", stripeCustomerId: "cus_1" } });
    await bindAndGrantApplePro(s, USER_A, tx(), now);
    const out = await applyStripeRefund(refundStore(s, {}, {}, [{ pi: "pi_old", customer: "cus_1", userId: USER_A, refunded: false }]), "cus_1", "pi_old");
    eq("Apple-Pro mit alter Web-Kunden-ID bleibt bei Erstattung des alten Web-Kaufs", [out.removed, s.profiles.get(USER_A)], [[], { isPro: true, proSource: "apple", stripeCustomerId: "cus_1" }]);
  }
  {
    // Zwei Konten mit derselben Kunden-ID: Nur das mit bezahltem Apple-Kauf behaelt Pro.
    const s = fresh({
      [USER_A]: { isPro: true, proSource: "stripe", stripeCustomerId: "cus_1" },
      [USER_B]: { isPro: true, proSource: "stripe", stripeCustomerId: "cus_1" },
    });
    s.activeStripe.set(USER_A, "cus_1");
    s.activeStripe.set(USER_B, "cus_1");
    await bindAndGrantApplePro(s, USER_A, tx(), now);
    const out = await applyStripeRefund(refundStore(s), "cus_1", null);
    eq("zwei Konten, eine Kunden-ID: A behaelt (Apple), B verliert", [out.keptByApple, out.removed, s.profiles.get(USER_A)?.isPro, s.profiles.get(USER_B)?.isPro], [[USER_A], [USER_B], true, false]);
  }
  {
    // Je Zahlung: zwei Web-Kaeufe desselben Kunden. Erstattung von Kauf 1 (auch erneut zugestellt)
    // laesst Kauf 2 und Pro stehen; erst die Erstattung von Kauf 2 nimmt Pro.
    const s = fresh({ [USER_A]: { isPro: true, proSource: "stripe", stripeCustomerId: "cus_1" } });
    const claims: Claim[] = [
      { pi: "pi_1", customer: "cus_1", userId: USER_A, refunded: false },
      { pi: "pi_2", customer: "cus_1", userId: USER_A, refunded: false },
    ];
    s.activeStripe.set(USER_A, "cus_1");
    const first = await applyStripeRefund(refundStore(s, {}, {}, claims), "cus_1", "pi_1");
    const again = await applyStripeRefund(refundStore(s, {}, {}, claims), "cus_1", "pi_1");
    eq("je Zahlung: Erstattung Kauf 1 (zweimal zugestellt) laesst Kauf 2 und Pro", [first.keptByStripe, again.keptByStripe, claims.map((c) => c.refunded), s.profiles.get(USER_A)?.isPro], [[USER_A], [USER_A], [true, false], true]);
    const second = await applyStripeRefund(refundStore(s, {}, {}, claims), "cus_1", "pi_2");
    eq("  Erstattung Kauf 2: Pro weg", [second.removed, s.profiles.get(USER_A)?.isPro], [[USER_A], false]);
  }
  {
    // Gast kauft zweimal im Web: zwei Kunden-IDs, das Profil traegt nur die erste (Pruefung 27.11.2026).
    // Nach beiden Erstattungen darf kein Pro bleiben.
    const s = fresh({ [USER_A]: { isPro: true, proSource: "stripe", stripeCustomerId: "cus_1" } });
    const claims: Claim[] = [
      { pi: "pi_1", customer: "cus_1", userId: USER_A, refunded: false },
      { pi: "pi_2", customer: "cus_2", userId: USER_A, refunded: false },
    ];
    s.activeStripe.set(USER_A, "cus_1");
    const one = await applyStripeRefund(refundStore(s, {}, {}, claims), "cus_1", "pi_1");
    eq("zwei Gast-Kaeufe, Kauf 1 erstattet: Pro bleibt (Kauf 2 bezahlt)", [one.keptByStripe, s.profiles.get(USER_A)?.isPro], [[USER_A], true]);
    const two = await applyStripeRefund(refundStore(s, {}, {}, claims), "cus_2", "pi_2");
    eq("  Kauf 2 (andere Kunden-ID) erstattet: Konto ueber den Anspruch gefunden, Pro weg", [two.removed, s.profiles.get(USER_A)?.isPro], [[USER_A], false]);
  }
  {
    // Alter Kauf ohne payment_intent in der Tabelle: Die Erstattung (mit unbekannter Zahlung) gilt
    // fuer die ganze Kunden-ID wie bisher.
    const s = fresh({ [USER_A]: { isPro: true, proSource: "stripe", stripeCustomerId: "cus_1" } });
    const claims: Claim[] = [{ pi: null, customer: "cus_1", userId: USER_A, refunded: false }];
    const out = await applyStripeRefund(refundStore(s, {}, {}, claims), "cus_1", "pi_unbekannt");
    eq("alter Kauf ohne payment_intent: ganze Kunden-ID erstattet, Pro weg", [claims[0].refunded, out.removed, s.profiles.get(USER_A)?.isPro], [true, [USER_A], false]);
  }
  {
    // Apple-Erstattungs-Benachrichtigung kommt doppelt: zweimal derselbe Entzug, Pro bleibt weg.
    const { s } = await doublePaid();
    await applyStripeRefund(refundStore(s), "cus_1", null);
    await applyAppleRevocation(s, "100", null, now());
    await applyAppleRevocation(s, "100", null, now());
    eq("Apple-Erstattung doppelt zugestellt: Pro bleibt weg", s.profiles.get(USER_A)?.isPro, false);
  }
}
console.log("\n8b. Stripe-Webhook: jeder Zweig genau einmal, Streitfaelle nur ueber die neuen Regeln");
{
  // Der Webhook laesst sich hier nicht ausfuehren (Stripe-Client). Ein doppelt eingefuegter Block
  // fiel am 27.11.2026 erst in der Pruefung auf (tsc meldete nichts): Aufbau darum hier festhalten.
  const src = readFileSync(join(process.cwd(), "src/app/api/stripe/webhook/route.ts"), "utf8");
  const count = (needle: string) => src.split(needle).length - 1;
  for (const ev of ["checkout.session.completed", "charge.refunded", "charge.dispute.created", "charge.dispute.funds_withdrawn", "charge.dispute.closed"]) {
    eq(`Zweig ${ev} genau einmal`, count(`event.type === "${ev}"`), 1);
  }
  eq("Signaturpruefung genau einmal", count("constructEventAsync("), 1);
  eq("Pro wird nur bei Erstattung, abgebuchtem Streitfall und Erstattung nach Wiederoeffnen entzogen", count("await revokePro("), 3);
  check("charge.dispute.created entzieht nichts", !/charge\.dispute\.created"\)[\s\S]*?revokePro[\s\S]*?charge\.dispute\.funds_withdrawn/.test(src));
}

console.log("\n9. Gast-Konten austragen (Anton 27.11.2026: keine verwaisten Gast-Konten)");
{
  const { guestIsIdle, pruneIdleGuests } = await import("@/lib/guest-cleanup");
  const ANON3 = "88888888-8888-4888-8888-888888888888";
  {
    const s = withAnon(ANON);
    eq("echtes Konto: nie", [await retireGuestAccount(s, USER_A), s.profiles.has(USER_A)], ["not_anonymous", true]);
  }
  {
    // Abgemeldetes Geraet teilte den Kauf des echten Kontos (2b), dann Anmeldung: Gast-Konto weg, Besitzer behaelt Pro.
    const s = withAnon(ANON2);
    s.purchases.set("100", row({ userId: USER_A, appAccountToken: USER_A, anonHolders: [ANON2] }));
    s.profiles.set(USER_A, { isPro: true, proSource: "apple" });
    s.profiles.set(ANON2, { isPro: true, proSource: "apple" });
    const r = await retireGuestAccount(s, ANON2);
    eq("Mit-Inhaber: ausgetragen und geloescht, Besitzer behaelt Pro", [r, s.purchases.get("100")?.anonHolders, s.profiles.has(ANON2), s.profiles.get(USER_A)?.isPro, s.purchases.get("100")?.userId], ["retired", [], false, true, USER_A]);
  }
  {
    // Gast hat SELBST gekauft (ohne Konto): bleibt, Regel 2a holt den Kauf bei der Anmeldung.
    const s = withAnon(ANON);
    await bindAndGrantApplePro(s, ANON, tx({ appAccountToken: ANON }), now);
    eq("eigener Gast-Kauf: bleibt", [await retireGuestAccount(s, ANON), s.profiles.get(ANON)?.isPro, s.purchases.get("100")?.userId], ["owns_purchase", true, ANON]);
  }
  {
    const s = withAnon(ANON);
    eq("Gast ohne jeden Kauf: geloescht", [await retireGuestAccount(s, ANON), s.profiles.has(ANON)], ["retired", false]);
  }
  {
    // Rennen: Zwischen Lesen und Austragen traegt sich ein anderes Geraet ein; neu lesen, dann klappt es.
    const s = withAnon(ANON2, ANON3);
    s.purchases.set("100", row({ userId: USER_A, appAccountToken: USER_A, anonHolders: [ANON2] }));
    s.profiles.set(USER_A, { isPro: true, proSource: "apple" });
    s.before.dropHolder = () => {
      s.purchases.get("100")!.anonHolders = [ANON2, ANON3];
    };
    const r = await retireGuestAccount(s, ANON2);
    eq("Rennen beim Austragen: neu gelesen, das andere Geraet bleibt", [r, s.purchases.get("100")?.anonHolders, s.profiles.has(ANON2)], ["retired", [ANON3], false]);
  }
  {
    // Mit-Inhaber einer erstatteten Zeile und einer Zeile ohne Besitzer (Konto geloescht): trotzdem austragbar.
    const s = withAnon(ANON2);
    s.purchases.set("100", row({ userId: USER_A, appAccountToken: USER_A, anonHolders: [ANON2], revokedAt: now() }));
    s.purchases.set("101", row({ originalTransactionId: "101", userId: null, appAccountToken: USER_B, anonHolders: [ANON2] }));
    eq("Mit-Inhaber erstatteter und besitzerloser Zeilen: ausgetragen und geloescht", [await retireGuestAccount(s, ANON2), s.purchases.get("100")?.anonHolders, s.purchases.get("101")?.anonHolders, s.profiles.has(ANON2)], ["retired", [], [], false]);
  }
  {
    const now = new Date("2026-12-31T00:00:00Z");
    const old = { id: ANON, is_anonymous: true, created_at: "2026-10-01T00:00:00Z", last_sign_in_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" };
    eq("unbenutzt: erst nach 30 Tagen, nur anonym", [guestIsIdle(old, now), guestIsIdle({ ...old, updated_at: "2026-12-20T00:00:00Z" }, now), guestIsIdle({ ...old, is_anonymous: false }, now)], [true, false, false]);
    const s = withAnon(ANON, ANON2);
    await bindAndGrantApplePro(s, ANON2, tx({ appAccountToken: ANON2 }), () => now.toISOString());
    const out = await pruneIdleGuests({
      store: s,
      now,
      listUsers: async (page) => (page === 1 ? [old, { ...old, id: ANON2 }, { ...old, id: USER_A, is_anonymous: false }] : []),
    });
    eq("naechtlich: alter Gast ohne Kauf weg, Gast mit eigenem Kauf und echtes Konto bleiben", [out.retired, s.profiles.has(ANON), s.profiles.has(ANON2), s.profiles.has(USER_A)], [1, false, true, true]);
    // Ein Gast-Geraet, das den Kauf eines echten Kontos teilt, bleibt nachts IMMER (taegliche Nutzung ist nicht messbar).
    const shared = withAnon(ANON3);
    shared.purchases.set("100", row({ userId: USER_A, appAccountToken: USER_A, anonHolders: [ANON3] }));
    shared.profiles.set(USER_A, { isPro: true, proSource: "apple" });
    shared.profiles.set(ANON3, { isPro: true, proSource: "apple" });
    const out2 = await pruneIdleGuests({ store: shared, now, listUsers: async (page) => (page === 1 ? [{ ...old, id: ANON3 }] : []) });
    eq("naechtlich: Gast-Geraet mit geteiltem Kauf bleibt samt Pro", [out2.retired, shared.profiles.get(ANON3)?.isPro, shared.purchases.get("100")?.anonHolders], [0, true, [ANON3]]);
  }
}

console.log("\n7. Anonyme Konten duerfen nirgends schreiben (Migration 0078)");
{
  // Die einschraenkenden Policies no_anonymous_* aus 0078 gelten nur fuer Tabellen, die es beim
  // Einspielen gab. Jede SPAETERE Migration mit einer Schreib-Policy fuer authenticated muss den Block
  // erneut ausfuehren, sonst schreibt dort jedes anonyme Konto (Kauf ohne Konto, Apple 5.1.1).
  const { readdirSync } = await import("node:fs");
  const dir = join(process.cwd(), "supabase", "migrations");
  const later = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) > 78);
  const open = later.filter((f) => {
    const sql = readFileSync(join(dir, f), "utf8").toLowerCase();
    // Jede Schreib-Policy zählt: mit "to authenticated", "to public" oder ganz ohne TO-Klausel (gilt
    // dann für public, also auch für anonyme Konten).
    const writes = /create policy[^;]*?for\s+(insert|update|delete|all)\b/.test(sql);
    return writes && !sql.includes("no_anonymous_insert");
  });
  check(
    "keine spaetere Migration oeffnet Schreib-Policies ohne no_anonymous_* (Block aus 0078 erneut ausfuehren)",
    open.length === 0,
    open.join(", "),
  );
}

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
