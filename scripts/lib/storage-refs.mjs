// DIE EINE Liste aller DB-Spalten, die auf eine Datei im Bucket `spot-media` zeigen.
//
// Warum es diese Datei gibt: prune-orphan-images.mjs und recompress-storage.mjs führten die
// Liste getrennt voneinander. Beiden fehlte `spots.video_poster_url`. Das Standbild des
// Hochkeil-Videos galt damit als unbenutzt und wurde vom Aufräumer gelöscht, während die
// Datenbank weiter darauf zeigte: Vorschau und unscharfer Hintergrund blieben leer, das
// Video selbst lief. Eine Liste, die man an zwei Stellen pflegen muss, driftet.
//
// NEUE Spalte mit einer spot-media-URL? NUR hier eintragen. Beide Skripte folgen.
//
// kind steuert die Ziel-Kantenlänge beim Neu-Komprimieren:
//   "hero" gross · "photo" mittel · "avatar" klein · "video" = Datei anfassen VERBOTEN
//   (nur als "wird benutzt" melden, damit der Aufräumer sie in Ruhe lässt).

/**
 * Sammelt jede referenzierte spot-media-URL.
 *
 * @param sel   (table, cols) => Promise<Zeilen[]>  – Lesefunktion des aufrufenden Skripts
 * @param patch (table, where, body) => Promise<void> – Schreibfunktion; darf no-op sein
 * @param patchHome (id, field, url, w, h) => Promise<void> – dito für das media-jsonb
 * @returns {Promise<Array<{loc:string, kind:string, url:string, apply:Function}>>}
 */
export async function collectStorageRefs(sel, patch, patchHome) {
  const refs = [];
  const add = (loc, kind, url, apply) => {
    if (typeof url === "string" && url) refs.push({ loc, kind, url, apply });
  };

  for (const m of await sel("media", "id,type,url,poster_url,blur_url")) {
    add(`media[${m.id}].url`, "photo", m.url, (u) => patch("media", `id=eq.${m.id}`, { url: u }));
    add(`media[${m.id}].poster_url`, "photo", m.poster_url, (u) => patch("media", `id=eq.${m.id}`, { poster_url: u }));
    // Blur-Vorschauen sind mit 160px bereits winzig und werden nur geschützt, nie angefasst.
    add(`media[${m.id}].blur_url`, "video", m.blur_url, () => {});
  }

  // Spot-Video + sein Standbild. GENAU DIE ZEILE, die vorher fehlte.
  for (const s of await sel("spots", "id,video_url,video_poster_url")) {
    add(`spots[${s.id}].video_poster_url`, "photo", s.video_poster_url, (u) =>
      patch("spots", `id=eq.${s.id}`, { video_poster_url: u }));
    // Das Video selbst nur schützen, niemals umrechnen.
    add(`spots[${s.id}].video_url`, "video", s.video_url, () => {});
  }

  for (const e of await sel("events", "id,image_url"))
    add(`events[${e.id}]`, "photo", e.image_url, (u) => patch("events", `id=eq.${e.id}`, { image_url: u }));
  for (const t of await sel("tours", "id,cover_url"))
    add(`tours[${t.id}]`, "photo", t.cover_url, (u) => patch("tours", `id=eq.${t.id}`, { cover_url: u }));
  for (const a of await sel("tour_areas", "id,cover_url"))
    add(`tour_areas[${a.id}]`, "photo", a.cover_url, (u) => patch("tour_areas", `id=eq.${a.id}`, { cover_url: u }));
  for (const p of await sel("tour_points", "id,image_url"))
    add(`tour_points[${p.id}]`, "photo", p.image_url, (u) => patch("tour_points", `id=eq.${p.id}`, { image_url: u }));
  for (const l of await sel("locals", "id,avatar_url"))
    add(`locals[${l.id}]`, "avatar", l.avatar_url, (u) => patch("locals", `id=eq.${l.id}`, { avatar_url: u }));
  for (const s of await sel("app_settings", "key,value"))
    if (s.key === "toni_avatar_url")
      add("app_settings.toni", "avatar", s.value, (u) => patch("app_settings", `key=eq.${s.key}`, { value: u }));

  // home_content.media: ganzes jsonb lesen, Slot-src ersetzen, zurückschreiben.
  const slotKind = { heroPortrait: "hero", heroLandscape: "hero", antonPhoto: "avatar", simonPhoto: "avatar" };
  for (const hc of await sel("home_content", "id,media")) {
    const media = hc.media || {};
    for (const [slot, kind] of Object.entries(slotKind)) {
      if (!media[slot]?.src) continue;
      add(`home_content.${slot}`, kind, media[slot].src, (u, w, h) => patchHome(hc.id, slot, u, w, h));
    }
    add("home_content.video.poster", "photo", media.explainerVideo?.poster, (u) =>
      patchHome(hc.id, "explainerVideo.poster", u));
    // Erklärvideo der Startseite: schützen, nicht anfassen.
    add("home_content.video.src", "video", media.explainerVideo?.src, () => {});
  }

  return refs;
}
