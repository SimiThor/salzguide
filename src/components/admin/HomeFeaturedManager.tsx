"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "@/i18n/navigation";
import { saveHomeFeatured } from "@/lib/admin-actions";
import { MAX_HOME_FEATURED } from "@/lib/home-featured";
import type { AdminHomeSpot, AdminHomeFeatured } from "@/lib/admin";

// Welche Spots auf der Startseite („/") mit Foto gezeigt werden — und in welcher
// Reihenfolge. Ohne diese Auswahl ist die Startseite eine Seite über schöne Orte, auf der
// kein einziger Ort zu sehen ist.
//
// 🔒 Die Liste enthält NUR freie Spots (getHomeFeaturedAdmin filtert). Pro-Spots stehen
// hier bewusst nicht zur Wahl: ihr Foto verlässt den Server nie, die Karte wäre leer.
export default function HomeFeaturedManager({ spots, migrationMissing }: AdminHomeFeatured) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Ausgewählte Slugs IN REIHENFOLGE. Das ist die eine Quelle der Wahrheit dieser
  // Komponente — die Reihenfolge im Array ist die Reihenfolge auf der Startseite.
  const [chosen, setChosen] = useState<string[]>(() =>
    spots
      .filter((s) => s.homeRank !== null)
      .sort((a, b) => (a.homeRank ?? 0) - (b.homeRank ?? 0))
      .map((s) => s.slug),
  );

  const bySlug = useMemo(() => new Map(spots.map((s) => [s.slug, s])), [spots]);
  const dirty = useMemo(() => {
    const saved = spots
      .filter((s) => s.homeRank !== null)
      .sort((a, b) => (a.homeRank ?? 0) - (b.homeRank ?? 0))
      .map((s) => s.slug);
    return saved.join("|") !== chosen.join("|");
  }, [spots, chosen]);

  const full = chosen.length >= MAX_HOME_FEATURED;

  function toggle(slug: string) {
    setMsg(null);
    setChosen((prev) =>
      prev.includes(slug)
        ? prev.filter((s) => s !== slug)
        : prev.length >= MAX_HOME_FEATURED
          ? prev
          : [...prev, slug],
    );
  }

  function move(slug: string, dir: -1 | 1) {
    setMsg(null);
    setChosen((prev) => {
      const i = prev.indexOf(slug);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await saveHomeFeatured(chosen);
      if (!res.ok) {
        setMsg({ ok: false, text: res.error ?? "Speichern fehlgeschlagen." });
        return;
      }
      setMsg({
        ok: true,
        text: res.saved
          ? `Gespeichert — ${res.saved} Spot${res.saved === 1 ? "" : "s"} auf der Startseite.`
          : "Gespeichert — aktuell kein Spot auf der Startseite.",
      });
      // Ohne refresh zeigt die Seite ihren alten Server-Zustand und die nächste Änderung
      // rechnet gegen veraltete Ränge.
      router.refresh();
    });
  }

  return (
    <section className="rounded-[18px] bg-white p-5 shadow-sm ring-1 ring-black/5">
      <h2 className="text-[17px] font-bold text-ink">Spots auf der Startseite</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Diese Spots zeigt die Startseite mit Foto — in der Reihenfolge unten. Höchstens{" "}
        {MAX_HOME_FEATURED}. Nur freie Spots: Bei Pro-Spots bleibt das Foto auf dem Server,
        die Karte wäre leer.
      </p>

      {migrationMissing ? (
        // Fehlende Migration sieht sonst exakt aus wie „keine Spots da" — und man sucht
        // eine Stunde am falschen Ende. Also klar benennen, was wirklich fehlt.
        <p className="mt-4 rounded-[12px] bg-accent/[0.06] p-4 text-[13px] leading-relaxed text-ink ring-1 ring-accent/20">
          <strong>Migration fehlt.</strong> Die Spalte <code>spots.home_rank</code> gibt es
          noch nicht. Spiel{" "}
          <code>supabase/migrations/0035_home_featured_spots.sql</code> im Supabase-SQL-Editor
          ein, dann lädt diese Liste.
        </p>
      ) : spots.length === 0 ? (
        <p className="mt-4 rounded-[12px] bg-black/[0.04] p-4 text-[13px] text-muted">
          Noch keine freien, veröffentlichten Spots vorhanden.
        </p>
      ) : (
        <>
          {/* Ausgewählte, sortierbar */}
          {chosen.length > 0 && (
            <ol className="mt-4 space-y-2">
              {chosen.map((slug, i) => {
                const s = bySlug.get(slug);
                if (!s) return null;
                return (
                  <li
                    key={slug}
                    className="flex items-center gap-3 rounded-[12px] bg-accent/[0.06] p-2 ring-1 ring-accent/20"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-bold text-white">
                      {i + 1}
                    </span>
                    <Thumb spot={s} />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">
                      {s.title}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => move(slug, -1)}
                        disabled={i === 0}
                        aria-label={`${s.title} nach oben`}
                        className="grid h-8 w-8 place-items-center rounded-full bg-white text-ink ring-1 ring-black/10 disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => move(slug, 1)}
                        disabled={i === chosen.length - 1}
                        aria-label={`${s.title} nach unten`}
                        className="grid h-8 w-8 place-items-center rounded-full bg-white text-ink ring-1 ring-black/10 disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => toggle(slug)}
                        aria-label={`${s.title} entfernen`}
                        className="grid h-8 w-8 place-items-center rounded-full bg-white text-accent ring-1 ring-black/10"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {/* Alle verfügbaren */}
          <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted">
            Verfügbar {full && `— ${MAX_HOME_FEATURED} erreicht, erst einen entfernen`}
          </p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {spots.map((s) => {
              const on = chosen.includes(s.slug);
              const blocked = !on && full;
              return (
                <li key={s.slug}>
                  <button
                    type="button"
                    onClick={() => toggle(s.slug)}
                    disabled={blocked}
                    aria-pressed={on}
                    className={`flex w-full items-center gap-3 rounded-[12px] p-2 text-left ring-1 transition ${
                      on
                        ? "bg-accent/[0.06] ring-accent/30"
                        : blocked
                          ? "bg-black/[0.02] ring-black/5 opacity-40"
                          : "bg-white ring-black/10 hover:ring-black/20"
                    }`}
                  >
                    <span
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-[6px] text-[12px] font-bold ${
                        on ? "bg-accent text-white" : "bg-black/[0.06] text-transparent"
                      }`}
                      aria-hidden
                    >
                      ✓
                    </span>
                    <Thumb spot={s} />
                    <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{s.title}</span>
                    {!s.imageUrl && (
                      // Ohne Foto ist die Karte auf der Startseite ein Emoji auf grauem
                      // Grund — technisch in Ordnung, aber es verfehlt den Zweck.
                      <span className="shrink-0 text-[11px] text-muted">kein Foto</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={pending || !dirty}
              className="rounded-full bg-accent px-5 py-2.5 text-[14px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
            >
              {pending ? "Speichert …" : "Speichern"}
            </button>
            {msg && (
              <span className={`text-[13px] ${msg.ok ? "text-muted" : "text-accent"}`}>
                {msg.text}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Thumb({ spot }: { spot: AdminHomeSpot }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-black/[0.06] text-[15px]">
      {spot.imageUrl ? (
        <Image src={spot.imageUrl} alt="" width={36} height={36} className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden>{spot.emoji ?? "📍"}</span>
      )}
    </span>
  );
}
