"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import AiAssistant from "./AiAssistant";
import ToniLauncher from "./ToniLauncher";
import { createClient } from "@/lib/supabase/client";
import { clearToniChat } from "@/lib/toni-chat-store";

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
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => setLoggedIn(!!data.user))
      .catch(() => {});
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setLoggedIn(!!session?.user);
      // Beim Abmelden den lokalen Chat verwerfen (Privatsphäre auf geteilten Geräten).
      if (event === "SIGNED_OUT") clearToniChat();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <AiContext.Provider value={{ open, close, isOpen, setOverlayOpen }}>
      {children}
      <AiAssistant open={isOpen} loggedIn={loggedIn} onClose={close} />
      <ToniLauncher open={open} isOpen={isOpen} bubbleBlocked={overlayOpen} />
    </AiContext.Provider>
  );
}
