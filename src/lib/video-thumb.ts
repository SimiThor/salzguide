// Erstes Bild eines Videos als Thumbnail (data:-URL). Damit zeigt ein <video>-Kasten NIE
// einen Blackscreen, bevor jemand abspielt: wir setzen das gewonnene Bild als poster.
//
// Robust und bewusst nur für LOKALE Videos gedacht (Blob-URLs, z.B. das fertige Story-Video):
// kurz laden, an einen winzigen Offset springen (nicht der oft leere Frame 0), einen Frame auf
// ein Canvas zeichnen, als JPEG zurückgeben. Fremd-Domain-Videos (Supabase) würden das Canvas
// „vergiften" (CORS) und toDataURL werfen lassen - die fangen wir ab und geben null zurück
// (dann bleibt es beim bisherigen Verhalten, nichts bricht).
export async function firstFrameDataUrl(url: string): Promise<string | null> {
  if (typeof document === "undefined") return null;
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    let done = false;
    const finish = (result: string | null) => {
      if (done) return;
      done = true;
      v.removeAttribute("src");
      try {
        v.load();
      } catch {
        // egal - wir räumen nur auf
      }
      resolve(result);
    };
    const grab = () => {
      try {
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (!w || !h) return finish(null);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) return finish(null);
        ctx.drawImage(v, 0, 0, w, h);
        finish(c.toDataURL("image/jpeg", 0.82));
      } catch {
        finish(null); // CORS-getaintetes Canvas o.ä. -> lieber kein Poster als ein Crash
      }
    };
    v.addEventListener("error", () => finish(null), { once: true });
    v.addEventListener(
      "loadeddata",
      () => {
        v.addEventListener("seeked", grab, { once: true });
        try {
          v.currentTime = Math.min(0.05, (v.duration || 1) / 2);
        } catch {
          grab();
        }
      },
      { once: true },
    );
    // Sicherheitsnetz: nie hängen bleiben.
    setTimeout(() => finish(null), 4000);
    v.src = url;
  });
}
