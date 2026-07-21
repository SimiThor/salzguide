import type { Metadata } from "next";

export const metadata: Metadata = {
  // Interne Render-Seiten gehören nie in einen Index.
  robots: { index: false, follow: false },
};

// Nacktes Root-Layout NUR für die Render-Seiten: kein App-Chrome, keine Navigation,
// keine Schriften/Provider. Nur eine randlose schwarze Vollbildfläche, damit im
// aufgenommenen Frame ausschließlich die Karte steht. Eigenes <html>/<body>, weil
// (render) eine eigene Wurzel neben [locale] ist (kein gemeinsames app/layout.tsx).
export default function RenderLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body
        style={{ margin: 0, padding: 0, background: "#000", overflow: "hidden" }}
      >
        {children}
      </body>
    </html>
  );
}
