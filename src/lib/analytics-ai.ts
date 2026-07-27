"use server";

// KI-Auswertung der Analytics (docs/34 §H). WICHTIG: Es werden ausschließlich
// ANONYME Aggregat-Kennzahlen an die KI geschickt (keine Roh-Events, keine
// Visitor-Hashes, keine IP) -> keine personenbezogenen Daten. Admin-geprüft.
import { getAnalyticsData, type AnalyticsQuery } from "./analytics-queries";
import { fetchWithRetry } from "./ai-fetch";

const list = (items: { label: string; value: number }[], n = 5) =>
  items.slice(0, n).map((i) => `${i.label} ${i.value}`).join(", ") || "—";

export async function runAnalyticsInsights(
  q: AnalyticsQuery = {},
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const data = await getAnalyticsData(q); // enthält den Admin-Check
  if (!data) return { ok: false, error: "forbidden" };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "no_key" };

  const o = data.overview;
  const a = data.answerable;
  // Was der gesetzte Filter nicht beantworten kann, geht als „nicht erhoben" hinein und
  // NICHT als Null. Eine 0 ist für ein Sprachmodell eine Tatsache: Es hätte daraus brav
  // „niemand aus der Suche merkt sich etwas, dringend nachbessern" abgeleitet — ein
  // Ratschlag, der auf einem fehlenden Datenfeld beruht. Siehe `Answerable`.
  const NA = "nicht erhoben";
  const n = (ok: boolean, value: string) => (ok ? value : NA);

  // Kompakte, rein aggregierte Zusammenfassung (keine personenbezogenen Daten).
  const summary = [
    `Zeitraum: ${data.from} bis ${data.to}`,
    `Seitenaufrufe ${o.pageviews}, Besuche ${o.sessions}, Besucher ${o.visitors} (eindeutig je Tag)`,
    `Bounce-Rate ${o.bounceRate}%, Ø Verweildauer ${o.avgDurationSec}s`,
    `Merkungen ${n(a.saves, `${o.saves} (Merkrate ${o.saveRate}/100 Aufrufe)`)}, Event-Link-Klicks ${n(a.eventLinks, String(o.eventLinks))}, KI-Anfragen ${n(a.aiQueries, String(o.aiQueries))}, Conversions ${n(a.conversions, String(o.conversions))}`,
    `Top-Spots (Merkungen): ${a.saves ? list(data.topSpotsSaved) : NA}`,
    `Top-Spots (Aufrufe): ${list(data.topSpotsViewed)}`,
    `Top-Events (Merkungen): ${a.saves ? list(data.topEventsSaved) : NA}`,
    `Spot-Kategorien (Aufrufe): ${list(data.spotCategories)}`,
    `Event-Kategorien (Merkungen): ${a.saves ? list(data.eventCategories) : NA}`,
    `Quellen: ${list(data.sources)}`,
    `Länder: ${list(data.countries)}`,
    `Geräte: ${list(data.devices)}`,
    `Sprache: ${list(data.locales)}`,
    `Kampagnen: ${data.campaigns.map((c) => `${c.campaign} (Besuche ${c.sessions}, Seiten/Besuch ${c.avgPages}, Bounce ${c.bounceRate}%)`).join("; ") || "—"}`,
    a.note ? `Hinweis zum Filter: ${a.note}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const system = `Du bist Wachstums-/Analytics-Berater für SalzGuide, eine mobile Reise-Spot- & Event-App fürs Salzburger Land (Zielgruppe: junge Locals & Reisende). Du bekommst ANONYME Aggregat-Kennzahlen eines Zeitraums.
Gib eine SEHR KURZE, konkrete Einschätzung auf Deutsch als 3–5 Stichpunkte. Jeder Punkt beginnt mit einem Emoji (✅ gut / ⚠️ schwach / 💡 Idee) und nennt eine ECHTE Zahl aus den Daten + eine direkt umsetzbare Maßnahme.
Fokus: Was zieht Nutzer an, wo brechen sie ab (Bounce/Verweildauer), welche Spots/Events/Kategorien/Kanäle/Kampagnen lohnen sich, was für die Conversion zu Pro. KEINE Erklärung der Metriken, KEINE Floskeln, KEINE Einleitung – direkt die Stichpunkte.
Steht bei einer Kennzahl „nicht erhoben", dann GIBT ES SIE FÜR DIESEN FILTER NICHT. Behandle sie nie als Null, leite nichts daraus ab und erwähne sie höchstens als Datenlücke.`;

  try {
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 600,
          system,
          messages: [{ role: "user", content: `KENNZAHLEN:\n${summary}` }],
        }),
      },
      1,
      30000,
    );
    if (!res.ok) return { ok: false, error: "ai" };
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (json.content ?? [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text as string)
      .join("\n")
      .trim();
    return text ? { ok: true, text } : { ok: false, error: "empty" };
  } catch {
    return { ok: false, error: "ai" };
  }
}
