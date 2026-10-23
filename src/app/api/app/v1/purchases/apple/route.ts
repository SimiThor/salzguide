import {
  appActGuard,
  appError,
  appJson,
  appReadJson,
  appUserRateLimit,
} from "@/lib/app-api";
import type { AppApplePurchaseResponse } from "@/lib/app-api-types";
import { appCanSeePro } from "@/lib/app-auth";
import {
  AppleConfigError,
  AppleUnavailableError,
  readAppleConfig,
  settleAppleTransactions,
} from "@/lib/apple-purchase";
import { logOps, opsSubject } from "@/lib/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bis zu 50 Prüfungen von je einigen Millisekunden; großzügig, damit "Käufe wiederherstellen"
// mit vielen Transaktionen nie an der Standard-Zeitgrenze hängt.
export const maxDuration = 30;

const MAX_TRANSACTIONS = 50;
const MAX_TRANSACTION_LENGTH = 10_000;
// 50 * (10 000 + Anführungszeichen und Komma) plus Rahmen.
const MAX_BODY_BYTES = MAX_TRANSACTIONS * (MAX_TRANSACTION_LENGTH + 3) + 200;

// Dreiteilig, Base64URL. Das ist nur die Form; geprüft wird die Signatur danach.
const JWS_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * Apple-Kauf verbuchen (docs/41 Abschnitt 7). Die App schickt die signierten Transaktionen
 * (StoreKit 2, JWS) nach dem Kauf oder bei "Käufe wiederherstellen". Der Server prüft die
 * Signatur selbst, nimmt NICHTS aus dem Body außer den Signaturen und entscheidet dann
 * anhand der geprüften Angaben (lib/apple-purchase-core.ts).
 *
 * HANDELN: auth.getUser beim Auth-Server (appActGuard). Ein Gast oder gelöschtes Konto kauft nicht.
 */
export async function POST(req: Request) {
  const ctx = await appActGuard(req);
  if (ctx instanceof Response) return ctx;

  const path = new URL(req.url).pathname;
  try {
    const body = await appReadJson(req, MAX_BODY_BYTES);
    if (!body) return appError("invalid", 400);
    const list = body.signedTransactions;
    if (
      Object.keys(body).some((k) => k !== "signedTransactions") ||
      !Array.isArray(list) ||
      list.length === 0 ||
      list.length > MAX_TRANSACTIONS ||
      list.some((x) => typeof x !== "string" || x.length === 0 || x.length > MAX_TRANSACTION_LENGTH)
    ) {
      return appError("invalid", 400);
    }

    // Je Konto höchstens 20 Anfragen in 10 Minuten (ein Kauf = eine, Wiederherstellen = eine).
    if (!(await appUserRateLimit(ctx.userId, "iap", 600, 20))) return appError("rate_limit", 429);

    // Konfiguration VOR der Arbeit prüfen: Fehlt etwas, kann niemand kaufen, und der Fehler
    // soll als eigene, laute Meldung ankommen und nicht als "Transaktion ungültig".
    let cfg;
    try {
      cfg = readAppleConfig();
    } catch (e) {
      if (!(e instanceof AppleConfigError)) throw e;
      await logOps("config_missing", {
        message: `${e.message}. Käufe aus der iOS-App werden nicht verbucht.`,
        path,
        group: "app-apple-purchase-config",
      });
      return appError("unavailable", 503);
    }

    // Formfehler einzelner Einträge sind ein Ergebnis "invalid" für genau diesen Eintrag.
    const valid: { index: number; value: string }[] = [];
    (list as string[]).forEach((value, index) => {
      if (JWS_SHAPE.test(value)) valid.push({ index, value });
    });
    const settled = await settleAppleTransactions(
      ctx.userId,
      valid.map((v) => v.value),
      ctx.lang,
      cfg,
    );

    const results: AppApplePurchaseResponse["results"] = (list as string[]).map(() => ({
      originalTransactionId: null,
      status: "invalid" as const,
    }));
    valid.forEach((v, i) => {
      results[v.index] = settled[i];
    });

    const out: AppApplePurchaseResponse = {
      canSeePro: await appCanSeePro(ctx.userId),
      results,
    };
    return appJson(out, "no-store");
  } catch (e) {
    // Hier hängt Geld dran: eigene Meldung (error, sofort) statt der allgemeinen "server_error".
    // Die App wiederholt den Aufruf, die Verbuchung ist idempotent.
    await logOps("apple_purchase_failed", {
      message:
        e instanceof AppleUnavailableError
          ? "Apple-Kauf: Zertifikatsprüfung bei Apple nicht erreichbar."
          : "Apple-Kauf konnte nicht verbucht werden.",
      error: e,
      path,
      subject: opsSubject("user", ctx.userId),
      group: e instanceof AppleUnavailableError ? "apple:purchase:ocsp" : "apple:purchase:store",
    });
    return appError("unavailable", 503);
  }
}
