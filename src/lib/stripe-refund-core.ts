// Die Regeln der Stripe-Erstattung (und des verlorenen Chargebacks), ohne Datenbank (prüfbar mit
// scripts/app-purchase-check.ts).
//
// WARUM ES DAS GIBT (Anton 27.11.2026): Wer Pro auf salzguide.com gekauft hat und in der App ohne
// Anmeldung noch einmal über Apple kauft, hat doppelt bezahlt. Erstatten wir ihm den Web-Kauf, darf
// er Pro nicht verlieren, denn den Apple-Kauf hat er ja bezahlt. Umgekehrt darf NIE jemand Pro
// behalten, der nach der Erstattung gar nichts mehr bezahlt hat. Darum gilt:
//
//   1. Erst den Anspruch der erstatteten ZAHLUNG abräumen (pro_purchases.refunded_at), dann das
//      Profil. Je Zahlung (payment_intent), nicht je Kunde: Ein Kunde kann zweimal gekauft haben,
//      und eine erneut zugestellte alte Erstattung darf den neuen, bezahlten Kauf nicht treffen.
//      Nur wenn keine Zeile zu dieser Zahlung existiert (alte Käufe ohne payment_intent), gilt
//      wie bisher die ganze Kunden-ID. Ab diesem Moment sieht der Apple-Entzug
//      (applyAppleRevocation, Regel 7) den Stripe-Kauf als erstattet.
//   2. Je Konto mit Pro aus 'stripe', das zu dieser Kunden-ID ODER zu einem der erstatteten Ansprüche
//      gehört (user_id). Beides, weil ein Gast, der zweimal kauft, zwei Kunden-IDs hat, das Profil
//      aber nur die erste trägt (Prüfung 27.11.2026: sonst bliebe Pro nach beiden Erstattungen):
//      a. Hat das Konto noch einen anderen bezahlten, nicht erstatteten Web-Kauf: nichts tun.
//      b. Sonst hat es als BESITZER (user_id, nicht als anonymer Mit-Inhaber) einen nicht
//         erstatteten Apple-Kauf aus dem echten App Store (environment = 'Production')? Dann die
//         Quelle auf 'apple' umstellen (eine spätere Apple-Erstattung findet nur 'apple') und
//         danach NOCH EINMAL prüfen: Wurde der Apple-Kauf genau dazwischen erstattet, fand der
//         Apple-Entzug noch 'stripe' vor und tat nichts. Dann entziehen wir hier selbst.
//         Sandbox-Käufe (TestFlight, App-Prüfung) kosten nichts und halten nie Pro.
//      c. Sonst entziehen (nur pro_source = 'stripe', nur diese Kunden-ID).
//   3. Je solchem Konto mit Pro aus 'apple' ohne bezahlten Apple-Kauf und ohne
//      bezahlten Web-Kauf: entziehen. Das heilt den Fall, dass ein früherer Durchlauf nach der
//      Umstellung (2b) abbrach (Datenbankfehler, Stripe stellt erneut zu): Ohne diesen Schritt
//      fände die Wiederholung das Konto nicht mehr (Quelle schon 'apple') und Pro bliebe stehen.
//
// Geschenktes ('comp') und übernommenes ('migration') Pro bleibt wie bisher unberührt. Alles ist
// wiederholbar: Ein Fehler wirft, der Webhook antwortet 500, Stripe stellt erneut zu.

export type ProAccount = { id: string; source: "stripe" | "apple" };

export type StripeRefundStore = {
  /**
   * Anspruch der erstatteten Zahlung als erstattet markieren (refunded_at). Gibt es zu
   * `paymentIntent` eine Zeile, NUR diese (ist sie schon erstattet, ändert sich nichts). Sonst
   * (kein payment_intent bekannt oder alte Zeile ohne) alle offenen Zeilen der Kunden-ID.
   * Liefert die Konten (user_id) der betroffenen Zeilen, auch wenn sie schon erstattet waren
   * (wiederholte Zustellung bewertet sie neu). Wirft bei Fehler.
   */
  markClaimsRefunded(customerId: string, paymentIntent: string | null): Promise<string[]>;
  /** Konten mit is_pro und pro_source 'stripe' oder 'apple': Kunden-ID ODER id in `userIds`. */
  proAccounts(customerId: string, userIds: string[]): Promise<ProAccount[]>;
  /** Hat das Konto (user_id) einen eingelösten, nicht erstatteten Web-Kauf? */
  hasPaidStripePurchase(userId: string): Promise<boolean>;
  /**
   * Hat das Konto als BESITZER (user_id) einen nicht erstatteten Apple-Kauf aus dem echten App Store
   * (environment = 'Production', revoked_at null)? Anonyme Mit-Inhaber zählen nicht.
   */
  hasPaidApplePurchase(userId: string): Promise<boolean>;
  /** pro_source 'stripe' -> 'apple', NUR wo id, pro_source = 'stripe' und is_pro. */
  switchStripeProToApple(userId: string): Promise<boolean>;
  /** is_pro = false, NUR wo id, pro_source = 'stripe' und is_pro. */
  removeStripePro(userId: string): Promise<boolean>;
  /** is_pro = false, NUR wo id und pro_source = 'apple'. */
  removeApplePro(userId: string): Promise<boolean>;
};

export type StripeRefundResult = {
  /** Konten, denen Pro entzogen wurde. */
  removed: string[];
  /** Konten, deren Pro über einen bezahlten Apple-Kauf weiterläuft (Quelle jetzt 'apple'). */
  keptByApple: string[];
  /** Konten, deren Pro ein anderer bezahlter Web-Kauf weiter trägt. */
  keptByStripe: string[];
};

export async function applyStripeRefund(
  store: StripeRefundStore,
  customerId: string,
  paymentIntent: string | null,
): Promise<StripeRefundResult> {
  // 1. Zuerst der Anspruch (siehe oben).
  const claimOwners = await store.markClaimsRefunded(customerId, paymentIntent);

  const removed: string[] = [];
  const keptByApple: string[] = [];
  const keptByStripe: string[] = [];
  for (const account of await store.proAccounts(customerId, claimOwners)) {
    const userId = account.id;
    if (await store.hasPaidStripePurchase(userId)) {
      // 2a / 3: Ein anderer bezahlter Web-Kauf trägt Pro.
      if (account.source === "stripe") keptByStripe.push(userId);
      continue;
    }
    if (account.source === "apple") {
      // 3. Selbstheilung nach einem abgebrochenen Durchlauf. Ein bezahlter Apple-Kauf trägt Pro
      //    (das ist der Normalfall eines Apple-Käufers, der früher einmal im Web gekauft hat).
      if (!(await store.hasPaidApplePurchase(userId)) && (await store.removeApplePro(userId))) {
        removed.push(userId);
      }
      continue;
    }
    if (await store.hasPaidApplePurchase(userId)) {
      // 2b. Quelle umstellen. false = das Profil hat sich zwischendurch geändert (kein Pro mehr
      //     oder eine andere Quelle): dann ist hier nichts zu tun, die andere Stelle hat entschieden.
      if (!(await store.switchStripeProToApple(userId))) continue;
      // Nachprüfen, sonst bliebe Pro nach zwei Erstattungen stehen.
      if (await store.hasPaidApplePurchase(userId)) {
        keptByApple.push(userId);
      } else if (await store.removeApplePro(userId)) {
        removed.push(userId);
      }
    } else if (await store.removeStripePro(userId)) {
      // 2c.
      removed.push(userId);
    }
  }
  return { removed, keptByApple, keptByStripe };
}
