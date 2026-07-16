"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import LanguageSwitcher from "./LanguageSwitcher";
import { useAi } from "./ai/AiProvider";

// Desktop-Top-Header (>= md): Logo + Navigation + Sprache. Ersetzt die Bottom-Nav.
export default function DesktopHeader() {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const ai = useAi();

  const items: {
    key: string;
    href?: "/" | "/events" | "/touren" | "/gespeichert" | "/profil";
    action?: boolean;
  }[] = [
    { key: "explore", href: "/" },
    { key: "tours", href: "/touren" },
    { key: "events", href: "/events" },
    { key: "ai", action: true },
    { key: "saved", href: "/gespeichert" },
    { key: "profile", href: "/profil" },
  ];

  return (
    <header className="fixed inset-x-0 top-0 z-50 hidden h-14 items-center justify-between border-b border-black/5 bg-cream/80 px-6 backdrop-blur-xl md:flex">
      <Link href="/" className="text-xl font-bold text-accent">
        SalzGuide
      </Link>

      <nav className="flex items-center gap-1">
        {items.map((item) => {
          if (item.action) {
            return (
              <button
                key={item.key}
                type="button"
                onClick={ai.open}
                className="rounded-full px-4 py-1.5 text-sm font-medium text-muted transition-colors hover:text-ink"
              >
                {t(item.key)}
              </button>
            );
          }
          const active = item.href === pathname;
          return (
            <Link
              key={item.key}
              href={item.href!}
              aria-current={active ? "page" : undefined}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                active ? "text-accent" : "text-muted hover:text-ink"
              }`}
            >
              {t(item.key)}
            </Link>
          );
        })}
        <span className="ml-2">
          <LanguageSwitcher />
        </span>
      </nav>
    </header>
  );
}
