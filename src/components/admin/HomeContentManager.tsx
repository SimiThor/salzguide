"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { saveHomeTexts, fillHomeTranslations } from "@/lib/admin-actions";
import { HOME_GROUPS } from "@/lib/home-fields";
import { LOCALES } from "@/i18n/locales";
import type { AdminHomeContent } from "@/lib/admin";
import AiButton from "./AiButton";
import { STATUS_NEUTRAL } from "@/lib/ui";

// Die Texte der Startseite. Gruppen und Beschriftungen kommen aus HOME_GROUPS, nicht von
// hier: Ein neues Feld dort taucht automatisch in diesem Formular auf, im Hash und in der
// Übersetzung. Diese Datei kennt keinen einzigen Key selbst.
//
// Ablauf: Deutsch tippen -> Speichern -> „In alle Sprachen übersetzen". Ändert sich danach
// ein deutsches Wort, weicht der source_hash ab und oben steht „veraltet" — dieselbe
// Mechanik wie bei Spots und Events (spot-hash.ts).
export default function HomeContentManager({
  texts: saved,
  fromDb,
  translated,
  stale,
  migrationMissing,
}: AdminHomeContent) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [translating, setTranslating] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>(() => ({ ...saved }));

  // Ungespeicherte Änderungen? Vergleich gegen den Server-Stand, Feld für Feld.
  const dirty = useMemo(
    () => Object.keys(saved).some((k) => (texts[k] ?? "") !== (saved[k] ?? "")),
    [texts, saved],
  );

  const targets = LOCALES.filter((l) => l.code !== "de");
  const missing = targets.filter((l) => !translated.includes(l.code));

  function set(key: string, value: string) {
    setMsg(null);
    setTexts((prev) => ({ ...prev, [key]: value }));
  }

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await saveHomeTexts(texts);
      if (!res.ok) {
        setMsg({ ok: false, text: res.error ?? "Speichern fehlgeschlagen." });
        return;
      }
      setMsg({
        ok: true,
        text: translated.length
          ? "Gespeichert. Die Übersetzungen sind jetzt veraltet — einmal neu übersetzen."
          : "Gespeichert. Die Startseite zeigt jetzt diese Texte.",
      });
      // Ohne refresh rechnet der Veraltet-Hinweis weiter gegen den alten Server-Stand.
      router.refresh();
    });
  }

  async function translate() {
    if (translating) return;
    if (
      !confirm(
        `Die Texte in ${targets.length} Sprachen übersetzen? Das überschreibt die bisherigen Übersetzungen und dauert etwa eine Minute.`,
      )
    )
      return;
    setMsg(null);
    setTranslating(true);
    const res = await fillHomeTranslations();
    setTranslating(false);

    if (!res.ok) {
      setMsg({ ok: false, text: res.error ?? "Übersetzung fehlgeschlagen." });
      return;
    }
    // Teil-Erfolge NICHT verschweigen: Eine Sprache, die still auf Deutsch zurückfällt,
    // sieht auf der Seite völlig in Ordnung aus. Man merkt es erst, wenn ein Gast schreibt.
    const parts: string[] = ["Übersetzt."];
    if (res.failed?.length)
      parts.push(
        `${res.failed.join(", ")} hat nicht geklappt — dort steht weiter Deutsch. Nochmal drücken versucht es erneut.`,
      );
    if (res.rejected?.length)
      parts.push(`${res.rejected.length} Felder verworfen (Platzhalter verloren): ${res.rejected.join(", ")}.`);
    setMsg({ ok: !res.failed?.length, text: parts.join(" ") });
    router.refresh();
  }

  if (migrationMissing) {
    return (
      <section className="rounded-[18px] bg-white p-5 shadow-sm ring-1 ring-black/5">
        <h2 className="text-[17px] font-bold text-ink">Texte der Startseite</h2>
        <p className="mt-4 rounded-[12px] bg-accent/[0.06] p-4 text-[13px] leading-relaxed text-ink ring-1 ring-accent/20">
          <strong>Migration fehlt.</strong> Die Tabelle <code>home_content</code> gibt es noch
          nicht. Spiel <code>supabase/migrations/0036_home_content.sql</code> im
          Supabase-SQL-Editor ein, dann lädt dieses Formular. Die Startseite läuft solange
          mit den Texten aus der Datei weiter.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[18px] bg-white p-5 shadow-sm ring-1 ring-black/5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[17px] font-bold text-ink">Texte der Startseite</h2>
        <Badge stale={stale} translatedCount={translated.length} total={targets.length} />
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Alles, was auf „/“ steht. Deutsch ist die Quelle: Was du hier änderst, ist sofort
        live — in allen Sprachen, bis du neu übersetzt.
      </p>

      {!fromDb && (
        // Der erste Kontakt mit diesem Formular wären sonst 40 leere Felder, und niemand
        // wüsste, ob die Seite gerade leer ist oder nur das Formular. Also vorbefüllen und
        // sagen, woher es kommt.
        <p className="mt-4 rounded-[12px] bg-black/[0.04] p-4 text-[13px] leading-relaxed text-ink">
          <strong>Noch nichts gespeichert.</strong> Unten stehen die aktuellen Texte aus der
          Datei — genau das, was gerade live ist. Einmal Speichern, und ab dann kommt die
          Startseite aus der Datenbank und gehört dir.
        </p>
      )}

      <div className="mt-5 space-y-5">
        {HOME_GROUPS.map((g) => (
          <div key={g.title} className="rounded-[14px] bg-black/[0.02] p-4 ring-1 ring-black/5">
            <h3 className="text-[14px] font-bold text-ink">{g.title}</h3>
            {g.note && <p className="mt-1 text-[12px] leading-relaxed text-muted">{g.note}</p>}
            <div className="mt-3 space-y-3">
              {g.fields.map((f) => (
                <label key={f.key} className="block">
                  <span className="text-[12px] font-semibold text-ink">{f.label}</span>
                  {f.long ? (
                    <textarea
                      value={texts[f.key] ?? ""}
                      onChange={(e) => set(f.key, e.target.value)}
                      rows={3}
                      className="mt-1 w-full resize-y rounded-[10px] bg-white px-3 py-2 text-[14px] text-ink ring-1 ring-black/10 outline-none focus:ring-2 focus:ring-accent/40"
                    />
                  ) : (
                    <input
                      type="text"
                      value={texts[f.key] ?? ""}
                      onChange={(e) => set(f.key, e.target.value)}
                      className="mt-1 w-full rounded-[10px] bg-white px-3 py-2 text-[14px] text-ink ring-1 ring-black/10 outline-none focus:ring-2 focus:ring-accent/40"
                    />
                  )}
                  {f.hint && <span className="mt-1 block text-[11px] leading-relaxed text-muted">{f.hint}</span>}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* sticky: Bei 40 Feldern ist der Speichern-Knopf sonst eine Bildschirmlänge vom
          Feld entfernt, das man gerade tippt. */}
      <div className="sticky bottom-0 -mx-5 -mb-5 mt-5 rounded-b-[18px] border-t border-black/5 bg-white/90 px-5 py-4 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={pending || !dirty}
            className="rounded-full bg-accent px-5 py-2.5 text-[14px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
          >
            {pending ? "Speichert …" : "Speichern"}
          </button>

          <AiButton
            loading={translating}
            loadingLabel="Übersetzt …"
            onClick={translate}
            // Übersetzt wird, was in der DATENBANK steht. Bei ungespeicherten Änderungen
            // würde also der alte Stand in acht Sprachen wandern, und der Knopf hätte
            // trotzdem „fertig" gemeldet.
            disabled={dirty || pending || !fromDb}
            title={
              dirty
                ? "Erst speichern: übersetzt wird der gespeicherte Stand."
                : "Die deutschen Texte in alle Sprachen übersetzen"
            }
            className="rounded-full bg-black/[0.06] px-3.5 py-2.5 text-[14px] font-semibold text-ink transition hover:bg-black/10 active:scale-[0.98] disabled:opacity-40"
          >
            🌍 In alle Sprachen übersetzen
          </AiButton>

          {msg ? (
            <span className={`text-[13px] leading-snug ${msg.ok ? "text-muted" : "text-accent"}`}>
              {msg.text}
            </span>
          ) : dirty ? (
            <span className="text-[13px] text-muted">Ungespeicherte Änderungen.</span>
          ) : missing.length && fromDb ? (
            <span className="text-[13px] text-muted">
              Fehlt noch: {missing.map((l) => l.name).join(", ")}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Badge({
  stale,
  translatedCount,
  total,
}: {
  stale: boolean;
  translatedCount: number;
  total: number;
}) {
  if (stale)
    return (
      <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent">
        Übersetzungen veraltet
      </span>
    );
  if (translatedCount === 0)
    return (
      <span className={STATUS_NEUTRAL}>
        Nur Deutsch
      </span>
    );
  if (translatedCount < total)
    return (
      <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent">
        {translatedCount}/{total} Sprachen
      </span>
    );
  return (
    <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
      Alle Sprachen aktuell
    </span>
  );
}
