import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";
import { DEFAULT_LOCALE } from "@/i18n/locales";

// Das Web-App-Manifest: Was Android/Chrome wissen müssen, wenn jemand die Seite als App
// auf den Startbildschirm legt. iOS liest es teilweise mit (Name, Symbol), den Rest holt
// es aus den apple-*-Metadaten im Layout.
//
// EINE SPRACHE, MIT ABSICHT
//
// Ein Manifest gibt es pro Seite genau einmal, es kennt kein Sprach-Präfix. Deshalb steht
// hier Deutsch (DEFAULT_LOCALE) — und in `start_url` steht KEIN Präfix, damit der Proxy
// beim Start die Sprache aushandelt wie bei jedem anderen Aufruf auch. Ein Koreaner
// startet die App also auf /ko/explore, obwohl das Manifest deutsch ist.
//
// Ein festes /de/explore wäre der bequeme Fehler: Es funktioniert beim Testen (wir sind
// deutsch) und sperrt danach jeden anderen dauerhaft in der falschen Sprache ein, weil die
// installierte App IMMER dort startet.
//
// Der Beschreibungstext kommt aus messages/de.json und wird nicht hier abgetippt: sonst
// steht derselbe Satz an zwei Stellen und einer davon veraltet.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations({ locale: DEFAULT_LOCALE, namespace: "Meta" });

  return {
    // `id` friert die Identität der App ein. Ohne id leitet Chrome sie aus start_url ab —
    // die Installation gälte dann beim Domain-Umzug als andere App.
    id: "/",
    name: "SalzGuide",
    short_name: "SalzGuide",
    description: t("description"),
    lang: DEFAULT_LOCALE,
    dir: "ltr",
    // Die installierte App startet auf der KARTE, nicht auf der Startseite. Die Startseite
    // erklärt Fremden das Produkt; wer die App auf dem Homescreen hat, ist damit durch und
    // will die Spots sehen. `scope` bleibt "/", damit die Startseite trotzdem IN der App
    // aufgeht, wenn jemand im Menü daraufklickt, statt Safari daneben zu öffnen.
    start_url: "/explore",
    scope: "/",
    // standalone = ohne Browser-Leisten, wie eine echte App. Bewusst KEIN `orientation`:
    // die Karte darf quer.
    display: "standalone",
    background_color: "#faf6ec", // Startbildschirm beim Öffnen (Creme, wie der Body)
    theme_color: "#faf6ec", // Systemleiste in der laufenden App
    categories: ["travel", "navigation", "lifestyle"],
    icons: [
      // "any" = wird gezeigt wie es ist, deshalb die gerundete Variante.
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // "maskable" = Android schneidet selbst zu (Kreis, Squircle, was der Launcher will),
      // deshalb randlos. Fehlt dieser Eintrag, klebt Android das gerundete Symbol auf eine
      // weisse Kachel — ein rotes Quadrat auf weissem Grund im Kreis.
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
