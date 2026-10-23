import type { Metadata } from "next";
import WiderrufPage from "@/app/[locale]/rechtliches/widerruf/page";
import { legalMetadata } from "@/lib/legal";

// App-Fassung (iOS-App, lib/routes.ts): derselbe Text samt Online-Widerruf wie
// /rechtliches/widerruf, AppChrome lässt hier alles drumherum weg, LegalLink hält Verweise in
// der App-Ansicht. Canonical zeigt auf die normale Seite.
export const metadata: Metadata = legalMetadata("widerruf", "Widerrufsbelehrung");

export default WiderrufPage;
