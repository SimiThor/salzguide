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
      if (
        url.startsWith("/spot/") ||
        url.startsWith("/events") ||
        url.startsWith("/wasser")
      ) {
        const href = url.startsWith("/events") ? "/events" : url;
        nodes.push(
          <Link
            key={`${keyPrefix}-l${i}`}
            href={href}
            onClick={onNavigate}
            className="font-semibold text-accent underline decoration-accent/40 underline-offset-2"
          >
            {label}
          </Link>,
        );
      } else if (/^https?:\/\//.test(url)) {
        nodes.push(
          <a
            key={`${keyPrefix}-a${i}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-accent underline underline-offset-2"
          >
            {label}
          </a>,
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
    <div className="flex flex-col items-start">
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
