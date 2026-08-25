// Welche Audiodatei ein Stopp bekommen darf. EINE Funktion, damit die Entscheidung nicht in
// einer Abfrage-Schleife versteckt liegt und pruefbar bleibt (npm run pro:check).
//
// Die Regel in einem Satz: Ein gesperrter Stopp bekommt NUR die Kostprobe, nie die
// Volldatei. Und ein offener bekommt die Volldatei, nie die Kostprobe: An einem offenen
// Stopp waere sie sinnlos und stellte die Oberflaeche vor die Wahl zwischen zwei
// Play-Knoepfen.
//
// WARUM DIE KOSTPROBE EINE EIGENE DATEI IST: Wer die Volldatei ausliefert und nach zwanzig
// Sekunden stoppt, hat kein Gate gebaut, sondern eine Bitte. Ein Blick in die Netzwerkspur,
// und die ganze Geschichte liegt da. Deshalb entscheidet sich hier ein PFAD, kein Zeitpunkt.
export type StopAudioAccess = {
  /** Pfad im privaten tour-audio-Bucket, der fuer diesen Stopp signiert werden darf. */
  signPath: string | null;
  /** Ist der signierte Pfad die Kostprobe? Dann laeuft in der Oberflaeche kein volles Audio. */
  isTeaser: boolean;
};

export function stopAudioAccess(input: {
  locked: boolean;
  audioUrl: string | null;
  teaserUrl: string | null;
}): StopAudioAccess {
  if (input.locked) {
    return { signPath: input.teaserUrl ?? null, isTeaser: Boolean(input.teaserUrl) };
  }
  return { signPath: input.audioUrl ?? null, isTeaser: false };
}
