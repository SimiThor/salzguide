import type { Metadata } from "next";
import AgbPage from "@/app/[locale]/rechtliches/agb/page";
import { legalMetadata } from "@/lib/legal";

// App-Fassung (iOS-App, lib/routes.ts): derselbe Text wie /rechtliches/agb, AppChrome lässt
// hier alles drumherum weg, LegalLink hält Verweise in der App-Ansicht. Canonical zeigt auf
// die normale Seite.
export const metadata: Metadata = legalMetadata("agb", "Allgemeine Geschäftsbedingungen");

export default AgbPage;
