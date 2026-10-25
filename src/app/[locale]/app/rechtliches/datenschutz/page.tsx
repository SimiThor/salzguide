import type { Metadata } from "next";
import DatenschutzPage from "@/app/[locale]/rechtliches/datenschutz/page";
import { legalMetadata } from "@/lib/legal";

// App-Fassung (iOS-App, lib/routes.ts): derselbe Text wie /rechtliches/datenschutz,
// AppChrome lässt hier alles drumherum weg, LegalLink hält Verweise in der App-Ansicht.
// Canonical zeigt auf die normale Seite.
export const metadata: Metadata = legalMetadata("datenschutz", "Datenschutzerklärung");

export default DatenschutzPage;
