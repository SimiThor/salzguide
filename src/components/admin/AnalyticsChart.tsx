import type { TimePoint } from "@/lib/analytics-queries";
import type { Bucket } from "@/lib/vienna-day";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  DER ZEITVERLAUF, MIT ZAHLEN
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Vorher war das eine Reihe roter Balken ohne eine einzige Ziffer. Man konnte sehen, dass
// Montag mehr war als Dienstag, aber nicht, ob „mehr" acht Aufrufe sind oder achthundert —
// und ohne Grössenordnung ist ein Ausschlag keine Information, sondern eine Form. Ein
// Balkenbild, das nur zeigt, welcher Balken höher ist, ist ein Ranking mit Extraschritten.
//
// Was diese Fassung anders macht:
//
//   1. EINE ACHSE MIT WERTEN (0 / Mitte / Höchstwert). Damit hat jeder Balken eine
//      Grössenordnung, ohne dass an ihm etwas stehen muss.
//   2. DIE DREI ZAHLEN, DIE MAN AUS EINER KURVE ABLIEST, stehen darüber: Summe, Schnitt je
//      Balken und der Höchstwert MIT seinem Datum. Nach dem Spitzentag sucht man sonst mit
//      dem Finger am Bildschirm.
//   3. BESUCHER ALS ZWEITE REIHE, IN den Balken gelegt statt daneben. Der Abstand zwischen
//      beiden IST die Aussage („wie viele Seiten sieht einer, der kommt"), und nebeneinander
//      muss man ihn schätzen.
//   4. BESCHRIFTETE ZEITACHSE statt nur Anfang und Ende.
//
// ── WARUM HTML UND NICHT SVG ──────────────────────────────────────────────────────────
//
// Die erste Fassung war ein SVG mit viewBox. Das sah am Desktop gut aus und war am Handy
// unbrauchbar: Eine viewBox skaliert ALLES mit, auch die Schrift. Nachgemessen im iPhone-
// Viewport war die Achsenbeschriftung 6 Pixel hoch — vorhanden, lesbar nicht. Und genau am
// Handy schaut man auf so ein Dashboard.
//
// Balken sind Rechtecke, und Rechtecke kann CSS. So bleibt die Schrift echte Schrift in
// echten Pixeln, die Balken skalieren über Prozentwerte, und die Beschriftung der Zeitachse
// sitzt über dieselbe flex-1-Aufteilung exakt unter ihrem Balken. Kein Bibliothek, keine
// „use client"-Grenze auf einer sonst reinen Server-Seite, kein zweites Farbsystem.

const BUCKET_NOUN: Record<Bucket, { one: string; per: string }> = {
  day: { one: "Tag", per: "je Tag" },
  week: { one: "Woche", per: "je Woche" },
  month: { one: "Monat", per: "je Monat" },
};

const de = (n: number) => n.toLocaleString("de-AT");

/** „12.03." bzw. „März 26" — kurz genug für eine Achse, eindeutig genug zum Wiederfinden. */
function labelOf(bucket: string, kind: Bucket): string {
  const d = new Date(`${bucket}T12:00:00.000Z`);
  if (kind === "month") {
    return new Intl.DateTimeFormat("de-AT", { month: "short", year: "2-digit", timeZone: "UTC" }).format(d);
  }
  return new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(d);
}

/**
 * Eine runde Zahl ÜBER dem Höchstwert als Achsen-Ende.
 *
 * Ohne das endet die Achse bei „1.237", der oberste Balken klebt an der Decke und die
 * Beschriftung ist eine Zahl, die niemand im Kopf behält. Mit 1.500 hat die Spitze Luft.
 */
function niceMax(max: number): number {
  if (max <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / (pow / 2)) * (pow / 2);
}

export default function AnalyticsChart({
  points,
  bucket,
}: {
  points: TimePoint[];
  bucket: Bucket;
}) {
  const noun = BUCKET_NOUN[bucket];
  const total = points.reduce((s, p) => s + p.pageviews, 0);
  const visitorTotal = points.reduce((s, p) => s + p.visitors, 0);
  const avg = points.length ? Math.round(total / points.length) : 0;
  const peak = points.reduce<TimePoint | null>(
    (best, p) => (!best || p.pageviews > best.pageviews ? p : best),
    null,
  );
  const axisMax = niceMax(Math.max(1, ...points.map((p) => p.pageviews)));
  // Beschriftung ausdünnen, bis sie lesbar bleibt. Am Handy ist weniger Platz, also weniger
  // Marken — die Zahl steckt in der Klasse, nicht in einer JS-Breitenmessung (die erst nach
  // dem ersten Bild da wäre und dann umspringt).
  const every = Math.max(1, Math.ceil(points.length / 6));

  const stats: [string, string, string?][] = [
    ["Summe", de(total)],
    [`Ø ${noun.per}`, de(avg)],
    ...(peak && peak.pageviews > 0
      ? ([["Spitze", de(peak.pageviews), `am ${labelOf(peak.bucket, bucket)}`]] as [string, string, string][])
      : []),
    ["Besucher-Tage", de(visitorTotal)],
  ];

  return (
    <div className="rounded-[16px] bg-white p-4 shadow-sm ring-1 ring-black/[0.04]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-semibold text-ink">Seitenaufrufe im Zeitverlauf</h2>
        <p className="text-[11px] text-muted">
          {noun.per} · der letzte {noun.one} läuft noch
        </p>
      </div>

      {/* Die Zahlen, die man aus der Kurve ohnehin ablesen will. */}
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        {stats.map(([label, value, note]) => (
          <div key={label}>
            <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
            <dd className="text-[17px] font-bold leading-tight text-ink">
              {value}
              {note && <span className="ml-1 text-[12px] font-medium text-muted">{note}</span>}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex gap-2">
        {/* Achsenzahlen: echte Schrift in echten Pixeln, nicht in eine viewBox gesperrt. */}
        <div className="relative h-36 w-9 shrink-0">
          {[1, 0.5, 0].map((f) => (
            <span
              key={f}
              className="absolute right-0 -translate-y-1/2 text-[11px] tabular-nums text-muted"
              style={{ top: `${(1 - f) * 100}%` }}
            >
              {de(Math.round(axisMax * f))}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative h-36">
            {/* Hilfslinien */}
            {[1, 0.5, 0].map((f) => (
              <div
                key={f}
                className={`absolute inset-x-0 border-t ${f === 0 ? "border-black/20" : "border-black/[0.07]"}`}
                style={{ top: `${(1 - f) * 100}%` }}
              />
            ))}
            <div className="absolute inset-0 flex items-end gap-[2px]">
              {points.map((p) => {
                const isPeak = peak?.bucket === p.bucket && p.pageviews > 0;
                // Anteil der Besucher AM Balken (nicht an der Achse): Der innere Block sitzt
                // unten im äusseren, der Rest darüber sind weitere Aufrufe derselben Leute.
                const inner = p.pageviews ? (p.visitors / p.pageviews) * 100 : 0;
                return (
                  <div
                    key={p.bucket}
                    className="relative flex-1"
                    style={{ height: `${(p.pageviews / axisMax) * 100}%` }}
                    title={`${labelOf(p.bucket, bucket)}: ${de(p.pageviews)} Aufrufe · ${de(p.visitors)} Besucher`}
                  >
                    {p.pageviews > 0 ? (
                      <div className={`h-full w-full rounded-t-[2px] ${isPeak ? "bg-accent/55" : "bg-accent/35"}`}>
                        <div
                          className="absolute inset-x-0 bottom-0 rounded-t-[2px] bg-accent"
                          style={{ height: `${inner}%` }}
                        />
                      </div>
                    ) : (
                      // Ein Balken ohne Ereignisse ist kein fehlender Balken. Ein Häärchen
                      // auf der Grundlinie zeigt: gemessen, und es war nichts.
                      <div className="absolute inset-x-0 bottom-0 h-px bg-black/15" />
                    )}
                    {points.length <= 14 && p.pageviews > 0 && (
                      <span className="absolute inset-x-0 -top-4 text-center text-[10px] font-semibold tabular-nums text-ink">
                        {de(p.pageviews)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Zeitachse: dieselbe flex-1-Aufteilung wie die Balken -> jede Marke sitzt exakt
              unter ihrem Balken, ohne dass irgendwo eine Breite gerechnet wird. */}
          <div className="mt-1.5 flex gap-[2px]">
            {points.map((p, i) => (
              <span
                key={p.bucket}
                className="min-w-0 flex-1 text-center text-[10px] tabular-nums text-muted"
              >
                {i % every === 0 ? labelOf(p.bucket, bucket) : " "}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-accent" /> Besucher
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-accent/35" /> weitere Aufrufe derselben Besucher
        </span>
        {/* Warum „Besucher-Tage": Der Besucher-Hash wechselt jede Nacht, das ist der Grund,
            warum diese Messung ohne Cookie auskommt. Über einen Wochen- oder Monatsbalken
            zählt „eindeutig" deshalb jeden Tag neu mit. */}
        <span>eindeutig je Tag, nicht über den ganzen Zeitraum</span>
      </div>
    </div>
  );
}
