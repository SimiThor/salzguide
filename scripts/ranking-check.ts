// Prüft die Regal-Reihenfolge der Explore-Seite (Stufen + Abwechslungs-Regel). Aufruf:
//   npm run ranking:check
//
// Es importiert die ECHTE Funktion aus src/lib (über den Alias-Hook), baut also nichts
// nach. Geprüft wird jedes Versprechen aus docs/38 einzeln — genau die Fälle, die im
// Browser niemandem auffallen, weil die Seite auch mit falscher Reihenfolge "richtig"
// aussieht:
//
//   1. Das erste Regal zeigt die reine Stufen-Reihenfolge (das Beste wirklich vorne).
//   2. Der Hochkeil-Fall: Wer im ersten Regal vorne stand, räumt im nächsten die
//      Top-Plätze für frische Spots — bleibt aber im Regal.
//   3. Ein schon gezeigtes Highlight fällt dabei NICHT hinter die Zurückhaltenden.
//   4. Nur die ersten TOP_SLOTS Plätze zählen als "vorne" — Platz 4 wird nicht bestraft.
//   5. Sommer und Winter rechnen getrennt (Sommer-Auftritte kosten im Winter nichts).
//   6. Feinsortierung bei gleicher Stufe: neuere Spots zuerst, dann Slug — stabil.
//   7. Determinismus: gleicher Input -> exakt gleiches Ergebnis (liegt im Cache!).
import {
  rankShelves,
  shelfKey,
  TOP_SLOTS,
  type RankCategory,
  type RankSpot,
} from "../src/lib/explore-ranking.ts";

let failed = 0;
const ok = (name: string) => console.log(`  ok    ${name}`);
const bad = (name: string, got: unknown, want: unknown) => {
  failed++;
  console.log(`  FEHLT ${name}\n        erwartet: ${JSON.stringify(want)}\n        bekommen: ${JSON.stringify(got)}`);
};
const eq = (name: string, got: unknown, want: unknown) =>
  JSON.stringify(got) === JSON.stringify(want) ? ok(name) : bad(name, got, want);

const cat = (key: string, sortOrder: number, season = "summer"): RankCategory => ({
  key,
  season,
  sortOrder,
});
const spot = (
  slug: string,
  weight: number,
  cats: string[],
  opts?: { createdAt?: string; seasons?: string[]; catSeason?: string },
): RankSpot => ({
  slug,
  weight,
  createdAt: opts?.createdAt ?? "2026-01-01T00:00:00Z",
  seasons: opts?.seasons ?? ["summer"],
  categoryKeys: cats.map((key) => ({ key, season: opts?.catSeason ?? "summer" })),
});

// ── 1. Erstes Regal: reine Stufen-Reihenfolge ───────────────────────────────
console.log("\n1. Erstes Regal: reine Stufen-Reihenfolge");
{
  const r = rankShelves(
    [cat("favoriten", 0)],
    [
      spot("almkanal", 1, ["favoriten"]),
      spot("hochkeil", 3, ["favoriten"]),
      spot("gaisberg", 2, ["favoriten"]),
      spot("parkbank", 0, ["favoriten"]),
    ],
  );
  eq("Stufe 3 vorne, Zurückhaltend hinten", r.get(shelfKey("favoriten", "summer")), [
    "hochkeil",
    "gaisberg",
    "almkanal",
    "parkbank",
  ]);
}

// ── 2.+3. Der Hochkeil-Fall ─────────────────────────────────────────────────
console.log("\n2. Hochkeil-Fall: vorne gewesen -> im nächsten Regal Platz machen");
{
  const spots = [
    spot("hochkeil", 3, ["favoriten", "leicht"]),
    spot("fuschlsee", 2, ["favoriten"]),
    spot("gaisberg", 2, ["favoriten"]),
    spot("almkanal", 2, ["leicht"]),
    spot("koenigsweg", 1, ["leicht"]),
    spot("plainberg", 1, ["leicht"]),
    spot("parkbank", 0, ["leicht"]),
  ];
  const r = rankShelves([cat("favoriten", 0), cat("leicht", 1)], spots);
  eq("Favoriten: Hochkeil auf Platz 1", r.get(shelfKey("favoriten", "summer")), [
    "hochkeil",
    "fuschlsee",
    "gaisberg",
  ]);
  const leicht = r.get(shelfKey("leicht", "summer")) ?? [];
  eq("Leicht: frische Spots vorne, Hochkeil dahinter", leicht, [
    "almkanal",
    "koenigsweg",
    "plainberg",
    "hochkeil",
    "parkbank",
  ]);
  eq("Leicht: Hochkeil raus aus den Top-Plätzen", leicht.slice(0, TOP_SLOTS).includes("hochkeil"), false);
  eq(
    "Leicht: Hochkeil bleibt aber VOR den Zurückhaltenden",
    leicht.indexOf("hochkeil") < leicht.indexOf("parkbank"),
    true,
  );
}

// ── 4. Nur die Top-Plätze zählen als "vorne" ────────────────────────────────
console.log("\n3. Nur die ersten " + TOP_SLOTS + " Plätze zählen als vorne");
{
  const spots = [
    spot("alpha", 3, ["erste"]),
    spot("beta", 3, ["erste"]),
    spot("gamma", 3, ["erste"]),
    // Platz 4 im ersten Regal -> gilt NICHT als gezeigt:
    spot("viertplatz", 2, ["erste", "zweite"]),
    spot("frisch", 2, ["zweite"]),
  ];
  const r = rankShelves([cat("erste", 0), cat("zweite", 1)], spots);
  eq("Platz 4 wird im nächsten Regal nicht bestraft", r.get(shelfKey("zweite", "summer")), [
    "frisch",
    "viertplatz",
  ]);
}

// ── 4b. Zurückhaltend bleibt hinten, auch nach einem Top-Platz ──────────────
console.log("\n3b. Zurückhaltend bleibt hinten, auch nach einem Top-Platz");
{
  // "nurfueller" gewinnt Regal 1 nur, weil dort nichts Stärkeres steht. Im zweiten
  // Regal darf ihn das nicht vor die frischen Zurückhaltenden heben.
  const spots = [
    spot("nurfueller", 0, ["erste", "zweite"]),
    spot("anderer", 0, ["zweite"], { createdAt: "2026-06-01T00:00:00Z" }),
    spot("gaisberg", 2, ["zweite"]),
  ];
  const r = rankShelves([cat("erste", 0), cat("zweite", 1)], spots);
  eq("Füller steigt nicht in die Mitte auf", r.get(shelfKey("zweite", "summer")), [
    "gaisberg",
    "anderer",
    "nurfueller",
  ]);
}

// ── 5. Saisons rechnen getrennt ─────────────────────────────────────────────
console.log("\n4. Sommer und Winter getrennt");
{
  const allrounder: RankSpot = {
    slug: "allrounder",
    weight: 3,
    createdAt: "2026-01-01T00:00:00Z",
    seasons: ["summer", "winter"],
    categoryKeys: [
      { key: "favoriten", season: "summer" },
      { key: "winterwandern", season: "winter" },
    ],
  };
  const r = rankShelves(
    [cat("favoriten", 0), cat("winterwandern", 0, "winter")],
    [
      allrounder,
      spot("gaisberg", 2, ["favoriten"]),
      spot("rodelbahn", 2, ["winterwandern"], { seasons: ["winter"], catSeason: "winter" }),
    ],
  );
  eq("Sommer: Allrounder vorne", r.get(shelfKey("favoriten", "summer"))?.[0], "allrounder");
  eq(
    "Winter: Sommer-Auftritt kostet nichts, Allrounder wieder vorne",
    r.get(shelfKey("winterwandern", "winter")),
    ["allrounder", "rodelbahn"],
  );
}

// ── 6. Feinsortierung: neuere zuerst, dann Slug ─────────────────────────────
console.log("\n5. Feinsortierung bei gleicher Stufe");
{
  const r = rankShelves(
    [cat("favoriten", 0)],
    [
      spot("zeder", 2, ["favoriten"], { createdAt: "2026-06-01T00:00:00Z" }),
      spot("ahorn", 2, ["favoriten"], { createdAt: "2026-01-01T00:00:00Z" }),
      spot("birke", 2, ["favoriten"], { createdAt: "2026-01-01T00:00:00Z" }),
    ],
  );
  eq("Neuere zuerst, bei gleichem Datum der Slug", r.get(shelfKey("favoriten", "summer")), [
    "zeder",
    "ahorn",
    "birke",
  ]);
}

// ── 7. Determinismus ────────────────────────────────────────────────────────
console.log("\n6. Determinismus (Ergebnis liegt im Cache)");
{
  const cats = [cat("favoriten", 0), cat("leicht", 1)];
  const spots = [
    spot("hochkeil", 3, ["favoriten", "leicht"]),
    spot("gaisberg", 2, ["favoriten"]),
    spot("almkanal", 2, ["leicht"]),
  ];
  const a = [...rankShelves(cats, spots).entries()];
  const b = [...rankShelves(cats, spots).entries()];
  eq("Zwei Läufe, exakt ein Ergebnis", a, b);
}

console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen.` : "\nAlles grün.");
process.exitCode = failed ? 1 : 0;
