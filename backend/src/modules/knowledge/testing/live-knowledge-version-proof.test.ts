/**
 * PROVA no banco de TESTE real da VERSÃO VIGENTE de uma base (`live-knowledge-version.ts`) nos leitores que alimentam a IA — busca
 * nas bases do Agent/especialista (`retrieve-knowledge`), bases do motor de feedback (`loadAgentDocumentsAt`) e o carregador do
 * feedback confiável — e no acesso ao material:
 *   - rascunho pendente sobre a publicada: a base continua valendo, com o conteúdo PUBLICADO (D2);
 *   - arquivada sobre uma publicada anterior: a base sai — a anterior não volta a valer sozinha (D13);
 *   - arquivada e depois rascunho: continua fora; republicada: volta.
 * Validação funcional de 20/10/2026. Tudo numa transação desfeita.
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run live-knowledge-version-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { loadAgentDocumentsAt } from "../../feedback-engine/infrastructure/postgres-engine-loaders.js"
import { createPostgresPublishedKnowledgeLoader } from "../../reliable-feedback/infrastructure/postgres-feedback-context-loaders.js"
import { clearKnowledgeSnapshotCache, retrieveKnowledgeForAgent } from "../application/retrieve-knowledge.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
let client: pg.PoolClient
const db = () => client as unknown as Database

describe.skipIf(!ENABLED)("Versão vigente das bases nos leitores da IA (banco real)", () => {
  const docs = { pendingDraft: "", archivedOver: "", archivedThenDraft: "", republished: "" }
  let agentId = ""

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    client = await pool.connect()
    await client.query("begin")
    await client.query("set local statement_timeout = '10s'")
    agentId = (await client.query<{ id: string }>("insert into agents (organization_id, name, agent_type, objective, description, context_prompt) values ($1, 'Prova Versão Vigente', 'CUSTOM', 'Responder', 'Prova', 'Responda.') returning id", [ORG])).rows[0]!.id
    const document = async (title: string, versions: readonly (readonly [string, string])[]) => {
      const id = (await client.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type, source_type) values ($1, $2, 'PROCEDURE', 'TEXT') returning id", [ORG, title])).rows[0]!.id
      for (const [index, [status, content]] of versions.entries()) {
        await client.query("insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1, $2, $3, $4, $5, $6)", [ORG, id, index + 1, content, status, `hash-${id}-${index + 1}`])
      }
      await client.query("insert into knowledge_document_org_scopes (knowledge_document_id, scope_type) values ($1, 'ALL_TEAMS')", [id])
      await client.query("insert into agent_knowledge_documents (agent_id, knowledge_document_id) values ($1, $2)", [agentId, id])
      return id
    }
    docs.pendingDraft = await document("Prova Vigente — publicada com rascunho pendente", [["PUBLISHED", "## Preço\nO plano custa R$ 139,99 por mês."], ["DRAFT", "## Preço\nO plano custa R$ 999,99 por mês."]])
    docs.archivedOver = await document("Prova Vigente — arquivada sobre publicada", [["PUBLISHED", "## Preço\nVersão antiga R$ 100,00."], ["ARCHIVED", "## Preço\nVersão arquivada R$ 120,00."]])
    docs.archivedThenDraft = await document("Prova Vigente — arquivada e depois rascunho", [["PUBLISHED", "## Preço\nAntiga."], ["ARCHIVED", "## Preço\nArquivada."], ["DRAFT", "## Preço\nRascunho."]])
    docs.republished = await document("Prova Vigente — republicada", [["ARCHIVED", "## Preço\nArquivada."], ["PUBLISHED", "## Preço\nRepublicada R$ 150,00."]])
    clearKnowledgeSnapshotCache()
  })

  afterAll(async () => {
    clearKnowledgeSnapshotCache()
    await client?.query("rollback")
    client?.release()
    await pool?.end()
  })

  const live = () => [docs.pendingDraft, docs.republished].sort()

  it("Agent/especialista: só as bases vigentes publicadas entram na busca", async () => {
    const result = await retrieveKnowledgeForAgent(db(), agentId, "Qual o preço do plano?")
    expect(result.trace.authorizedDocuments.map((document) => document.id).sort()).toEqual(live())
    expect(result.promptBlock).not.toContain("999,99")
    expect(result.promptBlock).not.toContain("100,00")
  })

  it("motor de feedback: mesmas bases; a com rascunho pendente traz o conteúdo publicado", async () => {
    const documents = await loadAgentDocumentsAt(db(), ORG, agentId, new Date())
    expect(documents.map((document) => document.documentId).sort()).toEqual(live())
    expect(documents.find((document) => document.documentId === docs.pendingDraft)?.content).toContain("139,99")
  })

  it("feedback confiável: o carregador de bases publicadas segue a mesma regra", async () => {
    const loaded = await createPostgresPublishedKnowledgeLoader(db())(ORG, Object.values(docs))
    expect([...loaded.keys()].sort()).toEqual(live())
    expect(loaded.get(docs.pendingDraft)?.version).toBe(1)
  })
})
