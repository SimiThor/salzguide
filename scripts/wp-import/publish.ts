// Stellt Spots von Entwurf auf Veröffentlicht. Aufruf:
//   npm run wp:publish                       zeigt, was live ginge und was blockiert ist
//   npm run wp:publish -- --only gaisberg    einzelne Spots
//   npm run wp:publish -- --go               schreibt wirklich
//
// WARUM ES DIESES SKRIPT ÜBERHAUPT GIBT: Veröffentlichen war bewusst Handarbeit im Admin
// (siehe import.ts), und für einen einzelnen neuen Spot bleibt das auch richtig. Für den
// Erst-Start sind es 95 Stück auf einmal. 95-mal ein Formular öffnen, umstellen, speichern
// ist nicht sorgfältiger als ein Lauf, es ist nur länger — und nach dem dreissigsten Klick
// schaut niemand mehr hin, ob die Sprache wirklich vollständig ist.
//
// DAS GATE WIRD NICHT NACHGEBAUT, SONDERN IMPORTIERT. saveSpot lässt einen Spot nur live,
// wenn Ort UND alle Übersetzungen stehen (admin-actions.ts, „Veröffentlichen-Gate"). Ein
// Skript, das direkt in die DB schreibt, umgeht diese Action — also muss es dieselben
// Funktionen aufrufen: hashSpotTexts, translationsPublishable, translationStatus aus
// src/lib/spot-hash.ts. Ein nachgebautes Gate wäre eine zweite Wahrheit, die genau dann
// auseinanderläuft, wenn es darauf ankommt: beim Schritt, der Inhalte öffentlich macht.
//
// GEPRÜFT WIRD DOPPELT, WEIL DIE APP AN ZWEI STELLEN PRÜFT:
//   translationsPublishable  = alle Sprachen da UND die DE-Marke passt zum heutigen Text
//   translationStatus        = zusätzlich, dass keine EINZELNE Sprache veraltet ist
// Die erste Funktion kennt nur eine Marke am Objekt und würde eine einzelne zurückgebliebene
// Sprache durchlassen. Zusammen entspricht das dem, was Formular und Badge im Admin zeigen.
//
// KEIN FOTO IST EIN GRUND ZU WARTEN, KEIN GRUND ZU SCHEITERN: Die App ist bildgetrieben,
// ein Spot ohne Bild steht auf der Karte als graue Kachel. Das Gate im Admin verlangt kein
// Bild, deshalb blockiert es hier auch nicht — es wird gezählt und genannt, damit die
// Entscheidung sichtbar getroffen wird statt versehentlich.
import { createClient } from "@supabase/supabase-js";
import { TARGET_LOCALES } from "../../src/i18n/locales.ts";
import { selectAll } from "./select-all.ts";
import {
  hashSpotTexts,
  translationStatus,
  translationsPublishable,
} from "../../src/lib/spot-hash.ts";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Env fehlt (.env.local)");
const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const go = args.includes("--go");
// --only sowohl als „--only=a,b" wie als „--only a,b". Der getrennte Fall MUSS auf ein
// vorhandenes --only prüfen: indexOf liefert sonst -1, und args[0] wäre dann „--go" — die
// Liste stünde voll Unsinn, der Lauf fände keinen einzigen Spot und meldete „nichts zu tun".
const onlyIdx = args.indexOf("--only");
const onlyEq = args.find((a) => a.startsWith("--only="));
const onlyRaw = onlyEq ? onlyEq.split("=")[1] : onlyIdx >= 0 ? (args[onlyIdx + 1] ?? "") : "";
const only = new Set(
  onlyRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
if ((onlyEq || onlyIdx >= 0) && !only.size) throw new Error("--only ohne Spot-Liste");

type SpotRow = {
  id: string;
  slug: string;
  status: "draft" | "published";
  lat: number | null;
  lng: number | null;
  is_pro: boolean;
};
type TransRow = {
  spot_id: string;
  lang: string;
  title: string | null;
  short_desc: string | null;
  general: string | null;
  insider_tip: string | null;
  section_a: string | null;
  section_b: string | null;
  location_text: string | null;
  source_hash: string | null;
};

/** Der deutsche Text eines Spots in der Form, die hashSpotTexts erwartet. */
function deTexts(de: TransRow | undefined) {
  return {
    title: de?.title ?? "",
    shortDesc: de?.short_desc ?? "",
    general: de?.general ?? "",
    insiderTip: de?.insider_tip ?? "",
    sectionA: de?.section_a ?? "",
    sectionB: de?.section_b ?? "",
    locationText: de?.location_text ?? "",
  };
}

async function main() {
  const { data: spots, error: sErr } = await db
    .from("spots")
    .select("id, slug, status, lat, lng, is_pro")
    .order("slug");
  if (sErr) throw new Error(`spots lesen: ${sErr.message}`);

  // Seitenweise, die Tabelle ist über 1000 Zeilen (siehe select-all.ts).
  const trans = await selectAll<Record<string, unknown>>((from, to) =>
    db
      .from("spot_translations")
      .select(
        "spot_id, lang, title, short_desc, general, insider_tip, section_a, section_b, location_text, source_hash",
      )
      .range(from, to),
  );

  // Bilder nur zählen, nicht bewerten: ein Spot ohne Foto darf live, sieht aber leer aus.
  const { data: media, error: mErr } = await db.from("media").select("spot_id");
  if (mErr) throw new Error(`media lesen: ${mErr.message}`);
  const hatBild = new Set((media as { spot_id: string }[]).map((m) => m.spot_id));

  const byId = new Map<string, TransRow[]>();
  for (const r of trans as TransRow[]) {
    const list = byId.get(r.spot_id) ?? [];
    list.push(r);
    byId.set(r.spot_id, list);
  }

  const bereit: SpotRow[] = [];
  const blockiert: { slug: string; grund: string }[] = [];
  const schonLive: string[] = [];
  const ohneBild: string[] = [];

  for (const spot of (spots as SpotRow[]).filter((s) => !only.size || only.has(s.slug))) {
    if (spot.status === "published") {
      schonLive.push(spot.slug);
      continue;
    }

    const rows = byId.get(spot.id) ?? [];
    const de = rows.find((r) => r.lang === "de");
    const deHash = hashSpotTexts(deTexts(de));

    // Dieselbe Reihenfolge wie im Admin: erst der Ort, dann die Sprachen. Ohne Ort ist der
    // Spot auf einer Karten-App unsichtbar, das ist der härtere Fehler.
    if (spot.lat == null || spot.lng == null) {
      blockiert.push({ slug: spot.slug, grund: "kein Ort gesetzt" });
      continue;
    }
    if (!de?.title?.trim()) {
      blockiert.push({ slug: spot.slug, grund: "kein deutscher Text" });
      continue;
    }

    const alsObjekt: Record<string, { title?: string }> = {};
    for (const r of rows) if (r.lang !== "de") alsObjekt[r.lang] = { title: r.title ?? "" };

    if (!translationsPublishable(alsObjekt, de.source_hash, deHash, TARGET_LOCALES)) {
      const fehlend = TARGET_LOCALES.filter((l) => !(alsObjekt[l]?.title ?? "").trim());
      blockiert.push({
        slug: spot.slug,
        grund: fehlend.length
          ? `Übersetzung fehlt: ${fehlend.join(", ")}`
          : de.source_hash
            ? "deutscher Text neuer als die Übersetzungen"
            : "keine Übersetzungs-Marke (source_hash fehlt)",
      });
      continue;
    }

    const stand = translationStatus(rows, TARGET_LOCALES);
    if (stand.state !== "complete") {
      const alt = TARGET_LOCALES.filter((l) => {
        const r = rows.find((x) => x.lang === l);
        return r?.source_hash && r.source_hash !== de.source_hash;
      });
      blockiert.push({
        slug: spot.slug,
        grund: `Übersetzung veraltet (${stand.state}): ${alt.join(", ") || "?"}`,
      });
      continue;
    }

    bereit.push(spot);
    if (!hatBild.has(spot.id)) ohneBild.push(spot.slug);
  }

  for (const b of blockiert) console.log(`BLOCKIERT  ${b.slug}: ${b.grund}`);
  if (blockiert.length) console.log("");

  if (ohneBild.length) {
    console.log(`Ohne Bild (geht live, sieht aber leer aus): ${ohneBild.join(", ")}`);
    console.log("");
  }

  console.log(
    `${schonLive.length} schon veröffentlicht · ${bereit.length} bereit · ${blockiert.length} blockiert`,
  );
  const proBereit = bereit.filter((s) => s.is_pro).length;
  if (proBereit) console.log(`davon ${proBereit} Pro-Spots (bleiben serverseitig gesperrt)`);

  if (!go) {
    console.log("\nTrockenlauf. Mit --go wird geschrieben.");
    return;
  }
  if (!bereit.length) {
    console.log("\nNichts zu tun.");
    return;
  }

  // In Blöcken schreiben, damit ein Abbruch nicht mitten in einer 95er-Liste steht und
  // niemand weiss, wie weit sie kam. Der Lauf ist ohnehin wiederholbar: was schon live ist,
  // fällt oben unter „schonLive" raus.
  const CHUNK = 20;
  let ok = 0;
  for (let i = 0; i < bereit.length; i += CHUNK) {
    const teil = bereit.slice(i, i + CHUNK);
    const { error } = await db
      .from("spots")
      .update({ status: "published" })
      .in("id", teil.map((s) => s.id));
    if (error) throw new Error(`schreiben (ab ${teil[0].slug}): ${error.message}`);
    ok += teil.length;
    console.log(`${ok}/${bereit.length} veröffentlicht`);
  }

  console.log("\nDer Katalog-Cache hängt daran: npm run dev neu starten oder im Admin einmal speichern.");
}

main();
