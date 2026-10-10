import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { FROZEN_SCRIPT_DIRECTORIES, frozenScriptFiles, frozenScriptFilesFromManifests } from "./frozen-scripts.js"

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)))

describe("scripts congelados", () => {
  it("deriva dos manifestos só scripts de `scripts/` que existem", () => {
    const fromManifests = frozenScriptFilesFromManifests()
    expect(fromManifests).toContain("scripts/feedback-engine/evaluation/larissa/evaluate-round-v14b.ts")
    expect(fromManifests.every((path) => path.startsWith("scripts/"))).toBe(true)
    for (const path of frozenScriptFiles()) expect(existsSync(join(backendDir, path)), path).toBe(true)
  })

  it("o tsconfig.scripts.json (lista estática) exclui exatamente os mesmos congelados", () => {
    const { config, error } = ts.readConfigFile(join(backendDir, "tsconfig.scripts.json"), ts.sys.readFile)
    expect(error).toBeUndefined()
    const excluded = (config.exclude as string[]).filter((entry) => entry !== "dist" && entry !== "node_modules").sort()
    const expected = [...FROZEN_SCRIPT_DIRECTORIES.map((directory) => `${directory}/**/*`), ...frozenScriptFiles()].sort()
    expect(excluded).toEqual(expected)
  })
})
