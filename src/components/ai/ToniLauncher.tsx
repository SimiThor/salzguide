"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import ToniAvatar from "./ToniAvatar";

// Schwebender KI-Guide-Launcher unten rechts (nur Desktop; mobil öffnet die
// BottomNav den Chat). Die Sprechblase erscheint EINMAL pro Browser-Session
// (sessionStorage) kurz nach dem Laden: sie ploppt verspielt herein, hüpft kurz
// und blendet sich von selbst wieder aus -> holt zu Session-Beginn Aufmerksamkeit,
// nervt aber nicht (kein erneutes Auftauchen in derselben Session).
// prefers-reduced-motion wird respektiert (dann nur sanftes Einblenden).
const SEEN_KEY = "sg_toni_launcher_seen"; // sessionStorage: 1x pro Session

export default function ToniLauncher({
  open,
  isOpen,
  bubbleBlocked = false,
}: {
  open: () => void;
  isOpen: boolean;
  // Ein fokussiertes Overlay (Spot-Karte) ist offen -> Blase zurückhalten. Der
  // Launcher selbst bleibt: Er ist klein, und die Spot-Karte lässt ihm per pr-Spalte
  // Platz. Die Blase ist bis 230px breit und läge sonst quer über der Karte.
  bubbleBlocked?: boolean;
}) {
  const t = useTranslations("Ai");
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const [showBubble, setShowBubble] = useState(false);
  const [bubbleIdx, setBubbleIdx] = useState(0);
  const startedRef = useRef(false);

  const markSeen = () => {
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {
      /* ignore */
    }
    if (seen) return;
    const lines = t.raw("launcherBubbles") as string[];
    const showT = setTimeout(() => {
      // zufälliger Spruch (client-seitig, kein SSR-Mismatch da die Blase nur
      // nach diesem Timer gerendert wird)
      setBubbleIdx(Math.floor(Math.random() * lines.length));
      setShowBubble(true);
      markSeen(); // gilt für diese Session als gezeigt -> taucht nicht erneut auf
    }, 2500);
    const hideT = setTimeout(() => setShowBubble(false), 11000); // von selbst weg
    return () => {
      clearTimeout(showT);
      clearTimeout(hideT);
    };
  }, [t]);

  const dismiss = () => {
    setShowBubble(false);
    markSeen();
  };
  const onOpen = () => {
    dismiss();
    open();
  };

  // Beim offenen Chat und im Admin-Bereich ausblenden.
  if (isOpen || pathname.startsWith("/admin")) return null;

  const lines = t.raw("launcherBubbles") as string[];
  const bubbleText = lines[bubbleIdx % lines.length] ?? lines[0] ?? "";

  return (
    <div className="fixed bottom-6 right-6 z-[55] hidden flex-col items-end gap-2.5 md:flex">
      <AnimatePresence>
        {showBubble && !bubbleBlocked && (
          <motion.div
            key="bubble"
            initial={reduce ? { opacity: 0, y: 6 } : { opacity: 0, scale: 0.3, y: 18, rotate: -12 }}
            animate={reduce ? { opacity: 1, y: 0 } : { opacity: 1, scale: 1, y: 0, rotate: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 8, transition: { duration: 0.15 } }}
            transition={
              reduce
                ? { duration: 0.25 }
                : { type: "spring", stiffness: 540, damping: 11, mass: 0.8 }
            }
            className="mr-1"
          >
            {/* Innerer, dauerhaft leicht hüpfender Layer (verspielt, aber dezent) –
                getrennt vom Auftritt oben, damit sich beide nicht in die Quere kommen. */}
            <motion.div
              animate={reduce ? undefined : { y: [0, -6, 0, -3, 0] }}
              transition={
                reduce
                  ? undefined
                  : {
                      duration: 1.4,
                      times: [0, 0.25, 0.5, 0.72, 1],
                      repeat: Infinity,
                      repeatDelay: 1.9,
                      ease: "easeInOut",
                      delay: 0.7,
                    }
              }
              className="relative max-w-[230px] rounded-[16px] rounded-br-md bg-white px-3.5 py-2.5 text-[13px] font-medium leading-snug text-ink shadow-[0_10px_30px_-8px_rgba(0,0,0,0.28)] ring-1 ring-black/[0.05]"
            >
              {bubbleText}
              <button
                type="button"
                onClick={dismiss}
                aria-label={t("launcherDismiss")}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white transition hover:bg-black/70"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Kein Wackeln (später ein echtes Foto) -> Aufmerksamkeit über einmaligen
          Spring-Auftritt + dezenten, atmenden Glow (bewegt das Bild NICHT). */}
      <motion.button
        type="button"
        onClick={onOpen}
        aria-label={t("launcherAria")}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          scale: { type: "spring", stiffness: 380, damping: 15, delay: 0.4 },
          opacity: { duration: 0.3, delay: 0.4 },
        }}
        whileHover={{ scale: 1.07 }}
        whileTap={{ scale: 0.92 }}
        className="sg-launcher-glow relative flex h-14 w-14 items-center justify-center rounded-full ring-2 ring-white"
      >
        <ToniAvatar size={56} />
      </motion.button>
    </div>
  );
}
