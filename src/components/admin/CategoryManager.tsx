"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  saveCategory,
  deleteCategory,
  translateCategoryTitle,
  reorderCategories,
} from "@/lib/admin-actions";
import type { AdminCategoryFull } from "@/lib/admin";
import { adminErrorText } from "@/lib/admin-errors";
import BulkTranslateButton from "./BulkTranslateButton";
import AiButton from "./AiButton";
import Busy from "@/components/Busy";

const LOCALES = routing.locales;
const TARGET_LOCALES = LOCALES.filter((l) => l !== "de");
const LOCALE_LABEL: Record<string, string> = { de: "Deutsch", en: "English" };
const SEASON_LABEL: Record<string, string> = { summer: "Sommer", winter: "Winter" };
type Season = "summer" | "winter";

const inputCls =
  "w-full rounded-[10px] bg-white px-3 py-2 text-[14px] text-ink ring-1 ring-black/[0.08] outline-none focus:ring-2 focus:ring-accent/40";

function CategoryForm({
  initial,
  defaultSeason = "summer",
  onDone,
  onCancel,
}: {
  initial?: AdminCategoryFull;
  defaultSeason?: Season;
  onDone: () => void;
  onCancel: () => void;
}) {
  const isNew = !initial;
  const [season, setSeason] = useState<Season>((initial?.season as Season) ?? defaultSeason);
  const [titles, setTitles] = useState<Record<string, string>>(() => {
    const t: Record<string, string> = {};
    for (const l of LOCALES) t[l] = initial?.titles[l] ?? "";
    return t;
  });
  const [emoji, setEmoji] = useState<string>(initial?.emoji ?? "");
  const [sortOrder, setSortOrder] = useState<number>(initial?.sortOrder ?? 0);
  const [busy, setBusy] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onTranslate() {
    setErr(null);
    setTranslating(true);
    // try/finally: Wirft die Action (Netz weg, Session abgelaufen), bliebe der Button
    // sonst für immer auf „Übersetzt …" und disabled (Muster: run() im ProMigrationManager).
    try {
      const r = await translateCategoryTitle(titles.de ?? "");
      if (r.ok && r.translations) setTitles((p) => ({ ...p, ...r.translations }));
      else setErr(adminErrorText(r.error));
    } catch {
      setErr("Gerade nicht erreichbar. Bitte nochmal versuchen.");
    } finally {
      setTranslating(false);
    }
  }

  async function onSave() {
    setErr(null);
    // Alle Sprachen sind Pflicht (sonst zeigt die App den deutschen Titel als Fallback).
    const missing = LOCALES.filter((l) => !(titles[l] ?? "").trim());
    if (missing.length) {
      setErr(
        `Bitte Titel ausfüllen für: ${missing.map((l) => LOCALE_LABEL[l] ?? l).join(", ")}.`,
      );
      return;
    }
    setBusy(true);
    try {
      const r = await saveCategory({ id: initial?.id, season, titles, emoji, sortOrder });
      if (r.ok) onDone();
      else setErr(adminErrorText(r.error));
    } catch {
      setErr("Gerade nicht erreichbar. Bitte nochmal versuchen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[14px] bg-black/[0.02] p-4 ring-1 ring-black/[0.05]">
      {isNew && (
        <div className="mb-3">
          <span className="mb-1 block text-[12px] font-medium text-muted">Saison</span>
          <div className="inline-flex rounded-full bg-white p-1 ring-1 ring-black/[0.06]">
            {(["summer", "winter"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeason(s)}
                className={`cursor-pointer rounded-full px-3 py-1 text-[13px] font-semibold transition ${
                  season === s ? "bg-accent text-white" : "text-muted"
                }`}
              >
                {SEASON_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {LOCALES.map((l) => (
          <label key={l} className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted">
              Titel ({LOCALE_LABEL[l] ?? l})
              <span className="text-accent"> *</span>
            </span>
            <input
              value={titles[l] ?? ""}
              onChange={(e) => setTitles((p) => ({ ...p, [l]: e.target.value }))}
              placeholder={l === "de" ? "z.B. Seen & Stege" : ""}
              className={inputCls}
            />
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Symbol der Filter-Pille über der Explore-Karte (CategoryFilterStrip.tsx).
            Eigene Spalte statt Zeichen im Titel: ein Emoji wird nicht übersetzt, es
            stünde sonst dreizehnmal da. Leer lassen ist erlaubt, dann trägt die Pille
            nur den Titel.
            ZUR TITELLÄNGE, weil man es dem Feld nicht ansieht: Der Titel ist ZWEIMAL im
            Einsatz, als Regal-Überschrift UND als Pille. Über etwa 22 Zeichen wird die
            Pille breiter als der halbe iPhone-Schirm und schiebt die Nachbarn aus dem
            Bild. Deshalb hier keine Sätze ("Wanderungen – Leicht & Mittel"), sondern
            Namen ("Leichte Wanderungen"). Bewusst OHNE harte Grenze beim Speichern: als
            Überschrift darf ein Titel auch mal länger sein, und eine Regel, die den
            häufigeren Fall bestraft, wäre die falsche Regel. */}
        <label className="flex items-center gap-2 text-[12px] font-medium text-muted">
          Symbol
          <input
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            placeholder="🥾"
            className="w-16 rounded-[10px] bg-white px-2 py-1.5 text-center text-[16px] text-ink ring-1 ring-black/[0.08] outline-none focus:ring-2 focus:ring-accent/40"
          />
        </label>
        <label className="flex items-center gap-2 text-[12px] font-medium text-muted">
          Reihenfolge
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
            className="w-20 rounded-[10px] bg-white px-2 py-1.5 text-[14px] text-ink ring-1 ring-black/[0.08] outline-none focus:ring-2 focus:ring-accent/40"
          />
        </label>
        <AiButton
          loading={translating}
          loadingLabel="Übersetzt"
          onClick={onTranslate}
          disabled={!titles.de?.trim()}
          className="rounded-full bg-black/5 px-3 py-1.5 text-[13px] font-semibold text-muted active:scale-95 disabled:opacity-50"
        >
          Übersetzen
        </AiButton>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded-full px-3 py-1.5 text-[13px] font-medium text-muted"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="cursor-pointer rounded-full bg-accent px-4 py-1.5 text-[13px] font-semibold text-white transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? <Busy>Speichert</Busy> : "Speichern"}
        </button>
      </div>
      {err && <p className="mt-2 text-[13px] font-medium text-accent">{err}</p>}
    </div>
  );
}

export default function CategoryManager({
  categories,
}: {
  categories: AdminCategoryFull[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState<Season | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [movingSeason, setMovingSeason] = useState<Season | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  // isPending deckt das router.refresh()-Fenster ab: Bis die frische Liste da ist,
  // rechnete ein weiterer Pfeil-Klick sonst mit der VERALTETEN Reihenfolge und
  // speicherte denselben Stand nochmal (zwei Klicks bewegen nur eine Position).
  const [isPending, startTransition] = useTransition();

  // Kategorien, denen eine Zielsprache fehlt (z.B. nach Hinzufügen einer neuen Sprache).
  const incomplete = categories
    .filter((c) => TARGET_LOCALES.some((l) => !(c.titles[l] ?? "").trim()))
    .map((c) => ({ id: c.id, label: c.titles.de ?? c.key }));

  const done = () => {
    setEditingId(null);
    setCreating(null);
    startTransition(() => router.refresh());
  };

  async function onDelete(id: string) {
    if (deletingId) return; // Doppel-Klick auf „Löschen" -> zweiter Aufruf ins Leere
    setListErr(null);
    setDeletingId(id);
    try {
      const r = await deleteCategory(id);
      if (r.ok) {
        setConfirmDelete(null);
        startTransition(() => router.refresh());
      } else {
        // Fehler NICHT schlucken: Vorher klappte das Confirm kommentarlos zu und die
        // Kategorie blieb stehen – der Admin hielt es für einen Anzeigefehler.
        setConfirmDelete(null);
        setListErr(adminErrorText(r.error));
      }
    } catch {
      setConfirmDelete(null);
      setListErr("Gerade nicht erreichbar. Bitte nochmal versuchen.");
    } finally {
      setDeletingId(null);
    }
  }

  // Kategorie in ihrer Saison eine Position nach oben/unten schieben.
  async function move(season: Season, index: number, dir: "up" | "down") {
    const ids = categories.filter((c) => c.season === season).map((c) => c.id);
    const j = dir === "up" ? index - 1 : index + 1;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    setListErr(null);
    setMovingSeason(season);
    try {
      const r = await reorderCategories(season, ids);
      if (r.ok) startTransition(() => router.refresh());
      else setListErr(adminErrorText(r.error));
    } catch {
      setListErr("Gerade nicht erreichbar. Bitte nochmal versuchen.");
    } finally {
      setMovingSeason(null);
    }
  }

  return (
    <div className="rounded-[16px] bg-white p-5 shadow-sm ring-1 ring-black/[0.04]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-ink">Kategorien (Karussells)</h2>
        <BulkTranslateButton kind="category" items={incomplete} noun="Kategorien" />
      </div>
      <p className="mt-1 text-[13px] text-muted">
        Titel der Explore-Karussells je Saison. Umbenennen ändert nur den angezeigten
        Titel – die Zuordnung der Spots bleibt erhalten.
      </p>
      {listErr && <p className="mt-2 text-[13px] font-medium text-accent">{listErr}</p>}

      {(["summer", "winter"] as const).map((season) => {
        const cats = categories.filter((c) => c.season === season);
        return (
          <div key={season} className="mt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                {SEASON_LABEL[season]}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setCreating(season);
                  setEditingId(null);
                }}
                className="cursor-pointer rounded-full bg-black/5 px-3 py-1 text-[12px] font-semibold text-ink transition active:scale-95"
              >
                + Neue Kategorie
              </button>
            </div>

            <div className="mt-2 space-y-2">
              {creating === season && (
                <CategoryForm
                  defaultSeason={season}
                  onDone={done}
                  onCancel={() => setCreating(null)}
                />
              )}

              {cats.length === 0 && creating !== season && (
                <p className="py-2 text-[13px] text-muted">Noch keine Kategorien.</p>
              )}

              {cats.map((c, i) =>
                editingId === c.id ? (
                  <CategoryForm
                    key={c.id}
                    initial={c}
                    onDone={done}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 rounded-[12px] bg-black/[0.02] px-3 py-2.5 ring-1 ring-black/[0.04]"
                  >
                    {/* Reihenfolge: eine Position hoch/runter (in dieser Saison). */}
                    <div className="flex shrink-0 flex-col">
                      <button
                        type="button"
                        onClick={() => move(season, i, "up")}
                        disabled={i === 0 || movingSeason === season || isPending}
                        aria-label="Nach oben"
                        className="cursor-pointer flex h-4 w-5 items-center justify-center text-muted transition hover:text-ink disabled:opacity-25 disabled:cursor-not-allowed"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M6 15l6-6 6 6" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => move(season, i, "down")}
                        disabled={i === cats.length - 1 || movingSeason === season || isPending}
                        aria-label="Nach unten"
                        className="cursor-pointer flex h-4 w-5 items-center justify-center text-muted transition hover:text-ink disabled:opacity-25 disabled:cursor-not-allowed"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>
                    </div>
                    <div className="min-w-0 flex-1">
                      {/* Das Symbol steht in der Liste mit, weil man die Pille sonst nur
                          sieht, indem man jede Kategorie einzeln aufklappt. */}
                      <p className="truncate text-[14px] font-medium text-ink">
                        {c.emoji ? `${c.emoji} ` : ""}
                        {c.titles.de ?? c.key}
                      </p>
                      <p className="truncate text-[11px] text-muted">
                        {LOCALES.filter((l) => l !== "de" && c.titles[l])
                          .map((l) => `${l.toUpperCase()}: ${c.titles[l]}`)
                          .join(" · ") || "keine Übersetzung"}{" "}
                        · #{c.sortOrder}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {confirmDelete === c.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onDelete(c.id)}
                            disabled={deletingId !== null}
                            className="cursor-pointer rounded-full bg-accent px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {deletingId === c.id ? <Busy>Löscht</Busy> : "Löschen"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(null)}
                            className="cursor-pointer rounded-full px-2 py-1 text-[12px] font-medium text-muted"
                          >
                            Abbrechen
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(c.id);
                              setCreating(null);
                            }}
                            className="cursor-pointer rounded-full bg-black/5 px-3 py-1 text-[12px] font-semibold text-ink transition active:scale-95"
                          >
                            Bearbeiten
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(c.id)}
                            aria-label="Löschen"
                            className="cursor-pointer rounded-full px-2 py-1 text-[12px] font-medium text-muted transition hover:text-accent"
                          >
                            Löschen
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
