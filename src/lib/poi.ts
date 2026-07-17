// Karten-Zusatzpunkte (Wasserstellen, Hütten, Parkplatz) an EINER Stelle definiert:
// Symbol, deutsches Admin-Label und der i18n-Key für die User-Karte. So bleiben Admin
// und User-Karte einheitlich und nichts wird doppelt gepflegt. Client-safe (keine DB).

export type PoiKind = "water" | "hut" | "parking";

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
};

function subtypeOf(kind: PoiKind, subtype?: string): PoiSubtype | null {
  if (!subtype || kind === "parking") return null;
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
