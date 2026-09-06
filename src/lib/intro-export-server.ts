import "server-only";
import { createServiceClient } from "./supabase/service";
import { logOps } from "./ops";
import { LEGAL } from "./legal";
import {
  EXPORT_BUCKET,
  EXPORT_DIR,
  EXPORT_TTL_DAYS,
  introExportExpiry,
  introExportFileName,
} from "./intro-export";

// Die Serverseite der Clean-Exporte: Link ausstellen und wieder aufräumen.
//
// Getrennt von lib/intro-export.ts, weil das Render-Skript jene Datei importiert und hier
// der Service-Client hängt (der trägt `server-only` und würde das Skript kippen).

/**
 * Wohin die Export-Mails gehen.
 *
 * Dieselbe Adresse wie die Betriebs-Alarme: Es ist dieselbe Person, die sie liest, und eine
 * zweite Umgebungsvariable für dieselbe Antwort wäre eine zweite Stelle, an der man sie
 * vergessen kann.
 */
export function introExportRecipient(): string {
  return process.env.OPS_ALERT_EMAIL?.trim() || LEGAL.email;
}

/**
 * Der deutsche Titel des Spots, für Betreff und Überschrift der Mail.
 *
 * Über den Service-Client, nicht über getIntroRenderItem(): Der Aufrufer ist eine Maschine
 * ohne Sitzung, und die Spot-Zeile kann ein Entwurf sein. Mit dem Betrachter-Client käme
 * dort nichts zurück, und die Mail hiesse „gaisberg" statt „Gaisberg".
 */
export async function introExportTitle(slug: string): Promise<string | null> {
  try {
    const { data } = await createServiceClient()
      .from("spots")
      .select("spot_translations(title, lang)")
      .eq("slug", slug)
      .maybeSingle();
    const tr = (data?.spot_translations ?? []) as { title: string | null; lang: string }[];
    return tr.find((t) => t.lang === "de")?.title ?? null;
  } catch {
    // Der Titel ist Komfort. Fehlt er, steht der Slug in der Mail, und die Mail geht raus.
    return null;
  }
}

/**
 * Einen zeitlich begrenzten Download-Link für eine hochgeladene Clean-Fassung ausstellen.
 *
 * `download` ist kein Beiwerk: Ohne den Parameter liefert Supabase die Datei mit
 * `Content-Disposition: inline` aus, Safari zeigt dann einen Player statt zu speichern, und
 * das Video liegt am Ende nirgends. Mit ihm landet es in „Downloads“.
 */
export async function createIntroExportLink(
  path: string,
  slug: string,
): Promise<{ url: string; expiresAt: Date } | null> {
  const expiresAt = introExportExpiry();
  const { data, error } = await createServiceClient()
    .storage.from(EXPORT_BUCKET)
    .createSignedUrl(path, EXPORT_TTL_DAYS * 24 * 60 * 60, {
      download: introExportFileName(slug),
    });
  if (error || !data?.signedUrl) return null;
  return { url: data.signedUrl, expiresAt };
}

/**
 * Abgelaufene Exporte löschen. Läuft im täglichen Aufräum-Cron.
 *
 * WARUM NICHT IN lib/data-retention.ts, wo das andere Aufräumen steht: Dort geht es um
 * Fristen aus der Datenschutzerklärung, und ein Fehlschlag dort ist aus RECHTLICHEN Gründen
 * als „kritisch" eingestuft. Ein liegengebliebenes Video ohne Personenbezug ist das nicht,
 * es kostet ein paar Megabyte. Die zwei Dinge in eine Liste zu werfen hiesse, entweder den
 * Video-Fehlschlag zu dramatisieren oder den Rechts-Fehlschlag zu verharmlosen.
 *
 * Gelöscht wird nach `created_at`: Jeder Export bekommt einen eigenen Dateinamen mit
 * Zeitstempel (introExportPath), es wird also nie eine bestehende Datei überschrieben.
 */
export async function pruneExpiredExports(): Promise<{ deleted: number; ok: boolean }> {
  try {
    const storage = createServiceClient().storage.from(EXPORT_BUCKET);
    const { data, error } = await storage.list(EXPORT_DIR, { limit: 1000 });
    if (error) {
      // Fehlt der Bucket (Migration 0067 nicht angewendet), soll das auffallen, aber den
      // ganzen Aufräum-Lauf nicht kippen: Der Rest davon hält Rechtsfristen ein.
      await logOps("intro_export_failed", {
        message: `Export-Ordner konnte nicht gelesen werden: ${error.message}`,
        group: "intro-export-prune",
      });
      return { deleted: 0, ok: false };
    }

    const cutoff = Date.now() - EXPORT_TTL_DAYS * 24 * 60 * 60 * 1000;
    const stale = (data ?? [])
      .filter((f) => f.name.endsWith(".mp4"))
      .filter((f) => {
        const when = f.created_at ?? f.updated_at;
        // Ohne Datum lieber liegen lassen: Der nächste Lauf sieht es wieder, und eine
        // Datei zu behalten ist der billigere Fehler als eine zu früh gelöschte.
        return when ? new Date(when).getTime() < cutoff : false;
      })
      .map((f) => `${EXPORT_DIR}/${f.name}`);

    if (stale.length === 0) return { deleted: 0, ok: true };

    const { error: rmErr } = await storage.remove(stale);
    if (rmErr) {
      await logOps("intro_export_failed", {
        message: `Alte Exporte konnten nicht gelöscht werden: ${rmErr.message}`,
        group: "intro-export-prune",
      });
      return { deleted: 0, ok: false };
    }
    return { deleted: stale.length, ok: true };
  } catch (e) {
    await logOps("intro_export_failed", {
      message: "Das Aufräumen der Clean-Exporte ist fehlgeschlagen.",
      error: e,
      group: "intro-export-prune",
    });
    return { deleted: 0, ok: false };
  }
}
