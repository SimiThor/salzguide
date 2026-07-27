// Attrappe für `next/headers` und `next/server` in Prüf-Skripten. Wirft absichtlich:
// Geprüft wird nur, was ohne Request auskommt. Wer hier landet, misst gerade das Falsche.
const nope = (name) => () => {
  throw new Error(`${name}() gibt es im Prüf-Skript nicht (kein Request-Kontext).`);
};
export const headers = nope("headers");
export const cookies = nope("cookies");
export const draftMode = nope("draftMode");
export const after = (fn) => fn?.();
export const NextResponse = { json: nope("NextResponse.json") };
