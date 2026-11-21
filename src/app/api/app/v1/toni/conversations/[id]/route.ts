import { appError, appFailure, appGuard, appJson } from "@/lib/app-api";
import type { AppToniConversation } from "@/lib/app-api-types";
import { createBearerClient } from "@/lib/app-auth";
import { loadConversation } from "@/lib/ai-history";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ein früherer Toni-Chat mit allen Nachrichten und Karten. 404 für fremde, gelöschte oder
 * unbekannte Chats (die RLS entscheidet, siehe lib/ai-history.ts). Eine kaputte ID ist 400, damit
 * sie gar nicht erst bei der Datenbank ankommt.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await appGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    if (!ctx.userId || !ctx.token) return appError("auth", 401);
    const { id } = await params;
    if (!UUID_RE.test(id)) return appError("invalid", 400);
    const chat = await loadConversation(createBearerClient(ctx.token), id);
    if (!chat || !chat.conversationId) return appError("not_found", 404);
    const body: AppToniConversation = {
      conversationId: chat.conversationId,
      messages: chat.messages,
    };
    return appJson(body, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}
