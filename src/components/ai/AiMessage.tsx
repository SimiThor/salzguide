"use client";

import { Fragment, type ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import AiCards from "./AiCards";
import type { AiUiMessage, SavedApi } from "@/lib/ai-types";

// Sicheres Mini-Markdown: NUR [Label](url), **fett** und Zeilenumbrüche werden zu
// React-Knoten (kein dangerouslySetInnerHTML -> keine HTML-Injection aus KI-Text).
// Interne /spot- und /events-Links werden zu locale-bewussten <Link>s.
function renderInline(
  text: string,
  keyPrefix: string,
  onNavigate?: () => void,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const label = m[1];
      const url = m[2];
      // Nur Ziele, für die der Server geradesteht. Der eigentliche Riegel sitzt in
      // lib/ai-links.ts und läuft schon serverseitig; das hier ist der zweite,
      // unabhängige. Beide fallen auf dieselbe sichere Seite: unbekanntes Ziel ->
      // die Beschriftung als normaler Text, kein klickbarer Link.
      //
      // Der Zweig für externe https-Adressen ist am 11.08.2026 ENTFALLEN. Er rendert
      // eine fremde Adresse als fetten, rot unterstrichenen Link mitten in einer
      // SalzGuide-Antwort, und die sieht damit aus wie von uns. Wer ihn wieder
      // braucht, baut ihn NICHT hier ein, sondern erweitert die Erlaubnis-Liste in
      // lib/ai-links.ts — sonst gibt es die Entscheidung an zwei Stellen.
      if (/^\/spot\/[a-z0-9-]+$/.test(url) || url === "/wasser") {
        nodes.push(
          <Link
            key={`${keyPrefix}-l${i}`}
            href={url}
            onClick={onNavigate}
            className="font-semibold text-accent underline decoration-accent/40 underline-offset-2"
          >
            {label}
          </Link>,
        );
      } else {
        nodes.push(label);
      }
    } else if (m[3] !== undefined) {
      // Fett kann selbst einen Link enthalten (das Modell hebt die Top-Empfehlung gern
      // als **[Titel](/spot/slug)** hervor). Ohne diese Rekursion schluckt der Fett-Zweig
      // den Link und [Titel](/spot/slug) stünde roh im Chat-Text.
      nodes.push(
        <strong key={`${keyPrefix}-b${i}`}>
          {renderInline(m[3], `${keyPrefix}-b${i}`, onNavigate)}
        </strong>,
      );
    }
    last = regex.lastIndex;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function RichText({
  text,
  onNavigate,
}: {
  text: string;
  onNavigate?: () => void;
}) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, idx) => (
        <Fragment key={idx}>
          {idx > 0 && <br />}
          {renderInline(line, `l${idx}`, onNavigate)}
        </Fragment>
      ))}
    </>
  );
}

export default function AiMessage({
  message,
  loggedIn,
  onNavigate,
  saved,
}: {
  message: AiUiMessage;
  loggedIn: boolean;
  onNavigate?: () => void;
  saved?: SavedApi;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-[18px] rounded-br-md bg-accent px-4 py-3 text-[15px] leading-relaxed text-white">
          {message.text}
        </div>
      </div>
    );
  }

  return (
    // data-ai-generated: maschinenlesbare Kennzeichnung der KI-Antwort im DOM
    // (Art. 50 Abs. 2 KI-VO, Metadaten-Ansatz; Gegenstück zum aiGenerated-Feld
    // der Chat-API). Einstufung: docs/39_RECHT_KI-Transparenz.md.
    <div className="flex flex-col items-start" data-ai-generated="true">
      <div className="max-w-[92%] rounded-[18px] rounded-bl-md bg-white px-4 py-3 text-[15px] leading-relaxed text-ink shadow-sm ring-1 ring-black/[0.04]">
        <RichText text={message.text} onNavigate={onNavigate} />
      </div>
      {/* Volle Breite: die Kappung auf Bubble-Breite passiert je Widget in AiCards –
          so bleibt das Spot-Karussell voll breit (nächste Karte schaut an). */}
      <div className="w-full min-w-0">
        <AiCards
          cards={message.cards}
          loggedIn={loggedIn}
          onNavigate={onNavigate}
          saved={saved}
        />
      </div>
    </div>
  );
}
