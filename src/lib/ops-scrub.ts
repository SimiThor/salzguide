// ═══════════════════════════════════════════════════════════════════════════════════════
//  Der Schwärzer. Nichts Geheimes und nichts Persönliches kommt ins Logbuch.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// WARUM DAS EIN EIGENES MODUL IST UND NICHT EINE ZEILE IN lib/ops.ts:
// Ein Fehler-Log ist die Stelle, an der Geheimnisse aus Versehen landen. Nicht, weil jemand
// leichtsinnig ist, sondern weil Fehlermeldungen von aussen kommen: Supabase schickt die
// verunglückte Anfrage mit, Resend antwortet mit dem Kopf der Anfrage, ein `JSON.stringify(e)`
// zieht ein ganzes Antwortobjekt mit `apikey=eyJ…` herein. Genau davor warnt das eigene Audit
// (docs/34 §D: „Log-Hygiene: keine PII/Secrets in Logs").
//
// Der zweite Grund: Diese Datei enthält NUR reine Funktionen. Sie lässt sich Zeile für Zeile
// lesen und gegen eine Liste von Angriffs-Eingaben halten, ohne dass eine Datenbank oder ein
// Netzwerk im Spiel ist. Bei einer Sicherheitsfunktion ist das die halbe Miete.
//
// ───────────────────────────────────────────────────────────────────────────────────────
//  DIE ABWÄGUNG: zu viel schwärzen ist auch ein Fehler
// ───────────────────────────────────────────────────────────────────────────────────────
//
// Ein Log, in dem alles `<geschwärzt>` heisst, ist wertlos — dann kann man es auch weglassen.
// Deshalb wird hier nicht pauschal alles Lange oder alles Zufällige entfernt, sondern gezielt
// das, was tatsächlich ein Geheimnis oder ein Personenbezug IST. Ein Statuscode, ein
// Tabellenname, ein Pfad, eine Fehlernummer bleiben stehen. Sonst stünde man vor einem Alarm,
// der sagt „irgendetwas ist irgendwo kaputt".

/** Was an die Stelle eines Fundes tritt. Sichtbar, damit man sieht, DASS geschwärzt wurde. */
const MARK = {
  mail: "<mail>",
  token: "<token>",
  key: "<key>",
  ip: "<ip>",
  secret: "<geheim>",
} as const;

// Die Muster, in dieser Reihenfolge angewandt. Reihenfolge ist wichtig: Der JWT-Ersatz muss
// VOR dem allgemeinen Parameter-Ersatz laufen, sonst bliebe der Wert in `apikey=eyJ…` zwar
// als Parameter markiert, der rohe Token daneben in einem anderen Satzteil aber stehen.
const PATTERNS: readonly [RegExp, string][] = [
  // ── 1. JWT (Supabase-Keys, Auth-Tokens, Anthropic-Antworten) ──────────────────────
  // Drei base64url-Blöcke mit Punkten. Der Anon-Key steht offen im Browser, der
  // Service-Role-Key darf NIRGENDWO auftauchen — hier wird nicht unterschieden.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?/g, MARK.token],

  // ── 2. Bekannte Schlüssel-Präfixe ─────────────────────────────────────────────────
  // Stripe (sk_/rk_/whsec_), Resend (re_), Anthropic (sk-ant-), Mapbox (sk.), Supabase
  // (sbp_/sb_secret_). Öffentliche Präfixe (pk_, pk.) stehen bewusst NICHT dabei: die
  // sind per Definition öffentlich, und ihr Auftauchen im Log hilft beim Suchen.
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, MARK.key],
  [/\bwhsec_[A-Za-z0-9]{8,}/g, MARK.key],
  [/\bre_[A-Za-z0-9_-]{16,}/g, MARK.key],
  [/\bsk-ant-[A-Za-z0-9_-]{16,}/g, MARK.key],
  [/\bsb(?:p_|_secret_)[A-Za-z0-9_-]{16,}/g, MARK.key],
  [/\bsk\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]+/g, MARK.key], // Mapbox-Secret-Token

  // ── 3. Autorisierungs-Köpfe ───────────────────────────────────────────────────────
  //
  // DIE REIHENFOLGE DIESER ZWEI ZEILEN IST DER GANZE WITZ, und andersherum war sie ein Leck.
  // Stand der Kopf-Ersatz zuerst, fraß sein `\S+` nur das Wort „Bearer" — der Token DAHINTER
  // blieb wörtlich stehen, weil ein Leerzeichen davor war:
  //
  //     "Authorization: Bearer abc123def456"  ->  "authorization: <geheim> abc123def456"
  //
  // Das ist die tückischste Sorte Fehler in einem Schwärzer: Es SIEHT geschwärzt aus. Beim
  // Testen gegen echte Fehlertexte ist es aufgefallen, nicht beim Lesen.
  //
  // Jetzt greift erst das Schema (nimmt den Token mit), dann der Kopf (nimmt den Rest).
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${MARK.token}`],
  // Basic-Auth ist base64 von „nutzer:passwort" — also ein Klartext-Passwort in Verkleidung.
  [/\bBasic\s+[A-Za-z0-9+/=]{8,}/gi, `Basic ${MARK.token}`],
  [/\b(authorization|apikey|api-key|x-api-key)\s*[:=]\s*\S+/gi, `$1: ${MARK.secret}`],
  // Auth-Cookies. Ein `sb-…-auth-token` IST die Sitzung: Wer ihn aus einem Log fischt, ist
  // eingeloggt. Kommt in Fehlern rund um `set-cookie` und in mitgeloggten Kopfzeilen vor.
  [/\bsb-[A-Za-z0-9_-]+-auth-token(?:\.\d+)?=[^;\s"']+/gi, `sb-auth-token=${MARK.secret}`],

  // ── 4. Verräterische Parameter in Adressen ────────────────────────────────────────
  // `token_hash` ist der Anmeldelink selbst: Wer den aus einem Log fischt, ist eingeloggt.
  // `code` ebenso (PKCE-Rücksprung). Der Wert darf hier nie stehen, der Name schon — er
  // sagt einem, an welcher Stelle des Ablaufs es geknallt hat.
  [
    /\b(token_hash|access_token|refresh_token|id_token|code|secret|password|passwd|pwd|signature|sig|session_id|client_secret)=[^&\s"']+/gi,
    `$1=${MARK.secret}`,
  ],

  // ── 5. E-Mail-Adressen ────────────────────────────────────────────────────────────
  // Der häufigste Personenbezug in Fehlermeldungen („user with email x@y.at not found").
  // lib/email.ts hält sich schon von Hand daran; hier wird es zur Regel statt zur Disziplin.
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, MARK.mail],

  // ── 6. IP-Adressen ────────────────────────────────────────────────────────────────
  // Die Datenschutzerklärung sagt zu, dass die IP nur transient verarbeitet wird. Ein Log,
  // das sie 90 Tage aufbewahrt, wäre genau das Gegenteil. Wo wir einen Absender
  // unterscheiden müssen, steht ein Hash (siehe opsSubject in lib/ops.ts).
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, MARK.ip],
  // IPv6 nur in der ausgeschriebenen Form: Kurzformen (`::1`) sind zu nah an gewöhnlichem
  // Text (Zeitangaben, Doppelpunkt-Listen), und ein Schwärzer, der Sätze zerlegt, macht
  // das Log unlesbar.
  [/\b(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}\b/g, MARK.ip],
];

/**
 * Einen Text fürs Logbuch säubern und kürzen.
 *
 * `max` schneidet hart ab: Ein Stacktrace aus einer Bibliothek kann Tausende Zeichen haben,
 * und die letzten davon erklären nie etwas. Lange Texte sind ausserdem der Grund, warum eine
 * einzige Fehlerwelle eine Datenbank füllen kann.
 */
export function scrubText(input: unknown, max = 500): string {
  let s = typeof input === "string" ? input : String(input ?? "");
  for (const [re, replacement] of PATTERNS) s = s.replace(re, replacement);
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Eine Adresse fürs Logbuch: nur Pfad, nie der Query-String.
 *
 * Im Query-String stehen die Anmelde-Tokens (`?token_hash=…`, `?code=…`). Ihn zu schwärzen
 * wäre die zweitbeste Lösung; ihn gar nicht erst aufzunehmen ist die richtige. Was der Pfad
 * nicht verrät, verrät auch der Rest selten.
 */
export function scrubPath(input: string | null | undefined, max = 200): string | null {
  if (!input) return null;
  const raw = String(input);
  // Absolute Adressen auf den Pfad zurückschneiden, relative unverändert lassen.
  let path = raw;
  try {
    if (/^https?:\/\//i.test(raw)) path = new URL(raw).pathname;
  } catch {
    /* kaputte Adresse: dann eben roh, der Schwärzer unten fängt den Rest */
  }
  path = path.split("?")[0].split("#")[0];
  return scrubText(path, max) || null;
}

/**
 * Die Zusatzangaben säubern. Flach, mit begrenzt vielen Schlüsseln.
 *
 * KEIN rekursives Durchlaufen beliebig tiefer Objekte: Das wäre der bequeme Weg und der
 * gefährliche. Ein tiefes Objekt kann eine ganze HTTP-Antwort samt Kopfzeilen sein, ein
 * zyklisches sprengt die Rekursion, und ein sehr breites bläht jede Zeile auf. Verschachteltes
 * wird deshalb zu Text gemacht, gekürzt und geschwärzt — man sieht, was drinsteht, aber es
 * kommt nichts unkontrolliert durch.
 */
export function scrubDetail(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (n >= 20) break;
    // Der Schlüssel selbst kann schon verräterisch sein; sein Wert ist es dann sicher.
    if (/secret|token|key|password|passwd|cookie|authorization|email|mail|ip\b/i.test(key)) {
      out[key] = MARK.secret;
      n++;
      continue;
    }
    if (value === null || typeof value === "boolean" || typeof value === "number") {
      out[key] = value;
    } else if (typeof value === "string") {
      out[key] = scrubText(value, 300);
    } else {
      out[key] = scrubText(safeStringify(value), 300);
    }
    n++;
  }
  return Object.keys(out).length ? out : null;
}

/** `JSON.stringify`, das an einem Zyklus nicht stirbt. */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === "object" && v !== null) {
        if (seen.has(v as object)) return "<zyklisch>";
        seen.add(v as object);
      }
      return v;
    }) ?? "";
  } catch {
    return String(value);
  }
}

/**
 * Aus einem gefangenen `unknown` eine brauchbare Meldung machen.
 *
 * `catch (e)` liefert in TypeScript `unknown`, und in der Praxis ist es alles Mögliche: ein
 * Error, ein Supabase-Fehlerobjekt (`{ message, code, details, hint }`), ein String, einmal
 * sogar ein Response. Ohne diese Stelle stünde im Log bei der Hälfte aller Fehler
 * „[object Object]" — und damit nichts.
 */
export function errorMessage(e: unknown): string {
  if (!e) return "Unbekannter Fehler";
  if (typeof e === "string") return scrubText(e);
  if (e instanceof Error) return scrubText(e.message || e.name);
  if (typeof e === "object") {
    const o = e as Record<string, unknown>;
    // Supabase/PostgREST: message ist der Satz, code die Fehlernummer (z. B. "23505").
    const parts = [o.message, o.error_description, o.error, o.details, o.hint]
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0);
    if (parts.length) {
      const code = typeof o.code === "string" || typeof o.code === "number" ? ` [${o.code}]` : "";
      return scrubText(parts[0] + code);
    }
    return scrubText(safeStringify(e));
  }
  return scrubText(String(e));
}

/**
 * Der Stacktrace, auf das Nützliche eingedampft.
 *
 * Die ersten Zeilen zeigen, wo es geknallt hat; danach kommen nur noch Next.js und Node.
 * Ausserdem fliegen absolute Pfade raus (`/var/task/…`, `/Users/…`): Die sagen nichts über
 * den Fehler und verraten die Verzeichnisstruktur des Servers.
 */
export function scrubStack(e: unknown, lines = 4): string | null {
  const stack = e instanceof Error ? e.stack : null;
  if (!stack) return null;
  const useful = stack
    .split("\n")
    .slice(1, 1 + lines)
    .map((l) => l.trim().replace(/\(?(?:file:\/\/)?\/(?:var\/task|Users|home|app)\/[^\s)]*\//g, "("))
    .join(" | ");
  return scrubText(useful, 400) || null;
}
