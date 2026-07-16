"use client";

import Image from "next/image";
import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  type PanInfo,
} from "framer-motion";
import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import type { ExploreSpot } from "@/lib/spots";
import { toggleSaved } from "@/lib/saved-actions";
import { Bookmark, BookmarkFilled } from "./icons";
import LockedMedia from "./LockedMedia";
import { useBodyDrag } from "./useBodyDrag";

const SPRING = { type: "spring" as const, damping: 36, stiffness: 380 };
// Peek-Detent = Anteil der vh, den das Sheet unten abdeckt (halb: Bild sichtbar).
// Exportiert, damit die Explore-Karte den Spot GENAU über das Sheet einpasst
// (eine Quelle der Wahrheit -> bleibt synchron).
export const SPOT_SHEET_PEEK = 0.55;
const DETENTS = [SPOT_SHEET_PEEK, 0.92]; // öffnet direkt halb (Bild sichtbar) / Voll

function X() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// Echtes ziehbares Spot-Bottom-Sheet (Apple Karten / Google Maps Stil):
// Peek/Halb/Voll, runterziehen schließt, kein Backdrop. Liegt über dem Explore-Sheet.
export default function SpotSheet({
  spot,
  onClose,
  closing = false,
  loggedIn = false,
  saved = false,
  onSavedChange,
}: {
  spot: ExploreSpot;
  onClose: () => void;
  closing?: boolean;
  loggedIn?: boolean;
  saved?: boolean; // controlled durch Explore (Quelle der Wahrheit)
  onSavedChange?: (slug: string, saved: boolean) => void;
}) {
  const t = useTranslations("Explore");
  const router = useRouter();
  const [vh, setVh] = useState(0);
  const y = useMotionValue(2000);
  const dragControls = useDragControls();
  const idxRef = useRef(0);
  const tapStart = useRef({ y: 0 });
  const [atFull, setAtFull] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyDrag = useBodyDrag(dragControls, bodyRef, atFull);
  const [, startTransition] = useTransition();

  function onSave() {
    if (!loggedIn) {
      router.push("/profil");
      return;
    }
    const next = !saved;
    // Optimistisch: Explore aktualisiert die Quelle der Wahrheit -> Icon flippt sofort.
    onSavedChange?.(spot.slug, next);
    startTransition(async () => {
      const r = await toggleSaved(spot.slug);
      if (typeof r.saved === "boolean" && r.saved !== next) {
        onSavedChange?.(spot.slug, r.saved);
      }
      if (r.needLogin) router.push("/profil");
    });
  }

  const full = DETENTS[DETENTS.length - 1];
  const base = vh || 800;
  const sheetH = base * full;
  const snapY = (d: number) => (full - d) * base;
  const closedY = sheetH;

  useEffect(() => {
    const u = () => setVh(window.innerHeight);
    u();
    window.addEventListener("resize", u);
    return () => window.removeEventListener("resize", u);
  }, []);

  // Beim Öffnen / Spot-Wechsel auf Peek einfahren
  useEffect(() => {
    if (vh) {
      idxRef.current = 0;
      setAtFull(false);
      animate(y, snapY(DETENTS[0]), SPRING);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vh, spot.slug]);

  function dismiss() {
    animate(y, closedY, SPRING).then(() => onClose());
  }

  // Esc schließt
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Klick neben das Sheet (Karte) -> gleiche Schließ-Animation wie das ✕
  useEffect(() => {
    if (closing) dismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);
  function snapToIndex(i: number) {
    const c = Math.max(0, Math.min(DETENTS.length - 1, i));
    idxRef.current = c;
    setAtFull(c === DETENTS.length - 1);
    animate(y, snapY(DETENTS[c]), SPRING);
  }
  function handleDragEnd(_e: unknown, info: PanInfo) {
    const cur = y.get();
    const points = DETENTS.map(snapY);
    const lowest = Math.max(...points);
    if (cur > lowest + 80 || info.velocity.y > 900) {
      dismiss();
      return;
    }
    let best = 0;
    for (let i = 0; i < points.length; i++) {
      if (Math.abs(points[i] - cur) < Math.abs(points[best] - cur)) best = i;
    }
    if (info.velocity.y < -400 && best < DETENTS.length - 1) best++;
    if (info.velocity.y > 400 && best > 0) best--;
    snapToIndex(best);
  }
  function onHandleDown(e: React.PointerEvent) {
    tapStart.current.y = e.clientY;
    dragControls.start(e);
  }
  function onHandleUp(e: React.PointerEvent) {
    if (Math.abs(e.clientY - tapStart.current.y) < 6) {
      snapToIndex(idxRef.current < DETENTS.length - 1 ? idxRef.current + 1 : idxRef.current);
    }
  }

  const btn =
    "flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-ink";

  return (
    <motion.div
      style={{ y, height: sheetH }}
      drag="y"
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ top: 0, bottom: closedY }}
      dragElastic={0.06}
      onDragEnd={handleDragEnd}
      className="fixed inset-x-0 bottom-0 z-[55] flex w-full flex-col rounded-t-[22px] bg-cream shadow-[0_-10px_44px_-12px_rgba(0,0,0,0.4)]"
    >
      {/* Griff = Drag/Tap */}
      <div
        onPointerDown={onHandleDown}
        onPointerUp={onHandleUp}
        className="flex cursor-grab touch-none justify-center py-3 active:cursor-grabbing"
      >
        <span className="h-1.5 w-10 rounded-full bg-black/15" aria-hidden />
      </div>

      <div
        ref={bodyRef}
        {...bodyDrag}
        style={{ touchAction: atFull ? "auto" : "pan-x" }}
        className={`flex-1 overscroll-contain px-5 pb-[calc(env(safe-area-inset-bottom)+2rem)] ${
          atFull ? "overflow-y-auto" : "overflow-y-hidden"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          {/* Gesperrt: "🤫 Geheimtipp" ist der EINZIGE Sperr-Hinweis. Das Bild trägt
              deshalb kein Abzeichen mehr – sonst stünde dasselbe Wort doppelt da. */}
          <h2 className="text-2xl font-bold leading-tight text-ink">
            {spot.locked ? t("lockedLabel") : spot.title}
          </h2>
          <div className="flex shrink-0 gap-2">
            {!spot.locked && (
              <button
                type="button"
                onClick={onSave}
                aria-label={t("save")}
                aria-pressed={saved}
                className={btn}
              >
                {saved ? (
                  <BookmarkFilled className="h-[17px] w-[17px] text-accent" />
                ) : (
                  <Bookmark className="h-[17px] w-[17px]" />
                )}
              </button>
            )}
            <button type="button" onClick={dismiss} aria-label={t("close")} className={btn}>
              <X />
            </button>
          </div>
        </div>

        {spot.locked ? (
          // Conversion-Reihenfolge: Motiv (macht Lust) -> ein Satz warum -> Button.
          // ALLES muss in den Peek passen, sonst sieht man am iPhone das Foto, aber
          // nicht den Button – und weiß nicht, wie man freischaltet.
          //
          // Das Sheet ist 92vh hoch, zeigt am Peek aber nur SPOT_SHEET_PEEK (55vh);
          // sein unteres Ende liegt außerhalb des Bildschirms. Ein am Sheet-Boden
          // klebender Button (sticky) wäre also unsichtbar – die Höhe muss stimmen.
          //
          // Deshalb vh-relativ statt fester Pixel: Auf kleinen Geräten (iPhone SE)
          // schrumpft das Foto mit, statt den Button hinauszuschieben. Rechnung für
          // den engsten Fall (667px hoch): 55vh Peek ≈ 367px, minus Griff ≈ 337px
          // nutzbar; Inhalt ≈ 32 (Titel) + 160 (Foto) + 40 (Teaser) + 46 (Button)
          // + 36 (Abstände) ≈ 314px. Passt mit Reserve.
          // Apple-Reihenfolge (App Store / TV+): Motiv, dann die Aktion, dann Details.
          // Der Button steht klar unter dem Bild – nichts liegt übereinander.
          //
          // Er MUSS im Peek sichtbar sein, sonst sieht man am iPhone nur das Foto und
          // weiß nicht, wie man kauft. Das Sheet ist 92vh hoch, sichtbar sind aber nur
          // SPOT_SHEET_PEEK (55vh) minus Tab-Leiste. Deshalb ist die Bildhöhe vh-relativ:
          // Auf kleinen Geräten schrumpft das Foto, statt den Button hinauszudrücken.
          // Gemessen (Chrome DevTools Protocol, echtes Viewport): iPhone SE 375x667 und
          // iPhone 15 390x844 -> Button in beiden Fällen über der Tab-Leiste.
          <>
            <LockedMedia
              previewUrl={spot.previewUrl}
              emoji={spot.emoji}
              eager
              className="mt-3 h-[20vh] max-h-[220px] min-h-[120px] w-full rounded-[16px]"
            />
            <Link
              href="/pro"
              className="mt-3 block rounded-full bg-accent px-5 py-3 text-center text-[15px] font-semibold text-white active:scale-[0.98]"
            >
              {t("unlock")}
            </Link>
            {/* Erklärender Nachsatz. Steht bewusst NACH dem Button: Er darf am Peek
                angeschnitten sein, die Kernbotschaft (Motiv + Aktion) steht schon oben. */}
            <p className="mt-3 line-clamp-2 text-[14px] leading-snug text-muted">
              {t("proTeaser")}
            </p>
          </>
        ) : (
          <>
            {spot.shortDesc && (
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
                {spot.shortDesc}
              </p>
            )}
            <Link
              href={`/spot/${spot.slug}`}
              className="mt-4 inline-block rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white active:scale-[0.98]"
            >
              {t("more")}
            </Link>

            {/* Bild (sichtbar beim Hochziehen) */}
            <div className="mt-5">
              {spot.imageUrl ? (
                <div className="relative aspect-[16/10] w-full overflow-hidden rounded-[16px]">
                  <Image
                    src={spot.imageUrl}
                    alt={spot.title}
                    fill
                    sizes="(min-width: 768px) 27rem, 100vw"
                    className="object-cover"
                  />
                </div>
              ) : (
                <div className="flex aspect-[16/10] items-center justify-center overflow-hidden rounded-[16px] bg-gradient-to-br from-accent/20 to-muted/20">
                  <span className="text-6xl" aria-hidden>
                    {spot.emoji ?? "📍"}
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
