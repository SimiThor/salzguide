"use server";

// KI-Zusammenfassung der anonymen Chatbot-Auswertung (docs/34 §I). Es werden
// ausschließlich ANONYME Aggregate an die KI geschickt (keine Rohtexte, kein
// Nutzerbezug) -> datenschutzrechtlich unkritisch. Admin-geprüft.
import { getAiInsights, type AiInsightsQuery } from "./ai-insights";
import { fetchWithRetry } from "./ai-fetch";

const list = (items: { label: string; value: number }[], n = 6) =>
  items.slice(0, n).map((i) => `${i.label} ${i.value}`).join(", ") || "—";

export async function runAiInsightsSummary(
  q: AiInsightsQuery = {},
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const data = await getAiInsights(q); // enthält den Admin-Check
  if (!data) return { ok: false, error: "forbidden" };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "no_key" };
  if (data.total === 0) return { ok: false, error: "empty" };

  const gaps =
    data.gaps.map((g) => `${g.category} in ${g.region} – ${g.reason} (${g.count}×)`).join("; ") ||
    "keine (im Rahmen der k-Anonymität)";

  const summary = [
    `Zeitraum: ${data.from} bis ${data.to}`,
    `KI-Anfragen gesamt ${data.total}, davon beantwortet ${data.answered} (${data.answerRate}%), NICHT beantwortet ${data.unanswered}`,
    `Top-Absichten: ${list(data.intents)}`,
    `Top-Themen/Kategorien: ${list(data.categories)}`,
    `Regionen: ${list(data.regions)}`,
    `Sprache: ${list(data.locales)}`,
    `CONTENT-LÜCKEN (unbeantwortete Wünsche): ${gaps}`,
  ].join("\n");

  const system = `Du bist Produkt-Berater für SalzGuide, eine mobile Reise-Spot- & Event-App fürs Salzburger Land (Zielgruppe: junge Locals & Reisende). Du bekommst ANONYME Aggregate der Chatbot-Nutzung eines Zeitraums.
Gib eine SEHR KURZE, konkrete Einschätzung auf Deutsch als 3–5 Stichpunkte. Jeder Punkt beginnt mit einem Emoji (✅ läuft gut / ⚠️ Lücke / 💡 Idee) und nennt eine ECHTE Zahl + eine direkt umsetzbare Maßnahme für die Weiterentwicklung.
Priorisiere die CONTENT-LÜCKEN (welche Spots/Infos wir aufnehmen/ergänzen sollten) und die Sprach-Nachfrage (EN?). KEINE Floskeln, KEINE Einleitung, KEINE Metrik-Erklärung – direkt die Stichpunkte.`;

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
