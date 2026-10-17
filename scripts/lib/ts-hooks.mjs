// Module resolution hooks for running lib/sim's TypeScript from the maintenance scripts (see load-sim.mjs): maps the
// project's "@/..." alias to the project root and lets extensionless relative imports find their .ts file, as the
// bundler and vitest do (including a directory's index.ts). Everything else resolves as usual.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export async function resolve(specifier, context, nextResolve) {
  let spec = specifier;
  if (spec.startsWith("@/")) spec = pathToFileURL(path.join(ROOT, spec.slice(2))).href;
  const relative = spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("file:");
  if (relative && !path.extname(spec.split("?")[0]) && context.parentURL) {
    const base = spec.startsWith("file:") ? fileURLToPath(spec) : fileURLToPath(new URL(spec, context.parentURL));
    if (existsSync(`${base}.ts`)) return nextResolve(pathToFileURL(`${base}.ts`).href, context);
    if (existsSync(path.join(base, "index.ts"))) return nextResolve(pathToFileURL(path.join(base, "index.ts")).href, context);
  }
  return nextResolve(spec, context);
}
