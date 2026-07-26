"use client";

import { useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { addSocialPost, deleteSocialPost, moveSocialPost } from "@/lib/social-actions";
import { compressImage, uploadImage } from "@/lib/image-upload";
import { socialProfile, type SocialPost, SOCIAL_FEED_SIZE } from "@/lib/social";
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

const inputCls =
  "w-full rounded-[10px] bg-white px-3 py-2 text-[14px] text-ink ring-1 ring-black/[0.08] outline-none focus:ring-2 focus:ring-accent/40";

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
    }
  }

  async function onAdd() {
    setErr(null);
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

  return (
    <div className="rounded-[16px] bg-white p-5 shadow-sm ring-1 ring-black/[0.04]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-ink">Instagram-Kacheln</h2>
        <span className="text-[12px] text-muted">
          {posts.length} angelegt, die ersten {SOCIAL_FEED_SIZE} erscheinen
        </span>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Erscheinen auf der Startseite und unter „Über uns“, mit dem Knopf zu @{ig.handle}. Ohne
        Kacheln blendet sich die ganze Section aus. In der Instagram-App beim Beitrag auf
        ⋯ → „Link kopieren“, dann hier einfügen.
      </p>

      {/* ── Neue Kachel ─────────────────────────────────────────────────────────────── */}
      <div className="mt-4 rounded-[12px] bg-black/[0.02] p-4 ring-1 ring-black/[0.04]">
        <div className="flex flex-wrap items-start gap-4">
          {/* Vorschau im Format der echten Kachel (4:5), damit man vor dem Speichern sieht,
              wie der Zuschnitt wirkt. */}
          <div className="w-[84px] shrink-0">
            <div className="aspect-[4/5] w-full overflow-hidden rounded-[10px] bg-black/[0.05] ring-1 ring-black/[0.06]">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[11px] text-muted">
                  Bild
                </span>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onFile}
              disabled={uploading || saving}
              className="mt-2 w-full text-[11px] text-muted file:mr-2 file:rounded-full file:border-0 file:bg-black/5 file:px-2 file:py-1 file:text-[11px] file:font-semibold file:text-ink"
            />
            {uploading && (
              <p className="mt-1 text-[11px] text-muted">
                <Busy>Lädt</Busy>
              </p>
            )}
          </div>

          <div className="min-w-[220px] flex-1 space-y-2">
            <label className="block">
              <span className="text-[12px] font-medium text-muted">Link zum Beitrag</span>
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://www.instagram.com/p/..."
                inputMode="url"
                className={`mt-1 ${inputCls}`}
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-muted">
                Bildbeschreibung (optional, für Screenreader)
              </span>
              <input
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
                placeholder="z. B. Sonnenaufgang am Gipfelkreuz"
                className={`mt-1 ${inputCls}`}
              />
            </label>
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={onAdd}
                disabled={saving || uploading || !image}
                className="rounded-full bg-accent px-4 py-1.5 text-[13px] font-semibold text-white transition active:scale-95 disabled:opacity-50"
              >
                {saving ? <Busy>Speichert</Busy> : "Kachel hinzufügen"}
              </button>
              {(image || link) && (
                <button
                  type="button"
                  onClick={reset}
                  className="text-[12px] font-medium text-muted transition hover:text-ink"
                >
                  Zurücksetzen
                </button>
              )}
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
          {posts.map((p, i) => (
            <li
              key={p.id}
              className={`flex items-center gap-3 rounded-[12px] px-3 py-2.5 ring-1 ring-black/[0.04] ${
                // Ab der siebten Kachel sichtbar abgesetzt: Sie ist angelegt, wird aber
                // nicht gezeigt. Ohne diesen Hinweis pflegt man Kacheln, die niemand sieht.
                i < SOCIAL_FEED_SIZE ? "bg-black/[0.02]" : "bg-amber-50/60"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.imageUrl}
                alt=""
                className="h-14 w-[45px] shrink-0 rounded-[8px] object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">
                  {i + 1}. {p.isReel ? "Reel" : "Beitrag"}
                  {i >= SOCIAL_FEED_SIZE && " · wird nicht gezeigt"}
                </p>
                <a
                  href={p.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-[11px] text-muted underline decoration-muted/40 hover:text-ink"
                >
                  {p.permalink.replace("https://www.instagram.com", "")}
                </a>
                {p.alt && <p className="truncate text-[11px] text-muted">{p.alt}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => onMove(p.id, "up")}
                  disabled={i === 0 || busyId !== null}
                  aria-label="Nach vorn"
                  className="h-7 w-7 rounded-full bg-black/5 text-[13px] font-bold text-ink transition disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => onMove(p.id, "down")}
                  disabled={i === posts.length - 1 || busyId !== null}
                  aria-label="Nach hinten"
                  className="h-7 w-7 rounded-full bg-black/5 text-[13px] font-bold text-ink transition disabled:opacity-30"
                >
                  ↓
                </button>
                {confirmDelete === p.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onDelete(p.id)}
                      disabled={busyId !== null}
                      className="ml-1 rounded-full bg-accent px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-50"
                    >
                      {busyId === p.id ? <Busy>Löscht</Busy> : "Löschen"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      className="rounded-full px-2 py-1 text-[12px] font-medium text-muted"
                    >
                      Abbrechen
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setErr(null);
                      setConfirmDelete(p.id);
                    }}
                    disabled={busyId !== null}
                    className="ml-1 rounded-full px-2 py-1 text-[12px] font-medium text-muted transition hover:text-accent disabled:opacity-40"
                  >
                    Löschen
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
