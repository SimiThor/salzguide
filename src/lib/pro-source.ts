// Woher jemandes Pro kommt. Die EINE Quelle für das, was in der Datenbank als Enum
// `pro_source` steht (Migration 0001).
//
// Bewusst ein winziges Modul ohne Server-Abhängigkeiten: Die Admin-Nutzerliste ist eine
// Client-Komponente und importiert aus lib/admin.ts nur Typen, weil dieses Modul den
// Supabase-Server-Client zieht. Eine Beschriftung von dort zu holen, würde Servercode ins
// Browser-Bundle ziehen. Hier kann sie gefahrlos stehen.

export type ProSource = "stripe" | "migration" | "comp";

export const PRO_SOURCES = ["stripe", "migration", "comp"] as const;

/** Kommt ein Wert aus der Datenbank wirklich aus dem Enum? */
export function isProSource(value: unknown): value is ProSource {
  return typeof value === "string" && (PRO_SOURCES as readonly string[]).includes(value);
}

// Die Herkunft als Wort, das man lesen kann. Vorher stand im Admin `Pro · comp`: der rohe
// Enum-Wert, den ausser uns niemand versteht. Nur "bezahlt" war übersetzt, die anderen
// drei Fälle rutschten englisch durch.
//
// Als Record statt als switch mit default: Kommt je ein vierter Wert ins Enum, meckert
// TypeScript hier, statt still wieder ein Fachwort in die Oberfläche zu lassen.
//
// Deutsch ohne next-intl, weil der ganze Admin-Bereich deutsch ist (siehe die
// Fehlertexte in AdminUserList und das de-AT-Datumsformat).
const LABEL: Record<ProSource, string> = {
  stripe: "bezahlt",
  migration: "übernommen",
  comp: "geschenkt",
};

/**
 * Für die Admin-Oberfläche. `null` gibt es laut Schema nur als Datenfehler (Pro ohne
 * Herkunft) und wird deshalb benannt statt versteckt: Ein leeres Feld sähe wie ein
 * Anzeigefehler aus, "Herkunft fehlt" ist eine Ansage.
 */
export function proSourceLabel(source: ProSource | null): string {
  return source ? LABEL[source] : "Herkunft fehlt";
}
