"use client";

import { useEffect, useState, useTransition } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  dismissProNotice,
  getPendingProNotice,
} from "@/lib/pro-notice-actions";
import type { ProSource } from "@/lib/pro-source";

// Der einmalige "dein Pro ist da"-Gruss, als dezentes Kärtchen über der Tab-Leiste.
//
// WARUM APP-WEIT UND NICHT AUF DER PROFILSEITE: Es gibt drei Wege zu Pro (Migration 0044).
// Wer selbst kauft oder sich als Alt-Käufer anmeldet, kommt ohnehin am Profil vorbei. Wem
// wir Pro aber schenken, der erfährt davon nie etwas: der sitzt vielleicht wochenlang nur
// auf der Karte. Der Gruss muss dorthin, wo der Mensch ist.
//
// WARUM ER NICHT VON SELBST VERSCHWINDET: Er soll wirklich gesehen werden, und erst das
// Wegklicken markiert ihn als erledigt. Ein Kärtchen, das nach vier Sekunden weghuscht,
// wäre genau der Hinweis, den man verpasst. Nervig wird es davon nicht: Es blockiert
// nichts (der Rahmen ist pointer-events-none), es kostet einen Fingertipp, und danach
// kommt es nie wieder.
//
// Ebene 52: über der Tab-Leiste (50), unter jedem Sheet (55+) -> ein sich öffnendes Sheet
// schiebt sich sauber darüber, statt mit dem Kärtchen zu streiten.
export default function ProNotice() {
  const t = useTranslations("Pro");
  const tCommon = useTranslations("Common");
  const reduce = useReducedMotion();
  const [source, setSource] = useState<ProSource | null>(null);
  const [, startTransition] = useTransition();

  // Einmal je echtem Seitenaufruf fragen. Bei Client-Navigation bleibt AppChrome stehen,
  // der Effekt läuft also nicht bei jedem Tab-Wechsel neu. Gäste sind sofort wieder
  // draussen (die Action steigt ohne Session in Zeile eins aus).
  useEffect(() => {
    let alive = true;
    getPendingProNotice().then((s) => {
      if (alive) setSource(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  function close() {
    // Erst ausblenden, dann speichern: Das Kärtchen soll auf den Tipp hin sofort weg sein.
    // Hakt das Speichern, kommt der Gruss beim nächsten Laden nochmal — besser als ein
    // Kärtchen, das beim Wegklicken hängt.
    setSource(null);
    startTransition(() => {
      void dismissProNotice();
    });
  }

  // Texte bewusst ausgeschrieben statt über einen zusammengebauten Schlüssel: so findet
  // die Suche im Projekt jeden Text, und next-intl prüft ihn beim Bauen mit.
  const text =
    source === "stripe"
      ? { title: t("notice.stripe.title"), body: t("notice.stripe.body") }
      : source === "migration"
        ? { title: t("notice.migration.title"), body: t("notice.migration.body") }
        : { title: t("notice.comp.title"), body: t("notice.comp.body") };

  return (
    <AnimatePresence>
      {source && (
        <motion.div
          // Der Rahmen fängt keine Tipps ab, nur das Kärtchen selbst.
          className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--sg-nav-h)+12px)] z-[52] px-4 md:bottom-6"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
          transition={
            reduce ? { duration: 0.15 } : { type: "spring", stiffness: 440, damping: 34 }
          }
        >
          {/* Schliessen wie beim Karten-Kärtchen (MapPopoverClose): kleines rundes ✕ in
              der Ecke. Bewusst KEIN breiter Knopf unten — das ist ein Gruss, kein Dialog,
              und ein Kärtchen, das über der Karte schwebt, schliesst in dieser App eben
              so. Zusammen mit dem Wegwischen gibt es zwei Wege raus.
              Das ✕ misst sichtbar 28px, die Trefferfläche darum ist über das Padding
              auf ~44px gezogen (Apples Mindestmass). */}
          <motion.div
            role="status"
            drag="y"
            // Nur nach unten nachgeben. Nach oben bleibt es stehen, sonst könnte man das
            // Kärtchen in den Bildschirm hineinziehen.
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            dragDirectionLock
            onDragEnd={(_, info) => {
              // Weit genug ODER schnell genug: ein beherzter kurzer Wisch soll reichen.
              if (info.offset.y > 60 || info.velocity.y > 500) close();
            }}
            className="pointer-events-auto relative mx-auto w-full max-w-[420px] cursor-grab rounded-[22px] border border-black/[0.06] bg-white/90 px-4 py-3.5 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_18px_40px_-24px_rgba(0,0,0,0.35)] backdrop-blur-xl active:cursor-grabbing"
          >
            <div className="pr-8">
              <p className="text-[15px] font-semibold text-accent">{text.title}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{text.body}</p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label={tCommon("close")}
              className="absolute right-1.5 top-1.5 flex h-11 w-11 items-center justify-center"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/5 text-ink transition-transform active:scale-90">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </span>
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
