import { ChevronDown } from "./icons";

// Aufklappbare Zeile im iOS-2026-Stil. EIN Bauteil für alle Ausklapp-Blöcke der App
// (heute „Gut zu wissen", morgen genauso für eine FAQ auf /pro).
//
// WARUM <details> UND KEIN useState:
//   • Der Inhalt steht auch ZUGEKLAPPT im vom Server gelieferten HTML (nachgemessen mit
//     curl, nicht im fertig gerenderten DOM). Google und die KI-Suchen (ChatGPT,
//     Perplexity) lesen ihn also mit — bei einer React-Lösung mit AnimatePresence wäre er
//     schlicht nicht da. Auf einer Seite, die aus lauter Antworten besteht, ist das der
//     ganze Punkt, und schema.org verlangt für eine FAQPage ausdrücklich, dass die
//     Antworten auch sichtbar auf der Seite stehen.
//   • Tastatur, VoiceOver und die Browser-Suche (Strg+F springt in ein zugeklapptes
//     details und öffnet es) funktionieren ohne ein einziges eigenes ARIA-Attribut.
//   • Das Auf- und Zuklappen selbst braucht kein Client-JavaScript. Die Seite bleibt eine
//     Server-Komponente. (Ganz ohne JavaScript ist die App trotzdem nicht bedienbar: Das
//     Auffang-Gerüst auf [locale] ist eine Suspense-Grenze, und die löst der Browser erst
//     mit Nexts Inline-Skript auf. Das gilt für jede Seite und ist hier nicht zu lösen.)
//
// Der Pfeil dreht sich per CSS über den [open]-Zustand des Elternteils
// (`group-open:rotate-180`), nicht über einen State. Dieselbe Regel wie bei
// Handy/Desktop: Was der Browser allein weiss, gehört nicht nach JavaScript.
export default function Disclosure({
  emoji,
  title,
  hint,
  id,
  children,
}: {
  /** Section-Icon (Hausregel: Emoji, siehe CLAUDE.md). */
  emoji: string;
  title: string;
  /** Kurze Stichwortzeile darunter, damit man zugeklappt weiss, was drin ist. */
  hint?: string;
  /** Anker fürs Verlinken einzelner Blöcke (#anreise). */
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <details
      id={id}
      // group: der Pfeil im summary liest den [open]-Zustand von hier.
      // scroll-mt: springt jemand über #anreise hierher, soll die Zeile nicht unter dem
      // fixen Header kleben (dieselbe Rechnung wie --sg-page-top).
      className="group scroll-mt-[var(--sg-page-top)] overflow-hidden rounded-[16px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_30px_-24px_rgba(0,0,0,0.5)]"
    >
      {/* list-none + ::-webkit-details-marker: Safari zeichnet sonst zusätzlich sein
          eigenes graues Dreieck neben unseren Pfeil. */}
      <summary className="sg-hit flex cursor-pointer list-none items-center gap-3 px-4 py-4 transition-colors active:bg-black/[0.03] [&::-webkit-details-marker]:hidden">
        <span className="text-[22px] leading-none" aria-hidden>
          {emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold leading-tight text-ink">{title}</span>
          {hint && (
            <span className="mt-0.5 block truncate text-[13px] leading-tight text-muted">
              {hint}
            </span>
          )}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180" />
      </summary>

      {/* Der Trennstrich sitzt am Inhalt, nicht am summary: Sonst stünde er auch
          zugeklappt unter der Zeile und die Karte sähe aus, als wäre sie offen. */}
      <div className="border-t border-black/[0.06] px-4 pb-5 pt-4">{children}</div>
    </details>
  );
}
