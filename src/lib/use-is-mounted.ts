"use client";

import { useSyncExternalStore } from "react";

// Nichts zu abonnieren: der Wert wechselt genau einmal, von Server zu Client.
const noSubscribe = () => () => {};

// "Läuft der Code schon im Browser?" — die Antwort für alles, was erst nach dem
// Einhängen gerendert werden darf. Bei uns sind das die Portale: Vollbild-Karte
// (MapCard, SpotDetailMap) und Lightbox rufen createPortal(document.body) auf, und
// document gibt es auf dem Server nicht.
//
// Bisher stand dafür überall:
//
//   const [mounted, setMounted] = useState(false);
//   useEffect(() => setMounted(true), []);
//
// Das rendert zweimal und ist unter React 19 nicht mehr erlaubt
// (react-hooks/set-state-in-effect). useSyncExternalStore ist der dafür vorgesehene
// Weg: getServerSnapshot liefert beim Rendern auf dem Server und beim Hydrieren false,
// getSnapshot danach im Browser true. React kennt den Wechsel und behandelt ihn als
// Teil der Hydration statt als nachgeschobene Zustandsänderung — kein Kaskaden-Render
// und kein Hydration-Mismatch.
export function useIsMounted(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}
