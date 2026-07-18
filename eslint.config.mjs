import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Statische Auslieferung, kein eigener Code. Hier liegt u.a. das fertig gebaute
    // ffmpeg-core.js (112 KB minifiziert) — allein daher kamen 117 der ehemals 161
    // Lint-Meldungen. Fremdcode linten wir nicht.
    "public/**",
    // Temporäre Arbeitskopien von Claude-Subagenten.
    ".claude/**",
  ]),
]);

export default eslintConfig;
