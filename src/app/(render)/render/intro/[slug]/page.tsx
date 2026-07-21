import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import IntroRenderMap from "@/components/render/IntroRenderMap";

// Diese Seite hat nur einen Zweck: das Render-Skript (Playwright) lädt sie und nimmt
// die 3D-Kamerafahrt Frame für Frame auf. Kein Besucher-Feature. Deshalb per Secret
// geschützt und noindex (Layout). Im Dev-Server offen, damit man die Fahrt lokal ansehen
// kann.

function allowed(token: string | undefined): boolean {
  if (process.env.NODE_ENV !== "production") return true; // lokales Testen
  const secret = process.env.RENDER_SECRET;
  return !!secret && token === secret;
}

// Route direkt laden. Da die Seite per Secret geschützt ist, liefern wir sie auch für
// Pro-/Entwurf-Spots (der Renderer erzeugt Intros vor der Veröffentlichung).
async function loadRoute(slug: string): Promise<[number, number][] | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("spots")
    .select("route_geojson")
    .eq("slug", slug)
    .maybeSingle();
  const rg = data?.route_geojson as
    | { type?: string; coordinates?: [number, number][] }
    | null
    | undefined;
  return rg &&
    rg.type === "LineString" &&
    Array.isArray(rg.coordinates) &&
    rg.coordinates.length >= 2
    ? rg.coordinates
    : null;
}

export default async function IntroRenderPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { slug } = await params;
  const { token } = await searchParams;
  if (!allowed(token)) notFound();

  const route = await loadRoute(slug);
  if (!route) {
    return (
      <main style={{ color: "#fff", font: "16px system-ui", padding: 24 }}>
        Kein Routen-Video für „{slug}“ (dieser Spot hat keine Wanderroute).
      </main>
    );
  }
  return <IntroRenderMap route={route} />;
}
