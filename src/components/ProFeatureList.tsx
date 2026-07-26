"use client";

import { useTranslations } from "next-intl";
import { PRO_FEATURES } from "@/components/proFeatures";

// Die vier Pro-Zeilen, EINMAL gezeichnet. Genutzt von /pro, der Karte auf /profil, dem
// Pro-Hinweis-Sheet und dem Abschnitt auf der Startseite.
//
// WARUM ALS KOMPONENTE UND NICHT NUR ALS DATENLISTE: PRO_FEATURES war schon die eine Quelle
// für Text und Emoji, aber jede der vier Stellen zeichnete ihre eigene Liste — mit eigenen
// Chip-Grössen (40/36/40/40 px), eigenen Abständen und eigenen Schriftgrössen. Vier Kopien
// desselben Musters bedeuten, dass die nächste Feinabstimmung an drei Stellen vergessen
// wird, und dann sieht dasselbe Angebot auf vier Seiten leicht verschieden aus. Jetzt gibt
// es zwei Dichten, und die sind das ganze Zugeständnis an den Ort.
//
// „page" = auf einer Seite (mehr Luft), „sheet" = im Hinweis-Sheet (enger, weil darüber ein
// Foto und darunter ein Knopf steht).

const DENSITY = {
  page: { row: "gap-3.5 py-2", chip: "h-10 w-10 text-[19px]", text: "text-[15px]" },
  sheet: { row: "gap-3 py-1.5", chip: "h-9 w-9 text-[17px]", text: "text-[14px]" },
} as const;

export default function ProFeatureList({
  density = "page",
  className = "",
}: {
  density?: keyof typeof DENSITY;
  className?: string;
}) {
  const t = useTranslations("Pro");
  const d = DENSITY[density];

  return (
    <ul className={className}>
      {PRO_FEATURES.map((f) => (
        <li key={f.key} className={`flex items-center ${d.row}`}>
          <span
            className={`grid shrink-0 place-items-center rounded-full bg-accent/10 ${d.chip}`}
            aria-hidden
          >
            {f.icon}
          </span>
          <span className={`font-medium leading-snug text-ink ${d.text}`}>{t(f.key)}</span>
        </li>
      ))}
    </ul>
  );
}
