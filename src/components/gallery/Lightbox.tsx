"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image, { getImageProps } from "next/image";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { useTranslations } from "next-intl";
import { useIsMounted } from "@/lib/use-is-mounted";
import AiImageBadge from "@/components/AiImageBadge";
import type { AiOrigin } from "@/lib/ai-origin";

function Icon({ d }: { d: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

// Vollbild-Foto-Viewer im iOS-2026-Stil: wischen/klicken durch alle Fotos,
// Tastatur, Thumbnails, Schließen per X/Backdrop/Esc/Runterziehen.
// Gesten mit Achsen-Sperre: horizontal blättert, vertikal schließt – nie beides.
export default function Lightbox({
  images,
  aiOrigins,
  title,
  startIndex,
  onClose,
}: {
  images: string[];
  /** KI-Herkunft je Foto, index-gleich zu images (Art. 50 KI-VO, docs/39). */
  aiOrigins?: (AiOrigin | null)[];
  title: string;
  startIndex: number;
  onClose: () => void;
}) {
  const t = useTranslations("Detail");
  const mounted = useIsMounted();
  const [[index, dir], setState] = useState<[number, number]>([startIndex, 0]);
  const n = images.length;
  const stripRef = useRef<HTMLDivElement>(null);

  // Achsen-Sperre: eine Geste ist entweder horizontal (blättern) oder
  // vertikal (schließen) – nie beides gleichzeitig, wie in nativen Foto-Viewern.
  const dragAxis = useRef<"x" | "y" | null>(null);

  // Beim Runterziehen folgt das Foto dem Finger; Hintergrund und Bedien-
  // elemente blenden aus, das Foto schrumpft leicht (iOS Pull-to-dismiss).
  const dragY = useMotionValue(0);
  const chromeOpacity = useTransform(dragY, [0, 240], [1, 0.25]);
  const photoScale = useTransform(dragY, [0, 400], [1, 0.88]);

  const paginate = useCallback(
    (d: number) =>
      setState(([i]) => {
        const ni = i + d;
        return ni < 0 || ni >= n ? [i, 0] : [ni, d];
      }),
    [n],
  );
  const goTo = useCallback(
    (target: number) => setState(([i]) => [target, target > i ? 1 : -1]),
    [],
  );

  // Body-Scroll-Lock + Tastatursteuerung
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") paginate(1);
      else if (e.key === "ArrowLeft") paginate(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, paginate]);

  // Aktives Thumbnail in den sichtbaren Bereich scrollen
  useEffect(() => {
    const el = stripRef.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [index]);

  // Nachbarbilder vorladen, damit beim Wischen nie ein leeres Bild aufblitzt.
  useEffect(() => {
    for (const i of [index - 1, index + 1]) {
      if (i < 0 || i >= n) continue;
      const { props } = getImageProps({
        src: images[i],
        alt: "",
        fill: true,
        sizes: "94vw",
        quality: 75,
      });
      const img = new window.Image();
      if (props.sizes) img.sizes = props.sizes;
      if (props.srcSet) img.srcset = props.srcSet;
      img.src = props.src;
    }
  }, [index, images, n]);

  if (!mounted) return null;

  // Nach der Geste entscheidet die gesperrte Achse: vertikal = schließen
  // (weit genug oder ein schneller Flick nach unten), horizontal = blättern.
  // Alles darunter federt zurück an seinen Platz.
  const onDragEnd = (_e: unknown, info: PanInfo) => {
    const axis = dragAxis.current;
    dragAxis.current = null;
    if (axis === "y") {
      if (info.offset.y > 120 || (info.offset.y > 40 && info.velocity.y > 600)) {
        onClose();
      }
      return;
    }
    if (axis !== "x") return;
    if (info.offset.x < -80 || info.velocity.x < -500) paginate(1);
    else if (info.offset.x > 80 || info.velocity.x > 500) paginate(-1);
  };

  const ctrl =
    "cursor-pointer disabled:cursor-not-allowed flex items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition active:scale-95";

  return createPortal(
    <motion.div
      role="dialog"
      aria-modal="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
      className="fixed inset-0 z-[100] flex cursor-pointer flex-col"
    >
      {/* Hintergrund als eigene Ebene, damit er beim Runterziehen ausblendet */}
      <motion.div
        aria-hidden
        style={{ opacity: chromeOpacity }}
        className="absolute inset-0 bg-black/95"
      />

      {/* Kopf: Zähler + Schließen */}
      <motion.div
        className="relative z-10 flex items-center justify-between px-4 pb-2"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 12px)",
          opacity: chromeOpacity,
        }}
      >
        <span className="flex items-center gap-2">
          {n > 1 && (
            <span className="text-sm font-medium tabular-nums text-white/80">
              {index + 1} / {n}
            </span>
          )}
          {/* KI-Label des GERADE gezeigten Fotos, im Kopf neben dem Zähler: fährt mit
              der übrigen Bedienebene aus (chromeOpacity), statt auf dem Foto zu kleben. */}
          {aiOrigins?.[index] && (
            <AiImageBadge origin={aiOrigins[index]!} className="inline-flex" />
          )}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label={t("gallery.close")}
          className={`${ctrl} h-10 w-10`}
        >
          <Icon d="M6 6l12 12M18 6L6 18" />
        </button>
      </motion.div>

      {/* Bildbühne */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <AnimatePresence initial={false} custom={dir}>
          <motion.img
            key={index}
            {...(() => {
              const { props } = getImageProps({
                src: images[index],
                alt: title,
                fill: true,
                sizes: "94vw",
                quality: 75,
              });
              // Nur die Lade-Attribute übernehmen – Position/Styling macht die className.
              return { src: props.src, srcSet: props.srcSet, sizes: props.sizes };
            })()}
            alt={title}
            custom={dir}
            variants={{
              enter: (d: number) => ({ x: d > 0 ? 80 : d < 0 ? -80 : 0, opacity: 0 }),
              center: { x: 0, opacity: 1 },
              exit: (d: number) => ({ x: d > 0 ? -80 : 80, opacity: 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.25, ease: "easeOut" }}
            drag
            dragDirectionLock
            // Achtung Reihenfolge: onDirectionLock feuert VOR onDragStart –
            // deshalb hier kein Reset beim Start, das onDragEnd räumt auf.
            onDirectionLock={(axis) => {
              dragAxis.current = axis;
            }}
            dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
            // Runter = Finger folgen (schließen), rauf = straffer Widerstand,
            // am Anfang/Ende der Galerie strafferes Gummiband als mittendrin.
            dragElastic={{
              top: 0.12,
              bottom: 1,
              left: index === n - 1 ? 0.25 : 0.7,
              right: index === 0 ? 0.25 : 0.7,
            }}
            // Zurückfedern ohne Überschwingen (Apples Kurve).
            dragTransition={{ bounceStiffness: 500, bounceDamping: 45 }}
            style={{ y: dragY, scale: photoScale }}
            onDragEnd={onDragEnd}
            onClick={(e) => e.stopPropagation()}
            draggable={false}
            className="absolute inset-0 m-auto max-h-[82svh] max-w-[94vw] cursor-grab touch-none select-none rounded-[12px] object-contain active:cursor-grabbing"
          />
        </AnimatePresence>

        {/* Pfeile (Desktop) */}
        {n > 1 && (
          <>
            <button
              type="button"
              disabled={index === 0}
              onClick={(e) => {
                e.stopPropagation();
                paginate(-1);
              }}
              aria-label={t("gallery.prev")}
              className={`${ctrl} absolute left-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 disabled:opacity-0 md:flex`}
            >
              <Icon d="M15 6l-6 6 6 6" />
            </button>
            <button
              type="button"
              disabled={index === n - 1}
              onClick={(e) => {
                e.stopPropagation();
                paginate(1);
              }}
              aria-label={t("gallery.next")}
              className={`${ctrl} absolute right-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 disabled:opacity-0 md:flex`}
            >
              <Icon d="M9 6l6 6-6 6" />
            </button>
          </>
        )}
      </div>

      {/* Thumbnails */}
      {n > 1 && (
        <motion.div
          ref={stripRef}
          onClick={(e) => e.stopPropagation()}
          className="relative z-10 flex gap-2 overflow-x-auto px-4 pt-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{
            paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)",
            opacity: chromeOpacity,
          }}
        >
          {images.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`${i + 1}`}
              className={`cursor-pointer relative h-14 w-14 shrink-0 overflow-hidden rounded-[8px] ring-2 transition ${
                i === index ? "ring-white" : "opacity-50 ring-transparent"
              }`}
            >
              <Image src={url} alt="" fill sizes="56px" quality={50} className="object-cover" />
            </button>
          ))}
        </motion.div>
      )}
    </motion.div>,
    document.body,
  );
}
