import "server-only";

// Der ENTSCHEIDUNGSKERN des Apple-Kaufs (docs/41 Abschnitt 7): wem gehört eine Transaktion,
// wann gibt es Pro, wann wird es entzogen. Reine Logik gegen eine schmale Speicher-Schnittstelle
// (AppleStore), ohne Datenbank, ohne Netz, ohne Apple-Bibliothek.
//
// WARUM DAS VON apple-purchase.ts GETRENNT IST: An dieser Logik hängt Geld. Sie muss mit einem
// Speicher im Arbeitsspeicher durchgespielt werden können (scripts/app-purchase-check.ts), jede
// Regel einzeln, auch die Rennen. Das Prüf-Skript importiert diese Datei, nicht einen Nachbau.
//
// DIE REGELN, in einem Satz je Regel:
//   1. Eine original_transaction_id gehört genau einem Konto (Primärschlüssel).
//   2. Gehört sie einem LEBENDEN anderen Konto: ablehnen ("foreign"), nie umbinden.
//   3. Gehört sie niemandem mehr (user_id null, Konto gelöscht): an das angemeldete Konto binden.
//   4. Neu: der appAccountToken in der Transaktion muss die ID des angemeldeten Kontos sein.
//      Fehlt er (alte Transaktion), wird an das angemeldete Konto gebunden.
//   5. Ist is_pro schon true, wird pro_source NIE geändert (Geschenk, Übernahme, Stripe bleiben).
//   6. Eine erstattete/entzogene Zeile (revoked_at) wird nie wieder freigeschaltet, auch nicht
//      durch eine alte, noch gültig signierte Transaktion (Wiedereinspielen nach Erstattung).
//   7. Entzug nimmt Pro nur, wenn pro_source = 'apple' UND kein anderer nicht erstatteter
//      Apple-Kauf desselben Kontos übrig ist.

/** Eine geprüfte Transaktion, auf das Nötige reduziert. Entsteht nur nach erfolgreicher Prüfung. */
export type AppleTx = {
  originalTransactionId: string;
  productId: string;
  environment: "Production" | "Sandbox";
  purchasedAt: string; // ISO
  /** Klein geschriebene UUID oder null (alte Transaktionen ohne Token). */
  appAccountToken: string | null;
  /** ISO-Zeitpunkt der Erstattung/des Entzugs, wenn die (signierte) Transaktion einen trägt. */
  revokedAt: string | null;
};

export type PurchaseRow = {
  originalTransactionId: string;
  userId: string | null;
  productId: string;
  environment: "Production" | "Sandbox";
  purchasedAt: string;
  revokedAt: string | null;
  appAccountToken: string | null;
};

export type ProfileState = {
  isPro: boolean;
  proSource: string | null;
  stripeCustomerId?: string | null;
};

/**
 * Was der Kern vom Speicher braucht. Jede Methode, die etwas ändert, trägt ihre Bedingung IM
 * Schreibvorgang (UPDATE ... WHERE), nicht in einem vorher gelesenen Zustand: Zwei gleichzeitige
 * Anfragen (Doppeltipp, Wiederherstellen plus Benachrichtigung) dürfen sich nicht überholen.
 */
export interface AppleStore {
  getPurchase(originalTransactionId: string): Promise<PurchaseRow | null>;
  /** true = angelegt, false = die Zeile gab es schon (Primärschlüssel). Andere Fehler werfen. */
  insertPurchase(row: PurchaseRow): Promise<boolean>;
  /** Bindet NUR, wenn user_id null UND revoked_at null ist. true = diese Zeile wurde geändert. */
  bindPurchase(originalTransactionId: string, userId: string): Promise<boolean>;
  /** Setzt revoked_at, wenn es noch leer ist. */
  markRevoked(originalTransactionId: string, at: string): Promise<void>;
  getProfile(userId: string): Promise<ProfileState | null>;
  /** is_pro = true, pro_source = 'apple' NUR wo is_pro noch false ist. true = geändert. */
  grantProIfNotPro(userId: string, at: string): Promise<boolean>;
  /**
   * Gibt es einen anderen, nicht erstatteten Apple-Kauf dieses Kontos, der Pro trägt?
   * `refundedEnvironment`: Production-Zeilen zählen immer, Sandbox-Zeilen nur, wenn auch die
   * erstattete Zeile Sandbox war. Ein Sandbox-Kauf hält nach einer Production-Erstattung kein
   * Pro am Leben.
   */
  hasOtherActivePurchase(
    userId: string,
    exceptOriginalTransactionId: string,
    refundedEnvironment: "Production" | "Sandbox",
  ): Promise<boolean>;
  /** is_pro = false NUR wo pro_source = 'apple'. true = geändert. */
  removeAppleProIfApple(userId: string): Promise<boolean>;
  /**
   * Hat das Konto einen aktiven Stripe-Kauf (pro_purchases: eingelöst, nicht erstattet)?
   * null = nein. Sonst die Kunden-ID dieses Kaufs (kann null sein, wenn Stripe keine lieferte).
   */
  hasActiveStripePurchase(userId: string): Promise<{ customerId: string | null } | null>;
  /**
   * pro_source von 'apple' auf 'stripe' UND stripe_customer_id setzen, NUR wo pro_source = 'apple'
   * und is_pro. true = geändert. Die Kunden-ID gehört dazu: revokePro() (Stripe-Erstattung)
   * findet das Profil nur über stripe_customer_id + pro_source = 'stripe'; ein Gast-Kauf hat die
   * ID nie ans Profil geschrieben.
   */
  switchAppleProToStripe(userId: string, customerId: string): Promise<boolean>;
  /** is_pro = false NUR wo id = userId, pro_source = 'stripe' UND stripe_customer_id = customerId. */
  removeStripeProForCustomer(userId: string, customerId: string): Promise<boolean>;
  /** Gibt es zu dieser ID ein Konto (Profil)? */
  profileExists(userId: string): Promise<boolean>;
}

/** Optionen, die aus der Konfiguration kommen. */
export type GrantOptions = {
  /**
   * Erlaubnisliste für Sandbox-Käufe (Konto-IDs). null = alle Sandbox-Käufe dürfen (nötig für
   * die App-Store-Prüfung). Gesetzt = nur diese Konten bekommen Pro aus Sandbox-Käufen.
   */
  sandboxUsers: string[] | null;
};

export type GrantResult =
  | {
      status: "granted" | "already";
      originalTransactionId: string;
      /** Zeile in dieser Anfrage neu angelegt (Grundlage für das Conversion-Ereignis). */
      newPurchase: boolean;
      /** Zeile eines gelöschten Kontos an dieses Konto gebunden. */
      rebound: boolean;
      /** Dieser Aufruf hat is_pro von false auf true gesetzt. */
      proChanged: boolean;
      /** Hatte das Konto schon Pro aus anderer Quelle? Dann steht hier die Quelle. */
      alreadyEntitledBy: string | null;
      /** Neue Transaktion, deren Token auf ein GELÖSCHTES Konto zeigte: an dieses Konto gebunden. */
      tokenAccountDeleted: boolean;
    }
  | {
      status: "foreign";
      originalTransactionId: string;
      reason: "owned_by_other_account" | "token_mismatch";
    }
  | { status: "revoked"; originalTransactionId: string }
  | {
      status: "invalid";
      originalTransactionId: string;
      reason: "environment_mismatch" | "sandbox_not_allowed";
    };

export type RevokeResult = {
  status: "revoked" | "already_revoked" | "tombstoned" | "unknown" | "environment_mismatch";
  /** Hat dieser Aufruf is_pro auf false gesetzt? */
  proRemoved: boolean;
  /** Stripe hatte ebenfalls bezahlt: pro_source wurde auf 'stripe' umgestellt, Pro bleibt. */
  switchedToStripe: boolean;
  /** Aktiver Stripe-Kauf ohne Kunden-ID: Umstellen nicht möglich, Pro wurde entzogen (Handarbeit). */
  stripeWithoutCustomer: boolean;
};

// Wie oft ein verlorenes Rennen (ein anderer war schneller) neu bewertet wird, bevor der
// Aufruf als Fehler endet. Zwei reichen für jeden echten Ablauf, drei lassen Luft.
const MAX_ATTEMPTS = 3;

/**
 * Eine geprüfte Transaktion dem angemeldeten Konto zuordnen und Pro freischalten.
 *
 * Idempotent: Derselbe Aufruf zweimal ergibt "granted" und danach "already", ohne zweite
 * Wirkung. Wirft bei Speicherfehlern (die Route antwortet 503, die App versucht es erneut);
 * alles, was die Regeln ablehnen, ist ein Ergebnis und kein Fehler.
 */
export async function bindAndGrantApplePro(
  store: AppleStore,
  userId: string,
  tx: AppleTx,
  now: () => string = () => new Date().toISOString(),
  opts: GrantOptions = { sandboxUsers: null },
): Promise<GrantResult> {
  const id = tx.originalTransactionId;

  // Erlaubnisliste für Sandbox-Käufe (APPLE_IAP_SANDBOX_USERS). Vor allem anderen: Ein Sandbox-
  // Kauf eines nicht gelisteten Kontos verbucht nichts und bindet nichts.
  if (tx.environment === "Sandbox" && opts.sandboxUsers && !opts.sandboxUsers.includes(userId)) {
    return { status: "invalid", originalTransactionId: id, reason: "sandbox_not_allowed" };
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const existing = await store.getPurchase(id);

    if (existing) {
      // Umgebungen bleiben getrennt: Dieselbe ID in Sandbox und Production ist ein Widerspruch
      // (Apple vergibt sie nicht doppelt). Nichts binden, nichts ändern.
      if (existing.environment !== tx.environment) {
        return { status: "invalid", originalTransactionId: id, reason: "environment_mismatch" };
      }

      // Regel 6 zuerst: Eine erstattete Zeile bleibt erstattet, wem auch immer sie gehört.
      if (existing.revokedAt) return { status: "revoked", originalTransactionId: id };

      // Die Transaktion selbst sagt "erstattet" (Apple hat signiert): Entzug, kein Pro.
      if (tx.revokedAt) {
        await applyAppleRevocation(store, id, tx, tx.revokedAt);
        return { status: "revoked", originalTransactionId: id };
      }

      // Regel 2: ein lebendes anderes Konto. Nie umbinden.
      if (existing.userId !== null && existing.userId !== userId) {
        return { status: "foreign", originalTransactionId: id, reason: "owned_by_other_account" };
      }

      // Schon dieses Konto: wiederholter Aufruf. Pro trotzdem sicherstellen ("Reparatur", falls
      // der Schalter beim ersten Mal scheiterte).
      if (existing.userId === userId) {
        const pro = await ensurePro(store, userId, id, now);
        return {
          status: "already",
          originalTransactionId: id,
          newPurchase: false,
          rebound: false,
          tokenAccountDeleted: false,
          ...pro,
        };
      }

      // Regel 3: user_id null, das Konto des früheren Käufers ist gelöscht. Binden. Hat in der
      // Zwischenzeit jemand anderes gebunden (Rennen), neu lesen und neu bewerten.
      if (!(await store.bindPurchase(id, userId))) continue;
      const pro = await ensurePro(store, userId, id, now);
      return {
        status: "granted",
        originalTransactionId: id,
        newPurchase: false,
        rebound: true,
        tokenAccountDeleted: false,
        ...pro,
      };
    }

    // Neue Transaktion. Schon erstattet, bevor wir sie je gesehen haben: nichts verbuchen.
    if (tx.revokedAt) return { status: "revoked", originalTransactionId: id };

    // Regel 4: der Token muss auf das angemeldete Konto zeigen. Fehlt er, binden wir.
    // Zeigt der Token auf ein Konto, das es NICHT MEHR gibt (Käufer hat sein Konto gelöscht und
    // sich neu angemeldet), gehört die Transaktion dem Menschen vor uns: Nur sein Gerät hat sie.
    // Dann binden wir an das angemeldete Konto und lassen es melden (Handarbeit prüft).
    let tokenAccountDeleted = false;
    if (tx.appAccountToken !== null && tx.appAccountToken !== userId) {
      if (await store.profileExists(tx.appAccountToken)) {
        return { status: "foreign", originalTransactionId: id, reason: "token_mismatch" };
      }
      tokenAccountDeleted = true;
    }

    const inserted = await store.insertPurchase({
      originalTransactionId: id,
      userId,
      productId: tx.productId,
      environment: tx.environment,
      purchasedAt: tx.purchasedAt,
      revokedAt: null,
      appAccountToken: tx.appAccountToken,
    });
    if (!inserted) continue; // ein anderer war schneller: neu lesen
    const pro = await ensurePro(store, userId, id, now);
    return {
      status: "granted",
      originalTransactionId: id,
      newPurchase: true,
      rebound: false,
      tokenAccountDeleted,
      ...pro,
    };
  }

  throw new Error("apple purchase: Zuordnung nach mehreren Versuchen nicht stabil");
}

// Pro sicherstellen. Regel 5: Ist is_pro schon true, wird NICHTS geschrieben, pro_source bleibt.
async function ensurePro(
  store: AppleStore,
  userId: string,
  originalTransactionId: string,
  now: () => string,
): Promise<{ proChanged: boolean; alreadyEntitledBy: string | null }> {
  const profile = await store.getProfile(userId);
  // Kein Profil: Die Zeile ist verbucht, aber es gibt niemanden zum Freischalten (Konto in
  // diesem Moment gelöscht). Als Fehler melden, nicht stillschweigend "granted" sagen.
  if (!profile) throw new Error("apple purchase: kein Profil zum Freischalten");

  let proChanged = false;
  let alreadyEntitledBy: string | null = null;

  if (profile.isPro) {
    alreadyEntitledBy = profile.proSource === "apple" ? null : (profile.proSource ?? "unknown");
  } else {
    proChanged = await store.grantProIfNotPro(userId, now());
    if (!proChanged) {
      // Zwischen Lesen und Schreiben wurde das Konto Pro (andere Quelle). Dann gilt Regel 5.
      const again = await store.getProfile(userId);
      alreadyEntitledBy =
        again?.isPro && again.proSource !== "apple" ? (again.proSource ?? "unknown") : null;
    }
  }

  // Rennen gegen den Entzug: Wurde die Zeile zwischen Prüfung und Schalter erstattet, hätte der
  // Entzug (der is_pro noch nicht false vorfand) nichts zu entziehen gehabt. Nachprüfen und
  // gegebenenfalls zurücknehmen, sonst bliebe Pro nach einer Erstattung stehen.
  if (proChanged) {
    const row = await store.getPurchase(originalTransactionId);
    if (row?.revokedAt) {
      await applyAppleRevocation(store, originalTransactionId, null, row.revokedAt);
      proChanged = false;
    }
  }

  return { proChanged, alreadyEntitledBy };
}

/**
 * Eine Erstattung/einen Entzug verbuchen (Notification REFUND/REVOKE oder eine signierte
 * Transaktion mit revocationDate). Idempotent.
 *
 * Pro wird NUR entzogen, wenn pro_source = 'apple' (die Bedingung steckt im UPDATE) und das
 * Konto keinen anderen nicht erstatteten Apple-Kauf hat. Geschenk, Übernahme und Stripe
 * bleiben unberührt.
 *
 * `tx` wird gebraucht, wenn die Zeile noch nicht existiert: Dann legen wir sie als erstattet
 * an (ohne Konto). Sonst könnte jemand eine VOR der Erstattung signierte Transaktion später
 * einreichen und bekäme Pro für Geld, das er zurückhat.
 */
export async function applyAppleRevocation(
  store: AppleStore,
  originalTransactionId: string,
  tx: AppleTx | null,
  at: string,
): Promise<RevokeResult> {
  let row = await store.getPurchase(originalTransactionId);

  if (!row) {
    if (!tx) return { status: "unknown", proRemoved: false, switchedToStripe: false, stripeWithoutCustomer: false };
    const inserted = await store.insertPurchase({
      originalTransactionId,
      userId: null,
      productId: tx.productId,
      environment: tx.environment,
      purchasedAt: tx.purchasedAt,
      revokedAt: at,
      appAccountToken: tx.appAccountToken,
    });
    if (inserted) return { status: "tombstoned", proRemoved: false, switchedToStripe: false, stripeWithoutCustomer: false };
    // Zwischen Lesen und Anlegen kam die Zeile (Kauf wurde verbucht): normal weiter.
    row = await store.getPurchase(originalTransactionId);
    if (!row) throw new Error("apple purchase: Zeile weder lesbar noch anlegbar");
  }

  // Eine Sandbox-ID kann nie eine Production-Zeile erstatten (und umgekehrt).
  if (tx && row.environment !== tx.environment) {
    return { status: "environment_mismatch", proRemoved: false, switchedToStripe: false, stripeWithoutCustomer: false };
  }

  const wasRevoked = row.revokedAt !== null;
  if (!wasRevoked) await store.markRevoked(originalTransactionId, at);

  // Den Entzug IMMER versuchen, auch wenn revoked_at schon stand: Ein früherer Aufruf kann
  // zwischen "erstattet" und "Pro entzogen" gescheitert sein, und die Wiederholung (Apple
  // stellt erneut zu) muss das heilen.
  let proRemoved = false;
  let switchedToStripe = false;
  let stripeWithoutCustomer = false;
  if (row.userId !== null) {
    const stillPaid = await store.hasOtherActivePurchase(
      row.userId,
      originalTransactionId,
      row.environment,
    );
    if (!stillPaid) {
      // Doppelt bezahlt (Stripe UND Apple): Das Konto hat einen aktiven Stripe-Kauf. Dann den
      // Entzug NICHT ausführen, sondern die Quelle auf 'stripe' stellen: Pro bleibt, und eine
      // spätere Stripe-Erstattung greift wieder (sie filtert auf pro_source = 'stripe').
      const stripe = await store.hasActiveStripePurchase(row.userId);
      if (stripe && stripe.customerId) {
        switchedToStripe = await store.switchAppleProToStripe(row.userId, stripe.customerId);
        // Rennen: Wurde der Stripe-Kauf zwischen Prüfung und Umstellung erstattet, fand
        // revokePro() (pro_source = 'stripe') noch nichts zu entziehen. Nach der Umstellung noch
        // einmal prüfen und dann selbst entziehen, sonst bliebe Pro nach zwei Erstattungen stehen.
        // revokePro() selbst bleibt unverändert.
        if (switchedToStripe && !(await store.hasActiveStripePurchase(row.userId))) {
          proRemoved = await store.removeStripeProForCustomer(row.userId, stripe.customerId);
          switchedToStripe = false;
        }
      } else {
        // Kein aktiver Stripe-Kauf, oder einer ohne Kunden-ID (nicht umstellbar: die Stripe-
        // Erstattung fände das Profil nie). Dann wie gehabt entziehen; im zweiten Fall melden.
        proRemoved = await store.removeAppleProIfApple(row.userId);
        stripeWithoutCustomer = stripe !== null;
      }
    }
  }
  return {
    status: wasRevoked ? "already_revoked" : "revoked",
    proRemoved,
    switchedToStripe,
    stripeWithoutCustomer,
  };
}
