"use client";

import { useRef } from "react";
import type { DragControls } from "framer-motion";

// Der GRIFF eines Bottom-Sheets: alles, was man anfassen kann, um es zu ziehen.
//
// WARUM DAS EIGEN STEHT:
// Ziehen war bisher nur am Balken möglich – ein Streifen von rund 25px Höhe. Den trifft
// man am Handy nicht zuverlässig. In iOS greift man ein Sheet an seiner ganzen Kopfzeile:
// Balken, Titel, Avatar, die freie Fläche daneben. Damit das in allen drei Sheets
// (MobileSheet, SpotSheet, BottomSheet) gleich funktioniert, steht die Logik hier einmal
// statt dreimal leicht verschieden.
//
// DAS EINE PROBLEM DABEI – Knöpfe im Kopf:
// Im Kopf des KI-Chats sitzen "Neuer Chat" und "Verlauf". Startete dort ein Zug, würde
// beim Loslassen zusätzlich der Knopf auslösen: Man zieht das Sheet zu und hat nebenbei
// den Chat gelöscht. Deshalb startet ein Druck auf ein bedienbares Element GAR KEINEN
// Zug – der Knopf gehört dem Knopf. Das kostet nur die zwei kleinen Kreise im Kopf, der
// ganze Rest der Zeile zieht.
//
// Der zweite Griff-Bereich, der Inhalt selbst, sitzt in useBodyDrag: dort muss die Geste
// erst gegen Scrollen abgewogen werden. Hier nicht – der Kopf scrollt nie, also zieht er
// immer, auch wenn der Inhalt darunter schon weit gescrollt ist. Genau dann braucht man
// ihn am dringendsten.

// Was als "bedienbar" gilt. [data-sheet-handle] ist die Hintertür für den umgekehrten
// Fall: ein Element, das zwar bedienbar aussieht, aber trotzdem ziehen soll.
const INTERACTIVE =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="switch"], [role="tab"], [contenteditable="true"]';

function hitsControl(e: React.PointerEvent): boolean {
  const t = e.target;
  if (!(t instanceof Element)) return false;
  const hit = t.closest(INTERACTIVE);
  if (!hit) return false;
  if (hit.closest("[data-sheet-handle]")) return false;
  // Nur was WIRKLICH im Griff liegt: closest() läuft sonst über den Griff hinaus weiter
  // nach oben und fände einen Knopf, der das ganze Sheet umschließt.
  return e.currentTarget.contains(hit);
}

// Weg (px), unter dem ein Druck noch als Tippen zählt. Wie bisher in allen drei Sheets.
const TAP_SLOP = 6;

export function useSheetHandle(dragControls: DragControls, onTap?: () => void) {
  // -1 = dieser Druck gehört einem Knopf, also weder ziehen noch tippen.
  const startY = useRef(-1);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (hitsControl(e)) {
        startY.current = -1;
        return;
      }
      startY.current = e.clientY;
      // Sofort, nicht erst nach ein paar Pixeln: Der Kopf hat keine zweite Bedeutung,
      // um die die Geste konkurrieren müsste. So folgt das Sheet ab dem ersten Pixel.
      dragControls.start(e);
    },
    onPointerUp: (e: React.PointerEvent) => {
      const from = startY.current;
      startY.current = -1;
      if (from < 0 || !onTap) return;
      if (Math.abs(e.clientY - from) < TAP_SLOP) onTap();
    },
    onPointerCancel: () => {
      startY.current = -1;
    },
  };
}
