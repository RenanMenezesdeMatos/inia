import type { Database } from "../../../infrastructure/database/pool.js"
import { embedKnowledgeTexts, knowledgeEmbeddingModel, type KnowledgeEmbeddingRequest } from "../../../shared/application/model-routing/embedding-gateway.js"
import { AiBudgetExceededError, AiProviderError } from "../../../shared/application/model-routing/ai-errors.js"
import { EMBEDDING_BATCH_SIZE, embeddingText } from "../../ai-management/domain/ai-embedding.js"
import { embeddingTextsOf, type EmbeddingText } from "../domain/embedding-texts.js"
import { chunkKnowledgeDocument } from "../domain/knowledge-chunking.js"
import { abandonKnowledgeEmbeddingGc, collectKnowledgeEmbeddingGarbage, type KnowledgeEmbeddingGcOptions } from "./knowledge-embedding-gc.js"
import { liveKnowledgeVersion } from "./live-knowledge-version.js"
import { knowledgeProductsSql } from "./knowledge-products.js"
import { knowledgeScaleRetrievalEnabled } from "./knowledge-recall.js"
import { knowledgeGlossaryJargonEnabled, queryGlossaryJargonRules } from "./knowledge-glossary-jargon.js"
import { jargonKeyOf, type JargonRule } from "../domain/glossary-jargon.js"
import { missingKnowledgeVectorHashes, storeKnowledgeVectors } from "./knowledge-vector-store.js"

/**
 * INDEXAÇÃO das bases para a busca em escala, em segundo plano (worker, `knowledge-embeddings`, um processo por vez no conjunto). Para
 * cada organização com policy de embedding (Use Case KNOWLEDGE_EMBEDDING), pega as versões VIGENTES publicadas que ainda não foram
 * indexadas com o modelo atual e gera só os vetores que faltam (a chave é o hash do texto: o que não mudou entre versões não é refeito).
 * Publicar uma versão, trocar o modelo na tela de IA ou ligar a policy = a próxima rodada indexa; ninguém precisa pedir.
 *   - Sem policy: nenhuma chamada (a busca usa só o BM25).
 *   - Falha: a versão fica FAILED com nova tentativa espaçada; rota indisponível, credencial e 429 param a organização nesta rodada.
 *   - Orçamento com bloqueio atingido: a organização para nesta rodada SEM marcar a versão (nem tentativa nem espera): quando o orçamento
 *     for liberado, a indexação continua na rodada seguinte.
 *   - O texto enviado ao provider é cortado em `EMBEDDING_MAX_TEXT_CHARS` (o trecho guardado, usado nas respostas e citações, não muda;
 *     o hash continua sendo o do texto inteiro). Lote recusado como inválido é refeito texto a texto: o texto recusado fica só na busca
 *     por texto e não reprova a versão inteira para sempre.
 *   - Teto de textos por rodada: a indexação inicial de muitas bases anda em partes, sem segurar o worker.
 *   - Organização em dia: um passo da limpeza dos vetores que nenhuma versão referencia mais (`knowledge-embedding-gc.ts`).
 */
export const KNOWLEDGE_EMBEDDING_INDEX_VERSION = "KNOWLEDGE_EMBEDDING_INDEX_V1" as const

export type KnowledgeEmbeddingJobDeps = {
  embeddingModel?: (organizationId: string) => Promise<string | null>
  embed?: (request: KnowledgeEmbeddingRequest) => Promise<Float32Array[] | null>
  now?: () => Date
  /** Textos enviados ao provider por rodada (todas as organizações). */
  maxTextsPerRun?: number
  /** Versões examinadas por organização por rodada. */
  maxVersionsPerOrganization?: number
  enabled?: boolean
  /** Limpeza dos vetores que ninguém mais referencia (`knowledge-embedding-gc.ts`); false desliga. */
  gc?: KnowledgeEmbeddingGcOptions | false
  /** Gíria do Glossário no vetor (`knowledge-glossary-jargon.ts`); padrão = o interruptor do ambiente (desligado). */
  glossaryJargon?: boolean
}

export const DEFAULT_MAX_TEXTS_PER_RUN = 2_048
const DEFAULT_MAX_VERSIONS = 25

type VersionRow = { document_id: string; title: string; registered_title: string; version_id: string; content: string; attempts: number | null; products: string | null }

/** Espera antes de tentar de novo uma versão que falhou: 5 min, dobrando, até 6 h. */
export function retryDelayMs(attempts: number): number {
  return Math.min(6 * 3_600_000, 5 * 60_000 * 2 ** Math.max(0, attempts - 1))
}

export async function processKnowledgeEmbeddingIndex(db: Database, deps: KnowledgeEmbeddingJobDeps = {}): Promise<number> {
  if (!(deps.enabled ?? knowledgeScaleRetrievalEnabled())) return 0
  const embeddingModel = deps.embeddingModel ?? knowledgeEmbeddingModel
  const embed = deps.embed ?? embedKnowledgeTexts
  const now = deps.now ?? (() => new Date())
  let budget = deps.maxTextsPerRun ?? DEFAULT_MAX_TEXTS_PER_RUN
  let indexed = 0
  const organizations = (await db.query<{ organization_id: string }>(`select distinct organization_id from knowledge_documents where deleted_at is null order by organization_id`)).rows.map((row) => row.organization_id)
  for (const organizationId of organizations) {
    if (budget <= 0) break
    const modelKey = await embeddingModel(organizationId)
    if (!modelKey) continue
    let jargon: JargonRule[] = []
    if (deps.glossaryJargon ?? knowledgeGlossaryJargonEnabled()) {
      try {
        jargon = await queryGlossaryJargonRules(db, organizationId)
      } catch (error) {
        // Glossário ilegível ≠ Glossário vazio: a organização fica para a próxima rodada, sem refazer nem apagar nada.
        console.error(JSON.stringify({ event: "knowledge_embedding_jargon_unavailable", organizationId, name: (error as Error)?.name }))
        continue
      }
    }
    const jargonKey = jargonKeyOf(jargon)
    const versions = (await db.query<VersionRow>(
      `select * from (
       select kd.id document_id, coalesce(kv.config->>'title', kd.title) title, kd.title registered_title, kv.id version_id, kv.content, ei.attempts,
              ei.status index_status, ei.next_attempt_at, ei.updated_at index_updated_at, ei.products_key, ei.jargon_key, ei.version_id indexed_version,
              ${knowledgeProductsSql("kd.id", "kd.organization_id")} products
         from knowledge_documents kd
         join lateral (${liveKnowledgeVersion("kd.id", "id, content, config")}) kv on true
         left join knowledge_embedding_index ei on ei.version_id = kv.id and ei.model_key = $2
        where kd.organization_id = $1 and kd.deleted_at is null and kv.status = 'PUBLISHED') v
        where v.indexed_version is null
           or (v.index_status = 'FAILED' and coalesce(v.next_attempt_at, v.index_updated_at) <= $3)
           -- Produto da base mudou (vínculo, nome ou família): os textos mudam, a versão é indexada de novo.
           or (v.index_status = 'DONE' and v.products_key is distinct from v.products)
           -- Glossário mudou ou a gíria no vetor foi ligada/desligada (migration 251): a versão é indexada de novo.
           or (v.index_status = 'DONE' and v.jargon_key is distinct from $5::text)
        order by v.indexed_version nulls first, v.title
        limit $4`,
      [organizationId, modelKey, now(), deps.maxVersionsPerOrganization ?? DEFAULT_MAX_VERSIONS, jargonKey],
    )).rows
    // Indexação em dia: um passo da limpeza dos vetores sem referência. Com trabalho de indexação, a passada em curso é abandonada.
    if (versions.length === 0) {
      if (deps.gc !== false) {
        await collectKnowledgeEmbeddingGarbage(db, organizationId, modelKey, now(), { ...(deps.gc ?? {}), jargon }).catch((error: unknown) => {
          abandonKnowledgeEmbeddingGc(organizationId)
          console.error(JSON.stringify({ event: "knowledge_embedding_gc_failed", organizationId, name: (error as Error)?.name }))
        })
      }
      continue
    }
    abandonKnowledgeEmbeddingGc(organizationId)
    for (const version of versions) {
      if (budget <= 0) break
      const outcome = await indexVersion(db, { organizationId, modelKey, version, budget, embed, now, jargon, jargonKey })
      budget -= outcome.sent
      if (outcome.status === "DONE") indexed += 1
      if (outcome.stopOrganization) break
    }
  }
  return indexed
}

async function indexVersion(db: Database, input: { organizationId: string; modelKey: string; version: VersionRow; budget: number; embed: NonNullable<KnowledgeEmbeddingJobDeps["embed"]>; now: () => Date; jargon: readonly JargonRule[]; jargonKey: string | null }): Promise<{ status: "DONE" | "PARTIAL" | "FAILED"; sent: number; stopOrganization: boolean }> {
  const { organizationId, modelKey, version } = input
  const chunks = chunkKnowledgeDocument({ id: version.document_id, title: version.title, content: version.content })
  // Trechos com o título da versão (o que o chat usa); cartão com o título do cadastro (o que o motor de feedback usa).
  const texts = embeddingTextsOf({ documentId: version.document_id, documentTitle: version.title, versionId: version.version_id, chunks }, { cardTitle: version.registered_title, products: version.products, jargon: input.jargon })
  const missing = new Set(await missingKnowledgeVectorHashes(db, organizationId, modelKey, texts.map((text) => text.hash)))
  const pending = [...new Map(texts.filter((text) => missing.has(text.hash)).map((text) => [text.hash, text])).values()]
  let sent = 0
  let stored = 0
  let rejected = 0
  try {
    for (let start = 0; start < pending.length; start += EMBEDDING_BATCH_SIZE) {
      if (sent >= input.budget) return { status: "PARTIAL", sent, stopOrganization: true }
      const batch = pending.slice(start, start + EMBEDDING_BATCH_SIZE)
      const outcome = await embedBatch(db, input, batch, input.budget - sent)
      sent += outcome.sent
      stored += outcome.stored
      rejected += outcome.rejected
      // A policy saiu no meio (ou o teto da rodada acabou no refazer texto a texto): a versão volta na próxima rodada.
      if (outcome.interrupted) return { status: "PARTIAL", sent, stopOrganization: true }
    }
    // Todos os textos recusados = provavelmente configuração (modelo/parâmetro), não o conteúdo: falha com nova tentativa, como antes.
    if (pending.length > 0 && rejected === pending.length) throw new AiProviderError("INVALID_REQUEST", { message: "O modelo de embedding recusou todos os textos da versão." })
    await db.query(
      `insert into knowledge_embedding_index (organization_id, version_id, model_key, status, texts, embedded, attempts, error_code, error_message, next_attempt_at, updated_at, products_key, jargon_key)
       values ($1, $2, $3, 'DONE', $4, $5, coalesce($6, 0) + 1, $9, $10, null, $7, $8, $11)
       on conflict (version_id, model_key) do update set status = 'DONE', texts = excluded.texts, embedded = knowledge_embedding_index.embedded + excluded.embedded,
         attempts = excluded.attempts, error_code = excluded.error_code, error_message = excluded.error_message, next_attempt_at = null, updated_at = excluded.updated_at, products_key = excluded.products_key, jargon_key = excluded.jargon_key`,
      [organizationId, version.version_id, modelKey, texts.length, stored, version.attempts, input.now(), version.products, rejected > 0 ? "INVALID_REQUEST" : null, rejected > 0 ? `${rejected} texto(s) recusado(s) pelo modelo de embedding: ficam só na busca por texto.` : null, input.jargonKey],
    )
    return { status: "DONE", sent, stopOrganization: false }
  } catch (error) {
    if (error instanceof AiBudgetExceededError) {
      // Não é falha da versão: nada é gravado (nem tentativa nem espera); o que já foi gerado fica guardado pelo hash.
      console.warn(JSON.stringify({ event: "knowledge_embedding_index_budget_exceeded", organizationId, versionId: version.version_id, modelKey, message: "Orçamento de IA com bloqueio atingido: a indexação desta organização para nesta rodada e continua quando o orçamento for liberado." }))
      return { status: "PARTIAL", sent, stopOrganization: true }
    }
    const category = error instanceof AiProviderError ? error.category : "UNKNOWN"
    const attempts = (version.attempts ?? 0) + 1
    await db.query(
      `insert into knowledge_embedding_index (organization_id, version_id, model_key, status, texts, embedded, attempts, error_code, error_message, next_attempt_at, updated_at)
       values ($1, $2, $3, 'FAILED', $4, $5, $6, $7, $8, $9, $10)
       on conflict (version_id, model_key) do update set status = 'FAILED', texts = excluded.texts, embedded = knowledge_embedding_index.embedded + excluded.embedded,
         attempts = excluded.attempts, error_code = excluded.error_code, error_message = excluded.error_message, next_attempt_at = excluded.next_attempt_at, updated_at = excluded.updated_at`,
      [organizationId, version.version_id, modelKey, texts.length, stored, attempts, category, error instanceof AiProviderError ? error.message.slice(0, 500) : "Falha ao indexar a versão.", new Date(input.now().getTime() + retryDelayMs(attempts)), input.now()],
    )
    console.error(JSON.stringify({ event: "knowledge_embedding_index_failed", organizationId, versionId: version.version_id, modelKey, category, attempts }))
    return { status: "FAILED", sent, stopOrganization: category === "BUDGET_EXCEEDED" || category === "ROUTE_UNAVAILABLE" || category === "AUTH" || category === "RATE_LIMIT" }
  }
}

/** Recusa que é do TEXTO (não do provider): refazer o lote texto a texto isola o texto recusado. */
const isTextRejection = (error: unknown) => error instanceof AiProviderError && (error.category === "INVALID_REQUEST" || error.category === "CONTEXT_LIMIT")

type EmbedInput = { organizationId: string; modelKey: string; embed: NonNullable<KnowledgeEmbeddingJobDeps["embed"]> }

/**
 * Um lote: gera e grava os vetores. O provider recebe o texto cortado em `EMBEDDING_MAX_TEXT_CHARS` (o hash é o do texto inteiro). Lote
 * recusado como inválido → refeito texto a texto; o texto que continuar recusado sozinho é contado em `rejected` e fica sem vetor.
 */
async function embedBatch(db: Database, input: EmbedInput, batch: readonly EmbeddingText[], budget: number): Promise<{ sent: number; stored: number; rejected: number; interrupted: boolean }> {
  const request = (texts: readonly EmbeddingText[]) => input.embed({ organizationId: input.organizationId, texts: texts.map((text) => embeddingText(text.text)), purpose: "DOCUMENT", modelKey: input.modelKey, stage: "INDEX", source: "AGENT" })
  const store = async (texts: readonly EmbeddingText[], vectors: Float32Array[]) => {
    if (vectors.length !== texts.length) throw new AiProviderError("PROVIDER_ERROR", { message: "Número de vetores diferente do de textos." })
    await storeKnowledgeVectors(db, input.organizationId, input.modelKey, texts.map((text, index) => ({ hash: text.hash, vector: vectors[index]! })))
  }
  try {
    const vectors = await request(batch)
    if (!vectors) return { sent: 0, stored: 0, rejected: 0, interrupted: true }
    await store(batch, vectors)
    return { sent: batch.length, stored: batch.length, rejected: 0, interrupted: false }
  } catch (error) {
    if (!isTextRejection(error)) throw error
    if (batch.length === 1) return { sent: 1, stored: 0, rejected: 1, interrupted: false }
  }
  let sent = batch.length
  let stored = 0
  let rejected = 0
  for (const text of batch) {
    if (sent >= budget) return { sent, stored, rejected, interrupted: true }
    try {
      sent += 1
      const vectors = await request([text])
      if (!vectors) return { sent, stored, rejected, interrupted: true }
      await store([text], vectors)
      stored += 1
    } catch (error) {
      if (!isTextRejection(error)) throw error
      rejected += 1
      console.warn(JSON.stringify({ event: "knowledge_embedding_text_rejected", organizationId: input.organizationId, modelKey: input.modelKey, documentId: text.documentId, chunkIndex: text.chunkIndex, kind: text.kind, category: (error as AiProviderError).category }))
    }
  }
  return { sent, stored, rejected, interrupted: false }
}
