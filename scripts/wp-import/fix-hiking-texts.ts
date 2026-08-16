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
  for (const fix of FIXES) {
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
