"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";
import { trackProGate, type ProGateSurface } from "@/lib/pro-gate-track";

// Zählt einen Pro-Hinweis, der kein Sheet ist, sondern eine ganze Seite: die gesperrte
// Spot-Seite. Die ist eine Server-Komponente und kann selbst nichts im Browser auslösen,
// also steht dort diese leere Client-Komponente und meldet sich beim Einblenden einmal.
export default function ProGateBeacon({ from }: { from: ProGateSurface }) {
  const locale = useLocale();
  useEffect(() => {
    trackProGate(from, locale);
  }, [from, locale]);
  return null;
}
