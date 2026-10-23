import { LOCALE_CODES } from "@/i18n/locales";
import { applyProfilePatch } from "@/lib/account-core";
import { deleteAccountCore } from "@/lib/account-delete";
import {
  appActGuard,
  appError,
  appFailure,
  appGuard,
  appJson,
  appLoadMe,
  appReadJson,
} from "@/lib/app-api";
import type { AppDeleted } from "@/lib/app-api-types";
import { createBearerClient } from "@/lib/app-auth";
import { revokeAppleToken } from "@/lib/apple-revoke";
import { logOps } from "@/lib/ops";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ctx = await appGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    // Hier ist Anmeldung Pflicht: Gast = 401.
    if (!ctx.userId || !ctx.token) return appError("auth", 401);
    const me = await appLoadMe(ctx.userId, ctx.token, ctx.lang);
    if (!me) return appError("auth", 401);
    return appJson(me, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}

/**
 * Sprache und/oder Newsletter ändern. Gleiche Kerne wie das Web (account-core.ts), im Namen
 * des Nutzers über den Bearer-Client: Die RLS lässt nur die eigene Zeile durch.
 */
export async function PATCH(req: Request) {
  const ctx = await appActGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    const body = await appReadJson(req);
    if (!body) return appError("invalid", 400);
    // Unbekannte Felder sind ein Fehler, kein stilles Ignorieren: Ein Tippfehler der App
    // ("newsLetter") soll beim Entwickeln auffallen und nicht still nichts tun.
    const keys = Object.keys(body);
    if (keys.length === 0 || keys.some((k) => k !== "locale" && k !== "newsletter")) {
      return appError("invalid", 400);
    }
    const { locale, newsletter } = body;
    if (locale !== undefined && (typeof locale !== "string" || !LOCALE_CODES.includes(locale))) {
      return appError("invalid", 400);
    }
    if (newsletter !== undefined && typeof newsletter !== "boolean") {
      return appError("invalid", 400);
    }

    // EIN Update, auch wenn beide Felder kommen: Entweder gilt alles oder nichts.
    const { error } = await applyProfilePatch(createBearerClient(ctx.token), ctx.userId, {
      locale: typeof locale === "string" ? locale : undefined,
      newsletter: typeof newsletter === "boolean" ? newsletter : undefined,
    });
    if (error) throw new Error("patch me: update");

    const me = await appLoadMe(ctx.userId, ctx.token, ctx.lang);
    if (!me) return appError("auth", 401);
    return appJson(me, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}

const MAX_APPLE_CODE_LENGTH = 2000;

// Löschen plus Apple-Widerruf (zwei Aufrufe mit je 8 s Zeitgrenze) sollen nicht an der
// Standard-Zeitgrenze der Funktion hängen.
export const maxDuration = 30;

/**
 * Konto löschen (Apple-Pflicht, docs/41 Abschnitt 5).
 *
 * HINWEIS FÜR DIE APP: Läuft die Anfrage in einen Timeout, obwohl der Server das Konto schon
 * gelöscht hat, bekommt der Wiederholungsversuch 401 (das Konto gibt es nicht mehr). Die App
 * muss 401 bei DELETE /me als "gelöscht" behandeln und lokal abmelden.
 * Das Konto wird IMMER gelöscht, auch wenn
 * der Apple-Widerruf nicht klappt: Das Recht auf Löschung hängt nicht an Apples Erreichbarkeit
 * oder an unserer Konfiguration. Der Widerruf ist "best effort" und wird gemeldet.
 */
export async function DELETE(req: Request) {
  const ctx = await appActGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    const body = await appReadJson(req);
    if (!body) return appError("invalid", 400);
    const code = body.appleAuthorizationCode;
    if (
      Object.keys(body).some((k) => k !== "appleAuthorizationCode") ||
      (code !== undefined &&
        (typeof code !== "string" || code.length === 0 || code.length > MAX_APPLE_CODE_LENGTH))
    ) {
      return appError("invalid", 400);
    }

    const hasApple = (ctx.user.identities ?? []).some((i) => i.provider === "apple");

    // Erst löschen, dann widerrufen: Scheitert die Löschung (503), bleibt der Code für den
    // nächsten Versuch gültig und Apple hat noch nichts widerrufen.
    const { error } = await deleteAccountCore(ctx.userId);
    if (error) throw new Error("delete me: auth.admin.deleteUser");

    let appleRevoked: boolean | null = null;
    if (hasApple) {
      appleRevoked = false;
      const path = new URL(req.url).pathname;
      if (typeof code !== "string") {
        // Eigene Gruppe: Das ist ein Fehler der App, kein Ausfall bei Apple.
        await logOps("apple_revoke_failed", {
          message: "Apple-Konto gelöscht ohne authorizationCode, Apple-Token nicht widerrufen",
          path,
          group: "app-apple-revoke-nocode",
        });
      } else {
        const res = await revokeAppleToken(code);
        if (res.status === "revoked") appleRevoked = true;
        else if (res.status === "not_configured") {
          await logOps("config_missing", {
            message: "APPLE_SIWA_* fehlt: Apple-Token bei Kontolöschung nicht widerrufen",
            path,
            group: "app-apple-revoke",
          });
        } else {
          await logOps("apple_revoke_failed", {
            message: `Apple-Widerruf fehlgeschlagen (${res.reason})`,
            path,
            group: "app-apple-revoke",
          });
        }
      }
    }

    const out: AppDeleted = { deleted: true, appleRevoked };
    return appJson(out, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}
