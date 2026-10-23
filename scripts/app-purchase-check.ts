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
  type AppleStore,
  type AppleTx,
  type PurchaseRow,
  type ProfileState,
  type GrantOptions,
} from "@/lib/apple-purchase-core";
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
for (const k of ["apple_purchase_failed", "apple_purchase_invalid", "apple_purchase_foreign", "apple_purchase_manual", "apple_notification_invalid", "apple_notification_ignored"]) {
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
    return r ? { ...r } : null;
  }
  async insertPurchase(row: PurchaseRow) {
    this.hook("insertPurchase");
    if (this.purchases.has(row.originalTransactionId)) return false;
    this.purchases.set(row.originalTransactionId, { ...row });
    return true;
  }
  async bindPurchase(id: string, userId: string) {
    this.hook("bindPurchase");
    const r = this.purchases.get(id);
    if (!r || r.userId !== null || r.revokedAt !== null) return false;
    r.userId = userId;
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
        r.userId === userId &&
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
  s.purchases.set("100", { originalTransactionId: "100", userId: null, productId: PRODUCT, environment: "Production", purchasedAt: now(), revokedAt: null, appAccountToken: "99999999-9999-4999-8999-999999999999" });
  const r = await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: "99999999-9999-4999-8999-999999999999" }), now);
  eq("user_id null (Konto geloescht) -> an angemeldetes Konto gebunden", [r.status, r.status === "granted" && r.rebound, r.status === "granted" && r.newPurchase, s.purchases.get("100")?.userId], ["granted", true, false, USER_A]);
  eq("... und Pro gesetzt", s.profiles.get(USER_A), { isPro: true, proSource: "apple" });
}

console.log(" c) Wiederherstellen: viele Transaktionen, jede fuer sich");
{
  const s = fresh();
  s.purchases.set("200", { originalTransactionId: "200", userId: USER_B, productId: PRODUCT, environment: "Production", purchasedAt: now(), revokedAt: null, appAccountToken: USER_B });
  s.purchases.set("300", { originalTransactionId: "300", userId: null, productId: PRODUCT, environment: "Production", purchasedAt: now(), revokedAt: null, appAccountToken: null });
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
    s.purchases.set("100", { originalTransactionId: "100", userId: USER_B, productId: PRODUCT, environment: "Production", purchasedAt: now(), revokedAt: null, appAccountToken: null });
  };
  const r = await bindAndGrantApplePro(s, USER_A, tx({ appAccountToken: null }), now);
  eq("Einfuegen verliert das Rennen gegen anderes Konto -> foreign", [r.status, s.purchases.get("100")?.userId, s.profiles.get(USER_A)?.isPro], ["foreign", USER_B, false]);
}
{
  const s = fresh();
  s.purchases.set("100", { originalTransactionId: "100", userId: null, productId: PRODUCT, environment: "Production", purchasedAt: now(), revokedAt: null, appAccountToken: null });
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
  const tables: Record<string, Record<string, unknown>[]> = { profiles: [], pro_purchases: [] };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const table = url.pathname.split("/").pop() as string;
    const rows = tables[table] ?? [];
    const match = (r: Record<string, unknown>) =>
      [...url.searchParams.entries()].every(([k, v]) => {
        if (k === "select") return true;
        if (v.startsWith("eq.")) return String(r[k]) === v.slice(3);
        if (v === "is.null") return r[k] == null;
        return true;
      });
    if ((init?.method ?? "GET").toUpperCase() === "PATCH") {
      for (const r of rows.filter(match)) Object.assign(r, JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
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

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
