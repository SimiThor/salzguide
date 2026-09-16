"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import BottomSheet from "@/components/BottomSheet";
import ProPurchase from "@/components/ProPurchase";
import AudioTransport from "@/components/tours/AudioTransport";
import VoiceDisclosure from "@/components/tours/VoiceDisclosure";
import type { TourAudioApi } from "@/components/tours/useTourAudio";
import type { TourStopView, VoiceInfo } from "@/lib/tour-types";

// Erscheint automatisch, sobald bike-nav-core.ts eine Ankunft meldet. `variant="floating"`
// (BottomSheet.tsx), weil die Karte dahinter scharf & bedienbar bleiben soll – die
// Navigation läuft ja weiter, sobald die Karte geschlossen wird. Audio läuft über
// dieselbe useTourAudio-Instanz wie die Tour-Übersicht (TourView.tsx): dieselbe Regel,
// dieselbe Wiedergabe, kein zweiter Player.
//
// ZWEI FLÄCHEN, NICHT EINE MIT IF: Ein offener Halt ist ein Player, ein gesperrter ist eine
// Kauffläche. Das sind nicht zwei Zustände desselben Blattes, sondern zwei Blätter: Sie
// brauchen eine andere Höhe, einen anderen Kopf und einen anderen Fuß. Solange beides in
// einem Baum stand, bekam die Kauffläche die Masse des Players – und dabei fiel der
// Kauf-Knopf unter die Kante (siehe LockedStopSheet).

// Höhe der Kauffläche eines gesperrten Halts, in Pixeln statt als Anteil (siehe
// LockedStopSheet und `steps` in BottomSheet.tsx). Gemessen, nicht geschätzt: Sie deckt
// Körper und Fuss in der längsten der 13 Sprachen ab. Kleinere Bildschirme deckelt
// BottomSheet auf 94 % der Höhe, dann scrollt der Körper und der Fuss bleibt stehen.
const PURCHASE_SHEET_PX = 520;

export default function ArrivalSheet({
  open,
  stop,
  freeStops,
  totalStops,
  proPrice,
  tourSlug,
  voice,
  audio,
  index,
  total,
  // Steuert der Player GERADE diesen Spot? Nur dann gehören die Wiedergabetasten hierher.
  isCurrent,
  onPlayThis,
  onContinue,
}: {
  open: boolean;
  stop: TourStopView | null;
  freeStops: number;
  totalStops: number;
  /** Preis aus Stripe, serverseitig geholt. Leer = Kauf gerade nicht möglich. */
  proPrice: string;
  /** Slug dieser Runde, damit der Kauf hierher zurückführt statt auf /pro. */
  tourSlug: string;
  /** Stimme der Runde für den Hinweis unter dem Play-Knopf (VoiceDisclosure). */
  voice?: VoiceInfo | null;
  audio: TourAudioApi;
  isCurrent: boolean;
  onPlayThis: () => void;
  index: number;
  total: number;
  onContinue: () => void;
}) {
  if (!stop) return null;
  if (stop.locked)
    return (
      <LockedStopSheet
        open={open}
        stop={stop}
        freeStops={freeStops}
        totalStops={totalStops}
        proPrice={proPrice}
        tourSlug={tourSlug}
        onClose={onContinue}
      />
    );
  return (
    <OpenStopSheet
      open={open}
      stop={stop}
      totalStops={totalStops}
      voice={voice}
      audio={audio}
      index={index}
      total={total}
      isCurrent={isCurrent}
      onPlayThis={onPlayThis}
      onContinue={onContinue}
    />
  );
}

// ── Gesperrter Halt: die Kauffläche ───────────────────────────────────────────────────
//
// Sie ist die kaufnächste Fläche der ganzen App: Der Gast steht vor dem Ort, über den er
// gerade nichts hören darf. Was sie dann darf, ist EINE Frage stellen und EINE Antwort
// anbieten. Alles, was drei Tipps und zwei Bildschirme weit weg ist, verliert sie.
//
// DREI DINGE WAREN VORHER FALSCH (Anton am Handy, 16.09.2026):
//
//  1. Die Höhe war ein Anteil (0,46) und damit auf jedem Gerät eine andere Menge Inhalt.
//     Am iPhone 15 blieb vom Kauf-Knopf ein roter Streifen am unteren Rand stehen – und
//     weil ein Sheet unterhalb seiner obersten Stufe NICHT scrollt (BottomSheet), war er
//     nicht einmal erreichbar. Man musste das Blatt erst aufziehen. Jetzt ist die Höhe in
//     Pixeln angegeben und der Kaufblock steht im FUSS: Der liegt ausserhalb des
//     Scrollbereichs und ist damit sichtbar, egal wie eng es wird und wie lang die Sprache.
//  2. Es standen zwei Überschriften übereinander („Angekommen" als Blatt-Titel, dann
//     „Ab hier geht es mit Pro weiter" in der Karte darunter) und dazwischen noch die Zeile
//     „Stopp 3 von 6". Drei Kopfzeilen vor dem Preis. Jetzt gibt es eine: den Namen des
//     Ortes. Die Nummer steht als Plakette am Bild, wie in der Stopp-Liste.
//  3. „Angekommen" stimmte oft gar nicht: Das Blatt geht auch auf, wenn jemand einen Halt
//     antippt, der 1,7 km weiter liegt.
//
// Der Knopf „Weiter zur nächsten Station" fehlt hier bewusst. Er sass in derselben Grösse
// direkt unter dem Kauf-Knopf und war damit die zweite gleich laute Aufforderung. Der Weg
// hinaus ist der, den jedes iOS-Sheet hat: runterwischen (am Desktop das X im Kopf).
function LockedStopSheet({
  open,
  stop,
  freeStops,
  totalStops,
  proPrice,
  tourSlug,
  onClose,
}: {
  open: boolean;
  stop: TourStopView;
  freeStops: number;
  totalStops: number;
  proPrice: string;
  tourSlug: string;
  onClose: () => void;
}) {
  const t = useTranslations("Tours");
  const tPro = useTranslations("Pro");

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      variant="floating"
      // PIXEL, kein Anteil (PURCHASE_SHEET_PX oben).
      detents={[PURCHASE_SHEET_PX]}
      footer={
        proPrice ? (
          <ProPurchase price={proPrice} returnTour={tourSlug} density="sheet" />
        ) : (
          // Ohne Preis (Stripe nicht erreichbar) bleibt der alte Weg. Besser ein
          // Seitensprung als eine Kauffläche, die keinen Preis nennen kann: § 8 Abs. 1
          // FAGG verlangt ihn unmittelbar vor der Vertragserklärung.
          <Link
            href="/pro"
            className="flex items-center justify-center rounded-full bg-accent px-5 py-4 text-[16px] font-semibold text-white transition active:scale-[0.98]"
          >
            {tPro("cta")}
          </Link>
        )
      }
    >
      {/* Mittig im verbleibenden Platz: Auf einem hohen Bildschirm bleibt über dem Fuss
          Luft übrig, und Luft um den Namen herum ist besser als ein Text, der oben klebt. */}
      <div className="flex min-h-full flex-col items-center justify-center gap-3 text-center">
        <span className="relative shrink-0">
          {stop.imageUrl ? (
            <Image
              src={stop.imageUrl}
              alt=""
              width={60}
              height={60}
              className="h-[60px] w-[60px] rounded-[18px] object-cover"
            />
          ) : (
            <span className="flex h-[60px] w-[60px] items-center justify-center rounded-[18px] bg-black/[0.06] text-[28px]">
              {stop.emoji ?? "🎧"}
            </span>
          )}
          {/* Die Plakette ersetzt die Zeile „Stopp 3 von 6": Welcher Halt es ist, steht
              hier, wie viele es sind, sagt der Satz darunter ohnehin. Dieselbe Plakette
              wie in der Stopp-Liste, damit man denselben Halt wiedererkennt. */}
          <span className="absolute -left-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[12px] font-bold text-cream">
            {stop.order}
          </span>
        </span>

        <h2 className="text-balance text-[20px] font-bold leading-tight text-ink">
          {stop.title}
        </h2>
        {/* Der einzige Erklärsatz, und er beantwortet genau die Frage, die das Schloss
            stellt: Warum hier und nicht vorhin?

            JE SATZ EINE ZEILE, und das ist der ganze Punkt: Vorher stand der Satz in
            einem Stück da und brach, wo die Breite gerade endete. Am iPhone hing
            „alle 6." allein in der zweiten Zeile, auf dem nächsten Gerät woanders
            (Anton, 16.09.2026). Jetzt sind es zwei Kästen, also bricht es an der
            Satzgrenze und auf jedem Bildschirm gleich.

            WARUM NICHT `text-balance`: Das gleicht die Zeilen nur in der BREITE aus und
            kennt keine Sätze. Gemessen brach es „Die ersten 2 Stopps sind / gratis. Mit
            Pro hörst du alle 6." – gleich lange Zeilen, aber der Schnitt mitten im Satz.
            `text-pretty` ändert an dieser Stelle gar nichts (Chrome 152 gemessen).

            WARUM ZWEI BLÖCKE UND NICHT ZWEI `inline-block` MIT LEERZEICHEN DAZWISCHEN:
            Auf Chinesisch passen beide Sätze nebeneinander, und dann stünde dort ein
            Leerzeichen hinter dem 。 – im Chinesischen falsch, weil das Schriftzeichen
            seinen Abstand schon mitbringt. Zwei Blöcke brauchen gar kein Trennzeichen.

            DIE REGEL HAT EINE GRENZE: Sie taugt nur, wo jeder Satz auf eine Zeile passt.
            Der längste ist Ungarisch mit 274 px, die engste Fläche das iPhone SE mit
            280 px. Bei einem längeren Text (z.B. Tours.lockedBody auf der Übersicht)
            würde dieselbe Aufteilung drei Zeilen und einen neuen Ausreisser ergeben; ein
            Fliesstext bleibt deshalb ein Fliesstext. */}
        <p className="max-w-[20rem] text-[13px] leading-snug text-muted">
          <span className="block">🔒 {t("lockedFree", { free: freeStops })}</span>
          <span className="block">{t("lockedAll", { total: totalStops })}</span>
        </p>
      </div>
    </BottomSheet>
  );
}

// ── Offener Halt: der Player ──────────────────────────────────────────────────────────
function OpenStopSheet({
  open,
  stop,
  totalStops,
  voice,
  audio,
  index,
  total,
  isCurrent,
  onPlayThis,
  onContinue,
}: {
  open: boolean;
  stop: TourStopView;
  totalStops: number;
  voice?: VoiceInfo | null;
  audio: TourAudioApi;
  index: number;
  total: number;
  isCurrent: boolean;
  onPlayThis: () => void;
  onContinue: () => void;
}) {
  const t = useTranslations("Tours");
  const canPlay = !!stop.audioUrl;

  return (
    <BottomSheet
      open={open}
      onClose={onContinue}
      variant="floating"
      detents={[0.46, 0.9]}
      title={t("arrivedTitle")}
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
            {t("stopOf", { current: stop.order, total: totalStops })}
          </p>
          <h3 className="truncate text-[19px] font-bold leading-tight text-ink">{stop.title}</h3>
        </div>

        {canPlay ? (
          <div>
            {/* Die Wiedergabetasten nur, wenn der Player auch WIRKLICH auf diesem Spot
                steht. Sonst zeigte das Sheet den einen Ort und steuerte die Geschichte
                eines anderen: Wer während einer laufenden Geschichte ein neues Angebot
                aufklappte, sah den neuen Ort und pausierte mit den Tasten darunter den
                alten. Solange sie auseinanderlaufen, gibt es hier nur einen Knopf, der
                genau diese Geschichte holt. */}
            {isCurrent ? (
              <AudioTransport audio={audio} index={index} total={total} canPlay={canPlay} />
            ) : (
              <button
                type="button"
                onClick={onPlayThis}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-[15px] font-semibold text-white transition active:scale-[0.98]"
              >
                ▶ {t("play")}
              </button>
            )}
            <VoiceDisclosure voice={voice} />
          </div>
        ) : (
          <p className="rounded-[16px] bg-white/70 p-4 text-center text-[13px] text-muted">
            {t("noAudio")}
          </p>
        )}

        <button
          type="button"
          onClick={onContinue}
          className="flex w-full items-center justify-center rounded-full bg-black/5 px-5 py-3 text-[15px] font-semibold text-ink transition active:scale-[0.98]"
        >
          {t("toNextStop")}
        </button>
      </div>
    </BottomSheet>
  );
}
