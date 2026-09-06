import { sendEmail } from "@/lib/email";
import { logOps, subjectFromRequest } from "@/lib/ops";
import { secretMatches, bearerToken } from "@/lib/secret-compare";
import { isIntroExportPath } from "@/lib/intro-export";
import {
  createIntroExportLink,
  introExportRecipient,
  introExportTitle,
} from "@/lib/intro-export-server";
import { renderIntroExportReady, renderIntroExportFailed } from "@/lib/intro-export-mail";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Der Rückkanal des Export-Workflows: „fertig" oder „gescheitert", und dann die Mail.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// WARUM DIE MAIL VON HIER KOMMT UND NICHT VOM RUNNER SELBST:
// Der Runner könnte Resend direkt anrufen, drei Zeilen curl. Dann läge aber der Mail-Text an
// einer zweiten Stelle, in einer YAML-Datei, ohne Vorschau, ohne den gemeinsamen Rahmen und
// mit einem weiteren Secret im Repo. Die App weiss ohnehin, wie man Mails schickt; der
// Runner soll nur sagen, dass er fertig ist.
//
// WARUM RENDER_SECRET UND KEIN EIGENES:
// Wer dieses Geheimnis hat, kann heute schon die geschützte Render-Route abrufen und damit
// jedes Intro rendern. Ein zweites Geheimnis für denselben Vertrauensbereich wäre eine
// weitere Zeile, die man bei einem Wechsel vergessen kann, ohne dass jemand etwas gewinnt.
//
// WAS EIN ANGREIFER MIT DEM SECRET HIER KANN: eine Mail an UNSERE eigene Adresse auslösen,
// mit einem Link auf eine Datei, die im Export-Ordner liegt. Nicht mehr, weil der Pfad
// geprüft wird (isIntroExportPath) und der Empfänger fest aus der Konfiguration kommt und
// nicht aus dem Aufruf.
export const dynamic = "force-dynamic";

type Body = {
  slug?: unknown;
  ok?: unknown;
  path?: unknown;
  bytes?: unknown;
  runUrl?: unknown;
  reason?: unknown;
};

/** Nur unsere eigene Actions-Adresse als Protokoll-Link, damit die Mail nirgendwo sonst hinführt. */
function safeRunUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname === "github.com" ? u.toString() : null;
  } catch {
    return null;
  }
}

function slugOf(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9-]{1,120}$/.test(value) ? value : null;
}

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.RENDER_SECRET?.trim();
  if (!secret) {
    // Fail-closed wie beim Cron: Ohne Geheimnis kommt niemand durch. Und es ist gemeldet,
    // sonst tarnt sich der Konfigurationsfehler als „die Mail kommt eben nicht".
    await logOps("config_missing", {
      message: "RENDER_SECRET ist nicht gesetzt. Der Export-Rückkanal ist damit tot.",
      group: "env:RENDER_SECRET",
      path: "/api/intro-export/ready",
    });
    return new Response("Unauthorized", { status: 401 });
  }

  if (!secretMatches(bearerToken(req), secret)) {
    await logOps("intro_export_unauthorized", {
      message: "Aufruf des Export-Rückkanals ohne gültiges Secret.",
      path: "/api/intro-export/ready",
      subject: subjectFromRequest(req),
      detail: { mitAuthKopf: !!req.headers.get("authorization") },
    });
    return new Response("Unauthorized", { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ ok: false, error: "Kein gültiges JSON." }, { status: 400 });
  }

  const slug = slugOf(body.slug);
  if (!slug) return Response.json({ ok: false, error: "slug fehlt." }, { status: 400 });

  const title = await introExportTitle(slug);
  const runUrl = safeRunUrl(body.runUrl);

  // ── Der Fehlerfall. Er steht zuerst, weil er der wichtigere ist: Ein Export, der ohne
  // Nachricht scheitert, ist dieselbe Stille, die beim Intro-Rendern dreimal Stunden
  // gekostet hat. Nur wird sie hier erst nach Tagen bemerkt.
  if (body.ok === false) {
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;
    const mail = renderIntroExportFailed({ slug, title, runUrl, reason, at: new Date() });
    await sendEmail({
      to: introExportRecipient(),
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    await logOps("intro_export_failed", {
      message: `Clean-Export von „${slug}" ist gescheitert.`,
      group: `intro-export:${slug}`,
      detail: { grund: reason ?? "unbekannt" },
    });
    return new Response(null, { status: 204 });
  }

  // ── Der Erfolgsfall.
  const path = typeof body.path === "string" ? body.path : "";
  if (!isIntroExportPath(path)) {
    return Response.json({ ok: false, error: "Pfad liegt nicht im Export-Ordner." }, { status: 400 });
  }
  const bytes = typeof body.bytes === "number" && body.bytes > 0 ? body.bytes : 0;

  const link = await createIntroExportLink(path, slug);
  if (!link) {
    // Die Datei liegt im Bucket, nur der Link scheitert. Nicht schweigen: Sonst wartet man
    // auf eine Mail, während das Video längst da ist.
    const mail = renderIntroExportFailed({
      slug,
      title,
      runUrl,
      reason: "Das Video ist fertig, aber der Download-Link liess sich nicht ausstellen.",
      at: new Date(),
    });
    await sendEmail({
      to: introExportRecipient(),
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    await logOps("intro_export_failed", {
      message: `Signed-URL für „${path}" konnte nicht erzeugt werden.`,
      group: `intro-export:${slug}`,
    });
    return Response.json({ ok: false, error: "Link konnte nicht erzeugt werden." }, { status: 500 });
  }

  const mail = renderIntroExportReady({
    slug,
    title,
    downloadUrl: link.url,
    expiresAt: link.expiresAt,
    bytes,
  });
  const sent = await sendEmail({
    to: introExportRecipient(),
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });

  // Antwort mit `sent`, nicht stumm 204: Der Workflow-Schritt wird rot, wenn die Mail nicht
  // rausging. Sonst stünde der Lauf auf grün und niemand hätte je davon erfahren.
  return Response.json({ ok: sent, expiresAt: link.expiresAt.toISOString() }, {
    status: sent ? 200 : 500,
  });
}
