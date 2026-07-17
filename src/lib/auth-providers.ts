import "server-only";
import { cache } from "react";

// Welche Anmeldearten in Supabase WIRKLICH eingeschaltet sind.
//
// WARUM DIE APP DAS FRAGEN MUSS:
// Ist ein Anbieter im Supabase-Dashboard aus, meldet signInWithOAuth trotzdem KEINEN
// Fehler. Die App bekommt brav eine URL und leitet dorthin weiter — und erst Supabase
// antwortet dann mit nacktem JSON:
//
//   {"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}
//
// Am 17.07.2026 war genau das der Zustand: „Weiter mit Google" stand als ERSTE Aktion im
// Login, führte auf diese Seite, und der Captcha-Notausgang schickte die Leute
// ausdrücklich dorthin („Nutze bitte den Google-Login oben"). Zwei Sackgassen
// hintereinander, und keine davon war im Code als Fehler sichtbar.
//
// Ein Knopf, der auf eine Fehlerseite führt, ist schlimmer als kein Knopf: Er verspricht
// den bequemen Weg und bestraft den, der ihn nimmt.
//
// SELBSTHEILEND, und das ist der Punkt: Wird Google im Dashboard eingeschaltet, erscheint
// der Knopf von selbst. Niemand muss Code anfassen, niemand muss daran denken. Und wird er
// abgeschaltet, verschwindet er wieder, statt still kaputtzugehen.

/** Supabase veröffentlicht seine aktiven Anbieter hier. Anon-Key genügt, kein Geheimnis. */
const SETTINGS_PATH = "/auth/v1/settings";
// Fünf Minuten: Ein Anbieter wird einmal im Jahr umgelegt, aber wenn es passiert, will
// niemand einen Deploy brauchen, damit der Knopf erscheint.
const TTL_SECONDS = 300;
const TIMEOUT_MS = 5000;

type Settings = { external?: Record<string, boolean> };

/**
 * Die eingeschalteten Anbieter ("google", "email", …).
 *
 * Leer bei jedem Problem. Das ist die sichere Richtung: Lieber einen Knopf zu wenig als
 * einen, der auf JSON endet. Der E-Mail-Login hängt nicht daran und bleibt immer da.
 *
 * `cache` = einmal pro Request, egal wie viele Formulare fragen. `revalidate` = einmal
 * alle fünf Minuten über alle Requests.
 */
export const enabledAuthProviders = cache(async (): Promise<ReadonlySet<string>> => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return new Set();

  try {
    const res = await fetch(`${url}${SETTINGS_PATH}`, {
      headers: { apikey: key },
      next: { revalidate: TTL_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("enabledAuthProviders: settings failed", res.status);
      return new Set();
    }
    const data = (await res.json()) as Settings;
    return new Set(
      Object.entries(data.external ?? {})
        .filter(([, on]) => on === true)
        .map(([name]) => name),
    );
  } catch (e) {
    console.error("enabledAuthProviders:", e instanceof Error ? e.message : e);
    return new Set();
  }
});

/** Darf der Google-Knopf gezeigt werden? Nur wenn er auch wirklich funktioniert. */
export async function googleLoginEnabled(): Promise<boolean> {
  return (await enabledAuthProviders()).has("google");
}
