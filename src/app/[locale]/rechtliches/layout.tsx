import type { Metadata } from "next";

// Rechtstexte bewusst NICHT in Suchmaschinen: an EINER Stelle für den ganzen /rechtliches-
// Zweig gesetzt (alle Unterseiten erben das robots-Flag über die Next-Metadata-Vererbung).
// -> wartungsarm: neue Rechts-Seite = automatisch noindex, ohne pro Seite etwas zu setzen.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function RechtlichesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
