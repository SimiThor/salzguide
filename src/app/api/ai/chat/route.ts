// KI-Assistent „Toni" — Chat-Endpoint (docs/16, 17, 02 §6).
// Ablauf: Eingabe prüfen -> Free-Limit serverseitig (Gast 3 / Gratis 5 / Pro 15)
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
import { logOps, subjectFromRequest } from "@/lib/ops";
import {
  trackEvent,
  visitorHash as analyticsVisitorHash,
  classifyDevice,
  clientCountry,
  clientIp,
  classifyPath,
  isBotUserAgent,
} from "@/lib/analytics";

export const runtime = "nodejs";

// Zeitlimit der Route. Ohne diese Zeile galt der knappe Standardwert der Plattform, während
// runAssistant sich intern bis zu neun Minuten nehmen durfte (6 Tool-Runden × 2 Versuche ×
// 45 s) — die beiden Zahlen kannten einander nicht. Jetzt gilt: Die KI hört nach 50 s von
// selbst auf (AI_TOTAL_BUDGET_MS in lib/ai-assistant.ts), die Route lässt ihr 60 s Luft zum
// Antworten. Wer nach einer Minute noch auf einen Chat wartet, hat die App längst zugemacht.
export const maxDuration = 60;

// Zentrale Stellschrauben (Gast 3 · eingeloggt-gratis 5 · Pro 15 · Admin 200).
const GUEST_LIMIT = 3;
// Gratis bewusst knapp über dem Gast (Antons Entscheidung, 07/2026): 15 war so hoch,
// dass praktisch niemand die Limit-Karte (und damit den Pro-Pitch) je gesehen hat, und
// der Abstand zu Pro (50) fühlte sich nach nichts an. 5 deckt ein echtes Plan-Gespräch,
// danach steht das Angebot. Die Leiter Gast -> Gratis -> Pro muss dabei stimmen bleiben:
// jede Stufe spürbar mehr als die davor ("frag Toni öfter" in Ai.paywallGuestBody).
const FREE_LIMIT = 5;
// Pro: spürbar mehr als gratis, aber BEWUSST endlich und knapp (Antons Regel, 07/2026).
// Zwei Gründe. Rechtlich: Toni ist KEIN Pro-Bestandteil und wird nirgends so verkauft —
// wäre er Teil des Pro-Kaufs, hinge er mit am Widerruf (§ 18 FAGG deckt die digitalen
// INHALTE ab, keinen KI-Dienst). Wirtschaftlich: Pro ist EINE Zahlung, jede Toni-Anfrage
// kostet uns danach für immer Anthropic-Geld. 50/Tag hätte einem Dauernutzer erlaubt, die
// Marge eines Einmal-Kaufs in Wochen aufzufressen; 15 deckt auch einen intensiven
// Urlaubstag und hält den Worst-Case-Kostentag pro Konto klein (dazu Burst 6/min).
// Kein "ohne Limit", weder im Text noch im Code.
const PRO_LIMIT = 15;
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

// Die Client-IP kommt aus lib/analytics.ts und wird NICHT hier noch einmal ausgelesen.
// Bis 07/2026 stand dieselbe Funktion in beiden Dateien wortgleich — und ausgerechnet diese
// Route bildet mit ihr den Besucher-Hash, mit dem ihre KI-Anfragen zu denselben Sitzungen
// gehören sollen wie die Seitenaufrufe aus /api/track. Zwei Kopien, die genau
// übereinstimmen müssen, sind eine Kopie zu viel.
//
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
      // Hier wiegt der Riegel schwerer als bei der Reichweitenmessung: Wer von aussen auf
      // diesen Endpunkt schreibt, verbraucht unser Claude-Kontingent, also echtes Geld.
      await logOps("suspicious_request", {
        message: `KI-Anfrage von fremder Herkunft (${originHost || "unlesbar"}) abgewiesen.`,
        path: "/api/ai/chat",
        subject: subjectFromRequest(req),
        group: "origin:ai",
      });
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
    limit = isOperator ? ADMIN_LIMIT : isPro ? PRO_LIMIT : FREE_LIMIT;
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
        // "pro" nach draußen melden: Die Paywall-Karte im Chat zeigt Pro-Nutzern am Limit
        // KEINEN Kauf-Knopf (sie haben Pro schon) — nur Gast und Gratis bekommen ihren CTA.
        const res = NextResponse.json(
          { error: "limit", scope: isPro ? "pro" : scope },
          { status: 402 },
        );
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
          // Denial of Wallet: Genau hier läuft jemand auf, der unser Claude-Kontingent
          // verbrennen will (OWASP LLM, docs/34 §G). Dass die Grenze hält, ist kein Fehler
          // und deshalb keine Fehlermeldung — aber wenn sie oft hält, wird gerade
          // automatisiert gefahren, und das will man wissen, BEVOR die Rechnung kommt.
          // Die Schwelle dafür steht im Katalog, nicht hier.
          await logOps("ai_ip_cap_hit", {
            message: "Tageslimit einer Adresse am KI-Chat ausgeschöpft.",
            path: "/api/ai/chat",
            subject: ipSubject,
            group: "ai:ip_cap",
            detail: { grenze: IP_GUEST_CAP, stand: ipCount },
          });
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
    // Toni antwortet nicht. Für den Besucher ist das ein „gerade nicht erreichbar", für uns
    // die Frage, ob Anthropic hakt, das Guthaben leer ist oder der Schlüssel fehlt — alle
    // drei sehen von aussen gleich aus. `result.error` ist eine von uns formulierte kurze
    // Meldung (siehe ai-assistant.ts), kein roher Anbieter-Text, und trägt genau diesen
    // Unterschied.
    //
    // Nach der Meldung gruppiert, nicht pauschal: „ANTHROPIC_API_KEY fehlt" ist ein anderer
    // Vorfall als „KI-Fehler (529)", und der eine soll den anderen nicht stumm schalten.
    await logOps("ai_provider_error", {
      message: `Toni konnte nicht antworten: ${result.error}`,
      path: "/api/ai/chat",
      group: `ai:${result.error}`,
    });
    const res = NextResponse.json({ error: "ai" }, { status: 502 });
    if (setGuestCookie) attachGuestCookie(res, setGuestCookie);
    return res;
  }

  // Analytics (cookieless, best effort): eine erfolgreiche KI-Anfrage.
  // Nur echte Nutzer zählen — der eingeloggte Betreiber (Admin) wird ausgenommen.
  //
  // Via after() wie die Auswertung darunter: Der Nutzer hat gerade zwanzig Sekunden auf
  // Toni gewartet, er soll nicht noch auf zwei Datenbank-Schreibvorgänge warten, die mit
  // seiner Antwort nichts zu tun haben. Header JETZT auslesen — in after() ist das
  // Request-Objekt nicht mehr garantiert lesbar.
  const ua = req.headers.get("user-agent");
  // Betreiber zählt nicht, Maschine auch nicht — dieselbe Regel wie in /api/track, aus
  // derselben Quelle. Die ANTWORT bekommt der Aufrufer trotzdem; hier geht es nur darum,
  // was in der Reichweitenmessung landet.
  if (!isOperator && !isBotUserAgent(ua)) {
    const ip = clientIp(req);
    const country = clientCountry(req);
    after(async () => {
      await trackEvent({
        type: "ai_query",
        device: classifyDevice(ua),
        locale,
        country,
        visitorHash: await analyticsVisitorHash(ip, ua),
      });
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
    // 90 Tage, vorher ein Jahr. Datensparsamkeit (Art. 5 Abs. 1 lit. c DSGVO): Das Cookie
    // trägt ein Limit von DREI Fragen durch. Wer nach drei Monaten wiederkommt, hat mit
    // grosser Wahrscheinlichkeit ohnehin ein neues Gerät, einen neuen Browser oder längst
    // ein Konto. Ein Jahr war länger als der Zweck, und genau das muss eine Speicherdauer
    // nicht sein. Steht so auch in der Datenschutzerklärung (Punkt 3i) — beide Zahlen
    // gehören zusammen geändert.
    maxAge: 60 * 60 * 24 * 90,
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
