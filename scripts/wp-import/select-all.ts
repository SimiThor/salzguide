// Eine Tabelle VOLLSTÄNDIG lesen, seitenweise.
//
// WARUM ES DAS BRAUCHT: PostgREST (und damit supabase-js) liefert ohne `range()` höchstens
// 1000 Zeilen zurück. Es sagt das NICHT: kein Fehler, keine Warnung, kein Flag am Ergebnis.
// Man bekommt ein Array, es sieht vollständig aus, und die Zeilen 1001 und folgende fehlen
// einfach. Welche das sind, entscheidet eine Sortierung, die niemand angegeben hat.
//
// Bei uns ist `spot_translations` über die Grenze gewachsen: 95 Spots mal 13 Sprachen sind
// 1235 Zeilen. Der Schaden war schon da, bevor jemand ihn gesucht hat:
//
//   - `wp:translate` baut aus dieser Tabelle die Liste der deutschen Ausgangstexte. Vier der
//     95 deutschen Zeilen lagen jenseits der Grenze, also meldete das Skript für vier Spots
//     „kein deutscher Text in der Datenbank" und übersprang sie. Der deutsche Text steht da.
//   - Der Frische-Check in `.wp-cache/export-de.mjs` meldete 42 Übersetzungen als „in DB
//     keine Zeile", die alle existieren. Ein Prüfer, der erfundene Lücken meldet, wird nach
//     dem dritten Mal weggeklickt.
//   - `wp:reset` schreibt eine Sicherung, BEVOR es Spots löscht. Eine abgeschnittene
//     Sicherung merkt man erst, wenn man sie braucht.
//
// Die Grenze ist eine Server-Einstellung, keine Eigenheit einer Abfrage: Sie trifft jede
// Tabelle, sobald sie wächst. Deshalb liegt das hier als Helfer und nicht als `.range()`
// an einer einzelnen Stelle. Faustregel: Ein Select OHNE `.eq()` auf eine Tabelle, die pro
// Spot oder pro Sprache wächst, gehört hier durch.
//
// KEIN `.limit()` benutzen, um das zu „lösen": Das setzt nur eine andere Obergrenze.

const PAGE = 1000;

/**
 * Ruft `query(from, to)` so oft auf, bis eine Seite kürzer als 1000 Zeilen zurückkommt,
 * und gibt alle Zeilen zusammen zurück. Der Aufrufer baut die Abfrage selbst, damit
 * Spalten, Filter und Sortierung unverändert seine Sache bleiben.
 *
 *   const rows = await selectAll((from, to) =>
 *     db.from("spot_translations").select("spot_id, lang, title").range(from, to),
 *   );
 *
 * Wirft, sobald eine Seite einen Fehler meldet: Ein halb gelesener Bestand ist derselbe
 * stille Datenverlust, den dieser Helfer verhindern soll.
 */
export async function selectAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const alle: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(`seitenweises Lesen ab Zeile ${from}: ${error.message}`);
    const seite = data ?? [];
    alle.push(...seite);
    if (seite.length < PAGE) return alle;
  }
}
