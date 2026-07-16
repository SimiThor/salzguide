import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-bewusste Navigations-Helfer (für den späteren Sprach-Switcher, Auftrag F).
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
