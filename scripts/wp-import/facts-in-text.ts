// Fakten in einem Fliesstext finden (Zeitangaben und Schwierigkeit) — in allen dreizehn
// Sprachen. Hiess einmal hours-i18n.ts, bis die Schwierigkeit dazukam.
//
// WARUM DAS HIER STEHT: Die Dauer einer Wanderung steht nicht nur im Feld, sondern auch im
// Text („Rechne fünf Stunden für die Runde"), und zwar in jeder Sprache in ihren eigenen
// Worten. Geprüft wurde bisher nur Deutsch. Als die Formel korrigiert wurde, hätte das
// bedeutet: eine richtige Zahl im Feld, daneben zwölf Sprachen mit der alten falschen Zahl,
// und niemand merkt es, weil niemand koreanisch gegenprüft.
//
// LIEBER ÜBERSEHEN ALS FEHLALARM: Findet der Parser eine Angabe nicht, meldet die Prüfung
// nichts (falsch-negativ). Findet er eine, muss sie zum Feld passen. Andersherum wäre es
// schlimmer: Eine Liste voller Fehlalarme schaut sich beim zweiten Mal niemand mehr an.
//
// Gedeckt sind Ziffern (`5 Stunden`, `1,5 ore`, `5시간`) UND Zahlwörter (`fünf Stunden`,
// `cinque ore`, `öt óra`), dazu die festen Wendungen für halbe Stunden.

/** Eine Sprache: Einheitswort, Zahlwörter, feste Wendungen. */
type HourLang = {
  /** Regex-Alternativen für „Stunde(n)". Reihenfolge egal, längste Form zuerst schadet nicht. */
  unit: string;
  /** Regex-Alternativen für „Minute(n)", für Angaben wie „30 Minuten". */
  minute: string;
  /** Zahlwort -> Stunden. */
  words: Record<string, number>;
  /** Feste Wendungen -> Stunden. Werden als ganze Zeichenkette gesucht. */
  phrases: Record<string, number>;
  /**
   * Muster für „Zahlwort und eine halbe Stunde", `%N%` steht für das Zahlwort. Ergibt
   * Zahlwort + 0,5. Jede Sprache baut das anders — genau deshalb steht es hier als Muster
   * und nicht als Liste fertiger Wendungen.
   */
  half?: string;
  /**
   * Was zwischen Zahlwort und Einheitswort stehen darf. Standard ist Leerraum. Französisch
   * schiebt das Adjektiv dazwischen („trois bonnes heures") und elidiert das Substantiv
   * („une bonne dizaine d'heures") — ohne diese Ausnahme sah der Parser dort NICHTS, und
   * vier französische Texte behielten stumm die alte Zahl.
   */
  filler?: string;
  /** Sprachen ohne Wortgrenzen (CJK): dort darf nicht auf Buchstabenränder geprüft werden. */
  cjk?: boolean;
};

const HOURS: Record<string, HourLang> = {
  de: {
    unit: "Stunden|Stunde|Std",
    minute: "Minuten|Minute|min",
    words: {
      eine: 1, einer: 1, ein: 1, anderthalb: 1.5, eineinhalb: 1.5,
      zwei: 2, zweieinhalb: 2.5, drei: 3, dreieinhalb: 3.5, vier: 4, viereinhalb: 4.5,
      fünf: 5, fünfeinhalb: 5.5, sechs: 6, sechseinhalb: 6.5, sieben: 7, siebeneinhalb: 7.5,
      acht: 8, achteinhalb: 8.5, neun: 9, neuneinhalb: 9.5, zehn: 10, elf: 11, zwölf: 12,
      dreizehn: 13, vierzehn: 14, fünfzehn: 15,
    },
    phrases: { "halbe Stunde": 0.5, "halben Stunde": 0.5, Viertelstunde: 0.25, Dreiviertelstunde: 0.75 },
    half: "%N%einhalb\\s*(?:Stunden|Stunde)",
    // Deutsch stellt das Beiwort ebenfalls dazwischen: "eine knappe Stunde", "eine gute
    // Stunde". Ohne das blieb der zweite Satz der Sigmund-Thun-Klamm unsichtbar, und der
    // stand nach der Korrektur im Widerspruch zur neuen Gesamtdauer.
    filler: "(?:\\s+(?:knappe?[nrs]?|gute?[nrs]?|volle?[nrs]?|starke?[nrs]?|reichliche?[nrs]?))?\\s*",
  },
  en: {
    unit: "hours|hour|hrs|hr",
    minute: "minutes|minute|mins|min",
    words: {
      an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
      nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    },
    phrases: {
      // "hour and a half" OHNE Artikel, damit auch "a good hour and a half" greift. Genau
      // daran ist der englische Nockstein-Text durch die Pruefung gerutscht.
      "hour and a half": 1.5,
      "half an hour": 0.5, "one and a half hours": 1.5,
      "two and a half hours": 2.5, "three and a half hours": 3.5, "four and a half hours": 4.5,
      "five and a half hours": 5.5, "six and a half hours": 6.5, "seven and a half hours": 7.5,
      "quarter of an hour": 0.25,
    },
    half: "%N%\\s+and\\s+a\\s+half\\s+(?:hours|hour)",
  },
  it: {
    unit: "ore|ora",
    minute: "minuti|minuto|min",
    words: {
      un: 1, una: 1, "un'": 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7,
      otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12, tredici: 13, quattordici: 14,
    },
    phrases: {
      "mezz'ora": 0.5, "mezza ora": 0.5, "un'ora e mezza": 1.5, "due ore e mezza": 2.5,
      "tre ore e mezza": 3.5, "quattro ore e mezza": 4.5, "cinque ore e mezza": 5.5,
      "sei ore e mezza": 6.5, "sette ore e mezza": 7.5,
    },
    half: "%N%\\s+(?:ore|ora)\\s+e\\s+mezza",
  },
  nl: {
    unit: "uren|uur",
    minute: "minuten|minuut|min",
    words: {
      een: 1, één: 1, anderhalf: 1.5, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7,
      acht: 8, negen: 9, tien: 10, elf: 11, twaalf: 12, dertien: 13, veertien: 14,
    },
    phrases: { "half uur": 0.5, halfuur: 0.5, kwartier: 0.25 },
    // Niederländisch schreibt das zusammen, mit zwei Fugen und optionalem „een":
    // dertien+en+een+half, vier+en+een+half, drie+ën+een+half, twee+ën+half.
    // Eine Zeichenklasse reicht dafür nicht: „tweeënhalf" hat nach dem Trema noch ein n,
    // und genau daran ist der Hochkeil-Spiegelsee durch die Prüfung gerutscht.
    half: "%N%(?:en|ën)(?:een)?half\\s*(?:uren|uur)",
  },
  fr: {
    unit: "heures|heure",
    minute: "minutes|minute|min",
    words: {
      une: 1, un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8,
      neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14,
      // „une bonne dizaine d'heures" ist die übliche Rundung für zehn.
      dizaine: 10, douzaine: 12, quinzaine: 15,
    },
    filler: "(?:\\s+(?:bonnes?|petites?|grosses?))?\\s*(?:d['\u2019])?\\s*",
    phrases: {
      "demi-heure": 0.5, "demie heure": 0.5, "une heure et demie": 1.5,
      "deux heures et demie": 2.5, "trois heures et demie": 3.5, "quatre heures et demie": 4.5,
      "cinq heures et demie": 5.5, "six heures et demie": 6.5, "sept heures et demie": 7.5,
      "quart d'heure": 0.25,
    },
    half: "%N%\\s+(?:heures|heure)\\s+et\\s+demie",
  },
  es: {
    unit: "horas|hora",
    minute: "minutos|minuto|min",
    words: {
      una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
      nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14,
    },
    phrases: {
      "media hora": 0.5, "hora y media": 1.5, "dos horas y media": 2.5,
      "tres horas y media": 3.5, "cuatro horas y media": 4.5, "cinco horas y media": 5.5,
      "seis horas y media": 6.5, "siete horas y media": 7.5, "cuarto de hora": 0.25,
    },
    half: "%N%\\s+(?:horas|hora)\\s+y\\s+media",
  },
  pt: {
    unit: "horas|hora",
    minute: "minutos|minuto|min",
    words: {
      uma: 1, um: 1, duas: 2, dois: 2, três: 3, quatro: 4, cinco: 5, seis: 6, sete: 7,
      oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14,
    },
    phrases: {
      "meia hora": 0.5, "hora e meia": 1.5, "duas horas e meia": 2.5, "três horas e meia": 3.5,
      "quatro horas e meia": 4.5, "cinco horas e meia": 5.5, "seis horas e meia": 6.5,
      "sete horas e meia": 7.5, "quarto de hora": 0.25,
    },
    half: "%N%\\s+(?:horas|hora)\\s+e\\s+meia",
  },
  pl: {
    unit: "godzinami|godzinach|godziny|godzinę|godzina|godzin",
    minute: "minutach|minuty|minutę|minuta|minut|min",
    words: {
      jedna: 1, jedną: 1, godzinę: 1, dwie: 2, trzy: 3, cztery: 4, pięć: 5, sześć: 6,
      siedem: 7, osiem: 8, dziewięć: 9, dziesięć: 10, jedenaście: 11, dwanaście: 12,
      trzynaście: 13, czternaście: 14,
    },
    // „Eine Stunde" heisst im Polnischen schlicht „godzina", ohne Zahlwort davor. Ohne diese
    // Zeile findet der Parser die Angabe nicht — und meldete die Festung als Widerspruch,
    // weil er nur noch das „trzy godziny" im selben Absatz sah.
    phrases: { "pół godziny": 0.5, "półtorej godziny": 1.5, kwadrans: 0.25, godzina: 1, godzinę: 1 },
    half: "%N%\\s+i\\s+pół\\s+godziny",
  },
  cs: {
    unit: "hodinami|hodinách|hodiny|hodinu|hodina|hodin",
    minute: "minutách|minuty|minutu|minuta|minut|min",
    words: {
      jedna: 1, jednu: 1, hodinu: 1, dvě: 2, tři: 3, čtyři: 4, pět: 5, šest: 6, sedm: 7,
      osm: 8, devět: 9, deset: 10, jedenáct: 11, dvanáct: 12, třináct: 13, čtrnáct: 14,
    },
    // Wie im Polnischen: „eine Stunde" ist blosses „hodina" (siehe pl).
    phrases: { "půl hodiny": 0.5, "hodina a půl": 1.5, "hodinu a půl": 1.5, "čtvrt hodiny": 0.25, hodina: 1, hodinu: 1 },
    half: "%N%\\s+a\\s+půl\\s+hodiny",
  },
  sk: {
    unit: "hodinami|hodinách|hodiny|hodinu|hodina|hodín",
    minute: "minútach|minúty|minútu|minúta|minút|min",
    words: {
      jedna: 1, jednu: 1, hodinu: 1, dve: 2, tri: 3, štyri: 4, päť: 5, šesť: 6, sedem: 7,
      osem: 8, deväť: 9, desať: 10, jedenásť: 11, dvanásť: 12, trinásť: 13, štrnásť: 14,
    },
    // Wie im Polnischen: „eine Stunde" ist blosses „hodina" (siehe pl).
    phrases: { "pol hodiny": 0.5, "hodina a pol": 1.5, "hodinu a pol": 1.5, "štvrť hodiny": 0.25, hodina: 1, hodinu: 1 },
    half: "%N%\\s+a\\s+pol\\s+hodiny",
  },
  hu: {
    unit: "órányi|órára|órát|órás|óráig|órakor|óra",
    minute: "percet|percig|perces|perc",
    words: {
      egy: 1, két: 2, kettő: 2, három: 3, négy: 4, öt: 5, hat: 6, hét: 7, nyolc: 8,
      kilenc: 9, tíz: 10, tizenegy: 11, tizenkét: 12, tizenhárom: 13, tizennégy: 14,
    },
    phrases: { "fél óra": 0.5, "fél órát": 0.5, "másfél óra": 1.5, "másfél órát": 1.5, "negyedóra": 0.25 },
    half: "%N%\\s+és\\s+fél\\s+(?:órát|óra)",
  },
  ko: {
    unit: "시간",
    minute: "분",
    // Koreanische Zählwörter (die einheimische Reihe, die vor 시간 steht).
    words: {
      한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9,
      열: 10, 열한: 11, 열두: 12, 열세: 13, 열네: 14,
    },
    // „반나절" (ein halber Tag) steht hier bewusst NICHT: Das ist keine Stundenangabe,
    // sondern eine Grössenordnung, genau wie das deutsche „ein halber Tag", das der
    // deutsche Parser ebenfalls nicht als Zahl liest.
    phrases: { "한 시간": 1, "두 시간": 2, "세 시간": 3, "네 시간": 4, "다섯 시간": 5, "여섯 시간": 6 },
    cjk: true,
    half: "%N%\\s*시간\\s*반",
  },
  zh: {
    unit: "个小时|小时|小時",
    minute: "分钟|分鐘",
    words: {
      一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
      十一: 11, 十二: 12, 十三: 13,
    },
    phrases: { "半小时": 0.5, "半個小時": 0.5, "一个半小时": 1.5, "一小时半": 1.5 },
    cjk: true,
    half: "%N%\\s*个?半\\s*(?:小时|小時)",
  },
};

export const HOUR_LANGS = Object.keys(HOURS);

/** „1,5" und „1.5" gleich lesen. Tausenderpunkte kommen bei Stunden nicht vor. */
function zahl(roh: string): number {
  return Number(roh.replace(",", "."));
}

/** Regex-Sonderzeichen in einem Suchwort entschärfen. */
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Alle Zeichen, aus denen die Zahlwoerter dieser Sprache bestehen (nur fuer CJK noetig). */
function zahlzeichen(L: HourLang): string {
  return [...new Set(Object.keys(L.words).join(""))].map(esc).join("");
}

/**
 * Das Muster für „dreizehneinhalb Stunden" mit dem Zahlwort an der Stelle `%N%`, fertig
 * zusammengesetzt. Diese Formen als feste Wendungen aufzulisten wäre ein Fass ohne Boden:
 * Am Gamskarkogel stand „dreizehneinhalb", „thirteen and a half hours" und
 * „dertieneneenhalf uur" — drei Sprachen, drei Bauweisen, und die Liste hörte bei sieben
 * auf. Der Parser sah dort NICHTS, und ein Parser, der nichts sieht, meldet auch nichts.
 */
function halbMuster(L: HourLang): RegExp | null {
  if (!L.half) return null;
  const woerter = Object.keys(L.words).map(esc).sort((a, b) => b.length - a.length);
  if (!woerter.length) return null;
  return new RegExp(L.half.replace("%N%", `(${woerter.join("|")})`), "giu");
}

/** Zahlwort -> Wert, unabhängig von Gross-/Kleinschreibung. */
function wortWert(L: HourLang, w: string): number | undefined {
  const key = Object.keys(L.words).find((k) => k.toLowerCase() === w.toLowerCase());
  return key === undefined ? undefined : L.words[key];
}

/**
 * Alle Stunden-Angaben eines Textes, in Stunden. Reihenfolge ohne Bedeutung, Duplikate
 * möglich — gefragt ist nur, ob EINE davon zur gemessenen Dauer passt.
 */
export function hoursInText(text: string, lang: string): number[] {
  const L = HOURS[lang];
  if (!L || !text) return [];
  const out: number[] = [];
  // CJK kennt keine Wortgrenzen, aber geblockt wird NUR ein vorangehendes ZAHLZEICHEN
  // dieser Sprache. Eine pauschale Han-Sperre verschluckte im Chinesischen die halbe
  // Datenlage, weil dort vor der Zahl fast immer ein Han-Zeichen steht.
  // Ohne den Blick nach links fände „열세 시간" (13) auch
  // das „세 시간" (3) in sich selbst.
  const grenze = (s: string) => (L.cjk ? `(?<![${zahlzeichen(L)}])${s}` : `(?<![\\p{L}])${s}(?![\\p{L}])`);

  // 1. Ziffern vor dem Einheitswort: „5 Stunden", „1,5 ore", „5시간"
  for (const m of text.matchAll(new RegExp(`(\\d[\\d.,]*)\\s*(?:${L.unit})`, "giu")))
    out.push(zahl(m[1]));

  // 2. Minuten als Bruchteil: „30 Minuten", „45 min"
  for (const m of text.matchAll(new RegExp(`(\\d[\\d.,]*)\\s*(?:${L.minute})`, "giu")))
    out.push(zahl(m[1]) / 60);

  // 3. Zahlwörter vor dem Einheitswort: „fünf Stunden", „cinque ore", „öt óra"
  for (const [w, v] of Object.entries(L.words))
    if (new RegExp(grenze(`${esc(w)}${L.filler ?? "\\s*"}(?:${L.unit})`), "iu").test(text)) out.push(v);

  // 4. Zahlwort plus halbe Stunde: „dreizehneinhalb Stunden", „sei ore e mezza"
  const halb = halbMuster(L);
  if (halb) for (const m of text.matchAll(halb)) {
    const v = wortWert(L, m[1]);
    if (v !== undefined) out.push(v + 0.5);
  }

  // 5. Feste Wendungen: „halbe Stunde", „hora y media", „másfél óra"
  for (const [p, v] of Object.entries(L.phrases))
    if (new RegExp(grenze(esc(p)), "iu").test(text)) out.push(v);

  return out;
}

/**
 * Die Fundstellen als Text, für Protokolle. Zeigt, WORAN die Prüfung hängt — ohne das
 * sucht man die Stelle im fremdsprachigen Absatz von Hand.
 */
export function hourMatches(text: string, lang: string): string[] {
  const L = HOURS[lang];
  if (!L || !text) return [];
  const out: string[] = [];
  // CJK kennt keine Wortgrenzen, aber geblockt wird NUR ein vorangehendes ZAHLZEICHEN
  // dieser Sprache. Eine pauschale Han-Sperre verschluckte im Chinesischen die halbe
  // Datenlage, weil dort vor der Zahl fast immer ein Han-Zeichen steht.
  // Ohne den Blick nach links fände „열세 시간" (13) auch
  // das „세 시간" (3) in sich selbst.
  const grenze = (s: string) => (L.cjk ? `(?<![${zahlzeichen(L)}])${s}` : `(?<![\\p{L}])${s}(?![\\p{L}])`);
  for (const m of text.matchAll(new RegExp(`(\\d[\\d.,]*)\\s*(?:${L.unit}|${L.minute})`, "giu")))
    out.push(m[0].trim());
  for (const w of Object.keys(L.words)) {
    const m = new RegExp(grenze(`${esc(w)}${L.filler ?? "\\s*"}(?:${L.unit})`), "iu").exec(text);
    if (m) out.push(m[0].trim());
  }
  const halb = halbMuster(L);
  if (halb) for (const m of text.matchAll(halb)) out.push(m[0].trim());
  for (const p of Object.keys(L.phrases)) {
    const m = new RegExp(grenze(esc(p)), "iu").exec(text);
    if (m) out.push(m[0].trim());
  }
  return [...new Set(out)];
}

/** „5 Std 55 min" / „2,5 Std" / „40 min" -> Stunden als Zahl. */
export function fieldHours(d: string | null | undefined): number | null {
  if (!d) return null;
  const h = /([\d.,]+)\s*Std/.exec(d);
  const m = /(\d+)\s*min/i.exec(d);
  if (!h && !m) return null;
  return (h ? zahl(h[1]) : 0) + (m ? Number(m[1]) / 60 : 0);
}

// ── Schwierigkeit im Fliesstext ────────────────────────────────────────────────
// Das Faktenfeld sagt leicht/mittel/schwer, und der Absatz daneben sagt es noch einmal in
// Prosa. Laufen die beiden auseinander, sieht der Gast im selben Bildschirm zwei Urteile.
// Genau das ist passiert, als die Schwierigkeit neu gerechnet wurde: Gamskarkogel, Schafberg
// und Tristkogel standen auf "schwer", darunter stand "Mittelschwer", in dreizehn Sprachen.
//
// GEPRUEFT WIRD NUR AM SATZANFANG. Die Einstufung eroeffnet in diesen Texten immer ihren
// Satz ("Mittelschwer: markiert und ...", "Dificultad alta: ..."). Mitten im Satz stehen
// dieselben Woerter in ganz anderer Bedeutung: das spanische "y media" ist die halbe Stunde,
// nicht die mittlere Schwierigkeit, und "tecnicamente facile" beschreibt das Gelaende, nicht
// die Stufe. Wer ueberall sucht, bekommt eine Liste voller Fehlalarme.
export type Grade = "leicht" | "mittel" | "schwer";

const GRADES: Record<string, Record<Grade, string[]>> = {
  de: { leicht: ["leicht"], mittel: ["mittelschwer", "mittelschwierig", "mittel"], schwer: ["schwer", "anspruchsvoll"] },
  en: { leicht: ["easy"], mittel: ["moderate", "moderately"], schwer: ["hard", "demanding", "strenuous"] },
  it: { leicht: ["facile", "difficoltà bassa"], mittel: ["difficoltà media", "mediamente"], schwer: ["difficile", "difficoltà alta"] },
  nl: { leicht: ["makkelijk", "eenvoudig"], mittel: ["middelzwaar", "gemiddeld"], schwer: ["zwaar", "pittig"] },
  fr: { leicht: ["facile"], mittel: ["difficulté moyenne"], schwer: ["difficile", "difficulté élevée"] },
  // Kein blosses "media": "Media hora" ist die halbe Stunde und eroeffnet reihenweise Saetze.
  es: { leicht: ["fácil", "dificultad baja"], mittel: ["dificultad media"], schwer: ["difícil", "dificultad alta"] },
  pt: { leicht: ["fácil", "dificuldade baixa"], mittel: ["dificuldade média"], schwer: ["difícil", "dificuldade alta"] },
  pl: { leicht: ["łatwa", "łatwe"], mittel: ["średnio trudna", "średnia"], schwer: ["trudna", "trudne"] },
  cs: { leicht: ["lehká", "lehké"], mittel: ["středně těžké", "středně těžká", "střední"], schwer: ["těžké", "těžká", "náročné"] },
  sk: { leicht: ["ľahká", "ľahké"], mittel: ["stredne ťažké", "stredne ťažká", "stredná"], schwer: ["ťažké", "ťažká", "náročné"] },
  hu: { leicht: ["könnyű"], mittel: ["közepes", "közepesen"], schwer: ["nehéz"] },
  ko: { leicht: ["초급", "쉬움"], mittel: ["중급", "보통"], schwer: ["상급", "어려움"] },
  zh: { leicht: ["轻松"], mittel: ["中等"], schwer: ["困难", "难度大", "强度大"] },
};


/**
 * Blosse Eigenschaftswoerter fuer die zweite Haelfte einer SPANNE ("Leicht bis mittel",
 * "Facile a moyen"). Sie werden NUR gesucht, wenn vorne schon eine Stufe gefunden wurde:
 * allein stehen sie viel zu oft in anderer Bedeutung, "Media hora" ist die halbe Stunde.
 */
const SPANNE: Record<string, Record<Grade, string[]>> = {
  de: { leicht: ["leicht"], mittel: ["mittel"], schwer: ["schwer"] },
  en: { leicht: ["easy"], mittel: ["moderate"], schwer: ["hard"] },
  it: { leicht: ["facile", "bassa"], mittel: ["media"], schwer: ["difficile", "alta"] },
  nl: { leicht: ["makkelijk"], mittel: ["gemiddeld", "middelzwaar"], schwer: ["zwaar"] },
  fr: { leicht: ["facile"], mittel: ["moyen", "moyenne"], schwer: ["difficile"] },
  es: { leicht: ["fácil", "baja"], mittel: ["media"], schwer: ["difícil", "alta"] },
  pt: { leicht: ["fácil", "baixa"], mittel: ["média"], schwer: ["difícil", "alta"] },
  // Polnisch beugt in der Spanne ("Łatwa do średniej"), deshalb beide Formen.
  pl: { leicht: ["łatwa", "łatwej"], mittel: ["średnia", "średnio", "średniej"], schwer: ["trudna", "trudnej"] },
  cs: { leicht: ["lehká"], mittel: ["střední"], schwer: ["těžká", "těžké"] },
  sk: { leicht: ["ľahká"], mittel: ["stredná"], schwer: ["ťažká", "ťažké"] },
  hu: { leicht: ["könnyű"], mittel: ["közepes"], schwer: ["nehéz"] },
  // Koreanisch schreibt die Spanne mit den FAKTEN-Woertern ("쉬움에서 보통 사이"),
  // nicht mit den Kurs-Stufen 초급/중급/상급.
  ko: { leicht: ["초급", "쉬움"], mittel: ["중급", "보통"], schwer: ["상급", "어려움"] },
  zh: { leicht: ["轻松"], mittel: ["中等"], schwer: ["困难"] },
};

/**
 * Die Stufen, die ein Text am Satzanfang behauptet. Mehrere sind moeglich, wenn der Text
 * mehrere Varianten beschreibt; entschieden wird draussen.
 */
export function difficultyInText(text: string, lang: string): Grade[] {
  const G = GRADES[lang];
  if (!G || !text) return [];
  const cjk = HOURS[lang]?.cjk ?? false;
  const out = new Set<Grade>();
  for (const satz of text.split(/(?<=[.!?。！？\n])\s*/)) {
    // Nur die ERSTE Teilaussage: dort steht die Einstufung ("Leicht bis mittel: ...",
    // "Dificultad alta: ..."). Weiter hinten im Satz stehen dieselben Woerter als
    // Beschreibung des Gelaendes und meinen dann etwas anderes.
    // Nur die ersten Zeichen: Die Einstufung steht ganz vorne. Weiter hinten beschreibt
    // dasselbe Wort das Gelaende ("Il sentiero in se e tecnicamente facile") und meint
    // nicht mehr die Stufe.
    const kopf = satz.trimStart().split(/[,:;.!?—–]/)[0];
    if (!kopf) continue;
    // Das Stufenwort muss GANZ VORNE anfangen. Ungarisch stellt das Adjektiv ans Ende
    // ("Maga az ut technikailag koennyu"), und ohne diese Grenze zaehlte das als Einstufung.
    const idx = (w: string, wo: string) =>
      cjk
        ? wo.indexOf(w)
        : (new RegExp(`(?<![\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "iu").exec(wo)?.index ?? -1);

    // Erste Runde: Die Einstufung EROEFFNET ihren Satz. Steht das Wort weiter hinten, ist es
    // eine Aussage ueber das Gelaende und nicht die Stufe: "Technisch einfach, aber alpines
    // Gelaende" stuft nicht ein, und "There is nothing strenuous about it" verneint sogar.
    // Auch im Koreanischen eroeffnet die Einstufung ihren Satz ("상급이고 ..."); steht sie
    // weiter hinten, meint sie etwas anderes (bei der Goldbergbahn die Pisten).
    const treffer: { g: Grade; von: number; bis: number }[] = [];
    for (const [g, ws] of Object.entries(G) as [Grade, string[]][])
      for (const w of ws) {
        const i = idx(w, kopf);
        if (i === 0) treffer.push({ g, von: i, bis: i + w.length });
      }
    if (!treffer.length) continue;

    // Zweite Runde: die andere Haelfte einer Spanne ("Leicht bis mittel", "Facile a moyen").
    // Laeuft nur, wenn vorne schon eine Stufe stand, sonst waeren die blossen
    // Eigenschaftswoerter eine Fehlalarm-Maschine.
    for (const [g, ws] of Object.entries(SPANNE[lang] ?? {}) as [Grade, string[]][])
      for (const w of ws) {
        const i = idx(w, kopf);
        if (i >= 0) treffer.push({ g, von: i, bis: i + w.length });
      }

    // Ein Treffer INNERHALB eines anderen ist keiner: Im polnischen "Srednio trudna"
    // (mittel) steckt "trudna" (schwer). Zwei Stufen NEBENEINANDER sind dagegen beide
    // gemeint, wie im deutschen "Leicht bis mittel".
    for (const t of treffer)
      if (!treffer.some((o) => o !== t && (o.von !== t.von || o.bis !== t.bis) && o.von <= t.von && o.bis >= t.bis)) out.add(t.g);
  }
  return [...out];
}
