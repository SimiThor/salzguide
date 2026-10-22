// Attrappe für `next/headers`, `next/server` und `next/cache` in Prüf-Skripten. headers/cookies werfen absichtlich:
// Geprüft wird nur, was ohne Request auskommt. Wer hier landet, misst gerade das Falsche.
const nope = (name) => () => {
  throw new Error(`${name}() gibt es im Prüf-Skript nicht (kein Request-Kontext).`);
};
export const headers = nope("headers");
export const cookies = nope("cookies");
export const draftMode = nope("draftMode");
export const after = (fn) => fn?.();
export const NextResponse = { json: nope("NextResponse.json") };

// `next/cache`: Prüf-Skripte haben keinen Next-Cache, jede Abfrage läuft frisch.
// unstable_cache reicht die Funktion unverändert durch, das Invalidieren tut nichts.
export const unstable_cache = (fn) => fn;
export const updateTag = () => {};
export const revalidateTag = () => {};
export const revalidatePath = () => {};
