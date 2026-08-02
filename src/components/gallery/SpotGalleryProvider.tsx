"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence } from "framer-motion";
import Lightbox from "./Lightbox";
import type { AiOrigin } from "@/lib/ai-origin";

type GalleryCtx = {
  open: (index: number) => void;
  // KI-Herkunft je Foto, index-gleich zu images (aiOriginsFromMedia in lib/spots.ts).
  // Liegt im Kontext statt an jeder Kachel-Prop: GalleryImage kennt seinen Index schon,
  // damit bekommen Hero und alle Kacheln das KI-Badge automatisch (docs/39 §5).
  aiOrigins?: (AiOrigin | null)[];
};

const Ctx = createContext<GalleryCtx>({ open: () => {} });

// Hook für Trigger (Hero-Bild + Galerie-Kacheln), um den Lightbox zu öffnen.
export function useGalleryOpen() {
  return useContext(Ctx).open;
}

/** KI-Herkunft des Fotos an diesem Galerie-Index (null = ohne KI oder unbekannt). */
export function useGalleryAiOrigin(index: number): AiOrigin | null {
  return useContext(Ctx).aiOrigins?.[index] ?? null;
}

// Stellt den geteilten Lightbox bereit. Umschließt den Spot-Inhalt, damit Hero
// UND Galerie an verschiedenen Stellen im Baum denselben Viewer öffnen können.
export default function SpotGalleryProvider({
  images,
  aiOrigins,
  title,
  children,
}: {
  images: string[];
  aiOrigins?: (AiOrigin | null)[];
  title: string;
  children: ReactNode;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const open = useCallback((i: number) => setOpenIndex(i), []);
  const close = useCallback(() => setOpenIndex(null), []);
  const ctx = useMemo(() => ({ open, aiOrigins }), [open, aiOrigins]);

  return (
    <Ctx.Provider value={ctx}>
      {children}
      <AnimatePresence>
        {openIndex !== null && (
          <Lightbox
            images={images}
            aiOrigins={aiOrigins}
            title={title}
            startIndex={openIndex}
            onClose={close}
          />
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}
