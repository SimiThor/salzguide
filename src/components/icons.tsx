import type { ReactNode } from "react";

// Schlankes Apple-Style-Line-Icon-Set (24er-Grid, stroke=currentColor).
// Farbe über Tailwind-Textfarbe (z.B. text-accent), Größe über className.
type IconProps = { className?: string };

function Line({
  children,
  className = "h-5 w-5",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const ChevronLeft = ({ className }: IconProps) => (
  <Line className={className}>
    <path d="m15 18-6-6 6-6" />
  </Line>
);

export const ChevronRight = ({ className }: IconProps) => (
  <Line className={className}>
    <path d="m9 18 6-6-6-6" />
  </Line>
);

// Dreieck-Schwerpunkt liegt exakt im viewBox-Zentrum (12,12) -> optisch mittig im
// runden Button, ganz ohne Margin-Hack. Runde Ecken via Stroke-Linejoin.
export const Play = ({ className = "h-6 w-6" }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinejoin="round"
    strokeLinecap="round"
    aria-hidden
  >
    <path d="M8.5 6 L19 12 L8.5 18 Z" />
  </svg>
);

export const Pause = ({ className = "h-6 w-6" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <rect x="6.5" y="5" width="4" height="14" rx="1.3" />
    <rect x="13.5" y="5" width="4" height="14" rx="1.3" />
  </svg>
);

export const Bookmark = ({ className }: IconProps) => (
  <Line className={className}>
    <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3.6L6 21z" />
  </Line>
);

export const BookmarkFilled = ({ className = "h-5 w-5" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3.6L6 21z" />
  </svg>
);

export const Gauge = ({ className }: IconProps) => (
  <Line className={className}>
    <path d="M5 17a7 7 0 1 1 14 0" />
    <path d="M12 17l3.4-4.4" />
    <circle cx="12" cy="17" r="1" />
  </Line>
);

export const Sun = ({ className }: IconProps) => (
  <Line className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="M5 5l1.5 1.5" />
    <path d="M17.5 17.5 19 19" />
    <path d="M19 5l-1.5 1.5" />
    <path d="M6.5 17.5 5 19" />
  </Line>
);

export const Bus = ({ className }: IconProps) => (
  <Line className={className}>
    <rect x="4" y="5" width="16" height="10" rx="2" />
    <path d="M4 10h16" />
    <circle cx="8" cy="18" r="1.4" />
    <circle cx="16" cy="18" r="1.4" />
  </Line>
);

export const Car = ({ className }: IconProps) => (
  <Line className={className}>
    <path d="M6 16a1 1 0 0 1-1-1v-2.5l1.7-4.1A2 2 0 0 1 8.6 7h6.8a2 2 0 0 1 1.9 1.4L19 12.5V15a1 1 0 0 1-1 1" />
    <path d="M5 12.5h14" />
    <circle cx="8" cy="16.5" r="1.4" />
    <circle cx="16" cy="16.5" r="1.4" />
  </Line>
);

export const Phone = ({ className }: IconProps) => (
  <Line className={className}>
    <path d="M6.8 4H4.6A1.6 1.6 0 0 0 3 5.7 15.8 15.8 0 0 0 18.3 21a1.6 1.6 0 0 0 1.7-1.6v-2.1a1 1 0 0 0-.8-1l-2.9-.6a1 1 0 0 0-1 .3l-.9.9a12.2 12.2 0 0 1-5.3-5.3l.9-.9a1 1 0 0 0 .3-1l-.6-2.9a1 1 0 0 0-1-.8z" />
  </Line>
);

export const Globe = ({ className }: IconProps) => (
  <Line className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18" />
    <path d="M12 3a14 14 0 0 0 0 18" />
  </Line>
);

export const Ticket = ({ className }: IconProps) => (
  <Line className={className}>
    <path d="M4 9V7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a2 2 0 0 0 0 4v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a2 2 0 0 0 0-4z" />
    <path d="M14 6.5v11" strokeDasharray="2 2.5" />
  </Line>
);

export const ForkKnife = ({ className }: IconProps) => (
  <Line className={className}>
    <path d="M7 3v5a1.5 1.5 0 0 0 3 0V3" />
    <path d="M8.5 8v13" />
    <path d="M16 3c-1.4 1-2.3 3.3-2.3 6 0 1.8 1 2.8 2.3 2.8V21" />
  </Line>
);

export const Tag = ({ className }: IconProps) => (
  <Line className={className}>
    <path d="M20 12.6 12.6 20a1.8 1.8 0 0 1-2.5 0l-6-6A1.8 1.8 0 0 1 3.5 12.7V6a2 2 0 0 1 2-2h6.6a1.8 1.8 0 0 1 1.3.5l6.6 6.6a1.8 1.8 0 0 1 0 2.5z" />
    <circle cx="8" cy="8" r="1.2" />
  </Line>
);

export const MapPin = ({ className }: IconProps) => (
  <Line className={className}>
    <path d="M12 21s7-5.5 7-11a7 7 0 0 0-14 0c0 5.5 7 11 7 11z" />
    <circle cx="12" cy="10" r="2.5" />
  </Line>
);

export const Star = ({ className }: IconProps) => (
  <Line className={className}>
    <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 16.9l-5.2 2.62.99-5.8-4.21-4.1 5.82-.85z" />
  </Line>
);

// --- Marken-Glyphen (Instagram, TikTok) ---
//
// Diese zwei folgen NICHT unserem Stil, und das ist Absicht: Ein Marken-Glyph ist
// vorgegeben. Wer ihn „schöner" nachzeichnet, macht ihn unerkennbar, und erkennbar ist
// hier die ganze Aufgabe. Einfarbig (currentColor) ist bei beiden Marken ausdrücklich
// erlaubt, umfärben oder verzerren nicht.
//
// Instagram ist von Natur aus eine Linie und passt damit zum Set. TikTok ist eine Fläche.
// Damit die beiden nebeneinander GLEICH GROSS wirken, ist der TikTok-Pfad in den gleichen
// optischen Kasten gerechnet, in dem der Instagram-Glyph liegt (3..21 im 24er-Grid): Der
// Rohpfad füllt 0..24, also 24 Einheiten, gebraucht sind 18. Zusätzlich eine Spur kleiner
// (0.74 statt 0.75), weil eine gefüllte Form bei gleicher Grösse schwerer wirkt als eine
// gezeichnete.
export const Instagram = ({ className }: IconProps) => (
  <Line className={className}>
    <rect x="3" y="3" width="18" height="18" rx="5.2" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.1" cy="6.9" r="1.05" fill="currentColor" stroke="none" />
  </Line>
);

export const TikTok = ({ className = "h-5 w-5" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <g transform="translate(3.1 3.1) scale(0.74)">
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </g>
  </svg>
);

// --- BottomNav (Apple/Airbnb-Stil) ---
export const Compass = ({ className }: IconProps) => (
  <Line className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M14.9 9.1 13.1 13l-4 1.9L11 11z" />
  </Line>
);

export const Sparkles = ({ className }: IconProps) => (
  <Line className={className}>
    <path d="M12 3.2l1.7 4.6 4.6 1.7-4.6 1.7L12 15.8l-1.7-4.6L5.7 9.5l4.6-1.7z" />
    <path d="M18.6 14.6l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" />
  </Line>
);

export const User = ({ className }: IconProps) => (
  <Line className={className}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  </Line>
);
