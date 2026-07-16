// KI-Recherche pro Kalenderwoche (Mo–So, Land Salzburg): findet Events und legt
// sie als DRAFT an (Service-Role -> umgeht RLS). Dedup gegen bereits vorhandene
// Events (gleicher Tag + gleicher Titel) + Wochen-Guard. Merkt sich in
// event_research_log, welche Woche schon gesucht wurde -> keine Doppel-Suchen.
// Kein "use server": wird vom Cron-Route-Handler UND einer Admin-Action genutzt.

import { createServiceClient } from "./supabase/service";
import { fetchWithRetry, safeJsonParse } from "./ai-fetch";
import { BRAND_VOICE } from "./brand-voice";
import { getActiveAnchorsForMonths } from "./anchors";
import { translateEventAllLangsOneShot } from "./event-translate";
import {
  EVENT_CATEGORIES,
  viennaDayKey,
  viennaWallToUtcIso,
  viennaWeekWindow,
  type EventCategory,
} from "./events-format";

export type WeeklyResult = {
  ok: boolean;
  inserted: number;
  skipped: number;
  error?: string;
};
export type WeekResult = WeeklyResult & { weekStart: string };
export type AutoResult = {
  ok: boolean;
  weeks: { weekStart: string; inserted: number; skipped: number; ok: boolean; error?: string }[];
  purged: number;
  error?: string;
};

const DAY_MS = 86400000;
const MAX_INSERT = 50; // Runaway-Schutz (Ziel sind kuratierte ~12–20 pro Woche)
const PURGE_DRAFT_DAYS = 14; // nie veröffentlichte Entwürfe so lange nach dem Event behalten

function normWall(v: unknown): string {
  if (typeof v !== "string") return "";
  const m = v.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]}T${m[2]}` : "";
}
function coerceCategory(v: unknown): EventCategory {
  return EVENT_CATEGORIES.includes(v as EventCategory)
    ? (v as EventCategory)
    : "kultur";
}
function normTitle(t: string): string {
  return t.toLowerCase().replace(/\s+/g, " ").trim();
}
// Nächster Kalendertag (YYYY-MM-DD) – für das Aufsplitten mehrtägiger Events.
function nextDayKey(dayKey: string): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + DAY_MS)
    .toISOString()
    .slice(0, 10);
}
// Realistische Default-Dauer je Kategorie, wenn die KI keine End-Uhrzeit belegt
// (Endzeit soll fast immer gesetzt sein -> Kalender bleibt für den User klar).
const DEFAULT_END_HOURS: Record<string, number> = {
  party: 4, // Konzerte/Festivals/Clubbing laufen lang
  tradition: 4, // Zelt-/Dorf-/Almfeste
  kultur: 2.5, // Theater/Film/Vernissage/Lesung/Workshop
  kids: 2, // Familienprogramm
};
function defaultEndHours(cat: EventCategory): number {
  return DEFAULT_END_HOURS[cat] ?? 3;
}

// Entfernt reine Wochentag-/Tageszeit-Zusätze am Titel-Ende (z.B. "(Sa)",
// "(So Abend)", "– Sonntag Vormittag"). Tag & Uhrzeit stehen separat in start/end,
// gehören also NICHT in den Titel. Zwei Termine am selben Tag unterscheidet die Zeit.
const DAY_WORD =
  "mo|di|mi|do|fr|sa|so|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag";
const DAY_PART = "vormittag|nachmittag|abend|nacht|mittag|früh|morgens|mittags|abends";
const DAY_SUFFIX_PAREN = new RegExp(
  `\\s*[\\(\\[]\\s*(?:${DAY_WORD})\\.?(?:\\s+(?:${DAY_PART}))?\\s*[\\)\\]]\\s*$`,
  "i",
);
const DAY_SUFFIX_SEP = new RegExp(
  `\\s*[-–—|,]\\s*(?:am\\s+)?(?:${DAY_WORD})\\.?\\s+(?:${DAY_PART})\\s*$`,
  "i",
);
// Tages-Nummern & Programm-Phasen mehrtägiger Festivals am Titel-Ende raus:
// "– Tag 1", "(Day 2)", "Tag 3 (Opening Ceremony)", "(Relive Show / Closing)".
// Der Titel ist der echte Festivalname; die Tage macht der Code selbst (toRows).
// "– Tag 1", "| Day 2", "– Tag 3 (Opening Ceremony)" – Trenner PFLICHT, damit
// Prosa wie "Konzert am Tag 3" NICHT angetastet wird.
const DAY_NUM_SEP = /\s*[-–—|]\s*(?:tag|day)\s*\d+\s*(?:[([][^)\]]*[)\]])?\s*$/i;
// "(Tag 2)", "(Day 1 …)" – Tages-Nummer in Klammern.
const DAY_NUM_PAREN = /\s*[([]\s*(?:tag|day)\s*\d+[^)\]]*[)\]]\s*$/i;
// Reine Programm-Phasen in Klammern am Ende: "(Opening Ceremony)", "(Relive Show / Closing)".
const PHASE_SUFFIX =
  /\s*[-–—|]?\s*[([][^)\]]*\b(?:ceremony|opening|closing|halftime|relive)\b[^)\]]*[)\]]\s*$/i;
function cleanTitle(t: string): string {
  let out = t.trim();
  for (let i = 0; i < 3; i++) {
    const before = out;
    out = out
      .replace(DAY_SUFFIX_PAREN, "")
      .replace(DAY_SUFFIX_SEP, "")
      .replace(DAY_NUM_SEP, "")
      .replace(DAY_NUM_PAREN, "")
      .replace(PHASE_SUFFIX, "")
      .trim();
    if (out === before) break; // fertig, sobald sich nichts mehr ändert
  }
  return out || t.trim(); // nie leer machen
}

// Saison-/Dachkampagnen & Regions-Slogans sind KEINE konkreten Events. Als
// Sicherheitsnetz raus, wenn so etwas als Ganztags-"Event" durchrutscht.
const UMBRELLA_RE =
  /\b(almsommer|bergsommer|wandersommer|wanderherbst|wanderfrühling|genusssommer|genussherbst|genussfrühling|saison(?:start|auftakt|eröffnung|beginn)|sommerauftakt|winterauftakt)\b/i;

// Dedup-Schlüssel: gleicher Tag + gleiche Start-STUNDE + gleicher Titel = Dublette.
// Die Stunde verhindert, dass zwei echte Termine desselben Events am selben Tag
// (z.B. Konzert 11:00 und 19:00) fälschlich zu einem zusammenfallen.
function dedupKey(startsAtIso: string, title: string): string {
  return `${viennaDayKey(startsAtIso)}::${startsAtIso.slice(11, 13)}::${normTitle(title)}`;
}

const AI_HEADERS = (key: string) => ({
  "x-api-key": key,
  "anthropic-version": "2023-06-01",
  "content-type": "application/json",
});

// Aggregatoren / Fremd-Eventkalender, die NICHT als offizielle Quelle zählen.
const AGGREGATOR_HINT =
  "Fremd-Eventkalender/Aggregatoren wie wasmachma.at, meinbezirk.at, eventfinder, regiondo, ticketmaster, oeticket, eventbrite, tripadvisor, facebook";

type RawEvent = {
  title?: string;
  title_en?: string;
  description?: string;
  description_en?: string;
  category?: string;
  emoji?: string;
  start?: string;
  end?: string;
  all_day?: boolean;
  is_free?: boolean;
  location_name?: string;
  source_url?: string;
};

// Schritt 1: Web-Recherche (Events einer Kalenderwoche, ganzes Land Salzburg).
async function researchWeek(
  fromKey: string,
  toKey: string,
  key: string,
): Promise<string | null> {
  const year = fromKey.slice(0, 4);

  // Anker-Check: bekannte Jahres-Highlights, deren typisches Zeitfenster den Monat
  // der Zielwoche berührt -> als „nicht vergessen zu prüfen"-Erinnerung in den Prompt
  // (token-schlau: nur die relevanten). WICHTIG: nur Erinnerung, KEIN Terminbeleg –
  // Datum/Uhrzeit werden von der KI live über die offizielle Quelle verifiziert.
  const weekMonths = Array.from(
    new Set([Number(fromKey.slice(5, 7)), Number(toKey.slice(5, 7))]),
  );
  const anchors = await getActiveAnchorsForMonths(weekMonths);
  const anchorBlock = anchors.length
    ? `\nANKER-CHECK (bekannte Jahres-Highlights, die typischerweise in diesem Zeitraum laufen – NICHT übersehen, aber AUCH NICHT blind übernehmen):\n${anchors
        .map(
          (a) =>
            `- ${a.name} (${a.region}, ${a.timing})${a.free === "ja" ? " · gratis" : ""}${
              a.note ? ` · ACHTUNG: ${a.note}` : ""
            } → ${a.url}`,
        )
        .join(
          "\n",
        )}\nPrüfe für JEDES dieser Events über die OFFIZIELLE Quelle, ob es WIRKLICH in dieser Woche (${fromKey}–${toKey}, ${year}) stattfindet, und hol Datum + Uhrzeit von dort. NUR aufnehmen, wenn die offizielle Quelle es für DIESE Woche in ${year} bestätigt. Diese Liste ist nur eine ERINNERUNG, KEIN Terminbeleg: Events können verschoben, schon vorbei, erst später, an einem anderen Ort oder heuer gar nicht sein (manche nur alle paar Jahre) – im Zweifel WEGLASSEN. Nutze die Anker ZUSÄTZLICH zur normalen Sparten-Suche, nicht als Ersatz.`
    : "";

  const system = `Du recherchierst Veranstaltungen im gesamten Land Salzburg (Österreich) – Stadt Salzburg, Flachgau, Tennengau, Pongau, Pinzgau, Lungau – für ${fromKey} bis ${toKey} (Montag–Sonntag, Jahr ${year}).
ZIEL: Wir sind DER KURATIERTE Wochen-Guide („der Adventkalender für junge Leute") für Salzburg – für junge LOCALS (ca. 18–35, Uni-/Szene-Stadt) UND junge REISENDE (ca. 18–40), die authentisch statt touristisch unterwegs sind. Beide sind allergisch auf Tourismus-Marketing/Kitsch und wollen echte Erlebnisse, lokale Szene, Atmosphäre – oft gratis/leistbar. Zeig die BESTEN, coolsten Highlights der Woche – KURATIERT, abwechslungsreich, nicht jedes Kleinevent, der User soll NICHT von der Menge erschlagen werden.
SUCH GEZIELT und GETRENNT in JEDER Sparte (mehrere eigene Suchanfragen – nicht nur nach dem naheliegendsten Groß-Event), und wähle je die Highlights:
- Musik & Party: Festivals, Open-Airs, angesagte Konzerte, Clubnächte, Partys, DJ-Sets. PRÜFE aktiv die städtische Club-/Kulturszene (z.B. ARGEkultur, Rockhouse, Jazzit, Stadtwerk, Festungs-/Open-Air-Konzerte, lokale Club-/Electronic-Szene / Salzburg Club Commission) – gerade wenn die Woche sonst dünn wirkt.
- Sport & Action: Motorsport (z.B. Salzburgring), größere Lauf-/Rad-/MTB-/Kletter-Events, Turniere.
- Outdoor & Wellness: besondere Yoga-/Wellness-Events, Open-Air-Kino.
- Kultur & Kreativ: Vernissagen, Theater/Tanz, Film, Comedy/Kabarett, coole Workshops, Poetry Slam.
- Food & Drink: Street-Food-/Genuss-Festivals, besondere Craft-Beer-/Wein-Events.
- Traditionelles & Regionales, wenn cool/erlebenswert: Zelt-/Dorf-/Almfeste, Brauchtum mit Erlebnis.
SO PRIORISIERST DU (genau das, was die Zielgruppe NICHT verpassen will – ranke höher):
1. Seltene, saisonale, EINMAL-IM-JAHR-Highlights der Region = „jetzt oder nie": Salzburger Festspiele (inkl. jungem/gratis Nebenprogramm wie „jung & jeder" und Siemens Fest>Spiel>Nächte am Kapitelplatz), Electric Love, Jazz & The City, Rupertikirtag, Salzburger Dult, Almabtriebe & konkrete Bauernherbst-Feste, Mozartwoche, Ski-Weltcup, Krampus-/Perchtenläufe, Advent-/Christkindlmarkt-Specials.
2. Live-Musik/Konzerte/Open-Airs & Club-/Electronic-Nächte – der Puls der jungen Szene. In der „Stadt ohne Clubs" zählen REIHEN/KOLLEKTIVE & Szene-Häuser: Rockhouse (v.a. „Local Heroes"), ARGEkultur, Szene, Jazzit (gratis „Jazzit:Sessions"), MARK, Kerzenfabrik, Galerie5020, Soda Club, Salzburg Club Commission.
3. Outdoor & Sport als VOLLWERTIGE Säule: Trailruns/Berg-/Community-Läufe, MTB/Rad, Klettern, See-/Bade-Events, Skitouren, Salzburgring-Motorsport, FC Red Bull Salzburg (Heimspiele/Public Viewing).
4. Junge Kultur mit Erlebnis: Open-Air-/Freiluftkino, Poetry Slam, Kabarett/Comedy, Vernissagen/freie Szene, queere Events (Pride, Drag).
5. Food/Genuss & authentisches, LAUTES Brauchtum mit Gaudi-Faktor (Bierzelt, Feuershow, Umzug) – KEIN museales Trachten-Klischee.
GRATIS & atmosphärische Events (freier Eintritt, starke Kulisse) besonders wertschätzen. Stadt UND Region ausbalancieren (Salzburgring, Leogang, Saalfelden, Gastein, Seenregion) – die Zielgruppe ist mobil.
SAISON beachten: passend zur Jahreszeit DIESER Woche (Sommer: Open-Airs/Festivals/Seen/Freiluftkino; Herbst: Kirtag/Bauernherbst/Trailrun; Winter: Advent/Krampus/Ski/Bälle; Frühling: Dult/Maibaum) – nichts Saison-Fremdes.
MEIDEN (Touristen-Kitsch, NIE als Highlight): überteuerte, für Touristen inszenierte Formate wie „Mozart-Dinner"-Konzerte, Sound-of-Music-Bustouren, Pseudo-Folklore-Dinnershows, Souvenir-/Mozartkugel-Events. Echte Hochkultur (Festspiele) ja – aber die authentischen/leistbaren Zugänge bevorzugen.
VIELFALT IST PFLICHT: Die Woche darf NICHT von einem einzigen Event oder einer einzigen Reihe dominiert werden. Von DERSELBEN Veranstaltungsreihe / demselben Festival (z.B. Salzburger Festspiele) höchstens ca. 2–3 echte Highlights – NICHT jedes Einzelkonzert. Ein mehrtägiges Festival zählt als EINE Reihe (EIN Eintrag, siehe MEHRTÄGIG) – KEINE doppelten Einträge desselben Events, keine „Warm-Up/Ceremony/Tag X"-Varianten zusätzlich. Große Kultur-/Musik-Events dürfen dabei sein, aber sorge AKTIV für Balance über ALLE Sparten. Wenn eine Reihe die Woche zu dominieren droht, kürze sie und such gezielt weiter nach coolen Events in den anderen Sparten (Party/Konzerte, Sport/Motorsport, Outdoor/Yoga, Food, cooles Traditionelles).
NUR KONKRETE EINZEL-EVENTS: Jedes Event braucht ein festes Datum, eine feste Uhrzeit und einen konkreten Ort/Veranstalter. KEINE Saison-Auftakte, Dach-/Werbekampagnen, Regions-/Sammelbegriffe oder Tourismus-Slogans als Event (z.B. „Almsommer", „Bergsommer", „Wanderherbst", „Genussfrühling", „Saisonstart") – das sind KEINE Veranstaltungen. Ein „ganztägig"-Eintrag muss ein echtes, konkretes Ganztags-Format an EINEM Ort sein (ein bestimmtes Fest/ein bestimmter Markt an genau diesem Tag), niemals ein allgemeiner Saison-/Regionsbegriff über das ganze Land.
Für jedes Event: exakter Titel (OHNE Wochentag/Datum/Tageszeit im Titel), exaktes Datum; Ort/Location; worum es geht; passende Kategorie; ob der Eintritt GRATIS ist (nur wenn nachweislich frei); OFFIZIELLE Detailseite.
UHRZEIT – WICHTIG: Die START-Uhrzeit MUSS von der Quelle belegt sein. Rate oder runde sie NIEMALS. Übernimm die exakt dokumentierte Anfangszeit (z.B. „ab 7:00", „Beginn 20:15"). Nimm die BEGINN-Zeit, NICHT die Einlass-/Doors-Zeit (wenn beides angegeben ist – z.B. „Einlass 19:00, Beginn 20:00" -> 20:00). Widersprechen sich Quellen bei der Uhrzeit, gilt die offizielle Veranstalter-/Location-Seite. Findest du KEINE belegte Startzeit, aber das Event ist ein echtes GANZTAGS-/Mehrpunkt-Format ohne eine einheitliche Anfangszeit (z.B. Stadt-/Eröffnungsfest mit vielen Programmpunkten an mehreren Orten, durchgehender Markt/Kirtag) -> kennzeichne es als GANZTÄGIG, statt eine Startzeit zu erfinden. Nur die END-Uhrzeit darf – wenn nicht belegt – aus der Event-Art realistisch geschätzt werden.
MEHRTÄGIG (Festivals wie Electric Love): Gib das Festival GENAU EINMAL an – mit den EXAKTEN Von–Bis-Daten und der täglichen Uhrzeit (Beginn/Ende). Liste NICHT jeden Tag einzeln, erfinde KEINE Zusatztage über das echte Ende hinaus, und schreibe NIEMALS Tages-Nummern oder Programm-Phasen („Tag 1", „Day 2", „Opening/Halftime/Closing Ceremony", „Relive Show") in den Titel. (Die einzelnen Festivaltage legt das System selbst sauber an.)
JAHR – SEHR WICHTIG: Wir sind im Jahr ${year}. Übernimm NUR Events, die nachweislich ${year} an genau diesem Datum stattfinden. Viele Seiten zeigen eine Ausgabe aus einem FRÜHEREN Jahr (gleicher Tag/Monat, aber falsches Jahr) – solche NIEMALS übernehmen und NIEMALS auf ${year} umdatieren. Prüfe die Jahreszahl auf der Quelle; ist sie nicht eindeutig ${year}, lass das Event weg. Nimm ${year} aktiv in deine Suchanfragen auf.
VERSCHIEBUNG/ABSAGE: Prüfe auf der offiziellen Quelle, ob ein Event VERSCHOBEN oder ABGESAGT wurde (auch wetterbedingt). Steht ein neuer/anderer Termin außerhalb dieser Woche oder „abgesagt/entfällt/verschoben" -> NICHT in diese Woche aufnehmen.
QUELLE: konkrete Event-Detailseite des Veranstalters/der Location (mit Datum/Programm/Tickets). Bevorzuge IMMER die EIGENE Seite des Veranstalters/der Location (z.B. salzburgerfestspiele.at, argekultur.at, burg-kaprun.at) gegenüber Tourismus-Portalen – NICHT eine allgemeine Kalender-Startseite oder ein Tourismus-Portal (z.B. salzburg.info, stadt-salzburg.at, salzburgerland.com, zellamsee-kaprun.com) und NICHT ${AGGREGATOR_HINT}; ggf. Deep-Link zum einzelnen Eintrag.
UMFANG: KURATIERTE Auswahl der BESTEN Highlights – Richtwert ca. 10–20 Events (mehr bei wirklich voller Woche, in einer ruhigen Woche ruhig deutlich weniger). Qualität & Vielfalt vor Vollständigkeit. Lieber WENIGER echte Highlights als mit schwachen oder unsicheren Events zur Zielzahl AUFFÜLLEN – fülle NIE auf und erfinde nichts, nur Belegtes. Gleiche Touring-Show/Reihe an mehreren Orten (z.B. Straßentheater, tägliche Kammerkonzerte): NICHT jeden Termin – höchstens 1–2 pro Woche (die coolsten/zentralsten). JEDER Termin braucht EINEN konkreten Ort + Uhrzeit; KEINE Sammel-Einträge wie „Verschiedene Orte" oder ein Show-Termin als „ganztägig". Fasse als deutsche Stichpunkt-Liste zusammen (ein Block pro Event, mit offizieller Quelle und – wenn vorhanden – belegter Startzeit; sonst Vermerk „ganztägig").${anchorBlock}`;

  let messages: { role: string; content: unknown }[] = [
    {
      role: "user",
      content: `Finde die BESTEN ~12–20 coolen Highlights im Land Salzburg von ${fromKey} bis ${toKey} (Mo–So, Jahr ${year}) für junge Leute – kuratiert & abwechslungsreich über die Sparten (Musik/Party, Sport, Outdoor, Kultur/Workshops, Food, cooles Traditionelles). Jeweils mit Start- UND End-Uhrzeit und offizieller Quelle. Achte streng auf das Jahr ${year} (keine Vorjahres-Events). Mehrtägige Festivals: jeden Tag getrennt.`,
    },
  ];
  let last: {
    stop_reason?: string;
    content?: { type: string; text?: string }[];
  } | null = null;

  try {
    for (let guard = 0; guard < 8; guard++) {
      const res = await fetchWithRetry(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: AI_HEADERS(key),
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 6000,
            system,
            messages,
            tools: [
              {
                type: "web_search_20250305",
                name: "web_search",
                max_uses: 11,
                user_location: {
                  type: "approximate",
                  country: "AT",
                  region: "Salzburg",
                  city: "Salzburg",
                  timezone: "Europe/Vienna",
                },
              },
            ],
          }),
        },
        1,
        120000,
      );
      if (!res.ok) return null;
      last = await res.json();
      if (last?.stop_reason === "pause_turn") {
        messages = [...messages, { role: "assistant", content: last.content }];
        continue;
      }
      break;
    }
  } catch {
    return null;
  }

  const research = (last?.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text as string)
    .join("\n")
    .trim();
  return research || null;
}

// Schritt 2: Recherche-Text -> strukturierte Event-Liste (erzwungenes Tool).
async function structureWeek(
  research: string,
  fromKey: string,
  key: string,
): Promise<RawEvent[]> {
  const year = fromKey.slice(0, 4);
  const system = `${BRAND_VOICE}

AUFGABE: Wandle die Recherche in eine Liste von Events um. Gib sie AUSSCHLIESSLICH über das Tool "weekly_events" zurück. Das Feld "events" MUSS ein echtes JSON-Array von Objekten sein (NICHT als String!).
Pro Event:
- title: der ECHTE Veranstaltungsname. NIEMALS den Wochentag, das Datum oder eine Tageszeit in den Titel schreiben (kein "(Sa)", "(So Abend)", "Sonntag Vormittag", "13.07." o.ä.) – Tag & Uhrzeit stehen separat in start/end. Zwei Termine desselben Events am selben Tag unterscheidest du über die start-Uhrzeit (bzw. das konkrete Programm), NICHT über einen Titel-Zusatz.
- description (1 KNAPPER Satz, max ~20 Wörter, nur belegte Fakten).
- title_en, description_en: natürliche ENGLISCHE Übersetzung (kurz, sinngemäß, kein Wort-für-Wort; Eigennamen behalten).
- category (party | tradition | kultur | sport | kids) – beste Zuordnung: party = Pop-/Rock-/Indie-/Electronic-Konzerte, Festivals, Partys, Clubbing, DJ-Sets; kultur = Jazz-/Klassik-/Weltmusik-Konzerte UND Kunst/Theater/Film/Ausstellung/Lesung/Comedy/Workshop/Yoga/Wellness (Jazz z.B. im Jazzit = kultur, NICHT party); sport = ALLES Sportliche/Outdoor (Motorsport/Salzburgring, Läufe/Trailruns/Marathon/Radrennen/MTB, Triathlon, Ski-/Snowboard-Weltcup, Turniere, Fußball) – Sport-Events IMMER sport, NIE party/kultur; tradition = Volksfeste/Brauchtum/Kirtag/Almabtrieb/Regionales; kids = Familie/Kinder.
- is_free: true NUR, wenn der Eintritt nachweislich GRATIS ist (öffentlicher Platz / „Eintritt frei"). Bei Ticket/Startgeld/nur-teilweise-frei -> false. Im Zweifel false – KEINE falschen Gratis-Versprechen.
- emoji: EIN passendes Emoji.
- start / end: "YYYY-MM-DDTHH:mm" in WIENER Zeit (Woche ab ${fromKey}, Jahr ${year}). Die START-Uhrzeit MUSS in der Recherche BELEGT sein – NIEMALS raten oder runden; übernimm die exakt dokumentierte Anfangszeit und zwar die BEGINN-Zeit, NICHT die Einlass-/Doors-Zeit. Ist KEINE Startzeit belegt: dann NICHT erfinden -> stattdessen all_day=true (siehe unten) oder Event weglassen. Gib FAST IMMER auch eine End-Uhrzeit ("end") an: steht sie nicht wörtlich in der Recherche, schätze ein realistisches Ende aus der Event-Art (Konzert/Party/Clubbing ~3–5 h, Theater/Film/Vernissage/Lesung ~2 h, Fest/Markt mehrere Std.). Die END-Zeit darf geschätzt werden, die START-Zeit NICHT.
- all_day: FAST IMMER false. true bei (a) einem ECHTEN Ganztags-Format ohne Anfangszeit (durchgehender Markt, Ausstellung) ODER (b) einem echten Ganztags-/Mehrpunkt-STADTFEST/Eröffnungsfest mit vielen Programmpunkten an mehreren Orten ohne EINE einheitliche Startzeit (z.B. „Fest zur Festspieleröffnung"). Lieber all_day=true als eine Startzeit erfinden. Ein Konzert/Kino/Vorstellung/Party/Fest MIT belegter Anfangszeit ist NIEMALS ganztägig -> die belegte Startzeit verwenden.
- MEHRTÄGIG: Ein echtes mehrtägiges Festival (z.B. Electric Love 09.–11. Juli) gibst du als GENAU EINEN Eintrag mit voller Spanne zurück: start = ERSTER Tag + Startzeit, end = LETZTER Tag + Endzeit. NICHT selbst pro Tag aufsplitten, KEINE Tages-Nummern/Ceremony-Namen im Titel, KEINE Duplikate, KEINE Tage über das echte Ende hinaus. Das System legt daraus automatisch pro Festivaltag EINEN sauberen Eintrag mit IDENTISCHEM Titel an.
- JAHR: start und end MÜSSEN im Jahr ${year} liegen (die recherchierte Woche). Verschiebe NIEMALS ein Event aus einem anderen Jahr auf ${year}; belegt die Recherche kein ${year}-Datum, lass das Event weg.
- ROUTINE-Reihen dagegen, die (fast) täglich als Standard-/Touristenprogramm laufen (tägliche Kammerkonzerte "Schlosskonzerte Mirabell", Standard-Führungen): NICHT jeden Tag wiederholen – höchstens EIN knapper Eintrag für die Woche, oder ganz weglassen. Das sind KEINE krassen Highlights.
- VIELFALT: Von DERSELBEN Veranstaltungsreihe / demselben Festival (z.B. Salzburger Festspiele) höchstens ca. 2–3 Einträge – NICHT jedes Einzelkonzert derselben Reihe. Die Liste muss ausgewogen über die Sparten streuen; eine einzige Reihe darf die Woche NICHT dominieren.
- NUR KONKRETE EINZEL-EVENTS: KEINE Saison-Auftakte, Dach-/Werbekampagnen, Regions-/Sammelbegriffe oder Tourismus-Slogans als Event (z.B. „Almsommer SalzburgerLand", „Bergsommer", „Wanderherbst", „Genussfrühling", „Saisonstart"). Jedes Event = feste Zeit + konkreter Ort/Veranstalter. Ein region-weiter Sammelbegriff über das ganze Land ist KEIN Event -> weglassen.
- UMFANG: KURATIERE die BESTEN, coolsten Highlights für junge Locals (18–35) UND junge Reisende (18–40) – Richtwert ca. 10–20 Events, abwechslungsreich über die Sparten (Musik/Party, Sport/Motorsport, Outdoor/Yoga, Kultur/Workshops, Food, cooles Traditionelles). Behalte beim Kürzen die seltenen „nicht verpassen"-Jahres-Highlights (Festspiele, Electric Love, Rupertikirtag, Jazz & The City, Almabtriebe, Krampus/Perchten, Advent-Specials …) UND einen bunten Szene-Mix; GRATIS/atmosphärische Events bevorzugen. Touristen-Kitsch (Mozart-Dinner-Shows, Sound-of-Music-Touren, Souvenir-/Mozartkugel-Formate) NICHT als Highlight. NICHT jedes Kleinevent, und in einer ruhigen Woche lieber WENIGER als mit schwachen/unsicheren Events auffüllen (nie auffüllen, nichts erfinden). Gleiche Touring-Show/Reihe an mehreren Orten (z.B. Straßentheater, tägliche Kammerkonzerte): höchstens 1–2 pro Woche, NICHT jeden Termin; jeder Termin mit konkretem Ort + Uhrzeit (kein „Verschiedene Orte", kein Show-Termin als ganztägig).
- location_name (Name des Orts/der Location, z.B. "Residenzplatz, Salzburg").
- source_url: die KONKRETE Event-/Detailseite (eigene Unterseite genau dieses Events beim Veranstalter/der Location, mit Datum/Programm/Tickets) – NICHT eine allgemeine Veranstaltungskalender-/Übersichts-/Startseite und KEIN ${AGGREGATOR_HINT}. Lieber die tiefe Event-Unterseite als eine generische Kalender-URL.
GROUNDING: nur belegte Events, mit konkreter Uhrzeit. Unsicheres Datum -> weglassen. Dublette = GLEICHES Event am GLEICHEN Tag; ein echtes mehrtägiges Festival an VERSCHIEDENEN Tagen ist KEINE Dublette.`;

  // Genug Token für die kuratierte Liste (~12–20 Events mit EN), ohne Truncation.
  const body = JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 12000,
    system,
    messages: [{ role: "user", content: `RECHERCHE:\n${research}` }],
    tools: [
      {
        name: "weekly_events",
        description: "Die strukturierte Liste der gefundenen Events.",
        input_schema: {
          type: "object",
          properties: {
            events: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  title_en: { type: "string" },
                  description: { type: "string" },
                  description_en: { type: "string" },
                  category: {
                    type: "string",
                    enum: ["party", "tradition", "kultur", "sport", "kids"],
                  },
                  emoji: { type: "string" },
                  start: { type: "string" },
                  end: { type: "string" },
                  all_day: { type: "boolean" },
                  is_free: { type: "boolean" },
                  location_name: { type: "string" },
                  source_url: { type: "string" },
                },
                required: [
                  "title",
                  "description",
                  "category",
                  "start",
                  "all_day",
                  "location_name",
                ],
              },
            },
          },
          required: ["events"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "weekly_events" },
  });

  // Das Modell liefert die Liste mal als echtes Array, mal als JSON-String,
  // selten leer (nicht-deterministisch) -> bis zu 3 Versuche, erster mit Events gewinnt.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchWithRetry(
        "https://api.anthropic.com/v1/messages",
        { method: "POST", headers: AI_HEADERS(key), body },
        1,
        90000,
      );
      if (!res.ok) continue;
      const data = await res.json();
      const block = (data.content ?? []).find(
        (b: { type: string; name?: string }) =>
          b.type === "tool_use" && b.name === "weekly_events",
      ) as { input?: unknown } | undefined;
      const events = extractEvents(block?.input);
      if (events.length > 0) return events;
    } catch {
      // nächster Versuch
    }
  }
  return [];
}

// Robustes Auslesen: das Modell liefert `events` manchmal als echtes Array,
// manchmal als JSON-STRING (oft fast-valide -> jsonrepair). input kann ebenfalls
// ein String sein. safeJsonParse repariert nicht-escapte Quotes etc.
function extractEvents(input: unknown): RawEvent[] {
  let inp: unknown = input;
  if (typeof inp === "string") {
    inp = safeJsonParse(inp);
    if (inp === undefined) return [];
  }
  let events = (inp as { events?: unknown })?.events;
  if (typeof events === "string") {
    events = safeJsonParse(events);
    if (events === undefined) return [];
  }
  return Array.isArray(events) ? (events as RawEvent[]) : [];
}

// RawEvent -> DB-Zeile(n). Ein Event kann MEHRERE Zeilen ergeben:
//  - Mehrtägiges Event (Enddatum später + Gesamtdauer > 14 h -> kein reines
//    Über-Mitternacht-Event) wird in EINEN Eintrag PRO TAG aufgesplittet, jeder mit
//    Tages-Start-/-End-Uhrzeit -> im Kalender klar pro Tag statt ein 3-Tage-Block.
//  - Endzeit-Pflicht: fehlt eine belegte Endzeit und ist es kein Ganztags-Event,
//    wird eine realistische Default-Dauer je Kategorie gesetzt.
// Der Wochen-Guard (inkl. Jahr!) verwirft jede Zeile ausserhalb der Kalenderwoche –
// so landet ein falsch datiertes (z.B. Vorjahres-)Event nie in der Woche.
function toRows(ev: RawEvent, startIso: string, endIso: string): Record<string, unknown>[] {
  const title = cleanTitle((ev.title ?? "").trim());
  const allDay = Boolean(ev.all_day);
  // Startzeit: bei Ganztags-Events reicht ein reines Datum (dann 00:00), damit ein
  // korrekt als „ganztägig" markiertes Event nicht mangels Uhrzeit verworfen wird.
  let startWall = normWall(ev.start);
  if (!startWall && allDay) {
    const d = (ev.start ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
    if (d) startWall = `${d[1]}T00:00`;
  }
  if (!title || !startWall) return [];
  // Saison-/Dachkampagne als Ganztags-„Event" -> kein konkretes Event, verwerfen.
  if (allDay && UMBRELLA_RE.test(title)) return [];
  const category = coerceCategory(ev.category);
  const startDay = startWall.slice(0, 10);
  const startTod = startWall.slice(11, 16);
  const endWall = normWall(ev.end);
  const endDay = endWall ? endWall.slice(0, 10) : "";
  const endTod = endWall ? endWall.slice(11, 16) : "";

  const baseFields = {
    title,
    title_en: (ev.title_en ?? "").trim() || null,
    description: (ev.description ?? "").trim() || null,
    description_en: (ev.description_en ?? "").trim() || null,
    emoji: (ev.emoji ?? "").trim() || null,
    all_day: allDay,
    location_name: (ev.location_name ?? "").trim() || null,
    category,
    is_highlight: false,
    is_free: Boolean(ev.is_free),
    source_url: (ev.source_url ?? "").trim() || null,
    status: "draft", // immer Entwurf -> Admin prüft & veröffentlicht
  };

  // Segmente [Start-Wandzeit, End-Wandzeit|""] bestimmen. Standard: EIN Segment.
  let segments: { s: string; e: string }[] = [{ s: startWall, e: endWall }];
  if (endDay && endDay > startDay && !allDay) {
    const sMs = Date.parse(viennaWallToUtcIso(startWall) ?? "");
    const eMs = Date.parse(viennaWallToUtcIso(endWall) ?? "");
    const spanH = Number.isFinite(sMs) && Number.isFinite(eMs) ? (eMs - sMs) / 3_600_000 : 0;
    // > 14 h + späterer Kalendertag => echtes mehrtägiges Event (kein Über-Mitternacht).
    if (spanH > 14) {
      const sameDayEnd = endTod > startTod ? endTod : ""; // sonst Default-Dauer pro Tag
      segments = [];
      let day = startDay;
      for (let i = 0; i < 14 && day <= endDay; i++) {
        segments.push({ s: `${day}T${startTod}`, e: sameDayEnd ? `${day}T${sameDayEnd}` : "" });
        day = nextDayKey(day);
      }
    }
  }

  const rows: Record<string, unknown>[] = [];
  for (const seg of segments) {
    const startsAt = viennaWallToUtcIso(seg.s);
    if (!startsAt) continue;
    const t = Date.parse(startsAt);
    // Wochen-Guard: nur Zeilen, die WIRKLICH in dieser Kalenderwoche (inkl. Jahr) liegen.
    if (t < Date.parse(startIso) || t >= Date.parse(endIso)) continue;

    let endsAt: string | null = null;
    if (seg.e) {
      const e = viennaWallToUtcIso(seg.e);
      if (e && Date.parse(e) > t) endsAt = e;
    }
    // Endzeit-Pflicht: kein belegtes Ende + kein Ganztags-Event -> Default-Dauer.
    if (!endsAt && !allDay) {
      endsAt = new Date(t + defaultEndHours(category) * 3_600_000).toISOString();
    }

    rows.push({ ...baseFields, starts_at: startsAt, ends_at: endsAt });
  }
  return rows;
}

// Übersetzt die (deutschen) Event-Zeilen IN-PLACE in alle Sprachen (best-effort). Bündelt nach
// Inhalt (mehrtägige Events teilen sich Titel/Text -> nur 1× übersetzen) und begrenzt die
// Parallelität. Setzt je Zeile `translations` (JSONB) + `source_hash` (= veröffentlichbar-Marke).
async function translateRowsInPlace(
  rows: Record<string, unknown>[],
  key: string,
): Promise<void> {
  if (!rows.length) return;
  const byContent = new Map<
    string,
    { title: string; description: string; rows: Record<string, unknown>[] }
  >();
  for (const row of rows) {
    const title = String(row.title ?? "").trim();
    const description = String(row.description ?? "").trim();
    if (!title) continue;
    const ck = `${title} ${description}`;
    const entry = byContent.get(ck) ?? { title, description, rows: [] };
    entry.rows.push(row);
    byContent.set(ck, entry);
  }
  const unique = [...byContent.values()];
  const CONC = 5; // begrenzte Parallelität – Rate-Limit-schonend
  for (let i = 0; i < unique.length; i += CONC) {
    const batch = unique.slice(i, i + CONC);
    await Promise.all(
      batch.map(async (u) => {
        const r = await translateEventAllLangsOneShot(
          { title: u.title, description: u.description },
          key,
        );
        if (r.ok && r.translations && r.sourceHash) {
          for (const row of u.rows) {
            row.translations = r.translations;
            row.source_hash = r.sourceHash;
          }
        }
      }),
    );
  }
}

// EINE Kalenderwoche recherchieren (weekOffset: 0=aktuell,1=nächste,2=übernächste),
// Drafts anlegen (Dedup + Wochen-Guard) und die Woche im Log vermerken.
export async function runWeekResearch(weekOffset: number): Promise<WeekResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  const now = new Date();
  const w = viennaWeekWindow(now, weekOffset);
  const base = { inserted: 0, skipped: 0, weekStart: w.mondayKey };
  if (!key) return { ok: false, ...base, error: "ANTHROPIC_API_KEY fehlt" };

  const research = await researchWeek(w.mondayKey, w.sundayKey, key);
  if (!research)
    return {
      ok: false,
      ...base,
      error: "Keine Recherche-Ergebnisse – bitte Anthropic-Guthaben & Web-Suche prüfen.",
    };

  const raw = await structureWeek(research, w.mondayKey, key);
  const supabase = createServiceClient();

  // Dedup-Set aus bereits vorhandenen Events GENAU dieser Woche.
  const { data: existing } = await supabase
    .from("events")
    .select("title, starts_at")
    .gte("starts_at", w.startIso)
    .lt("starts_at", w.endIso);
  const seen = new Set(
    (existing ?? []).map((e: { title: string; starts_at: string }) =>
      dedupKey(e.starts_at, e.title),
    ),
  );

  // Ein Roh-Event kann mehrere Zeilen ergeben (mehrtägig -> pro Tag eine Zeile).
  const rows: Record<string, unknown>[] = [];
  let usedRaw = 0; // wie viele Roh-Events mind. eine Zeile beisteuerten
  for (const ev of raw) {
    if (rows.length >= MAX_INSERT) break;
    let usedThis = false;
    for (const row of toRows(ev, w.startIso, w.endIso)) {
      if (rows.length >= MAX_INSERT) break;
      const dupKey = dedupKey(row.starts_at as string, row.title as string);
      if (seen.has(dupKey)) continue;
      seen.add(dupKey);
      rows.push(row);
      usedThis = true;
    }
    if (usedThis) usedRaw++;
  }

  const skipped = Math.max(0, raw.length - usedRaw);

  // Übersetzungen (alle 9 Sprachen) GLEICH mitgenerieren -> der Admin muss NICHT je Event
  // manuell „In alle Sprachen übersetzen" klicken (Effizienz-Ziel: 1 Klick = fertig & übersetzt).
  // Best-effort: nach Inhalt gebündelt (mehrtägige Events teilen sich Titel/Text -> nur 1× über-
  // setzen), ein Claude-Call je Event für ALLE Sprachen, mit begrenzter Parallelität. Schlägt eine
  // Übersetzung fehl, bleibt das Event trotzdem (Deutsch-Fallback); der 🌍-Badge zeigt es an.
  await translateRowsInPlace(rows, key);

  if (rows.length) {
    let { error } = await supabase.from("events").insert(rows);
    // Vor Migration 0032 existieren translations/source_hash nicht -> ohne sie einfügen (DE-Only).
    if (error && (error.code === "42703" || /column .* does not exist/i.test(error.message))) {
      const stripped = rows.map((r) => {
        const rest: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r))
          if (k !== "translations" && k !== "source_hash") rest[k] = v;
        return rest;
      });
      ({ error } = await supabase.from("events").insert(stripped));
    }
    if (error)
      return { ok: false, inserted: 0, skipped, weekStart: w.mondayKey, error: error.message };
  }

  // Woche als recherchiert protokollieren (auch bei 0 neuen -> Cron sucht nicht erneut).
  await supabase.from("event_research_log").upsert(
    {
      week_start: w.mondayKey,
      inserted: rows.length,
      skipped,
      researched_at: new Date().toISOString(),
    },
    { onConflict: "week_start" },
  );

  return { ok: true, inserted: rows.length, skipped, weekStart: w.mondayKey };
}

// Selbst-Pflege: nie veröffentlichte Entwürfe löschen, deren Event länger als
// PURGE_DRAFT_DAYS vorbei ist. Veröffentlichte Events bleiben IMMER erhalten.
async function purgeStaleDrafts(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<number> {
  const cutoff = new Date(Date.now() - PURGE_DRAFT_DAYS * DAY_MS).toISOString();
  const { data, error } = await supabase
    .from("events")
    .delete()
    .eq("status", "draft")
    .lt("starts_at", cutoff)
    .select("id");
  return error ? 0 : (data?.length ?? 0);
}

// Automatischer Lauf (Cron): aktuelle + nächste + übernächste Woche, aber nur die
// noch NICHT protokollierten -> jede Woche wird genau einmal gesucht, rollt weiter.
// Danach alte, nie veröffentlichte Entwürfe aufräumen (Selbst-Pflege).
export async function runAutoWeeklyResearch(): Promise<AutoResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, weeks: [], purged: 0, error: "ANTHROPIC_API_KEY fehlt" };

  const supabase = createServiceClient();
  const now = new Date();
  const weeks: AutoResult["weeks"] = [];

  for (const offset of [0, 1, 2]) {
    const w = viennaWeekWindow(now, offset);
    const { data: logged } = await supabase
      .from("event_research_log")
      .select("week_start")
      .eq("week_start", w.mondayKey)
      .maybeSingle();
    if (logged) continue; // schon recherchiert -> nie doppelt suchen

    const r = await runWeekResearch(offset);
    weeks.push({
      weekStart: w.mondayKey,
      inserted: r.inserted,
      skipped: r.skipped,
      ok: r.ok,
      error: r.error,
    });
  }

  const purged = await purgeStaleDrafts(supabase);
  return { ok: true, weeks, purged };
}
