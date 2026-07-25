// Typ-Deklaration, damit src/lib (TypeScript) dieselbe .mjs-Referenzliste importieren
// kann wie die Skripte. Die Liste selbst bleibt in storage-refs.mjs – EINE Quelle,
// zwei Welten (node-Skripte ohne Build, Next-Server mit Bundler).

export type StorageRefSel = (table: string, cols: string) => Promise<Record<string, unknown>[]>;

export type StorageRef = {
  loc: string;
  kind: "hero" | "photo" | "avatar" | "video";
  url: string;
  apply: (...args: unknown[]) => unknown;
};

export function collectStorageRefs(
  sel: StorageRefSel,
  patch: (table: string, where: string, body: Record<string, unknown>) => Promise<void>,
  patchHome: (id: unknown, field: string, url: string, w?: number, h?: number) => Promise<void>,
): Promise<StorageRef[]>;

export function collectTourAudioPaths(sel: StorageRefSel): Promise<string[]>;
