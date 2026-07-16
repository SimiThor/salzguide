// Österreichische gesetzliche Feiertage – algorithmisch berechnet (fixe Daten +
// Oster-basierte bewegliche). Wartungsfrei & exakt für jedes Jahr, keine externe
// Quelle. Karfreitag ist in AT kein allgemeiner Feiertag -> nicht enthalten.

// Feiertagsname je Locale (alle 9 Sprachen). Deutsch = Basis/Fallback.
type Name = Record<string, string>;

const FIXED: Record<number, Name> = {
  101: { de: "Neujahr", en: "New Year's Day", it: "Capodanno", nl: "Nieuwjaarsdag", ko: "새해 첫날", fr: "Jour de l’An", zh: "元旦", es: "Año Nuevo", pt: "Ano Novo" },
  106: { de: "Heilige Drei Könige", en: "Epiphany", it: "Epifania", nl: "Driekoningen", ko: "주현절", fr: "Épiphanie", zh: "主显节", es: "Epifanía", pt: "Dia de Reis" },
  501: { de: "Staatsfeiertag", en: "Labour Day", it: "Festa dei lavoratori", nl: "Dag van de Arbeid", ko: "노동절", fr: "Fête du Travail", zh: "劳动节", es: "Día del Trabajo", pt: "Dia do Trabalhador" },
  815: { de: "Mariä Himmelfahrt", en: "Assumption Day", it: "Assunzione di Maria", nl: "Maria-Tenhemelopneming", ko: "성모 승천 대축일", fr: "Assomption", zh: "圣母升天节", es: "Asunción de María", pt: "Assunção de Maria" },
  1026: { de: "Nationalfeiertag", en: "National Day", it: "Festa nazionale", nl: "Nationale feestdag", ko: "국경일", fr: "Fête nationale", zh: "国庆日", es: "Fiesta Nacional", pt: "Dia Nacional" },
  1101: { de: "Allerheiligen", en: "All Saints' Day", it: "Ognissanti", nl: "Allerheiligen", ko: "만성절", fr: "Toussaint", zh: "诸圣节", es: "Día de Todos los Santos", pt: "Dia de Todos os Santos" },
  1208: { de: "Mariä Empfängnis", en: "Immaculate Conception", it: "Immacolata Concezione", nl: "Onbevlekte Ontvangenis", ko: "원죄 없는 잉태 대축일", fr: "Immaculée Conception", zh: "圣母无染原罪瞻礼", es: "Inmaculada Concepción", pt: "Imaculada Conceição" },
  1225: { de: "Christtag", en: "Christmas Day", it: "Natale", nl: "Eerste Kerstdag", ko: "성탄절", fr: "Noël", zh: "圣诞节", es: "Navidad", pt: "Natal" },
  1226: { de: "Stefanitag", en: "St Stephen's Day", it: "Santo Stefano", nl: "Tweede Kerstdag", ko: "성 스테파노 축일", fr: "Saint-Étienne", zh: "圣斯德望日", es: "Día de San Esteban", pt: "Dia de Santo Estêvão" },
};

// Oster-Offsets (Tage nach Ostersonntag) -> Feiertag
const MOVABLE: Record<number, Name> = {
  1: { de: "Ostermontag", en: "Easter Monday", it: "Lunedì dell’Angelo", nl: "Tweede Paasdag", ko: "부활절 월요일", fr: "Lundi de Pâques", zh: "复活节星期一", es: "Lunes de Pascua", pt: "Segunda-feira de Páscoa" },
  39: { de: "Christi Himmelfahrt", en: "Ascension Day", it: "Ascensione", nl: "Hemelvaartsdag", ko: "예수 승천 대축일", fr: "Ascension", zh: "耶稣升天节", es: "Ascensión", pt: "Ascensão" },
  50: { de: "Pfingstmontag", en: "Whit Monday", it: "Lunedì di Pentecoste", nl: "Tweede Pinksterdag", ko: "성령 강림 대축일 다음 월요일", fr: "Lundi de Pentecôte", zh: "圣灵降临节星期一", es: "Lunes de Pentecostés", pt: "Segunda-feira de Pentecostes" },
  60: { de: "Fronleichnam", en: "Corpus Christi", it: "Corpus Domini", nl: "Sacramentsdag", ko: "성체 성혈 대축일", fr: "Fête-Dieu", zh: "基督圣体圣血节", es: "Corpus Christi", pt: "Corpo de Deus" },
};

// Ostersonntag (Gregorianischer Kalender, Meeus/Jones/Butcher).
function easterSunday(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = März, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

// Feiertagsname für ein Datum (oder null) in der gewählten Sprache (alle 9; sonst Deutsch).
export function austrianHoliday(
  year: number,
  month: number,
  day: number,
  locale: string,
): string | null {
  const fixed = FIXED[month * 100 + day];
  if (fixed) return fixed[locale] ?? fixed.de;

  const diff = Math.round(
    (Date.UTC(year, month - 1, day) - easterSunday(year)) / 86_400_000,
  );
  const mov = MOVABLE[diff];
  return mov ? (mov[locale] ?? mov.de) : null;
}
