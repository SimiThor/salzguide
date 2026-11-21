import { appError, appFailure, appGuard, appJson } from "@/lib/app-api";
import type { AppToniConversations } from "@/lib/app-api-types";
import { createBearerClient } from "@/lib/app-auth";
import { listConversations } from "@/lib/ai-history";

export const runtime = "nodejs";

/**
 * Die früheren Toni-Chats des Kontos. Dieselbe Abfrage wie die Liste im Web (lib/ai-history.ts),
 * nur mit dem Bearer-Client: Die RLS (0015) gibt nur eigene Chats heraus. Gäste: 401, sie haben
 * keinen gespeicherten Verlauf.
 */
export async function GET(req: Request) {
  const ctx = await appGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    if (!ctx.userId || !ctx.token) return appError("auth", 401);
    const body: AppToniConversations = {
      conversations: await listConversations(createBearerClient(ctx.token)),
    };
    return appJson(body, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}
