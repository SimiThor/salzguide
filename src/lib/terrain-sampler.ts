// Geländehöhe an BELIEBIGER Stelle (auch neben/gegenüber der Route), unabhängig vom
// Kamerablick. Mapbox' queryTerrainElevation liefert nur am gerenderten Mittelpunkt Werte;
// für den Kamera-Crash-Schutz brauchen wir aber die Höhe UNTER der Kamera, die off-route
// liegen kann. Darum laden wir die Mapbox-Terrain-RGB-Kacheln direkt und dekodieren sie.
//
// Terrain-RGB-Dekodierung (Mapbox-Standard): Höhe[m] = -10000 + (R*65536 + G*256 + B) * 0.1
// Nur clientseitig (fetch + Canvas). Rückgabe: elevAt(lng,lat) in echten Metern (NaN außerhalb).

type Tile = { data: Float32Array; w: number; h: number };

function project(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

export async function loadTerrainSampler(
  box: { w: number; s: number; e: number; n: number },
  token: string,
  zoom = 13,
): Promise<(lng: number, lat: number) => number> {
  const z = zoom;
  const tl = project(box.w, box.n, z); // oben-links
  const br = project(box.e, box.s, z); // unten-rechts
  const x0 = Math.floor(tl.x);
  const x1 = Math.floor(br.x);
  const y0 = Math.floor(tl.y);
  const y1 = Math.floor(br.y);

  const tiles = new Map<string, Tile>();
  const jobs: Promise<void>[] = [];
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      jobs.push(
        (async () => {
          const url = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${z}/${tx}/${ty}@2x.pngraw?access_token=${token}`;
          try {
            const res = await fetch(url);
            if (!res.ok) return;
            // WICHTIG: keine Farbprofil-/Alpha-Umrechnung, sonst kippen die exakten RGB-Werte
            // und die Höhe ist völlig daneben (R um 1 daneben = 6553 m Fehler).
            const bmp = await createImageBitmap(await res.blob(), {
              premultiplyAlpha: "none",
              colorSpaceConversion: "none",
            });
            const cv = document.createElement("canvas");
            cv.width = bmp.width;
            cv.height = bmp.height;
            const ctx = cv.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
            if (!ctx) return;
            ctx.drawImage(bmp, 0, 0);
            const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
            const px = img.data;
            const arr = new Float32Array(bmp.width * bmp.height);
            for (let i = 0; i < arr.length; i++) {
              arr[i] = -10000 + (px[i * 4] * 65536 + px[i * 4 + 1] * 256 + px[i * 4 + 2]) * 0.1;
            }
            tiles.set(`${tx}/${ty}`, { data: arr, w: bmp.width, h: bmp.height });
          } catch {
            /* Kachel fehlt -> dort NaN */
          }
        })(),
      );
    }
  }
  await Promise.all(jobs);

  return (lng: number, lat: number): number => {
    const p = project(lng, lat, z);
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    const tile = tiles.get(`${tx}/${ty}`);
    if (!tile) return NaN;
    const { data, w, h } = tile;
    const fx = (p.x - tx) * w;
    const fy = (p.y - ty) * h;
    const ix = Math.min(w - 1, Math.floor(fx));
    const iy = Math.min(h - 1, Math.floor(fy));
    const ix1 = Math.min(w - 1, ix + 1);
    const iy1 = Math.min(h - 1, iy + 1);
    const dx = fx - ix;
    const dy = fy - iy;
    const v00 = data[iy * w + ix];
    const v10 = data[iy * w + ix1];
    const v01 = data[iy1 * w + ix];
    const v11 = data[iy1 * w + ix1];
    return v00 * (1 - dx) * (1 - dy) + v10 * dx * (1 - dy) + v01 * (1 - dx) * dy + v11 * dx * dy;
  };
}
