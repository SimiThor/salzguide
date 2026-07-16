"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { deleteUserTour, type UserTourSummary } from "@/lib/user-tours";
import SavedRouteCard from "./SavedRouteCard";

// Ausblende-Animation identisch zu SavedSpots/SavedEventsList (ein System).
const EXIT = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, scale: 0.94, transition: { duration: 0.18 } },
  transition: { type: "spring" as const, stiffness: 420, damping: 32 },
};

// Besitzt die Liste clientseitig, damit das Entfernen optimistisch + animiert läuft
// (wie beim Un-Merken von Spots). Verschwindet komplett, wenn keine Runde übrig ist.
export default function SavedRoutesList({
  routes,
  title,
}: {
  routes: UserTourSummary[];
  title: string;
}) {
  const [items, setItems] = useState(routes);
  const [, start] = useTransition();

  function remove(id: string) {
    setItems((cur) => cur.filter((r) => r.id !== id)); // optimistisch zuerst
    start(async () => {
      await deleteUserTour(id); // Rückgabe egal; revalidatePath räumt serverseitig auf
    });
  }

  if (items.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <div className="space-y-2.5">
        <AnimatePresence initial={false}>
          {items.map((r) => (
            <motion.div key={r.id} layout {...EXIT}>
              <SavedRouteCard route={r} onRemove={() => remove(r.id)} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
