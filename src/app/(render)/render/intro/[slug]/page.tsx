import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import IntroRenderMap, { type IntroMeta } from "@/components/render/IntroRenderMap";
import { haversineMeters } from "@/lib/geo";
import { factDurationFixed } from "@/lib/facts-i18n";

// Diese Seite hat nur einen Zweck: das Render-Skript (Playwright) lädt sie und nimmt
// die 3D-Kamerafahrt Frame für Frame auf. Kein Besucher-Feature. Deshalb per Secret
// geschützt und noindex (Layout). Im Dev-Server offen, damit man die Fahrt lokal ansehen
// kann.

function allowed(token: string | undefined): boolean {
  if (process.env.NODE_ENV !== "production") return true; // lokales Testen
  const secret = process.env.RENDER_SECRET;
  return !!secret && token === secret;
}

type IntroData = { route: [number, number][]; meta: IntroMeta };

function routeKm(route: [number, number][]): number {
  let m = 0;
  for (let i = 1; i < route.length; i++) m += haversineMeters(route[i - 1], route[i]);
  return m / 1000;
}

// Route + Endkarten-Daten (Name, Distanz, Höhenmeter, Dauer) direkt laden. Per Secret
// geschützt, daher auch für Pro-/Entwurf-Spots. Name = DE-Titel (sprachneutraler Eigenname).
async function loadIntro(slug: string): Promise<IntroData | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("spots")
    .select("route_geojson, duration, elevation_profile, spot_translations(title, lang)")
    .eq("slug", slug)
    .maybeSingle();

  const rg = data?.route_geojson as
    | { type?: string; coordinates?: [number, number][] }
    | null
    | undefined;
  const route =
    rg && rg.type === "LineString" && Array.isArray(rg.coordinates) && rg.coordinates.length >= 2
      ? rg.coordinates
      : null;
  if (!route) return null;

  const trs = (data?.spot_translations ?? []) as { title: string; lang: string }[];
  const name = trs.find((t) => t.lang === "de")?.title ?? trs[0]?.title ?? slug;
  const ep = data?.elevation_profile as
    | { ascent?: number; distanceKm?: number }
    | null
    | undefined;
  const distanceKm = ep?.distanceKm != null ? ep.distanceKm : routeKm(route);
  const ascentM = ep?.ascent != null ? ep.ascent : null;
  // Fester Wert statt Bereich ("1–2 Std" -> "2 Std"), damit die Video-Story dieselbe Dauer
  // zeigt wie die Foto-Story (storyStats nutzt ebenfalls factDurationFixed). Intro ist
  // DE-basiert (Name = DE-Titel), also auch die Dauer auf Deutsch.
  const duration = factDurationFixed((data?.duration as string | null) ?? null, "de");

  return { route, meta: { name, distanceKm, ascentM, duration } };
}

// Positive Zahl aus einem Query-Param lesen, sonst undefined (Default greift dann).
function num(v: string | undefined): number | undefined {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export default async function IntroRenderPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string; seconds?: string; fps?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  if (!allowed(sp.token)) notFound();

  const data = await loadIntro(slug);
  if (!data) {
    return (
      <main style={{ color: "#fff", font: "16px system-ui", padding: 24 }}>
        Kein Routen-Video für „{slug}“ (dieser Spot hat keine Wanderroute).
      </main>
    );
  }
  return (
    <IntroRenderMap
      route={data.route}
      meta={data.meta}
      seconds={num(sp.seconds)}
      fps={num(sp.fps)}
    />
  );
}
