"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "@/i18n/navigation";
import { saveHomeMedia } from "@/lib/admin-actions";
import {
  compressImage,
  compressSquareImage,
  uploadImage,
  HERO_MAX_DIM,
  AVATAR_DIM,
} from "@/lib/image-upload";
import type { HomeMedia } from "@/lib/home-content";
import type { LandingImage } from "@/lib/landing-media";
import VideoUploader from "./VideoUploader";

// Bilder und Video der Startseite. Solange ein Slot leer ist, zeigt die Seite dort einen
// markierten Platzhalter im richtigen Seitenverhältnis — das Layout steht also schon, und
// nichts springt, wenn Anton nachliefert.
//
// Die langen Kanten sind pro Slot verschieden und NICHT geraten: next/image schneidet aus
// diesem einen Master alle Gerätegrössen und liefert AVIF/WebP aus. Zu klein hochgeladen
// heisst unscharf am grossen Bildschirm, und das lässt sich nachträglich nicht retten.
type ImageSlot = {
  key: "heroPortrait" | "heroLandscape" | "antonPhoto" | "simonPhoto";
  title: string;
  note: string;
  /** Lange Kante des Masters. */
  maxDim: number;
  /** Mittig auf ein Quadrat zuschneiden. Für die runden Porträts. */
  square?: boolean;
  /** Rahmen der Vorschau, damit man sofort sieht, welches Format hier hingehört. */
  previewClass: string;
  /** Breite der Vorschau für next/image. Muss zur Breite in previewClass passen. */
  previewSize: string;
};

const IMAGE_SLOTS: readonly ImageSlot[] = [
  {
    key: "heroPortrait",
    title: "Hero, Handy",
    note: "Hochformat 9:16, etwa 1150 × 2048. Das erste Bild, das jemand von SalzGuide sieht.",
    maxDim: HERO_MAX_DIM,
    previewClass: "aspect-[9/16] w-[120px]",
    previewSize: "120px",
  },
  {
    key: "heroLandscape",
    title: "Hero, Desktop",
    note: "Querformat 16:9, etwa 2048 × 1150.",
    maxDim: HERO_MAX_DIM,
    previewClass: "aspect-[16/9] w-[240px]",
    previewSize: "240px",
  },
  // Zwei Porträts, nicht eines: Die Gründer-Section zeigt jedes Foto neben SEINEM Namen.
  // Ein gemeinsames Bild hiesse, dasselbe Gesicht zweimal zu zeigen.
  {
    key: "antonPhoto",
    title: "Anton",
    note: "Porträt. Wird rund und klein gezeigt, also nah am Gesicht. Der Zuschnitt auf ein Quadrat passiert beim Hochladen.",
    maxDim: AVATAR_DIM,
    square: true,
    previewClass: "aspect-square w-[96px]",
    previewSize: "96px",
  },
  {
    key: "simonPhoto",
    title: "Simon",
    note: "Porträt, gleiches Format wie bei Anton.",
    maxDim: AVATAR_DIM,
    square: true,
    previewClass: "aspect-square w-[96px]",
    previewSize: "96px",
  },
];

export default function HomeMediaManager({ media: saved }: { media: HomeMedia }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [media, setMedia] = useState<HomeMedia>(() => ({ ...saved }));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = useMemo(() => JSON.stringify(media) !== JSON.stringify(saved), [media, saved]);

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await saveHomeMedia(media);
      if (!res.ok) {
        setMsg({ ok: false, text: res.error ?? "Speichern fehlgeschlagen." });
        return;
      }
      setMsg({ ok: true, text: "Gespeichert. Die Startseite zeigt jetzt diese Medien." });
      router.refresh();
    });
  }

  return (
    <section className="rounded-[18px] bg-white p-5 shadow-sm ring-1 ring-black/5">
      <h2 className="text-[17px] font-bold text-ink">Bilder & Video der Startseite</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Lade das Original hoch, so gross wie du es hast. Der Browser rechnet es einmal klein
        und die Seite liefert danach je Gerät die passende Grösse aus.
      </p>

      <div className="mt-5 space-y-4">
        {IMAGE_SLOTS.map((slot) => (
          <ImageSlotRow
            key={slot.key}
            slot={slot}
            value={media[slot.key]}
            onChange={(v) => {
              setMsg(null);
              setMedia((prev) => ({ ...prev, [slot.key]: v }));
            }}
          />
        ))}

        <div className="rounded-[14px] bg-black/[0.02] p-4 ring-1 ring-black/5">
          <h3 className="text-[14px] font-bold text-ink">Erklär-Video</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            Hochformat 9:16, kurz, mit Ton. Ein Video für Handy und Desktop. Das Standbild
            entsteht automatisch und lädt zuerst, das Video erst beim Antippen.
          </p>
          <div className="mt-3">
            <VideoUploader
              videoUrl={media.explainerVideo?.src ?? null}
              posterUrl={media.explainerVideo?.poster ?? null}
              onChange={(src, poster) => {
                setMsg(null);
                // Ohne Standbild kein Video: LandingVideo verlangt ein poster, und ohne das
                // wäre der erste Eindruck ein schwarzes Rechteck, bis das Video geladen ist.
                setMedia((prev) => ({
                  ...prev,
                  explainerVideo: src && poster ? { src, poster } : null,
                }));
              }}
            />
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="rounded-full bg-accent px-5 py-2.5 text-[14px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
        >
          {pending ? "Speichert …" : "Speichern"}
        </button>
        {msg ? (
          <span className={`text-[13px] ${msg.ok ? "text-muted" : "text-accent"}`}>{msg.text}</span>
        ) : dirty ? (
          <span className="text-[13px] text-muted">Ungespeicherte Änderungen.</span>
        ) : null}
      </div>
    </section>
  );
}

function ImageSlotRow({
  slot,
  value,
  onChange,
}: {
  slot: ImageSlot;
  value: LandingImage | null;
  onChange: (v: LandingImage | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // dieselbe Datei nochmal wählen dürfen
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErr("Bitte ein Bild wählen.");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const { blob, width, height } = slot.square
        ? await compressSquareImage(file, slot.maxDim)
        : await compressImage(file, slot.maxDim);
      const src = await uploadImage(blob);
      // Alt-Text beim Austausch behalten: Wer nur ein besseres Foto nachlegt, hat ihn
      // sonst still verloren, und niemandem fällt es auf.
      onChange({ src, alt: value?.alt ?? "", width, height });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[14px] bg-black/[0.02] p-4 ring-1 ring-black/5">
      <h3 className="text-[14px] font-bold text-ink">{slot.title}</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">{slot.note}</p>

      <div className="mt-3 flex flex-wrap items-start gap-4">
        <div
          className={`relative shrink-0 overflow-hidden bg-black/[0.06] ring-1 ring-black/10 ${
            // Rund vorschauen, wenn es auf der Seite rund ist: Sonst sieht man erst live,
            // dass oben ein Stück Kopf fehlt.
            slot.square ? "rounded-full" : "rounded-[10px]"
          } ${slot.previewClass}`}
        >
          {value ? (
            <Image src={value.src} alt="" fill sizes={slot.previewSize} className="object-cover" />
          ) : (
            <span className="grid h-full w-full place-items-center text-[11px] text-muted" aria-hidden>
              leer
            </span>
          )}
        </div>

        <div className="min-w-[220px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="rounded-full bg-black/[0.06] px-3.5 py-2 text-[13px] font-semibold text-ink transition hover:bg-black/10 active:scale-[0.98] disabled:opacity-40"
            >
              {busy ? "Lädt …" : value ? "Ersetzen" : "Bild wählen"}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange(null)}
                disabled={busy}
                className="rounded-full bg-black/[0.06] px-3.5 py-2 text-[13px] font-semibold text-accent transition hover:bg-black/10 active:scale-[0.98] disabled:opacity-40"
              >
                Entfernen
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onFile}
              className="hidden"
            />
          </div>

          {value && (
            <>
              <label className="mt-3 block">
                <span className="text-[12px] font-semibold text-ink">Bildbeschreibung</span>
                <input
                  type="text"
                  value={value.alt}
                  onChange={(e) => onChange({ ...value, alt: e.target.value })}
                  placeholder="z. B. Anton und Simon vor der Festung"
                  className="mt-1 w-full rounded-[10px] bg-white px-3 py-2 text-[14px] text-ink ring-1 ring-black/10 outline-none focus:ring-2 focus:ring-accent/40"
                />
                {/* Deutsch, in allen Sprachen. Der Alt-Text läuft NICHT durch die
                    Übersetzung: Er gehört zum Bild, nicht zu den Texten, und ein
                    deutscher Alt-Text ist ein kleineres Problem als ein fehlender.
                    Leer lassen ist richtig, wenn das Bild rein schmückend ist. */}
                <span className="mt-1 block text-[11px] leading-relaxed text-muted">
                  Für Screenreader und wenn das Bild nicht lädt. Leer lassen, wenn es rein
                  schmückend ist.
                </span>
              </label>
              <p className="mt-2 text-[11px] text-muted">
                {value.width} × {value.height} px
              </p>
            </>
          )}

          {err && <p className="mt-2 text-[12px] text-accent">{err}</p>}
        </div>
      </div>
    </div>
  );
}
