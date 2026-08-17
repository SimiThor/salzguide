// Zieht die Zeitangaben in den Fliesstexten auf die neu gerechnete Dauer nach. Aufruf:
//   npm run wp:fix-hiking-texts          zeigt, was passieren würde
//   npm run wp:fix-hiking-texts -- --go  schreibt
//
// WARUM ES DAS BRAUCHT: Die Dauer steht zweimal — im Feld und im Satz daneben („Gut zehn
// Stunden für hin und zurück"). `wp:hiking-times` rechnet das Feld neu, der Satz bleibt
// stehen. Auf der Spot-Seite stehen dann sieben Stunden über einem Absatz, der zehn sagt.
//
// WARUM KEIN REGEL-ERSETZER, SONDERN EINE LISTE: „Sechs Stunden" wird auf Polnisch zu
// „Cztery i pół godziny" — das Zahlwort regiert den Fall des Substantivs, aus „godzin"
// (Genitiv Plural) wird „godziny". Dasselbe in Tschechisch, Slowakisch, Ungarisch,
// Niederländisch. Eine Maschine, die nur Zahlwörter tauscht, produziert dreizehn Sprachen
// mit falscher Grammatik, und auffallen würde es niemandem hier. Also steht jeder Satz
// einzeln da, mit seiner Sprache.
//
// GEFUNDEN HAT DIE STELLEN `npm run wp:audit` (Block WIDERSPRUCH, Feld „Dauer <lang>"),
// und derselbe Lauf ist danach die Abnahme: Er muss null melden.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { hashSpotTexts } from "../../src/lib/spot-hash.ts";
import { LOCALE_CODES } from "../../src/i18n/locales.ts";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Env fehlt (.env.local)");
const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

/** Je Sprache eine Liste [alt, neu]. Gross-/Kleinschreibung zählt: Satzanfang gegen Satzmitte. */
type Fix = { slug: string; alt: string; neu: string; texte: Record<string, [string, string][]> };

const FIXES: Fix[] = [
  {
    slug: "schafberg",
    alt: "10 Std 10 min",
    neu: "7 Std",
    texte: {
      de: [["gut zehn Stunden", "gut sieben Stunden"], ["Gut zehn Stunden", "Gut sieben Stunden"]],
      en: [["a good ten hours", "a good seven hours"], ["A good ten hours", "A good seven hours"]],
      it: [["dieci ore abbondanti", "sette ore abbondanti"], ["Dieci ore abbondanti", "Sette ore abbondanti"]],
      nl: [["ruim tien uur", "ruim zeven uur"], ["Ruim tien uur", "Ruim zeven uur"]],
      fr: [["une bonne dizaine d'heures", "sept heures"], ["Une bonne dizaine d'heures", "Sept heures"]],
      es: [["diez horas largas", "siete horas largas"], ["Diez horas largas", "Siete horas largas"]],
      pt: [["umas boas dez horas", "umas boas sete horas"], ["Umas boas dez horas", "Umas boas sete horas"]],
      pl: [["dobre dziesięć godzin", "dobre siedem godzin"], ["Dobre dziesięć godzin", "Dobre siedem godzin"]],
      cs: [["dobrých deset hodin", "dobrých sedm hodin"], ["Dobrých deset hodin", "Dobrých sedm hodin"]],
      sk: [["dobrých desať hodín", "dobrých sedem hodín"], ["Dobrých desať hodín", "Dobrých sedem hodín"]],
      hu: [["jó tíz óra", "jó hét óra"], ["Jó tíz óra", "Jó hét óra"]],
      ko: [["열 시간", "일곱 시간"], ["열시간", "일곱 시간"]],
      zh: [["十小时出头", "七小时"], ["十个小时出头", "七个小时"]],
    },
  },
  {
    slug: "gamskarkogel",
    alt: "13 Std 35 min",
    neu: "9 Std",
    texte: {
      de: [["dreizehneinhalb Stunden", "neun Stunden"], ["Dreizehneinhalb Stunden", "Neun Stunden"]],
      en: [["thirteen and a half hours", "nine hours"], ["Thirteen and a half hours", "Nine hours"]],
      it: [["tredici ore e mezza", "nove ore"], ["Tredici ore e mezza", "Nove ore"]],
      nl: [["dertieneneenhalf uur", "negen uur"], ["Dertieneneenhalf uur", "Negen uur"]],
      fr: [["treize heures et demie", "neuf heures"], ["Treize heures et demie", "Neuf heures"]],
      es: [["trece horas y media", "nueve horas"], ["Trece horas y media", "Nueve horas"]],
      pt: [["treze horas e meia", "nove horas"], ["Treze horas e meia", "Nove horas"]],
      pl: [["trzynaście i pół godziny", "dziewięć godzin"], ["Trzynaście i pół godziny", "Dziewięć godzin"]],
      cs: [["třináct a půl hodiny", "devět hodin"], ["Třináct a půl hodiny", "Devět hodin"]],
      sk: [["trinásť a pol hodiny", "deväť hodín"], ["Trinásť a pol hodiny", "Deväť hodín"]],
      hu: [["tizenhárom és fél óra", "kilenc óra"], ["Tizenhárom és fél óra", "Kilenc óra"]],
      ko: [["열세 시간 반", "아홉 시간"]],
      zh: [["十三个半小时", "九小时"]],
    },
  },
  {
    slug: "almwelt-lofer",
    alt: "6 Std",
    neu: "4,5 Std",
    texte: {
      de: [["Sechs Stunden", "Viereinhalb Stunden"]],
      en: [["Six hours", "Four and a half hours"]],
      it: [["Sei ore", "Quattro ore e mezza"]],
      nl: [["Zes uur", "Viereneenhalf uur"]],
      fr: [["Six heures", "Quatre heures et demie"]],
      es: [["Seis horas", "Cuatro horas y media"]],
      pt: [["Seis horas", "Quatro horas e meia"]],
      pl: [["Sześć godzin", "Cztery i pół godziny"]],
      cs: [["Šest hodin", "Čtyři a půl hodiny"]],
      sk: [["Šesť hodín", "Štyri a pol hodiny"]],
      hu: [["Hat óra", "Négy és fél óra"]],
      ko: [["여섯 시간", "네 시간 반"]],
      zh: [["六小时", "四个半小时"]],
    },
  },
  {
    slug: "ellmautal",
    alt: "3 Std 5 min",
    neu: "2 Std",
    texte: {
      de: [["gut drei Stunden", "gut zwei Stunden"], ["Gut drei Stunden", "Gut zwei Stunden"]],
      en: [["a good three hours", "a good two hours"], ["A good three hours", "A good two hours"]],
      it: [["tre ore abbondanti", "due ore abbondanti"], ["Tre ore abbondanti", "Due ore abbondanti"]],
      nl: [["ruim drie uur", "ruim twee uur"], ["Ruim drie uur", "Ruim twee uur"]],
      fr: [["trois bonnes heures", "deux bonnes heures"], ["Trois bonnes heures", "Deux bonnes heures"]],
      es: [["tres horas largas", "dos horas largas"], ["Tres horas largas", "Dos horas largas"]],
      pt: [["umas boas três horas", "umas boas duas horas"], ["Umas boas três horas", "Umas boas duas horas"]],
      pl: [["dobre trzy godziny", "dobre dwie godziny"], ["Dobre trzy godziny", "Dobre dwie godziny"]],
      cs: [["dobré tři hodiny", "dobré dvě hodiny"], ["Dobré tři hodiny", "Dobré dvě hodiny"]],
      sk: [["dobré tri hodiny", "dobré dve hodiny"], ["Dobré tri hodiny", "Dobré dve hodiny"]],
      hu: [["bő három óra", "bő két óra"], ["Bő három óra", "Bő két óra"]],
      ko: [["세 시간 남짓", "두 시간 남짓"]],
      zh: [["三小时出头", "两小时"], ["三个多小时", "两个小时"]],
    },
  },
  {
    slug: "falkensteinwand",
    alt: "3 Std 50 min",
    neu: "2,5 Std",
    texte: {
      de: [["Knapp vier Stunden", "Zweieinhalb Stunden"]],
      en: [["Just under four hours", "Two and a half hours"]],
      it: [["Quasi quattro ore", "Due ore e mezza"]],
      nl: [["Krap vier uur", "Tweeënhalf uur"]],
      fr: [["Presque quatre heures", "Deux heures et demie"]],
      es: [["Casi cuatro horas", "Dos horas y media"]],
      pt: [["Quase quatro horas", "Duas horas e meia"]],
      pl: [["Niecałe cztery godziny", "Dwie i pół godziny"]],
      cs: [["Necelé čtyři hodiny", "Dvě a půl hodiny"]],
      sk: [["Necelé štyri hodiny", "Dve a pol hodiny"]],
      hu: [["Alig négy óra", "Két és fél óra"]],
      ko: [["왕복 네 시간이 채 안 되고", "왕복 두 시간 반이고"]],
      zh: [["不到四小时", "两个半小时"], ["将近四小时", "两个半小时"]],
    },
  },
  {
    slug: "gamskogerl",
    alt: "5 Std 10 min",
    neu: "3,5 Std",
    texte: {
      de: [["Gut fünf Stunden", "Dreieinhalb Stunden"]],
      en: [["A good five hours", "Three and a half hours"]],
      it: [["Cinque ore abbondanti", "Tre ore e mezza"]],
      nl: [["Ruim vijf uur", "Drieëneenhalf uur"]],
      fr: [["cinq bonnes heures", "trois heures et demie"], ["Cinq bonnes heures", "Trois heures et demie"]],
      es: [["Cinco horas largas", "Tres horas y media"]],
      pt: [["Umas boas cinco horas", "Três horas e meia"]],
      pl: [["Dobre pięć godzin", "Trzy i pół godziny"]],
      cs: [["Dobrých pět hodin", "Tři a půl hodiny"]],
      sk: [["Dobrých päť hodín", "Tri a pol hodiny"]],
      hu: [["Jó öt óra", "Három és fél óra"]],
      ko: [["다섯 시간 남짓", "세 시간 반"]],
      zh: [["五小时出头", "三个半小时"], ["五个多小时", "三个半小时"]],
    },
  },
  {
    slug: "lackenkogel",
    alt: "5 Std 55 min",
    neu: "4,5 Std",
    texte: {
      de: [["Knapp sechs Stunden", "Viereinhalb Stunden"]],
      en: [["Just under six hours", "Four and a half hours"]],
      it: [["Quasi sei ore", "Quattro ore e mezza"]],
      nl: [["Krap zes uur", "Viereneenhalf uur"]],
      fr: [["Un peu moins de six heures", "Quatre heures et demie"]],
      es: [["Casi seis horas", "Cuatro horas y media"]],
      pt: [["Quase seis horas", "Quatro horas e meia"]],
      pl: [["Niecałe sześć godzin", "Cztery i pół godziny"]],
      cs: [["Necelých šest hodin", "Čtyři a půl hodiny"]],
      sk: [["Necelých šesť hodín", "Štyri a pol hodiny"]],
      hu: [["Kis híján hat óra", "Négy és fél óra"]],
      // Das längere Muster zuerst: sonst frisst das kurze den Satzrest weg und übrig
      // bleibt „왕복 네 시간 반 걸립니다" ohne Subjektpartikel.
      ko: [["왕복 여섯 시간 가까이 걸립니다", "왕복 네 시간 반이 걸립니다"], ["왕복 여섯 시간 가까이", "왕복 네 시간 반"]],
      zh: [["将近六小时", "四个半小时"], ["六小时", "四个半小时"]],
    },
  },
  {
    slug: "schmittenhohe",
    alt: "6 Std 5 min",
    neu: "4,5 Std",
    texte: {
      de: [["Gut sechs Stunden", "Viereinhalb Stunden"], ["Nach sechs Stunden Aufstieg", "Nach viereinhalb Stunden Aufstieg"]],
      en: [["A good six hours", "Four and a half hours"], ["after six hours of climbing", "after four and a half hours of climbing"]],
      it: [["Sei ore abbondanti", "Quattro ore e mezza"], ["Dopo sei ore di salita", "Dopo quattro ore e mezza di salita"]],
      nl: [["Ruim zes uur", "Viereneenhalf uur"], ["Na zes uur klimmen", "Na viereneenhalf uur klimmen"]],
      fr: [["Après six heures de montée", "Après quatre heures et demie de montée"], ["Six bonnes heures", "Quatre heures et demie"], ["Six heures", "Quatre heures et demie"]],
      es: [["Seis horas largas", "Cuatro horas y media"], ["Después de seis horas de subida", "Después de cuatro horas y media de subida"]],
      pt: [["Umas boas seis horas", "Quatro horas e meia"], ["Depois de seis horas a subir", "Depois de quatro horas e meia a subir"]],
      pl: [["Dobre sześć godzin", "Cztery i pół godziny"]],
      cs: [["Dobrých šest hodin", "Čtyři a půl hodiny"]],
      sk: [["Dobrých šesť hodín", "Štyri a pol hodiny"]],
      hu: [["Jó hat óra", "Négy és fél óra"], ["Hat óra kaptató után", "Négy és fél óra kaptató után"]],
      ko: [["여섯 시간 남짓", "네 시간 반"], ["여섯 시간 올라온 뒤에", "네 시간 반 올라온 뒤에"]],
      zh: [["六小时", "四个半小时"]],
    },
  },
  {
    slug: "schuhflickersee",
    alt: "3 Std",
    neu: "2 Std",
    texte: {
      de: [["drei Stunden für hin und zurück", "zwei Stunden für hin und zurück"], ["Drei Stunden für hin und zurück", "Zwei Stunden für hin und zurück"]],
      en: [["three hours there and back", "two hours there and back"], ["Three hours there and back", "Two hours there and back"]],
      it: [["tre ore tra andata e ritorno", "due ore tra andata e ritorno"], ["Tre ore tra andata e ritorno", "Due ore tra andata e ritorno"]],
      nl: [["drie uur heen en terug", "twee uur heen en terug"], ["Drie uur heen en terug", "Twee uur heen en terug"]],
      fr: [["trois heures aller-retour", "deux heures aller-retour"], ["Trois heures aller-retour", "Deux heures aller-retour"]],
      es: [["tres horas ida y vuelta", "dos horas ida y vuelta"], ["Tres horas ida y vuelta", "Dos horas ida y vuelta"]],
      pt: [["três horas ida e volta", "duas horas ida e volta"], ["Três horas ida e volta", "Duas horas ida e volta"]],
      pl: [["trzy godziny tam i z powrotem", "dwie godziny tam i z powrotem"], ["Trzy godziny tam i z powrotem", "Dwie godziny tam i z powrotem"]],
      cs: [["tři hodiny tam a zpátky", "dvě hodiny tam a zpátky"], ["Tři hodiny tam a zpátky", "Dvě hodiny tam a zpátky"]],
      sk: [["tri hodiny tam a späť", "dve hodiny tam a späť"], ["Tri hodiny tam a späť", "Dve hodiny tam a späť"]],
      hu: [["három óra oda-vissza", "két óra oda-vissza"], ["Három óra oda-vissza", "Két óra oda-vissza"]],
      ko: [["왕복 세 시간", "왕복 두 시간"]],
      zh: [["三小时", "两小时"], ["三个小时", "两个小时"]],
    },
  },
  {
    slug: "spinnerin",
    alt: "5 Std 45 min",
    neu: "4,5 Std",
    texte: {
      de: [["knapp sechs Stunden", "viereinhalb Stunden"], ["Knapp sechs Stunden", "Viereinhalb Stunden"]],
      en: [["just under six hours", "four and a half hours"], ["Just under six hours", "Four and a half hours"]],
      it: [["quasi sei ore", "quattro ore e mezza"], ["Quasi sei ore", "Quattro ore e mezza"]],
      nl: [["krap zes uur", "viereneenhalf uur"], ["Krap zes uur", "Viereneenhalf uur"]],
      fr: [["un peu moins de six heures", "quatre heures et demie"], ["Un peu moins de six heures", "Quatre heures et demie"]],
      es: [["casi seis horas", "cuatro horas y media"], ["Casi seis horas", "Cuatro horas y media"]],
      pt: [["quase seis horas", "quatro horas e meia"], ["Quase seis horas", "Quatro horas e meia"]],
      pl: [["niecałe sześć godzin", "cztery i pół godziny"], ["Niecałe sześć godzin", "Cztery i pół godziny"]],
      cs: [["necelých šest hodin", "čtyři a půl hodiny"], ["Necelých šest hodin", "Čtyři a půl hodiny"]],
      sk: [["necelých šesť hodín", "štyri a pol hodiny"], ["Necelých šesť hodín", "Štyri a pol hodiny"]],
      hu: [["alig hat óra", "négy és fél óra"], ["Alig hat óra", "Négy és fél óra"]],
      ko: [["여섯 시간이 채 안 걸리고", "네 시간 반이고"], ["여섯 시간이 채 안 되고", "네 시간 반이고"]],
      zh: [["不到六小时", "四个半小时"], ["将近六小时", "四个半小时"]],
    },
  },
  {
    slug: "tappenkar-wasserfall",
    alt: "4 Std 20 min",
    neu: "3 Std",
    texte: {
      de: [["Vier Stunden zwanzig", "Drei Stunden"]],
      en: [["Four hours twenty", "Three hours"]],
      it: [["Quattro ore e venti", "Tre ore"]],
      nl: [["Vier uur twintig", "Drie uur"]],
      fr: [["Quatre heures vingt", "Trois heures"]],
      es: [["Cuatro horas veinte", "Tres horas"]],
      pt: [["Quatro horas e vinte", "Três horas"]],
      pl: [["Cztery godziny dwadzieścia", "Trzy godziny"]],
      cs: [["Čtyři hodiny dvacet", "Tři hodiny"]],
      sk: [["Štyri hodiny dvadsať", "Tri hodiny"]],
      hu: [["Négy óra húsz perc", "Három óra"]],
      ko: [["왕복 네 시간 이십 분", "왕복 세 시간"]],
      zh: [["四小时二十分", "三小时"], ["四个小时二十分钟", "三个小时"]],
    },
  },
  {
    slug: "tappenkarsee",
    alt: "6 Std",
    neu: "4,5 Std",
    texte: {
      de: [["sechs Stunden für hin und zurück", "viereinhalb Stunden für hin und zurück"], ["Sechs Stunden für hin und zurück", "Viereinhalb Stunden für hin und zurück"]],
      en: [["six hours there and back", "four and a half hours there and back"], ["Six hours there and back", "Four and a half hours there and back"]],
      it: [["sei ore tra andata e ritorno", "quattro ore e mezza tra andata e ritorno"], ["Sei ore tra andata e ritorno", "Quattro ore e mezza tra andata e ritorno"]],
      nl: [["zes uur heen en terug", "viereneenhalf uur heen en terug"], ["Zes uur heen en terug", "Viereneenhalf uur heen en terug"]],
      fr: [["six heures aller-retour", "quatre heures et demie aller-retour"], ["Six heures aller-retour", "Quatre heures et demie aller-retour"]],
      es: [["seis horas ida y vuelta", "cuatro horas y media ida y vuelta"], ["Seis horas ida y vuelta", "Cuatro horas y media ida y vuelta"]],
      pt: [["seis horas ida e volta", "quatro horas e meia ida e volta"], ["Seis horas ida e volta", "Quatro horas e meia ida e volta"]],
      pl: [["sześć godzin tam i z powrotem", "cztery i pół godziny tam i z powrotem"], ["Sześć godzin tam i z powrotem", "Cztery i pół godziny tam i z powrotem"]],
      cs: [["šest hodin tam a zpět", "čtyři a půl hodiny tam a zpět"], ["Šest hodin tam a zpět", "Čtyři a půl hodiny tam a zpět"]],
      sk: [["šesť hodín tam a späť", "štyri a pol hodiny tam a späť"], ["Šesť hodín tam a späť", "Štyri a pol hodiny tam a späť"]],
      hu: [["hat óra oda-vissza", "négy és fél óra oda-vissza"], ["Hat óra oda-vissza", "Négy és fél óra oda-vissza"]],
      ko: [["왕복 여섯 시간", "왕복 네 시간 반"]],
      zh: [["六小时", "四个半小时"], ["六个小时", "四个半小时"]],
    },
  },
  {
    slug: "tristkogel",
    alt: "7 Std 35 min",
    neu: "5,5 Std",
    texte: {
      de: [["siebeneinhalb Stunden", "fünfeinhalb Stunden"], ["Siebeneinhalb Stunden", "Fünfeinhalb Stunden"]],
      en: [["seven and a half hours", "five and a half hours"], ["Seven and a half hours", "Five and a half hours"]],
      it: [["sette ore e mezza", "cinque ore e mezza"], ["Sette ore e mezza", "Cinque ore e mezza"]],
      nl: [["zeveneneenhalf uur", "vijfeneenhalf uur"], ["Zeveneneenhalf uur", "Vijfeneenhalf uur"]],
      fr: [["sept heures et demie", "cinq heures et demie"], ["Sept heures et demie", "Cinq heures et demie"]],
      es: [["siete horas y media", "cinco horas y media"], ["Siete horas y media", "Cinco horas y media"]],
      pt: [["sete horas e meia", "cinco horas e meia"], ["Sete horas e meia", "Cinco horas e meia"]],
      pl: [["siedem i pół godziny", "pięć i pół godziny"], ["Siedem i pół godziny", "Pięć i pół godziny"]],
      cs: [["sedm a půl hodiny", "pět a půl hodiny"], ["Sedm a půl hodiny", "Pět a půl hodiny"]],
      sk: [["sedem a pol hodiny", "päť a pol hodiny"], ["Sedem a pol hodiny", "Päť a pol hodiny"]],
      hu: [["hét és fél óra", "öt és fél óra"], ["Hét és fél óra", "Öt és fél óra"]],
      ko: [["일곱 시간 반", "다섯 시간 반"]],
      zh: [["七个半小时", "五个半小时"]],
    },
  },
  {
    slug: "zwolferhorn",
    alt: "4 Std 10 min",
    neu: "3 Std",
    texte: {
      de: [["gut vier Stunden", "drei Stunden"], ["Gut vier Stunden", "Drei Stunden"]],
      en: [["a good four hours", "three hours"], ["A good four hours", "Three hours"]],
      it: [["quattro ore abbondanti", "tre ore"], ["Quattro ore abbondanti", "Tre ore"]],
      nl: [["ruim vier uur", "drie uur"], ["Ruim vier uur", "Drie uur"]],
      fr: [["quatre bonnes heures", "trois heures"], ["Quatre bonnes heures", "Trois heures"]],
      es: [["cuatro horas largas", "tres horas"], ["Cuatro horas largas", "Tres horas"]],
      pt: [["umas boas quatro horas", "três horas"], ["Umas boas quatro horas", "Três horas"]],
      pl: [["dobre cztery godziny", "trzy godziny"], ["Dobre cztery godziny", "Trzy godziny"]],
      cs: [["dobré čtyři hodiny", "tři hodiny"], ["Dobré čtyři hodiny", "Tři hodiny"]],
      sk: [["dobré štyri hodiny", "tri hodiny"], ["Dobré štyri hodiny", "Tri hodiny"]],
      hu: [["jó négy óra", "három óra"], ["Jó négy óra", "Három óra"]],
      ko: [["왕복 네 시간 남짓", "왕복 세 시간"]],
      zh: [["四小时出头", "三小时"], ["四个多小时", "三个小时"]],
    },
  },
];


/**
 * ZWEITE RUNDE. Die erste Runde stuetzte sich auf `wp:audit`, und der meldete danach null.
 * Diese Null war falsch: Die Widerspruchs-Schwelle benutzte fuer "passt zum Feld" und "ist
 * zu viel" zwei verschiedene Toleranzen, und in dem Band dazwischen sassen elf weitere
 * Spots mit ihrer alten Zahl (Feld 1 Std, Text "anderthalb Stunden"). Dazu kam, dass die
 * Schwierigkeit gar nicht nachgezogen worden war: Gamskarkogel, Schafberg und Tristkogel
 * stehen jetzt auf "schwer", waehrend im Absatz darunter "Mittelschwer" stand.
 *
 * Diese Liste ist deshalb nicht von Hand getippt, sondern je Sprache formuliert und von
 * einem zweiten, unabhaengigen Leser Satz fuer Satz abgenommen worden. Drei Stellen haben
 * dabei eine Entscheidung gebraucht statt einer Ersetzung, und die steht auf Deutsch fest:
 *
 *  - Sigmund-Thun-Klamm: "Ohne den See bist du deutlich schneller durch." OHNE Zahl. Die
 *    ganze Runde dauert jetzt eine Stunde; stuende daneben weiter "ohne den See in einer
 *    knappen Stunde", waeren beide Varianten gleich lang. Fuer die kurze Variante gibt es
 *    keinen gemessenen Wert, also kommt dort auch keiner hin.
 *  - Tristkogel: Nach dem Doppelpunkt steht die Begruendung der Einstufung. Nur das Etikett
 *    auf "Schwer" zu tauschen liesse die Begruendung mit zwei Argumenten DAGEGEN beginnen,
 *    also werden die Haelften getauscht.
 *  - Prinzensee: "technisch einfach" statt "einfach", weil "einfach" genau das Faktenwort
 *    fuer die Stufe leicht ist und daneben jetzt "mittel" steht.
 */
const FIXES_RUNDE2: Fix[] = [
  {
    slug: "gamskarkogel",
    alt: "Stufe mittel",
    neu: "9 Std",
    texte: {
      de: [
        ["Mittelschwer, technisch harmlos", "Schwer, technisch harmlos"],
      ],
      en: [
        ["Moderate, technically harmless", "Hard, technically harmless"],
      ],
      it: [
        ["Difficoltà media, tecnicamente non c'è niente", "Difficoltà alta, tecnicamente non c'è niente"],
      ],
      nl: [
        ["Middelzwaar, technisch onschuldig", "Zwaar, technisch onschuldig"],
      ],
      fr: [
        ["Difficulté moyenne", "Difficile"],
      ],
      es: [
        ["Dificultad media", "Dificultad alta"],
      ],
      pt: [
        ["Dificuldade média, tecnicamente inofensivo", "Difícil, tecnicamente inofensivo"],
      ],
      pl: [
        ["Średnio trudna", "Trudna"],
      ],
      cs: [
        ["Středně těžké, technicky nenáročné", "Těžké, technicky nenáročné"],
      ],
      sk: [
        ["Stredne ťažké, technicky neškodné", "Ťažké, technicky neškodné"],
      ],
      hu: [
        ["Közepes, technikailag ártalmatlan", "Nehéz, technikailag ártalmatlan"],
      ],
      ko: [
        ["중급이고", "상급이고"],
      ],
      zh: [
        ["中等难度，技术上没什么", "难度大，技术上倒没什么"],
      ],
    },
  },
  {
    slug: "gollinger-wasserfall",
    alt: "1 Std 25 min",
    neu: "1 Std",
    texte: {
      de: [
        ["Knapp anderthalb Stunden für hin und zurück", "Eine Stunde für hin und zurück"],
      ],
      en: [
        ["Just under an hour and a half", "An hour"],
      ],
      it: [
        ["Quasi un'ora e mezza tra andata e ritorno", "Un'ora tra andata e ritorno"],
      ],
      nl: [
        ["Krap anderhalf uur", "Een uur"],
      ],
      fr: [
        ["Une petite heure et demie", "Une heure"],
      ],
      es: [
        ["Poco menos de hora y media ida y vuelta", "Una hora ida y vuelta"],
      ],
      pt: [
        ["Pouco menos de hora e meia", "Uma hora"],
      ],
      pl: [
        ["Niecałe półtorej godziny", "Godzina"],
      ],
      cs: [
        ["Necelá hodina a půl tam a zpátky", "Hodina tam a zpátky"],
      ],
      sk: [
        ["Necelá hodina a pol tam a späť", "Hodina tam a späť"],
      ],
      hu: [
        ["Alig másfél óra", "Egy óra"],
      ],
      ko: [
        ["한 시간 반이 채 안 되고,", "한 시간,"],
      ],
      zh: [
        ["往返不到一个半小时", "往返一小时"],
      ],
    },
  },
  {
    slug: "groser-barmstein",
    alt: "1 Std 30 min",
    neu: "1 Std",
    texte: {
      de: [
        ["Anderthalb Stunden für hin und zurück, das passt", "Eine Stunde für hin und zurück, das passt"],
        ["Anderthalb Stunden für hin und zurück, 2,6 Kilometer", "Eine Stunde für hin und zurück, 2,6 Kilometer"],
      ],
      en: [
        ["An hour and a half", "An hour"],
        ["An hour and a half", "An hour"],
      ],
      it: [
        ["Un'ora e mezza tra andata e ritorno", "Un'ora tra andata e ritorno"],
        ["Un'ora e mezza tra andata e ritorno", "Un'ora tra andata e ritorno"],
      ],
      nl: [
        ["Anderhalf uur", "Een uur"],
        ["Anderhalf uur", "Een uur"],
      ],
      fr: [
        ["Une heure et demie", "Une heure"],
        ["Une heure et demie", "Une heure"],
      ],
      es: [
        ["Hora y media ida y vuelta", "Una hora ida y vuelta"],
        ["Hora y media ida y vuelta", "Una hora ida y vuelta"],
      ],
      pt: [
        ["Hora e meia", "Uma hora"],
        ["Hora e meia", "Uma hora"],
      ],
      pl: [
        ["Półtorej godziny", "Godzina"],
        ["Półtorej godziny", "Godzina"],
      ],
      cs: [
        ["Hodina a půl tam a zpátky, to se vejde", "Hodina tam a zpátky, to se vejde"],
        ["Hodina a půl tam a zpátky, 2,6 kilometru", "Hodina tam a zpátky, 2,6 kilometru"],
      ],
      sk: [
        ["Hodina a pol tam a späť, to sa vojde", "Hodina tam a späť, to sa vojde"],
        ["Hodina a pol tam a späť, 2,6 kilometra", "Hodina tam a späť, 2,6 kilometra"],
      ],
      hu: [
        ["Másfél óra oda-vissza", "Egy óra oda-vissza"],
        ["Másfél óra oda-vissza", "Egy óra oda-vissza"],
      ],
      ko: [
        ["왕복 한 시간 반이라", "왕복 한 시간이라"],
        ["왕복 한 시간 반,", "왕복 한 시간,"],
      ],
      zh: [
        ["往返一个半小时", "往返一小时"],
        ["往返一个半小时", "往返一小时"],
      ],
    },
  },
  {
    slug: "hochkeil-spiegelsee",
    alt: "2 Std 40 min",
    neu: "2 Std",
    texte: {
      de: [
        ["Gut zweieinhalb Stunden für hin und zurück, 300 Höhenmeter", "Zwei Stunden für hin und zurück, 300 Höhenmeter"],
        ["Gut zweieinhalb Stunden für hin und zurück, 5,2 Kilometer", "Zwei Stunden für hin und zurück, 5,2 Kilometer"],
      ],
      en: [
        ["A good two and a half hours", "Two hours"],
        ["A good two and a half hours", "Two hours"],
      ],
      it: [
        ["Due ore e mezza abbondanti tra andata e ritorno", "Due ore tra andata e ritorno"],
        ["Due ore e mezza abbondanti tra andata e ritorno", "Due ore tra andata e ritorno"],
      ],
      nl: [
        ["Ruim tweeënhalf uur", "Twee uur"],
        ["Ruim tweeënhalf uur", "Twee uur"],
      ],
      fr: [
        ["Deux heures et demie bien tassées", "Deux heures"],
        ["Deux heures et demie bien tassées", "Deux heures"],
      ],
      es: [
        ["Dos horas y media largas ida y vuelta", "Dos horas ida y vuelta"],
        ["Dos horas y media largas ida y vuelta", "Dos horas ida y vuelta"],
      ],
      pt: [
        ["Umas boas duas horas e meia ida e volta", "Duas horas ida e volta"],
        ["Umas boas duas horas e meia ida e volta", "Duas horas ida e volta"],
      ],
      pl: [
        ["Dobre dwie i pół godziny", "Dwie godziny"],
        ["Dobre dwie i pół godziny", "Dwie godziny"],
      ],
      cs: [
        ["Dobré dvě a půl hodiny tam a zpátky, 300", "Dvě hodiny tam a zpátky, 300"],
        ["Dobré dvě a půl hodiny tam a zpátky, 5,2", "Dvě hodiny tam a zpátky, 5,2"],
      ],
      sk: [
        ["Dobré dve a pol hodiny tam a späť, 300 výškových metrov", "Dve hodiny tam a späť, 300 výškových metrov"],
        ["Dobré dve a pol hodiny tam a späť, 5,2 kilometra", "Dve hodiny tam a späť, 5,2 kilometra"],
      ],
      hu: [
        ["Bő két és fél óra", "Két óra"],
        ["Bő két és fél óra", "Két óra"],
      ],
      ko: [
        ["왕복 두 시간 반 남짓,", "왕복 두 시간,"],
        ["왕복 두 시간 반 남짓,", "왕복 두 시간,"],
      ],
      zh: [
        ["来回两个半小时出头", "来回两小时"],
        ["来回两个半小时出头", "来回两小时"],
      ],
    },
  },
  {
    slug: "krimmler-wasserfalle",
    alt: "2 Std 10 min",
    neu: "1,5 Std",
    texte: {
      de: [
        ["Gut zwei Stunden für hin und zurück, wenn du", "Anderthalb Stunden für hin und zurück, wenn du"],
        ["Gut zwei Stunden für hin und zurück, 3,4 Kilometer", "Anderthalb Stunden für hin und zurück, 3,4 Kilometer"],
      ],
      en: [
        ["A good two hours", "An hour and a half"],
        ["A good two hours", "An hour and a half"],
      ],
      it: [
        ["Due ore abbondanti fra andata e ritorno", "Un'ora e mezza fra andata e ritorno"],
        ["Due ore abbondanti fra andata e ritorno", "Un'ora e mezza fra andata e ritorno"],
      ],
      nl: [
        ["Ruim twee uur", "Anderhalf uur"],
        ["Ruim twee uur", "Anderhalf uur"],
      ],
      fr: [
        ["Deux bonnes heures", "Une heure et demie"],
        ["Deux bonnes heures", "Une heure et demie"],
      ],
      es: [
        ["Dos horas largas ida y vuelta", "Hora y media ida y vuelta"],
        ["Dos horas largas ida y vuelta", "Hora y media ida y vuelta"],
      ],
      pt: [
        ["Umas boas duas horas", "Uma hora e meia"],
        ["Umas boas duas horas", "Uma hora e meia"],
      ],
      pl: [
        ["Dobre dwie godziny", "Półtorej godziny"],
        ["Dobre dwie godziny", "Półtorej godziny"],
      ],
      cs: [
        ["Dobré dvě hodiny tam a zpátky, pokud", "Hodina a půl tam a zpátky, pokud"],
        ["Dobré dvě hodiny tam a zpátky, 3,4", "Hodina a půl tam a zpátky, 3,4"],
      ],
      sk: [
        ["Dobré dve hodiny tam a späť, ak vyjdeš", "Hodina a pol tam a späť, ak vyjdeš"],
        ["Dobré dve hodiny tam a späť, 3,4 kilometra", "Hodina a pol tam a späť, 3,4 kilometra"],
      ],
      hu: [
        ["Bő két óra", "Másfél óra"],
        ["Bő két óra", "Másfél óra"],
      ],
      ko: [
        ["두 시간 남짓 걸립니다", "한 시간 반 걸립니다"],
        ["왕복 두 시간 남짓,", "왕복 한 시간 반,"],
      ],
    },
  },
  {
    slug: "lammerklamm",
    alt: "1,5 Std",
    neu: "1 Std",
    texte: {
      de: [
        ["rund 1,5 Stunden", "rund eine Stunde"],
      ],
      en: [
        ["about 1.5 hours", "about an hour"],
      ],
      it: [
        ["circa 1,5 ore", "circa un'ora"],
      ],
      nl: [
        ["ongeveer 1,5 uur", "ongeveer een uur"],
      ],
      es: [
        ["unos 1,5 horas", "una hora"],
      ],
      pt: [
        ["cerca de 1,5 horas", "cerca de uma hora"],
      ],
      pl: [
        ["około 1,5 godziny", "około godziny"],
      ],
      cs: [
        ["zhruba 1,5 hodiny", "zhruba hodina"],
      ],
      sk: [
        ["asi 1,5 hodiny", "asi hodina"],
      ],
      hu: [
        ["nagyjából 1,5 óra", "nagyjából egy óra"],
      ],
      ko: [
        ["약 1시간 30분,", "약 1시간,"],
      ],
      zh: [
        ["约1.5小时", "约1小时"],
      ],
    },
  },
  {
    slug: "nockstein",
    alt: "1 Std 40 min",
    neu: "1 Std",
    texte: {
      de: [
        ["Gut anderthalb Stunden für hin und zurück.", "Eine Stunde für hin und zurück."],
        ["Gut anderthalb Stunden für hin und zurück, 2,5 Kilometer", "Eine Stunde für hin und zurück, 2,5 Kilometer"],
      ],
      en: [
        ["A good hour and a half", "An hour"],
        ["A good hour and a half", "An hour"],
      ],
      it: [
        ["Un'ora e mezza abbondante tra andata e ritorno", "Un'ora tra andata e ritorno"],
        ["Un'ora e mezza abbondante tra andata e ritorno", "Un'ora tra andata e ritorno"],
      ],
      nl: [
        ["Ruim anderhalf uur", "Een uur"],
        ["Ruim anderhalf uur", "Een uur"],
      ],
      fr: [
        ["Une bonne heure et demie", "Une heure"],
        ["Une bonne heure et demie", "Une heure"],
      ],
      es: [
        ["Hora y media larga ida y vuelta", "Una hora ida y vuelta"],
        ["Hora y media larga ida y vuelta", "Una hora ida y vuelta"],
      ],
      pt: [
        ["Uma boa hora e meia", "Uma hora"],
        ["Uma boa hora e meia", "Uma hora"],
      ],
      pl: [
        ["Dobre półtorej godziny", "Godzina"],
        ["Dobre półtorej godziny", "Godzina"],
      ],
      cs: [
        ["Dobrá hodina a půl tam a zpátky.", "Hodina tam a zpátky."],
        ["Dobrá hodina a půl tam a zpátky, 2,5", "Hodina tam a zpátky, 2,5"],
      ],
      sk: [
        ["Dobrá hodina a pol tam a späť.", "Hodina tam a späť."],
        ["Dobrá hodina a pol tam a späť, 2,5 kilometra", "Hodina tam a späť, 2,5 kilometra"],
      ],
      hu: [
        ["Bő másfél óra", "Egy óra"],
        ["Bő másfél óra", "Egy óra"],
      ],
      ko: [
        ["한 시간 반 남짓입니다", "한 시간입니다"],
        ["왕복 한 시간 반 남짓,", "왕복 한 시간,"],
      ],
      zh: [
        ["往返一个半小时出头", "往返一小时"],
        ["往返一个半小时出头", "往返一小时"],
      ],
    },
  },
  {
    slug: "oberhutte",
    alt: "4 Std 55 min",
    neu: "4 Std",
    texte: {
      de: [
        ["Knapp fünf Stunden für hin und zurück.", "Vier Stunden für hin und zurück."],
        ["Knapp fünf Stunden für hin und zurück, 10,4 Kilometer", "Vier Stunden für hin und zurück, 10,4 Kilometer"],
      ],
      en: [
        ["Just under five hours", "Four hours"],
        ["Just under five hours", "Four hours"],
      ],
      it: [
        ["Cinque ore scarse tra andata e ritorno", "Quattro ore tra andata e ritorno"],
        ["Cinque ore scarse tra andata e ritorno", "Quattro ore tra andata e ritorno"],
      ],
      nl: [
        ["Krap vijf uur", "Vier uur"],
        ["Krap vijf uur", "Vier uur"],
      ],
      fr: [
        ["Cinq petites heures", "Quatre heures"],
        ["Cinq petites heures", "Quatre heures"],
      ],
      es: [
        ["Cinco horas escasas ida y vuelta", "Cuatro horas ida y vuelta"],
        ["Cinco horas escasas ida y vuelta", "Cuatro horas ida y vuelta"],
      ],
      pt: [
        ["Quase cinco horas", "Quatro horas"],
        ["Quase cinco horas", "Quatro horas"],
      ],
      pl: [
        ["Niecałe pięć godzin", "Cztery godziny"],
        ["Niecałe pięć godzin", "Cztery godziny"],
      ],
      cs: [
        ["Necelých pět hodin tam a zpátky.", "Čtyři hodiny tam a zpátky."],
        ["Necelých pět hodin tam a zpátky, 10,4", "Čtyři hodiny tam a zpátky, 10,4"],
      ],
      sk: [
        ["Necelých päť hodín tam a späť.", "Štyri hodiny tam a späť."],
        ["Necelých päť hodín tam a späť, 10,4 kilometra", "Štyri hodiny tam a späť, 10,4 kilometra"],
      ],
      hu: [
        ["Kis híján öt óra", "Négy óra"],
        ["Kis híján öt óra", "Négy óra"],
      ],
      ko: [
        ["다섯 시간이 조금 안 됩니다", "네 시간입니다"],
        ["왕복 다섯 시간이 조금 안 되고,", "왕복 네 시간,"],
      ],
      zh: [
        ["往返差不多五小时", "往返四小时"],
        ["往返差不多五小时", "往返四小时"],
      ],
    },
  },
  {
    slug: "prinzensee",
    alt: "2 Std 35 min",
    neu: "2 Std",
    texte: {
      de: [
        ["hinauf, gut zweieinhalb Stunden,", "hinauf, zwei Stunden,"],
        ["Gut zweieinhalb Stunden hinauf", "Zwei Stunden hinauf"],
        ["Der Weg selbst ist einfach und gut markiert.", "Der Weg selbst ist technisch einfach und gut markiert."],
      ],
      en: [
        ["a good two and a half hours", "two hours"],
        ["A good two and a half hours", "Two hours"],
        ["The path itself is easy", "The path itself is technically easy"],
      ],
      it: [
        ["due ore e mezza abbondanti", "due ore"],
        ["Due ore e mezza abbondanti in salita", "Due ore in salita"],
        ["è facile e ben segnato", "è tecnicamente facile e ben segnato"],
      ],
      nl: [
        ["ruim tweeënhalf uur", "twee uur"],
        ["Ruim tweeënhalf uur omhoog", "Twee uur omhoog"],
        ["Het pad zelf is eenvoudig", "Het pad zelf is technisch eenvoudig"],
      ],
      fr: [
        ["deux bonnes heures et demie", "deux heures"],
        ["Deux bonnes heures et demie", "Deux heures"],
        ["facile et bien balisé", "techniquement facile et bien balisé"],
      ],
      es: [
        ["dos horas y media largas", "dos horas"],
        ["Dos horas y media largas de subida", "Dos horas de subida"],
        ["El camino en sí es sencillo y está bien marcado.", "El camino en sí es técnicamente sencillo y está bien marcado."],
      ],
      pt: [
        ["umas boas duas horas e meia", "duas horas"],
        ["Umas boas duas horas e meia a subir", "Duas horas a subir"],
        ["O caminho em si é simples e bem marcado.", "O caminho em si é tecnicamente simples e bem marcado."],
      ],
      pl: [
        ["dobre dwie i pół godziny", "dwie godziny"],
        ["Dobre dwie i pół godziny", "Dwie godziny"],
        ["Sama trasa jest prosta", "Sama trasa jest technicznie prosta"],
      ],
      cs: [
        ["dobré dvě a půl hodiny", "dvě hodiny"],
        ["Dobré dvě a půl hodiny nahoru", "Dvě hodiny nahoru"],
        ["je jednoduchá a dobře značená", "je technicky jednoduchá a dobře značená"],
      ],
      sk: [
        ["dobré dve a pol hodiny", "dve hodiny"],
        ["Dobré dve a pol hodiny hore", "Dve hodiny hore"],
        ["Samotná cesta je jednoduchá", "Samotná cesta je technicky jednoduchá"],
      ],
      hu: [
        ["jó két és fél óra", "két óra"],
        ["Jó két és fél óra", "Két óra"],
        ["Maga az út könnyű és jól jelzett.", "Maga az út technikailag könnyű és jól jelzett."],
      ],
      ko: [
        ["두 시간 반 남짓 걸립니다", "두 시간 걸립니다"],
        ["두 시간 반 남짓,", "두 시간,"],
        ["길 자체는 쉽고", "길 자체는 기술적으로 쉽고"],
      ],
      zh: [
        ["两个半小时出头，先穿林子", "两小时，先穿林子"],
        ["上去两个半小时出头", "上去两小时"],
        ["路本身好走", "路本身技术上不难"],
      ],
    },
  },
  {
    slug: "schafberg",
    alt: "Stufe mittel",
    neu: "7 Std",
    texte: {
      de: [
        ["Mittelschwer, technisch machbar", "Schwer, technisch machbar"],
      ],
      en: [
        ["Moderate, technically manageable", "Hard, technically manageable"],
      ],
      it: [
        ["Difficoltà media, tecnicamente fattibile", "Difficoltà alta, tecnicamente fattibile"],
      ],
      nl: [
        ["Middelzwaar, technisch te doen", "Zwaar, technisch te doen"],
      ],
      fr: [
        ["Difficulté moyenne", "Difficile"],
      ],
      es: [
        ["Dificultad media", "Dificultad alta"],
      ],
      pt: [
        ["Dificuldade média, tecnicamente acessível", "Difícil, tecnicamente acessível"],
      ],
      pl: [
        ["Średnio trudna", "Trudna"],
      ],
      cs: [
        ["Středně těžké, technicky zvládnutelné", "Těžké, technicky zvládnutelné"],
      ],
      sk: [
        ["Stredne ťažké, technicky zvládnuteľné", "Ťažké, technicky zvládnuteľné"],
      ],
      hu: [
        ["Közepesen nehéz, technikailag megoldható", "Nehéz, technikailag megoldható"],
      ],
      ko: [
        ["중급이고", "상급이고"],
      ],
      zh: [
        ["中等强度，技术上不难", "强度大，技术上不难"],
      ],
    },
  },
  {
    slug: "schmittenhohe",
    alt: "—",
    neu: "4,5 Std",
    texte: {
      zh: [
        ["上山四个半小时出头", "上山四个半小时"],
      ],
    },
  },
  {
    slug: "sigmund-thun-klamm",
    alt: "1 Std 30 min",
    neu: "1 Std",
    texte: {
      de: [
        ["dauert anderthalb Stunden", "dauert eine Stunde"],
        ["Ohne den See bist du in einer knappen Stunde durch.", "Ohne den See bist du deutlich schneller durch."],
        ["Anderthalb Stunden für den Rundweg", "Eine Stunde für den Rundweg"],
      ],
      en: [
        ["runs an hour and a half", "runs an hour"],
        ["Without the lake you're through in just under an hour.", "Without the lake you're through much faster."],
        ["An hour and a half for the loop", "An hour for the loop"],
      ],
      it: [
        ["dura un'ora e mezza.", "dura un'ora."],
        ["Senza il lago sei fuori in poco meno di un'ora.", "Senza il lago sei fuori molto prima."],
        ["Un'ora e mezza per l'anello", "Un'ora per l'anello"],
      ],
      nl: [
        ["Zonder het meer ben je er in krap een uur doorheen.", "Zonder het meer ben je er duidelijk sneller doorheen."],
        ["Anderhalf uur voor de ronde", "Een uur voor de ronde"],
        ["De rondweg neemt de Klammsee mee en duurt anderhalf uur.", "De rondwandeling neemt de Klammsee mee en duurt een uur."],
      ],
      fr: [
        ["prend une heure et demie", "prend une heure"],
        ["Sans le lac, tu es dehors en une petite heure.", "Sans le lac, tu es dehors bien plus vite."],
        ["Une heure et demie pour la boucle", "Une heure pour la boucle"],
      ],
      es: [
        ["y dura hora y media", "y dura una hora"],
        ["Sin el lago sales en poco menos de una hora.", "Sin el lago sales bastante antes."],
        ["Hora y media para el circuito", "Una hora para el circuito"],
      ],
      pt: [
        ["demora hora e meia", "demora uma hora"],
        ["Sem o lago sais em pouco menos de uma hora.", "Sem o lago sais bem mais depressa."],
        ["Hora e meia para o circuito", "Uma hora para o circuito"],
      ],
      pl: [
        ["zajmuje półtorej godziny", "zajmuje godzinę"],
        ["Bez jeziora przechodzisz w niecałą godzinę.", "Bez jeziora przechodzisz wyraźnie szybciej."],
        ["Półtorej godziny na pętlę", "Godzina na pętlę"],
      ],
      cs: [
        ["trvá hodinu a půl", "trvá hodinu"],
        ["Bez jezera jsi skrz za necelou hodinu.", "Bez jezera jsi skrz o poznání dřív."],
        ["Hodina a půl na okruh", "Hodina na okruh"],
      ],
      sk: [
        ["trvá hodinu a pol", "trvá hodinu"],
        ["Bez jazera si cez ňu za necelú hodinu.", "Bez jazera ňou prejdeš podstatne rýchlejšie."],
        ["Hodina a pol na okruh", "Hodina na okruh"],
      ],
      hu: [
        ["A tó nélkül szűk egy óra alatt átérsz.", "A tó nélkül sokkal gyorsabban átérsz."],
        ["Másfél óra a körút", "Egy óra a körút"],
        ["és másfél óráig tart", "és egy óráig tart"],
      ],
      ko: [
        ["한 시간 반 걸립니다", "한 시간 걸립니다"],
        ["호수를 빼면 한 시간이 채 안 됩니다.", "호수를 빼면 훨씬 빨리 끝납니다."],
        ["순환 코스가 한 시간 반,", "순환 코스가 한 시간,"],
      ],
      zh: [
        ["环线连着 Klammsee 一起走要一个半小时；不走湖，不到一小时就出来了。", "环线连着 Klammsee 一起走要一小时；不走湖会快不少。"],
        ["的环线一个半小时", "的环线一小时"],
      ],
    },
  },
  {
    slug: "sound-of-music-trail",
    alt: "1 Std 50 min",
    neu: "1,5 Std",
    texte: {
      de: [
        ["Knapp zwei Stunden für hin und zurück, gut 230", "Anderthalb Stunden für hin und zurück, gut 230"],
        ["Knapp zwei Stunden für hin und zurück, 2,3 Kilometer", "Anderthalb Stunden für hin und zurück, 2,3 Kilometer"],
      ],
      en: [
        ["Just under two hours", "An hour and a half"],
        ["Just under two hours", "An hour and a half"],
      ],
      it: [
        ["Poco meno di due ore tra andata e ritorno", "Un'ora e mezza tra andata e ritorno"],
        ["Poco meno di due ore tra andata e ritorno", "Un'ora e mezza tra andata e ritorno"],
      ],
      nl: [
        ["Krap twee uur", "Anderhalf uur"],
        ["Krap twee uur", "Anderhalf uur"],
      ],
      fr: [
        ["Un peu moins de deux heures aller-retour", "Une heure et demie aller-retour"],
        ["Un peu moins de deux heures aller-retour", "Une heure et demie aller-retour"],
      ],
      es: [
        ["Poco menos de dos horas ida y vuelta", "Hora y media ida y vuelta"],
        ["Poco menos de dos horas ida y vuelta", "Hora y media ida y vuelta"],
      ],
      pt: [
        ["Pouco menos de duas horas", "Uma hora e meia"],
        ["Pouco menos de duas horas", "Uma hora e meia"],
      ],
      pl: [
        ["Niecałe dwie godziny", "Półtorej godziny"],
        ["Niecałe dwie godziny", "Półtorej godziny"],
      ],
      cs: [
        ["Necelé dvě hodiny tam a zpátky, dobrých 230", "Hodina a půl tam a zpátky, dobrých 230"],
        ["Necelé dvě hodiny tam a zpátky, 2,3", "Hodina a půl tam a zpátky, 2,3"],
      ],
      sk: [
        ["Necelé dve hodiny tam a späť, dobrých 230", "Hodina a pol tam a späť, dobrých 230"],
        ["Necelé dve hodiny tam a späť, 2,3 kilometra", "Hodina a pol tam a späť, 2,3 kilometra"],
      ],
      hu: [
        ["Szűk két óra", "Másfél óra"],
        ["Szűk két óra", "Másfél óra"],
      ],
      ko: [
        ["왕복 두 시간이 채 안 되고,", "왕복 한 시간 반,"],
        ["왕복 두 시간이 채 안 되고,", "왕복 한 시간 반,"],
      ],
      zh: [
        ["往返不到两小时", "往返一个半小时"],
        ["往返不到两小时", "往返一个半小时"],
      ],
    },
  },
  {
    slug: "tristkogel",
    alt: "Stufe mittel",
    neu: "5,5 Std",
    texte: {
      de: [
        ["Mittelschwer: markiert und ohne technische Stellen, aber ein paar steile Passagen und ein langer Tag.", "Schwer: ein paar steile Passagen und ein langer Tag, aber markiert und ohne technische Stellen."],
      ],
      en: [
        ["Moderate: marked and with no technical sections, but a few steep passages and a long day.", "Hard: a few steep passages and a long day, but marked and with no technical sections."],
      ],
      it: [
        ["Difficoltà media: segnato e senza passaggi tecnici, ma qualche tratto ripido e una giornata lunga.", "Difficoltà alta: qualche tratto ripido e una giornata lunga, ma il sentiero è segnato e senza passaggi tecnici."],
      ],
      nl: [
        ["Middelzwaar: gemarkeerd en zonder technische passages, maar een paar steile stukken en een lange dag.", "Zwaar: een paar steile stukken en een lange dag, maar wel gemarkeerd en zonder technische passages."],
      ],
      fr: [
        ["Difficulté moyenne : balisé et sans passage technique, mais quelques raidillons et une longue journée.", "Difficile : quelques raidillons et une longue journée, mais balisé et sans passage technique."],
      ],
      es: [
        ["Dificultad media: señalizado y sin pasos técnicos, pero con algunos tramos empinados y un día largo.", "Dificultad alta: algunos tramos empinados y un día largo, pero señalizado y sin pasos técnicos."],
      ],
      pt: [
        ["Dificuldade média: marcado e sem passagens técnicas, mas com alguns troços íngremes e um dia longo.", "Difícil: alguns troços íngremes e um dia longo, mas o caminho é marcado e sem passagens técnicas."],
      ],
      pl: [
        ["Średnio trudna: oznakowana i bez technicznych miejsc, ale kilka stromych odcinków i długi dzień.", "Trudna: kilka stromych odcinków i długi dzień, ale oznakowana i bez technicznych miejsc."],
      ],
      cs: [
        ["Středně těžké: značené a bez technických míst, ale pár strmých pasáží a dlouhý den.", "Těžké: pár strmých pasáží a dlouhý den, ale je to značené a bez technických míst."],
      ],
      sk: [
        ["Stredne ťažká: značená a bez technických miest, ale pár strmých pasáží a dlhý deň.", "Ťažká: pár strmých pasáží a dlhý deň, ale značená a bez technických miest."],
      ],
      hu: [
        ["Közepes: jelzett, technikás részek nélkül, de van pár meredek szakasz, és hosszú a nap.", "Nehéz: van pár meredek szakasz, és hosszú a nap, de az út jelzett, technikás részek nélkül."],
      ],
      ko: [
        ["중급입니다. 표시가 되어 있고 기술 구간은 없지만, 가파른 데가 몇 군데 있고 하루가 깁니다.", "상급입니다. 가파른 데가 몇 군데 있고 하루가 길지만, 표시가 되어 있고 기술 구간은 없습니다."],
      ],
      zh: [
        ["中等难度：有标记，没有技术路段，但有几处陡坡，而且一整天都在走。", "难度大：有几处陡坡，而且一整天都在走，但有标记，也没有技术路段。"],
      ],
    },
  },
  {
    slug: "wiestalstausee",
    alt: "1 Std 55 min",
    neu: "1,5 Std",
    texte: {
      de: [
        ["ist knapp zwei Stunden unterwegs", "ist anderthalb Stunden unterwegs"],
        ["Knapp zwei Stunden für den Weg", "Anderthalb Stunden für den Weg"],
      ],
      en: [
        ["just under two hours", "an hour and a half"],
        ["Just under two hours", "An hour and a half"],
      ],
      it: [
        ["ci mette quasi due ore", "ci mette un'ora e mezza"],
        ["Quasi due ore per il sentiero lungo la riva", "Un'ora e mezza per il sentiero lungo la riva"],
      ],
      nl: [
        ["is krap twee uur bezig", "is anderhalf uur bezig"],
        ["Krap twee uur voor het pad", "Anderhalf uur voor het pad"],
      ],
      fr: [
        ["un peu moins de deux heures", "une heure et demie"],
        ["Un peu moins de deux heures", "Une heure et demie"],
      ],
      es: [
        ["lleva algo menos de dos horas", "lleva hora y media"],
        ["Algo menos de dos horas para el camino", "Hora y media para el camino"],
      ],
      pt: [
        ["leva pouco menos de duas horas", "leva uma hora e meia"],
        ["Pouco menos de duas horas para o caminho", "Uma hora e meia para o caminho"],
      ],
      pl: [
        ["w drodze niecałe dwie godziny", "w drodze półtorej godziny"],
        ["Niecałe dwie godziny", "Półtorej godziny"],
      ],
      cs: [
        ["je na cestě necelé dvě hodiny", "je na cestě hodinu a půl"],
        ["Necelé dvě hodiny na cestu", "Hodina a půl na cestu"],
      ],
      sk: [
        ["je na nohách necelé dve hodiny", "je na nohách hodinu a pol"],
        ["Necelé dve hodiny na cestu", "Hodina a pol na cestu"],
      ],
      hu: [
        ["csaknem két órát", "másfél órát"],
        ["Csaknem két óra", "Másfél óra"],
      ],
      ko: [
        ["두 시간이 조금 안 걸립니다", "한 시간 반 걸립니다"],
        ["두 시간이 조금 안 걸리고,", "한 시간 반 걸리고,"],
      ],
      zh: [
        ["绕湖走一圈不到两小时", "绕湖走一圈要一个半小时"],
        ["沿岸走一圈不到两小时", "沿岸走一圈要一个半小时"],
      ],
    },
  },
];


/**
 * DRITTE RUNDE, die vierzehn Spots UNTER einer Stunde.
 *
 * Sie standen nie auf einer Liste, weil die Prüfung sie gar nicht ansah: In `wp:audit` stand
 * `soll >= 1`, der Dauer-Abgleich begann also erst bei einer Stunde. Dazu las der Parser
 * Minuten nur als Ziffer, „Fünfzig Minuten" fand er in keiner Sprache. Aufgefallen ist es
 * einem Menschen, der die Nonnberggasse aufgemacht hat: oben 35 min, im Absatz darunter
 * fünfzig.
 *
 * Dass es wirklich die alten Werte sind und keine Fehlalarme, ist nachgerechnet: In zehn von
 * vierzehn Fällen nennt der Text exakt das Ergebnis der ALTEN Formel, die vier übrigen
 * runden es („knapp eine Stunde" für 55 Minuten).
 *
 * WAS HIER NICHT ANGEFASST WIRD: Diese Texte trennen sauber zwischen dem Weg und dem
 * Aufenthalt („Zehn Minuten braucht der Weg durch die Gassen, ein bis zwei Stunden brauchst
 * du, wenn du dich treiben lässt"), nennen Teilstrecken („in einer Viertelstunde hin") und
 * verweisen auf andere Touren („der Aufstieg von Schloss Aigen dauert gut zwei Stunden").
 * Die längeren Zahlen sind dort richtig. Geändert wird nur die Angabe, die DIESE Runde meint.
 */
const FIXES_RUNDE3: Fix[] = [
  {
    slug: "aignerpark",
    alt: "55 min",
    neu: "40 min",
    texte: {
      de: [
        ["Knapp eine Stunde", "Vierzig Minuten"],
      ],
      en: [
        ["Just under an hour", "Forty minutes"],
      ],
      it: [
        ["Poco meno di un'ora per il giro", "Quaranta minuti per il giro"],
      ],
      nl: [
        ["Krap een uur", "Veertig minuten"],
      ],
      fr: [
        ["Une petite heure", "Quarante minutes"],
      ],
      es: [
        ["Poco menos de una hora", "Cuarenta minutos"],
      ],
      pt: [
        ["Pouco menos de uma hora para a volta", "Quarenta minutos para a volta"],
      ],
      pl: [
        ["Niecała godzina", "Czterdzieści minut"],
      ],
      cs: [
        ["Necelá hodina", "Čtyřicet minut"],
      ],
      sk: [
        ["Necelá hodina", "Štyridsať minút"],
      ],
      hu: [
        ["Alig egy óra a kör", "Negyven perc a kör"],
      ],
      ko: [
        ["한 바퀴에 한 시간이 채 안 걸리고", "한 바퀴에 사십 분 걸리고"],
      ],
      zh: [
        ["一圈不到一小时", "一圈四十分钟"],
      ],
    },
  },
  {
    slug: "asitz",
    alt: "1 Std 10 min",
    neu: "55 min",
    texte: {
      de: [
        ["Gut eine Stunde", "Fünfundfünfzig Minuten"],
      ],
      it: [
        ["Un'ora abbondante", "Cinquantacinque minuti"],
      ],
      nl: [
        ["Ruim een uur", "Vijfenvijftig minuten"],
      ],
      fr: [
        ["Une bonne heure", "Cinquante-cinq minutes"],
      ],
      es: [
        ["Poco más de una hora", "Cincuenta y cinco minutos"],
      ],
      pt: [
        ["Uma hora larga para a volta", "Cinquenta e cinco minutos para a volta"],
      ],
      pl: [
        ["Dobra godzina", "Pięćdziesiąt pięć minut"],
      ],
      cs: [
        ["Dobrá hodina", "Padesát pět minut"],
      ],
      sk: [
        ["Dobrá hodina", "Päťdesiatpäť minút"],
      ],
      hu: [
        ["Bő egy óra a kör", "Ötvenöt perc a kör"],
      ],
      ko: [
        ["한 바퀴에 한 시간 남짓", "한 바퀴에 오십오 분"],
      ],
    },
  },
  {
    slug: "bad-gastein",
    alt: "55 min",
    neu: "40 min",
    texte: {
      de: [
        ["eine knappe Stunde", "vierzig Minuten"],
        ["Knapp eine Stunde", "Vierzig Minuten"],
      ],
      en: [
        ["just under an hour", "forty minutes"],
        ["Just under an hour", "Forty minutes"],
      ],
      it: [
        ["poco meno di un'ora", "quaranta minuti"],
        ["Poco meno di un'ora", "Quaranta minuti"],
      ],
      nl: [
        ["in krap een uur", "in veertig minuten"],
        ["Krap een uur", "Veertig minuten"],
      ],
      fr: [
        ["une petite heure", "quarante minutes"],
        ["Une petite heure", "Quarante minutes"],
      ],
      es: [
        ["poco menos de una hora", "cuarenta minutos"],
        ["Poco menos de una hora", "Cuarenta minutos"],
      ],
      pt: [
        ["em pouco menos de uma hora", "em quarenta minutos"],
        ["Pouco menos de uma hora para o percurso", "Quarenta minutos para o percurso"],
      ],
      pl: [
        ["niecałą godzinę", "czterdzieści minut"],
        ["Niecała godzina", "Czterdzieści minut"],
      ],
      cs: [
        ["za necelou hodinu", "za čtyřicet minut"],
        ["Necelá hodina", "Čtyřicet minut"],
      ],
      sk: [
        ["za necelú hodinu", "za štyridsať minút"],
        ["Necelá hodina", "Štyridsať minút"],
      ],
      hu: [
        ["Alig egy óra alatt sétálsz", "Negyven perc alatt sétálsz"],
        ["Alig egy óra a séta", "Negyven perc a séta"],
      ],
      ko: [
        ["위에서 아래까지 한 시간이 채 안 걸리고", "위에서 아래까지 사십 분 걸리고"],
        ["길이 한 시간이 채 안 되고", "길이 사십 분 걸리고"],
      ],
      zh: [
        ["从上走到下不到一小时", "从上走到下四十分钟"],
        ["穿过镇子不到一小时", "穿过镇子四十分钟"],
      ],
    },
  },
  {
    slug: "burg-hohenwerfen",
    alt: "40 min",
    neu: "35 min",
    texte: {
      de: [
        ["Vierzig Minuten", "Fünfunddreißig Minuten"],
      ],
      en: [
        ["Forty minutes", "Thirty-five minutes"],
      ],
      it: [
        ["Quaranta minuti", "Trentacinque minuti"],
      ],
      nl: [
        ["Veertig minuten", "Vijfendertig minuten"],
      ],
      fr: [
        ["Quarante minutes", "Trente-cinq minutes"],
      ],
      es: [
        ["Cuarenta minutos", "Treinta y cinco minutos"],
      ],
      pt: [
        ["Quarenta minutos para subir", "Trinta e cinco minutos para subir"],
      ],
      pl: [
        ["Czterdzieści minut", "Trzydzieści pięć minut"],
      ],
      cs: [
        ["Čtyřicet minut", "Třicet pět minut"],
      ],
      sk: [
        ["Štyridsať minút", "Tridsaťpäť minút"],
      ],
      hu: [
        ["Negyven perc az út fel és vissza", "Harmincöt perc az út fel és vissza"],
      ],
      ko: [
        ["오르내리는 데 사십 분", "오르내리는 데 삼십오 분"],
      ],
      zh: [
        ["上下来回四十分钟", "上下来回三十五分钟"],
      ],
    },
  },
  {
    slug: "fuschlsee-steg",
    alt: "30 min",
    neu: "25 min",
    texte: {
      de: [
        ["dreißig Minuten", "fünfundzwanzig Minuten"],
        ["Dreißig Minuten", "Fünfundzwanzig Minuten"],
      ],
      en: [
        ["thirty minutes", "twenty-five minutes"],
        ["Thirty minutes", "Twenty-five minutes"],
      ],
      it: [
        ["sono trenta minuti", "sono venticinque minuti"],
        ["Trenta minuti", "Venticinque minuti"],
      ],
      nl: [
        ["heen en terug is dertig minuten", "heen en terug is vijfentwintig minuten"],
        ["Dertig minuten heen en terug", "Vijfentwintig minuten heen en terug"],
      ],
      fr: [
        ["trente minutes", "vingt-cinq minutes"],
        ["Trente minutes", "Vingt-cinq minutes"],
      ],
      es: [
        ["treinta minutos", "veinticinco minutos"],
        ["Treinta minutos", "Veinticinco minutos"],
      ],
      pt: [
        ["ida e volta são trinta minutos", "ida e volta são vinte e cinco minutos"],
        ["Trinta minutos ida e volta", "Vinte e cinco minutos ida e volta"],
      ],
      pl: [
        ["trzydzieści minut", "dwadzieścia pięć minut"],
        ["Trzydzieści minut", "Dwadzieścia pięć minut"],
      ],
      cs: [
        ["třicet minut", "dvacet pět minut"],
        ["Třicet minut", "Dvacet pět minut"],
      ],
      sk: [
        ["tridsať minút", "dvadsaťpäť minút"],
        ["Tridsať minút", "Dvadsaťpäť minút"],
      ],
      hu: [
        ["oda-vissza harminc perc", "oda-vissza huszonöt perc"],
        ["Harminc perc oda-vissza", "Huszonöt perc oda-vissza"],
      ],
      ko: [
        ["왕복은 삼십 분입니다", "왕복은 이십오 분입니다"],
        ["왕복 삼십 분,", "왕복 이십오 분,"],
      ],
      zh: [
        ["来回三十分钟", "来回二十五分钟"],
        ["往返三十分钟", "往返二十五分钟"],
      ],
    },
  },
  {
    slug: "gaisberg",
    alt: "50 min",
    neu: "35 min",
    texte: {
      de: [
        ["einer knappen Stunde", "fünfunddreißig Minuten"],
        ["Knapp eine Stunde", "Fünfunddreißig Minuten"],
      ],
      en: [
        ["just under an hour", "thirty-five minutes"],
        ["Just under an hour", "Thirty-five minutes"],
      ],
      it: [
        ["un'ora scarsa", "trentacinque minuti"],
        ["Un'ora scarsa", "Trentacinque minuti"],
      ],
      nl: [
        ["in krap een uur", "in vijfendertig minuten"],
        ["Krap een uur voor de topronde", "Vijfendertig minuten voor de topronde"],
      ],
      fr: [
        ["une petite heure", "trente-cinq minutes"],
        ["Une petite heure", "Trente-cinq minutes"],
      ],
      es: [
        ["poco menos de una hora", "treinta y cinco minutos"],
        ["Poco menos de una hora", "Treinta y cinco minutos"],
      ],
      pt: [
        ["faz-se em menos de uma hora", "faz-se em trinta e cinco minutos"],
        ["Menos de uma hora para a volta do cume", "Trinta e cinco minutos para a volta do cume"],
      ],
      pl: [
        ["w niecałą godzinę", "w trzydzieści pięć minut"],
        ["Niecała godzina", "Trzydzieści pięć minut"],
      ],
      cs: [
        ["za necelou hodinu", "za třicet pět minut"],
        ["Necelá hodina", "Třicet pět minut"],
      ],
      sk: [
        ["za necelú hodinu", "za tridsaťpäť minút"],
        ["Necelá hodina", "Tridsaťpäť minút"],
      ],
      hu: [
        ["alig egy óra alatt megjárod", "harmincöt perc alatt megjárod"],
        ["Alig egy óra a csúcskör", "Harmincöt perc a csúcskör"],
      ],
      ko: [
        ["평평해서 한 시간이 채 걸리지 않습니다", "평평해서 삼십오 분이면 됩니다"],
        ["정상 둘레길은 한 시간이 채 안 되고", "정상 둘레길은 삼십오 분이고"],
      ],
      zh: [
        ["不到一小时就走完", "三十五分钟就走完"],
        ["山顶环线不到一小时", "山顶环线三十五分钟"],
      ],
    },
  },
  {
    slug: "hintersee-pinzgau",
    alt: "50 min",
    neu: "45 min",
    texte: {
      de: [
        ["Fünfzig Minuten", "Fünfundvierzig Minuten"],
        ["Fünfzig Minuten", "Fünfundvierzig Minuten"],
      ],
      en: [
        ["Fifty minutes for the loop.", "Forty-five minutes for the loop."],
        ["Fifty minutes for the loop around the lake", "Forty-five minutes for the loop around the lake"],
      ],
      it: [
        ["Cinquanta minuti", "Quarantacinque minuti"],
      ],
      nl: [
        ["Vijftig minuten", "Vijfenveertig minuten"],
      ],
      fr: [
        ["Cinquante minutes", "Quarante-cinq minutes"],
        ["Cinquante minutes", "Quarante-cinq minutes"],
      ],
      es: [
        ["Cincuenta minutos", "Cuarenta y cinco minutos"],
        ["Cincuenta minutos", "Cuarenta y cinco minutos"],
      ],
      pt: [
        ["Cinquenta minutos", "Quarenta e cinco minutos"],
      ],
      pl: [
        ["Pięćdziesiąt minut", "Czterdzieści pięć minut"],
        ["Pięćdziesiąt minut", "Czterdzieści pięć minut"],
      ],
      cs: [
        ["Padesát minut", "Čtyřicet pět minut"],
      ],
      sk: [
        ["Päťdesiat minút", "Štyridsaťpäť minút"],
      ],
      hu: [
        ["Ötven perc a kör.", "Negyvenöt perc a kör."],
        ["Ötven perc a tó körüli kör", "Negyvenöt perc a tó körüli kör"],
      ],
      ko: [
        ["한 바퀴에 오십 분입니다.", "한 바퀴에 사십오 분입니다."],
        ["도는 데 오십 분", "도는 데 사십오 분"],
      ],
      zh: [
        ["绕一圈五十分钟", "绕一圈四十五分钟"],
        ["绕湖一圈五十分钟", "绕湖一圈四十五分钟"],
      ],
    },
  },
  {
    slug: "innersbachklamm",
    alt: "25 min",
    neu: "20 min",
    texte: {
      de: [
        ["fünfundzwanzig Minuten", "zwanzig Minuten"],
        ["Fünfundzwanzig Minuten", "Zwanzig Minuten"],
      ],
      en: [
        ["twenty-five minutes", "twenty minutes"],
        ["Twenty-five minutes", "Twenty minutes"],
      ],
      it: [
        ["venticinque minuti", "venti minuti"],
        ["Venticinque minuti", "Venti minuti"],
      ],
      nl: [
        ["vijfentwintig minuten", "twintig minuten"],
        ["Vijfentwintig minuten heen en terug", "Twintig minuten heen en terug"],
      ],
      fr: [
        ["vingt-cinq minutes", "vingt minutes"],
        ["Vingt-cinq minutes", "Vingt minutes"],
      ],
      es: [
        ["veinticinco minutos", "veinte minutos"],
        ["Veinticinco minutos", "Veinte minutos"],
      ],
      pt: [
        ["vinte e cinco minutos", "vinte minutos"],
        ["Vinte e cinco minutos", "Vinte minutos"],
      ],
      pl: [
        ["dwadzieścia pięć minut", "dwadzieścia minut"],
        ["Dwadzieścia pięć minut", "Dwadzieścia minut"],
      ],
      cs: [
        ["dvacet pět minut", "dvacet minut"],
        ["Dvacet pět minut", "Dvacet minut"],
      ],
      hu: [
        ["Rövid, huszonöt perc", "Rövid, húsz perc"],
        ["Huszonöt perc oda-vissza", "Húsz perc oda-vissza"],
      ],
      ko: [
        ["이십오 분이면 들어갔다 나옵니다.", "이십 분이면 들어갔다 나옵니다."],
        ["왕복 이십오 분,", "왕복 이십 분,"],
      ],
      zh: [
        ["二十五分钟就能进去再出来", "二十分钟就能进去再出来"],
        ["来回二十五分钟", "来回二十分钟"],
      ],
    },
  },
  {
    slug: "jagersee",
    alt: "45 min",
    neu: "40 min",
    texte: {
      de: [
        ["fünfundvierzig Minuten", "vierzig Minuten"],
        ["Fünfundvierzig Minuten", "Vierzig Minuten"],
      ],
      en: [
        ["forty-five minutes", "forty minutes"],
        ["Forty-five minutes", "Forty minutes"],
      ],
      it: [
        ["quarantacinque minuti", "quaranta minuti"],
        ["Quarantacinque minuti", "Quaranta minuti"],
      ],
      nl: [
        ["vijfenveertig minuten", "veertig minuten"],
        ["Vijfenveertig minuten", "Veertig minuten"],
      ],
      fr: [
        ["quarante-cinq minutes", "quarante minutes"],
        ["Quarante-cinq minutes", "Quarante minutes"],
      ],
      es: [
        ["cuarenta y cinco minutos", "cuarenta minutos"],
        ["Cuarenta y cinco minutos", "Cuarenta minutos"],
      ],
      pt: [
        ["quarenta e cinco minutos", "quarenta minutos"],
        ["Quarenta e cinco minutos", "Quarenta minutos"],
      ],
      pl: [
        ["czterdzieści pięć minut", "czterdzieści minut"],
        ["Czterdzieści pięć minut", "Czterdzieści minut"],
      ],
      cs: [
        ["čtyřicet pět minut", "čtyřicet minut"],
        ["Čtyřicet pět minut", "Čtyřicet minut"],
      ],
      hu: [
        ["negyvenöt perc, sík és erdőn át", "negyven perc, sík és erdőn át"],
        ["Negyvenöt perc a tó körüli kör", "Negyven perc a tó körüli kör"],
      ],
      ko: [
        ["나 있는데 사십오 분", "나 있는데 사십 분"],
        ["한 바퀴에 사십오 분", "한 바퀴에 사십 분"],
      ],
      zh: [
        ["四十五分钟", "四十分钟"],
      ],
    },
  },
  {
    slug: "kapuzinerberg",
    alt: "1 Std 15 min",
    neu: "55 min",
    texte: {
      de: [
        ["Gut eine Stunde", "Fünfundfünfzig Minuten"],
        ["Gut eine Stunde", "Fünfundfünfzig Minuten"],
      ],
      it: [
        ["Ti serve un'ora abbondante", "Ti servono cinquantacinque minuti"],
        ["Un'ora abbondante", "Cinquantacinque minuti"],
      ],
      nl: [
        ["ruim een uur", "vijfenvijftig minuten"],
        ["Ruim een uur", "Vijfenvijftig minuten"],
      ],
      fr: [
        ["une bonne heure", "cinquante-cinq minutes"],
        ["Une bonne heure", "Cinquante-cinq minutes"],
      ],
      es: [
        ["una hora larga", "cincuenta y cinco minutos"],
        ["Una hora larga", "Cincuenta y cinco minutos"],
      ],
      pt: [
        ["Precisas de uma hora larga", "Precisas de cinquenta e cinco minutos"],
        ["Uma hora larga para a subida", "Cinquenta e cinco minutos para a subida"],
      ],
      pl: [
        ["Dobra godzina", "Pięćdziesiąt pięć minut"],
      ],
      cs: [
        ["dobrou hodinu", "padesát pět minut"],
        ["Dobrá hodina", "Padesát pět minut"],
      ],
      sk: [
        ["dobrú hodinu", "päťdesiatpäť minút"],
        ["Dobrá hodina", "Päťdesiatpäť minút"],
      ],
      hu: [
        ["Jó egy óra kell hozzá", "Ötvenöt perc kell hozzá"],
        ["Jó egy óra a felfelé út", "Ötvenöt perc az út felfelé"],
      ],
      ko: [
        ["한 시간 남짓 걸리지만", "오십오 분 걸리지만"],
        ["올라가는 데 한 시간 남짓,", "올라가는 데 오십오 분,"],
      ],
    },
  },
  {
    slug: "leopoldskroner-weiher",
    alt: "35 min",
    neu: "30 min",
    texte: {
      de: [
        ["fünfunddreißig Minuten", "dreißig Minuten"],
        ["Fünfunddreißig Minuten", "Dreißig Minuten"],
      ],
      en: [
        ["thirty-five minutes", "thirty minutes"],
        ["Thirty-five minutes", "Thirty minutes"],
      ],
      it: [
        ["trentacinque minuti", "trenta minuti"],
        ["Trentacinque minuti", "Trenta minuti"],
      ],
      nl: [
        ["in vijfendertig minuten", "in dertig minuten"],
        ["Vijfendertig minuten", "Dertig minuten"],
      ],
      fr: [
        ["trente-cinq minutes", "trente minutes"],
        ["Trente-cinq minutes", "Trente minutes"],
      ],
      es: [
        ["treinta y cinco minutos", "treinta minutos"],
        ["Treinta y cinco minutos", "Treinta minutos"],
      ],
      pt: [
        ["trinta e cinco minutos", "trinta minutos"],
        ["Trinta e cinco minutos", "Trinta minutos"],
      ],
      pl: [
        ["trzydzieści pięć minut", "trzydzieści minut"],
        ["Trzydzieści pięć minut", "Trzydzieści minut"],
      ],
      cs: [
        ["za třicet pět minut", "za třicet minut"],
        ["Třicet pět minut", "Třicet minut"],
      ],
      hu: [
        ["harmincöt perc alatt körbeérsz", "harminc perc alatt körbeérsz"],
        ["Harmincöt perc a kör", "Harminc perc a kör"],
      ],
      ko: [
        ["평평해서 삼십오 분이면 끝나고", "평평해서 삼십 분이면 끝나고"],
        ["한 바퀴에 삼십오 분,", "한 바퀴에 삼십 분,"],
      ],
      zh: [
        ["三十五分钟走完", "三十分钟走完"],
        ["一圈三十五分钟", "一圈三十分钟"],
      ],
    },
  },
  {
    slug: "maria-plain",
    alt: "1 Std",
    neu: "50 min",
    texte: {
      de: [
        ["eine Stunde", "fünfzig Minuten"],
        ["Eine Stunde", "Fünfzig Minuten"],
      ],
      en: [
        ["an hour for the loop", "fifty minutes for the loop"],
        ["An hour for the ridge loop", "Fifty minutes for the ridge loop"],
      ],
      it: [
        ["un'ora per l'anello", "cinquanta minuti per l'anello"],
        ["Un'ora per l'anello", "Cinquanta minuti per l'anello"],
      ],
      nl: [
        ["een uur voor de ronde", "vijftig minuten voor de ronde"],
        ["Een uur voor het rondje", "Vijftig minuten voor het rondje"],
      ],
      fr: [
        ["une heure pour la boucle", "cinquante minutes pour la boucle"],
        ["Une heure pour la boucle de crête", "Cinquante minutes pour la boucle de crête"],
      ],
      es: [
        ["una hora", "cincuenta minutos"],
        ["Una hora", "Cincuenta minutos"],
      ],
      pt: [
        ["uma hora para a volta", "cinquenta minutos para a volta"],
        ["Uma hora para o circuito", "Cinquenta minutos para o circuito"],
      ],
      pl: [
        ["godzina na pętlę", "pięćdziesiąt minut na pętlę"],
        ["Godzina na pętlę", "Pięćdziesiąt minut na pętlę"],
      ],
      cs: [
        ["hodina na okruh", "padesát minut na okruh"],
        ["Hodina na hřebenový okruh", "Padesát minut na hřebenový okruh"],
      ],
      sk: [
        ["hodina na okruh", "päťdesiat minút na okruh"],
        ["Hodina na hrebeňový okruh", "Päťdesiat minút na hrebeňový okruh"],
      ],
      hu: [
        ["egy óra a kör", "ötven perc a kör"],
        ["Egy óra a magaslati körút", "Ötven perc a magaslati körút"],
      ],
      ko: [
        ["한 바퀴 나 있는데 한 시간이 걸리고", "한 바퀴 나 있는데 오십 분이 걸리고"],
        ["능선 순환길은 한 시간,", "능선 순환길은 오십 분,"],
      ],
      zh: [
        ["走一圈一小时", "走一圈五十分钟"],
        ["环山步道一小时", "环山步道五十分钟"],
      ],
    },
  },
  {
    slug: "nonnberggasse",
    alt: "50 min",
    neu: "35 min",
    texte: {
      de: [
        ["Fünfzig Minuten", "Fünfunddreißig Minuten"],
      ],
      en: [
        ["Fifty minutes", "Thirty-five minutes"],
      ],
      it: [
        ["Cinquanta minuti", "Trentacinque minuti"],
      ],
      nl: [
        ["Vijftig minuten", "Vijfendertig minuten"],
      ],
      fr: [
        ["Cinquante minutes", "Trente-cinq minutes"],
      ],
      es: [
        ["Cincuenta minutos", "Treinta y cinco minutos"],
      ],
      pt: [
        ["Cinquenta minutos ida e volta", "Trinta e cinco minutos ida e volta"],
      ],
      pl: [
        ["Pięćdziesiąt minut", "Trzydzieści pięć minut"],
      ],
      cs: [
        ["Padesát minut", "Třicet pět minut"],
      ],
      sk: [
        ["Päťdesiat minút", "Tridsaťpäť minút"],
      ],
      hu: [
        ["Ötven perc oda-vissza", "Harmincöt perc oda-vissza"],
      ],
      ko: [
        ["왕복 50분", "왕복 35분"],
      ],
      zh: [
        ["往返五十分钟", "往返三十五分钟"],
      ],
    },
  },
  {
    slug: "vorderkaserklamm",
    alt: "1 Std 20 min",
    neu: "55 min",
    texte: {
      de: [
        ["eine Stunde zwanzig", "fünfundfünfzig Minuten"],
        ["Eine Stunde zwanzig", "Fünfundfünfzig Minuten"],
      ],
      en: [
        ["an hour and twenty", "fifty-five minutes"],
        ["An hour and twenty", "Fifty-five minutes"],
      ],
      it: [
        ["un'ora e venti", "cinquantacinque minuti"],
        ["Un'ora e venti", "Cinquantacinque minuti"],
      ],
      nl: [
        ["een uur en twintig", "vijfenvijftig minuten"],
        ["Een uur en twintig", "Vijfenvijftig minuten"],
      ],
      fr: [
        ["une heure vingt", "cinquante-cinq minutes"],
        ["Une heure vingt", "Cinquante-cinq minutes"],
      ],
      es: [
        ["una hora y veinte", "cincuenta y cinco minutos"],
        ["Una hora y veinte", "Cincuenta y cinco minutos"],
      ],
      pt: [
        ["uma hora e vinte para a volta toda", "cinquenta e cinco minutos para a volta toda"],
        ["Uma hora e vinte para a volta", "Cinquenta e cinco minutos para a volta"],
      ],
      pl: [
        ["godzina dwadzieścia", "pięćdziesiąt pięć minut"],
        ["Godzina dwadzieścia", "Pięćdziesiąt pięć minut"],
      ],
      cs: [
        ["hodina dvacet na celý okruh", "padesát pět minut na celý okruh"],
        ["Hodina dvacet na okruh", "Padesát pět minut na okruh"],
      ],
      sk: [
        ["hodinu dvadsať", "päťdesiatpäť minút"],
        ["Hodinu dvadsať", "Päťdesiatpäť minút"],
      ],
      hu: [
        ["egy óra húsz perc az egész kör", "ötvenöt perc az egész kör"],
        ["Egy óra húsz perc a kör", "Ötvenöt perc a kör"],
      ],
      ko: [
        ["한 바퀴에 한 시간 이십 분 걸립니다.", "한 바퀴에 오십오 분 걸립니다."],
        ["한 바퀴에 한 시간 이십 분,", "한 바퀴에 오십오 분,"],
      ],
      zh: [
        ["整圈要一小时二十分", "整圈要五十五分钟"],
        ["一圈一小时二十分", "一圈五十五分钟"],
      ],
    },
  },
];


/**
 * VIERTE RUNDE, die letzten acht. Sie standen in Runde drei nicht auf der Liste, weil der
 * Parser sie nicht sehen konnte: Englisch und Chinesisch schreiben „a good hour" und
 * „一个多小时" mit einem Wort zwischen Zahl und Einheit, Slowakisch schreibt „dvadsaťpäť"
 * zusammen statt getrennt. Ein Prüfer, der eine Formulierung nicht kennt, meldet dort
 * dauerhaft null, und genau so überlebt eine falsche Zahl drei Durchgänge.
 *
 * Gefunden hat sie eine Gegenprobe, die nicht nach Widersprüchen sucht, sondern danach, ob
 * jede Sprache die Feld-Dauer überhaupt NENNT. Diese Frage stellt der Audit von sich aus
 * nicht, weil ein Text auch schweigen darf.
 */
const FIXES_RUNDE4: Fix[] = [
  {
    slug: "asitz",
    alt: "1 Std 10 min",
    neu: "55 min",
    texte: {
      en: [["A good hour for the loop", "Fifty-five minutes for the loop"]],
      zh: [["从上站走一圈一个多小时", "从上站走一圈五十五分钟"]],
    },
  },
  {
    slug: "kapuzinerberg",
    alt: "1 Std 15 min",
    neu: "55 min",
    texte: {
      en: [
        ["You need a good hour", "You need fifty-five minutes"],
        ["A good hour for the way up", "Fifty-five minutes for the way up"],
      ],
      zh: [["要走一个多小时", "要走五十五分钟"], ["上山一个多小时", "上山五十五分钟"]],
    },
  },
  {
    slug: "krimmler-wasserfalle",
    alt: "2 Std 10 min",
    neu: "1,5 Std",
    texte: {
      zh: [["来回两个多小时", "来回一个半小时"]],
    },
  },
  {
    // Französisch schreibt die Uhrzeit-Kurzform „1h30". Keine der Wort- und Ziffernregeln
    // hat sie gesehen, also stand hier drei Durchgänge lang die alte Dauer.
    slug: "lammerklamm",
    alt: "1,5 Std",
    neu: "1 Std",
    texte: {
      fr: [["environ 1h30", "environ une heure"]],
    },
  },
  {
    slug: "innersbachklamm",
    alt: "25 min",
    neu: "20 min",
    texte: {
      sk: [["dvadsaťpäť minút", "dvadsať minút"], ["Dvadsaťpäť minút", "Dvadsať minút"]],
    },
  },
  {
    slug: "jagersee",
    alt: "45 min",
    neu: "40 min",
    texte: {
      sk: [["štyridsaťpäť minút", "štyridsať minút"], ["Štyridsaťpäť minút", "Štyridsať minút"]],
    },
  },
  {
    slug: "leopoldskroner-weiher",
    alt: "35 min",
    neu: "30 min",
    texte: {
      sk: [["tridsaťpäť minút", "tridsať minút"], ["Tridsaťpäť minút", "Tridsať minút"]],
    },
  },
];

const SPALTEN = [
  "title",
  "short_desc",
  "general",
  "insider_tip",
  "section_a",
  "section_b",
  "location_text",
] as const;

async function main() {
  const go = process.argv.includes("--go");
  const { data: spots, error } = await db.from("spots").select("id, slug, duration");
  if (error) throw error;

  let ersetzt = 0;
  let ohneFund = 0;
  for (const fix of [...FIXES, ...FIXES_RUNDE2, ...FIXES_RUNDE3, ...FIXES_RUNDE4]) {
    const spot = spots!.find((s) => s.slug === fix.slug);
    if (!spot) throw new Error(`Spot ${fix.slug} gibt es nicht`);
    // Sicherung: Die Liste ist auf einen bestimmten neuen Feldwert geschrieben. Steht dort
    // etwas anderes, ist entweder die Formel wieder gewandert oder jemand hat von Hand
    // korrigiert — dann darf dieses Skript nicht blind Sätze umschreiben.
    if (spot.duration !== fix.neu)
      throw new Error(
        `${fix.slug}: Feld steht auf "${spot.duration}", die Liste ist für "${fix.neu}" geschrieben. ` +
          `Erst npm run wp:hiking-times -- --go, dann die Liste prüfen.`,
      );

    const { data: rows, error: e2 } = await db
      .from("spot_translations")
      .select(`lang, ${SPALTEN.join(", ")}`)
      .eq("spot_id", spot.id);
    if (e2) throw e2;

    console.log(`\n=== ${fix.slug}: ${fix.alt} -> ${fix.neu}`);
    const neueDeTexte: Record<string, string> = {};

    for (const r of rows as unknown as Record<string, string | null>[]) {
      const lang = r.lang as string;
      const paare = fix.texte[lang] ?? [];
      const patch: Record<string, string> = {};
      for (const sp of SPALTEN) {
        const wert = r[sp];
        if (!wert) continue;
        let neu = wert;
        for (const [suche, ersatz] of paare) neu = neu.split(suche).join(ersatz);
        if (neu !== wert) patch[sp] = neu;
      }
      if (lang === "de") for (const sp of SPALTEN) neueDeTexte[sp] = patch[sp] ?? r[sp] ?? "";
      if (!Object.keys(patch).length) {
        if (paare.length) {
          ohneFund++;
          console.log(`    ${lang.padEnd(3)} KEINE FUNDSTELLE (Muster passt nicht)`);
        }
        continue;
      }
      ersetzt++;
      console.log(`    ${lang.padEnd(3)} ${Object.keys(patch).join(", ")}`);
      if (go) {
        const { error: e3 } = await db
          .from("spot_translations")
          .update(patch)
          .eq("spot_id", spot.id)
          .eq("lang", lang);
        if (e3) throw e3;
      }
    }

    if (!go) continue;

    // Der deutsche Text hat sich geändert -> neue Aktualitäts-Marke für ALLE Sprachen,
    // sonst gelten die Übersetzungen als veraltet, obwohl sie mitkorrigiert wurden.
    const deHash = hashSpotTexts({
      title: neueDeTexte.title,
      shortDesc: neueDeTexte.short_desc,
      general: neueDeTexte.general,
      insiderTip: neueDeTexte.insider_tip,
      sectionA: neueDeTexte.section_a,
      sectionB: neueDeTexte.section_b,
      locationText: neueDeTexte.location_text,
    });
    const { error: e4 } = await db
      .from("spot_translations")
      .update({ source_hash: deHash })
      .eq("spot_id", spot.id)
      .in("lang", LOCALE_CODES as string[]);
    if (e4) throw e4;

    // Entwurf und Übersetzungs-Ablage mitziehen, sonst holt der nächste Import bzw. der
    // nächste `wp:translate --go` die alte Zahl zurück.
    for (const ordner of [join(".wp-cache", "drafts"), join(".wp-cache", "i18n")]) {
      const pfad = join(ordner, `${fix.slug}.json`);
      if (!existsSync(pfad)) continue;
      let roh = readFileSync(pfad, "utf8");
      for (const paare of Object.values(fix.texte))
        for (const [suche, ersatz] of paare) roh = roh.split(suche).join(ersatz);
      writeFileSync(pfad, roh);
      console.log(`    ${pfad} nachgezogen`);
    }
  }

  console.log(`\n${ersetzt} Sprachzeilen geändert, ${ohneFund} Muster ohne Fundstelle.`);
  if (!go) {
    console.log("TROCKENLAUF. Nichts geschrieben. Wirklich setzen: npm run wp:fix-hiking-texts -- --go");
    return;
  }
  console.log("Danach: npm run wp:audit  (muss 0 Widersprüche melden)");
}

main();
