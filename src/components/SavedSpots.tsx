"use client";

import Image from "next/image";
import { useMemo, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { SavedSpot } from "@/lib/saved";
import { toggleSaved } from "@/lib/saved-actions";
import MapCard from "./MapCard";
import { BookmarkFilled } from "./icons";

// iOS-artige Entfern-Animation (fade + leicht schrumpfen, Lücke federt zu).
const EXIT = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, scale: 0.94, transition: { duration: 0.18 } },
  transition: { type: "spring" as const, stiffness: 420, damping: 32 },
};

// Gespeicherte Spots: Karte + Liste teilen sich den State -> Entmerken zieht in
// BEIDEN mit. Überschrift lebt hier -> blendet sich aus, wenn keine Spots mehr.
export default function SavedSpots({
  spots,
  title,
  className = "",
}: {
  spots: SavedSpot[];
  title: string;
  className?: string;
}) {
  const t = useTranslations("Saved");
  const [items, setItems] = useState(spots);
  const [, start] = useTransition();

  const markers = useMemo(
    () =>
      items
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => ({
          slug: s.slug,
          lat: s.lat as number,
          lng: s.lng as number,
          emoji: s.emoji,
          title: s.title,
          // Zweite Zeile im Kartenkärtchen — dieselbe Kurzbeschreibung wie in der
          // Liste darunter, damit beide dasselbe erzählen.
          subtitle: s.locked ? null : s.shortDesc,
          imageUrl: s.locked ? null : s.imageUrl,
        })),
    [items],
  );

  function unsave(slug: string) {
    setItems((cur) => cur.filter((s) => s.slug !== slug)); // optimistisch entfernen
    start(async () => {
      await toggleSaved(slug);
    });
  }

  if (items.length === 0) return null;

  return (
    <section className={className}>
      <h2 className="mb-3 px-4 text-xl font-bold text-ink">{title}</h2>

      {markers.length > 0 && (
        <MapCard
          markers={markers}
          title={title}
          enablePreview
          className="mx-4 h-56 overflow-hidden rounded-[18px] shadow-sm"
        />
      )}

      <div className="mt-4 space-y-3 px-4">
        <AnimatePresence initial={false}>
          {items.map((s) => (
            <motion.div key={s.slug} layout {...EXIT}>
              <article className="flex items-center gap-3 rounded-[16px] bg-white p-3 shadow-sm">
                <Link
                  href={`/spot/${s.slug}`}
                  className="flex min-w-0 flex-1 items-center gap-3 transition-transform active:scale-[0.99]"
                >
                  {!s.locked && s.imageUrl ? (
                    <Image
                      src={s.imageUrl}
                      alt={s.title}
                      width={80}
                      height={64}
                      sizes="80px"
                      className="h-16 w-20 shrink-0 rounded-[12px] object-cover"
                    />
                  ) : (
                    <span className="flex h-16 w-20 shrink-0 items-center justify-center rounded-[12px] bg-gradient-to-br from-accent/15 to-muted/15 text-3xl">
                      {s.emoji ?? "📍"}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold text-ink">
                      {s.title}
                    </span>
                    {s.shortDesc && (
                      <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-muted">
                        {s.shortDesc}
                      </span>
                    )}
                  </span>
                </Link>

                <button
                  type="button"
                  onClick={() => unsave(s.slug)}
                  aria-label={t("remove")}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition active:scale-90 active:bg-black/5"
                >
                  <BookmarkFilled className="h-[18px] w-[18px] text-accent" />
                </button>
              </article>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
