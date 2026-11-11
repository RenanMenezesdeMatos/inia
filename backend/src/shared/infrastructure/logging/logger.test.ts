import { execFile } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

/**
 * Ponte do console para o destino assíncrono (o server.ts liga): cada linha sai como JSON estruturado — a linha JSON que o
 * código já escrevia vira campos; texto e erro viram `msg` (com a pilha) — e o que estava no buffer é gravado antes de sair.
 * Processo filho de verdade (fora do modo de teste, em que os loggers ficam desligados).
 */
const here = dirname(fileURLToPath(import.meta.url))

describe("logs estruturados com escrita assíncrona", () => {
  it("console.* vira JSON por linha com nível; nada se perde na saída do processo", async () => {
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", join(here, "testing/console-bridge-child.ts")], { env: { ...process.env, NODE_ENV: "development", LOG_LEVEL: "info" } })
    const lines = stdout.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({ level: 30, name: "console", event: "ai_call_queued", useCase: "CHAT", waitedMs: 320 })
    expect(lines[1]).toMatchObject({ level: 40, msg: "Aviso à Central de Dados não enviado: conexão recusada" })
    expect(lines[2]).toMatchObject({ level: 50 })
    expect(String(lines[2]!.msg)).toContain("Error: quebrou")
    // `time` em ISO 8601 UTC (busca por horário na VM) e a identidade do processo em toda linha (diagnóstico de erros).
    for (const line of lines) expect(line.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    for (const line of lines) expect(line).toMatchObject({ service: expect.any(String), release: expect.any(String) })
  }, 20_000)
})
