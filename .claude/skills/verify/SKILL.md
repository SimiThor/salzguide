---
name: verify
description: SalzGuide am laufenden Browser prüfen – Dev-Server starten, mit Chrome for Testing über CDP echte Touch-Gesten auf einem iPhone-Viewport fahren, Screenshots als Beleg.
---

# SalzGuide verifizieren

Mobile-first App: fast alles Wichtige (Bottom-Sheets, Karte, Toni) sieht man nur auf einem
Touch-Viewport. Desktop-Klicks beweisen hier wenig.

## Starten

```bash
npm run dev            # http://localhost:3000, ~1s mit Turbopack, braucht .env.local
```

Kein Playwright im Projekt. Browser-Treiber in ein Scratchpad legen, nicht in package.json:

```bash
cd "$SCRATCHPAD" && npm i playwright-core --silent
```

Binary (Playwright-Cache ist schon da, aber NICHT unter dem Namen "Chromium"):

```
~/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
```

## Kontext

```js
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },   // iPhone 15
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
```

## Echte Finger statt Maus

Playwrights `touchscreen` kann nur tippen. Für Wischen `Input.dispatchTouchEvent` über CDP –
nur so laufen `touch-action` und der nicht-passive touchmove-Listener (useBodyDrag) wie am
iPhone. Zwischen den Move-Schritten ~16ms warten, nach `touchEnd` ~1s für die Snap-Animation.

```js
const cdp = await ctx.newCDPSession(page);
const send = (type, x, y) => cdp.send("Input.dispatchTouchEvent", {
  type, touchPoints: type === "touchEnd" ? [] : [{ x, y }],
});
```

## Wege zu den Sheets

| Sheet | Weg |
|---|---|
| MobileSheet (Explore) | `/de/explore`, wartet auf `[data-sg="mobile-sheet"]` |
| SpotSheet | `/de/explore`, `.mapboxgl-marker` antippen → `[data-sg="spot-sheet"]` |
| BottomSheet / Toni | `/de/explore`, `nav button[aria-label="KI"]` klicken |
| BottomSheet / Titel | `/de/wasser`, `.mapboxgl-marker` antippen |

Die Karte rendert headless inklusive Marker – Mapbox braucht keinen Sonderweg. Nach
`goto` ~3-4s warten, bis Kacheln und Marker da sind.

## Zwei Fallen, die schon Zeit gekostet haben

**Mehrere `[data-sg="bottom-sheet"]` im DOM.** Das Login-Gate ist auch ein BottomSheet und
bleibt gemountet (geschlossen, y = Viewport-Höhe). `querySelector` erwischt das falsche.
Immer über einen Inhalt auswählen, z.B. das Sheet, das `[aria-label="Neuer Chat"]` enthält.

**Der Sheet-Aufbau ist verschachtelt.** Nicht über `div.shrink-0 + div` gehen – der Balken
im Kopf trägt selbst `shrink-0`, der Selektor liefert dann den Header statt den Inhalt.
Über direkte Kinder gehen: `[0]` = Kopf (Balken + Header), `[1]` = Inhalt, `[2]` = Fußzeile.

**Geschlossen heißt nicht "weg".** Sheets bleiben oft im DOM und fahren nur nach unten.
Statt Element-Zahl die `getBoundingClientRect().top` messen.

## Scrollbaren Inhalt herstellen

Die meisten Sheet-Inhalte passen auf 390x844 komplett rein – dann gibt es nichts zu
scrollen und Proben zum Zusammenspiel Scrollen/Ziehen laufen ins Leere. Viewport auf
375x480 verkleinern, dann läuft z.B. Tonis Chat über.
