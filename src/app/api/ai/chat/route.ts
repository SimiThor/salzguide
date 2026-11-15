// KI-Assistent „Toni" — Chat-Endpoint (docs/16, 17, 02 §6).
// Ablauf: Eingabe prüfen -> Free-Limit serverseitig (Gast 3 / Gratis 5 / Pro 15)
// -> Anton laufen lassen (Claude + Tools) -> Verlauf (eingeloggt) speichern ->
// Zähler hochsetzen. Bei Limit: HTTP 402 -> Frontend zeigt Soft-Paywall.
import { NextResponse, after } from "next/server";
import { LOCALE_CODES } from "@/i18n/locales";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runAssistant } from "@/lib/ai-assistant";
import {
  ADMIN_LIMIT,
  FREE_LIMIT,
  GUEST_LIMIT,
  MAX_INPUT,
  PRO_LIMIT,
  admitAiRequest,
  dateRef,
  hashedIpSubject,
  loadInterests,
  persistTurn,
  sanitizeMessages,
  todayLabel,
} from "@/lib/ai-chat-core";
import { recordAiInsight } from "@/lib/ai-insights";
import { logOps, subjectFromRequest } from "@/lib/ops";
import { foreignOrigin } from "@/lib/same-origin";
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

const GUEST_COOKIE = "sg_aid"; // anonyme Geräte-ID für das Gast-Limit
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  // CSRF/Cross-Site-Schutz: Die App ruft same-origin auf. Ist ein Origin-Header
  // gesetzt und passt NICHT zu unserer Seite, ist es ein Cross-Site-Aufruf -> ablehnen
  // (verhindert, dass eine fremde Seite fremde KI-Kontingente verbraucht). Die
  // Entscheidung trifft lib/same-origin.ts — eine Stelle für alle Schreib-Endpunkte.
  const foreign = foreignOrigin(req);
  if (foreign) {
    // Hier wiegt der Riegel schwerer als bei der Reichweitenmessung: Wer von aussen auf
    // diesen Endpunkt schreibt, verbraucht unser Claude-Kontingent, also echtes Geld.
    await logOps("suspicious_request", {
      message: `KI-Anfrage von fremder Herkunft (${foreign}) abgewiesen.`,
      path: "/api/ai/chat",
      subject: subjectFromRequest(req),
      group: "origin:ai",
    });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
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
  // Titel-Lookups in ALLEN 13 Sprachen. Unbekannte Werte -> Deutsch.
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

  // Burst-Limit, Tageslimit, IP-Backstop: ausgelagert in lib/ai-chat-core.ts (App teilt es).
  const admission = await admitAiRequest({
    subject,
    limit,
    isPro,
    scope,
    ipSubject,
    path: "/api/ai/chat",
  });
  if (!admission.ok) {
    const res = NextResponse.json(admission.body, { status: admission.status });
    if (setGuestCookie) attachGuestCookie(res, setGuestCookie);
    return res;
  }
  const remaining = admission.remaining;

  // Leise Personalisierung: die Kategorien der bereits gemerkten Spots (eigene
  // Daten, RLS-gefiltert) als Interessen-Hinweis. Best effort, nie blockierend.
  const interests: string | null = user ? await loadInterests(supabase) : null;

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

  // aiGenerated + Header: maschinenlesbare Kennzeichnung der KI-Ausgabe
  // (Art. 50 Abs. 2 KI-VO). Ein Text-Wasserzeichen ist bei kurzen Chat-Antworten
  // nicht robust machbar; deshalb Metadaten auf JEDER Auslieferungsschicht
  // (JSON-Feld hier, data-ai-generated im DOM in AiMessage.tsx). Begründung
  // und Einstufung: docs/39_RECHT_KI-Transparenz.md.
  const res = NextResponse.json({
    text: result.text,
    cards: result.cards,
    conversationId,
    remaining,
    aiGenerated: true,
  });
  res.headers.set("X-AI-Generated", "true");
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
