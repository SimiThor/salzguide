// Weiterleitungen von den Adressen der ALTEN WordPress-Seite auf die neuen.
//
// Wozu: salzguide.com zieht von WordPress auf diese App um. Die Domain bleibt, die Pfade
// ändern sich komplett (/alle/gaisberg/ -> /de/spot/gaisberg). Ohne Weiterleitung wäre für
// Google jede einzelne dieser Adressen tot, und die Wertung, die sie über Jahre gesammelt
// haben, wäre nicht "umgezogen", sondern weg. Google verlangt dafür eine dauerhafte
// Weiterleitung je alter Adresse und rät ausdrücklich davon ab, viele alte Adressen auf
// eine unpassende Seite zu werfen ("Soft 404").
//
// WARUM HIER UND NICHT IN proxy.ts:
// Die dokumentierte Reihenfolge ist headers -> redirects (next.config) -> Proxy. Der Proxy
// ist bei uns next-intl: Er sieht einen Pfad ohne Sprach-Präfix und schiebt eines davor.
// Lägen die Regeln also im Proxy oder dahinter, käme /alle/gaisberg/ dort schon als
// /de/alle/gaisberg an, und keine dieser Regeln würde je greifen. Sie MÜSSEN vor dem
// Sprach-Routing laufen, und genau dort stehen sie.
//
// WARUM 301 UND NICHT NEXTS ÜBLICHES 308:
// Google behandelt beide gleich, das ist belegt. Aber 301 ist der Code, den jedes
// Log-Werkzeug, jeder SEO-Crawler und jeder alte Client ohne Rückfrage versteht. Der
// einzige Vorteil von 308 ist, dass es die HTTP-Methode erhält — und diese Adressen werden
// ausschliesslich per GET abgerufen. Es gibt also nichts zu erhalten und nichts zu gewinnen.
//
// DIE REIHENFOLGE IN DIESER LISTE IST BEDEUTUNG, NICHT GESCHMACK:
// Next nimmt den ERSTEN Treffer. Alles Besondere steht deshalb vor der allgemeinen
// Spot-Regel am Ende. Wer eine Zeile nach unten schiebt, schaltet sie unter Umständen ab.

/** Eine Weiterleitung in der Form, die next.config erwartet. */
export type LegacyRedirect = {
  source: string;
  destination: string;
  statusCode: 301;
};

// Die Kategorie-Präfixe der alten Seite, unter denen ein Spot gelegen haben kann.
//
// TATSÄCHLICH BELEGT sind nur zwei: 101 der 102 alten Beiträge lagen unter /alle/, genau
// einer unter /aussichtspunkte/ (dom-zu-salzburg). Die übrigen Namen sind das Netz: Es sind
// die Kategorien, die die alte Seite unter /category/ führt, und WordPress hätte einen
// Beitrag unter jeder von ihnen ausliefern können. Eine Regel zu viel kostet hier nichts —
// sie leitet auf eine Spot-Adresse, die es nicht gibt, und das ist eine 404 wie vorher auch.
// Eine Regel zu wenig kostet eine Adresse, die Google kennt und wir nicht.
const DE_SPOT_PREFIXES = "alle|aussichtspunkte|seen|parks|wasserfalle|panoramastrasen|sonstige";

// Dasselbe auf Englisch. Belegt sind all (74), waterfalls (1) und other (1); der Rest kommt
// aus /en/category/. Hier ist das Netz ungefährlicher als auf Deutsch, weil die englischen
// Spot-Adressen zusätzlich auf "-2" enden müssen (siehe unten).
const EN_SPOT_PREFIXES =
  "all|castles|gorges|hikes|lakes|other|panoramic-roads|park|viewpoints|waterfalls";

export const legacyRedirects: LegacyRedirect[] = [
  // ───────────────────────────────────────────────────────────────────────────
  // 1. Die Wassertemperatur-Seite. Der namentliche Grund für diese Datei: Sie
  //    rankt, und sie heisst auf der neuen Seite völlig anders.
  // ───────────────────────────────────────────────────────────────────────────
  { source: "/wassertemperaturen-salzburger-seen", destination: "/de/wasser", statusCode: 301 },
  { source: "/en/lake-temperatures-in-salzburg", destination: "/en/wasser", statusCode: 301 },

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Themenseiten der alten Seite. Sie ranken auf ihre Stichwörter, haben aber
  //    kein 1:1-Gegenstück. Jede geht dorthin, wo ihr Inhalt heute WIRKLICH liegt.
  // ───────────────────────────────────────────────────────────────────────────
  // "Abkühlung" heisst baden gehen. Das ist heute die Wasser-Seite mit den Temperaturen,
  // nicht die allgemeine Karte.
  { source: "/abkuehlung-in-salzburg", destination: "/de/wasser", statusCode: 301 },
  // Leichte Wanderungen sind eine Auswahl aus dem Spot-Bestand -> die Karte.
  {
    source: "/leichte-wanderungen-mit-aussicht-nahe-salzburg",
    destination: "/de/explore",
    statusCode: 301,
  },
  // Hier gibt es ein echtes 1:1-Ziel: den Spot selbst.
  {
    source: "/sound-of-music-drehorte-im-salzburger-land",
    destination: "/de/spot/sound-of-music-trail",
    statusCode: 301,
  },
  // Der Altstadt-Audioguide ist heute das Audio-Touren-Angebot (/touren heisst im Text
  // "Audio-Touren"). Thematisch dieselbe Sache, nicht bloss die nächstbeste Seite.
  { source: "/salzburg-altstadt-audioguide", destination: "/de/touren", statusCode: 301 },
  // Kurzvideos hängen heute an den Spots, es gibt keine eigene Video-Seite mehr.
  { source: "/kurzvideos", destination: "/de/explore", statusCode: 301 },
  { source: "/en/short-videos", destination: "/en/explore", statusCode: 301 },

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Feste Seiten, deutsch.
  // ───────────────────────────────────────────────────────────────────────────
  { source: "/events", destination: "/de/events", statusCode: 301 },
  { source: "/wir", destination: "/de/ueber-uns", statusCode: 301 },
  { source: "/agb", destination: "/de/rechtliches/agb", statusCode: 301 },
  { source: "/widerruf", destination: "/de/rechtliches/widerruf", statusCode: 301 },
  // /impressum/ steht in KEINER Sitemap, antwortet aber mit 200. Es wäre durchgerutscht,
  // hätte ich mich auf die Sitemap verlassen — Pflichtseiten sind oft auf noindex und
  // trotzdem verlinkt. (/datenschutz/ gibt es auf der alten Seite nicht, deshalb fehlt es.)
  { source: "/impressum", destination: "/de/rechtliches/impressum", statusCode: 301 },
  // Merkliste: Die alte Seite hatte zwei Adressen für dieselbe Sache.
  { source: "/mybookmarks", destination: "/de/gespeichert", statusCode: 301 },
  { source: "/user-bookmark-dashboard", destination: "/de/gespeichert", statusCode: 301 },
  // Mitgliedschaft = heute Pro.
  { source: "/membership-join", destination: "/de/pro", statusCode: 301 },
  { source: "/membership-join/membership-registration", destination: "/de/pro", statusCode: 301 },
  { source: "/thank-you", destination: "/de/pro", statusCode: 301 },
  { source: "/danke", destination: "/de/pro", statusCode: 301 },
  // Login/Profil des alten Plugins -> die eine Profilseite. Sie zeigt Nicht-Angemeldeten
  // den Login, deckt also beide alten Adressen ab.
  { source: "/membership-login", destination: "/de/profil", statusCode: 301 },
  { source: "/membership-login/membership-profile", destination: "/de/profil", statusCode: 301 },
  { source: "/membership-login/password-reset", destination: "/de/profil", statusCode: 301 },

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Feste Seiten, englisch. /en/explore/ fehlt hier ABSICHTLICH: Diese Adresse
  //    heisst auf der neuen Seite genauso. Eine Regel darauf wäre eine Schleife.
  // ───────────────────────────────────────────────────────────────────────────
  { source: "/en/we", destination: "/en/ueber-uns", statusCode: 301 },
  { source: "/en/terms-and-conditions", destination: "/en/rechtliches/agb", statusCode: 301 },
  { source: "/en/privacy-policy", destination: "/en/rechtliches/datenschutz", statusCode: 301 },
  { source: "/en/widerruf-en", destination: "/en/rechtliches/widerruf", statusCode: 301 },
  { source: "/en/bookmarked", destination: "/en/gespeichert", statusCode: 301 },
  { source: "/en/join-us", destination: "/en/pro", statusCode: 301 },
  { source: "/en/member-login", destination: "/en/profil", statusCode: 301 },
  { source: "/en/member-login/password-reset", destination: "/en/profil", statusCode: 301 },
  // Die alte englische Karte hiess /en/map-en/.
  { source: "/en/map-en", destination: "/en/explore", statusCode: 301 },

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Der Weekly-Bereich (25 Beiträge + seine Kategorie). Auf der neuen Seite gibt
  //    es keinen Blog; "was gerade ansteht" sind die Events. Anton hat das so
  //    entschieden — die Alternative wäre gewesen, 25 Adressen sterben zu lassen.
  // ───────────────────────────────────────────────────────────────────────────
  { source: "/salzguide-weekly/:slug", destination: "/de/events", statusCode: 301 },
  { source: "/category/salzguide-weekly", destination: "/de/events", statusCode: 301 },

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Kategorie- und Autoren-Archive. Alle Kategorien zeigten Spot-Listen; die
  //    Liste aller Spots ist heute die Karte.
  // ───────────────────────────────────────────────────────────────────────────
  { source: "/category/:slug", destination: "/de/explore", statusCode: 301 },
  { source: "/en/category/:slug", destination: "/en/explore", statusCode: 301 },
  // Das Autoren-Archiv der alten Seite war "admin" und listete alles von Anton.
  { source: "/author/:slug", destination: "/de/ueber-uns", statusCode: 301 },

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Drei Spots, die es auf der neuen Seite NICHT mehr gibt. Sie müssen VOR der
  //    allgemeinen Regel stehen, sonst leitet die sie auf eine Spot-Adresse, die
  //    404 antwortet. Alle drei waren Winter-Angebote; die Karte ist das Nächste,
  //    was ihren Inhalt heute noch trägt.
  // ───────────────────────────────────────────────────────────────────────────
  { source: "/alle/kulinarische-winterreise", destination: "/de/explore", statusCode: 301 },
  { source: "/alle/loipe", destination: "/de/explore", statusCode: 301 },
  { source: "/alle/rodelbahn-mondi", destination: "/de/explore", statusCode: 301 },

  // ───────────────────────────────────────────────────────────────────────────
  // 8. Die Spots selbst. Zuletzt, weil allgemein.
  // ───────────────────────────────────────────────────────────────────────────
  //
  // ENGLISCH ZUERST, und das ist wichtig: WordPress hat den englischen Übersetzungen
  // durchweg ein "-2" angehängt, weil der deutsche Beitrag den Slug schon belegt hatte.
  //
  //     /en/all/almkanal-2/   ->  /en/spot/almkanal
  //     /alle/almkanal/       ->  /de/spot/almkanal
  //
  // Das gilt AUSNAHMSLOS für alle 76 englischen Spot-Adressen (nachgezählt, nicht
  // vermutet), und alle 76 treffen einen Spot, den es heute noch gibt. Das "-2" ist
  // ausserdem das Unterscheidungsmerkmal, das diese Regel ungefährlich macht:
  // /en/category/waterfalls/ endet nicht darauf und wird deshalb nicht erfasst.
  //
  // Der Doppelname-Fall ist mitgedacht: "hangar-7-2" muss zu "hangar-7" werden, nicht zu
  // "hangar". Das erledigt die Regel von selbst, weil sie bis zum LETZTEN "-2" liest.
  {
    source: `/en/:cat(${EN_SPOT_PREFIXES})/:slug-2`,
    destination: "/en/spot/:slug",
    statusCode: 301,
  },
  // Deutsch: Slug unverändert, nur der Pfad davor ist neu. Alle 95 Spots der neuen Seite
  // tragen denselben Slug wie ihr alter Beitrag, deshalb braucht es hier KEINE Liste —
  // eine Liste würde bei jedem neuen oder umbenannten Spot veralten, ohne dass es auffällt.
  {
    source: `/:cat(${DE_SPOT_PREFIXES})/:slug`,
    destination: "/de/spot/:slug",
    statusCode: 301,
  },

  // NICHT WEITERGELEITET, mit Absicht:
  //
  //   /elementor-hf/*        Kopf- und Fusszeilen-Vorlagen des Seitenbaukastens. Sie sind
  //                          nie eine Seite gewesen und hätten nie indexiert werden dürfen.
  //   /alle/*-template/      Vier Vorlagen- und Test-Beiträge (food-spot-template,
  //   /alle/video-maker-test/ outdoor-spot-template, werbung-anzeige-template,
  //                          video-maker-test). Sie stehen in keiner Sitemap.
  //   /feed/                 Der RSS-Feed. Ein Feed gehört nicht auf eine HTML-Seite
  //                          weitergeleitet; wer ihn abonniert hat, soll einen Fehler
  //                          sehen und nicht stumm eine Startseite geliefert bekommen.
  //
  // Für all das ist eine 404 die richtige Antwort, und Google sagt das auch so: Inhalte
  // ohne Nachfolger sollen 404 oder 410 liefern, nicht irgendwohin zeigen.
];
