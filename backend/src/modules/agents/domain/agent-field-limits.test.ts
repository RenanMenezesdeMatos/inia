import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { AGENT_TEXT_LIMITS, agentTextSchema, type AgentTextField } from "./agent-field-limits.js"

describe("agent-field-limits", () => {
  it("aceita exatamente o máximo e recusa um caractere a mais, com mensagem em português", () => {
    const schema = agentTextSchema("contextPrompt")
    expect(schema.safeParse("a".repeat(12_000)).success).toBe(true)
    const over = schema.safeParse("a".repeat(12_001))
    expect(over.success).toBe(false)
    expect(over.error?.issues[0]?.message).toBe("Contexto (prompt): máximo de 12.000 caracteres.")
  })

  it("conta depois do trim: espaços nas pontas não estouram o máximo nem completam o mínimo", () => {
    expect(agentTextSchema("objective").safeParse(`  ${"a".repeat(1_000)}\n\n`).success).toBe(true)
    const blank = agentTextSchema("objective").safeParse("    a    ")
    expect(blank.success).toBe(false)
    expect(blank.error?.issues[0]?.message).toBe("Objetivo: mínimo de 5 caracteres.")
  })

  it("competência não tem mínimo (vazio vira null no envio) e continua com até 80", () => {
    expect(agentTextSchema("capability").safeParse("").success).toBe(true)
    expect(agentTextSchema("capability").safeParse("a".repeat(81)).success).toBe(false)
  })

  it("limites iguais no backend e no espelho do frontend", () => {
    const frontend = readFileSync(new URL("../../../../../frontend/src/schemas/admin/agent.schema.ts", import.meta.url), "utf8")
    const block = frontend.slice(frontend.indexOf("export const AGENT_TEXT_LIMITS"), frontend.indexOf("} as const", frontend.indexOf("export const AGENT_TEXT_LIMITS")))
    const parsed = Object.fromEntries(
      [...block.matchAll(/^\s+(\w+): \{ label: "([^"]+)", min: ([\d_]+), max: ([\d_]+) \},$/gm)].map((match) => [
        match[1],
        { label: match[2], min: Number(match[3]!.replaceAll("_", "")), max: Number(match[4]!.replaceAll("_", "")) },
      ]),
    )
    const backend = Object.fromEntries((Object.keys(AGENT_TEXT_LIMITS) as AgentTextField[]).map((field) => [field, { ...AGENT_TEXT_LIMITS[field] }]))
    expect(parsed).toEqual(backend)
  })
})
