// KI-Assistent „Toni" (docs/16, 17, 02 §6) — server-seitiger Kern.
// EINE vereinte KI (Claude, Tool-Calling): chattet frei UND schlägt passende
// Spots + Events vor. Kein "use server" -> reines Server-Util, das die API-Route
// (src/app/api/ai/chat) nutzt. Wiederverwendet fetchWithRetry + Brand-Voice-Ton.
import { cache } from "react";
import { bcp47, localeMeta } from "@/i18n/locales";
import { pickLabel, ALL_DAY, CLOSED, TOMORROW, WEATHER_PLACE } from "./i18n-labels";
import { createClient } from "./supabase/server";
import { imagesFromMedia } from "./spots";
import { getUpcomingEvents } from "./events";
import type { EventItem } from "./events-format";
import { eventTimeLabel } from "./events-format";
import { fetchWithRetry } from "./ai-fetch";
import { factArea, factDifficulty, factDuration, factPrice, factSubtype } from "./facts-i18n";
import {
  getWaterMaps,
  lookupLake,
  getLakeReadingByName,
  getLakeSpots,
  type LakeSpot,
} from "./water-temp";
import { LAKES, findLake } from "./lakes";
import { getWeatherFromToday } from "./weather";
import { buildMapsLink } from "./maps";
import { getSpotOpeningWeek } from "./opening-hours-server";
import { stripEmDash } from "./em-dash";
import {
  computeStatus,
  viennaNowWM,
  viennaToday,
  fmtMin,
  type DayHours,
} from "./opening-hours";
import type {
  AiSpotCard,
  AiCards,
  AiChatMessage,
  WaterReading,
  AiDirections,
  AiWeather,
  AiWeatherDay,
  AiOpening,
} from "./ai-types";

export type { AiSpotCard, AiCards, AiChatMessage } from "./ai-types";

const MODEL = "claude-sonnet-4-6";
const AI_HEADERS = (key: string) => ({
  "x-api-key": key,
  "anthropic-version": "2023-06-01",
  "content-type": "application/json",
});

// ── Sicherheits-/Regel-Engine (docs/16 §4, docs/17 §3) ───────────────────────
// Deterministischer Schutz, BEVOR die KI Spots sieht: bei Bade-Wünschen die Seen
// rausfiltern, an denen Baden verboten/ungeeignet ist (Haftung!). Greift für
// Chat UND Vorschläge. Match über normalisierten Titel/Ort (robust ggü. Slug).
const SWIM_TRIGGER =
  /\b(bade|baden|schwimm|schwimmen|abk[üu]hl|planschen|tauchen|springen ins wasser)\b/i;
// Bereits normalisiert (ä->a …), passend zu norm() unten.
const NO_SWIM_PLACES = ["jagersee", "jaegersee", "leopoldskroner", "bluntau"];

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss");
}

export type AiTurnResult = {
  text: string;
  cards: AiCards;
};

// Interner Kandidat: enthält Anzeige-Felder (Card) + kompakte Matching-Felder.
type SpotCandidate = AiSpotCard & {
  subtype: string | null; // z.B. „See", „Café", „Klamm" -> starkes Aktivitäts-Signal
  cats: string[]; // Kategorie-Keys, z.B. „lakes", „hike-ez", „food"
  area: string | null;
  loc: string | null;
  kids: boolean;
  bus: boolean;
  vibes: string[];
};

// Veröffentlichte Free-Spots als Kandidaten-Pool (DE-Basis = vollständig; die KI
// ist ohnehin deutsch-first). includePro=true (Pro-Viewer) nimmt auch Pro-Spots
// dazu; sonst bleiben sie draußen -> KEIN serverseitiger Pro-Leak (docs/33).
const loadSpotCandidates = cache(async function loadSpotCandidates(
  includePro: boolean,
): Promise<SpotCandidate[]> {
  const supabase = await createClient();
  let q = supabase
    .from("spots")
    .select(
      "slug, emoji, is_pro, type, subtype, area, loc, kids, bus, vibes, spot_categories(categories(key)), spot_translations!inner(title, short_desc, lang), media(url, role, sort_order)",
    )
    .eq("status", "published")
    .eq("spot_translations.lang", "de")
    .order("sort_weight", { ascending: false });
  if (!includePro) q = q.eq("is_pro", false);

  const { data, error } = await q;
  if (error) {
    console.error("loadSpotCandidates:", error.message);
    return [];
  }

  return (data ?? []).map((s) => {
    const tr = s.spot_translations as
      | { title: string; short_desc: string | null }[]
      | { title: string; short_desc: string | null };
    const t = Array.isArray(tr) ? tr[0] : tr;
    const cats = ((s.spot_categories ?? []) as { categories?: { key?: string } | null }[])
      .map((c) => c.categories?.key)
      .filter((k): k is string => Boolean(k));
    return {
      slug: s.slug,
      title: t?.title ?? s.slug,
      shortDesc: t?.short_desc ?? null,
      emoji: s.emoji,
      imageUrl: imagesFromMedia(s.media)[0] ?? null,
      type: s.type,
      subtype: (s.subtype as string | null) ?? null,
      cats,
      area: s.area,
      loc: s.loc,
      kids: Boolean(s.kids),
      bus: Boolean(s.bus),
      vibes: (s.vibes as string[] | null) ?? [],
    };
  });
});

// ── Tool-Definitionen (Claude entscheidet, wann es sie nutzt) ────────────────
const TOOLS = [
  {
    name: "search_spots",
    description:
      "Finde passende SalzGuide-Spots (Wanderungen, Seen, Aussichten, Cafes, Restaurants) im Salzburger Land zu einem konkreten Wunsch. Nutze das, sobald der User einen Ort/Aktivitaet/Vibe sucht (z.B. 'chilliger Badesee', 'Wandern mit Hund', 'Specialty Coffee Altstadt'). Gibt eine kuratierte Kandidatenliste zurueck - waehle daraus die BESTEN und erwaehne NUR diese.",
    input_schema: {
      type: "object" as const,
      properties: {
        wish: {
          type: "string",
          description: "Der Wunsch des Users in wenigen Worten (deutsch).",
        },
      },
      required: ["wish"],
    },
  },
  {
    name: "search_events",
    description:
      "Finde aktuelle, echte Events im Salzburger Land aus dem SalzGuide-Wochenkalender. Nutze das bei Fragen nach Veranstaltungen, Wochenende, Konzert, Party, Markt, Festival, Sport oder wenn Events die Anfrage gut ergaenzen. Gibt nur wirklich anstehende, veroeffentlichte Events zurueck - erfinde NIE welche.",
    input_schema: {
      type: "object" as const,
      properties: {
        topic: {
          type: "string",
          description:
            "Optionales Thema/Kategorie (z.B. 'Party', 'Sport', 'Kultur', 'gratis', 'Wochenende'). Leer lassen fuer alle anstehenden Events.",
        },
      },
    },
  },
  {
    name: "get_spot_details",
    description:
      "Liefert Details zu EINEM konkreten SalzGuide-Spot (per slug): Anfahrt (Auto-/Öffi-Empfehlung + fertige Google-Maps-Links), Telefon, Website, Öffnungszeiten (Status + GANZE Woche Mo..So im Feld opening.week), heutiges Wetter am Ort (aus unseren Daten), Wassertemperatur (falls am See), Preis/Dauer/Schwierigkeit sowie 'about' (unsere Beschreibung) und 'insiderTip' (Local-Tipp). Nutze das für 'wie komm ich hin?', 'kann ich reservieren/anrufen?', 'wie ist das Wetter dort?', 'wann/hat der offen? (auch für einen bestimmten Wochentag)', 'erzähl mir mehr'. Erfinde NIE Fakten – ist ein Feld null, sag ehrlich, dass es nicht hinterlegt ist.",
    input_schema: {
      type: "object" as const,
      properties: {
        slug: {
          type: "string",
          description:
            "Der exakte Spot-slug (aus einem search_spots-Ergebnis oder dem Seiten-Kontext).",
        },
        want: {
          type: "array",
          items: { type: "string", enum: ["directions", "weather", "hours", "about"] },
          description:
            "Welche WIDGETS die App anzeigen soll: 'directions' (Route-Widget Auto/Öffis), 'weather' (Wetter-Widget heute+morgen), 'hours' (Öffnungszeiten-Widget mit Status), 'about' (nur Text). Setze passend zur Frage – z.B. bei 'wie komm ich hin?' ['directions'], bei 'hat der offen?' ['hours']. Ohne want kommt nur Text.",
        },
      },
      required: ["slug"],
    },
  },
  {
    name: "get_weather",
    description:
      "Liefert die echte Mehrtages-Wettervorhersage (bis 7 Tage, aus UNSEREN Daten) für einen Ort im Salzburger Land – für Fragen wie 'an welchem Tag ist das Wetter am besten?' oder Wochenwetter. Gib einen Spot-slug ODER einen See-Namen an; ohne Angabe kommt die Stadt Salzburg. Nenne dann konkret den besten Tag (warm, wenig Regen). Verweise NIEMALS auf externe Wetterseiten – wir haben eigene Daten. Erfinde NIE Wetter.",
    input_schema: {
      type: "object" as const,
      properties: {
        spot: { type: "string", description: "Optional: Spot-slug für ortsgenaues Wetter." },
        lake: { type: "string", description: "Optional: See-Name (z.B. 'Wallersee')." },
      },
    },
  },
  {
    name: "get_water_temperatures",
    description:
      "Liefert die AKTUELLEN, echten Wassertemperaturen der Salzburger Badeseen aus unseren offiziellen Datenquellen (Land Salzburg + AGES, gecacht). Nutze das IMMER, wenn der User nach Wassertemperatur/Badetemperatur fragt ('wie warm ist der Fuschlsee?', 'wo kann ich warm baden?') oder wenn ein Bade-Tipp von der aktuellen Temperatur profitiert. Erfinde NIEMALS Temperaturen und rate sie NICHT. Ohne 'lakes' kommen alle Seen mit aktueller Messung.",
    input_schema: {
      type: "object" as const,
      properties: {
        lakes: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional: konkrete Seenamen (z.B. ['Fuschlsee','Wolfgangsee']). Leer lassen = alle Seen mit aktueller Messung.",
        },
      },
    },
  },
];

// ── System-Prompt: Persona „Toni" (KI-Local, docs/16 §3 + docs/17 §3) ─────────
function buildSystemPrompt(ctx: {
  isPro: boolean;
  todayLabel: string;
  dateRef?: string;
  locale: string;
  interests?: string | null;
  page?: string | null;
}): string {
  const dateRefNote = ctx.dateRef
    ? `\nDATUMS-REFERENZ (Europe/Vienna) – nimm Wochentag & Datum IMMER von hier, rechne NIE selbst:\n${ctx.dateRef}\n- „diese Woche" = Mo–So dieser Kalenderwoche · „dieses Wochenende" = kommender Sa & So · „nächste Woche" = die Woche danach.\n- Bei Fragen zu einem Wochentag (z.B. „diesen Sonntag"): bestimme das genaue Datum aus dieser Referenz und wähle NUR Events, deren Feld 'day'/'date' exakt dazu passt. Jedes Event bringt seinen Wochentag im Feld 'day' mit – verlass dich darauf, nicht auf eigenes Kopfrechnen.
- Nennt der User einen ZEITRAUM oder eine DEADLINE (z.B. „bis 11.", „nur am Wochenende", „diese Woche", „nächsten 3 Tage"): empfiehl AUSSCHLIESSLICH Tage/Events INNERHALB dieses Fensters. Prüfe jeden Kandidaten über sein 'date'-Feld gegen die Referenz und schlag NIEMALS einen Tag ausserhalb vor (auch nicht als „wäre noch schöner"). Grenzfall „bis X." = der X. ist noch dabei.`
    : "";
  const proNote = ctx.isPro
    ? "Der User ist SalzGuide-Pro – er sieht alle Spots inkl. der geheimen."
    : "Der User ist (noch) nicht Pro. Es gibt zusätzlich versteckte 'Pro-Spots', die du NICHT kennst – wenn ein Wunsch klar danach klingt, erwähne EINMAL beiläufig die Geheimtipps in SalzGuide Pro (kein Druck, kein Detail).";

  const interestNote = ctx.interests
    ? `\nKONTEXT (leise nutzen): Der User hat sich bisher für solche Spots interessiert: ${ctx.interests}. Gewichte ähnliche Vibes etwas höher, WENN es zur aktuellen Frage passt – erzwinge es nicht und sag NIE, dass du seine gespeicherten Spots kennst.`
    : "";

  const pageNote = ctx.page
    ? `\nWO DER USER GERADE IST: auf ${ctx.page}. Beziehe dich natürlich darauf, wenn es hilft (z.B. „dieser Spot", „hier in der Nähe", Anfahrt/Öffis zu genau diesem Ort) – aber nur, wenn es zur Frage passt. Erwähne die Seite nicht von selbst, wenn sie irrelevant ist.`
    : "";

  return `Du bist „Toni", der KI-Local von salzguide.com – wie ein junger, gut vernetzter Salzburger Freund, der die Gegend wirklich kennt. Du hilfst Einheimischen und jungen Reisenden, das Salzburger Land authentisch zu erleben.

HEUTE ist ${ctx.todayLabel} (Zeitzone Europe/Vienna).
${dateRefNote}

WER MIT DIR SCHREIBT (Zielgruppe): junge Locals (~18–35) und junge Reisende (~18–40). Sie wollen ECHTE, uncheesy Tipps – keine Touri-Fallen, kein Kitsch. Typische Themen: guter Kaffee/Essen, Badeseen, Aussichts- & Sunset-Spots, Wanderungen, was am Wochenende/abends geht, Schlechtwetter-Alternativen, günstig/gratis, gut mit Öffis erreichbar, mit Hund/Kindern.

TON & STIL:
- Locker, ehrlich, auf den Punkt, per Du – wie ein Freund, nicht wie ein Reiseführer oder Marketing.
- KEINE GEDANKENSTRICHE (—). Das ist die auffälligste Verräter-Zeichensetzung von KI-Text. Schreib, wie ein Mensch tippt: Punkt, Komma, Doppelpunkt oder ein einfacher Bindestrich. Statt „30 Tabs — und zu." schreib „30 Tabs, und zu."
- STRENG VERBOTEN (Floskeln): „malerisch", „atemberaubend", „magisch", „Juwel", „Perle", „ein Muss", „Geheimtipp" (als Floskel), „Paradies", „Herz der Stadt".
- KURZ halten: normal 2–5 Sätze. Emojis sparsam (max. 1–2, z. B. 🥾🏞️☀️🏔️☕️).
- KEINE Markdown-Tabellen (die App rendert sie nicht -> hässliche Striche) und keine langen Zahlen-Listen. Zahlen wie Wassertemperaturen und Wetter zeigen die WIDGETS automatisch an – wiederhol sie NICHT im Text. Kurz halten, die Widgets sprechen lassen.
- Antworte AUSSCHLIESSLICH auf ${localeMeta(ctx.locale).english} (${localeMeta(ctx.locale).name}). NUR wenn der User klar in einer anderen Sprache schreibt, antworte in dessen Sprache. Aktuelle App-Sprache: ${ctx.locale}.

RÜCKFRAGEN – WICHTIG fürs Nutzererlebnis:
- Ist die Anfrage zu vage/breit für einen wirklich guten Tipp (z. B. „was kann man machen?", „plan mir was", „4 Tage Salzburg"), stell GENAU EINE kurze, konkrete Rückfrage mit 2–3 klaren Optionen (z. B. „Eher chillig oder aktiv? Und Stadt oder raus in die Natur?").
- Aber NICHT löchern: höchstens EINE Rückfrage, und nur wenn sie den Tipp klar besser macht. Kannst du schon etwas Sinnvolles empfehlen, tu das direkt und häng höchstens eine kurze Rückfrage an.
- Ziel: der User verliert nie die Lust weiterzuschreiben – leichte, klare Fragen, keine Verhöre.

SPOTS & EVENTS VORSCHLAGEN (sehr wichtig):
- Empfehle Spots NUR über das Tool search_spots und Events NUR über search_events. Bei konkreten Wünschen (Ort/Aktivität/Vibe/Event) IMMER zuerst das passende Tool nutzen.
- Erfinde NIEMALS Spots, Events, Öffnungszeiten, Preise oder Adressen. Nichts, was die Tools nicht geliefert haben.
- MATCHE DIE AKTIVITÄT GENAU – nutze dafür die Felder 'kind' (z.B. „See"/„Café"/„Klamm"), 'cats' (z.B. „lakes"/„hike-ez"/„food"/„gorges"), 'vibes' und 'desc', NICHT nur 'type' (fast alles ist „activity"!). Zuordnung: baden/schwimmen → nur Seen/Badeplätze (kind „See", cat „lakes", vibe „wasser"); wandern → Wanderungen (cats „hike-…"); Kaffee/Essen → type „food"; Aussicht → Aussichtsberge; Klamm/Wasserfall → cat „gorges". Biete NIEMALS eine ANDERE Aktivität an als gewünscht – also KEINE Wanderung/keinen Park, wenn jemand baden will.
- Konflikt „gewünschte Aktivität" vs. „in der Nähe": die AKTIVITÄT gewinnt. Wähl den NÄCHSTGELEGENEN passenden Spot (z.B. den nächsten Badesee), statt auf eine andere Aktivität auszuweichen. Gibt es wirklich keinen passenden, sag das ehrlich.
- Wähle ehrlich die BESTEN 1–3 Treffer (lieber wenige echt passende als fünf mittelmäßige). Passt nichts wirklich, sag das ehrlich – NICHT auffüllen und nichts erfinden.
- Spot verlinken: GENAU [Spot-Titel](/spot/SLUG) mit dem slug aus dem Tool – die App zeigt darunter automatisch eine Karte. Event verlinken: GENAU [Event-Titel](/events?e=ID) mit der id aus dem Tool.
- Zu jedem Vorschlag EIN kurzer, konkreter Satz, warum er passt (nicht nur den Namen droppen). Wenn sinnvoll, denk an Öffis/Dauer/Kinder/Hund/Wetter.
- Bei EVENTS: Die Event-Karte zeigt bereits Titel, Datum, Uhrzeit, Ort, Kategorie & Kurzbeschreibung. Schreib dazu nur 1–2 kurze Fließtext-Sätze OHNE Event-Link (Einordnung/Highlight). Setze die Event-Verlinkungen DANACH – JEDE in einer EIGENEN Zeile, NUR als [Titel](/events?e=ID) und sonst NICHTS in der Zeile (kein Datum, kein Text). Die App macht daraus Karten; im Chat-Text erscheinen sie NICHT. Wiederhol Datum/Titel/Beschreibung NIRGENDS im Text.

WASSERTEMPERATUREN (nur echte Daten):
- Fragt der User nach Wassertemperatur/Badetemperatur ('wie warm ist der Fuschlsee?', 'wo kann ich warm baden?') oder würde ein Bade-Tipp davon profitieren, nutze IMMER get_water_temperatures und nenne die ECHTEN Werte. Erfinde NIE Temperaturen und rate NICHT aus dem Internet.
- Das Tool liefert je See auch die SalzGuide-Spots am See (Feld 'spots'): passt es zur Anfrage, empfiehl 1–2 davon als [Titel](/spot/SLUG) mit dem slug.
- Die App zeigt die Werte als Kachel automatisch an. Für die volle Übersicht kannst du auf [Wassertemperaturen](/wasser) verweisen.
- Liegt kein aktueller Wert vor, sag das ehrlich (statt zu schätzen).

PRAKTISCHES ZU EINEM SPOT (Anfahrt, Telefon, Wetter, Öffnungszeiten):
- Für konkrete Fragen zu EINEM Spot (wie komm ich hin? kann ich reservieren/anrufen? wie ist das Wetter dort? hat der offen? was kostet das?) nutze get_spot_details mit dem slug (aus deinem letzten Spot-Vorschlag oder dem Seiten-Kontext). Erfinde NICHTS – ist ein Feld null, sag ehrlich, dass es nicht hinterlegt ist.
- WIDGETS statt Text-Links: Für Anfahrt, Wetter und Öffnungszeiten setzt du bei get_spot_details 'want' – die App zeigt dann automatisch ein kompaktes, klickbares Widget. Gib die Google-Maps-URL NIEMALS selbst als Text-Link aus (das Route-Widget übernimmt das). Halte deinen Text dazu SEHR kurz (1 Satz), das Widget zeigt die Aktion. want lässt sich kombinieren, z.B. ["directions","weather","hours"].
- QUELLEN-ATTRIBUTION: Die Widgets zeigen die Datenquelle selbst an (Wetter: Open-Meteo, Wassertemperatur: Land Salzburg/AGES, Öffnungszeiten: Google). Du musst die Quelle NICHT im Text nennen.
- ANFAHRT (smart): get_spot_details mit want:["directions"] -> Route-Widget (Auto/Öffi-Buttons). Dein Satz richtet sich nach directions.recommendation:
  • 'auto' / transitUrl null -> „Am besten mit dem Auto." (NICHT nach Auto/Bus fragen)
  • 'oeffis' -> „Gut mit den Öffis erreichbar."
  • 'beides' -> „Geht mit Auto oder Öffis."
- WETTER heute/morgen zu EINEM Spot: get_spot_details mit want:["weather"] -> Wetter-Widget (heute + morgen). Sag in EINEM Satz das Wesentliche (z.B. „Heute eher Regen, morgen besser.").
- „An welchem TAG ist es am besten?" / Wochenwetter: nutze get_weather. Geht es um einen KONKRETEN Spot/See (z.B. den, den du gerade empfiehlst wie den Fuschlsee), gib IMMER dessen Spot-slug bzw. See-Namen mit (spot bzw. lake) – NICHT die Stadt; das Widget soll das Wetter am RICHTIGEN Ort zeigen. Ohne Ort (Default Stadt Salzburg) nur bei einer allgemeinen Stadt-Frage ohne konkreten Spot. NENNE dann in EINEM kurzen Satz den besten Tag (warm, wenig Regen) aus den Daten (jeder Tag hat 'day'/max/min/Regen%) – KEINE Tag-für-Tag-Liste im Text, das Wetter-Widget zeigt bereits alle Tage. Verweise NIEMALS auf externe Wetterseiten/-Apps und behaupte NIE, du hättest kein Wetter – wir haben eigene Daten.
- RESERVIEREN/ANRUFEN: phone vorhanden -> nenn die Nummer locker. Kein phone -> sag ehrlich, dass keine Nummer hinterlegt ist, und biete – falls vorhanden – die website an.
- ÖFFNUNGSZEITEN: Bei JEDER Öffnungszeiten-Frage („hat der offen?", „wann offen?", „wann am Samstag?") IMMER get_spot_details mit want:["hours"] aufrufen und aus dem Feld 'opening' antworten – wimmle NICHT auf die Spot-Seite ab, wenn Zeiten da sind. 'opening' enthält 'week' = ALLE Wochentage (Mo..So) mit ihren Zeiten -> fragt jemand nach einem BESTIMMTEN Tag (z.B. Samstag), nimm den Eintrag aus 'week' und nenne ihn direkt („Samstag: 9:00–18:00."). Für „hat gerade offen?" nutze openNow + changeTime/changeDay (z.B. „Grad zu, öffnet morgen um 9:00."). Nur wenn openingHoursKnown=false, sag ehrlich, dass keine hinterlegt sind (nichts erfinden).
- „ERZÄHL MIR MEHR / warum ist der gut?": nutze 'about' (unsere Beschreibung) und 'insiderTip' (Local-Tipp) aus get_spot_details – fass es locker in 1–2 Sätzen zusammen, erfinde nichts dazu.

SICHERHEIT (Haftung – niemals ignorieren):
- Baden NUR, wo erlaubt. An Jägersee, Leopoldskroner Weiher und den Bluntauseen ist Baden verboten/ungeeignet – empfiehl sie NIE zum Schwimmen.
- Keine Outdoor-/Berg-Tipps bei Unwetter/Gewitter. Bei heiklem Wetter zu Vorsicht raten.

DEIN THEMA (einzige Kompetenz): Freizeit & Reise im Salzburger Land. Vage Stichworte („mit Zug", „Regen", „mit Kindern", „was geht heut?") IMMER als Salzburg-Wunsch deuten, nie abblocken. NUR klar Themenfremdes (Kochrezepte, Programmieren, Hausaufgaben, Texte/Übersetzungen) freundlich ablehnen und zurück zu Salzburg lenken.
${pageNote}
${interestNote}
${proNote}

Sag nie, dass du „in einer Datenbank suchst" oder dass Daten fehlen – red einfach wie ein Local. Du bist eine KI – wenn direkt gefragt, steh ehrlich dazu.`;
}

// Kompakte, token-sparsame Sicht für die KI (Tool-Ergebnis).
// kind/area werden übersetzt übergeben: Toni zitiert diese Felder gern wörtlich, und ein
// deutsches „Klamm" mitten in einer spanischen Antwort liest sich wie ein Fehler.
function compactSpot(s: SpotCandidate, locale: string) {
  return {
    slug: s.slug,
    title: s.title,
    desc: s.shortDesc?.slice(0, 140) ?? "",
    type: s.type,
    kind: factSubtype(s.subtype, locale) ?? undefined, // Art des Spots
    cats: s.cats.length ? s.cats : undefined, // z.B. „lakes"/„hike-ez"/„food"
    area: factArea(s.area, locale) ?? undefined,
    loc: s.loc ?? undefined,
    kids: s.kids || undefined,
    bus: s.bus || undefined,
    vibes: s.vibes.length ? s.vibes : undefined,
  };
}

function compactEvent(e: EventItem, locale: string) {
  const dl = bcp47(locale);
  // Wiener Datum + Wochentag AUS UNSEREN DATEN -> die KI muss nie selbst rechnen.
  const vDate = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Vienna",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  const vDay = (iso: string) =>
    new Intl.DateTimeFormat(dl, { timeZone: "Europe/Vienna", weekday: "long" }).format(
      new Date(iso),
    );
  const date = vDate(e.startsAt);
  const endDate = e.endsAt ? vDate(e.endsAt) : null;
  const multiDay = endDate && endDate !== date;
  return {
    id: e.id,
    title: e.title,
    day: vDay(e.startsAt), // Wochentag des Starts
    date, // Wiener Datum YYYY-MM-DD
    endDay: multiDay ? vDay(e.endsAt as string) : undefined, // nur mehrtägig
    endDate: multiDay ? endDate : undefined,
    when: eventTimeLabel(e, locale) ?? pickLabel(ALL_DAY, locale),
    location: e.locationName ?? undefined,
    category: e.category,
    free: e.isFree || undefined,
    desc: e.description?.slice(0, 140) ?? "",
  };
}

// Nach hallucinationssicheren Links suchen: nur Spots/Events, die die Tools
// wirklich geliefert haben, werden zu Karten. Unbekannte Links werden zu Klartext
// entschärft (kein toter /spot/…-Link, keine erfundene Empfehlung als Karte).
function extractCards(
  text: string,
  spotBySlug: Map<string, AiSpotCard>,
  eventById: Map<string, EventItem>,
): { text: string; cards: AiCards } {
  const spots: AiSpotCard[] = [];
  const events: EventItem[] = [];
  const seenSpot = new Set<string>();
  const seenEvent = new Set<string>();

  // 1) EVENTS -> erscheinen NUR als Karten. Eine Zeile mit einem (bekannten)
  //    Event-Link wird aus dem Text ENTFERNT (die Karte trägt Titel/Datum/Zeit/
  //    Ort/Beschreibung) -> kein Event doppelt (Text-Link + Karte). Unbekannte
  //    Event-Links -> Klartext (kein toter Link, keine Karte).
  const eventLink = /\[([^\]]+)\]\(\/events\?e=([0-9a-fA-F-]+)\)/g;
  const keptLines: string[] = [];
  for (const line of text.split("\n")) {
    let hasKnownEvent = false;
    const downgraded = line.replace(eventLink, (_whole, label: string, id: string) => {
      const ev = eventById.get(id);
      if (!ev) return label; // unbekanntes Event -> Klartext
      if (!seenEvent.has(ev.id) && events.length < 6) {
        seenEvent.add(ev.id);
        events.push(ev);
      }
      hasKnownEvent = true;
      return "";
    });
    if (hasKnownEvent) continue; // Zeile weglassen -> Event nur als Karte
    keptLines.push(downgraded);
  }
  let cleaned = keptLines.join("\n");

  // 2) SPOTS -> Inline-Link behalten (liest sich natürlich im Satz) + Karte.
  cleaned = cleaned.replace(
    /\[([^\]]+)\]\(\/spot\/([a-z0-9-]+)\)/g,
    (whole, label: string, slug: string) => {
      const card = spotBySlug.get(slug);
      if (!card) return label; // unbekannter Spot -> Klartext
      if (!seenSpot.has(card.slug) && spots.length < 5) {
        seenSpot.add(card.slug);
        spots.push(card);
      }
      return whole;
    },
  );

  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return { text: cleaned, cards: { spots, events } };
}

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: string; [k: string]: unknown };

// ── Haupt-Loop: Chat + Tool-Calling, bis eine finale Textantwort steht ───────
export async function runAssistant(
  history: AiChatMessage[],
  ctx: {
    isPro: boolean;
    locale: string;
    todayLabel: string;
    dateRef?: string;
    interests?: string | null;
    page?: string | null;
  },
): Promise<AiTurnResult | { error: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: "ANTHROPIC_API_KEY fehlt" };

  const spotBySlug = new Map<string, AiSpotCard>();
  const eventById = new Map<string, EventItem>();
  const waterBySlug = new Map<string, WaterReading>();
  let pendingDirections: AiDirections | null = null;
  let pendingWeather: AiWeather | null = null;
  let pendingOpening: AiOpening | null = null;

  const system = buildSystemPrompt(ctx);
  const messages: { role: string; content: unknown }[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let finalText = "";

  try {
    for (let guard = 0; guard < 6; guard++) {
      const res = await fetchWithRetry(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: AI_HEADERS(key),
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 1200,
            system,
            messages,
            tools: TOOLS,
          }),
        },
        1,
        45000,
      );
      if (!res.ok) return { error: `KI-Fehler (${res.status})` };

      const data = (await res.json()) as {
        stop_reason?: string;
        content?: AnthropicBlock[];
      };
      const blocks = data.content ?? [];

      // Textteile immer einsammeln (falls die finale Antwort hier schon steht).
      finalText = blocks
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      if (data.stop_reason !== "tool_use") break;

      // Tool-Aufrufe ausführen, Ergebnisse zurückspielen.
      messages.push({ role: "assistant", content: blocks });
      const toolResults: unknown[] = [];

      for (const b of blocks) {
        if (b.type !== "tool_use") continue;
        const tu = b as { id: string; name: string; input: Record<string, unknown> };

        if (tu.name === "search_spots") {
          const wish = String(tu.input?.wish ?? "");
          let pool = await loadSpotCandidates(ctx.isPro);
          // Regel-Engine: bei Bade-Wunsch verbotene Badeseen rausfiltern.
          if (SWIM_TRIGGER.test(wish)) {
            pool = pool.filter((s) => {
              const hay = norm(`${s.title} ${s.area ?? ""} ${s.slug}`);
              return !NO_SWIM_PLACES.some((p) => hay.includes(p));
            });
          }
          for (const s of pool) if (!spotBySlug.has(s.slug)) spotBySlug.set(s.slug, s);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify({
              count: pool.length,
              spots: pool.map((s) => compactSpot(s, ctx.locale)),
            }),
          });
        } else if (tu.name === "search_events") {
          const events = await getUpcomingEvents(ctx.locale);
          for (const e of events) if (!eventById.has(e.id)) eventById.set(e.id, e);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify({
              count: events.length,
              events: events.map((e) => compactEvent(e, ctx.locale)),
            }),
          });
        } else if (tu.name === "get_water_temperatures") {
          // Echte Werte aus unseren Quellen (gecacht: max. 1 Abruf/TTL global,
          // nicht pro Anfrage) -> token-/kostensparend, kein Raten.
          const wantedRaw = Array.isArray(tu.input?.lakes)
            ? (tu.input.lakes as unknown[]).map((x) => String(x))
            : [];
          const wantedSlugs = new Set<string>();
          for (const w of wantedRaw) {
            const l = findLake(w);
            if (l) wantedSlugs.add(l.slug);
          }
          const useFilter = wantedRaw.length > 0;
          const maps = await getWaterMaps();
          const now = Date.now();
          // Spots am See mitliefern -> Toni kann passende Spots am See vorschlagen.
          const lakeSpotsMap: Record<string, LakeSpot[]> = await getLakeSpots(
            ctx.locale,
          ).catch(() => ({}) as Record<string, LakeSpot[]>);
          const rows: {
            name: string;
            tempC: number;
            measuredOn: string;
            spots?: { title: string; slug: string }[];
          }[] = [];
          for (const l of LAKES) {
            if (useFilter && !wantedSlugs.has(l.slug)) continue;
            const r = lookupLake(maps, l, now);
            if (!r) continue;
            waterBySlug.set(l.slug, {
              name: l.name,
              slug: l.slug,
              tempC: r.tempC,
              at: r.at,
            });
            const spotsHere = (lakeSpotsMap[l.slug] ?? []).slice(0, 4);
            for (const s of spotsHere) {
              if (!spotBySlug.has(s.slug))
                spotBySlug.set(s.slug, {
                  slug: s.slug,
                  title: s.title,
                  shortDesc: s.shortDesc,
                  emoji: s.emoji,
                  imageUrl: s.image,
                  type: "activity",
                });
            }
            rows.push({
              name: l.name,
              tempC: r.tempC,
              measuredOn: r.at.slice(0, 10),
              spots: spotsHere.length
                ? spotsHere.map((s) => ({ title: s.title, slug: s.slug }))
                : undefined,
            });
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify({
              count: rows.length,
              lakes: rows,
              note:
                rows.length === 0
                  ? "Keine aktuellen Messwerte für die genannten Seen in unseren Quellen."
                  : undefined,
            }),
          });
        } else if (tu.name === "get_spot_details") {
          // Praktische Fakten zu EINEM Spot (Anfahrt/Telefon/Wetter/See/Öffnungszeiten).
          // Alle Zusatzdaten (Wetter/Wasser) sind gecacht -> token-/kostensparend.
          const slug = String(tu.input?.slug ?? "").trim().toLowerCase();
          let payload: Record<string, unknown> = { found: false };
          if (slug) {
            const supabase = await createClient();
            const { data: sp } = await supabase
              .from("spots")
              .select(
                "slug, type, area, lat, lng, parking_lat, parking_lng, access, phone, website_url, ticket_url, has_opening_hours, google_place_id, lake_name, is_pro, price_level, difficulty, duration, spot_translations(title, general, insider_tip, lang)",
              )
              .eq("slug", slug)
              .eq("status", "published")
              .maybeSingle();
            // Gesperrte Pro-Spots für Nicht-Pro nicht ausplaudern.
            if (sp && !(sp.is_pro && !ctx.isPro)) {
              const lat = sp.lat as number | null;
              const lng = sp.lng as number | null;
              const hasMain = lat != null && lng != null;
              const carLat = (sp.parking_lat as number | null) ?? lat;
              const carLng = (sp.parking_lng as number | null) ?? lng;
              const access = sp.access as string | null;
              const transitOk =
                access === "oeffis" ||
                access === "beides" ||
                (access == null && sp.type === "activity");
              // Wetter: heute + morgen (2 Tage) reichen fürs Widget & für „eher morgen".
              let weatherDays: AiWeatherDay[] = [];
              if (hasMain) {
                try {
                  // ab HEUTE (Vienna) -> die ersten 2 Tage sind wirklich heute+morgen,
                  // auch wenn der 24h-Cache nach Mitternacht noch von gestern stammt.
                  const w = await getWeatherFromToday(lat as number, lng as number);
                  weatherDays = (w ?? []).slice(0, 2).map((d) => ({
                    date: d.date,
                    code: d.code,
                    maxC: d.tempMax,
                    minC: d.tempMin,
                    rainProbPct: d.precip,
                  }));
                } catch {
                  /* Wetter optional */
                }
              }
              let lake: Record<string, unknown> | null = null;
              if (sp.lake_name) {
                try {
                  const lr = await getLakeReadingByName(sp.lake_name as string);
                  if (lr?.reading)
                    lake = {
                      name: lr.lake.name,
                      tempC: lr.reading.tempC,
                      measuredOn: lr.reading.at.slice(0, 10),
                    };
                } catch {
                  /* Wasser optional */
                }
              }
              const trs = (sp.spot_translations ?? []) as {
                title: string;
                general: string | null;
                insider_tip: string | null;
                lang: string;
              }[];
              const tr = trs.find((x) => x.lang === ctx.locale) ?? trs.find((x) => x.lang === "de");
              const title = tr?.title ?? slug;
              const recommendation: AiDirections["recommendation"] =
                access === "oeffis" || access === "beides" || access === "auto"
                  ? access
                  : transitOk
                    ? "beides"
                    : "auto";
              const directions: AiDirections = {
                slug,
                name: title,
                recommendation,
                carUrl:
                  carLat != null && carLng != null
                    ? buildMapsLink(carLat, carLng, "driving")
                    : null,
                transitUrl:
                  transitOk && hasMain
                    ? buildMapsLink(lat as number, lng as number, "transit")
                    : null,
              };
              // Welche Widgets die App zeigen soll (Toni-gesteuert via 'want').
              const want = Array.isArray(tu.input?.want)
                ? (tu.input.want as unknown[]).map((x) => String(x))
                : [];
              if (want.includes("directions")) pendingDirections = directions;
              if (want.includes("weather") && weatherDays.length)
                pendingWeather = { slug, name: title, days: weatherDays };

              // Öffnungszeiten (gecacht, wie Wetter) – nur bei Bedarf & wenn hinterlegt.
              let opening: Record<string, unknown> | null = null;
              if (want.includes("hours") && sp.has_opening_hours) {
                try {
                  const res = await getSpotOpeningWeek(
                    slug,
                    (sp.google_place_id as string | null) ?? null,
                  );
                  if (res) {
                    const now = new Date();
                    const st = computeStatus(res.week, viennaNowWM(now));
                    const td = viennaToday(now).weekday;
                    const closedLabel = pickLabel(CLOSED, ctx.locale);
                    const wdName = (i: number) =>
                      new Intl.DateTimeFormat(bcp47(ctx.locale), {
                        weekday: "long",
                        timeZone: "Europe/Vienna",
                      }).format(new Date(Date.UTC(2024, 0, 1) + i * 86_400_000));
                    const dayHours = (d: DayHours | undefined) =>
                      d && !d.closed && d.ranges.length
                        ? d.ranges.map((r) => `${r.open}–${r.close}`).join(", ")
                        : closedLabel;
                    const todayHours = dayHours(res.week[td]);
                    // GANZE Woche (Mo..So) -> Toni kann jeden Tag beantworten (z.B. Samstag).
                    const week = res.week.map((d, i) => ({ day: wdName(i), hours: dayHours(d) }));
                    let changeTime: string | null = null;
                    let changeDay: string | null = null;
                    if (st.changeAt != null) {
                      changeTime = fmtMin(st.changeAt % 1440);
                      const cd = Math.floor(st.changeAt / 1440);
                      if (cd === td) changeDay = null;
                      else if (cd === (td + 1) % 7)
                        changeDay = pickLabel(TOMORROW, ctx.locale);
                      else changeDay = wdName(cd);
                    }
                    opening = {
                      openNow: st.open,
                      todayHours,
                      week,
                      changeTime,
                      changeDay,
                      source: res.source,
                    };
                    pendingOpening = {
                      slug,
                      name: title,
                      openNow: st.open,
                      todayHours,
                      source: res.source,
                    };
                  }
                } catch {
                  /* Öffnungszeiten optional */
                }
              }
              payload = {
                found: true,
                name: title,
                type: sp.type,
                area: factArea(sp.area, ctx.locale),
                // Beschreibende Texte (gekürzt) -> Toni antwortet bei „erzähl mir mehr"
                // aus UNSEREM Text statt zu erfinden. On-demand, daher token-sparsam.
                about: tr?.general ? tr.general.slice(0, 400) : null,
                insiderTip: tr?.insider_tip ? tr.insider_tip.slice(0, 220) : null,
                directions: {
                  recommendation,
                  carUrl: directions.carUrl,
                  transitUrl: directions.transitUrl,
                },
                phone: sp.phone ?? null,
                website: sp.website_url ?? null,
                ticketUrl: sp.ticket_url ?? null,
                openingHoursKnown: Boolean(sp.has_opening_hours),
                opening,
                weather: weatherDays,
                lake,
                // Übersetzt übergeben, nicht roh: Sonst reicht Toni „mittel" oder „Halbtag"
                // wörtlich in eine koreanische Antwort durch. Dieselbe Tabelle wie die
                // Detailseite, damit Chat und Seite nie unterschiedlich beschriften.
                priceLevel: factPrice(sp.price_level),
                difficulty: factDifficulty(sp.difficulty, ctx.locale),
                duration: factDuration(sp.duration, ctx.locale),
              };
            }
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify(payload),
          });
        } else if (tu.name === "get_weather") {
          // Mehrtages-Wetter (bis 7 Tage) aus unseren Daten -> „bester Tag?".
          const spotSlug = String(tu.input?.spot ?? "").trim().toLowerCase();
          const lakeArg = String(tu.input?.lake ?? "").trim();
          let coords: { lat: number; lng: number } | null = null;
          let placeName = pickLabel(WEATHER_PLACE, ctx.locale);
          let placeSlug: string | null = null;
          if (spotSlug) {
            const supabase = await createClient();
            const { data: sp } = await supabase
              .from("spots")
              .select("slug, lat, lng, is_pro, spot_translations(title, lang)")
              .eq("slug", spotSlug)
              .eq("status", "published")
              .maybeSingle();
            if (sp && !(sp.is_pro && !ctx.isPro) && sp.lat != null && sp.lng != null) {
              coords = { lat: sp.lat as number, lng: sp.lng as number };
              placeSlug = sp.slug as string;
              const trs = (sp.spot_translations ?? []) as { title: string; lang: string }[];
              placeName =
                trs.find((x) => x.lang === ctx.locale)?.title ??
                trs.find((x) => x.lang === "de")?.title ??
                spotSlug;
            }
          }
          if (!coords && lakeArg) {
            const l = findLake(lakeArg);
            if (l) {
              coords = { lat: l.lat, lng: l.lng };
              placeName = l.name;
            }
          }
          if (!coords) coords = { lat: 47.8009, lng: 13.045 }; // Stadt Salzburg
          let days: AiWeatherDay[] = [];
          try {
            const w = await getWeatherFromToday(coords.lat, coords.lng);
            days = (w ?? []).slice(0, 7).map((d) => ({
              date: d.date,
              code: d.code,
              maxC: d.tempMax,
              minC: d.tempMin,
              rainProbPct: d.precip,
            }));
          } catch {
            /* Wetter optional */
          }
          if (days.length) pendingWeather = { slug: placeSlug, name: placeName, days };
          const wdFmt = new Intl.DateTimeFormat(bcp47(ctx.locale), {
            weekday: "long",
            timeZone: "Europe/Vienna",
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify({
              place: placeName,
              days: days.map((d) => ({
                day: wdFmt.format(new Date(`${d.date}T12:00:00Z`)),
                date: d.date,
                maxC: d.maxC,
                minC: d.minC,
                rainProbPct: d.rainProbPct,
                code: d.code,
              })),
            }),
          });
        } else {
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: "Unbekanntes Tool.",
            is_error: true,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }
  } catch {
    return { error: "KI nicht erreichbar" };
  }

  if (!finalText) return { error: "Keine Antwort" };
  const base = extractCards(finalText, spotBySlug, eventById);
  // Wassertemperaturen (falls das Tool genutzt wurde): wärmste zuerst, gedeckelt.
  const water = [...waterBySlug.values()]
    .sort((a, b) => b.tempC - a.tempC)
    .slice(0, 6);
  return {
    // Der Prompt verbietet den Gedankenstrich, aber ein Prompt ist eine Bitte. Toni ist der
    // sichtbarste KI-Text der App, also wird die Regel hier zum Zwang (siehe em-dash.ts).
    //
    // NACH extractCards und nicht davor: das sieht damit weiterhin die rohe Modell-Ausgabe,
    // und die Karten-/Link-Erkennung kann sich an einer Säuberung nicht verschlucken.
    //
    // ctx.locale mitgeben: Chinesisch braucht seinen Strich (破折号).
    text: stripEmDash(base.text, ctx.locale),
    cards: {
      ...base.cards,
      water: water.length ? water : undefined,
      directions: pendingDirections ?? undefined,
      weather: pendingWeather ?? undefined,
      opening: pendingOpening ?? undefined,
    },
  };
}
