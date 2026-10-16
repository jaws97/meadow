import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Two Rapier builds sit in node_modules: 0.19.2 nested under
  // @react-three/rapier (the one the world runs on) and a stray 0.12.0 at the
  // top level, pulled in by @types/three. A direct import resolves to the
  // stray one, so take RAPIER and the world from useRapier() instead.
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@dimforge/rapier3d-compat",
              message: "Use useRapier() from @react-three/rapier: a direct import resolves to the stray 0.12 build, not the 0.19.2 world.",
            },
          ],
          patterns: [
            {
              group: ["@dimforge/rapier3d-compat/*"],
              message: "Use useRapier() from @react-three/rapier: a direct import resolves to the stray 0.12 build, not the 0.19.2 world.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
