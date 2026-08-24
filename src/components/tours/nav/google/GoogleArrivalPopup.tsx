"use client";

import Image from "next/image";
import { Link } from "@/i18n/navigation";
import BottomSheet from "@/components/BottomSheet";
import StopLockedCard from "@/components/tours/StopLockedCard";
import type { TourStopView } from "@/lib/tour-types";

// ═══ TESTHAKEN – NICHT DAUERHAFT ═══
// Erscheint automatisch bei Ankunft (dasselbe Ankunfts-Ereignis aus bike-nav-core.ts wie
// beim Mapbox-Screen, ArrivalSheet.tsx). ANDERS als dort spielt dieses Popup das Audio NICHT
// selbst ab: Der Auftrag für diesen Test verlangt ausdrücklich, dass ein Klick auf den Button
// in die NORMALE bestehende SalzGuide-Audio-Guide-Ansicht führt (TourView.tsx über
// /touren/[slug]) statt eine zweite Wiedergabe-Oberfläche nachzubauen.
export default function GoogleArrivalPopup({
  open,
  stop,
  tourSlug,
  freeStops,
  totalStops,
  onContinue,
}: {
  open: boolean;
  stop: TourStopView | null;
  tourSlug: string;
  freeStops: number;
  totalStops: number;
  onContinue: () => void;
}) {
  if (!stop) return null;

  return (
    <BottomSheet
      open={open}
      onClose={onContinue}
      variant="floating"
      detents={[0.42, 0.8]}
      title="Angekommen"
    >
      <div className="space-y-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {stop.imageUrl && (
          <div className="relative aspect-[16/10] overflow-hidden rounded-[16px] bg-black/5 shadow-sm">
            <Image
              src={stop.imageUrl}
              alt=""
              fill
              sizes="(min-width: 768px) 27rem, 100vw"
              quality={62}
              className="object-cover"
            />
          </div>
        )}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Stopp {stop.order} von {totalStops}
          </p>
          <h3 className="truncate text-[19px] font-bold leading-tight text-ink">{stop.title}</h3>
        </div>

        {stop.locked ? (
          <StopLockedCard freeStops={freeStops} total={totalStops} />
        ) : (
          <Link
            href={`/touren/${tourSlug}`}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-[15px] font-semibold text-white shadow-md transition active:scale-[0.98]"
          >
            🎧 Audio-Guide öffnen
          </Link>
        )}

        <button
          type="button"
          onClick={onContinue}
          className="flex w-full items-center justify-center rounded-full bg-black/5 px-5 py-3 text-[15px] font-semibold text-ink transition active:scale-[0.98]"
        >
          Weiter zur nächsten Station
        </button>
      </div>
    </BottomSheet>
  );
}
