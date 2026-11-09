import eslint from "@eslint/js"
import tseslint from "typescript-eslint"
import { FROZEN_SCRIPT_DIRECTORIES, frozenScriptFiles } from "./scripts/frozen-scripts.js"

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  // `vendor/`: arquivos de terceiros copiados como vieram (motor de OCR — ver vendor/tesseract/LEIA-ME.md).
  { ignores: ["dist/**", "coverage/**", "vendor/**"] },
  // Scripts congelados (hash no `*-freeze.json` ou "nunca reexecutar"): editar apagaria a evidência — fora do lint, como do
  // `tsconfig.scripts.json`. A lista sai de `scripts/frozen-scripts.js` (derivada dos próprios manifestos).
  { ignores: [...FROZEN_SCRIPT_DIRECTORIES.map((directory) => `${directory}/**`), ...frozenScriptFiles()] },
)
