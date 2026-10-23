import { appError, appJson, appRateLimit, appReadJson } from "@/lib/app-api";
import {
  AppleConfigError,
  AppleUnavailableError,
  handleAppleNotification,
  readAppleConfig,
  verifyAppleNotification,
} from "@/lib/apple-purchase";
import { logOps } from "@/lib/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ein signedPayload mit Zertifikatskette ist einige KB groß; 100 KB sind reichlich.
const MAX_BODY_BYTES = 100_000;

/**
 * App Store Server Notifications V2 (docs/41 Abschnitt 7): Apple meldet Erstattungen und
 * Entzüge. Es gibt KEINEN Authorization-Header: Die Apple-Signatur im signedPayload ist die
 * Anmeldung. Geprüft wird sie mit demselben Prüfer wie beim Kauf (Wurzeln, Bundle-ID,
 * App-ID, Umgebung). Nichts aus dem Body wird benutzt, was nicht in der Signatur steckt.
 *
 * Antworten, wie Apple sie auswertet: Jeder Status außer 200 gilt als Fehlschlag, und Apple
 * stellt dieselbe Benachrichtigung erneut zu (Production: nach 1, 12, 24, 48 und 72 Stunden).
 *   200  verarbeitet (oder bewusst nichts zu tun). NUR nach fertiger Verarbeitung.
 *   400  ungültige Signatur, Form oder fremde App: Eine Wiederholung ändert nichts, aber sie
 *        kommt trotzdem; wir melden es (apple_notification_invalid bzw. ..._app_mismatch).
 *   503  wir konnten es gerade nicht verarbeiten: Die Wiederholung heilt, die Verarbeitung ist
 *        idempotent.
 * Origin und CORS spielen keine Rolle (Server-zu-Server).
 */
export async function POST(req: Request) {
  // Pro IP begrenzt, nicht pro Konto: Die Route kennt keinen Nutzer. Apples Adressen sind
  // wenige, ihr Aufkommen (Erstattungen eines einmaligen Kaufs) winzig.
  if (!(await appRateLimit(req))) return appError("rate_limit", 429);

  const path = new URL(req.url).pathname;
  try {
    const body = await appReadJson(req, MAX_BODY_BYTES);
    const signed = body?.signedPayload;
    // Weitere Felder von Apple sind erlaubt (Apple darf das Format erweitern, ohne dass wir
    // Erstattungen verlieren); benutzt wird ausschließlich signedPayload.
    if (
      !body ||
      typeof signed !== "string" ||
      signed.length === 0 ||
      signed.length > MAX_BODY_BYTES
    ) {
      await logOps("apple_notification_invalid", {
        message: "Apple-Benachrichtigung mit ungültigem Aufbau abgewiesen.",
        path,
        group: "apple:notification:shape",
      });
      return appError("invalid", 400);
    }

    let cfg;
    try {
      cfg = readAppleConfig();
    } catch (e) {
      if (!(e instanceof AppleConfigError)) throw e;
      await logOps("config_missing", {
        message: `${e.message}. Apple-Erstattungen werden nicht verarbeitet.`,
        path,
        group: "app-apple-notification-config",
      });
      // 503: Apple stellt erneut zu, sobald die Konfiguration steht.
      return appError("unavailable", 503);
    }

    const verified = await verifyAppleNotification(signed, cfg);
    if (!verified.ok) {
      // Echte Apple-Signatur, aber die andere Umgebung als konfiguriert (z. B. Sandbox-
      // Benachrichtigung bei APPLE_IAP_ENVIRONMENT=Production): kein Angriff, nichts zu tun.
      if (verified.reason === "environment") return appJson({ ok: true, ignored: true }, "no-store");
      // Echte Apple-Signatur, aber Bundle-ID/App-ID passen nicht zu unserer Konfiguration: Das
      // ist meist ein Tippfehler in Vercel, und dann kommt KEINE Erstattung mehr an. Lauter
      // als eine gefälschte Signatur.
      await logOps(
        verified.reason === "wrong_app" ? "apple_notification_app_mismatch" : "apple_notification_invalid",
        {
          message: `Apple-Benachrichtigung abgewiesen (${verified.reason}).`,
          path,
          group: `apple:notification:${verified.reason}`,
          detail: { grund: verified.reason },
        },
      );
      return appError("invalid", 400);
    }

    await handleAppleNotification(verified);
    return appJson({ ok: true }, "no-store");
  } catch (e) {
    await logOps("apple_purchase_failed", {
      message:
        e instanceof AppleUnavailableError
          ? "Apple-Benachrichtigung: Zertifikatsprüfung bei Apple nicht erreichbar."
          : "Apple-Benachrichtigung konnte nicht verarbeitet werden.",
      error: e,
      path,
      group: e instanceof AppleUnavailableError ? "apple:notification:ocsp" : "apple:notification:store",
    });
    return appError("unavailable", 503);
  }
}
