"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { useAi } from "@/components/ai/AiProvider";

// iOS-Glass-Tab-Bar (docs/18). Exakt die Phosphor-SVGs der aktuellen SalzGuide-Seite.
// Active-State aus dem Router. "KI" ist eine Aktion (öffnet später ein Sheet), nie aktiv.
function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="h-[26px] w-[26px]"
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const ICONS: Record<string, ReactNode> = {
  explore: (
    <NavIcon>
      <path d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z" />
    </NavIcon>
  ),
  ai: (
    <NavIcon>
      <path d="M197.58,129.06,146,110l-19-51.62a15.92,15.92,0,0,0-29.88,0L78,110l-51.62,19a15.92,15.92,0,0,0,0,29.88L78,178l19,51.62a15.92,15.92,0,0,0,29.88,0L146,178l51.62-19a15.92,15.92,0,0,0,0-29.88ZM137,164.22a8,8,0,0,0-4.74,4.74L112,223.85,91.78,169A8,8,0,0,0,87,164.22L32.15,144,87,123.78A8,8,0,0,0,91.78,119L112,64.15,132.22,119a8,8,0,0,0,4.74,4.74L191.85,144ZM144,40a8,8,0,0,1,8-8h16V16a8,8,0,0,1,16,0V32h16a8,8,0,0,1,0,16H184V64a8,8,0,0,1-16,0V48H152A8,8,0,0,1,144,40ZM248,88a8,8,0,0,1-8,8h-8v8a8,8,0,0,1-16,0V96h-8a8,8,0,0,1,0-16h8V72a8,8,0,0,1,16,0v8h8A8,8,0,0,1,248,88Z" />
    </NavIcon>
  ),
  saved: (
    <NavIcon>
      <path d="M184,32H72A16,16,0,0,0,56,48V224a8,8,0,0,0,12.24,6.78L128,193.43l59.77,37.35A8,8,0,0,0,200,224V48A16,16,0,0,0,184,32Zm0,177.57-51.77-32.35a8,8,0,0,0-8.48,0L72,209.57V48H184Z" />
    </NavIcon>
  ),
  profile: (
    <NavIcon>
      <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24ZM74.08,197.5a64,64,0,0,1,107.84,0,87.83,87.83,0,0,1-107.84,0ZM96,120a32,32,0,1,1,32,32A32,32,0,0,1,96,120Zm97.76,66.41a79.66,79.66,0,0,0-36.06-28.75,48,48,0,1,0-59.4,0,79.66,79.66,0,0,0-36.06,28.75,88,88,0,1,1,131.52,0Z" />
    </NavIcon>
  ),
};

export default function BottomNav() {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const ai = useAi();

  const tabs: {
    key: keyof typeof ICONS;
    href?: "/" | "/gespeichert" | "/profil";
    action?: boolean;
  }[] = [
    { key: "explore", href: "/" },
    { key: "ai", action: true },
    { key: "saved", href: "/gespeichert" },
    { key: "profile", href: "/profil" },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-black/5 bg-cream/80 pb-safe backdrop-blur-xl md:hidden">
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-2 py-2">
        {tabs.map((tab) => {
          const active = !tab.action && tab.href === pathname;
          const cls = `flex w-full flex-col items-center gap-1 px-3 py-1 transition-colors ${
            active ? "text-accent" : "text-muted"
          }`;
          const inner = (
            <>
              {ICONS[tab.key]}
              <span className="text-[11px] font-medium">{t(tab.key)}</span>
            </>
          );

          return (
            <li key={tab.key} className="flex-1">
              {tab.action ? (
                <button
                  type="button"
                  onClick={ai.open}
                  className={cls}
                  aria-label={t(tab.key)}
                >
                  {inner}
                </button>
              ) : (
                <Link
                  href={tab.href!}
                  className={cls}
                  aria-current={active ? "page" : undefined}
                >
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
