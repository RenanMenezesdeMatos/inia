import { beforeEach, describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { contentHashOf, documentCardText, embeddingTextsOf } from "../domain/embedding-texts.js"
import { chunkKnowledgeDocument } from "../domain/knowledge-chunking.js"
import { collectKnowledgeEmbeddingGarbage, resetKnowledgeEmbeddingGc } from "./knowledge-embedding-gc.js"

/**
 * RAG-05 (auditoria run-4): vetores de base excluída, de versão substituída e de modelo que saiu da policy nunca eram apagados. A limpeza
 * apaga só o que nenhuma versão referencia — e nunca o que ainda é referenciado, o que foi criado depois do início da passada, nem segue
 * quando houve indexação no meio.
 */
const ORG = "11111111-1111-4111-8111-111111111111"
const MODEL = "embed-atual"
const LIVE = { document_id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Contestação", registered_title: "Contestação (cadastro)", version_id: "bbbbbbbb-0000-4000-8000-000000000002", content: "## 1. Prazo\nTermina em 5 dias úteis.\n\n## 2. Registro\nAnote o protocolo.", products: null }
const OLDER = { document_id: LIVE.document_id, registered_title: LIVE.registered_title, version_id: "bbbbbbbb-0000-4000-8000-000000000001", content: "## 1. Prazo antigo\nTermina em 10 dias.", products: null }

const liveHashes = () => embeddingTextsOf({ documentId: LIVE.document_id, documentTitle: LIVE.title, versionId: LIVE.version_id, chunks: chunkKnowledgeDocument({ id: LIVE.document_id, title: LIVE.title, content: LIVE.content }) }, { cardTitle: LIVE.registered_title, products: null }).map((text) => text.hash)
const olderCard = () => contentHashOf(documentCardText({ documentId: OLDER.document_id, documentTitle: OLDER.registered_title, versionId: OLDER.version_id, chunks: chunkKnowledgeDocument({ id: OLDER.document_id, title: OLDER.registered_title, content: OLDER.content }) }, null))
const hash = (seed: string) => contentHashOf(seed)

type Vector = { model_key: string; content_hash: string; created_at: Date }

function fakeDb(vectors: Vector[], options: { changed?: () => boolean; models?: { model_key: string; last_indexed_at: Date }[] } = {}) {
  const deletedIndexes: unknown[][] = []
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("join lateral")) return { rows: (params[1] as string) < LIVE.document_id ? [LIVE] : [] }
      if (sql.includes("from knowledge_versions kv")) return { rows: (params[1] as string) < OLDER.version_id ? [OLDER, { ...OLDER, version_id: LIVE.version_id, content: LIVE.content }] : [] }
      if (sql.includes("group by model_key")) return { rows: options.models ?? [] }
      if (sql.startsWith("delete from knowledge_embedding_index")) {
        deletedIndexes.push(params)
        return { rows: [] }
      }
      if (sql.includes("select exists")) return { rows: [{ changed: options.changed?.() ?? false }] }
      if (sql.includes("from knowledge_embedding_vectors") && sql.trimStart().startsWith("select")) {
        const sorted = [...vectors].sort((left, right) => (left.model_key + "|" + left.content_hash).localeCompare(right.model_key + "|" + right.content_hash))
        const after = params.length > 2 ? `${params[2]}|${params[3]}` : null
        return { rows: sorted.filter((row) => !after || `${row.model_key}|${row.content_hash}` > after).slice(0, params[1] as number) }
      }
      if (sql.includes("delete from knowledge_embedding_vectors")) {
        const models = params[1] as string[]
        const hashes = params[2] as string[]
        const before = (params[3] as Date).getTime()
        let count = 0
        for (let index = vectors.length - 1; index >= 0; index--) {
          const row = vectors[index]!
          if (models.some((model, at) => model === row.model_key && hashes[at] === row.content_hash) && row.created_at.getTime() < before) {
            vectors.splice(index, 1)
            count += 1
          }
        }
        return { rows: [], rowCount: count }
      }
      throw new Error(`SQL inesperado: ${sql.slice(0, 80)}`)
    },
  } as unknown as Database
  return { db, deletedIndexes }
}

const OLD = new Date("2026-11-01T00:00:00Z")
const NOW = new Date("2026-11-17T12:00:00Z")

describe("limpeza dos vetores das bases (RAG-05)", () => {
  beforeEach(() => resetKnowledgeEmbeddingGc())

  it("apaga só o que ninguém referencia: base excluída, versão substituída e outro modelo saem; vigente e cartão das versões publicadas ficam", async () => {
    const kept = [...liveHashes(), olderCard()].map((content_hash) => ({ model_key: MODEL, content_hash, created_at: OLD }))
    const garbage = [{ model_key: MODEL, content_hash: hash("base excluída"), created_at: OLD }, { model_key: "embed-antigo", content_hash: liveHashes()[0]!, created_at: OLD }]
    const vectors = [...kept, ...garbage]
    const { db, deletedIndexes } = fakeDb(vectors)
    expect(await collectKnowledgeEmbeddingGarbage(db, ORG, MODEL, NOW)).toBe(2)
    expect(vectors).toEqual(expect.arrayContaining(kept))
    expect(vectors).toHaveLength(kept.length)
    // O andamento das versões que deixaram de valer (e de outros modelos) sai junto: base restaurada é indexada de novo.
    expect(deletedIndexes).toEqual([[ORG, MODEL, [LIVE.version_id], []]])
  })

  it("outro modelo com indexação recente é preservado (o principal pode trocar por pouco tempo e voltar); o antigo sai", async () => {
    const recent = { model_key: "embed-reserva", content_hash: hash("reserva"), created_at: OLD }
    const stale = { model_key: "embed-antigo", content_hash: hash("antigo"), created_at: OLD }
    const vectors = [recent, stale]
    const { db, deletedIndexes } = fakeDb(vectors, { models: [{ model_key: "embed-reserva", last_indexed_at: new Date(NOW.getTime() - 3_600_000) }, { model_key: "embed-antigo", last_indexed_at: new Date(NOW.getTime() - 30 * 24 * 3_600_000) }] })
    expect(await collectKnowledgeEmbeddingGarbage(db, ORG, MODEL, NOW)).toBe(1)
    expect(vectors).toEqual([recent])
    expect(deletedIndexes[0]![3]).toEqual(["embed-reserva"])
  })

  it("nunca apaga vetor criado depois do início da passada", async () => {
    const vectors = [{ model_key: MODEL, content_hash: hash("novo"), created_at: new Date(NOW.getTime() + 1) }]
    const { db } = fakeDb(vectors)
    expect(await collectKnowledgeEmbeddingGarbage(db, ORG, MODEL, NOW)).toBe(0)
    expect(vectors).toHaveLength(1)
  })

  it("indexação durante a passada: a passada é abandonada sem apagar nada", async () => {
    const vectors = [{ model_key: MODEL, content_hash: hash("sem referência"), created_at: OLD }]
    const { db } = fakeDb(vectors, { changed: () => true })
    expect(await collectKnowledgeEmbeddingGarbage(db, ORG, MODEL, NOW)).toBe(0)
    expect(vectors).toHaveLength(1)
  })

  it("em partes: teto de exclusões por rodada, a próxima continua; depois da passada, espera o intervalo", async () => {
    const vectors = Array.from({ length: 7 }, (_, index) => ({ model_key: MODEL, content_hash: hash(`lixo ${index}`), created_at: OLD }))
    const { db } = fakeDb(vectors)
    const options = { maxDeletesPerRun: 3, pageSize: 2 }
    expect(await collectKnowledgeEmbeddingGarbage(db, ORG, MODEL, NOW, options)).toBe(3)
    expect(await collectKnowledgeEmbeddingGarbage(db, ORG, MODEL, NOW, options)).toBe(3)
    expect(await collectKnowledgeEmbeddingGarbage(db, ORG, MODEL, NOW, options)).toBe(1)
    expect(vectors).toHaveLength(0)
    vectors.push({ model_key: MODEL, content_hash: hash("lixo novo"), created_at: OLD })
    expect(await collectKnowledgeEmbeddingGarbage(db, ORG, MODEL, new Date(NOW.getTime() + 60_000), options)).toBe(0)
    expect(await collectKnowledgeEmbeddingGarbage(db, ORG, MODEL, new Date(NOW.getTime() + 7 * 3_600_000), options)).toBe(1)
  })
})
