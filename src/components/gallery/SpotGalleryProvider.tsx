"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence } from "framer-motion";
import Lightbox from "./Lightbox";

type GalleryCtx = { open: (index: number) => void };

const Ctx = createContext<GalleryCtx>({ open: () => {} });

// Hook für Trigger (Hero-Bild + Galerie-Kacheln), um den Lightbox zu öffnen.
export function useGalleryOpen() {
  return useContext(Ctx).open;
}

// Stellt den geteilten Lightbox bereit. Umschließt den Spot-Inhalt, damit Hero
// UND Galerie an verschiedenen Stellen im Baum denselben Viewer öffnen können.
export default function SpotGalleryProvider({
  images,
  title,
  children,
}: {
  images: string[];
  title: string;
  children: ReactNode;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const open = useCallback((i: number) => setOpenIndex(i), []);
  const close = useCallback(() => setOpenIndex(null), []);

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      <AnimatePresence>
        {openIndex !== null && (
          <Lightbox
            images={images}
            title={title}
            startIndex={openIndex}
            onClose={close}
          />
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}
