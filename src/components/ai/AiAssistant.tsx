"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { bcp47 } from "@/i18n/locales";
import BottomSheet from "@/components/BottomSheet";
import AiMessage from "./AiMessage";
import ToniAvatar from "./ToniAvatar";
import ThinkingIndicator, { PlayfulDots } from "./ThinkingIndicator";
import {
  loadAiHistory,
  listAiConversations,
  loadAiConversation,
  type AiConversationMeta,
} from "@/lib/ai-actions";
import { getSavedSets } from "@/lib/saved-state-actions";
import { readToniChat, writeToniChat, clearToniChat } from "@/lib/toni-chat-store";
import type { AiCards, AiUiMessage, SavedApi } from "@/lib/ai-types";

const MAX_INPUT = 800; // spiegelt das Server-Limit
const emptyCards = (): AiCards => ({ spots: [], events: [] });

// Mood-Pills (docs/16 §2): jede Pill = vorformulierter Wunsch, sofort abgeschickt.
const PILLS: { key: string; emoji: string }[] = [
  { key: "coffee", emoji: "☕️" },
  { key: "swim", emoji: "💦" },
  { key: "sunset", emoji: "🌅" },
  { key: "hike", emoji: "🥾" },
  { key: "weekend", emoji: "🎉" },
  { key: "rain", emoji: "🌧️" },
];

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 20V5M12 5l-6 6M12 5l6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function NewChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}
function HistoryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export default function AiAssistant({
  open,
  loggedIn,
  onClose,
}: {
  open: boolean;
  loggedIn: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("Ai");
  const locale = useLocale();
  const pathname = usePathname(); // locale-frei, z.B. "/spot/hochkeil" -> Seiten-Kontext für Toni

  const [messages, setMessages] = useState<AiUiMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<null | "guest" | "free">(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [ready, setReady] = useState(false); // Erst-Hydrierung erledigt -> kein Greeting-Flackern
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<AiConversationMeta[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Echter Merk-Status (Spot-slugs + Event-IDs) -> Karten zeigen ihn korrekt an,
  // auch nach Schließen/Wieder-Öffnen. Wird beim Öffnen frisch geladen.
  const [savedSpots, setSavedSpots] = useState<Set<string>>(new Set());
  const [savedEvents, setSavedEvents] = useState<Set<string>>(new Set());

  const hydratedLocalRef = useRef(false);
  const serverLoadedRef = useRef(false);
  const firstScrollDone = useRef(false);
  const messagesRef = useRef<AiUiMessage[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // 1) SOFORT aus dem lokalen Speicher hydrieren (kein Netzwerk) -> beim Wieder-
  //    Öffnen ist der Chat da, ohne Flackern. Läuft beim ersten Öffnen.
  useEffect(() => {
    if (!open || hydratedLocalRef.current) return;
    hydratedLocalRef.current = true;
    // Über eine Microtask-Grenze -> kein synchrones setState im Effekt-Body
    // (verhindert Kaskaden-Renders). Läuft vor dem Paint -> kein Flackern.
    void Promise.resolve().then(() => {
      const local = readToniChat();
      if (local && local.messages.length) {
        setMessages(local.messages);
        setConversationId(local.conversationId);
      }
      setReady(true);
    });
  }, [open]);

  // 2) Für eingeloggte User den Server-Verlauf nachladen – aber nur, wenn lokal
  //    noch nichts da war (kein Überschreiben eines aktiven Chats).
  useEffect(() => {
    if (!open || !loggedIn || serverLoadedRef.current) return;
    serverLoadedRef.current = true;
    if (messagesRef.current.length > 0) return;
    loadAiHistory()
      .then((h) => {
        if (h && h.messages.length && messagesRef.current.length === 0) {
          setMessages(h.messages);
          setConversationId(h.conversationId);
        }
      })
      .catch(() => {});
  }, [open, loggedIn]);

  // Echten Merk-Status beim Öffnen (und bei Login-Wechsel) frisch laden.
  useEffect(() => {
    if (!open || !loggedIn) return;
    let cancelled = false;
    getSavedSets()
      .then(({ spots, events }) => {
        if (cancelled) return;
        setSavedSpots(new Set(spots));
        setSavedEvents(new Set(events));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, loggedIn]);

  const markSpotSaved = useCallback((slug: string, saved: boolean) => {
    setSavedSpots((prev) => {
      const n = new Set(prev);
      if (saved) n.add(slug);
      else n.delete(slug);
      return n;
    });
  }, []);
  const markEventSaved = useCallback((id: string, saved: boolean) => {
    setSavedEvents((prev) => {
      const n = new Set(prev);
      if (saved) n.add(id);
      else n.delete(id);
      return n;
    });
  }, []);
  const savedApi = useMemo<SavedApi>(
    () => ({ spots: savedSpots, events: savedEvents, onSpot: markSpotSaved, onEvent: markEventSaved }),
    [savedSpots, savedEvents, markSpotSaved, markEventSaved],
  );

  // Aktuellen Chat lokal sichern (nach der Hydrierung). Leer -> löschen.
  useEffect(() => {
    if (!ready) return;
    if (messages.length) writeToniChat({ conversationId, messages });
    else clearToniChat();
  }, [messages, conversationId, ready]);

  // Ans Ende scrollen. Erster Scroll (Hydrierung/Chatwechsel) SOFORT (kein sicht-
  // bares Runterrasen); danach sanft für neue Nachrichten.
  useEffect(() => {
    if (showHistory) return;
    const behavior = firstScrollDone.current ? "smooth" : "auto";
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
    firstScrollDone.current = true;
  }, [messages, pending, paywall, showHistory]);

  // Beim (Wieder-)Öffnen sofort ans Ende – auf Desktop remountet der Sheet-Inhalt,
  // daher würde die Scroll-Position sonst oben stehen.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: "end" }));
  }, [open]);

  const growTextarea = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, []);

  const startNewChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setInput("");
    setError(null);
    setPaywall(null);
    setShowHistory(false);
    clearToniChat();
    firstScrollDone.current = false;
  }, []);

  const openHistory = useCallback(() => {
    setShowHistory(true);
    setHistoryLoading(true);
    listAiConversations()
      .then(setConversations)
      .catch(() => setConversations([]))
      .finally(() => setHistoryLoading(false));
  }, []);

  const selectConversation = useCallback((id: string) => {
    setShowHistory(false);
    setPaywall(null);
    setError(null);
    firstScrollDone.current = false;
    loadAiConversation(id)
      .then((h) => {
        if (h) {
          setMessages(h.messages);
          setConversationId(h.conversationId);
        }
      })
      .catch(() => {});
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim().slice(0, MAX_INPUT);
      if (!text || pending) return;

      const prev = messages;
      const userMsg: AiUiMessage = { role: "user", text, cards: emptyCards() };
      const next = [...prev, userMsg];
      setMessages(next);
      setInput("");
      setError(null);
      setPending(true);
      requestAnimationFrame(growTextarea);

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: next.map((m) => ({ role: m.role, content: m.text })),
            conversationId,
            locale,
            page: pathname,
          }),
        });

        if (res.status === 402) {
          const j = (await res.json().catch(() => ({}))) as { scope?: string };
          setMessages(prev); // optimistische User-Nachricht zurücknehmen
          setInput(text); // Text zurückgeben, damit nach Login erneut sendbar
          setPaywall(j.scope === "guest" ? "guest" : "free");
          return;
        }
        if (!res.ok) {
          setMessages(prev);
          setInput(text);
          setError(t("error"));
          return;
        }

        const j = (await res.json()) as {
          text: string;
          cards?: AiUiMessage["cards"];
          conversationId?: string | null;
        };
        setMessages([
          ...next,
          { role: "assistant", text: j.text, cards: j.cards ?? emptyCards() },
        ]);
        if (j.conversationId) setConversationId(j.conversationId);
      } catch {
        setMessages(prev);
        setInput(text);
        setError(t("error"));
      } finally {
        setPending(false);
      }
    },
    [messages, pending, conversationId, locale, pathname, t, growTextarea],
  );

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  const isEmpty = messages.length === 0;
  const canReset = messages.length > 0 || showHistory;

  // ── Header: Toni-Identität (Avatar + Name + „KI-Local") + Aktionen ──────────
  const header = (
    <div className="flex items-center gap-2.5">
      <ToniAvatar size={38} />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-[15px] font-semibold text-ink">{t("title")}</p>
        <p className="truncate text-[11px] text-muted">{t("subtitle")}</p>
      </div>
      <button
        type="button"
        onClick={startNewChat}
        disabled={!canReset && !input}
        aria-label={t("newChat")}
        title={t("newChat")}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-black/5 active:scale-90 disabled:opacity-40"
      >
        <NewChatIcon />
      </button>
      {loggedIn && (
        <button
          type="button"
          onClick={showHistory ? () => setShowHistory(false) : openHistory}
          aria-label={t("history")}
          title={t("history")}
          aria-pressed={showHistory}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition hover:bg-black/5 active:scale-90 ${
            showHistory ? "text-accent" : "text-muted"
          }`}
        >
          <HistoryIcon />
        </button>
      )}
    </div>
  );

  // ── Footer: Eingabe bzw. Paywall + KI-Hinweis ───────────────────────────────
  const footer = paywall ? (
    <div className="rounded-[16px] bg-white p-4 text-center shadow-sm ring-1 ring-black/[0.04]">
      <p className="text-[15px] font-semibold text-ink">
        {t(paywall === "guest" ? "paywallGuestTitle" : "paywallProTitle")}
      </p>
      <p className="mt-1 text-[13px] text-muted">
        {t(paywall === "guest" ? "paywallGuestBody" : "paywallProBody")}
      </p>
      <Link
        href={paywall === "guest" ? "/profil" : "/pro"}
        onClick={onClose}
        className="mt-3 inline-block rounded-full bg-accent px-5 py-2 text-[14px] font-semibold text-white active:scale-95"
      >
        {t(paywall === "guest" ? "paywallGuestCta" : "paywallProCta")}
      </Link>
    </div>
  ) : (
    <>
      <div className="flex items-end gap-2">
        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value.slice(0, MAX_INPUT));
            growTextarea();
          }}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={t("placeholder")}
          aria-label={t("placeholder")}
          className="max-h-[140px] flex-1 resize-none rounded-[18px] bg-white px-4 py-2.5 text-[15px] text-ink shadow-sm outline-none ring-1 ring-black/[0.06] placeholder:text-muted/70 focus:ring-accent/30"
        />
        <button
          type="button"
          onClick={() => void send(input)}
          disabled={!input.trim() || pending}
          aria-label={t("send")}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white transition active:scale-90 disabled:opacity-40"
        >
          <SendIcon />
        </button>
      </div>
      <p className="mt-1.5 px-1 text-[11px] leading-snug text-muted/80">{t("disclaimer")}</p>
    </>
  );

  // ── Body ────────────────────────────────────────────────────────────────────
  const body = showHistory ? (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-ink">{t("historyTitle")}</h3>
        <button
          type="button"
          onClick={() => setShowHistory(false)}
          className="rounded-full px-3 py-1 text-[13px] font-medium text-muted transition hover:bg-black/5"
        >
          {t("back")}
        </button>
      </div>
      {historyLoading ? (
        <div className="flex justify-center py-8">
          <PlayfulDots />
        </div>
      ) : conversations.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted">{t("historyEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => selectConversation(c.id)}
                className="w-full rounded-[14px] bg-white px-3.5 py-3 text-left shadow-sm ring-1 ring-black/[0.04] transition active:scale-[0.99]"
              >
                <p className="truncate text-[14px] font-medium text-ink">{c.title}</p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {new Date(c.updatedAt).toLocaleDateString(bcp47(locale), {
                    day: "numeric",
                    month: "short",
                  })}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  ) : (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-4">
        {!ready ? (
          <div className="flex justify-center py-10">
            <PlayfulDots />
          </div>
        ) : (
          <>
            {isEmpty && !pending && (
              <>
                <div className="flex flex-col items-start">
                  <div className="max-w-[92%] rounded-[18px] rounded-bl-md bg-white px-4 py-3 text-[15px] leading-relaxed text-ink shadow-sm ring-1 ring-black/[0.04]">
                    {t("greeting")}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2.5 pt-2">
                  {PILLS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => void send(t(`pillMsg.${p.key}`))}
                      className="rounded-full bg-white px-3 py-1.5 text-[13px] font-medium text-ink shadow-sm ring-1 ring-black/[0.05] transition active:scale-95"
                    >
                      <span aria-hidden>{p.emoji}</span> {t(`pill.${p.key}`)}
                    </button>
                  ))}
                </div>
              </>
            )}

            {messages.map((m, i) => (
              <AiMessage
                key={i}
                message={m}
                loggedIn={loggedIn}
                onNavigate={onClose}
                saved={savedApi}
              />
            ))}

            {pending && <ThinkingIndicator />}

            {error && (
              <p className="pl-1 text-[13px] text-accent" role="alert">
                {error}
              </p>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      detents={[0.92]}
      header={header}
      footer={footer}
    >
      {body}
    </BottomSheet>
  );
}
