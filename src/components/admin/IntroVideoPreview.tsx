"use client";

import { useState } from "react";

// Standbild als Knopf: ein Klick, das Video läuft direkt in der Zeile. Vorher musste man
// eine 14-MB-Datei herunterladen, um zu sehen, was drin ist.
//
// Bewusst der EINGEBAUTE Player des Browsers mit `controls`, keine eigene Lightbox und
// keine eigenen Bedienelemente: Videos bleiben in diesem Projekt beim nativen Vollbild
// (siehe .sg-video in globals.css). Wer gross schauen will, nimmt den Vollbild-Knopf, den
// der Browser ohnehin mitbringt.
//
// Gibt zwei Elemente nebeneinander zurück: das Standbild und (offen) den Player. Die Zeile
// drumherum ist `flex flex-wrap`, der Player trägt `basis-full` und rutscht damit von
// selbst unter die Zeile. So bleibt das Bauteil frei von Annahmen über das Layout.
export default function IntroVideoPreview({
  src,
  poster,
  title,
  className = "",
}: {
  /** Fertiges Video. Fehlt es, bleibt das Standbild ein stilles Bild ohne Knopf. */
  src: string | null;
  poster: string | null;
  title: string;
  /** Grösse des Standbilds, je Liste unterschiedlich. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const thumb = (
    <div className={`overflow-hidden rounded-[10px] bg-black/5 ${className}`}>
      {poster && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" className="h-full w-full object-cover" loading="lazy" />
      )}
    </div>
  );

  if (!src) return thumb;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? `${title}: Video schliessen` : `${title}: Video ansehen`}
        className="cursor-pointer group relative shrink-0 rounded-[10px] transition active:scale-[0.97]"
      >
        {thumb}
        {/* Abspiel-Dreieck über dem Standbild, damit man sieht, dass hier etwas passiert. */}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 backdrop-blur-[2px]">
            {open ? (
              <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6h4v12H6zM14 6h4v12h-4z" fill="#fff" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5.5v13l11-6.5z" fill="#fff" />
              </svg>
            )}
          </span>
        </span>
      </button>

      {open && (
        // order-last, nicht nur basis-full: Im DOM steht der Player direkt hinter seinem
        // Knopf (dorthin gehört er logisch), im Flex-Layout muss er aber ans ENDE der
        // Zeile. Ohne das schiebt er Titel und Aktionsknopf unter sich, weil basis-full
        // schon nach dem Standbild umbricht. Gemessen: 0px Versatz für den Rest der Zeile.
        <div className="order-last mt-3 basis-full">
          <video
            src={src}
            poster={poster ?? undefined}
            controls
            autoPlay
            // Stumm, weil das Intro ohnehin keinen Ton hat: Nur so darf Autoplay überhaupt
            // starten, sonst blockt der Browser und man sieht ein totes Standbild.
            muted
            loop
            playsInline
            preload="metadata"
            className="mx-auto max-h-[70vh] w-auto rounded-[12px] bg-black"
          />
        </div>
      )}
    </>
  );
}
