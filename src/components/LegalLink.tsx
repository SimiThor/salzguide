"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { isAppEmbedRoute } from "@/lib/routes";

// Verweis innerhalb eines Rechtstexts. Auf der Website ein ganz normaler <Link>, in der
// App-Ansicht für die iOS-App (/app/..., lib/routes.ts) bleibt man in der App-Ansicht:
//   - ein anderer Rechtstext (/rechtliches/...) öffnet seine App-Fassung (/app/rechtliches/...),
//   - alles andere (Profil, /ki, ...) wäre die volle Website samt Navigation und Pro-Kauf,
//     also steht dort nur der Text, ohne Verweis.
// Das HTML für Website-Besucher ist dasselbe wie mit <Link> direkt.
export default function LegalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (!isAppEmbedRoute(pathname)) return <Link href={href}>{children}</Link>;
  if (href.startsWith("/rechtliches/")) return <Link href={`/app${href}`}>{children}</Link>;
  return <>{children}</>;
}

// Nur auf der Website zeigen, nie in der App-Ansicht (z. B. den Zurück-Knopf zur Karte).
export function SiteOnly({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return isAppEmbedRoute(pathname) ? null : <>{children}</>;
}
