"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import Carousel from "@/components/Carousel";
import EventCard from "@/components/EventCard";
import AiSpotSuggestion from "./AiSpotSuggestion";
import AiWaterChips from "./AiWaterChips";
import AiDirectionsWidget from "./AiDirectionsWidget";
import AiWeatherWidget from "./AiWeatherWidget";
import AiOpeningWidget from "./AiOpeningWidget";
import type { AiCards as AiCardsType, SavedApi } from "@/lib/ai-types";

// Karten unter einer Toni-Antwort: passende Spots (horizontales Karussell) +
// echte Events. Reine Wiederverwendung von SpotCard/EventCard -> konsistenter Look.
export default function AiCards({
  cards,
  loggedIn,
  onNavigate,
  saved,
}: {
  cards: AiCardsType;
  loggedIn: boolean;
  onNavigate?: () => void;
  saved?: SavedApi;
}) {
  const t = useTranslations("Explore");
  const router = useRouter();
  const hasSpots = cards.spots.length > 0;
  const hasEvents = cards.events.length > 0;
  const hasWater = (cards.water?.length ?? 0) > 0;
  const hasDirections = Boolean(cards.directions);
  const hasWeather = (cards.weather?.days.length ?? 0) > 0;
  const hasOpening = Boolean(cards.opening);
  if (
    !hasSpots && !hasEvents && !hasWater && !hasDirections && !hasWeather && !hasOpening
  )
    return null;

  // Vertikale Widgets auf Bubble-Breite kappen (einheitlicher Look). Das Spot-
  // Karussell ist bewusst AUSGENOMMEN -> volle Breite, damit die nächste Karte
  // anschneidet und der Scroll-Hinweis erkennbar bleibt.
  const cap = "max-w-[92%]";
  return (
    <div className="mt-2.5 space-y-3">
      {hasDirections && (
        <div className={cap}>
          <AiDirectionsWidget directions={cards.directions!} />
        </div>
      )}
      {hasOpening && (
        <div className={cap}>
          <AiOpeningWidget opening={cards.opening!} onNavigate={onNavigate} />
        </div>
      )}
      {hasWeather && (
        <div className={cap}>
          <AiWeatherWidget weather={cards.weather!} onNavigate={onNavigate} />
        </div>
      )}
      {hasWater && (
        <div className={cap}>
          <AiWaterChips readings={cards.water!} onNavigate={onNavigate} />
        </div>
      )}

      {hasSpots && (
        // Gleiche Carousel-Komponente wie auf der Startseite -> identisches Verhalten
        // & Aussehen: smoothes Scrollen, Snap und Desktop-Pfeil-Buttons. Kleinerer
        // Rand als auf der Startseite, damit die erste Karte links bündig sitzt.
        <Carousel railPadClass="px-1" scrollPadClass="scroll-px-1">
          {cards.spots.map((s) => (
            <AiSpotSuggestion
              key={s.slug}
              spot={s}
              loggedIn={loggedIn}
              onNavigate={onNavigate}
              saved={saved?.spots.has(s.slug) ?? false}
              onSavedChange={saved ? (sv) => saved.onSpot(s.slug, sv) : undefined}
            />
          ))}
        </Carousel>
      )}

      {hasEvents && (
        <div className={`${cap} space-y-2`}>
          {cards.events.map((e) => (
            <EventCard
              key={e.id}
              event={e}
              saved={saved?.events.has(e.id) ?? false}
              loggedIn={loggedIn}
              onSavedChange={saved ? (sv) => saved.onEvent(e.id, sv) : undefined}
              showDate
              onOpen={() => {
                onNavigate?.();
                router.push("/events");
              }}
            />
          ))}
        </div>
      )}

      {/* Attribution/Screenreader-Kontext: diese Vorschläge kommen aus SalzGuide. */}
      <span className="sr-only">{t("more")}</span>
    </div>
  );
}
