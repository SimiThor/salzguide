// Karten-Zusatzpunkte (Wasserstellen, Hütten, Parkplatz) an EINER Stelle definiert:
// Symbol, deutsches Admin-Label und der i18n-Key für die User-Karte. So bleiben Admin
// und User-Karte einheitlich und nichts wird doppelt gepflegt. Client-safe (keine DB).

// Alle antippbaren Kartenpunkte einer Wanderung/eines Spaziergangs. start/finish sind
// die Routen-Enden (🥾/🏁) — hier mitgeführt, damit sie genau wie die übrigen Punkte
// antippbar sind und einheitlich lokalisiert werden. "spot" ist der Spot selbst (ein
// einzelner Punkt ohne Route, z.B. ein Kaffeehaus): Er bringt sein eigenes Emoji und
// seinen eigenen Text mit, deshalb steht bei ihm kein Gattungs-Label im Katalog.
export type PoiKind = "water" | "hut" | "parking" | "start" | "finish" | "spot";

// Untertypen je Art. `code` steht in der DB (sprachneutral), `emoji` ist das Kartensymbol,
// `de` das Label im (deutschen) Admin, `key` der Schlüssel unter Detail.poi.* im Katalog.
type PoiSubtype = { code: string; emoji: string; de: string; key: string };

export const POI_SUBTYPES: Record<"water" | "hut", PoiSubtype[]> = {
  water: [
    { code: "fountain", emoji: "🚰", de: "Trinkbrunnen", key: "waterFountain" },
    { code: "spring", emoji: "💧", de: "Quelle", key: "waterSpring" },
    { code: "stream", emoji: "💧", de: "Bach", key: "waterStream" },
  ],
  hut: [
    { code: "staffed", emoji: "🛖", de: "Bewirtschaftete Hütte", key: "hutStaffed" },
    { code: "self", emoji: "🛖", de: "Selbstversorgerhütte", key: "hutSelf" },
    { code: "shelter", emoji: "🛖", de: "Schutzhütte", key: "hutShelter" },
  ],
};

// Fallback ohne Untertyp: Gattungssymbol + generischer Katalog-Key.
const POI_GENERIC: Record<PoiKind, { emoji: string; de: string; key: string }> = {
  water: { emoji: "💧", de: "Wasserstelle", key: "water" },
  hut: { emoji: "🛖", de: "Hütte", key: "hut" },
  parking: { emoji: "🅿️", de: "Parkplatz", key: "parking" },
  start: { emoji: "🥾", de: "Startpunkt", key: "start" },
  finish: { emoji: "🏁", de: "Ziel", key: "finish" },
  // Nur Rückfalloption: Der Spot liefert Emoji und Beschriftung selbst (siehe oben).
  spot: { emoji: "📍", de: "Spot", key: "spot" },
};

function subtypeOf(kind: PoiKind, subtype?: string): PoiSubtype | null {
  // Nur Wasser/Hütten haben Untertypen; parking/start/finish nie.
  if (!subtype || (kind !== "water" && kind !== "hut")) return null;
  return POI_SUBTYPES[kind].find((s) => s.code === subtype) ?? null;
}

// Kartensymbol für Art + Untertyp (Untertyp gewinnt, sonst Gattungssymbol).
export function poiEmoji(kind: PoiKind, subtype?: string): string {
  return subtypeOf(kind, subtype)?.emoji ?? POI_GENERIC[kind].emoji;
}

// Katalog-Key unter Detail.poi.* für die lokalisierte Beschriftung (User-Karte).
export function poiLabelKey(kind: PoiKind, subtype?: string): string {
  return subtypeOf(kind, subtype)?.key ?? POI_GENERIC[kind].key;
}

// Deutsches Label fürs Admin (title/aria).
export function poiDeLabel(kind: PoiKind, subtype?: string): string {
  return subtypeOf(kind, subtype)?.de ?? POI_GENERIC[kind].de;
}
