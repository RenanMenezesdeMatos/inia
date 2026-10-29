import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // React 19 flags legacy synchronization patterns already present in the
    // prototype. They remain visible as warnings while each flow is migrated
    // to query state/event handlers, without hiding them from CI.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/incompatible-library": "warn",
      // Erro interno do React Compiler (ex.: `[PruneHoistedContexts]`) tira o componente INTEIRO da análise das outras
      // regras sem nenhum aviso; como erro, a volta do problema aparece no lint (docs/dev/refatoracao-progressiva.md §8).
      "react-hooks/invariant": "error",
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
