// Kleine, self-contained Wort-Tabellen für die WENIGEN Stellen, die NICHT über next-intl
// (messages/*.json) laufen können: Datenlabels für den KI-Assistenten „Toni" (werden dem
// Modell als Fakten übergeben) und Fallback-Namen. Deutsch = Basis/Fallback für alle 9 Sprachen.
// Für „echte" UI-Texte gilt weiterhin next-intl – das hier ist nur der Server-Rand.
import { DEFAULT_LOCALE } from "@/i18n/locales";

type LabelMap = Record<string, string>;

// Wert für die Locale wählen, sonst Deutsch (Basis). Robust gegen unbekannte Codes.
export function pickLabel(map: LabelMap, locale: string): string {
  return map[locale] ?? map[DEFAULT_LOCALE];
}

export const TODAY: LabelMap = {
  de: "heute",
  en: "today",
  it: "oggi",
  nl: "vandaag",
  ko: "오늘",
  fr: "aujourd’hui",
  zh: "今天",
  es: "hoy",
  pt: "hoje",
};

export const TOMORROW: LabelMap = {
  de: "morgen",
  en: "tomorrow",
  it: "domani",
  nl: "morgen",
  ko: "내일",
  fr: "demain",
  zh: "明天",
  es: "mañana",
  pt: "amanhã",
};

export const ALL_DAY: LabelMap = {
  de: "ganztägig",
  en: "all day",
  it: "tutto il giorno",
  nl: "hele dag",
  ko: "하루 종일",
  fr: "toute la journée",
  zh: "全天",
  es: "todo el día",
  pt: "o dia todo",
};

export const CLOSED: LabelMap = {
  de: "geschlossen",
  en: "closed",
  it: "chiuso",
  nl: "gesloten",
  ko: "휴무",
  fr: "fermé",
  zh: "休息",
  es: "cerrado",
  pt: "fechado",
};

// Standard-Ortsname fürs Wetter-Widget (lokalisierte Exonyme der Stadt Salzburg).
export const WEATHER_PLACE: LabelMap = {
  de: "Stadt Salzburg",
  en: "Salzburg",
  it: "Salisburgo",
  nl: "Salzburg",
  ko: "잘츠부르크",
  fr: "Salzbourg",
  zh: "萨尔茨堡",
  es: "Salzburgo",
  pt: "Salzburgo",
};

// Fallback-Name einer generierten Audio-Runde (falls die KI keinen Namen liefert).
export const AUDIO_WALK_FALLBACK: LabelMap = {
  de: "Deine Audio-Runde",
  en: "Your audio walk",
  it: "Il tuo giro audio",
  nl: "Jouw audiowandeling",
  ko: "나만의 오디오 산책",
  fr: "Votre balade audio",
  zh: "你的音频漫步",
  es: "Tu paseo en audio",
  pt: "O teu passeio em áudio",
};
