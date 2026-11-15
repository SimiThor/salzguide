import { NextResponse, after } from "next/server";
import {
  clientCountry,
  clientIp,
  isBotUserAgent,
  trackEvent,
  visitorHash as analyticsVisitorHash,
} from "@/lib/analytics";
import {
  MAX_INPUT,
  admitAiRequest,
  dailyLimit,
  dateRef,
  hashedIpSubject,
  loadInterests,
  persistTurn,
  readAiUsage,
  sanitizeMessages,
  todayLabel,
} from "@/lib/ai-chat-core";
import { runAssistant } from "@/lib/ai-assistant";
import { recordAiInsight } from "@/lib/ai-insights";
import {
  appError,
  appFailure,
  appJson,
  appLang,
  appRateLimit,
  appReadJson,
} from "@/lib/app-api";
import type { AppToniReply, AppToniScope, AppToniStatus } from "@/lib/app-api-types";
import { appActor, createBearerClient, createGuestClient } from "@/lib/app-auth";
import { logOps } from "@/lib/ops";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
// Wie /api/ai/chat: Die KI hört nach 50 s von selbst auf (AI_TOTAL_BUDGET_MS), die Route lässt
// ihr 60 s Luft zum Antworten.
export const maxDuration = 60;

const PATH = "/api/app/v1/toni";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Wer fragt, und was darf er? Die Regeln sind die des Web-Chats (lib/ai-chat-core.ts):
//  - Mit Authorization-Header: angemeldetes Konto, beim Auth-Server bestätigt (appActor). Das
//    Handeln kostet Geld, darum reicht die lokale Token-Prüfung nicht. Anonyme Anmeldungen
//    und kaputte Tokens: 401. Zähler `u:<userId>`, derselbe wie im Web.
//  - Ohne Header: Gast. Das Web kennt Gäste über das Cookie sg_aid; die App schickt dafür eine
//    zufällige Geräte-ID im Header `X-SG-Device` (UUID, lokal erzeugt, kein Gerätekennzeichen).
//    Zähler `g:<id>`, dazu der IP-Backstop (40 je Tag), genau wie im Web.
type Who =
  | {
      kind: "user";
      userId: string;
      token: string;
      subject: string;
      isPro: boolean;
      isOperator: boolean;
    }
  | { kind: "guest"; subject: string | null };

async function resolveWho(
  req: Request,
  opts: { deviceOptional?: boolean } = {},
): Promise<Who | NextResponse> {
  if (req.headers.has("authorization")) {
    const actor = await appActor(req);
    if (!actor.ok) {
      return actor.reason === "auth" ? appError("auth", 401) : appError("unavailable", 503);
    }
    // Rolle und Pro server-autoritativ aus der DB, nie vom Client.
    const { data, error } = await createServiceClient()
      .from("profiles")
      .select("is_pro, role")
      .eq("id", actor.userId)
      .maybeSingle();
    if (error) throw error;
    return {
      kind: "user",
      userId: actor.userId,
      token: actor.token,
      subject: `u:${actor.userId}`,
      isPro: Boolean(data?.is_pro),
      isOperator: data?.role === "admin",
    };
  }
  const device = req.headers.get("x-sg-device");
  // GET ohne Kennung: Die App erzeugt sie erst mit der Einwilligung. Dann gibt es nur die Stufe, keinen Zählerstand.
  if (!device && opts.deviceOptional) return { kind: "guest", subject: null };
  if (!device || !UUID_RE.test(device)) return appError("invalid", 400);
  return { kind: "guest", subject: `g:${device.toLowerCase()}` };
}

function scopeOf(who: Who): AppToniScope {
  if (who.kind === "guest") return "guest";
  return who.isPro || who.isOperator ? "pro" : "free";
}

function limitOf(who: Who): number {
  return who.kind === "guest"
    ? dailyLimit({ guest: true, isPro: false, isOperator: false })
    : dailyLimit({ guest: false, isPro: who.isPro, isOperator: who.isOperator });
}

/** Stand von Toni für die Anzeige "noch X heute". Zählt NICHT hoch. */
export async function GET(req: Request) {
  if (!(await appRateLimit(req))) return appError("rate_limit", 429);
  if (!appLang(req)) return appError("invalid", 400);
  try {
    const who = await resolveWho(req, { deviceOptional: true });
    if (who instanceof NextResponse) return who;
    const limit = limitOf(who);
    const used = who.subject ? await readAiUsage(who.subject) : null;
    const body: AppToniStatus = {
      available: Boolean(process.env.ANTHROPIC_API_KEY),
      scope: scopeOf(who),
      limit,
      remaining: used === null ? null : Math.max(0, limit - used),
    };
    return appJson(body, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}

export async function POST(req: Request) {
  if (!(await appRateLimit(req))) return appError("rate_limit", 429);
  const lang = appLang(req);
  if (!lang) return appError("invalid", 400);
  try {
    const who = await resolveWho(req);
    if (who instanceof NextResponse) return who;
    const subject = who.subject;
    if (!subject) return appError("invalid", 400);

    // Body-Größe wie im Web: 24 Turns à höchstens 1600 Zeichen bleiben weit unter 100 KB.
    const body = await appReadJson(req, 100_000);
    if (!body) return appError("invalid", 400);
    const messages = sanitizeMessages(body.messages);
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser || lastUser.content.length > MAX_INPUT) return appError("invalid", 400);
    const rawConv = body.conversationId;
    if (rawConv !== undefined && rawConv !== null && typeof rawConv !== "string") {
      return appError("invalid", 400);
    }

    const isPro = who.kind === "user" ? who.isPro || who.isOperator : false;
    const limit = limitOf(who);
    const scope = scopeOf(who);

    const admission = await admitAiRequest({
      subject,
      limit,
      isPro: who.kind === "user" ? who.isPro : false,
      scope: who.kind === "guest" ? "guest" : "free",
      ipSubject: who.kind === "guest" ? hashedIpSubject(req) : null,
      path: PATH,
    });
    if (!admission.ok) {
      if (admission.status === 402) {
        return NextResponse.json(
          { error: "limit", scope },
          { status: 402, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } },
        );
      }
      return appError("rate_limit", 429);
    }

    const interests = who.kind === "user" ? await loadInterests(createBearerClient(who.token)) : null;

    // Pro-Maskierung: runAssistant lädt für Nicht-Pro nur freie Spots und gibt gesperrte nie in
    // Werkzeug-Antworten weiter (includePro/ctx.isPro), dieselbe Funktion wie im Web.
    const result = await runAssistant(messages, {
      isPro,
      locale: lang,
      todayLabel: todayLabel(lang),
      dateRef: dateRef(lang),
      interests,
      page: null,
      // Ohne Cookies: Die Spot-Abfragen laufen mit der Identität des Betrachters (RLS 0017), sonst sähe
      // auch ein Pro-Nutzer keine Pro-Spots.
      db: who.kind === "user" ? createBearerClient(who.token) : createGuestClient(),
    });
    if ("error" in result) {
      await logOps("ai_provider_error", {
        message: `Toni konnte nicht antworten: ${result.error}`,
        path: PATH,
        group: `ai:${result.error}`,
      });
      return appError("unavailable", 503);
    }

    const ua = req.headers.get("user-agent");
    const operator = who.kind === "user" && who.isOperator;
    if (!operator && !isBotUserAgent(ua)) {
      const ip = clientIp(req);
      const country = clientCountry(req);
      after(async () => {
        await trackEvent({
          type: "ai_query",
          // Der Standard-User-Agent von URLSession enthält kein "iPhone" (siehe /saved): "other".
          device: "other",
          locale: lang,
          country,
          visitorHash: await analyticsVisitorHash(ip, ua),
        });
      });
    }
    after(() =>
      recordAiInsight({
        message: lastUser.content,
        cards: result.cards,
        locale: lang,
        isOperator: operator,
      }),
    );

    // Verlauf speichern wie im Web (nur angemeldet, best effort). Dieselbe Tabelle: Der Chat
    // erscheint damit auch im Web-Verlauf, und die Löschfristen (data-retention.ts) gelten gleich.
    let conversationId: string | null = typeof rawConv === "string" ? rawConv : null;
    if (who.kind === "user") {
      try {
        conversationId = await persistTurn(
          createServiceClient(),
          who.userId,
          conversationId,
          lastUser.content,
          result.text,
          result.cards,
        );
      } catch {
        /* optional */
      }
    } else {
      conversationId = null;
    }

    const reply: AppToniReply = {
      text: result.text,
      cards: result.cards,
      conversationId,
      scope,
      limit,
      remaining: admission.remaining,
      aiGenerated: true,
    };
    const res = appJson(reply, "no-store");
    res.headers.set("X-AI-Generated", "true");
    return res;
  } catch (e) {
    return appFailure(req, e);
  }
}
