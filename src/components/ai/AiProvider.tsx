"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { usePathname } from "@/i18n/navigation";
import ToniLauncher from "./ToniLauncher";
import { clearToniChat } from "@/lib/toni-chat-store";

// Das Chat-Sheet ist ein grosses Bündel (Sheet, Markdown, Widgets, Actions) und wird
// von den meisten Besuchern nie geöffnet. Es lädt deshalb erst beim ERSTEN Öffnen
// (hasOpened unten) statt auf jeder Seite im kritischen Pfad. Die Öffnen-Animation
// des Sheets überdeckt die kurze Ladezeit des Chunks.
const AiAssistant = dynamic(() => import("./AiAssistant"), { ssr: false });

// Globaler Zugang zum KI-Sheet: BottomNav & Desktop-Header rufen open() auf.
// Der Login-Status wird client-seitig ermittelt -> das Locale-Layout bleibt
// statisch (kein serverseitiges auth.getUser, das alle Seiten dynamisch machte).
type AiContextValue = {
  open: () => void;
  close: () => void;
  isOpen: boolean;
  // Ein fokussiertes Overlay (aktuell die Spot-Karte auf der Explore-Karte) meldet sich
  // hier an. Toni hält dann seine Sprechblase zurück, statt darüber zu liegen: Beide
  // schweben unten rechts, und die Blase ist bis zu 230px breit -> sie überlappte die
  // Karte auf jeder Desktop-Breite (gemessen bei 768px und 1280px).
  setOverlayOpen: (v: boolean) => void;
};

const AiContext = createContext<AiContextValue | null>(null);

export function useAi(): AiContextValue {
  const ctx = useContext(AiContext);
  if (!ctx) throw new Error("useAi muss innerhalb von <AiProvider> genutzt werden");
  return ctx;
}

export default function AiProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  // Einmal geöffnet = das Sheet bleibt gemountet (Chat-Verlauf überlebt das Schliessen).
  const [hasOpened, setHasOpened] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    // Supabase-Client per await import(): Der ~240-kB-Chunk verlässt den kritischen
    // Pfad und lädt nach der Hydration. Verhalten unverändert (Login-Status + Chat
    // leeren beim Abmelden). alive-Riegel gegen das Rennen Import vs. Unmount.
    let alive = true;
    let unsub: (() => void) | null = null;
    void (async () => {
      const { createClient } = await import("@/lib/supabase/client");
      if (!alive) return;
      const supabase = createClient();
      supabase.auth
        .getUser()
        .then(({ data }) => {
          if (alive) setLoggedIn(!!data.user);
        })
        .catch(() => {});
      const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
        setLoggedIn(!!session?.user);
        // Beim Abmelden den lokalen Chat verwerfen (Privatsphäre auf geteilten Geräten).
        if (event === "SIGNED_OUT") clearToniChat();
      });
      unsub = () => sub.subscription.unsubscribe();
      if (!alive) unsub();
    })();
    return () => {
      alive = false;
      unsub?.();
    };
  }, []);

  // Seitenwechsel schließt den Chat. Er ist ein Overlay ÜBER der aktuellen Seite –
  // bleibt er offen, verdeckt er das Ziel. Sichtbar wurde das beim Login-Gate: Der
  // Button schickt auf /profil, und der Chat lag weiter darüber. Hier statt im Gate,
  // weil es für JEDE Navigation gilt (auch für Links im Chat selbst).
  // React-Muster "State beim Rendern anpassen" (wie EventCard.tsx:76) statt Effekt:
  // greift synchron vor dem Paint (kein kurzes Aufblitzen des Chats auf der neuen
  // Seite) und verstößt nicht gegen react-hooks/set-state-in-effect.
  const pathname = usePathname();
  const [prevPath, setPrevPath] = useState(pathname);
  if (pathname !== prevPath) {
    setPrevPath(pathname);
    setIsOpen(false);
  }

  const open = useCallback(() => {
    setHasOpened(true);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <AiContext.Provider value={{ open, close, isOpen, setOverlayOpen }}>
      {children}
      {hasOpened && <AiAssistant open={isOpen} loggedIn={loggedIn} onClose={close} />}
      <ToniLauncher open={open} isOpen={isOpen} bubbleBlocked={overlayOpen} />
    </AiContext.Provider>
  );
}
