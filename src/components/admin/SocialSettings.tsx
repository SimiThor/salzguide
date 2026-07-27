"use client";

import { useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { addSocialPost, deleteSocialPost, moveSocialPost } from "@/lib/social-actions";
import { compressImage, uploadImage } from "@/lib/image-upload";
import {
  socialProfile,
  type SocialPost,
  SOCIAL_FEED_SIZE,
  SOCIAL_TILE_ASPECT,
} from "@/lib/social";
import { BTN_PRIMARY_SM, BTN_SECONDARY_SM, STATUS_NEUTRAL } from "@/lib/ui";
import Busy from "@/components/Busy";

// Die Instagram-Kacheln der Startseite pflegen. Bewusst OHNE Meta-Anbindung: kein Konto beim
// Entwicklerportal, keine App, kein Token, der abläuft. Zwei Handgriffe pro Beitrag.
//
// WARUM ES SO WENIG FELDER SIND, und das ist die eigentliche Arbeit an diesem Bauteil:
//   - Reel oder Foto? Steht im Link (/reel/ gegen /p/), wird abgeleitet.
//   - Bildmasse? Kommen aus dem Bild.
//   - Reihenfolge? Neue Kachel kommt vorn hin, weil man sie hinzufügt, wenn man gerade
//     gepostet hat. Verschieben notfalls mit zwei Pfeilen.
//   - Bildbeschreibung? Optional, eine Zeile, für Screenreader.
// Bleiben: Bild wählen und Link einfügen. Alles, was das Formular nicht fragt, kann auch
// nicht falsch beantwortet werden.
//
// Das Bild wird IM BROWSER verkleinert (compressImage) und erst dann hochgeladen, wie überall
// sonst im Admin: Ein 12-MB-Foto vom iPhone würde sonst durch die Server-Action wandern.
//
// ── DIE FORM DES BLOCKS ────────────────────────────────────────────────────────────────
// Er trägt dieselben Masse wie seine Nachbarn in den Einstellungen (LocalManager, Toni):
// Karte rounded-[16px] p-5, Formular-Feld darin rounded-[14px] p-4, Knöpfe aus lib/ui.
// Zwei Sachen waren hier vorher aus der Reihe:
//
//   1. Das nackte <input type="file">. Es ist das einzige Bedienelement, das der Browser
//      selbst zeichnet — auf Safari eine graue Systemtaste mit „Datei auswählen", die in
//      der 84px schmalen Spalte schlicht abgeschnitten war. Jetzt wie bei Toni: der echte
//      Knopf, das Feld liegt versteckt dahinter.
//   2. Ein Umbruch, der Löcher riss. Vorschau-Spalte und Felder standen in einem
//      flex-wrap; am Handy sprang die Spalte in eine eigene Zeile und liess rechts daneben
//      200px Weiss stehen. Jetzt EIN Layout mit einem Schalter: am Handy Vorschau und Knopf
//      NEBENeinander (eine flache Zeile über den Feldern), ab sm untereinander in einer
//      Spalte links. Kein zweites Markup, nur die Flex-Richtung dreht sich.

const inputCls =
  "w-full rounded-[10px] bg-white px-3 py-2 text-[14px] text-ink ring-1 ring-black/[0.08] outline-none focus:ring-2 focus:ring-accent/40";

/** Die drei runden Knöpfe rechts in jeder Zeile. Gezeichnet 32px, angefasst 44px (sg-hit). */
const ICON_BTN =
  "sg-hit grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-black/5 text-[13px] font-bold leading-none text-ink transition active:scale-90 disabled:cursor-not-allowed disabled:opacity-30";

/** Lange Kante der Kopie. Die Kacheln sind maximal ~540px breit, 1080 deckt Retina ab. */
const MAX_DIM = 1080;

function errorText(code?: string): string {
  switch (code) {
    case "bad_link":
      return "Das ist kein Instagram-Link. Er muss mit https://www.instagram.com/ beginnen.";
    case "bad_image":
      return "Das Bild wurde nicht richtig hochgeladen. Bitte nochmal auswählen.";
    case "bad_size":
      return "Die Bildmasse konnten nicht gelesen werden.";
    case "auth":
    case "forbidden":
      return "Nicht angemeldet oder keine Rechte. Bitte Seite neu laden.";
    default:
      return "Speichern hat nicht geklappt. Bitte nochmal versuchen.";
  }
}

export default function SocialSettings({ posts }: { posts: SocialPost[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const ig = socialProfile("instagram");

  const [link, setLink] = useState("");
  const [alt, setAlt] = useState("");
  const [image, setImage] = useState<{ url: string; width: number; height: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Zwei-Stufen-Löschen wie im LocalManager: Ein Klick zeigt die Rückfrage, der zweite
  // löscht. Kein eigener Dialog, weil der Admin dieses Muster schon überall hat.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setLink("");
    setAlt("");
    setImage(null);
    setErr(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setUploading(true);
    // try/finally: Wirft der Upload, bliebe die Anzeige sonst für immer auf „lädt".
    try {
      const { blob, width, height } = await compressImage(file, MAX_DIM);
      const url = await uploadImage(blob, "social");
      setImage({ url, width, height });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Bild-Upload hat nicht geklappt.");
    } finally {
      setUploading(false);
      // Zurücksetzen, sonst löst dieselbe Datei nach einem Fehlversuch kein change mehr aus.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onAdd() {
    setErr(null);
    // Der Knopf bleibt anfassbar, auch wenn noch etwas fehlt — wie im LocalForm nebenan.
    // Ein ausgegrauter Knopf sagt nur „geht nicht", diese zwei Sätze sagen warum.
    if (!image) return setErr("Bitte zuerst ein Bild auswählen.");
    if (!link.trim()) return setErr("Bitte den Link zum Beitrag einfügen.");
    setSaving(true);
    try {
      const r = await addSocialPost({
        permalink: link,
        imageUrl: image.url,
        width: image.width,
        height: image.height,
        alt,
      });
      if (r.ok) {
        reset();
        router.refresh();
      } else {
        setErr(errorText(r.error));
      }
    } catch {
      setErr("Gerade nicht erreichbar. Bitte nochmal versuchen.");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    if (busyId) return; // Doppelklick -> zweiter Aufruf ins Leere
    setErr(null);
    setBusyId(id);
    try {
      const r = await deleteSocialPost(id);
      setConfirmDelete(null);
      if (r.ok) router.refresh();
      else setErr(errorText(r.error));
    } catch {
      setErr("Gerade nicht erreichbar. Bitte nochmal versuchen.");
    } finally {
      setBusyId(null);
    }
  }

  async function onMove(id: string, dir: "up" | "down") {
    if (busyId) return;
    setErr(null);
    setBusyId(id);
    try {
      const r = await moveSocialPost(id, dir);
      if (r.ok) router.refresh();
      else setErr(errorText(r.error));
    } finally {
      setBusyId(null);
    }
  }

  const visible = Math.min(posts.length, SOCIAL_FEED_SIZE);

  return (
    <div className="rounded-[16px] bg-white p-5 shadow-sm ring-1 ring-black/[0.04]">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold text-ink">Instagram-Kacheln</h2>
        {/* Die Zahl als Status-Kennzeichnung (lib/ui: Rand heisst Zustand), nicht als
            grauer Fliesstext, der vorher rechts oben in der Luft hing. Ohne Kacheln keine
            Kennzeichnung: „0 von 0" ist keine Auskunft, das sagt der leere Zustand unten. */}
        {posts.length > 0 && (
          <span className={STATUS_NEUTRAL}>
            {visible} von {posts.length} sichtbar
          </span>
        )}
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Erscheinen auf der Startseite und unter „Über uns“, mit dem Knopf zu @{ig.handle}.
        Gezeigt werden die ersten {SOCIAL_FEED_SIZE}. Ohne Kacheln blendet sich die ganze
        Section aus.
      </p>

      {/* ── Neue Kachel ─────────────────────────────────────────────────────────────── */}
      <div className="mt-4 rounded-[14px] bg-black/[0.02] p-4 ring-1 ring-black/[0.05]">
        <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
          {/* Bild. Am Handy eine Zeile (Vorschau + Knopf), ab sm eine Spalte links neben den
              Feldern — siehe Kopf der Datei. Die 128px sind gemessen, nicht geschätzt:
              „Bild ersetzen" braucht mit dem Padding von BTN_SECONDARY_SM 120px. Bei 108
              brach die Beschriftung um und der Knopf war doppelt so hoch wie überall sonst. */}
          <div className="flex items-center gap-3 sm:w-[128px] sm:shrink-0 sm:flex-col sm:items-stretch sm:gap-2">
            {/* Vorschau im Rahmen der echten Kachel (SOCIAL_TILE_ASPECT), damit man VOR dem
                Speichern sieht, wie der Zuschnitt wirkt. Der Rahmen ist für jede Bildgrösse
                derselbe: quer, quadratisch und hoch werden mittig gefüllt (object-cover). */}
            <div
              className={`${SOCIAL_TILE_ASPECT} w-[76px] shrink-0 overflow-hidden rounded-[10px] bg-black/[0.05] ring-1 ring-inset ring-black/[0.06] sm:w-full`}
            >
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[11px] text-muted">
                  Vorschau
                </span>
              )}
            </div>
            {/* Der echte Knopf, das Datei-Feld versteckt dahinter (wie ToniAvatarSettings).
                Ein <button> und kein <label>, damit er auch per Tastatur erreichbar ist. */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || saving}
              className={BTN_SECONDARY_SM}
            >
              {uploading ? <Busy>Lädt</Busy> : image ? "Bild ersetzen" : "Bild wählen"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onFile}
            />
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <label className="block">
              <span className="text-[12px] font-medium text-muted">Link zum Beitrag</span>
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://www.instagram.com/p/..."
                inputMode="url"
                className={`mt-1.5 ${inputCls}`}
              />
              {/* Die Anleitung steht dort, wo man sie braucht: unter dem Feld, das sie
                  füllt. In der Beschreibung oben war sie der dritte Satz eines Absatzes,
                  den man nach dem ersten Mal nicht mehr liest. */}
              <span className="mt-1.5 block text-[11px] text-muted">
                In der Instagram-App beim Beitrag auf ⋯ → „Link kopieren“.
              </span>
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-muted">
                Bildbeschreibung (optional, für Screenreader)
              </span>
              <input
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
                placeholder="z. B. Sonnenaufgang am Gipfelkreuz"
                className={`mt-1.5 ${inputCls}`}
              />
            </label>

            {/* Die Aktionen stehen IN der Feld-Spalte, nicht als eigene Zeile unter beiden
                Spalten: So enden linke und rechte Spalte fast auf derselben Höhe. Als
                eigene Zeile klaffte unter den Feldern ein Loch, weil die Bild-Spalte
                daneben höher ist als sie. Rechtsbündig wie im LocalForm nebenan. */}
            <div className="flex items-center justify-end gap-2 pt-1">
              {(image || link || alt) && (
                <button
                  type="button"
                  onClick={reset}
                  disabled={saving}
                  className="cursor-pointer rounded-full px-3 py-2 text-[13px] font-medium text-muted transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Zurücksetzen
                </button>
              )}
              <button
                type="button"
                onClick={onAdd}
                disabled={saving || uploading}
                className={BTN_PRIMARY_SM}
              >
                {saving ? <Busy>Speichert</Busy> : "Kachel hinzufügen"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {err && <p className="mt-3 text-[13px] font-medium text-accent">{err}</p>}

      {/* ── Bestehende Kacheln ──────────────────────────────────────────────────────── */}
      {posts.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted">Noch keine Kacheln.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {posts.map((p, i) => {
            // Ab der siebten Kachel: angelegt, aber nicht auf der Seite. Ohne diesen Hinweis
            // pflegt man Kacheln, die niemand sieht. Vorher trug die Zeile dafür einen
            // gelben Grund plus „· wird nicht gezeigt" im Titel — der gelbe Ton war am PC
            // kaum zu sehen und der Zusatz wurde am Handy als Erstes abgeschnitten. Jetzt
            // sagen es zwei Dinge, die nicht abschneiden können: die blasse Vorschau und
            // die Kennzeichnung in derselben Zeile.
            const hidden = i >= SOCIAL_FEED_SIZE;
            const confirming = confirmDelete === p.id;
            return (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-[12px] bg-black/[0.02] p-2 ring-1 ring-black/[0.04]"
              >
                <div
                  className={`${SOCIAL_TILE_ASPECT} w-11 shrink-0 overflow-hidden rounded-[8px] bg-black/[0.05] ${
                    hidden ? "opacity-40" : ""
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.imageUrl}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>

                {confirming ? (
                  // Die Rückfrage ersetzt die ganze Zeile, statt sich zwischen die Knöpfe zu
                  // drängen: Sonst schrumpft der Text neben drei Knöpfen auf zwei Wörter.
                  // Die Vorschau bleibt stehen und hält die Zeilenhöhe, es springt nichts.
                  <>
                    {/* Am Handy ohne Frage: Neben „Abbrechen" und „Löschen" blieben für sie
                        80px, sie stand als „Kach…" da. Welche Kachel gemeint ist, sagt die
                        Vorschau links daneben ohnehin — und der rote Knopf sagt, was
                        passiert. Ab sm ist Platz, dort steht die Frage. */}
                    <p className="hidden min-w-0 flex-1 truncate text-[13px] font-medium text-ink sm:block">
                      Kachel {i + 1} löschen?
                    </p>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      disabled={busyId !== null}
                      className="ml-auto cursor-pointer rounded-full px-3 py-2 text-[13px] font-medium text-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Abbrechen
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(p.id)}
                      disabled={busyId !== null}
                      className={BTN_PRIMARY_SM}
                    >
                      {busyId === p.id ? <Busy>Löscht</Busy> : "Löschen"}
                    </button>
                  </>
                ) : (
                  <>
                    {/* Genau zwei Zeilen, bei JEDER Kachel — mit und ohne Bildbeschreibung.
                        Vorher war die dritte Zeile optional und die Liste bekam dadurch
                        einen unruhigen Takt (Zeilen mal 120, mal 145 Pixel hoch). */}
                    <div className="min-w-0 flex-1">
                      {/* flex-wrap, damit die Kennzeichnung am Handy neben „7. Reel" nicht
                          den Titel wegdrückt (sie stand dort vor drei Punkten). Umbricht sie
                          doch, wächst die Zeile trotzdem nicht: Die Höhe der Zeile gibt die
                          Vorschau vor (44px breit, 4:5 hoch), und darunter passen drei
                          Textzeilen bequem. */}
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[14px] font-medium text-ink">
                        <span className="truncate">
                          {i + 1}. {p.isReel ? "Reel" : "Beitrag"}
                        </span>
                        {hidden && (
                          <span className={`${STATUS_NEUTRAL} shrink-0`}>nicht sichtbar</span>
                        )}
                      </p>
                      <p className="flex min-w-0 items-baseline gap-1.5 text-[11px] text-muted">
                        <a
                          href={p.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 underline decoration-muted/40 hover:text-ink"
                        >
                          {p.permalink.replace("https://www.instagram.com", "")}
                        </a>
                        {p.alt && (
                          <span className="truncate text-muted/80">
                            <span aria-hidden>· </span>
                            {p.alt}
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onMove(p.id, "up")}
                        disabled={i === 0 || busyId !== null}
                        aria-label="Nach vorn"
                        className={ICON_BTN}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => onMove(p.id, "down")}
                        disabled={i === posts.length - 1 || busyId !== null}
                        aria-label="Nach hinten"
                        className={ICON_BTN}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setErr(null);
                          setConfirmDelete(p.id);
                        }}
                        disabled={busyId !== null}
                        aria-label="Löschen"
                        className={`${ICON_BTN} text-muted hover:text-accent`}
                      >
                        ✕
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
