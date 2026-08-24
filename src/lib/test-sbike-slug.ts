// ═══ TESTHAKEN – NICHT DAUERHAFT (siehe lib/test-sbike-tour.ts) ═══
// Nur der Slug, ohne jeden Server-Import: Diese eine Konstante muss sowohl aus
// Server-Seiten (touren/[slug]/page.tsx) als auch aus einer CLIENT-Komponente
// (LegalFooter.tsx, der Footer-Link) importierbar sein. test-sbike-tour.ts selbst
// importiert getTourDetail (Supabase, server-only) und darf deshalb NICHT von einer
// "use client"-Datei importiert werden – deshalb dieser eigene, leere Baustein.
export const TEST_SBIKE_SLUG = "test-sbike-parsch";
