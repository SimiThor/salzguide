// KI-Assistent „Toni" — Chat-Endpoint (docs/16, 17, 02 §6).
// Ablauf: Eingabe prüfen -> Free-Limit serverseitig (Gast 3 / eingeloggt 15 / Pro ∞)
// -> Anton laufen lassen (Claude + Tools) -> Verlauf (eingeloggt) speichern ->
// Zähler hochsetzen. Bei Limit: HTTP 402 -> Frontend zeigt Soft-Paywall.
import { NextResponse, after } from "next/server";
import { bcp47, LOCALE_CODES } from "@/i18n/locales";
import { pickLabel, TODAY } from "@/lib/i18n-labels";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runAssistant } from "@/lib/ai-assistant";
import type { AiChatMessage } from "@/lib/ai-types";
import { recordAiInsight } from "@/lib/ai-insights";
import {
  trackEvent,
  visitorHash as analyticsVisitorHash,
  classifyDevice,
  clientCountry,
  classifyPath,
} from "@/lib/analytics";

export const runtime = "nodejs";

// Zentrale Stellschrauben (Gast 3 · eingeloggt-gratis 15 · Admin 200 · Pro unbegrenzt).
const GUEST_LIMIT = 3;
const FREE_LIMIT = 15;
// Admin/Betreiber: großzügig zum Testen, aber BEWUSST endlich (nicht unbegrenzt).
// Sicherheit: kappt den Worst-Case-Anthropic-Kostentag selbst dann, wenn eine
// Admin-Session gestohlen würde (Denial-of-Wallet-Schutz). Zusätzlich greift das
// Burst-Limit (6/min) weiterhin auch für Admins -> die Anfrage-RATE bleibt gedeckelt.
const ADMIN_LIMIT = 200;
// Kosten-/DoS-Backstop pro IP & Tag (nur Gäste): fängt das Umgehen des Gast-
// Cookies (Cookie löschen -> wieder 3 frei) ab, ohne echte Nutzer hinter NAT zu
// treffen (bewusst großzügig, rein als Abuse-Bremse).
const IP_GUEST_CAP = 40;
// Burst-Schutz: max. BURST_MAX Anfragen pro BURST_WINDOW_SECONDS je Subjekt (auch Pro).
const BURST_WINDOW_SECONDS = 60;
const BURST_MAX = 6;
const MAX_INPUT = 800; // Zeichen pro Nachricht (docs/16 §2)
const MAX_TURNS = 24; // wie viele Verlaufsnachrichten an die KI gehen
const GUEST_COOKIE = "sg_aid"; // anonyme Geräte-ID für das Gast-Limit
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Vertrauenswürdige Client-IP: auf Vercel überschreibt der Edge `x-forwarded-for`
// (Anti-Spoofing), und `x-real-ip` ist die eindeutige, vom Edge gesetzte Einzel-IP.
// NICHT einfach den linkesten XFF-Wert nehmen (der wäre ohne Trusted-Proxy fälschbar).
// Hinweis: gilt für das Vercel-Deployment; bei Selbst-Hosting ohne Trusted-Proxy neu bewerten.
function clientIp(req: Request): string | null {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  // Fallback: Vercel setzt XFF selbst -> erster Eintrag ist die echte Client-IP.
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0]?.trim() || null;
}

// Client-IP pseudonymisieren (SHA-256 + Server-Secret als Salt) -> kein Klartext-
// IP in der DB (DSGVO-Datensparsamkeit), aber stabil pro Tag als Abuse-Schlüssel.
function hashedIpSubject(req: Request): string | null {
  const ip = clientIp(req);
  if (!ip) return null;
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "salzguide";
  const hash = createHash("sha256").update(`${ip}:${salt}`).digest("hex").slice(0, 24);
  return `ip:${hash}`;
}


function todayLabel(locale: string): string {
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
function dateRef(locale: string): string {
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
function sanitizeMessages(raw: unknown): AiChatMessage[] {
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

export async function POST(req: Request) {
  // CSRF/Cross-Site-Schutz: Die App ruft same-origin auf. Ist ein Origin-Header
  // gesetzt und passt NICHT zum Host, ist es ein Cross-Site-Aufruf -> ablehnen
  // (verhindert, dass eine fremde Seite fremde KI-Kontingente verbraucht).
  const originHeader = req.headers.get("origin");
  if (originHeader) {
    let originHost = "";
    try {
      originHost = new URL(originHeader).host;
    } catch {
      /* ungültiger Origin */
    }
    if (originHost !== req.headers.get("host")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  // Body-Size-Cap (Speicher-DoS): legitimer Verlauf ist << 100 KB (24 Turns × ~1600 Zeichen).
  const declaredLen = Number(req.headers.get("content-length") ?? 0);
  if (declaredLen > 100_000) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const {
    messages: rawMessages,
    conversationId: rawConvId,
    locale: rawLocale,
    page: rawPage,
  } = (body ?? {}) as {
    messages?: unknown;
    conversationId?: unknown;
    locale?: unknown;
    page?: unknown;
  };

  // Volle Locale nutzen (nicht mehr auf en/de stauchen!): so antwortet Toni + alle Datum-/
  // Titel-Lookups in ALLEN 9 Sprachen. Unbekannte Werte -> Deutsch.
  const locale = LOCALE_CODES.includes(rawLocale as (typeof LOCALE_CODES)[number])
    ? (rawLocale as string)
    : "de";
  const messages = sanitizeMessages(rawMessages);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) {
    return NextResponse.json({ error: "empty" }, { status: 400 });
  }
  if (lastUser.content.length > MAX_INPUT) {
    return NextResponse.json({ error: "too_long" }, { status: 400 });
  }

  // ── Subjekt + Limit bestimmen ──────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let subject: string;
  let limit: number;
  let isPro = false;
  let isOperator = false; // eingeloggter Admin -> nicht in Analytics zählen
  let scope: "guest" | "free" = "free";
  let setGuestCookie: string | null = null;

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_pro, role")
      .eq("id", user.id)
      .maybeSingle();
    isPro = Boolean(profile?.is_pro);
    // Rolle ist server-autoritativ aus der DB (per authentifizierter Session) – NICHT
    // vom Client setzbar; der Trigger 0016 verhindert Selbst-Eskalation zu 'admin'.
    // Daher kann ein normaler Nutzer das höhere Limit nicht erschleichen.
    isOperator = (profile as { role?: string } | null)?.role === "admin";
    subject = `u:${user.id}`;
    limit = isPro
      ? Number.POSITIVE_INFINITY
      : isOperator
        ? ADMIN_LIMIT
        : FREE_LIMIT;
    scope = "free";
  } else {
    const cookieStore = await cookies();
    const raw = cookieStore.get(GUEST_COOKIE)?.value;
    // NUR ein UUID-förmiges Cookie akzeptieren -> ein manuell gesetztes, überlanges
    // sg_aid kann keine riesigen ai_usage/ai_burst-Subjekte anlegen (Storage-Abuse).
    let aid = raw && UUID_RE.test(raw) ? raw : "";
    if (!aid) {
      aid = crypto.randomUUID();
      setGuestCookie = aid;
    }
    subject = `g:${aid}`;
    limit = GUEST_LIMIT;
    scope = "guest";
  }

  const service = createServiceClient();
  // IP-Backstop nur für Gäste (eingeloggte haben ihr eigenes User-Limit).
  const ipSubject = scope === "guest" ? hashedIpSubject(req) : null;

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
      const res = NextResponse.json({ error: "rate_limited" }, { status: 429 });
      if (setGuestCookie) attachGuestCookie(res, setGuestCookie);
      return res;
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
        const res = NextResponse.json({ error: "limit", scope }, { status: 402 });
        if (setGuestCookie) attachGuestCookie(res, setGuestCookie);
        return res;
      }
    }
    // Cookie-Umgehung (frische Gast-ID pro Request) über die IP abfangen — ebenfalls atomar.
    if (ipSubject) {
      try {
        const { data: ipCount } = await service.rpc("bump_ai_usage", {
          p_subject: ipSubject,
        });
        if (typeof ipCount === "number" && ipCount > IP_GUEST_CAP) {
          const res = NextResponse.json({ error: "rate_limited" }, { status: 429 });
          if (setGuestCookie) attachGuestCookie(res, setGuestCookie);
          return res;
        }
      } catch {
        /* fail-open */
      }
    }
  }

  // Leise Personalisierung: die Kategorien der bereits gemerkten Spots (eigene
  // Daten, RLS-gefiltert) als Interessen-Hinweis. Best effort, nie blockierend.
  let interests: string | null = null;
  if (user) {
    try {
      const { data: savedRows } = await supabase
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
      interests = top.length ? top.join(", ") : null;
    } catch {
      /* best effort */
    }
  }

  // Seiten-Kontext: hilft Toni, sich auf die aktuelle Seite zu beziehen (z.B.
  // „dieser Spot"). Edge-Case, aber praktisch. Nur öffentliche Seiten, kein Personenbezug.
  let pageContext: string | null = null;
  if (typeof rawPage === "string" && rawPage) {
    const info = classifyPath(rawPage);
    if (info) {
      if (info.kind === "spot" && info.target) {
        try {
          const { data: sp } = await supabase
            .from("spots")
            .select("spot_translations(title, lang)")
            .eq("slug", info.target)
            .eq("status", "published")
            .maybeSingle();
          const trs = (sp?.spot_translations ?? []) as { title: string; lang: string }[];
          const title =
            trs.find((tr) => tr.lang === locale)?.title ??
            trs.find((tr) => tr.lang === "de")?.title ??
            info.target;
          pageContext = `der Spot-Detailseite „${title}" (slug: ${info.target})`;
        } catch {
          pageContext = "einer Spot-Detailseite";
        }
      } else {
        const LABELS: Record<string, string> = {
          landing: "der Startseite (erklärt SalzGuide, noch nicht in der App)",
          explore: "der Entdecken-Karte",
          home: "der Entdecken-Karte", // Altbestand: vor dem Umzug 07/2026 war „/" die Karte
          events: "dem Event-Kalender",
          water: "der Wassertemperaturen-Übersicht",
          saved: "seiner Merkliste",
          profile: "Profil / Einstellungen",
          other: "einer anderen Seite der App",
        };
        pageContext = LABELS[info.kind] ?? null;
      }
    }
  }

  // ── Toni laufen lassen ──────────────────────────────────────────────────────
  const result = await runAssistant(messages, {
    isPro,
    locale,
    todayLabel: todayLabel(locale),
    dateRef: dateRef(locale),
    interests,
    page: pageContext,
  });

  if ("error" in result) {
    const res = NextResponse.json({ error: "ai" }, { status: 502 });
    if (setGuestCookie) attachGuestCookie(res, setGuestCookie);
    return res;
  }

  // Analytics (cookieless, best effort): eine erfolgreiche KI-Anfrage.
  // Nur echte Nutzer zählen — der eingeloggte Betreiber (Admin) wird ausgenommen.
  if (!isOperator) {
    const ua = req.headers.get("user-agent");
    await trackEvent({
      type: "ai_query",
      device: classifyDevice(ua),
      locale,
      country: clientCountry(req),
      visitorHash: await analyticsVisitorHash(clientIp(req), ua),
    });
  }

  // Anonyme Chatbot-Auswertung (docs/34 §I): leitet aus der Anfrage NUR feste Codes
  // ab (kein Rohtext, kein Nutzerbezug) und speichert sie. Läuft via after() NACH
  // der Antwort -> keine zusätzliche Latenz für den Nutzer. Best effort.
  after(() =>
    recordAiInsight({
      message: lastUser.content,
      cards: result.cards,
      locale,
      isOperator,
    }),
  );

  // ── Verlauf speichern (best effort, nie den Chat blockieren) ──
  // (Zähler wurden bereits vor dem Lauf atomar hochgesetzt.)
  let conversationId: string | null =
    typeof rawConvId === "string" ? rawConvId : null;
  if (user) {
    try {
      conversationId = await persistTurn(
        service,
        user.id,
        conversationId,
        lastUser.content,
        result.text,
        result.cards,
      );
    } catch {
      /* Verlauf-Speichern optional – Antwort bleibt gültig. */
    }
  }

  const res = NextResponse.json({
    text: result.text,
    cards: result.cards,
    conversationId,
    remaining,
  });
  if (setGuestCookie) attachGuestCookie(res, setGuestCookie);
  return res;
}

function attachGuestCookie(res: NextResponse, aid: string) {
  res.cookies.set(GUEST_COOKIE, aid, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365, // 1 Jahr
    path: "/",
  });
}

// Neuen User-Turn + Antwort in den Verlauf schreiben (Konversation ggf. anlegen).
// Nutzt den Service-Client -> RLS wird bewusst umgangen, Eigentum manuell geprüft.
async function persistTurn(
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
