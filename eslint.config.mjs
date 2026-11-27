import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import local from "./lint/no-comments.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    ignores: ["components/ui/**", "components/motion-garden/**"],
    plugins: { local },
    rules: { "local/no-comments": "error" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "desktop/node_modules/**",
    "desktop/.dev/**",
    "desktop/.stage/**",
    "desktop/.out/**",
    "brag-output*/**",
  ]),
]);

export default eslintConfig;
