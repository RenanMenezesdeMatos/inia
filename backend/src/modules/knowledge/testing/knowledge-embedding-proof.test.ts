import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { setProofAccountPassword } from "../../auth/testing/proof-account-password.js"

/**
 * PROVA contra o banco de TESTE real: busca nas bases em escala (RAG, migration 200) com o modelo de embedding escolhido na tela de IA
 * (Use Case KNOWLEDGE_EMBEDDING) num servidor compatível com OpenAI FALSO em 127.0.0.1 — o mesmo protocolo do gateway local da VM.
 * ZERO chamada de IA paga ou real.
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run knowledge-embedding-proof
 *
 * O "significado" do servidor falso é escolhido aqui (`meaning`): textos sobre contestação/cobrança apontam para a mesma direção, sobre
 * segunda via para outra… É só o comportamento do provider de teste — nenhuma lista de palavras existe no código da INIA.
 */
const { env } = await import("../../../config/env.js")
const { createApp } = await import("../../../main/app.js")
const { registerAiRuntime } = await import("../../../shared/application/model-routing/ai-runtime.js")
const { createAiRuntime } = await import("../../ai-management/application/ai-runtime-service.js")
const { startFakeOpenAiServer } = await import("../../ai-management/testing/fake-openai-compatible-server.js")
const { processKnowledgeEmbeddingIndex } = await import("../application/knowledge-embedding-jobs.js")
const { postgresKnowledgeRecall, rankCandidateDocumentsByCard } = await import("../application/knowledge-recall.js")
const { clearKnowledgeVectorCache } = await import("../application/knowledge-vector-store.js")
const { chunkKnowledgeDocument } = await import("../domain/knowledge-chunking.js")
const { loadKnowledgeProducts } = await import("../application/knowledge-products.js")

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const ADMIN = { email: "carla.nunes@inia.com", password: "Inia@123" }
const PREFIX = "QA Prova RAG · "
const MODELS = ["fake-embed", "fake-embed-2", "fake-bad-request"]

const CONCEPTS: readonly (readonly string[])[] = [["contestação", "contestacao", "reclama", "cobrado", "cobrança"], ["segunda via", "fatura"], ["titular", "nascimento"], ["prazo", "tempo", "termina", "dias", "horas"]]
function meaning(text: string, model: string | null): number[] {
  const lower = text.toLowerCase()
  const vector = [...CONCEPTS.map((words) => (words.some((word) => lower.includes(word)) ? 1 : 0)), 0.05]
  // O segundo modelo "pensa" noutra base vetorial: mesmos conceitos em outra ordem (vetores de modelos diferentes não se comparam).
  return model === "fake-embed-2" ? [...vector].reverse() : vector
}

const DOC_A = { title: `${PREFIX}Segunda via de fatura`, content: "## 1. Prazo de envio\nA segunda via é enviada por e-mail em até 2 horas.\n\n## 2. Validação do titular\nConfirme a data de nascimento antes de emitir.\n" }
const DOC_B = { title: `${PREFIX}Contestação de cobrança`, content: "## 1. Prazo da análise\nA análise da contestação termina em 5 dias úteis.\n\n## 2. Registro\nAnote o protocolo no sistema.\n" }
const QUESTION = "Em quanto tempo sai o resultado quando o cliente reclama de um valor cobrado?"

let pool: pg.Pool
let api: ReturnType<typeof request.agent>
let fake: Awaited<ReturnType<typeof startFakeOpenAiServer>>
const startedAt = new Date()
const ids = { connection: "", embed: "", embed2: "", down: "", generative: "", docA: "", docB: "", versionA: "", versionB: "" }
const embeddingRequests = () => fake.requests.filter((item) => item.path.endsWith("/embeddings"))
const inputsOf = (items: ReturnType<typeof embeddingRequests>) => items.flatMap((item) => (item.body.input as string[]) ?? [])
const ourVersions = () => [ids.versionA, ids.versionB]

async function cleanup() {
  await pool.query(`delete from knowledge_embedding_index where organization_id = $1 and model_key = any($2::text[])`, [ORG, MODELS])
  await pool.query(`delete from knowledge_embedding_vectors where organization_id = $1 and model_key = any($2::text[])`, [ORG, MODELS])
  const documents = (await pool.query<{ id: string }>(`select id from knowledge_documents where organization_id = $1 and title like $2`, [ORG, `${PREFIX}%`])).rows.map((row) => row.id)
  if (documents.length > 0) {
    await pool.query(`alter table product_scope_assignments disable trigger user`)
    await pool.query(`delete from product_scope_assignments where organization_id = $1 and source_id = any($2::uuid[])`, [ORG, documents])
    await pool.query(`alter table product_scope_assignments enable trigger user`)
    await pool.query(`delete from knowledge_versions where document_id = any($1::uuid[])`, [documents])
    await pool.query(`delete from knowledge_documents where id = any($1::uuid[])`, [documents])
  }
  const connections = (await pool.query<{ id: string }>(`select id from ai_connections where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])).rows.map((row) => row.id)
  await pool.query(`delete from ai_usage_events where organization_id = $1 and use_case in ('KNOWLEDGE_EMBEDDING', 'MODEL_TEST') and occurred_at >= $2`, [ORG, startedAt])
  await pool.query(`delete from ai_routing_policies where organization_id = $1 and use_case = 'KNOWLEDGE_EMBEDDING'`, [ORG])
  if (connections.length > 0) {
    await pool.query(`delete from ai_usage_events where connection_id = any($1::uuid[])`, [connections])
    await pool.query(`delete from ai_models where connection_id = any($1::uuid[])`, [connections])
    await pool.query(`delete from ai_connections where id = any($1::uuid[])`, [connections])
  }
  await pool.query(`delete from audit_logs where entity_type like 'ai_%' and created_at >= $1`, [startedAt])
  // Abrangência por produto é histórico imutável: só o banco de TESTE desliga a trava para limpar o que a prova criou.
  await pool.query(`alter table product_scope_assignments disable trigger user`)
  await pool.query(`delete from product_scope_assignments where organization_id = $1 and source_id = any($2::uuid[])`, [ORG, documents])
  await pool.query(`alter table product_scope_assignments enable trigger user`)
  await pool.query(`update product_catalog_nodes_all set parent_id = null where organization_id = $1 and code like 'QA_RAG_%'`, [ORG])
  await pool.query(`delete from product_catalog_nodes_all where organization_id = $1 and code like 'QA_RAG_%'`, [ORG])
}

async function publish(document: { title: string; content: string }, existingDocumentId?: string): Promise<{ documentId: string; versionId: string }> {
  const documentId = existingDocumentId ?? (await pool.query<{ id: string }>(`insert into knowledge_documents (organization_id, title, document_type) values ($1, $2, 'PROCEDURE') returning id`, [ORG, document.title])).rows[0]!.id
  const next = (await pool.query<{ next: number }>(`select coalesce(max(version), 0) + 1 next from knowledge_versions where document_id = $1`, [documentId])).rows[0]!.next
  const versionId = (await pool.query<{ id: string }>(`insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash, published_at) values ($1, $2, $3, $4, 'PUBLISHED', md5($4), now()) returning id`, [ORG, documentId, next, document.content])).rows[0]!.id
  return { documentId, versionId }
}

const sourcesOf = (...documents: { id: string; versionId: string; title: string; content: string }[]) => documents.map((document) => ({ documentId: document.id, documentTitle: document.title, versionId: document.versionId, documentType: "PROCEDURE", chunks: chunkKnowledgeDocument({ id: document.id, title: document.title, content: document.content }) }))
const indexRows = async () => (await pool.query<{ version_id: string; model_key: string; status: string; texts: number; embedded: number; next_attempt_at: Date | null }>(`select version_id, model_key, status, texts, embedded, next_attempt_at from knowledge_embedding_index where version_id = any($1::uuid[]) order by model_key, version_id`, [ourVersions()])).rows
const index = () => processKnowledgeEmbeddingIndex(pool as never, { maxVersionsPerOrganization: 500, maxTextsPerRun: 50_000 })

async function activate(modelId: string): Promise<request.Response> {
  expect((await api.put("/api/v1/admin/ai/routing/KNOWLEDGE_EMBEDDING/draft").send({ mode: "PINNED", modelIds: [modelId] })).status).toBe(200)
  return api.post("/api/v1/admin/ai/routing/KNOWLEDGE_EMBEDDING/activate")
}

describe.skipIf(!ENABLED)("Busca nas bases em escala — prova contra o banco de teste (provider compatível falso, zero IA paga)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    clearKnowledgeVectorCache()
    fake = await startFakeOpenAiServer({ embed: meaning })
    api = request.agent(createApp(pool))
    await setProofAccountPassword(pool, ADMIN.email, ADMIN.password)
    expect((await api.post("/api/v1/auth/login").send(ADMIN)).status).toBe(200)
    registerAiRuntime(createAiRuntime(pool, { snapshotTtlMs: 0, spendTtlMs: 0, alertThrottleMs: 0 }))
    const a = await publish(DOC_A)
    const b = await publish(DOC_B)
    Object.assign(ids, { docA: a.documentId, versionA: a.versionId, docB: b.documentId, versionB: b.versionId })
  })

  afterAll(async () => {
    registerAiRuntime(null)
    await cleanup()
    await fake.close()
    await pool.end()
  })

  it("SEM policy de embedding: a indexação não chama nenhum provider e a busca fica só no BM25 (NO_POLICY)", async () => {
    expect(await index()).toBe(0)
    expect(embeddingRequests()).toHaveLength(0)
    const recall = postgresKnowledgeRecall(pool as never)
    const result = await recall.recall({ organizationId: ORG, question: QUESTION, sources: sourcesOf({ id: ids.docA, versionId: ids.versionA, ...DOC_A }, { id: ids.docB, versionId: ids.versionB, ...DOC_B }), query: recall.startQuery(ORG, QUESTION) })
    expect(result.trace).toMatchObject({ mode: "LEXICAL", vectorSkipped: "NO_POLICY", modelKey: null })
  })

  it("na tela de IA, só modelo do tipo Embedding entra na policy de busca nas bases (generativo é recusado)", async () => {
    const connection = await api.post("/api/v1/admin/ai/connections").send({ providerKey: "OPENAI_COMPATIBLE", name: `${PREFIX}Gateway local`, baseUrl: fake.url, isLocal: true })
    expect(connection.status, JSON.stringify(connection.body)).toBe(201)
    ids.connection = connection.body.data.id
    const create = async (providerModelId: string, kind: string) => {
      const created = await api.post("/api/v1/admin/ai/models").send({ connectionId: ids.connection, providerModelId, displayName: providerModelId, kind })
      expect(created.status, JSON.stringify(created.body)).toBe(201)
      return created.body.data.id as string
    }
    ids.generative = await create("fake-ok", "GENERATIVE")
    ids.embed = await create("fake-embed", "EMBEDDING")
    ids.embed2 = await create("fake-embed-2", "EMBEDDING")
    ids.down = await create("fake-bad-request", "EMBEDDING")
    const refused = await activate(ids.generative)
    expect(refused.status).toBe(422)
    expect(JSON.stringify(refused.body)).toContain("não gera embeddings")
    const routing = (await api.get("/api/v1/admin/ai/routing")).body.data as { useCase: { key: string; modelKind?: string } }[]
    expect(routing.find((item) => item.useCase.key === "KNOWLEDGE_EMBEDDING")?.useCase.modelKind).toBe("EMBEDDING")
    const accepted = await activate(ids.embed)
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
    // "Testar modelo" num modelo de embedding gera um vetor (pedir texto a ele falharia).
    const tested = await api.post(`/api/v1/admin/ai/models/${ids.embed}/test`)
    expect(tested.status, JSON.stringify(tested.body)).toBe(200)
    expect(tested.body.data).toMatchObject({ status: "OK", outputPreview: "Vetor de 5 posições." })
  })

  it("indexação: um vetor por trecho e um cartão por documento, da versão publicada; a segunda rodada não chama nada", async () => {
    await index()
    const ours = inputsOf(embeddingRequests()).filter((text) => text.includes(PREFIX))
    // 2 seções + 1 cartão em cada documento.
    expect(ours).toHaveLength(6)
    expect(ours.filter((text) => text.startsWith(`${DOC_B.title}\n- `))).toHaveLength(1)
    const rows = await indexRows()
    expect(rows).toHaveLength(2)
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ version_id: ids.versionA, model_key: "fake-embed", status: "DONE", texts: 3, embedded: 3 }),
      expect.objectContaining({ version_id: ids.versionB, model_key: "fake-embed", status: "DONE", texts: 3, embedded: 3 }),
    ]))
    const vectors = await pool.query<{ dimensions: number; bytes: number }>(`select dimensions, octet_length(vector) bytes from knowledge_embedding_vectors where organization_id = $1 and model_key = 'fake-embed' limit 1`, [ORG])
    expect(vectors.rows[0]).toEqual({ dimensions: 5, bytes: 20 })
    const before = embeddingRequests().length
    await index()
    expect(embeddingRequests()).toHaveLength(before)
    const usage = await pool.query<{ routing_mode: string; model_name: string; status: string; prompt_tokens: number | null }>(`select routing_mode, model_name, status, input_tokens prompt_tokens from ai_usage_events where organization_id = $1 and use_case = 'KNOWLEDGE_EMBEDDING' and occurred_at >= $2`, [ORG, startedAt])
    expect(usage.rows.length).toBeGreaterThan(0)
    expect(usage.rows.every((row) => row.routing_mode === "PINNED" && row.model_name === "fake-embed" && row.status === "SUCCESS" && (row.prompt_tokens ?? 0) > 0)).toBe(true)
  })

  it("versão nova da base: só o trecho que mudou é gerado de novo (o resto é reaproveitado pelo hash)", async () => {
    const changed = { ...DOC_A, content: DOC_A.content.replace("em até 2 horas", "em até 4 horas") }
    const v2 = await publish(changed, ids.docA)
    const before = embeddingRequests().length
    await index()
    expect(inputsOf(embeddingRequests().slice(before))).toEqual([`${DOC_A.title}\n1. Prazo de envio\n\nA segunda via é enviada por e-mail em até 4 horas.`])
    const row = (await pool.query<{ status: string; texts: number; embedded: number }>(`select status, texts, embedded from knowledge_embedding_index where version_id = $1 and model_key = 'fake-embed'`, [v2.versionId])).rows[0]
    expect(row).toEqual({ status: "DONE", texts: 3, embedded: 1 })
    ids.versionA = v2.versionId
    DOC_A.content = changed.content
  })

  it("camada 2: a paráfrase que o BM25 não acha entra pelo vetor; o vetor da pergunta vai pela policy (uso registrado)", async () => {
    clearKnowledgeVectorCache()
    const recall = postgresKnowledgeRecall(pool as never)
    const sources = sourcesOf({ id: ids.docA, versionId: ids.versionA, ...DOC_A }, { id: ids.docB, versionId: ids.versionB, ...DOC_B })
    const lexicalOnly = await recall.recall({ organizationId: ORG, question: QUESTION, sources, query: null })
    expect(lexicalOnly.recalled.some((chunk) => chunk.documentId === ids.docB && chunk.chunkIndex === 0)).toBe(false)
    const since = new Date()
    const hybrid = await recall.recall({ organizationId: ORG, question: QUESTION, sources, query: recall.startQuery(ORG, QUESTION) })
    expect(hybrid.trace).toMatchObject({ mode: "HYBRID", modelKey: "fake-embed", scopeChunks: 4, indexedChunks: 4 })
    expect(hybrid.recalled[0]).toMatchObject({ documentId: ids.docB, chunkIndex: 0, vectorRank: 1 })
    expect(hybrid.documentOrder[0]).toBe(ids.docB)
    const queries = (await pool.query<{ status: string }>(`select status from ai_usage_events where organization_id = $1 and use_case = 'KNOWLEDGE_EMBEDDING' and occurred_at >= $2`, [ORG, since])).rows
    expect(queries).toEqual([{ status: "SUCCESS" }])
  })

  it("camada 4: o cartão de cada documento ordena QUAL procedimento o motor de feedback lê inteiro", async () => {
    const rank = rankCandidateDocumentsByCard(pool as never)
    const order = await rank(ORG, `Contestação\n${QUESTION}`, [{ documentId: ids.docA, title: DOC_A.title, version: 2, content: DOC_A.content }, { documentId: ids.docB, title: DOC_B.title, version: 1, content: DOC_B.content }])
    expect(order?.[0]).toBe(ids.docB)
  })

  it("trocar o modelo na tela de IA: os vetores do modelo antigo nunca são comparados com o novo; a próxima rodada reindexa", async () => {
    expect((await activate(ids.embed2)).status).toBe(200)
    clearKnowledgeVectorCache()
    const recall = postgresKnowledgeRecall(pool as never)
    const sources = sourcesOf({ id: ids.docA, versionId: ids.versionA, ...DOC_A }, { id: ids.docB, versionId: ids.versionB, ...DOC_B })
    const before = await recall.recall({ organizationId: ORG, question: QUESTION, sources, query: recall.startQuery(ORG, QUESTION) })
    expect(before.trace).toMatchObject({ mode: "LEXICAL", modelKey: "fake-embed-2", vectorSkipped: "NOT_INDEXED", indexedChunks: 0 })
    await index()
    expect((await indexRows()).filter((row) => row.model_key === "fake-embed-2").map((row) => row.status)).toEqual(["DONE", "DONE"])
    clearKnowledgeVectorCache()
    const after = await recall.recall({ organizationId: ORG, question: `${QUESTION} `, sources, query: recall.startQuery(ORG, `${QUESTION} `) })
    expect(after.trace).toMatchObject({ mode: "HYBRID", modelKey: "fake-embed-2" })
    expect(after.recalled[0]).toMatchObject({ documentId: ids.docB, chunkIndex: 0 })
  })

  it("falha do provider (pedido recusado): a versão fica FAILED com nova tentativa espaçada, e a pergunta segue pelo BM25", async () => {
    expect((await activate(ids.down)).status).toBe(200)
    await index()
    const failed = (await indexRows()).filter((row) => row.model_key === "fake-bad-request")
    expect(failed.length).toBeGreaterThan(0)
    expect(failed.every((row) => row.status === "FAILED" && row.next_attempt_at !== null && row.next_attempt_at.getTime() > Date.now())).toBe(true)
    const recall = postgresKnowledgeRecall(pool as never)
    const result = await recall.recall({ organizationId: ORG, question: QUESTION, sources: sourcesOf({ id: ids.docB, versionId: ids.versionB, ...DOC_B }), query: recall.startQuery(ORG, QUESTION) })
    expect(result.trace).toMatchObject({ mode: "LEXICAL", vectorSkipped: "QUERY_UNAVAILABLE" })
  })

  it("produto cadastrado da base entra no texto do vetor; mudou o cadastro (nome da família), a versão é indexada de novo", async () => {
    expect((await activate(ids.embed)).status).toBe(200)
    await index()
    const family = (await pool.query<{ id: string }>(`insert into product_catalog_nodes_all (organization_id, kind, code, name) values ($1, 'FAMILY', 'QA_RAG_FAMILIA', 'Linha Órion QA') returning id`, [ORG])).rows[0]!.id
    const product = (await pool.query<{ id: string }>(`insert into product_catalog_nodes_all (organization_id, kind, code, name, parent_id) values ($1, 'PRODUCT', 'QA_RAG_PRODUTO', 'Rastreador QA', $2) returning id`, [ORG, family])).rows[0]!.id
    await pool.query(`insert into product_scope_assignments (organization_id, source_kind, source_id, node_ids, effective_from) values ($1, 'KNOWLEDGE_DOCUMENT', $2, $3, now() - interval '1 minute')`, [ORG, ids.docB, [product]])
    expect(await loadKnowledgeProducts(pool as never, ORG, [ids.docB, ids.docA])).toEqual(new Map([[ids.docB, "Linha Órion QA › Rastreador QA"]]))
    const before = embeddingRequests().length
    await index()
    const sent = inputsOf(embeddingRequests().slice(before))
    expect(sent).toHaveLength(3)
    expect(sent.every((text) => text.startsWith(`${DOC_B.title}\nProduto: Linha Órion QA › Rastreador QA\n`))).toBe(true)
    expect((await pool.query<{ products_key: string | null }>(`select products_key from knowledge_embedding_index where version_id = $1 and model_key = 'fake-embed'`, [ids.versionB])).rows[0]!.products_key).toBe("Linha Órion QA › Rastreador QA")
    const idle = embeddingRequests().length
    await index()
    expect(embeddingRequests()).toHaveLength(idle)
    await pool.query(`update product_catalog_nodes_all set name = 'Linha Vega QA' where id = $1`, [family])
    await index()
    expect(inputsOf(embeddingRequests().slice(idle)).every((text) => text.includes("Produto: Linha Vega QA › Rastreador QA"))).toBe(true)
    expect(embeddingRequests().length - idle).toBeGreaterThan(0)
  })

  it("interruptor INIA_KB_SCALE_RETRIEVAL=off: a indexação não faz nada", async () => {
    expect((await activate(ids.embed)).status).toBe(200)
    const before = embeddingRequests().length
    expect(await processKnowledgeEmbeddingIndex(pool as never, { enabled: false })).toBe(0)
    expect(embeddingRequests()).toHaveLength(before)
  })
})
