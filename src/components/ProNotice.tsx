"use client";

import { useEffect, useState, useTransition } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  dismissProNotice,
  getPendingProNotice,
  type ProNoticeSource,
} from "@/lib/pro-notice-actions";

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
  const reduce = useReducedMotion();
  const [source, setSource] = useState<ProNoticeSource | null>(null);
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
          {/* Knopf UNTER dem Text, nicht daneben: Neben dem Text nahm er so viel Breite,
              dass schon die deutsche Überschrift umbrach. Über neun Sprachen mit sehr
              unterschiedlicher Wortlänge ist untereinander die einzige Anordnung, die
              immer absichtlich aussieht. */}
          <div
            role="status"
            className="pointer-events-auto mx-auto w-full max-w-[420px] rounded-[22px] border border-black/[0.06] bg-white/90 px-4 py-3.5 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_18px_40px_-24px_rgba(0,0,0,0.35)] backdrop-blur-xl"
          >
            <p className="text-[15px] font-semibold text-accent">{text.title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{text.body}</p>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={close}
                className="rounded-full bg-black/[0.06] px-4 py-2 text-[13px] font-semibold text-ink active:scale-[0.97]"
              >
                {t("notice.dismiss")}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
