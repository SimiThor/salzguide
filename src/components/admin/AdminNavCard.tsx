import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";

// Die Kachel, die im Admin eine Unterseite aufmacht: Emoji, Titel, optionaler Status,
// ein Satz Erklärung, Pfeil.
//
// WARUM ES SIE BRAUCHT: Dieselben zwölf Tailwind-Klassen standen acht Mal wortgleich in
// den Seiten (Einstellungen fünf Mal, Nutzer zwei, Events eine) — und ein neuntes Mal
// ganz anders: Die Kachel „Gebiete & Punkte" unter Audio-Touren war dunkel, ohne Emoji,
// ohne Status, mit kleinerer Schrift und einem Pfeil in Weiss. Genau so entstehen
// Abweichungen: Wer eine Kachel braucht, kopiert die nächstbeste, und irgendwann ist die
// nächstbeste selbst schon eine Kopie mit Abweichung. Jetzt gibt es eine Vorlage, und
// eine neue Kachel kann gar nicht mehr anders aussehen.
//
// DER STATUS GEHÖRT MIT AUF DIE KACHEL, nicht erst dahinter: „Wie viele sind offen?" ist
// die einzige Frage, die man von aussen stellt. Muss man dafür hineinklicken, klickt man
// jedes Mal umsonst. Deshalb ist `badge` Teil der Vorlage und keine Ausnahme.

export default function AdminNavCard({
  href,
  emoji,
  title,
  badge,
  description,
}: {
  href: string;
  /** Section-Icon, wie überall im Admin. Rein dekorativ, deshalb aria-hidden. */
  emoji: string;
  title: string;
  /** Optional, aber erwünscht: eine Kapsel aus lib/ui (STATUS_NEUTRAL/STATUS_ACCENT). */
  badge?: ReactNode;
  /** Ein Satz. Was findet man dahinter? */
  description: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 rounded-[18px] bg-white p-5 shadow-sm ring-1 ring-black/5 transition hover:ring-black/15 active:scale-[0.995]"
    >
      <span className="text-[22px]" aria-hidden>
        {emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[17px] font-bold text-ink">{title}</span>
          {badge}
        </span>
        <span className="mt-1 block text-[13px] leading-relaxed text-muted">{description}</span>
      </span>
      <span className="shrink-0 text-[18px] text-muted" aria-hidden>
        ›
      </span>
    </Link>
  );
}
