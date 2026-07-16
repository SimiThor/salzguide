"use client";

import { animate, motion, useDragControls, useMotionValue, type PanInfo } from "framer-motion";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBodyDrag } from "./useBodyDrag";

const SPRING = { type: "spring" as const, damping: 36, stiffness: 380 };

// Persistentes, ziehbares Bottom-Sheet (Mobile) mit Detents/Grabber – iOS-2026.
// Aus Explore ausgelagert, damit Start- und Wasserseite dieselbe Mechanik teilen.
export default function MobileSheet({
  children,
  hide,
  detents = [0.18, 0.5, 0.9],
}: {
  children: ReactNode;
  hide: boolean;
  detents?: number[];
}) {
  const dts = useMemo(() => detents, [detents]);
  const [vh, setVh] = useState(0);
  const y = useMotionValue(99999);
  const dragControls = useDragControls();
  const idxRef = useRef(0);
  const [atFull, setAtFull] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyDrag = useBodyDrag(dragControls, bodyRef, atFull);

  const full = dts[dts.length - 1];
  const base = vh || 800;
  const sheetH = base * full;
  const snapY = useCallback((d: number) => (full - d) * base, [full, base]);

  useEffect(() => {
    const u = () => setVh(window.innerHeight);
    u();
    window.addEventListener("resize", u);
    return () => window.removeEventListener("resize", u);
  }, []);

  useEffect(() => {
    if (!vh) return;
    animate(y, hide ? sheetH : snapY(dts[idxRef.current]), SPRING);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hide, vh]);

  const tapStart = useRef({ y: 0 });

  function snapToIndex(i: number) {
    const clamped = Math.max(0, Math.min(dts.length - 1, i));
    idxRef.current = clamped;
    setAtFull(clamped === dts.length - 1);
    animate(y, snapY(dts[clamped]), SPRING);
  }

  const handleDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    void _event;
    const points = dts.map((d) => snapY(d));
    const cur = y.get();
    let best = 0;
    for (let i = 0; i < points.length; i++) {
      if (Math.abs(points[i] - cur) < Math.abs(points[best] - cur)) best = i;
    }
    if (info.velocity.y < -400 && best < dts.length - 1) best += 1;
    if (info.velocity.y > 400 && best > 0) best -= 1;
    snapToIndex(best);
  };

  function onHeaderPointerDown(e: React.PointerEvent) {
    tapStart.current.y = e.clientY;
    dragControls.start(e);
  }
  function onHeaderPointerUp(e: React.PointerEvent) {
    if (Math.abs(e.clientY - tapStart.current.y) < 6) {
      snapToIndex(idxRef.current < dts.length - 1 ? idxRef.current + 1 : 0);
    }
  }

  return (
    <motion.div
      style={{ y, height: sheetH }}
      drag="y"
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ top: 0, bottom: snapY(dts[0]) }}
      dragElastic={0.08}
      onDragEnd={handleDragEnd}
      className="absolute inset-x-0 bottom-0 z-[45] flex flex-col rounded-t-[22px] bg-cream/95 shadow-2xl backdrop-blur-xl"
    >
      <div
        onPointerDown={onHeaderPointerDown}
        onPointerUp={onHeaderPointerUp}
        className="flex cursor-pointer touch-none flex-col items-center gap-1 pb-2 pt-3 active:cursor-grabbing"
      >
        <span className="h-1.5 w-10 rounded-full bg-black/15" aria-hidden />
      </div>
      <div
        ref={bodyRef}
        {...bodyDrag}
        style={{ touchAction: atFull ? "auto" : "pan-x" }}
        className={`flex-1 overscroll-contain pb-28 pt-1 ${
          atFull ? "overflow-y-auto" : "overflow-y-hidden"
        }`}
      >
        {children}
      </div>
    </motion.div>
  );
}
