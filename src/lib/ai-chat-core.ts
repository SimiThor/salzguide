import "server-only";
// Gemeinsamer Kern des Toni-Chats für Web (/api/ai/chat) und App (/api/app/v1/toni).
// Hier steht alles, was NICHT an Cookies oder Bearer-Token hängt: Limits, Zähler, Eingabe-
// Bereinigung, Datumsangaben für den Prompt, Interessen und Verlauf. Beide Routen rufen
// dieselben Funktionen, damit Web und App EIN Tageskontingent teilen (Zähler `u:<userId>`)
// und nie auseinanderlaufen. Der Prompt und die Werkzeuge bleiben in ai-assistant.ts.
// Kein "use server": Diese Datei exportiert Konstanten und Funktionen, keine Server Actions.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bcp47 } from "@/i18n/locales";
import { pickLabel, TODAY } from "@/lib/i18n-labels";
import type { AiChatMessage } from "@/lib/ai-types";
import { clientIp } from "@/lib/analytics";
import { createServiceClient } from "@/lib/supabase/service";
import { logOps } from "@/lib/ops";

// Zentrale Stellschrauben (Gast 3 · eingeloggt-gratis 5 · Pro 15 · Admin 200).
export const GUEST_LIMIT = 3;
// Gratis bewusst knapp über dem Gast (Antons Entscheidung, 07/2026): 15 war so hoch,
// dass praktisch niemand die Limit-Karte (und damit den Pro-Pitch) je gesehen hat, und
// der Abstand zu Pro (50) fühlte sich nach nichts an. 5 deckt ein echtes Plan-Gespräch,
// danach steht das Angebot. Die Leiter Gast -> Gratis -> Pro muss dabei stimmen bleiben:
// jede Stufe spürbar mehr als die davor ("frag Toni öfter" in Ai.paywallGuestBody).
export const FREE_LIMIT = 5;
// Pro: spürbar mehr als gratis, aber BEWUSST endlich und knapp (Antons Regel, 07/2026).
// Zwei Gründe. Rechtlich: Toni ist KEIN Pro-Bestandteil und wird nirgends so verkauft —
// wäre er Teil des Pro-Kaufs, hinge er mit am Widerruf (§ 18 FAGG deckt die digitalen
// INHALTE ab, keinen KI-Dienst). Wirtschaftlich: Pro ist EINE Zahlung, jede Toni-Anfrage
// kostet uns danach für immer Anthropic-Geld. 50/Tag hätte einem Dauernutzer erlaubt, die
// Marge eines Einmal-Kaufs in Wochen aufzufressen; 15 deckt auch einen intensiven
// Urlaubstag und hält den Worst-Case-Kostentag pro Konto klein (dazu Burst 6/min).
// Kein "ohne Limit", weder im Text noch im Code.
export const PRO_LIMIT = 15;
// Admin/Betreiber: großzügig zum Testen, aber BEWUSST endlich (nicht unbegrenzt).
// Sicherheit: kappt den Worst-Case-Anthropic-Kostentag selbst dann, wenn eine
// Admin-Session gestohlen würde (Denial-of-Wallet-Schutz). Zusätzlich greift das
// Burst-Limit (6/min) weiterhin auch für Admins -> die Anfrage-RATE bleibt gedeckelt.
export const ADMIN_LIMIT = 200;
// Kosten-/DoS-Backstop pro IP & Tag (nur Gäste): fängt das Umgehen des Gast-
// Cookies (Cookie löschen -> wieder 3 frei) ab, ohne echte Nutzer hinter NAT zu
// treffen (bewusst großzügig, rein als Abuse-Bremse).
export const IP_GUEST_CAP = 40;
// Burst-Schutz: max. BURST_MAX Anfragen pro BURST_WINDOW_SECONDS je Subjekt (auch Pro).
export const BURST_WINDOW_SECONDS = 60;
export const BURST_MAX = 6;
export const MAX_INPUT = 800; // Zeichen pro Nachricht (docs/16 §2)
export const MAX_TURNS = 24; // wie viele Verlaufsnachrichten an die KI gehen

export type AiScope = "guest" | "free";

/** Tageslimit je Stufe. Eine Quelle für Web, App und die Anzeige "noch X heute". */
export function dailyLimit(opts: { guest: boolean; isPro: boolean; isOperator: boolean }): number {
  if (opts.guest) return GUEST_LIMIT;
  return opts.isOperator ? ADMIN_LIMIT : opts.isPro ? PRO_LIMIT : FREE_LIMIT;
}

// Client-IP pseudonymisieren (SHA-256 + Server-Secret als Salt) -> kein Klartext-
// IP in der DB (DSGVO-Datensparsamkeit), aber stabil pro Tag als Abuse-Schlüssel.
// Die IP selbst kommt aus lib/analytics.ts (eine Kopie, nicht zwei).
export function hashedIpSubject(req: Request): string | null {
  const ip = clientIp(req);
  if (!ip) return null;
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "salzguide";
  const hash = createHash("sha256").update(`${ip}:${salt}`).digest("hex").slice(0, 24);
  return `ip:${hash}`;
}

export function todayLabel(locale: string): string {
  return new Intl.DateTimeFormat(bcp47(locale), {
    timeZone: "Europe/Vienna",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

// Eindeutige Datums-Referenz der nächsten 14 Tage (Europe/Vienna) -> die KI muss
// Wochentag<->Datum NIE selbst ausrechnen (LLMs verrechnen sich dabei oft).
export function dateRef(locale: string): string {
  const dl = bcp47(locale);
  const wd = new Intl.DateTimeFormat(dl, { timeZone: "Europe/Vienna", weekday: "long" });
  const dm = new Intl.DateTimeFormat(dl, {
    timeZone: "Europe/Vienna",
    day: "numeric",
    month: "numeric",
  });
  const now = Date.now();
  const lines: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(now + i * 86_400_000);
    const tag = i === 0 ? ` (${pickLabel(TODAY, locale)})` : "";
    lines.push(`${wd.format(d)} ${dm.format(d)}${tag}`);
  }
  return lines.join(" · ");
}

// Nur saubere user/assistant-Textnachrichten, gekürzt auf den letzten Abschnitt.
export function sanitizeMessages(raw: unknown): AiChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: AiChatMessage[] = [];
  for (const m of raw) {
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string")
      continue;
    const text = content.trim();
    if (!text) continue;
    out.push({ role, content: text.slice(0, MAX_INPUT * 2) });
  }
  return out.slice(-MAX_TURNS);
}

/** Tag im Zähler (Wiener Kalendertag, wie bump_ai_usage ihn schreibt). */
function viennaDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Heutiger Zählerstand eines Subjekts, OHNE hochzusetzen. null = nicht lesbar. */
export async function readAiUsage(subject: string): Promise<number | null> {
  try {
    const { data, error } = await createServiceClient()
      .from("ai_usage")
      .select("count")
      .eq("subject", subject)
      .eq("day", viennaDay())
      .maybeSingle();
    if (error) return null;
    return typeof data?.count === "number" ? data.count : 0;
  } catch {
    return null;
  }
}

export type AiAdmission =
  | { ok: true; remaining: number | null }
  | { ok: false; status: 402 | 429; body: { error: string; scope?: string } };

/**
 * Burst-Limit, Tageslimit und (nur Gäste) IP-Backstop, in genau dieser Reihenfolge. Setzt den
 * Tageszähler atomar hoch (bump-first). Ausgelagert aus api/ai/chat/route.ts, unverändert.
 * `path` nennt die Route fürs Ops-Log.
 */
export async function admitAiRequest(opts: {
  subject: string;
  limit: number;
  isPro: boolean;
  scope: AiScope;
  ipSubject: string | null;
  path: string;
}): Promise<AiAdmission> {
  const { subject, limit, isPro, scope, ipSubject, path } = opts;
  const service = createServiceClient();

  // 1) Burst-Limit ZUERST (atomar, Kurzzeit-Schutz gegen Hämmern/Concurrency) —
  // für ALLE, auch Pro. So verbraucht ein geblockter Burst kein Tages-Kontingent.
  // Best effort: Funktion fehlt (vor Migration 0018) -> durchlassen.
  try {
    const { data: allowed } = await service.rpc("hit_ai_burst", {
      p_subject: subject,
      p_window_seconds: BURST_WINDOW_SECONDS,
      p_max: BURST_MAX,
    });
    if (allowed === false) {
      return { ok: false, status: 429, body: { error: "rate_limited" } };
    }
  } catch {
    /* Burst-Backend nicht verfügbar -> nicht blockieren */
  }

  // 2) Free-Limit ATOMAR (bump-first) — schließt die TOCTOU-Race: nebenläufige
  // Requests können den Zähler nicht mehr gemeinsam unterlaufen (der atomare
  // Upsert serialisiert). Pro (Infinity) überspringt. Best effort: RPC fehlt
  // (vor Migration) -> Limit nicht erzwungen. Ein blockierter/fehlschlagender
  // Request zählt mit (harmlos: er ist ohnehin über dem Limit bzw. selten).
  let remaining: number | null = null;
  if (Number.isFinite(limit)) {
    let count: number | null = null;
    try {
      const { data } = await service.rpc("bump_ai_usage", { p_subject: subject });
      if (typeof data === "number") count = data;
    } catch {
      /* RPC nicht verfügbar -> fail-open */
    }
    if (count !== null) {
      remaining = Math.max(0, limit - count);
      if (count > limit) {
        // "pro" nach draußen melden: Die Paywall-Karte im Chat zeigt Pro-Nutzern am Limit
        // KEINEN Kauf-Knopf (sie haben Pro schon) — nur Gast und Gratis bekommen ihren CTA.
        return {
          ok: false,
          status: 402,
          body: { error: "limit", scope: isPro ? "pro" : scope },
        };
      }
    }
    // Cookie-Umgehung (frische Gast-ID pro Request) über die IP abfangen — ebenfalls atomar.
    if (ipSubject) {
      try {
        const { data: ipCount } = await service.rpc("bump_ai_usage", {
          p_subject: ipSubject,
        });
        if (typeof ipCount === "number" && ipCount > IP_GUEST_CAP) {
          // Denial of Wallet: Genau hier läuft jemand auf, der unser Claude-Kontingent
          // verbrennen will (OWASP LLM, docs/34 §G). Dass die Grenze hält, ist kein Fehler
          // und deshalb keine Fehlermeldung — aber wenn sie oft hält, wird gerade
          // automatisiert gefahren, und das will man wissen, BEVOR die Rechnung kommt.
          // Die Schwelle dafür steht im Katalog, nicht hier.
          await logOps("ai_ip_cap_hit", {
            message: "Tageslimit einer Adresse am KI-Chat ausgeschöpft.",
            path,
            subject: ipSubject,
            group: "ai:ip_cap",
            detail: { grenze: IP_GUEST_CAP, stand: ipCount },
          });
          return { ok: false, status: 429, body: { error: "rate_limited" } };
        }
      } catch {
        /* fail-open */
      }
    }
  }
  return { ok: true, remaining };
}

/**
 * Leise Personalisierung: die Kategorien der bereits gemerkten Spots (eigene Daten, RLS-
 * gefiltert durch den übergebenen Client) als Interessen-Hinweis. Best effort, nie blockierend.
 */
export async function loadInterests(client: SupabaseClient): Promise<string | null> {
  try {
    const { data: savedRows } = await client
      .from("saved_items")
      .select("spots(subtype)")
      .limit(40);
    const counts = new Map<string, number>();
    for (const row of (savedRows ?? []) as {
      spots: { subtype: string | null } | { subtype: string | null }[] | null;
    }[]) {
      const sp = Array.isArray(row.spots) ? row.spots[0] : row.spots;
      const st = sp?.subtype;
      if (st) counts.set(st, (counts.get(st) ?? 0) + 1);
    }
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k]) => k);
    return top.length ? top.join(", ") : null;
  } catch {
    return null;
  }
}

// Neuen User-Turn + Antwort in den Verlauf schreiben (Konversation ggf. anlegen).
// Nutzt den Service-Client -> RLS wird bewusst umgangen, Eigentum manuell geprüft.
export async function persistTurn(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  conversationId: string | null,
  userText: string,
  assistantText: string,
  cards: unknown,
): Promise<string> {
  let convId = conversationId;

  // Vorhandene Konversation nur akzeptieren, wenn sie dem User gehört.
  if (convId) {
    const { data: owned } = await service
      .from("ai_conversations")
      .select("id")
      .eq("id", convId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!owned) convId = null;
  }

  if (!convId) {
    const { data: created, error } = await service
      .from("ai_conversations")
      .insert({ user_id: userId, title: userText.slice(0, 80) })
      .select("id")
      .single();
    if (error || !created) throw error ?? new Error("no conversation");
    convId = created.id as string;
  }
  if (!convId) throw new Error("no conversation id");
  const cid: string = convId;

  await service.from("ai_messages").insert([
    { conversation_id: cid, role: "user", content: userText, cards: null },
    {
      conversation_id: cid,
      role: "assistant",
      content: assistantText,
      cards,
    },
  ]);
  await service
    .from("ai_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", cid);

  return cid;
}
