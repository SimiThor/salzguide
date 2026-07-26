"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import BottomSheet from "@/components/BottomSheet";
import { LoginHeader } from "@/components/auth/LoginPanel";
import type { LoginReason } from "@/components/auth/loginReasons";

// Login-Gate: EIN Overlay für alle Aktionen, die ein Konto brauchen.
//
// Vorher sprang jede solche Aktion sofort auf /profil – mitten aus der Karte heraus,
// ohne Erklärung, und der angefangene Gedanke war weg. Stattdessen hält das Gate kurz
// an, sagt in einem Satz warum, und bietet den Login an.
//
// Baut bewusst auf BottomSheet auf (docs/02 §8 = DAS Overlay des Projekts): mobil ein
// Sheet, am Desktop ein zentriertes Modal, Esc/Klick-außen/Wegwischen schließen – alles
// schon da. Ein eigenes Overlay müsste Drag, Spring, Scroll-Lock und Safe-Area erneut
// bauen und wäre das vierte Overlay-System im Projekt.

// Grund für die Sperre -> bestimmt Emoji und Überschrift. "default" trägt jede Aktion, für
// die es (noch) keinen eigenen Text gibt: Neue Login-pflichtige Stellen funktionieren damit
// SOFORT, ohne dass neun Sprachdateien angefasst werden müssen.
//
// Die Liste selbst steht in loginReasons.ts, weil sie sich der Login-Screen mit dem Gate
// TEILT: Wer hier "Spot merken" liest und weitertippt, liest auf der Loginseite dieselbe
// Überschrift mit demselben Emoji. Ein Weg, nicht zwei Seiten, die dasselbe fragen.
export type { LoginReason };

// Alles, was ein Aufrufer optional mitgeben kann.
type GateOptions = {
  // Wohin es nach dem Login zurückgehen soll, MIT Locale-Präfix (z.B. "/de/spot/x").
  // Ohne Angabe: die aktuelle URL. Nötig, wenn die Seite den Zustand nicht in der URL
  // führt – die Explore-Karte z.B. hält den offenen Spot nur im Client-State, dorthin
  // zurückzukehren zeigte nur die nackte Karte.
  next?: string;
};

type LoginGateValue = {
  // Overlay direkt öffnen (wenn der Aufrufer schon weiß, dass Login fehlt).
  show: (reason?: LoginReason, opts?: GateOptions) => void;
  // Die bequeme Variante: Aktion ausführen und BEIDE Login-Wege abfangen –
  // den Vorab-Check (loggedIn) und die Server-Antwort ({ needLogin: true }).
  // Ohne diese Klammer vergisst der nächste Aufrufer garantiert einen der beiden.
  run: <T extends { needLogin?: boolean }>(
    args: { loggedIn: boolean; reason?: LoginReason } & GateOptions,
    action: () => Promise<T>,
  ) => Promise<T | null>;
};

const Ctx = createContext<LoginGateValue | null>(null);

export function useLoginGate(): LoginGateValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLoginGate muss innerhalb von <LoginGateProvider> genutzt werden");
  return ctx;
}

export default function LoginGateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ reason: LoginReason; next?: string } | null>(null);

  const show = useCallback((reason: LoginReason = "default", opts?: GateOptions) => {
    setState({ reason, next: opts?.next });
  }, []);

  const run = useCallback(
    async <T extends { needLogin?: boolean }>(
      args: { loggedIn: boolean; reason?: LoginReason } & GateOptions,
      action: () => Promise<T>,
    ): Promise<T | null> => {
      if (!args.loggedIn) {
        setState({ reason: args.reason ?? "default", next: args.next });
        return null;
      }
      const res = await action();
      // Zweiter Weg: Der Client hielt sich für eingeloggt, die Session war aber abgelaufen.
      if (res?.needLogin) setState({ reason: args.reason ?? "default", next: args.next });
      return res;
    },
    [],
  );

  return (
    <Ctx.Provider value={{ show, run }}>
      {children}
      <LoginGateSheet state={state} onClose={() => setState(null)} />
    </Ctx.Provider>
  );
}

function LoginGateSheet({
  state,
  onClose,
}: {
  state: { reason: LoginReason; next?: string } | null;
  onClose: () => void;
}) {
  const t = useTranslations("LoginGate");
  const locale = useLocale();
  const router = useRouter();
  const reason = state?.reason ?? "default";

  function goLogin() {
    // Ziel MIT Locale-Präfix: safeNext() auf dem Server verwirft alles andere, und
    // usePathname() aus i18n/navigation liefert den Pfad OHNE Präfix – ein Koreaner
    // landete damit nach dem Login auf Deutsch. window.location trägt ihn bereits.
    const back =
      state?.next ??
      (typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : `/${locale}`);
    onClose();
    // `for` nimmt den Anlass mit auf die Loginseite. Ohne ihn stand dort wieder das
    // allgemeine "Anmelden", und der eben gelesene Satz "Spot merken" war weg — es sah
    // aus, als hätte man die Spur verloren. Fremde Werte fängt safeLoginReason() ab.
    router.push(
      `/profil?next=${encodeURIComponent(back)}&for=${encodeURIComponent(reason)}`,
    );
  }

  return (
    // Ein einziger Detent: Ein Gate hat eine feste Menge Inhalt, es gibt nichts
    // aufzuziehen. BottomSheet macht daraus automatisch "Hochziehen unmöglich,
    // Wegwischen schließt". Modal (nicht floating), weil das Gate über dem bereits
    // offenen Spot-Sheet liegen muss – floating läge auf derselben Ebene.
    //
    // layer="elevated": Das Gate kann über einem anderen Sheet liegen (Merken IM
    // KI-Chat). Ohne das teilen sich beide z-[70], der Backdrop bliebe darunter und zwei
    // cremefarbene Flächen lägen ununterscheidbar aufeinander.
    <BottomSheet open={state != null} onClose={onClose} detents={[0.4]} layer="elevated">
      {/* Derselbe Kopf wie auf der Loginseite (Zeichen, Überschrift, EIN Satz). Darunter nur
          der Knopf – hier ist nichts zu erklären, was das Formular nicht selbst sagt.
          Der frühere Erklärsatz ("Landet in deiner Liste, damit du ihn wiederfindest …")
          ist weg: Wer gerade auf das Lesezeichen getippt hat, weiss, was ein Lesezeichen
          tut. Das Sheet muss nur noch sagen, dass es dafür ein Konto braucht. */}
      <div className="mx-auto flex max-w-[22rem] flex-col px-2 pb-2">
        <LoginHeader reason={reason} />
        <button
          type="button"
          onClick={goLogin}
          className="mt-7 w-full rounded-full bg-accent px-5 py-4 text-[16px] font-semibold text-white shadow-[0_10px_24px_-10px_rgba(204,41,36,0.55)] transition active:scale-[0.98]"
        >
          {t("cta")}
        </button>
      </div>
    </BottomSheet>
  );
}
