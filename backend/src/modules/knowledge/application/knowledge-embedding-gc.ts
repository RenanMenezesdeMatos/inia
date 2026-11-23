import type { Database } from "../../../infrastructure/database/pool.js"
import { contentHashOf, documentCardText, embeddingTextsOf } from "../domain/embedding-texts.js"
import { chunkKnowledgeDocument } from "../domain/knowledge-chunking.js"
import { liveKnowledgeVersion } from "./live-knowledge-version.js"
import { knowledgeProductsSql } from "./knowledge-products.js"
import type { JargonRule } from "../domain/glossary-jargon.js"

/**
 * LIMPEZA dos vetores das bases (`knowledge_embedding_vectors`, migration 200). O vetor é dado DERIVADO (cache refeito a partir das versões
 * publicadas, sem exclusão lógica — a regra de exclusão lógica vale para objeto de negócio), mas pode carregar texto da base: vetor de base
 * excluída, de versão substituída ou de modelo que saiu da policy não fica para sempre.
 *
 * Roda dentro da tarefa `knowledge-embeddings` (mesmo lock periódico: um processo por vez), por organização, só quando a indexação da
 * organização está em dia (nada a indexar nesta rodada), no máximo uma passada a cada `intervalMs`, e em partes (páginas pela chave primária,
 * teto de exclusões por rodada). Nunca apaga vetor ainda referenciado:
 *   - referenciado = todos os textos (trechos + cartão) da versão VIGENTE publicada de cada base não excluída, com o título e os produtos de
 *     hoje (exatamente o que a indexação e a busca calculam), MAIS o cartão das demais versões publicadas da base (o motor de feedback lê a
 *     versão em vigor na data da chamada e ordena pelo cartão dela) — e só do modelo atual da policy;
 *   - o conjunto é calculado no início da passada; só sai vetor criado ANTES dela; e se qualquer indexação acontecer durante a passada (linha
 *     de `knowledge_embedding_index` gravada depois do início), a passada é abandonada e recomeça mais tarde do zero;
 *   - no início, o andamento (`knowledge_embedding_index`) das versões que deixaram de ser referenciadas (não vigentes, base excluída, outro
 *     modelo) é apagado junto: se a base voltar (restaurada) ou o modelo voltar, a versão é indexada de novo em vez de ficar "DONE" sem vetor;
 *   - OUTRO modelo com indexação recente (`otherModelGraceMs`, 7 dias) é preservado (índice e vetores): o modelo principal da policy pode
 *     trocar por pouco tempo (fila por limite de requisições, ordem automática) e voltar — sem isso a volta refaria a indexação inteira.
 */
export const KNOWLEDGE_EMBEDDING_GC_VERSION = "KNOWLEDGE_EMBEDDING_GC_V1" as const

export type KnowledgeEmbeddingGcOptions = {
  /** Intervalo mínimo entre o fim de uma passada e o início da próxima (por organização). */
  intervalMs?: number
  /** Vetores examinados por página. */
  pageSize?: number
  /** Teto de vetores apagados por rodada (por organização). */
  maxDeletesPerRun?: number
  /** Páginas examinadas por rodada (por organização). */
  maxPagesPerRun?: number
  /** Outro modelo com indexação mais recente que isto é preservado. */
  otherModelGraceMs?: number
  /**
   * Regras da gíria do Glossário no vetor quando ligada (`knowledge-glossary-jargon.ts`): os textos COM e SEM a gíria contam como
   * referenciados — a busca usa o sem gíria como reserva enquanto a indexação não chega, e desligar volta na hora, sem gerar nada.
   */
  jargon?: readonly JargonRule[]
}

export const DEFAULT_GC_INTERVAL_MS = 6 * 3_600_000
const DEFAULT_PAGE_SIZE = 2_000
const DEFAULT_MAX_DELETES = 5_000
const DEFAULT_MAX_PAGES = 10
export const DEFAULT_OTHER_MODEL_GRACE_MS = 7 * 24 * 3_600_000
const VERSION_PAGE = 50

type PassState = { modelKey: string; startedAt: Date; referenced: Set<string> | null; preservedModels: Set<string>; cursor: { modelKey: string; hash: string } | null; finishedAt: Date | null }

/** Andamento por organização (no processo que detém o lock; outro processo recomeça do zero, com segurança). */
const passes = new Map<string, PassState>()

/** Só para testes. */
export function resetKnowledgeEmbeddingGc(): void {
  passes.clear()
}

/** A indexação da organização teve trabalho nesta rodada: a passada em curso (se houver) é abandonada. */
export function abandonKnowledgeEmbeddingGc(organizationId: string): void {
  const state = passes.get(organizationId)
  if (state && !state.finishedAt) passes.delete(organizationId)
}

type LiveRow = { document_id: string; title: string; registered_title: string; version_id: string; content: string; products: string | null }
type OlderRow = { document_id: string; registered_title: string; version_id: string; content: string; products: string | null }

/** Hashes referenciados (modelo atual) e as versões vigentes publicadas. Lido em páginas por documento. */
export async function referencedKnowledgeHashes(db: Database, organizationId: string, jargon: readonly JargonRule[] = []): Promise<{ hashes: Set<string>; liveVersionIds: string[] }> {
  const hashes = new Set<string>()
  const liveVersionIds: string[] = []
  let after = "00000000-0000-0000-0000-000000000000"
  for (;;) {
    const rows = (await db.query<LiveRow>(
      `select kd.id document_id, coalesce(kv.config->>'title', kd.title) title, kd.title registered_title, kv.id version_id, kv.content,
              ${knowledgeProductsSql("kd.id", "kd.organization_id")} products
         from knowledge_documents kd
         join lateral (${liveKnowledgeVersion("kd.id", "id, content, config")}) kv on true
        where kd.organization_id = $1 and kd.deleted_at is null and kv.status = 'PUBLISHED' and kd.id > $2
        order by kd.id
        limit ${VERSION_PAGE}`,
      [organizationId, after],
    )).rows
    for (const row of rows) {
      liveVersionIds.push(row.version_id)
      const chunks = chunkKnowledgeDocument({ id: row.document_id, title: row.title, content: row.content })
      for (const text of embeddingTextsOf({ documentId: row.document_id, documentTitle: row.title, versionId: row.version_id, chunks }, { cardTitle: row.registered_title, products: row.products })) hashes.add(text.hash)
      if (jargon.length > 0) for (const text of embeddingTextsOf({ documentId: row.document_id, documentTitle: row.title, versionId: row.version_id, chunks }, { cardTitle: row.registered_title, products: row.products, jargon })) hashes.add(text.hash)
    }
    if (rows.length < VERSION_PAGE) break
    after = rows.at(-1)!.document_id
  }
  // Cartão das outras versões publicadas (motor de feedback na data da chamada), pelo mesmo cálculo da busca.
  let afterVersion = "00000000-0000-0000-0000-000000000000"
  for (;;) {
    const rows = (await db.query<OlderRow>(
      `select kd.id document_id, kd.title registered_title, kv.id version_id, kv.content, ${knowledgeProductsSql("kd.id", "kd.organization_id")} products
         from knowledge_versions kv
         join knowledge_documents kd on kd.id = kv.document_id
        where kd.organization_id = $1 and kd.deleted_at is null and kv.status = 'PUBLISHED' and kv.id > $2
        order by kv.id
        limit ${VERSION_PAGE}`,
      [organizationId, afterVersion],
    )).rows
    for (const row of rows) {
      const chunks = chunkKnowledgeDocument({ id: row.document_id, title: row.registered_title, content: row.content })
      hashes.add(contentHashOf(documentCardText({ documentId: row.document_id, documentTitle: row.registered_title, versionId: row.version_id, chunks }, row.products)))
    }
    if (rows.length < VERSION_PAGE) break
    afterVersion = rows.at(-1)!.version_id
  }
  return { hashes, liveVersionIds }
}

/**
 * Um passo da limpeza da organização. `modelKey` = modelo atual da policy (sem policy, quem chama não chama: sem modelo não há como saber o
 * que é referenciado, e nada é apagado). Devolve quantos vetores saíram nesta rodada.
 */
export async function collectKnowledgeEmbeddingGarbage(db: Database, organizationId: string, modelKey: string, now: Date, options: KnowledgeEmbeddingGcOptions = {}): Promise<number> {
  const intervalMs = options.intervalMs ?? DEFAULT_GC_INTERVAL_MS
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const maxDeletes = options.maxDeletesPerRun ?? DEFAULT_MAX_DELETES
  const maxPages = options.maxPagesPerRun ?? DEFAULT_MAX_PAGES
  let state = passes.get(organizationId)
  if (state && state.modelKey !== modelKey) state = undefined
  if (state?.finishedAt) {
    if (now.getTime() - state.finishedAt.getTime() < intervalMs) return 0
    state = undefined
  }
  if (!state) {
    const graceMs = options.otherModelGraceMs ?? DEFAULT_OTHER_MODEL_GRACE_MS
    const models = (await db.query<{ model_key: string; last_indexed_at: Date }>(`select model_key, max(updated_at) last_indexed_at from knowledge_embedding_index where organization_id = $1 group by model_key`, [organizationId])).rows
    const preservedModels = new Set(models.filter((row) => row.model_key !== modelKey && now.getTime() - new Date(row.last_indexed_at).getTime() < graceMs).map((row) => row.model_key))
    const { hashes, liveVersionIds } = await referencedKnowledgeHashes(db, organizationId, options.jargon ?? [])
    await db.query(
      `delete from knowledge_embedding_index where organization_id = $1 and not (model_key = any($4::text[])) and (model_key <> $2 or not (version_id = any($3::uuid[])))`,
      [organizationId, modelKey, liveVersionIds, [...preservedModels]],
    )
    state = { modelKey, startedAt: now, referenced: hashes, preservedModels, cursor: null, finishedAt: null }
    passes.set(organizationId, state)
  }
  // Alguma indexação gravou depois do início da passada (outro processo, base restaurada…): o conjunto pode estar velho — recomeça depois.
  const changed = (await db.query<{ changed: boolean }>(`select exists (select 1 from knowledge_embedding_index where organization_id = $1 and updated_at > $2) changed`, [organizationId, state.startedAt])).rows[0]?.changed
  if (changed) {
    passes.delete(organizationId)
    return 0
  }
  let deleted = 0
  for (let page = 0; page < maxPages && deleted < maxDeletes; page++) {
    const cursor = state.cursor
    const rows = (await db.query<{ model_key: string; content_hash: string; created_at: Date }>(
      `select model_key, content_hash, created_at from knowledge_embedding_vectors
        where organization_id = $1 ${cursor ? "and (model_key, content_hash) > ($3, $4)" : ""}
        order by model_key, content_hash
        limit $2`,
      cursor ? [organizationId, pageSize, cursor.modelKey, cursor.hash] : [organizationId, pageSize],
    )).rows
    const referenced = state.referenced!
    const preserved = state.preservedModels
    const garbage = rows.filter((row) => new Date(row.created_at).getTime() < state!.startedAt.getTime() && !preserved.has(row.model_key) && (row.model_key !== modelKey || !referenced.has(row.content_hash))).slice(0, maxDeletes - deleted)
    if (garbage.length > 0) {
      const result = await db.query(
        `delete from knowledge_embedding_vectors v
          using unnest($2::text[], $3::text[]) as g(model_key, content_hash)
          where v.organization_id = $1 and v.model_key = g.model_key and v.content_hash = g.content_hash and v.created_at < $4`,
        [organizationId, garbage.map((row) => row.model_key), garbage.map((row) => row.content_hash), state.startedAt],
      )
      deleted += (result as { rowCount?: number | null }).rowCount ?? garbage.length
    }
    // Parou no teto de exclusões no meio da página: a próxima rodada continua do último apagado (o resto da página é reexaminado).
    const last = garbage.length > 0 && deleted >= maxDeletes ? garbage.at(-1)! : rows.at(-1)
    if (last) state.cursor = { modelKey: last.model_key, hash: last.content_hash }
    if (rows.length < pageSize && !(deleted >= maxDeletes && garbage.length > 0)) {
      state.finishedAt = now
      state.referenced = null
      break
    }
  }
  if (deleted > 0) console.info(JSON.stringify({ event: "knowledge_embedding_vectors_collected", organizationId, modelKey, deleted, finished: Boolean(state.finishedAt) }))
  return deleted
}
