"use client";

// ═══ TESTHAKEN – NICHT DAUERHAFT (siehe lib/google-bike-directions.ts) ═══
// Lädt die Google Maps JavaScript API GENAU EINMAL pro Seite, über Googles offiziellen
// "dynamic library import"-Bootstrap (empfohlener Weg seit 2023, ersetzt das alte
// <script src="...&callback=...">-Muster). Nach dem Bootstrap liefert
// `google.maps.importLibrary(name)` jede gebrauchte Teilbibliothek einzeln nach.
//
// Bewusst ein schlanker, selbstgeschriebener Loader statt einer NPM-Bibliothek
// (@googlemaps/js-api-loader): Für einen isolierten Test lohnt keine zusätzliche
// Abhängigkeit, und Googles eigener Bootstrap-Schnipsel ist genau dafür gedacht, inline zu
// stehen.
type GoogleBootstrapOptions = {
  key: string;
  v?: string;
};

// Googles offizieller Bootstrap-Loader (aus der Doku übernommen, nur eingerückt). Er
// definiert `google.maps.importLibrary` als eine Funktion, die das eigentliche <script>
// erst beim ERSTEN Aufruf nachlädt (nicht schon beim Ausführen dieser Funktion) – mehrere
// Aufrufer können ihn also gefahrlos mehrfach anstossen.
function runBootstrap(opts: GoogleBootstrapOptions): void {
  /* eslint-disable */
  (function (g: any) {
    var h: any,
      a: any,
      k: any,
      p = "The Google Maps JavaScript API",
      c = "google",
      l = "importLibrary",
      q = "__ib__",
      m = document,
      b: any = window;
    b = b[c] || (b[c] = {});
    var d = b.maps || (b.maps = {}),
      r = new Set(),
      e = new URLSearchParams(),
      u = () =>
        h ||
        (h = new Promise(async (f: any, n: any) => {
          await (a = m.createElement("script"));
          e.set("libraries", [...r] + "");
          for (k in g) e.set(k.replace(/[A-Z]/g, (t: string) => "_" + t[0].toLowerCase()), g[k]);
          e.set("callback", c + ".maps." + q);
          a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
          d[q] = f;
          a.onerror = () => (h = n(Error(p + " could not load.")));
          a.nonce = m.querySelector<HTMLScriptElement>("script[nonce]")?.nonce || "";
          m.head.append(a);
        }));
    d[l]
      ? console.warn(p + " only loads once. Ignoring:", g)
      : (d[l] = (f: any, ...n: any[]) => r.add(f) && u().then(() => d[l](f, ...n)));
  })(opts);
  /* eslint-enable */
}

let bootstrapped = false;
let apiKeyUsed: string | null = null;

// Googles eingebauter Alarm für GENAU diese Fehlerklasse (falscher/fehlender Key, eine
// HTTP-Referrer-Beschränkung, die diese Domain nicht erlaubt, oder Abrechnung aus) – er
// ruft `window.gm_authFailure()` auf, wenn es die definiert. Ohne diesen Haken bleibt so
// ein Fehler unsichtbar: Die Karte selbst kann noch grau/leer laden, während jede Anfrage
// (auch DirectionsService) im Stillen abgelehnt wird. Besonders wichtig für "geht lokal,
// nicht auf Prod" – lokale und Prod-Domain haben fast immer unterschiedliche Referrer-
// Freigaben.
function hookAuthFailure(): void {
  const w = window as unknown as { gm_authFailure?: () => void };
  if (w.gm_authFailure) return;
  w.gm_authFailure = () => {
    console.error(
      "[google-maps-loader] gm_authFailure: Google lehnt den API-Key auf DIESER Domain " +
        `(${window.location.origin}) ab. Häufigste Ursachen: der Key hat eine HTTP-Referrer-` +
        "Beschränkung, die diese Domain nicht enthält (Google Cloud Console -> APIs & Dienste " +
        "-> Anmeldedaten -> Key -> Anwendungseinschränkungen), oder Abrechnung ist im Projekt " +
        "nicht aktiv. Das erklärt auch \"geht lokal, nicht auf Prod\": localhost und die Prod-" +
        "Domain brauchen dort JEWEILS einen eigenen erlaubten Eintrag.",
    );
  };
}

type LoadedLibraries = {
  Map: typeof google.maps.Map;
  DirectionsService: typeof google.maps.DirectionsService;
  Marker: typeof google.maps.Marker;
  SymbolPath: typeof google.maps.SymbolPath;
};

// EINE Stelle, die den API-Schlüssel anfasst und die drei Teilbibliotheken lädt, die diese
// Testseite braucht: "maps" (Map-Klasse), "routes" (DirectionsService fürs Fahrrad-Routing)
// und "marker" (klassische Marker + Symbol-Pfeile für Positions-Punkt/Stopp-Pins).
export async function loadGoogleMapsLibraries(apiKey: string): Promise<LoadedLibraries> {
  if (typeof window === "undefined") throw new Error("Google Maps braucht den Browser.");
  hookAuthFailure();
  if (!bootstrapped) {
    runBootstrap({ key: apiKey, v: "weekly" });
    bootstrapped = true;
    apiKeyUsed = apiKey;
  } else if (apiKeyUsed && apiKeyUsed !== apiKey) {
    // Kann in dieser Test-App praktisch nicht passieren (ein Schlüssel, eine .env) – aber
    // ein zweiter Bootstrap mit anderem Key würde Googles eigener Loader ignorieren
    // (siehe console.warn oben), was sonst ein stilles Rätsel wäre.
    throw new Error("Google Maps wurde bereits mit einem anderen Schlüssel geladen.");
  }
  const [mapsLib, routesLib, markerLib, coreLib] = await Promise.all([
    google.maps.importLibrary("maps") as Promise<google.maps.MapsLibrary>,
    google.maps.importLibrary("routes") as Promise<google.maps.RoutesLibrary>,
    google.maps.importLibrary("marker") as Promise<google.maps.MarkerLibrary>,
    google.maps.importLibrary("core") as Promise<google.maps.CoreLibrary>,
  ]);
  return {
    Map: mapsLib.Map,
    DirectionsService: routesLib.DirectionsService,
    Marker: markerLib.Marker,
    SymbolPath: coreLib.SymbolPath,
  };
}
