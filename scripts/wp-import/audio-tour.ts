// Übernimmt die Stationen des Salzburg-Altstadt-Audioguides der alten Seite in den
// Audio-Punkte-POOL der neuen App (tour_points im Gebiet `salzburger-altstadt`).
// Aufruf:
//   npm run wp:audio-tour                Trockenlauf: zeigt, was entstünde
//   npm run wp:audio-tour -- --only steingasse,mozartsteg   einzelne Stationen
//   npm run wp:audio-tour -- --go        schreibt wirklich (Bilder + DB)
//   npm run wp:audio-tour -- --retext [--go]   Sprechtexte aus den Entwürfen NEU einspielen
//   npm run wp:audio-tour -- --meta [--go]     Tags/Typ/Emoji aus den Entwürfen setzen
//   npm run wp:audio-tour -- --i18n [--go]     Übersetzungen aus .wp-cache/audio-i18n/ einspielen
//
// --retext überschreibt den deutschen Sprechtext eines Punkts aus seinem Entwurf, aber
// NUR solange keine deutsche MP3 existiert: Eine Aufnahme, deren Transkript sich unter
// ihr wegdreht, ist genau die Inkonsistenz, die dieser Import sonst überall vermeidet.
// Steht schon eine Aufnahme da, meldet der Lauf das, und Text + Neuvertonung bleiben
// eine bewusste Entscheidung im Admin. Der source_hash der de-Zeile wird mitgezogen,
// damit vorhandene Übersetzungen automatisch als veraltet markiert werden.
//
// --meta liest tags/kind/emoji aus dem Entwurf. Tags und Typ werden nur GEFÜLLT, wo die
// DB leer ist (die Alt-Punkte hat Anton im Admin kuratiert, das gewinnt); ein Emoji im
// Entwurf ist dagegen eine ausdrückliche Korrektur und überschreibt. Tags müssen aus
// TAG_KEYS (src/lib/tour-tags.ts) stammen, sonst bricht der Lauf ab statt still zu raten.
//
// --i18n liest .wp-cache/audio-i18n/<slug>.json ({ en: { title, audioText }, ... }) und
// spielt Titel + Sprechtext je Sprache ein. Dieselbe Aufnahme-Regel wie --retext, nur je
// Sprache: Existiert für eine Sprache schon eine MP3, wird GENAU diese Sprache gemeldet
// und übersprungen. Nach dem Einspielen bekommen die Ziel-Zeilen den aktuellen de-Hash
// als source_hash, wie savePoint nach „In alle Sprachen übersetzen" (Marke: aktuell).
// Die Übersetzungen sind Pro-Inhalt und bleiben wie die Entwürfe im gitignorierten Cache.
//
// QUELLE ist das `spots`-Array im Seitenquelltext von /salzburg-altstadt-audioguide/,
// wie bei den zwei Frontend-Karten des Spot-Imports (fetch.ts): Die Seite baut ihre
// Stationen per JavaScript aus genau diesem Array, es trägt Titel, Koordinate, Emoji,
// Bild und MP3 je Station. Was die alte Seite ihren Hörern zeigt, ist eine Station.
// Der Abzug landet als .wp-cache/audio-tour.json + .html im Cache und wird bei
// vorhandener Datei NICHT neu geladen — die alte Seite verschwindet mit dem
// Domain-Umzug, der Cache ist dann die einzige Quelle.
//
// WAS ES SCHREIBT UND WAS NICHT:
// - Punkte entstehen als ENTWURF (status 'draft'), wie beim Spot-Import. Veröffentlichen
//   bleibt Handarbeit im Admin, und das Publish-Gate in savePoint verlangt dafür ohnehin
//   Titel + Sprechtext + MP3 in ALLEN Sprachen.
// - Bestehende Punkte (Match über den deutschen Titel) werden NIE überschrieben, nur
//   LEERE Felder ergänzt (Bild, Koordinate, Emoji, Sprechtext). Ma Makers Cafe und
//   Getreidegasse haben bereits eigene Texte samt passender MP3 — ein neuer Text würde
//   Text und Aufnahme auseinanderreissen.
// - Die alten MP3s werden bewusst NICHT übernommen: Die deutschen Sprechtexte entstehen
//   neu (.wp-cache/audio-drafts/), und eine Aufnahme, die etwas anderes sagt als ihr
//   Transkript, ist schlimmer als gar keine. Vertonen macht der TTS-Knopf im Admin.
// - Ohne Entwurfstext wird eine NEUE Station übersprungen statt halb angelegt — dieselbe
//   Regel wie beim Spot-Import: Die Texte sind das Einzige, was niemand ableiten kann.
//
// Bilder laufen durch DIESELBEN Regeln wie ein Admin-Upload über PointForm: lange Kante
// 1600, WebP-Qualität 82 (image-upload.ts nutzt 0.82 auf der 0..1-Skala von canvas,
// sharp will 0..100), Bucket spot-media unter tours/<uuid>.webp, Cache ein Jahr. Fertige
// Uploads stehen in .wp-cache/audio-media-map.json und werden übersprungen; hochgeladen
// wird erst mit --go, damit Trockenläufe keine Waisen in den Bucket legen.
//
// WARUM DIREKT IN DIE DB UND NICHT ÜBER savePoint: wie import.ts — savePoint ist eine
// "use server"-Action mit Admin-Sitzung. Damit dasselbe herauskommt, importiert das
// Skript dieselben Module, die savePoint benutzt: slugifyKey für die Entwurfsnamen,
// guardStorageUrl für die Bild-URL, stripEmDash für den Gedankenstrich, hashTexts für
// den Übersetzungs-Stand (source_hash der de-Zeile).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { slugifyKey } from "../../src/lib/slug.ts";
import { guardStorageUrl } from "../../src/lib/storage-guard.ts";
import { hashTexts } from "../../src/lib/spot-hash.ts";
import { stripEmDash } from "../../src/lib/em-dash.ts";
import { TAG_KEYS } from "../../src/lib/tour-tags.ts";
import { routing } from "../../src/i18n/routing.ts";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Env fehlt (.env.local)");

const PAGE_URL = "https://www.salzguide.com/salzburg-altstadt-audioguide/";
const AREA_KEY = "salzburger-altstadt";
const BUCKET = "spot-media";

const CACHE_DIR = ".wp-cache";
const HTML_FILE = join(CACHE_DIR, "audio-tour.html");
const SOURCE_FILE = join(CACHE_DIR, "audio-tour.json");
const DRAFT_DIR = join(CACHE_DIR, "audio-drafts");
const I18N_DIR = join(CACHE_DIR, "audio-i18n");
const MAP_FILE = join(CACHE_DIR, "audio-media-map.json");

const TARGET_LOCALES = routing.locales.filter((l) => l !== "de");

// Wie src/lib/image-upload.ts (MAX_DIM / QUALITY) — Begründung im Kopfkommentar.
const IMAGE_MAX_DIM = 1600;
const IMAGE_QUALITY = 82;
const CACHE_CONTROL = "31536000";

const GO = process.argv.includes("--go");
const RETEXT = process.argv.includes("--retext");
const META = process.argv.includes("--meta");
const I18N = process.argv.includes("--i18n");
// Erst prüfen, ob --only überhaupt dasteht; ohne Liste dahinter: Fehler statt still
// „alle importieren" (dieselbe Falle wie in wp:publish, siehe README).
const onlyIdx = process.argv.indexOf("--only");
const onlyArg = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : undefined;
if (onlyIdx >= 0 && (!onlyArg || onlyArg.startsWith("--")))
  throw new Error("--only braucht eine Slug-Liste: --only steingasse,mozartsteg");
const ONLY = onlyArg && onlyIdx >= 0 ? onlyArg.split(",") : null;

type Station = {
  slug: string;
  title: string;
  lat: number;
  lng: number;
  emoji: string;
  image: string;
  audioSrc: string;
};

type MapEntry = { newUrl: string; bytesBefore: number; bytesAfter: number };

const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

// ── Quelle: Seite laden und `spots`-Array herausziehen ──────────────────────

// Die alte Seite schreibt "Rudolskai" — ein Tippfehler (die MP3 daneben heisst richtig
// Rudolfskai.mp3). Ein Import, der Tippfehler adoptiert, verewigt sie in neun Sprachen.
const TITLE_FIX: Record<string, string> = { Rudolskai: "Rudolfskai" };

function parseStations(html: string): Station[] {
  const arr = html.match(/const spots = \[([\s\S]*?)\];/);
  if (!arr) throw new Error("Kein `spots`-Array im Seitenquelltext gefunden");

  const stations: Station[] = [];
  // Jede Station ist ein flaches { … }-Objekt; verschachtelte Klammern gibt es nicht.
  for (const block of arr[1].match(/\{[\s\S]*?\}/g) ?? []) {
    const field = (re: RegExp): string | null => block.match(re)?.[1] ?? null;
    const lat = field(/lat:([\d.]+)/);
    const lng = field(/lng:([\d.]+)/);
    const emoji = field(/emojiFree:"([^"]*)"/);
    const rawTitle = field(/title:"([^"]*)"/);
    const image = field(/image:"([^"]*)"/);
    const audioSrc = field(/audioSrc:"([^"]*)"/);
    // Lieber abbrechen als raten: Eine Station ohne Pflichtfeld heisst, das Seitenformat
    // hat sich geändert, und dann stimmt womöglich auch der Rest der Zuordnung nicht.
    if (!lat || !lng || !rawTitle || !image || !emoji || !audioSrc)
      throw new Error(`Station unvollständig im Quelltext: ${block.slice(0, 120)}`);
    const title = TITLE_FIX[rawTitle] ?? rawTitle;
    stations.push({
      slug: slugifyKey(title),
      title,
      lat: Number(lat),
      lng: Number(lng),
      emoji,
      image,
      audioSrc,
    });
  }
  if (stations.length === 0) throw new Error("`spots`-Array ist leer");
  return stations;
}

async function loadSource(): Promise<Station[]> {
  if (existsSync(SOURCE_FILE))
    return JSON.parse(readFileSync(SOURCE_FILE, "utf8")) as Station[];
  const res = await fetch(PAGE_URL, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Seite nicht ladbar: HTTP ${res.status}`);
  const html = await res.text();
  const stations = parseStations(html);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(HTML_FILE, html);
  writeFileSync(SOURCE_FILE, JSON.stringify(stations, null, 1));
  console.log(`Seite geladen: ${stations.length} Stationen -> ${SOURCE_FILE}`);
  return stations;
}

// ── Entwürfe: die von mir geschriebenen deutschen Sprechtexte ───────────────

function loadDraft(slug: string): string | null {
  const file = join(DRAFT_DIR, `${slug}.json`);
  if (!existsSync(file)) return null;
  const draft = JSON.parse(readFileSync(file, "utf8")) as { audioTextDe?: string };
  const text = (draft.audioTextDe ?? "").trim();
  // Zwang statt Bitte, wie überall vor dem Speichern von KI-Text.
  return text ? stripEmDash(text, "de") : null;
}

type DraftMeta = { tags: string[] | null; kind: string | null; emoji: string | null };

function loadDraftMeta(slug: string): DraftMeta | null {
  const file = join(DRAFT_DIR, `${slug}.json`);
  if (!existsSync(file)) return null;
  const draft = JSON.parse(readFileSync(file, "utf8")) as {
    tags?: string[];
    kind?: string;
    emoji?: string;
  };
  const tags = Array.isArray(draft.tags) ? draft.tags.map((t) => String(t).trim().toLowerCase()) : null;
  if (tags) {
    const allowed = new Set<string>(TAG_KEYS);
    const bad = tags.filter((t) => !allowed.has(t));
    // Abbrechen statt still verwerfen: Ein Tippfehler im Tag fiele sonst nie auf.
    if (bad.length) throw new Error(`Unbekannte Tags in ${slug}: ${bad.join(", ")}`);
  }
  return {
    tags,
    kind: draft.kind?.trim() || null,
    emoji: draft.emoji?.trim() || null,
  };
}

// Übersetzungen je Punkt: { en: { title, audioText }, fr: ... } aus audio-i18n/<slug>.json.
type I18nTexts = Record<string, { title: string; audioText: string }>;

function loadI18n(slug: string): I18nTexts | null {
  const file = join(I18N_DIR, `${slug}.json`);
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<
    string,
    { title?: string; audioText?: string }
  >;
  const out: I18nTexts = {};
  for (const [lang, tx] of Object.entries(raw)) {
    if (!TARGET_LOCALES.includes(lang))
      throw new Error(`Unbekannte Sprache '${lang}' in ${slug} (erlaubt: ${TARGET_LOCALES.join(",")})`);
    const title = stripEmDash((tx.title ?? "").trim(), lang);
    const audioText = stripEmDash((tx.audioText ?? "").trim(), lang);
    // Halbe Sprache ist keine Sprache: Titel UND Text, sonst Abbruch.
    if (!title || !audioText) throw new Error(`Sprache '${lang}' in ${slug} unvollständig`);
    out[lang] = { title, audioText };
  }
  if (!Object.keys(out).length) return null;
  return out;
}

// ── Bilder: wie ein Admin-Upload über PointForm ─────────────────────────────

const mediaMap: Record<string, MapEntry> = existsSync(MAP_FILE)
  ? (JSON.parse(readFileSync(MAP_FILE, "utf8")) as Record<string, MapEntry>)
  : {};
const saveMap = () => writeFileSync(MAP_FILE, JSON.stringify(mediaMap, null, 1));

async function importImage(oldUrl: string): Promise<string> {
  const done = mediaMap[oldUrl];
  if (done) return done.newUrl;

  const res = await fetch(oldUrl, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`Bild nicht ladbar (HTTP ${res.status}): ${oldUrl}`);
  const src = Buffer.from(await res.arrayBuffer());

  // .rotate() wie in media.ts: sonst liegt die EXIF-Orientierung im Ergebnis quer.
  const out = await sharp(src)
    .rotate()
    .resize({ width: IMAGE_MAX_DIM, height: IMAGE_MAX_DIM, fit: "inside", withoutEnlargement: true })
    .webp({ quality: IMAGE_QUALITY })
    .toBuffer();

  // tours/-Ordner wie uploadImage(blob, "tours") in PointForm, frischer UUID-Pfad.
  const path = `tours/${randomUUID()}.webp`;
  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, out, { contentType: "image/webp", upsert: false, cacheControl: CACHE_CONTROL });
  if (error) throw new Error(`Upload fehlgeschlagen: ${error.message}`);
  const newUrl = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  // Nach JEDER Datei sichern: Ein abgebrochener Lauf darf fertige Uploads nicht vergessen.
  mediaMap[oldUrl] = { newUrl, bytesBefore: src.length, bytesAfter: out.length };
  saveMap();
  const kb = (n: number) => `${Math.round(n / 1024)} KB`;
  console.log(`  Bild: ${kb(src.length)} -> ${kb(out.length)}  ${path}`);
  return newUrl;
}

// ── DB-Zustand des Gebiets ──────────────────────────────────────────────────

type DbPoint = {
  id: string;
  lat: number | null;
  lng: number | null;
  emoji: string | null;
  image_url: string | null;
  tags: string[];
  kind: string | null;
  titleDe: string | null;
  audioTextDe: string | null;
  audioUrlDe: string | null;
  /** MP3-Pfad je Sprache (null = Zeile ohne Aufnahme, fehlt = keine Zeile). */
  audioUrlByLang: Record<string, string | null>;
};

// Titel-Vergleich unempfindlich gegen Gross/Klein und Mehrfach-Leerzeichen:
// die alte Seite schreibt "MA MAKERS Cafe", der Admin-Punkt heisst "Ma Makers Cafe".
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

async function loadArea(): Promise<{ areaId: string; points: DbPoint[] }> {
  const { data: area, error } = await db
    .from("tour_areas")
    .select("id")
    .eq("key", AREA_KEY)
    .single();
  // Das Gebiet ist kuratiert und existiert; ein Skript, das es still neu anlegte, gäbe
  // beim Tippfehler im Key ein zweites, leeres Gebiet statt einer Fehlermeldung.
  if (error || !area) throw new Error(`Gebiet '${AREA_KEY}' nicht gefunden`);

  const { data: rows, error: e2 } = await db
    .from("tour_points")
    .select("id, lat, lng, emoji, image_url, tags, kind, tour_point_translations(lang, title), tour_point_audio(lang, audio_text, audio_url)")
    .eq("area_id", area.id);
  if (e2) throw new Error(`Punkte nicht lesbar: ${e2.message}`);

  const points: DbPoint[] = ((rows ?? []) as unknown as Record<string, unknown>[]).map((p) => {
    const trs = (p.tour_point_translations as { lang: string; title: string }[] | null) ?? [];
    const audio =
      (p.tour_point_audio as { lang: string; audio_text: string | null; audio_url: string | null }[] | null) ?? [];
    const de = audio.find((a) => a.lang === "de");
    return {
      id: p.id as string,
      lat: p.lat as number | null,
      lng: p.lng as number | null,
      emoji: p.emoji as string | null,
      image_url: p.image_url as string | null,
      tags: (p.tags as string[] | null) ?? [],
      kind: p.kind as string | null,
      titleDe: trs.find((t) => t.lang === "de")?.title ?? null,
      audioTextDe: de?.audio_text ?? null,
      audioUrlDe: de?.audio_url ?? null,
      audioUrlByLang: Object.fromEntries(audio.map((a) => [a.lang, a.audio_url])),
    };
  });
  return { areaId: area.id, points };
}

// ── Retext: Sprechtext aus dem Entwurf neu einspielen (nur ohne Aufnahme) ───

async function retextStation(
  st: Station,
  existing: DbPoint | undefined,
  draft: string | null,
): Promise<string> {
  if (!existing) return "ÜBERSPRUNGEN: Punkt existiert nicht (erst normal importieren)";
  if (!draft) return "ÜBERSPRUNGEN: kein Entwurfstext";
  if (existing.audioUrlDe)
    return "ÜBERSPRUNGEN: hat schon eine deutsche Aufnahme (Text im Admin ändern + neu vertonen)";
  if ((existing.audioTextDe ?? "").trim() === draft) return "ok, Text ist aktuell";

  const words = draft.split(/\s+/).length;
  if (!GO) return `würde Sprechtext ersetzen (${words} Wörter)`;

  const { error } = await db.from("tour_point_audio").upsert(
    { point_id: existing.id, lang: "de", audio_text: draft },
    { onConflict: "point_id,lang" },
  );
  if (error) throw new Error(`Sprechtext fehlgeschlagen: ${error.message}`);
  const { error: eHash } = await db
    .from("tour_point_translations")
    .update({ source_hash: hashTexts([existing.titleDe ?? st.title, draft]) })
    .eq("point_id", existing.id)
    .eq("lang", "de");
  if (eHash) throw new Error(`source_hash fehlgeschlagen: ${eHash.message}`);
  return `Sprechtext ersetzt (${words} Wörter)`;
}

// ── Meta: Tags/Typ füllen, Emoji-Korrekturen anwenden ───────────────────────

async function metaStation(st: Station, existing: DbPoint | undefined): Promise<string> {
  if (!existing) return "ÜBERSPRUNGEN: Punkt existiert nicht (erst normal importieren)";
  const meta = loadDraftMeta(st.slug);
  if (!meta) return "ÜBERSPRUNGEN: kein Entwurf";

  const patch: Record<string, unknown> = {};
  const parts: string[] = [];
  // Tags/Typ nur füllen: Was Anton im Admin kuratiert hat, gewinnt.
  if (meta.tags?.length && existing.tags.length === 0) {
    patch.tags = meta.tags;
    parts.push(`Tags [${meta.tags.join(", ")}]`);
  }
  if (meta.kind && !existing.kind) {
    patch.kind = meta.kind;
    parts.push(`Typ '${meta.kind}'`);
  }
  // Emoji im Entwurf = ausdrückliche Korrektur, überschreibt.
  if (meta.emoji && meta.emoji !== existing.emoji) {
    patch.emoji = meta.emoji;
    parts.push(`Emoji ${existing.emoji ?? "·"} -> ${meta.emoji}`);
  }
  if (!Object.keys(patch).length) return "ok, nichts zu tun";
  if (!GO) return `würde setzen: ${parts.join(", ")}`;

  const { error } = await db.from("tour_points").update(patch).eq("id", existing.id);
  if (error) throw new Error(`Meta fehlgeschlagen: ${error.message}`);
  return `gesetzt: ${parts.join(", ")}`;
}

// ── I18n: Titel + Sprechtexte je Sprache einspielen ─────────────────────────

async function i18nStation(st: Station, existing: DbPoint | undefined): Promise<string> {
  if (!existing) return "ÜBERSPRUNGEN: Punkt existiert nicht (erst normal importieren)";
  const texts = loadI18n(st.slug);
  if (!texts) return "ÜBERSPRUNGEN: keine Übersetzungsdatei";
  if (!existing.audioTextDe || !existing.titleDe)
    return "ÜBERSPRUNGEN: kein deutscher Titel/Text als Quelle";

  const parts: string[] = [];
  const skipped: string[] = [];
  const write: [string, { title: string; audioText: string }][] = [];
  for (const lang of TARGET_LOCALES) {
    const tx = texts[lang];
    if (!tx) {
      skipped.push(`${lang} (fehlt in Datei)`);
      continue;
    }
    // Aufnahme-Regel je Sprache: Text nie unter einer existierenden MP3 wegdrehen.
    if (existing.audioUrlByLang[lang]) {
      skipped.push(`${lang} (hat Aufnahme)`);
      continue;
    }
    write.push([lang, tx]);
  }
  if (!write.length) return `ÜBERSPRUNGEN: ${skipped.join(", ")}`;
  if (!GO)
    return `würde ${write.length} Sprachen einspielen (${write.map(([l]) => l).join(", ")})${skipped.length ? `; übersprungen: ${skipped.join(", ")}` : ""}`;

  // Marke „aktuell": der Hash des DE-Standes, aus dem übersetzt wurde (wie savePoint).
  const sourceHash = hashTexts([existing.titleDe, existing.audioTextDe]);
  for (const [lang, tx] of write) {
    const { error: eTr } = await db.from("tour_point_translations").upsert(
      { point_id: existing.id, lang, title: tx.title, source_hash: sourceHash },
      { onConflict: "point_id,lang" },
    );
    if (eTr) throw new Error(`Titel (${lang}) fehlgeschlagen: ${eTr.message}`);
    const { error: eAu } = await db.from("tour_point_audio").upsert(
      { point_id: existing.id, lang, audio_text: tx.audioText },
      { onConflict: "point_id,lang" },
    );
    if (eAu) throw new Error(`Sprechtext (${lang}) fehlgeschlagen: ${eAu.message}`);
    parts.push(lang);
  }
  return `eingespielt: ${parts.join(", ")}${skipped.length ? `; übersprungen: ${skipped.join(", ")}` : ""}`;
}

// ── Import ──────────────────────────────────────────────────────────────────

async function upsertStation(
  areaId: string,
  st: Station,
  existing: DbPoint | undefined,
  draft: string | null,
): Promise<string> {
  // Neue Station ohne Text nicht halb anlegen (Begründung im Kopfkommentar).
  if (!existing && !draft) return "ÜBERSPRUNGEN: kein Entwurfstext";

  const fillImage = !existing?.image_url;
  const fillText = !existing?.audioTextDe && !!draft;
  const fillCoord = existing ? existing.lat == null || existing.lng == null : true;
  const fillEmoji = existing ? !existing.emoji : true;
  if (existing && !fillImage && !fillText && !fillCoord && !fillEmoji)
    return "ok, nichts zu tun";

  const parts: string[] = [];
  if (!GO) {
    if (!existing) parts.push("NEU als Entwurf");
    if (fillImage) parts.push("Bild");
    if (existing && fillCoord) parts.push("Koordinate");
    if (existing && fillEmoji) parts.push("Emoji");
    if (fillText) parts.push(`Sprechtext (${draft!.split(/\s+/).length} Wörter)`);
    return `würde schreiben: ${parts.join(", ")}`;
  }

  // Bild erst jetzt holen: nur für Stationen, die wirklich eines brauchen.
  let imageUrl: string | null = existing?.image_url ?? null;
  if (fillImage) {
    const guarded = guardStorageUrl(await importImage(st.image));
    if (!guarded.ok) throw new Error(`Bild-URL fällt durch guardStorageUrl: ${st.slug}`);
    imageUrl = guarded.url;
    parts.push("Bild");
  }

  let pointId = existing?.id;
  if (existing) {
    const patch: Record<string, unknown> = {};
    if (fillImage) patch.image_url = imageUrl;
    if (fillCoord) {
      patch.lat = st.lat;
      patch.lng = st.lng;
      parts.push("Koordinate");
    }
    if (fillEmoji) {
      patch.emoji = st.emoji;
      parts.push("Emoji");
    }
    if (Object.keys(patch).length) {
      const { error } = await db.from("tour_points").update(patch).eq("id", existing.id);
      if (error) throw new Error(`Update fehlgeschlagen: ${error.message}`);
    }
  } else {
    const { data, error } = await db
      .from("tour_points")
      .insert({
        area_id: areaId,
        lat: st.lat,
        lng: st.lng,
        emoji: st.emoji,
        image_url: imageUrl,
        status: "draft",
        tags: [],
        weight: 0,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Insert fehlgeschlagen: ${error?.message}`);
    pointId = (data as { id: string }).id;
    parts.push("neu als Entwurf");

    const { error: eTr } = await db.from("tour_point_translations").upsert(
      { point_id: pointId, lang: "de", title: st.title },
      { onConflict: "point_id,lang" },
    );
    if (eTr) throw new Error(`Titel fehlgeschlagen: ${eTr.message}`);
  }

  if (fillText && pointId) {
    const { error } = await db.from("tour_point_audio").upsert(
      { point_id: pointId, lang: "de", audio_text: draft },
      { onConflict: "point_id,lang" },
    );
    if (error) throw new Error(`Sprechtext fehlgeschlagen: ${error.message}`);
    // Stand-Marke wie savePoint: hashTexts([Titel, Sprechtext]) auf der de-Zeile,
    // damit der Veraltet-Vergleich der Übersetzungen später greifen kann.
    await db
      .from("tour_point_translations")
      .update({ source_hash: hashTexts([existing?.titleDe ?? st.title, draft]) })
      .eq("point_id", pointId)
      .eq("lang", "de");
    parts.push(`Sprechtext (${draft!.split(/\s+/).length} Wörter)`);
  }

  return `geschrieben: ${parts.join(", ")}`;
}

// ── Ablauf ──────────────────────────────────────────────────────────────────

const stations = await loadSource();
const { areaId, points } = await loadArea();
const byTitle = new Map(points.filter((p) => p.titleDe).map((p) => [norm(p.titleDe!), p]));

const MODE = RETEXT ? "RETEXT" : META ? "META" : I18N ? "I18N" : "IMPORT";
console.log(
  `\n${GO ? MODE : `TROCKENLAUF (${MODE})`}: ${stations.length} Stationen, Gebiet '${AREA_KEY}'\n`,
);

let skipped = 0;
for (const st of stations) {
  if (ONLY && !ONLY.includes(st.slug)) continue;
  const existing = byTitle.get(norm(st.title));
  const result = RETEXT
    ? await retextStation(st, existing, loadDraft(st.slug))
    : META
      ? await metaStation(st, existing)
      : I18N
        ? await i18nStation(st, existing)
        : await upsertStation(areaId, st, existing, loadDraft(st.slug));
  if (result.startsWith("ÜBERSPRUNGEN")) skipped++;
  console.log(`${st.emoji} ${st.title} (${st.slug}): ${result}`);
}
if (skipped)
  console.log(`\n${skipped} Station(en) ohne Entwurf in ${DRAFT_DIR}/<slug>.json übersprungen.`);
if (!GO) console.log("\nTrockenlauf. Schreiben mit: npm run wp:audio-tour -- --go");
