"use client";

import {
  animate,
  AnimatePresence,
  motion,
  useDragControls,
  useMotionValue,
  type PanInfo,
} from "framer-motion";
import {
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";

// iOS-2026 Overlay (docs/02 §8), responsiv:
// - Mobile: ziehbares Bottom-Sheet mit Detents (Halb/Voll), Grabber, Spring.
// - Desktop: zentriertes Modal (Scale+Fade), Esc/Klick-außen schließt — wie macOS.
//
// Optionale Slots:
// - header: ersetzt den einfachen Titel (z. B. Avatar + Name + Aktionen).
// - footer: FIXIERTER Bereich am unteren Rand AUSSERHALB des Scrollbereichs
//   (deckendes bg-cream inkl. Safe-Area) -> z. B. Chat-Eingabe; nichts scheint
//   darunter durch.
const SPRING = { type: "spring" as const, damping: 36, stiffness: 380 };

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  detents?: number[]; // Mobile: aufsteigend, letzter = Voll
  initialDetent?: number;
  title?: string;
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  // "floating" = wie auf der Startseite: KEIN abdunkelnder/unscharfer Backdrop,
  //   die Karte bleibt scharf & bedienbar; Desktop schwebt als Karte im Kartenbereich.
  // "modal" (Default) = klassisches zentriertes Modal mit Backdrop (z. B. Demo).
  variant?: "modal" | "floating";
};

function CloseButton({ onClose }: { onClose: () => void }) {
  const tc = useTranslations("Common");
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={tc("close")}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/5 text-muted transition-colors hover:bg-black/10"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

export default function BottomSheet({
  open,
  onClose,
  detents = [0.55, 0.92],
  initialDetent = 0,
  title,
  header,
  footer,
  children,
  variant = "modal",
}: BottomSheetProps) {
  const floating = variant === "floating";
  const [vh, setVh] = useState(0);
  const [isDesktop, setIsDesktop] = useState(false);
  const y = useMotionValue(2000); // Mobile-Sheet: startet off-screen
  const dragControls = useDragControls();

  const full = detents[detents.length - 1];
  const base = vh || 800;
  const sheetH = base * full;
  const snapY = (d: number) => (full - d) * base;
  const closedY = sheetH;

  // Viewport messen + Desktop/Mobile erkennen
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => {
      setVh(window.innerHeight);
      setIsDesktop(mq.matches);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Mobile-Sheet öffnen/schließen animieren
  useEffect(() => {
    if (isDesktop || !vh) return;
    const target = open ? snapY(detents[initialDetent]) : closedY;
    const controls = animate(y, target, SPRING);
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vh, isDesktop]);

  // Esc-zum-Schließen (+ Scroll-Lock nur im Modal-Modus; im Floating-Modus soll die
  // Karte dahinter scharf & bedienbar bleiben – genau wie auf der Startseite).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    if (!floating) document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      if (!floating) document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, floating]);

  const handleDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    void _event;
    const current = y.get();
    const points = detents.map((d) => snapY(d));
    const lowest = Math.max(...points);
    if (current > lowest + 90 || info.velocity.y > 850) {
      onClose();
      return;
    }
    let best = points[0];
    for (const p of points) {
      if (Math.abs(p - current) < Math.abs(best - current)) best = p;
    }
    animate(y, best, SPRING);
  };

  // Gemeinsame Desktop-Innenstruktur (Header-Zeile, Scroll-Body, fixer Footer).
  const desktopInner = (
    <>
      <div
        className={`flex items-center justify-between gap-3 px-5 pt-5 ${
          header ? "border-b border-black/[0.06] pb-3.5" : ""
        }`}
      >
        <div className="min-w-0 flex-1">
          {header ?? <h2 className="text-lg font-semibold text-ink">{title}</h2>}
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <div className={`flex-1 overflow-y-auto px-5 pt-4 ${footer ? "pb-3" : "pb-6"}`}>
        {children}
      </div>
      {footer && (
        <div className="shrink-0 border-t border-black/[0.06] bg-cream px-5 pb-5 pt-3">
          {footer}
        </div>
      )}
    </>
  );

  return (
    <>
      {/* Backdrop nur im Modal-Modus – im Floating-Modus bleibt die Karte scharf. */}
      {!floating && (
        <div
          onClick={onClose}
          aria-hidden={!open}
          className={`fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm transition-opacity duration-300 ${
            open ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        />
      )}

      {isDesktop && floating ? (
        // ---- Desktop (floating): schwebende Karte im Kartenbereich, kein Backdrop ----
        <AnimatePresence>
          {open && (
            <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[55] px-4 md:left-[var(--sg-panel-water)] md:right-0">
              <motion.div
                role="dialog"
                aria-modal={false}
                initial={{ opacity: 0, scale: 0.97, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 8 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="pointer-events-auto mx-auto flex max-h-[70vh] w-full max-w-sm flex-col overflow-hidden rounded-[22px] bg-cream shadow-[0_18px_50px_-12px_rgba(0,0,0,0.4)]"
              >
                {desktopInner}
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      ) : isDesktop ? (
        // ---- Desktop: zentriertes Modal ----
        <AnimatePresence>
          {open && (
            <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center p-4">
              <motion.div
                role="dialog"
                aria-modal="true"
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 6 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="pointer-events-auto flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-[22px] bg-cream shadow-2xl"
              >
                {desktopInner}
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      ) : (
        // ---- Mobile: ziehbares Bottom-Sheet ----
        <motion.div
          style={{ y, height: sheetH }}
          drag="y"
          dragListener={false}
          dragControls={dragControls}
          dragConstraints={{ top: 0, bottom: closedY }}
          dragElastic={0.1}
          onDragEnd={handleDragEnd}
          className={`fixed inset-x-0 bottom-0 z-[70] mx-auto flex w-full max-w-lg flex-col overflow-hidden rounded-t-[22px] bg-cream shadow-2xl ${
            open ? "" : "pointer-events-none"
          }`}
        >
          {/* Nur der Grabber-Streifen startet das Ziehen – so lösen Buttons im
              Header (Neuer Chat/Verlauf) keinen versehentlichen Drag aus. */}
          <div className="shrink-0">
            <div
              onPointerDown={(e: ReactPointerEvent) => dragControls.start(e)}
              className="cursor-grab touch-none pb-1 pt-3 active:cursor-grabbing"
            >
              <span className="mx-auto block h-1.5 w-10 rounded-full bg-black/15" aria-hidden />
            </div>
            {header ? (
              <div className="border-b border-black/[0.06] px-5 pb-3 pt-1">{header}</div>
            ) : (
              title && (
                <h2 className="px-5 pb-2 pt-1 text-center text-lg font-semibold text-ink">{title}</h2>
              )
            )}
          </div>
          <div className={`flex-1 overflow-y-auto px-5 pt-4 ${footer ? "pb-2" : "pb-[calc(env(safe-area-inset-bottom)+1.5rem)]"}`}>
            {children}
          </div>
          {footer && (
            <div className="shrink-0 border-t border-black/[0.06] bg-cream px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
              {footer}
            </div>
          )}
        </motion.div>
      )}
    </>
  );
}
