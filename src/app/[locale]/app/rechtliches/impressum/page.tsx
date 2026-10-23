import type { Metadata } from "next";
import ImpressumPage from "@/app/[locale]/rechtliches/impressum/page";
import { legalMetadata } from "@/lib/legal";

// App-Fassung (iOS-App, lib/routes.ts): derselbe Text wie /rechtliches/impressum, AppChrome
// lässt hier alles drumherum weg. Canonical zeigt auf die normale Seite.
export const metadata: Metadata = legalMetadata("impressum", "Impressum");

export default ImpressumPage;
