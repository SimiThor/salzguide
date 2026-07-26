"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import BottomSheet from "@/components/BottomSheet";
import LockedMedia from "@/components/LockedMedia";
import { ProWordmark } from "@/components/ProBadge";
import { PRO_FEATURES } from "@/components/proFeatures";

// Pro-Gate: EIN Hinweis für jede Stelle, an der jemand einen gesperrten Pro-Inhalt antippt.
//
// WARUM ES DAS GIBT: Im Regal „Ähnliche Spots" steckte die gesperrte Karte in einem nackten
// <div> – anfassbar, aber ohne jede Reaktion. Dabei ist der Tipp auf einen Geheimtipp die
// deutlichste Kaufabsicht, die es in dieser App gibt („den will ich sehen"), und genau die
// verpuffte. Jetzt beantwortet der Tipp die Frage, die er stellt.
//
// WARUM EIN SHEET UND KEIN SEITENSPRUNG: Gesperrte Spots haben serverseitig gar keinen
// echten Slug (lib/spots.ts vergibt `locked-<i>`), es gibt also kein Ziel zum Hinspringen.
// Und selbst wenn: Wer gerade eine Spot-Seite liest, soll dort bleiben. Das Sheet ist
// dieselbe Bewegung, die die Karte beim Tippen auf einen Pro-Pin schon macht (SpotSheet).
//
// WARUM APP-WEIT WIE DAS LOGIN-GATE: Sonst bräuchte jede gesperrte Karte ihr eigenes Sheet
// – acht Karten im Regal wären acht Overlays im DOM. So liegt EINES da, und jede künftige
// gesperrte Stelle (Startseite, Touren, KI-Chat) ruft dieselben zwei Zeilen auf.
//
// ALLE TEXTE AUS DEM „Pro"-NAMESPACE: dieselben Sätze wie auf /pro und in der Karte auf
// /profil. Kein einziger neuer Schlüssel in neun Sprachdateien, und der Hinweis sagt
// überall dasselbe – wer ihn hier liest, findet auf /pro genau das wieder.

type ProGateSpot = {
  // Blur-Vorschau des angetippten Spots (data:/URL). Das Motiv IST das Verkaufsargument –
  // ohne Bild wäre es ein Textkasten über Pro statt „dieser Ort hier".
  previewUrl?: string | null;
  emoji?: string | null;
  // „🤫 Geheimtipp" in der Sprache der Aufrufstelle. Optional: Die Aufrufstelle kennt ihren
  // eigenen Namespace (Detail/Explore), das Gate muss ihn nicht raten.
  label?: string;
};

type ProGateValue = {
  // Hinweis öffnen. Ohne Spot-Daten zeigt er dieselbe Fläche ohne Foto.
  show: (spot?: ProGateSpot) => void;
};

const Ctx = createContext<ProGateValue | null>(null);

export function useProGate(): ProGateValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProGate muss innerhalb von <ProGateProvider> genutzt werden");
  return ctx;
}

export default function ProGateProvider({ children }: { children: ReactNode }) {
  // ZWEI Zustände und nicht einer: `open` steuert die Bewegung, `spot` den Inhalt. Stünde
  // beides in einem `spot | null`, wäre das Foto im Moment des Schließens weg und das Sheet
  // führe eine halbe Sekunde lang als leere Fläche nach unten.
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState<ProGateSpot>({});
  const pathname = usePathname();

  const show = useCallback((s?: ProGateSpot) => {
    setSpot(s ?? {});
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  // Seitenwechsel schließt. Der Knopf im Sheet macht das selbst, aber es gibt Wege, die er
  // nicht kennt (Zurück-Geste, Tab-Leiste). Ein Sheet, das den Seitenwechsel überlebt,
  // stünde auf der neuen Seite ohne Anlass da – und sperrt dabei das Scrollen.
  //
  // Im Render und nicht im Effekt: „State an eine geänderte Prop anpassen" ist genau der
  // Fall, für den React das empfiehlt – dieselbe Form wie in BottomSheet.tsx. Aus einem
  // Effekt heraus wäre es eine zweite Render-Runde, in der das Sheet auf der neuen Seite
  // schon einmal offen dastünde.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <ProGateSheet open={open} spot={spot} onClose={close} />
    </Ctx.Provider>
  );
}

function ProGateSheet({
  open,
  spot,
  onClose,
}: {
  open: boolean;
  spot: ProGateSpot;
  onClose: () => void;
}) {
  const t = useTranslations("Pro");

  return (
    // EIN Detent: Der Hinweis hat eine feste Menge Inhalt, es gibt nichts aufzuziehen.
    // BottomSheet macht daraus „Hochziehen unmöglich, Runterwischen schließt" (wie das
    // Login-Gate und der Sprachwähler).
    //
    // 0.72 ist am iPhone 15 (844px) genau die Höhe, in die der Inhalt ohne Scrollen passt.
    // Wird er in einer Sprache länger oder der Bildschirm kleiner (SE), scrollt der Körper –
    // deshalb steht der Knopf im FOOTER: Der liegt außerhalb des Scrollbereichs und ist
    // damit sichtbar, egal wie eng es wird. Ein Angebot, dessen Knopf man erst suchen muss,
    // ist keines.
    <BottomSheet
      open={open}
      onClose={onClose}
      detents={[0.72]}
      footer={
        <>
          <Link
            href="/pro"
            onClick={onClose}
            className="block w-full rounded-full bg-accent px-5 py-4 text-center text-[16px] font-semibold text-white shadow-[0_10px_24px_-10px_rgba(204,41,36,0.55)] transition active:scale-[0.98]"
          >
            {t("cta")}
          </Link>
          {/* „einmalig · kein Abo" direkt unter dem Knopf: Das ist der Einwand, der die
              meisten Finger in der Sekunde davor anhält. */}
          <p className="mt-2.5 text-center text-[12px] text-muted/80">{t("oneTime")}</p>
        </>
      }
    >
      <div className="mx-auto flex max-w-[22rem] flex-col">
        {/* Dasselbe Bild, das auf der Karte gesperrt war – nur größer. Das Abzeichen darf
            hier stehen (anders als im SpotSheet): Die Überschrift darunter ist die
            Wortmarke, nicht noch einmal „Geheimtipp". */}
        <LockedMedia
          previewUrl={spot.previewUrl ?? null}
          emoji={spot.emoji}
          label={spot.label}
          eager
          className="h-[116px] w-full shrink-0 rounded-[18px]"
        />

        <div className="mt-4 shrink-0 text-center">
          <ProWordmark name={t("title")} className="text-[17px]" />
          <p className="mx-auto mt-2 max-w-[20rem] text-[15px] leading-relaxed text-muted">
            {t("subtitle")}
          </p>
        </div>

        {/* Dieselben vier Zeilen wie auf /pro und /profil (PRO_FEATURES ist die eine
            Quelle) – nur kompakter, weil hier ein Sheet steht und keine Seite. */}
        <ul className="mt-4 shrink-0">
          {PRO_FEATURES.map((f) => (
            <li key={f.key} className="flex items-center gap-3 py-1.5">
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/10 text-[17px]"
                aria-hidden
              >
                {f.icon}
              </span>
              <span className="text-[14px] font-medium leading-snug text-ink">{t(f.key)}</span>
            </li>
          ))}
        </ul>
      </div>
    </BottomSheet>
  );
}
