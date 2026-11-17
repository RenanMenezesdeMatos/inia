import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { AiBudgetExceededError, AiProviderError } from "../../../shared/application/model-routing/ai-errors.js"
import { EMBEDDING_MAX_TEXT_CHARS } from "../../ai-management/domain/ai-embedding.js"
import type { KnowledgeEmbeddingRequest } from "../../../shared/application/model-routing/embedding-gateway.js"
import { processKnowledgeEmbeddingIndex } from "./knowledge-embedding-jobs.js"

/**
 * Indexação das bases (auditoria run-4): orçamento atingido não reprova versões (RAG-01); o texto enviado ao provider tem teto e um texto
 * recusado não reprova a versão para sempre (RAG-02). Banco e provider falsos.
 */
const ORG = "11111111-1111-4111-8111-111111111111"
const version = (index: number, content = `## Seção ${index}\nTexto da base ${index}.`) => ({ document_id: `doc-${index}`, title: `Base ${index}`, registered_title: `Base ${index}`, version_id: `ver-${index}`, content, attempts: null, products: null })

function fakeDb(versions: ReturnType<typeof version>[]) {
  const indexWrites: { status: string; params: unknown[] }[] = []
  const stored: string[] = []
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("select distinct organization_id")) return { rows: [{ organization_id: ORG }] }
      if (sql.includes("left join knowledge_embedding_index")) return { rows: versions }
      if (sql.includes("select content_hash from knowledge_embedding_vectors")) return { rows: [] }
      if (sql.includes("insert into knowledge_embedding_vectors")) {
        stored.push(...(params[2] as string[]))
        return { rows: [] }
      }
      if (sql.includes("insert into knowledge_embedding_index")) {
        indexWrites.push({ status: sql.includes("'DONE'") ? "DONE" : "FAILED", params })
        return { rows: [] }
      }
      throw new Error(`SQL inesperado: ${sql.slice(0, 80)}`)
    },
  } as unknown as Database
  return { db, indexWrites, stored }
}

const vectorOf = () => new Float32Array([1, 0, 0])
const run = (db: Database, embed: (request: KnowledgeEmbeddingRequest) => Promise<Float32Array[] | null>) => processKnowledgeEmbeddingIndex(db, { enabled: true, embeddingModel: async () => "embed", embed, gc: false, now: () => new Date("2026-11-17T12:00:00Z") })

describe("indexação das bases — orçamento (RAG-01)", () => {
  it("orçamento com bloqueio atingido para a organização na 1ª versão, sem marcar FAILED nem contar tentativa", async () => {
    const { db, indexWrites } = fakeDb([version(1), version(2), version(3)])
    const embed = vi.fn(async () => {
      throw new AiBudgetExceededError("Orçamento mensal de IA global atingido.", { budgetId: "b", scope: "GLOBAL", scopeKey: null, currency: "USD", limit: "1", spent: "1" })
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    expect(await run(db, embed)).toBe(0)
    expect(embed).toHaveBeenCalledTimes(1)
    expect(indexWrites).toEqual([])
    expect(warn.mock.calls.some(([line]) => String(line).includes("knowledge_embedding_index_budget_exceeded"))).toBe(true)
    warn.mockRestore()
  })
})

describe("indexação das bases — texto enviado (RAG-02)", () => {
  it("o texto enviado ao provider é cortado no teto; o hash continua o do texto inteiro", async () => {
    const long = `## Tabela\n${"x".repeat(30_000)}`
    const { db, stored, indexWrites } = fakeDb([version(1, long)])
    const sent: string[] = []
    await run(db, async (request) => (sent.push(...request.texts), request.texts.map(vectorOf)))
    expect(Math.max(...sent.map((text) => text.length))).toBeLessThanOrEqual(EMBEDDING_MAX_TEXT_CHARS)
    expect(stored).toHaveLength(sent.length)
    expect(indexWrites.map((write) => write.status)).toEqual(["DONE"])
  })

  it("lote recusado como inválido é refeito texto a texto: o texto recusado fica sem vetor e a versão fica DONE com o aviso", async () => {
    const { db, stored, indexWrites } = fakeDb([version(1, "## A\nTexto bom.\n\n## B\nTexto RUIM.\n\n## C\nOutro texto bom.")])
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    await run(db, async (request) => {
      if (request.texts.some((text) => text.includes("RUIM"))) throw new AiProviderError("INVALID_REQUEST")
      return request.texts.map(vectorOf)
    })
    warn.mockRestore()
    // 3 trechos + cartão = 4 textos; 1 recusado.
    expect(stored).toHaveLength(3)
    expect(indexWrites).toHaveLength(1)
    expect(indexWrites[0]!.status).toBe("DONE")
    expect(indexWrites[0]!.params[4]).toBe(3)
    expect(indexWrites[0]!.params[8]).toBe("INVALID_REQUEST")
  })

  it("todos os textos recusados (provável configuração): FAILED com nova tentativa, como antes", async () => {
    const { db, stored, indexWrites } = fakeDb([version(1)])
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    await run(db, async () => {
      throw new AiProviderError("INVALID_REQUEST")
    })
    warn.mockRestore()
    error.mockRestore()
    expect(stored).toEqual([])
    expect(indexWrites.map((write) => [write.status, write.params[6]])).toEqual([["FAILED", "INVALID_REQUEST"]])
  })
})
