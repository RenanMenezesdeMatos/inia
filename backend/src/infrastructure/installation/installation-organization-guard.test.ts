import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"
import { DEMO_ORGANIZATION_ID } from "../database/demo-mass/demo-constants.js"
import { INSTALLATION_ORGANIZATION_ID } from "./installation.js"

/**
 * ORGANIZAÇÃO SEMPRE DO SERVIDOR, NUNCA FIXA (risco R-01, achado SEC-34). Prova ESTRUTURAL de que nenhum código funcional
 * usa o id da organização da instalação: rota usa a organização da sessão (`request.user!.organizationId`); job e execução
 * usam a do registro (matrícula, Workflow, Agent, Orquestrador). Com uma segunda organização, um id fixo faria os usuários
 * dela lerem e gravarem dados da primeira.
 *
 *  1. o literal do id só aparece onde a organização é CRIADA: a instalação e a massa demo;
 *  2. as constantes que o carregam (`INSTALLATION_ORGANIZATION_ID`, `DEMO_ORGANIZATION_ID`) só são usadas pela instalação
 *     e pela massa demo.
 *
 * Testes e `testing/` ficam fora (fixtures). Um arquivo novo aqui é uma decisão consciente, nunca um atalho.
 */
const SRC = join(__dirname, "..", "..")
const FIXED_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001"

const FILES_THAT_DEFINE_THE_FIXED_ID = new Set([
  // A instalação cria a organização com este id (installation.ts).
  "infrastructure/installation/installation.ts",
  // Massa demo e seed demo: dados de demonstração da organização da instalação.
  "infrastructure/database/demo-mass/demo-constants.ts",
  "infrastructure/database/seed-demo-from-scratch.ts",
])

/** Onde as constantes podem ser lidas: a ferramenta de instalação e a massa demo — nunca um módulo funcional. */
const PLACES_THAT_MAY_USE_THE_CONSTANTS = ["infrastructure/installation/", "infrastructure/database/demo-mass/"]
const CONSTANT_NAMES = /\b(INSTALLATION_ORGANIZATION_ID|DEMO_ORGANIZATION_ID)\b/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === "testing" ? [] : sourceFiles(path)
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : []
  })
}

const files = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, "utf8") }))

describe("organização da instalação — nunca um id fixo no código funcional", () => {
  it("as constantes guardam exatamente o id que esta prova procura", () => {
    expect(INSTALLATION_ORGANIZATION_ID).toBe(FIXED_ORGANIZATION_ID)
    expect(DEMO_ORGANIZATION_ID).toBe(FIXED_ORGANIZATION_ID)
    // A varredura alcança o código funcional (rotas, aplicação, jobs).
    expect(files.map((file) => file.path)).toEqual(expect.arrayContaining(["modules/workflows/application/schedule-check.ts", "modules/agents/presentation/agent-router.ts", "main/app.ts"]))
  })

  it("o literal do id só aparece na instalação e na massa demo", () => {
    const offenders = files.filter((file) => file.text.includes(FIXED_ORGANIZATION_ID) && !FILES_THAT_DEFINE_THE_FIXED_ID.has(file.path))
    expect(offenders.map((file) => file.path)).toEqual([])
  })

  it("as constantes da instalação e da massa demo só são usadas por elas", () => {
    const offenders = files.filter((file) => CONSTANT_NAMES.test(file.text) && !PLACES_THAT_MAY_USE_THE_CONSTANTS.some((place) => file.path.startsWith(place)))
    expect(offenders.map((file) => file.path)).toEqual([])
  })
})
