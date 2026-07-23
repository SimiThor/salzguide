"use client";

import Image from "next/image";
import { useTransition } from "react";
import { motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { SpotCardData } from "@/lib/spots";
import { toggleSaved } from "@/lib/saved-actions";
import { Bookmark, BookmarkFilled } from "./icons";
import LockedMedia from "./LockedMedia";
import { useLoginGate } from "./auth/LoginGate";

function X() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// Desktop-Spot-Karte (kein Bottom-Sheet): schwebt oben im Kartenbereich, kein Backdrop.
export default function SpotCardDesktop({
  spot,
  onClose,
  loggedIn = false,
  saved = false,
  onSavedChange,
  panelOffset = true,
}: {
  // Wie bei SpotSheet: Diese Karte liest nur die Basis-Felder, also verlangt sie auch
  // nur die. Damit passt ein gespeicherter Spot hinein und die Gespeichert-Karte zeigt
  // am Desktop dasselbe wie Explore, statt eine zweite Fassung zu brauchen.
  spot: SpotCardData;
  onClose: () => void;
  loggedIn?: boolean;
  saved?: boolean; // controlled durch Explore (Quelle der Wahrheit)
  onSavedChange?: (slug: string, saved: boolean) => void;
  // Auf der Startseite steht links die Spot-Leiste, die Karte rückt daneben. Auf einer
  // vollflächigen Karte (Gespeichert im Vollbild) gibt es die Leiste nicht — dort wäre
  // der Versatz ein Loch von 432px, in das niemand etwas gestellt hat.
  panelOffset?: boolean;
}) {
  const t = useTranslations("Explore");
  const locale = useLocale();
  const gate = useLoginGate();
  const [, startTransition] = useTransition();

  function onSave() {
    const next = !saved;
    // Optimistisch: Explore aktualisiert die Quelle der Wahrheit -> Icon flippt sofort.
    if (loggedIn) onSavedChange?.(spot.slug, next);
    startTransition(async () => {
      // next: Der offene Spot steht nur im Client-State der Karte, nie in der URL –
      // nach dem Login käme man sonst auf der nackten Karte raus.
      const r = await gate.run(
        { loggedIn, reason: "saveSpot", next: `/${locale}/spot/${spot.slug}` },
        () => toggleSaved(spot.slug),
      );
      if (r && typeof r.saved === "boolean" && r.saved !== next) {
        onSavedChange?.(spot.slug, r.saved);
      }
      if (!r || r.needLogin) onSavedChange?.(spot.slug, saved);
    });
  }

  const btn =
    "flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow backdrop-blur text-ink";

  return (
    <div
      data-sg="spot-card-desktop"
      className={`pointer-events-none fixed inset-x-0 bottom-6 z-[55] px-4 ${
        panelOffset ? "md:left-[var(--sg-panel)] md:right-0" : ""
      }`}
    >
      {/* Wechsel von Spot zu Spot ist kein harter Cut: die Karte bleibt am selben Ort,
          alte sinkt + verblasst, neue steigt + blendet ein (Kreuzblende). Die eigentliche
          Presence-Steuerung (Öffnen/Wechseln/Schliessen) liefert das AnimatePresence an der
          Aufrufstelle (Explore + Gespeichert-Karte), das den Slug als key setzt. Ohne
          Presence-Kontext spielt hier nur die Enter-Animation beim Mounten — auch gut. */}
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.96 }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
        className="pointer-events-auto mx-auto w-full max-w-sm overflow-hidden rounded-[20px] bg-white shadow-[0_18px_50px_-12px_rgba(0,0,0,0.4)]"
      >
        <div className="relative">
          {spot.locked ? (
            // Kein Abzeichen: Die Überschrift darunter sagt bereits "🤫 Geheimtipp".
            <LockedMedia
              previewUrl={spot.previewUrl}
              emoji={spot.emoji}
              eager
              className="aspect-[16/10] w-full"
            />
          ) : spot.imageUrl ? (
            <div className="relative aspect-[16/10] w-full overflow-hidden">
              <Image
                src={spot.imageUrl}
                alt={spot.title}
                fill
                sizes="384px"
                className="object-cover"
              />
            </div>
          ) : (
            <div className="flex aspect-[16/10] w-full items-center justify-center bg-gradient-to-br from-accent/20 to-muted/20">
              <span className="text-5xl" aria-hidden>
                {spot.emoji ?? "📍"}
              </span>
            </div>
          )}
          <div className="absolute right-3 top-3 flex gap-2">
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
            <button type="button" onClick={onClose} aria-label={t("close")} className={btn}>
              <X />
            </button>
          </div>
        </div>
        <div className="p-4">
          {spot.locked ? (
            <>
              <h3 className="text-[15px] font-semibold text-ink">{t("lockedLabel")}</h3>
              <p className="mt-1 text-[13px] leading-snug text-muted">{t("proTeaser")}</p>
              <Link
                href="/pro"
                className="mt-3 inline-block rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white active:scale-[0.98]"
              >
                {t("unlock")}
              </Link>
            </>
          ) : (
            <>
              <h3 className="text-[17px] font-semibold text-ink">{spot.title}</h3>
              {spot.shortDesc && (
                <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">
                  {spot.shortDesc}
                </p>
              )}
              <Link
                href={`/spot/${spot.slug}`}
                className="mt-3 inline-block rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white active:scale-[0.98]"
              >
                {t("more")}
              </Link>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
