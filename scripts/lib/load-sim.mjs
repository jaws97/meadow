// Lets the maintenance scripts use lib/sim (TypeScript) directly, so they never carry their own copy of a model
// constant (PLANT_OPEN_H, GAME_START) or of the Open-Meteo normaliser. Node 22 runs TypeScript with
// --experimental-strip-types, and ts-hooks.mjs resolves lib/sim's extensionless and "@/..." imports.
//
// A script calls ensureTypeScript() before anything else: without the flag it runs itself again with it (same
// arguments, same environment, so --env-file secrets carry over) and exits with the child's status. No new dependency.
import { spawnSync } from "node:child_process";
import { register } from "node:module";

export function ensureTypeScript() {
  if (process.features?.typescript) {
    register("./ts-hooks.mjs", import.meta.url);
    return;
  }
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", ...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: process.env,
  });
  process.exit(child.status ?? 1);
}

/** lib/sim's public API (lib/sim/index.ts). Call ensureTypeScript() first. */
export function importSim() {
  return import(new URL("../../lib/sim/index.ts", import.meta.url).href);
}

/** Another pure project module, by path from the project root (e.g. "lib/server/validate.ts"); never a server-only one. */
export function importProject(relativePath) {
  return import(new URL(`../../${relativePath}`, import.meta.url).href);
}
