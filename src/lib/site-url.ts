// Unter welcher Adresse diese App öffentlich erreichbar ist. EINE Stelle für alle.
//
// "server-only", weil die Antwort auf Vercel aus VERCEL_PROJECT_PRODUCTION_URL kommt und
// die es im Browser nicht gibt (kein NEXT_PUBLIC_-Präfix). Im Client wäre sie still
// undefined und die Funktion fiele auf localhost zurück — also genau der Fehler, den diese
// Datei verhindern soll. Ein Import aus einer Client-Komponente bricht damit den Build,
// statt eine falsche URL auszuliefern.
import "server-only";

// WARUM ES DIESE DATEI GIBT
//
// Am 17.07.2026 stand NEXT_PUBLIC_SITE_URL in den Vercel-Einstellungen auf
// http://localhost:3000. Die Folgen, alle gleichzeitig und alle unbemerkt:
//
//   - Der Magic-Link im Login zeigte auf localhost. Niemand konnte sich auf der echten
//     Seite anmelden. Supabase ersetzt so etwas normalerweise durch seine Site URL, aber
//     localhost stand auf der Redirect-Allowlist (für die lokale Entwicklung) und wurde
//     deshalb brav übernommen.
//   - robots.txt sagte `Host: http://localhost:3000` und verwies die Sitemap dorthin.
//   - sitemap.xml listete jede Seite als http://localhost:3000/...
//   - Jede Seite sagte Google per canonical, ihr Original stehe auf localhost.
//
// Kein Fehler, kein Alarm, kein roter Build. Eine Website, in die niemand hineinkam und
// die sich Google nicht zu erkennen gab, und der einzige Hinweis war ein Nutzer, dem ein
// Anmeldelink komisch vorkam.
//
// Gelesen wurde die Variable vorher an sechs Stellen, jede mit ihrem eigenen Notnagel:
// viermal "https://salzguide.com" (die alte WordPress-Seite, nicht diese App), einmal der
// Origin-Header, einmal localhost. Sechs Leser sind sechs Gelegenheiten, es anders zu
// machen — und einer, der es falsch macht, reicht.

/** Adressen, unter denen uns von aussen niemand erreicht. */
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

function isLocal(url: string): boolean {
  try {
    return LOCAL_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    // Unparsbar ist genauso unbrauchbar wie localhost: lieber Vercels eigene Domain.
    return true;
  }
}

/**
 * Die öffentliche Basis-URL der App, ohne Schrägstrich am Ende.
 *
 * Reihenfolge:
 *   1. NEXT_PUBLIC_SITE_URL — aber auf Vercel nur, wenn sie nicht auf localhost zeigt.
 *   2. VERCEL_PROJECT_PRODUCTION_URL — Vercels eigene Antwort auf die Frage.
 *   3. localhost — für die Entwicklung.
 *
 * Stufe 2 ist der Riegel UND der Grund, warum hier keine Adresse im Code steht: Vercel
 * setzt die Variable selbst, ohne dass jemand etwas einträgt, und sie zeigt immer auf die
 * kürzeste Produktions-Domain. Heute ist das salzguide.vercel.app; sobald salzguide.com
 * von WordPress auf Vercel umzieht und dort als Produktions-Domain hängt, ist es
 * salzguide.com. Niemand muss dafür Code anfassen.
 */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercelProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL;

  if (vercelProduction && (!configured || isLocal(configured))) {
    if (configured) {
      // Laut, aber nicht tödlich: Die Seite läuft mit der richtigen Adresse weiter, und
      // im Log steht, was zu korrigieren ist. Ein harter Abbruch nähme hier eine
      // funktionierende Website vom Netz, um auf einen Tippfehler hinzuweisen.
      console.error(
        `siteUrl: NEXT_PUBLIC_SITE_URL ist "${configured}" und damit auf Vercel unbrauchbar. ` +
          `Nutze https://${vercelProduction}. Bitte die Variable in den Vercel-Projekteinstellungen korrigieren.`,
      );
    }
    return `https://${vercelProduction}`;
  }

  return (configured || "http://localhost:3000").replace(/\/+$/, "");
}
