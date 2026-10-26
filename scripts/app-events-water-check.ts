// Prüft GET /events, GET /events/saved, PUT/DELETE /events/{id}/saved und GET /water der App-API.
// Aufruf: npm run app-events-water:check -- --base=http://localhost:3005
//
// Braucht einen LAUFENDEN Server und das ECHTE Supabase (Wegwerf-Konto, wie app-api:check;
// es wird IMMER wieder gelöscht). --base ist Pflicht: Auf Port 3000 kann der Produktions-Server laufen.
// Geprüft wird: Form und Cache-Header, Fehlercodes, Zeitraum-Filter, Gast bekommt 401 beim Merken,
// Merken ist idempotent (genau eine Zeile), RLS-Gegenprobe mit zweitem Konto, und die Seen-Spots
// sind für Gäste maskiert (nur locked-N, kein Titel, kein Foto), für Pro offen.
import {
  createTempUser,
  deleteTempUser,
  serviceClient,
  setProfile,
  type TempUser,
} from "./lib/temp-user.ts";

let ok = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    ok++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FEHLT ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

const baseArg = process.argv.find((a) => a.startsWith("--base="))?.slice(7);
if (!baseArg) {
  console.error("--base fehlt. Beispiel: npm run app-events-water:check -- --base=http://localhost:3005");
  process.exit(2);
}
const API = `${baseArg.replace(/\/+$/, "")}/api/app/v1`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
async function call(
  method: string,
  path: string,
  token: string | null,
): Promise<{ status: number; headers: Headers; json: Loose }> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${API}${path}`, { method, headers, signal: AbortSignal.timeout(90_000) });
  const text = await r.text();
  let json: Loose = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* kein JSON */
  }
  return { status: r.status, headers: r.headers, json };
}

const users: TempUser[] = [];
async function cleanup(): Promise<void> {
  for (const u of users.splice(0)) {
    const gone = await deleteTempUser(u.id).catch(() => false);
    console.log(`  ..    Wegwerf-Konto gelöscht: ${gone ? "ja" : "NEIN, bitte prüfen"}`);
  }
}

async function main(): Promise<void> {
  console.log("Events");
  const ev = await call("GET", "/events?lang=de", null);
  check("GET /events: 200, private max-age=300", ev.status === 200 && /max-age=300/.test(ev.headers.get("cache-control") ?? ""));
  check(
    "Form { lang, todayKey, maxDay, events[] }",
    ev.json?.lang === "de" &&
      /^\d{4}-\d{2}-\d{2}$/.test(ev.json?.todayKey) &&
      /^\d{4}-\d{2}-\d{2}$/.test(ev.json?.maxDay) &&
      Array.isArray(ev.json?.events),
  );
  const events: Loose[] = ev.json?.events ?? [];
  const first = events[0];
  check("Event hat die Web-Felder", !first || ["id", "title", "startsAt", "allDay", "category", "isHighlight", "isFree"].every((k) => k in first));
  check("Sortiert nach Beginn", events.every((e, i) => i === 0 || events[i - 1].startsAt <= e.startsAt));
  check("GET /events?lang=xx -> 400", (await call("GET", "/events?lang=xx", null)).status === 400);
  check("from ohne to -> 400", (await call("GET", "/events?from=2026-01-01", null)).status === 400);
  check("Müll-Datum -> 400", (await call("GET", "/events?from=x&to=y", null)).status === 400);
  check("Unmögliches Datum -> 400", (await call("GET", "/events?from=2026-02-30&to=2026-03-01", null)).status === 400);
  check("from nach to -> 400", (await call("GET", "/events?from=2026-03-02&to=2026-03-01", null)).status === 400);
  const today = ev.json?.todayKey as string;
  const range = await call("GET", `/events?from=${today}&to=${today}`, null);
  check("Zeitraum: Teilmenge, maxDay bleibt", range.status === 200 && range.json.events.length <= events.length && range.json.maxDay === ev.json.maxDay);
  check("Kaputter Token -> 401", (await call("GET", "/events", "kaputt")).status === 401);

  console.log("\nWasser");
  const wg = await call("GET", "/water?lang=de", null);
  check("GET /water: 200, private", wg.status === 200 && /private/.test(wg.headers.get("cache-control") ?? ""));
  check("Form { lang, tier: public, lakes[] }", wg.json?.tier === "public" && Array.isArray(wg.json?.lakes));
  const lakes: Loose[] = wg.json?.lakes ?? [];
  check(
    "Seen: Temperatur plausibel (0 bis 35), Quelle bekannt",
    lakes.every((l) => l.tempC >= 0 && l.tempC <= 35 && (l.source === "salzburg" || l.source === "ages")),
  );
  const guestSpots: Loose[] = lakes.flatMap((l) => l.spots);
  const lockedGuest = guestSpots.filter((s) => s.locked);
  check(
    "Gast: gesperrte Spots nur als locked-N, ohne Foto und Kurztext",
    lockedGuest.every((s) => /^locked-\d+$/.test(s.slug) && s.image === null && s.shortDesc === null && s.emoji === null),
  );
  check("Gast: freie Spots haben echte Slugs", guestSpots.filter((s) => !s.locked).every((s) => !s.slug.startsWith("locked-")));

  console.log("\nMerken (Konto)");
  const a = await createTempUser();
  users.push(a);
  const b = await createTempUser();
  users.push(b);
  const ta = a.session.access_token;
  const tb = b.session.access_token;
  const eventId: string | undefined = first?.id;
  const svc = serviceClient();
  const rows = async (uid: string) =>
    (await svc.from("saved_events").select("id", { count: "exact", head: true }).eq("user_id", uid)).count ?? -1;

  check("GET /events/saved ohne Konto -> 401", (await call("GET", "/events/saved", null)).status === 401);
  check("PUT ohne Konto -> 401", (await call("PUT", `/events/${eventId ?? "x"}/saved`, null)).status === 401);
  check("Anfangs leer", (await call("GET", "/events/saved", ta)).json?.ids?.length === 0);
  check("Kein UUID -> 404", (await call("PUT", "/events/nope/saved", ta)).status === 404);
  check("Unbekannte UUID -> 404", (await call("PUT", "/events/00000000-0000-4000-8000-000000000000/saved", ta)).status === 404);
  if (eventId) {
    const p1 = await call("PUT", `/events/${eventId}/saved`, ta);
    const p2 = await call("PUT", `/events/${eventId}/saved`, ta);
    check("PUT zweimal: beide { saved: true }", p1.status === 200 && p2.status === 200 && p1.json?.saved === true && p2.json?.saved === true);
    check("Genau EINE Zeile in saved_events", (await rows(a.id)) === 1);
    const g = await call("GET", "/events/saved", ta);
    check("GET /events/saved: no-store, Event enthalten", /no-store/.test(g.headers.get("cache-control") ?? "") && g.json?.ids?.includes(eventId) && g.json?.events?.[0]?.id === eventId);
    check("Zweites Konto sieht nichts (RLS)", (await call("GET", "/events/saved", tb)).json?.ids?.length === 0);
    const del0 = await call("DELETE", `/events/${eventId}/saved`, tb);
    check("Zweites Konto kann fremden Eintrag nicht löschen", del0.status === 200 && (await rows(a.id)) === 1);
    const d1 = await call("DELETE", `/events/${eventId}/saved`, ta);
    const d2 = await call("DELETE", `/events/${eventId}/saved`, ta);
    check("DELETE zweimal: beide { saved: false }, Zeile weg", d1.json?.saved === false && d2.json?.saved === false && (await rows(a.id)) === 0);
  } else {
    console.log("  ..    keine kommenden Events, Merken nicht geprüft");
  }

  console.log("\nWasser als Pro");
  await setProfile(a.id, { is_pro: true });
  const wp = await call("GET", "/water?lang=de", ta);
  check("Pro: tier pro, gleiche Seen", wp.json?.tier === "pro" && wp.json.lakes.length === lakes.length);
  const proSpots: Loose[] = (wp.json?.lakes ?? []).flatMap((l: Loose) => l.spots);
  check("Pro: keine gesperrten Spots", proSpots.every((s) => !s.locked && !s.slug.startsWith("locked-")));
  check("Pro und Gast sehen gleich viele Spots", proSpots.length === guestSpots.length);
}

process.on("SIGINT", () => void cleanup().finally(() => process.exit(130)));
main()
  .catch((e) => {
    failed++;
    console.log(`  FEHLT Abbruch: ${e instanceof Error ? e.message : String(e)}`);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n${ok} ok, ${failed} fehlgeschlagen`);
    process.exit(failed ? 1 : 0);
  });
