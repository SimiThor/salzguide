// Strukturierte Daten (schema.org) als <script type="application/ld+json">.
//
// Server-Komponente ohne Logik: Die Objekte baut lib/jsonld.ts, hier wird nur
// serialisiert. Das replace() ist der übliche Injection-Riegel: "<" darf in einem
// Inline-Skript nie roh stehen, sonst könnte ein Text wie "</script>" aus der DB das
// Skript beenden und eigenes HTML einschleusen. < bedeutet dasselbe Zeichen,
// beendet aber nichts. Ein schlichtes Skript-Tag bleibt auch mit der (Report-Only-)CSP
// aus next.config.ts verträglich.
export default function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
