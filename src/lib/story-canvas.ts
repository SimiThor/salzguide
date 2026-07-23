// Foto-Story: reine Zeichenlogik (ein System für Vorschau UND Export).
//
// Der Nutzer legt sein Foto in einen 9:16-Rahmen, wir zeichnen den echten Routenverlauf
// als Linie darüber (wie im Intro-Video), dazu eine schlichte Werte-Zeile und die
// SalzGuide-Wortmarke. Genau EINE Funktion (drawStory) malt alles; die Vorschau ruft sie in
// Bildschirmauflösung, der Export in 1080x1920 - mit relativen Maßen, damit die Vorschau
// exakt dem Ergebnis entspricht (WYSIWYG). Kein Server, kein Upload: das Foto bleibt am Gerät.
//
// Route-Look geteilt mit route-anim.ts: rote Linie auf weißer Kontur, runde Ecken.

import { ROUTE_LINE } from "@/lib/route-anim";

// 9:16 Hochformat, Export-Referenz. Alle Pixelmaße unten sind für 1080 Breite gedacht und
// werden über u = W/REF_W auf jede Auflösung skaliert.
export const STORY_W = 1080;
export const STORY_H = 1920;

export type StoryColor = "white" | "red";
// big    = Route groß oben, Werte als Spalten darunter
// stack  = Werte gestapelt groß oben, Route darunter, Wortmarke unten (Strava-Stil)
// corner = kleine Route in der Ecke, Werte darunter
// clean  = ohne Linie, nur Foto + Werte
export type StoryPreset = "big" | "stack" | "corner" | "clean";
export type StoryTransform = { scale: number; dx: number; dy: number };
// Ein Wert als Label + Wert (wie Strava: "Distanz" / "12,3 km"). Beides vorformatiert +
// lokalisiert, damit die Canvas-Logik nichts über Sprachen wissen muss.
export type StoryStat = { label: string; value: string };

export type StoryDrawOpts = {
  image: CanvasImageSource | null;
  imgW: number; // Rohmaße des Fotos (für cover + pan)
  imgH: number;
  transform: StoryTransform;
  route: [number, number][]; // [lng,lat]
  stats: StoryStat[];
  wordmark: string; // "SalzGuide"
  preset: StoryPreset;
  color: StoryColor;
};

type Box = { x: number; y: number; w: number; h: number };

// Kleinster Maßstab, bei dem das Foto den 9:16-Rahmen sicher füllt (cover).
export function coverScale(imgW: number, imgH: number, W: number, H: number): number {
  if (!imgW || !imgH) return 1;
  return Math.max(W / imgW, H / imgH);
}

// Pan so klemmen, dass das (skalierte) Foto den Rahmen immer voll deckt - nie ein leerer Rand.
export function clampTransform(
  tr: StoryTransform,
  imgW: number,
  imgH: number,
  W: number,
  H: number,
): StoryTransform {
  const dw = imgW * tr.scale;
  const dh = imgH * tr.scale;
  const maxX = Math.max(0, (dw - W) / 2);
  const maxY = Math.max(0, (dh - H) / 2);
  return {
    scale: tr.scale,
    dx: Math.min(maxX, Math.max(-maxX, tr.dx)),
    dy: Math.min(maxY, Math.max(-maxY, tr.dy)),
  };
}

// Route [lng,lat] in eine Pixel-Box projizieren (Nord oben, seitenverhältnistreu, zentriert).
// Für Wander-Ausdehnungen reicht die einfache equirektangulare Projektion mit cos(lat).
function projectRoute(route: [number, number][], box: Box): [number, number][] {
  const latMid = route.reduce((s, p) => s + p[1], 0) / route.length;
  const k = Math.cos((latMid * Math.PI) / 180);
  const pts = route.map(([lng, lat]) => [lng * k, -lat] as [number, number]);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanX = Math.max(1e-9, maxX - minX);
  const spanY = Math.max(1e-9, maxY - minY);
  const s = Math.min(box.w / spanX, box.h / spanY);
  const drawW = spanX * s;
  const drawH = spanY * s;
  const ox = box.x + (box.w - drawW) / 2 - minX * s;
  const oy = box.y + (box.h - drawH) / 2 - minY * s;
  return pts.map(([x, y]) => [ox + x * s, oy + y * s] as [number, number]);
}

// Wohin die Route je Preset kommt (relativ zur Fläche).
function routeBox(preset: StoryPreset, W: number, H: number): Box {
  if (preset === "corner") {
    // Kleiner, tiefer, leicht nach links - die Werte sitzen darunter.
    return { x: W * 0.08, y: H * 0.52, w: W * 0.4, h: H * 0.22 };
  }
  // "big": groß und vertikal MITTIG (wie Strava), mit Platz für die Werte direkt darunter
  // und Foto oben wie unten. Bewusst nicht zu weit oben.
  return { x: W * 0.15, y: H * 0.24, w: W * 0.7, h: H * 0.32 };
}

// Zeichnet die Route und gibt ihre tatsächliche Pixel-Bounding-Box zurück (damit die Werte
// direkt unter der Linie sitzen, nicht unter dem theoretischen Kasten).
function drawRoute(
  ctx: CanvasRenderingContext2D,
  route: [number, number][],
  box: Box,
  color: StoryColor,
  u: number,
): Box {
  const pts = projectRoute(route, box);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const bb: Box = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  if (pts.length < 2) return bb;

  const main = color === "white" ? "#ffffff" : ROUTE_LINE;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Nur EINE Linie in ihrer Farbe, mit weichem Schatten für Kontrast auf jedem Foto -
  // KEINE harte Kontur (auch Rot bleibt reines Rot). Etwas kräftiger, damit sie trägt.
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 12 * u;
  ctx.shadowOffsetY = 3 * u;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.lineWidth = 10 * u;
  ctx.strokeStyle = main;
  ctx.stroke();

  // Start- und Endpunkt: gefüllter Punkt in der Linienfarbe (gleicher weicher Schatten).
  const dot = (p: [number, number], r: number) => {
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    ctx.fillStyle = main;
    ctx.fill();
  };
  dot(pts[0], 6 * u);
  dot(pts[pts.length - 1], 8 * u);
  ctx.restore();
  return bb;
}

// Werte + Wortmarke als Gruppe, DIREKT unter der Route (nicht am Bildrand). Pro Wert eine
// Spalte: kleines Label oben, fetter Wert darunter (wie Strava). Darunter klein die Wortmarke.
function drawStats(
  ctx: CanvasRenderingContext2D,
  W: number,
  u: number,
  stats: StoryStat[],
  wordmark: string,
  cx: number,
  topY: number,
) {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  // Kräftiger, weicher Schatten (dunkler Halo) für gute Lesbarkeit auf hellen Fotos.
  ctx.shadowColor = "rgba(0,0,0,0.72)";
  ctx.shadowBlur = 22 * u;
  ctx.shadowOffsetY = 2 * u;

  const labelFont = `600 ${21 * u}px Inter, system-ui, -apple-system, sans-serif`;
  const valueFont = `700 ${37 * u}px Inter, system-ui, -apple-system, sans-serif`;
  const colGap = 48 * u;

  const cols = stats.filter((s) => s && s.value);
  let blockCx = cx;
  let y = topY;

  if (cols.length) {
    ctx.font = valueFont;
    const vW = cols.map((c) => ctx.measureText(c.value).width);
    ctx.font = labelFont;
    const lW = cols.map((c) => ctx.measureText(c.label).width);
    const colW = cols.map((_, i) => Math.max(vW[i], lW[i]));
    const total = colW.reduce((s, w) => s + w, 0) + colGap * (cols.length - 1);
    // Block im Bild halten (v.a. beim Ecke-Preset, wo die Route links sitzt).
    const half = total / 2;
    const margin = 44 * u;
    blockCx = Math.min(W - margin - half, Math.max(margin + half, cx));

    ctx.textAlign = "center";
    const labelY = topY;
    const valueY = topY + 35 * u;
    let x = blockCx - half;
    cols.forEach((c, i) => {
      const colCx = x + colW[i] / 2;
      ctx.font = labelFont;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(c.label, colCx, labelY);
      ctx.font = valueFont;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(c.value, colCx, valueY);
      x += colW[i] + colGap;
    });
    y = valueY + 46 * u;
  }

  ctx.restore();
  drawWordmark(ctx, wordmark, blockCx, y + 3 * u, u);
}

// Wortmarke: dezent, etwas größer als die Labels. Von beiden Layouts genutzt (eine Quelle).
function drawWordmark(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, u: number) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 18 * u;
  ctx.shadowOffsetY = 1 * u;
  ctx.font = `700 ${26 * u}px Inter, system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  drawTracked(ctx, text, cx, y, 1.5 * u);
  ctx.restore();
}

// Werte GESTAPELT (Label über Wert, groß, zentriert) - für das "stack"-Layout. Gibt die
// Unterkante zurück, damit die Route direkt darunter platziert werden kann.
function drawStatsStacked(
  ctx: CanvasRenderingContext2D,
  cx: number,
  topY: number,
  stats: StoryStat[],
  u: number,
): number {
  const cols = stats.filter((s) => s && s.value);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.72)";
  ctx.shadowBlur = 22 * u;
  ctx.shadowOffsetY = 2 * u;
  const labelFont = `600 ${22 * u}px Inter, system-ui, -apple-system, sans-serif`;
  const valueFont = `700 ${47 * u}px Inter, system-ui, -apple-system, sans-serif`;
  const stride = 100 * u;
  let y = topY;
  for (const c of cols) {
    ctx.font = labelFont;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText(c.label, cx, y);
    ctx.font = valueFont;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(c.value, cx, y + 50 * u);
    y += stride;
  }
  ctx.restore();
  return cols.length ? topY + (cols.length - 1) * stride + 60 * u : topY;
}

// "stack"-Layout: Werte gestapelt oben, Route darunter, Wortmarke unten - Foto bleibt unten
// dominant (Strava-Stil, an unseren Look angepasst).
function drawStackLayout(ctx: CanvasRenderingContext2D, o: StoryDrawOpts, u: number) {
  const W = STORY_W;
  const H = STORY_H;
  const cx = W / 2;
  const statsBottom = drawStatsStacked(ctx, cx, H * 0.09, o.stats, u);
  let wmY = statsBottom + 70 * u;
  if (o.route.length >= 2) {
    const box = { x: W * 0.19, y: statsBottom + 46 * u, w: W * 0.62, h: H * 0.22 };
    const bb = drawRoute(ctx, o.route, box, o.color, u);
    wmY = bb.y + bb.h + 56 * u;
  }
  drawWordmark(ctx, o.wordmark, cx, wmY, u);
}

// Text mittig mit gleichmäßiger Sperrung zeichnen (letterSpacing ist nicht überall verfügbar).
function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  spacing: number,
) {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((s, w) => s + w, 0) + spacing * (text.length - 1);
  let x = cx - total / 2;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = "left";
  [...text].forEach((ch, i) => {
    ctx.fillText(ch, x, y);
    x += widths[i] + spacing;
  });
  ctx.textAlign = prevAlign;
}

// Alles zeichnen. W/H = Zielauflösung (Vorschau ODER Export). Wir skalieren den Kontext auf
// die Referenz 1080x1920 und malen intern IMMER in Referenzkoordinaten. Dadurch ist die
// Pan/Zoom-Transformation in einem festen Koordinatensystem gespeichert -> Vorschau == Export.
export function drawStory(ctx: CanvasRenderingContext2D, W: number, H: number, o: StoryDrawOpts) {
  const ru = W / STORY_W;
  ctx.save();
  ctx.scale(ru, ru);
  drawStoryRef(ctx, o);
  ctx.restore();
}

function drawStoryRef(ctx: CanvasRenderingContext2D, o: StoryDrawOpts) {
  const W = STORY_W;
  const H = STORY_H;

  // 1) Foto (cover + pan) oder ruhiger Fallback-Verlauf (wenn noch kein Foto).
  if (o.image && o.imgW && o.imgH) {
    const dw = o.imgW * o.transform.scale;
    const dh = o.imgH * o.transform.scale;
    const dx = (W - dw) / 2 + o.transform.dx;
    const dy = (H - dh) / 2 + o.transform.dy;
    ctx.drawImage(o.image, dx, dy, dw, dh);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1b2a20");
    g.addColorStop(1, "#0c1410");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // 2) Sanfter Dunkelverlauf unten (hilft, wenn die Route tief sitzt).
  const grad = ctx.createLinearGradient(0, H * 0.66, 0, H);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, H * 0.66, W, H * 0.34);

  // 3+4) Layout. "stack" = Werte gestapelt oben, Route darunter (Strava-Stil). Sonst = Route
  //       oben, Werte als Spalten direkt darunter.
  if (o.preset === "stack") {
    drawStackLayout(ctx, o, 1);
  } else {
    let statsCx = W / 2;
    let statsTop = H * 0.7;
    if (o.preset !== "clean" && o.route.length >= 2) {
      const bb = drawRoute(ctx, o.route, routeBox(o.preset, W, H), o.color, 1);
      statsCx = bb.x + bb.w / 2;
      statsTop = bb.y + bb.h + 60;
    }
    drawStats(ctx, W, 1, o.stats, o.wordmark, statsCx, statsTop);
  }
}

// Dekorative Routen-Grafik für den Story-Hero auf Spots OHNE Intro-Video (sonst wäre die
// Section eine leere dunkle Fläche). Zeichnet nur die Route (rote Linie mit weichem Glanz,
// wie im Intro-Video) in die obere Hälfte - transparent, der CSS-Verlauf der Section bleibt
// darunter. Eigenes 4:3-Format (nicht 9:16), darum eigene Funktion statt drawStory.
export function drawRouteHero(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  route: [number, number][],
) {
  ctx.clearRect(0, 0, W, H);
  if (!route || route.length < 2) return;
  const u = W / 1000;

  // Weicher warmer Schimmer wie ein Abendlicht hinterm Grat: gibt der Section Tiefe und
  // Stimmung, ohne abzulenken. Liegt über dem kühlen CSS-Dämmerungsverlauf der Section.
  const gx = W * 0.36;
  const gy = H * 0.3;
  const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(W, H) * 0.62);
  glow.addColorStop(0, "rgba(255,188,140,0.2)");
  glow.addColorStop(0.55, "rgba(255,150,110,0.06)");
  glow.addColorStop(1, "rgba(255,150,110,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Route in die obere Hälfte, aber nicht zu weit oben (mittiger, harmonischer). Unten bleibt
  // Platz für Titel + CTA (der Textblock nimmt am kleinen Handy-Hero proportional mehr Höhe ein).
  const pts = projectRoute(route, { x: W * 0.08, y: H * 0.1, w: W * 0.84, h: H * 0.46 });
  if (pts.length < 2) return;

  const path = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  };

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // WEISSE Route (die rote liegt schon auf der Karte direkt darüber): weicher weißer Schein,
  // dann die klare weiße Linie mit sanftem dunklem Schatten für die Tiefe.
  path();
  ctx.lineWidth = 20 * u;
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.stroke();
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 12 * u;
  ctx.shadowOffsetY = 2 * u;
  path();
  ctx.lineWidth = 8 * u;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  // Endpunkt: weißer Punkt mit leichtem Schein.
  ctx.shadowBlur = 6 * u;
  ctx.shadowOffsetY = 0;
  const end = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(end[0], end[1], 7 * u, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
}

// Export nach JPEG (max. Kompatibilität beim Teilen: Instagram/WhatsApp mögen kein WebP für
// Bilder). Kein WebP -> die toBlob-Falle aus image-upload.ts greift hier nicht; JPEG wird von
// jedem Browser sicher kodiert. drawStory füllt die ganze Fläche, es bleibt keine Transparenz.
export async function exportStoryJpeg(
  o: StoryDrawOpts,
  quality = 0.92,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  drawStory(ctx, STORY_W, STORY_H, o);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
  if (!blob) throw new Error("JPEG-Export fehlgeschlagen");
  return blob;
}
