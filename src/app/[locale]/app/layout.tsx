import type { Metadata } from "next";

// App-Ansicht für die iOS-App (lib/routes.ts, isAppEmbedRoute): dieselben Seiten wie auf der
// Website, nur ohne alles drumherum (AppChrome). Nie in Suchmaschinen und kein Folgen der
// Verweise: Das Original steht unter seiner normalen Adresse, und jede Seite hier zeigt per
// Canonical dorthin (legalMetadata in lib/legal.ts).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AppEmbedLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
