import "server-only";

import { createServiceClient } from "./supabase/service";
import { fetchWithRetry } from "./ai-fetch";
import { stripEmDash } from "./em-dash";
import { localeMeta } from "@/i18n/locales";
import { pickLabel, AUDIO_WALK_FALLBACK } from "./i18n-labels";
import { pickRoundVoice } from "./tts-rules";
import { getDefaultVoice, getVoiceById, voiceInfoOf } from "./tts-voices";
import { loadStopAudio } from "./tours";
import { planUserLoop } from "./routing/user-loop";
import { GENERATED_FREE_STOPS, type SaveUserTourInput } from "./user-tours-core";
import type { TourDetail, TourStopView } from "./tour-types";

// Kern des KI-Runden-Generators (Schritt 3). Die Server-Action generateTour (tour-generate.ts,
// "use server" und deshalb ohne neue Exporte) und die App-API (POST /api/app/v1/builder) rufen
// DIESE Funktion. Aus den Interessen waehlt Claude passende POOL-Punkte eines Gebiets; die
// Reihenfolge rechnen wir selbst (Luftlinie, exakt, lib/routing/order.ts) und die Geh-RUNDE ab
// dem fixen Gebiets-Startpunkt (z.B. Mirabellplatz) zurueck zum Start kommt aus EINER Anfrage an
// unseren Routendienst (BRouter, lib/routing/user-loop.ts). Das Ergebnis wird als TourDetail
// zurueckgegeben (Teaser/Pro-Gating + Signed-URLs wie ueberall) und ueber `save` gespeichert.
//
// Wer fragt und ob er Pro ist, entscheidet der AUFRUFER (Cookie im Web, Bearer-Token in der
// App); hier gilt es als bekannt. Pro-only-Begruendung: siehe tour-generate.ts.

const DE = "de";
type Cand = {
  id: string;
  lat: number;
  lng: number;
  kind: string | null;
  tags: string[];
  emoji: string | null;
  title: string;
  img: string | null;
  /** Stimmen, für die der Punkt mindestens eine Volldatei hat (0068). */
  voiceIds: string[];
};
type LngLat = { lat: number; lng: number };

export type BuildTourInput = {
  areaId: string;
  interests: string[]; // gewählte Interessen-Labels
  freeText: string;
  maxStops?: number;
  /** Schon geprueft: eine der unterstuetzten Sprachen (unbekannte fallen im Aufrufer auf Deutsch). */
  locale: string;
  /** Vom Aufrufer entschieden. false = kein Bauen. */
  canSeePro: boolean;
  /** Speichert die fertige Runde fuer den Nutzer (Cookie-Aktion im Web, Bearer-Client in der App). */
  save: (input: SaveUserTourInput) => Promise<{ ok: boolean; id?: string; error?: string }>;
  /** Frist und Wiederholungen des Claude-Aufrufs. Standard wie im Web: 2 Wiederholungen, 45 s. */
  ai?: { retries?: number; timeoutMs?: number };
};

export type BuildTourResult =
  | { ok: false; error: string }
  | { ok: true; tour: TourDetail; id?: string; saveError?: string };

export async function buildAndSaveTour(input: BuildTourInput): Promise<BuildTourResult> {
  const locale = input.locale;
  const canSeePro = input.canSeePro;
  if (!canSeePro) return { ok: false, error: "pro" };
  const supabase = createServiceClient();

  // 1) Gebiet + Startpunkt
  const { data: areaRow } = await supabase
    .from("tour_areas")
    .select("id, start_lat, start_lng, tour_area_translations(lang, name)")
    .eq("id", input.areaId)
    .eq("status", "published")
    .maybeSingle();
  if (!areaRow) return { ok: false, error: "area" };
  const area = areaRow as unknown as Record<string, unknown>;
  const startLat = area.start_lat as number | null;
  const startLng = area.start_lng as number | null;
  if (startLat == null || startLng == null) return { ok: false, error: "no_start" };
  const start: LngLat = { lat: startLat, lng: startLng };
  const areaTrs = (area.tour_area_translations as { lang: string; name: string }[] | null) ?? [];
  const areaName =
    areaTrs.find((r) => r.lang === locale)?.name ??
    areaTrs.find((r) => r.lang === DE)?.name ??
    "";

  // 2) Kandidaten: veröffentlichte Punkte mit Geo UND Audio (Dateien je Stimme, 0068).
  const { data: pointRows } = await supabase
    .from("tour_points")
    .select(
      "id, lat, lng, kind, tags, emoji, image_url, tour_point_translations(lang, title), tour_point_voice_files(voice_id, audio_url)",
    )
    .eq("area_id", input.areaId)
    .eq("status", "published");
  const allCands: Cand[] = ((pointRows as unknown as Record<string, unknown>[]) ?? [])
    .map((p) => {
      const trs = (p.tour_point_translations as { lang: string; title: string }[] | null) ?? [];
      const tr = trs.find((r) => r.lang === locale) ?? trs.find((r) => r.lang === DE) ?? trs[0];
      const files = (p.tour_point_voice_files as { voice_id: string; audio_url: string | null }[] | null) ?? [];
      return {
        id: p.id as string,
        lat: p.lat as number,
        lng: p.lng as number,
        kind: (p.kind as string | null) ?? null,
        tags: (p.tags as string[] | null) ?? [],
        emoji: (p.emoji as string | null) ?? null,
        title: tr?.title ?? "",
        img: (p.image_url as string | null) ?? null,
        voiceIds: [...new Set(files.filter((f) => f.audio_url).map((f) => f.voice_id))],
      };
    })
    .filter((p) => p.lat != null && p.lng != null && p.voiceIds.length > 0);
  // EINE Stimme je Runde, auch hier: die mit der größten Abdeckung im Pool, bei Gleichstand
  // der Standard. Nur Punkte mit Dateien dieser Stimme kommen in die Auswahl.
  const roundVoiceId = pickRoundVoice(allCands, (await getDefaultVoice())?.id ?? null);
  const candidates = allCands.filter((c) => roundVoiceId != null && c.voiceIds.includes(roundVoiceId));
  if (candidates.length < 2) return { ok: false, error: "too_few" };
  const roundVoice = roundVoiceId ? await getVoiceById(roundVoiceId) : null;

  // 3) Claude wählt eine passende, machbare Teilmenge (nie zu viele).
  const maxStops = Math.max(3, Math.min(input.maxStops ?? 6, 8, candidates.length));
  const interestText = [input.interests.join(", "), input.freeText.trim()]
    .filter((s) => s && s.trim())
    .join(" · ");
  const picked = await selectPoints(candidates, interestText, maxStops, locale, input.ai);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  let chosen = (picked?.ids ?? [])
    .map((id) => byId.get(id))
    .filter((c): c is Cand => Boolean(c))
    .slice(0, maxStops);
  if (chosen.length < 2) {
    // Fallback: einfach die ersten Kandidaten (nie leer ausliefern).
    chosen = candidates.slice(0, maxStops);
  }

  // 4) Reihenfolge (exakt, Luftlinie) und Geh-Runde ab Start zurück zum Start: EINE Anfrage
  // an den Routendienst. Liefert er nicht (nicht eingerichtet, kein Weg), bleibt die
  // Reihenfolge und die Linie fehlt; der Client zeichnet dann gerade Striche, wie bisher.
  const loop = await planUserLoop([start.lng, start.lat], chosen.map((c) => [c.lng, c.lat] as [number, number]));
  if (!loop.route) console.error("[tour-generate] Runde ohne Linie:", loop.code ?? "?");
  const ordered = loop.order.map((i) => chosen[i]);

  // 5) Audio der gewählten Punkte laden (nur Dateien der Runden-Stimme), gaten, signieren.
  const chosenIdsFinal = ordered.map((c) => c.id);
  const audioByPoint = new Map<string, { url: string | null; text: string | null; dur: number | null }>();
  {
    const audioRows = await loadStopAudio(supabase, chosenIdsFinal, roundVoiceId);
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const a of audioRows) {
      const pid = a.point_id as string;
      const list = grouped.get(pid) ?? [];
      list.push(a);
      grouped.set(pid, list);
    }
    for (const [pid, list] of grouped) {
      // Sprache des Nutzers bevorzugen – ABER nur, wenn sie wirklich VERTONT ist (audio_url).
      // Sonst deutsche Vertonung (Text + Stimme als Paar). Verhindert Stille, wenn eine Sprache
      // zwar übersetzt, aber noch nicht vertont wurde. Reine Text-Zeilen sind nur letzte Wahl.
      const voiced = (l: string) => list.find((x) => x.lang === l && Boolean(x.audio_url));
      const a =
        voiced(locale) ??
        voiced(DE) ??
        list.find((x) => x.lang === locale) ??
        list.find((x) => x.lang === DE) ??
        list[0];
      audioByPoint.set(pid, {
        url: (a?.audio_url as string | null) ?? null,
        text: (a?.audio_text as string | null) ?? null,
        dur: (a?.duration_sec as number | null) ?? null,
      });
    }
  }

  const prelim = ordered.map((p, i) => {
    const audio = audioByPoint.get(p.id) ?? { url: null, text: null, dur: null };
    const locked = i >= GENERATED_FREE_STOPS && !canSeePro;
    return { p, audio, locked, order: i + 1 };
  });

  const signed = new Map<string, string>();
  const toSign = [
    ...new Set(prelim.filter((x) => !x.locked && x.audio.url).map((x) => x.audio.url as string)),
  ];
  if (toSign.length) {
    const { data: signedList } = await supabase.storage
      .from("tour-audio")
      .createSignedUrls(toSign, 60 * 60 * 2);
    for (const s of signedList ?? []) {
      if (!s.error && s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
    }
  }

  const stops: TourStopView[] = prelim.map((x) => ({
    spotSlug: x.p.id,
    order: x.order,
    title: x.p.title,
    shortDesc: null,
    emoji: x.p.emoji,
    // Bild ist öffentlicher Teaser, auch bei locked (0029) – nur Audio ist Pro.
    imageUrl: x.p.img,
    lat: x.p.lat,
    lng: x.p.lng,
    locked: x.locked,
    audioUrl: x.locked || !x.audio.url ? null : (signed.get(x.audio.url) ?? null),
    audioText: x.locked ? null : x.audio.text,
    durationSec: x.locked ? null : x.audio.dur,
  }));

  // Dauer = Gehzeit (4,5 km/h) + 2 Min je Stop (Zuhören/Stehen), dieselbe Formel wie bei den
  // kuratierten Runden (tourDurationMin, docs/42 Abschnitt 4).
  const durationMin = loop.route?.durationMin ?? null;
  const distanceKm = loop.route ? Math.round(loop.route.distanceM / 100) / 10 : null;

  const fallbackName = pickLabel(AUDIO_WALK_FALLBACK, locale);
  const routeName = (picked?.name ?? "").trim() || fallbackName;
  const routeEmoji = firstGrapheme((picked?.emoji ?? "").trim()) || "🎧";

  const tour: TourDetail = {
    slug: "generated",
    region: "",
    emoji: routeEmoji,
    coverUrl: null,
    title: routeName,
    subtitle: areaName || null,
    description: null,
    stopCount: stops.length,
    isPro: true,
    freeStops: GENERATED_FREE_STOPS,
    durationMin,
    distanceKm,
    // Der KI-Builder erzeugt bisher ausschliesslich Geh-Runden.
    mode: "walk",
    voice: voiceInfoOf(roundVoice),
    stops,
    canSeePro,
    routeGeo: loop.route?.geo ?? null,
    start,
  };

  // Automatisch für den (eingeloggten) User speichern – kein Extra-Klick nötig.
  // saveUserTour prüft selbst die Anmeldung; nicht eingeloggt -> kein id (Fallback:
  // ephemere Anzeige, sollte aber durch das Login-Gate der Seite nicht vorkommen).
  const saved = await input.save({
    areaId: input.areaId,
    name: routeName,
    emoji: routeEmoji,
    interests: [
      ...input.interests,
      ...(input.freeText.trim() ? [input.freeText.trim()] : []),
    ],
    pointIds: chosenIdsFinal,
    routeGeo: loop.route?.geo ?? null,
    start,
    distanceKm,
    durationMin,
  });

  return { ok: true, tour, id: saved.ok ? saved.id : undefined, saveError: saved.ok ? undefined : saved.error };
}

/** Nur das erste Zeichen (Graphem, hoechstens 8 Zeichen): Die KI-Ausgabe soll nie mehr als EIN Emoji speichern. */
function firstGrapheme(text: string): string {
  if (!text) return "";
  const first = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)][0]?.segment ?? "";
  return first.slice(0, 8);
}

// ── Claude-Auswahl + cooler Name (EIN forced-tool-Call, keine Extra-Kosten) ──
type PickResult = { ids: string[]; name: string; emoji: string };
async function selectPoints(
  candidates: Cand[],
  interests: string,
  maxStops: number,
  locale: string,
  ai?: { retries?: number; timeoutMs?: number },
): Promise<PickResult | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const nameLang = localeMeta(locale).english; // Runden-Name in der Sprache des Nutzers
  const list = candidates
    .slice(0, 60)
    .map((c) => ({ id: c.id, title: c.title, tags: c.tags, kind: c.kind ?? undefined }));
  const system = `Du stellst aus einem Pool von Audio-Tour-Punkten eine stimmige, MACHBARE Geh-Runde zusammen, passend zu den Interessen des Nutzers, und gibst ihr einen coolen Namen.
Regeln:
- Wähle 4–${maxStops} Punkte (NIE mehr als ${maxStops}). Lieber wenige, gute Stops als eine Überforderung.
- Gib NUR IDs aus der Liste zurück (exakt kopiert). Erfinde nichts.
- Match über Tags/Typ/Titel zu den Interessen. Gibt es wenig Passendes, wähle trotzdem eine schöne, abwechslungsreiche Mischung.
- Reihenfolge egal (die optimale Route wird danach berechnet).
- NAME: kurz (max ~4 Wörter), cool und konkret, im Stil unserer Zielgruppe (junge Locals & junge Reisende). ANTI-Kitsch: keine Wörter wie „bezaubernd", „traumhaft", „versteckte Perle", „magisch". Kein Doppelpunkt-Klischee. NIE einen Gedankenstrich („—") verwenden: der verrät sofort, dass eine Maschine getextet hat. Sprache des Namens: ${nameLang}.
- EMOJI: genau EIN passendes Emoji zur Runde.`;
  const userMsg = `Interessen: ${interests || "(keine speziellen – allgemein spannende Mischung)"}\n\nPool (JSON):\n${JSON.stringify(list)}\n\nGib Auswahl + Name + Emoji über das Tool "build_route" zurück.`;
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
          max_tokens: 500,
          system,
          messages: [{ role: "user", content: userMsg }],
          tools: [
            {
              name: "build_route",
              description: "Die gewählten Punkt-IDs plus cooler Name + Emoji für die Runde.",
              input_schema: {
                type: "object",
                properties: {
                  ids: { type: "array", items: { type: "string" } },
                  name: { type: "string", description: "Kurzer, cooler Runden-Name." },
                  emoji: { type: "string", description: "Ein passendes Emoji." },
                },
                required: ["ids", "name"],
              },
            },
          ],
          tool_choice: { type: "tool", name: "build_route" },
        }),
      },
      ai?.retries ?? 2,
      ai?.timeoutMs ?? 45000,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const block = (data.content ?? []).find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "build_route",
    ) as { input?: { ids?: unknown; name?: unknown; emoji?: unknown } } | undefined;
    const ids = block?.input?.ids;
    if (!Array.isArray(ids)) return null;
    return {
      ids: ids.filter((x): x is string => typeof x === "string"),
      // Der Runden-Name steht später in der App. Der Prompt bittet um keinen
      // Gedankenstrich, hier wird es erzwungen (siehe em-dash.ts).
      name:
        typeof block?.input?.name === "string" ? stripEmDash(block.input.name, locale) : "",
      emoji: typeof block?.input?.emoji === "string" ? block.input.emoji : "",
    };
  } catch {
    return null;
  }
}
