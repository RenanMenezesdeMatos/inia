import { describe, expect, it, vi } from "vitest"
import { createIsolatedParser, IsolatedParserError, runIsolated, siblingModule, type IsolatedParserLimits } from "./isolated-parser.js"
import type { TestJobInput } from "./testing/test-jobs.js"

const JOB = siblingModule(import.meta.url, "testing/test-jobs")
const MB = 1024 * 1024

async function failureOf(promise: Promise<unknown>): Promise<IsolatedParserError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(IsolatedParserError)
  return error as IsolatedParserError
}

function alive(pid: number | undefined): boolean {
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const run = (input: TestJobInput, limits?: IsolatedParserLimits) => runIsolated<{ pid: number; bytes: number; last: number | null; env: string[] }>(JOB, input, limits)

describe("parser isolado — arquivo de usuário lido num processo filho com teto de memória e de tempo (R-24)", () => {
  it("lê no processo filho e devolve o resultado; o filho não herda os segredos do ambiente da API", async () => {
    process.env.INIA_ISOLATED_PARSER_TEST_SECRET = "segredo"
    try {
      const data = Buffer.alloc(5 * MB, 7)
      const result = await run({ mode: "echo", data })
      expect(result.pid).not.toBe(process.pid)
      expect(result).toMatchObject({ bytes: 5 * MB, last: 7 })
      expect(result.env).not.toContain("INIA_ISOLATED_PARSER_TEST_SECRET")
      // No sucesso a resposta volta antes do `exit` (o filho é encerrado logo depois de responder).
      await vi.waitFor(() => expect(alive(result.pid)).toBe(false), { timeout: 2_000 })
    } finally {
      delete process.env.INIA_ISOLATED_PARSER_TEST_SECRET
    }
  })

  it("filho travado num laço síncrono é encerrado no prazo e a API recebe TIMEOUT", async () => {
    const startedAt = Date.now()
    const error = await failureOf(run({ mode: "hang" }, { heapMb: 128, rssMb: 512, timeoutMs: 1_500 }))
    const elapsed = Date.now() - startedAt
    expect(error.reason).toBe("TIMEOUT")
    expect(elapsed).toBeGreaterThanOrEqual(1_500)
    expect(elapsed).toBeLessThan(4_000)
    expect(alive(error.pid)).toBe(false)
  })

  it("memória fora do heap (ArrayBuffers, como o pdf.js descompactando) derruba só o filho: a memória deste processo não sobe", async () => {
    const before = process.memoryUsage.rss()
    const error = await failureOf(run({ mode: "offheap" }, { heapMb: 512, rssMb: 256, timeoutMs: 20_000 }))
    expect(error.reason).toBe("MEMORY")
    expect(process.memoryUsage.rss() - before).toBeLessThan(64 * MB)
    expect(alive(error.pid)).toBe(false)
  })

  it("heap do V8 acima do teto também vira MEMORY", async () => {
    const error = await failureOf(run({ mode: "heap" }, { heapMb: 64, rssMb: 1_024, timeoutMs: 20_000 }))
    expect(error.reason).toBe("MEMORY")
    expect(alive(error.pid)).toBe(false)
  })

  it("erro do parser (arquivo ilegível) vira FAILED com a mensagem dele", async () => {
    const error = await failureOf(run({ mode: "throw" }))
    expect(error).toMatchObject({ reason: "FAILED", message: "Invalid PDF structure" })
    expect(alive(error.pid)).toBe(false)
  })

  it("partes emitidas pelo job chegam na ordem e todas antes da resposta final", async () => {
    const received: number[] = []
    const result = await runIsolated<{ pid: number; chunks: number }>(JOB, { mode: "chunks", chunks: 50 } satisfies TestJobInput, undefined, (chunk) => {
      received.push((chunk as { index: number }).index)
    })
    expect(result.chunks).toBe(50)
    expect(received).toEqual(Array.from({ length: 50 }, (_, index) => index))
    await vi.waitFor(() => expect(alive(result.pid)).toBe(false), { timeout: 2_000 })
  })

  it("quem recebe as partes falhou: a leitura para com FAILED e nada escapa como exceção no processo da API", async () => {
    let calls = 0
    const error = await failureOf(
      runIsolated(JOB, { mode: "chunks", chunks: 50 } satisfies TestJobInput, undefined, () => {
        calls += 1
        throw new Error("lote recusado")
      }),
    )
    expect(error).toMatchObject({ reason: "FAILED", message: "lote recusado" })
    expect(calls).toBe(1)
    expect(alive(error.pid)).toBe(false)
  })

  it("fila: além do teto de filhos e da fila curta, recusa na hora (BUSY) em vez de empilhar processos", async () => {
    const parse = createIsolatedParser({ maxRunning: 1, maxWaiting: 1 })
    const limits = { heapMb: 128, rssMb: 512, timeoutMs: 1_500 }
    const running = parse(JOB, { mode: "hang" } satisfies TestJobInput, limits)
    const queued = parse<{ bytes: number }>(JOB, { mode: "echo", data: Buffer.from("ok") } satisfies TestJobInput, limits)
    expect((await failureOf(parse(JOB, { mode: "echo" } satisfies TestJobInput, limits))).reason).toBe("BUSY")
    expect((await failureOf(running)).reason).toBe("TIMEOUT")
    expect(await queued).toMatchObject({ bytes: 2 })
  })
})
