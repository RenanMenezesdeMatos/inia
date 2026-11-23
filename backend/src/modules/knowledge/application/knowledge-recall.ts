import type { Database } from "../../../infrastructure/database/pool.js"
import { embedKnowledgeTexts, knowledgeEmbeddingModel } from "../../../shared/application/model-routing/embedding-gateway.js"
import { AiCallCancelledError } from "../../../shared/application/model-routing/ai-errors.js"
import { currentAiAbortSignal } from "../../../shared/application/model-routing/ai-runtime.js"
import { embeddingText } from "../../ai-management/domain/ai-embedding.js"
import { embeddingTextsOf, type EmbeddingText } from "../domain/embedding-texts.js"
import { DEFAULT_LIST_DEPTH, DEFAULT_RECALL_LIMIT, HYBRID_RECALL_VERSION, documentOrderOf, fuseRecall, type FusionOptions, type RecalledChunk, type RecallKey } from "../domain/hybrid-recall.js"
import { ByteBoundedLru, megabytesFromEnv } from "../domain/byte-bounded-lru.js"
import { sectionStartsOf, type CatalogSource } from "../domain/knowledge-catalog.js"
import { chunkKnowledgeDocument } from "../domain/knowledge-chunking.js"
import { buildKnowledgeIndex, rankChunks, type KnowledgeIndex } from "../domain/lexical-retrieval.js"
import { nearest, normalized } from "../domain/vector-math.js"
import { expandAcronyms, type GlossaryAcronym } from "../domain/query-acronyms.js"
import { loadKnowledgeVectors } from "./knowledge-vector-store.js"
import { loadKnowledgeProducts } from "./knowledge-products.js"
import { knowledgeGlossaryJargonEnabled, loadGlossaryJargonRules } from "./knowledge-glossary-jargon.js"
import { jargonKeyOf, type JargonRule } from "../domain/glossary-jargon.js"

/**
 * BUSCA NAS BASES EM ESCALA — camadas 2 e 4 (`docs/dev/memoria/agentes-e-conhecimento.md`, "busca nas bases em escala"):
 *   - recebe só as bases que JÁ passaram pelo filtro exato de escopo (camada 1: vinculadas aos Agents, alcance do Grupo, acesso de quem
 *     pergunta, versão vigente publicada — `knowledge-catalog.ts`, `retrieve-knowledge.ts`); nunca amplia o escopo;
 *   - devolve ~40 trechos candidatos = BM25 de sempre ∪ vetor (RRF). Sem policy de embedding, ou com a versão ainda não indexada, o vetor
 *     simplesmente não contribui e o resultado é o do BM25 — nunca uma falha da pergunta;
 *   - para o motor de feedback, ordena os DOCUMENTOS pelo cartão (camada 4: achar qual procedimento; o motor lê o procedimento inteiro).
 * Ligada por padrão (decisão de 16/11/2026); `INIA_KB_SCALE_RETRIEVAL=off` desliga e tudo volta exatamente ao caminho anterior.
 */
export function knowledgeScaleRetrievalEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.INIA_KB_SCALE_RETRIEVAL?.trim().toLowerCase()
  return !(value === "off" || value === "false" || value === "0")
}

/** Espera máxima pelo vetor da pergunta no chat: passou disso, esta pergunta segue só com o BM25 (o chat nunca espera o embedding). */
export function queryEmbeddingTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.INIA_KB_QUERY_EMBEDDING_TIMEOUT_MS ?? 2_500)
  return Number.isFinite(value) && value > 0 ? value : 2_500
}

export type QueryEmbedding = { modelKey: string; vector: Float32Array; ms: number }

export type KnowledgeRecallTrace = {
  version: typeof HYBRID_RECALL_VERSION
  /** HYBRID = BM25 ∪ vetor; LEXICAL = só BM25 (sem policy, vetor da pergunta indisponível ou nenhuma versão indexada). */
  mode: "HYBRID" | "LEXICAL"
  modelKey: string | null
  candidates: number
  /** Trechos no escopo e quantos deles já têm vetor do modelo atual (cobertura do índice). */
  scopeChunks: number
  indexedChunks: number
  embeddingMs: number | null
  searchMs: number
  /** Motivo de o vetor não ter contribuído (sem conteúdo nem segredo). */
  vectorSkipped?: "NO_POLICY" | "QUERY_UNAVAILABLE" | "NOT_INDEXED" | "FAILED"
}

export type KnowledgeRecallResult = { recalled: RecalledChunk[]; documentOrder: string[]; trace: KnowledgeRecallTrace }

export type KnowledgeRecallDeps = {
  /** Tetos dos caches por processo (padrão: `INIA_KB_RECALL_TEXT_CACHE_MB` = 128 e `INIA_KB_RECALL_INDEX_CACHE_MB` = 256). */
  cacheLimits?: { textBytes?: number; indexBytes?: number }
  embeddingModel: (organizationId: string) => Promise<string | null>
  embedQuery: (input: { organizationId: string; text: string; modelKey: string; source: "CHAT" | "AGENT" }) => Promise<Float32Array | null>
  loadVectors: (organizationId: string, modelKey: string, hashes: readonly string[]) => Promise<Map<string, Float32Array>>
  timeoutMs?: number
  clock?: () => number
  /** Como juntar texto e vetor (padrão: `DEFAULT_FUSION`). */
  fusion?: FusionOptions
  /** Trechos do vetor lidos antes da junção (a profundidade da junção corta depois). */
  vectorDepth?: number
  /** Produtos cadastrados das bases ("Família › Produto; …"), que entram no texto do vetor. Ausente = sem produto (texto de antes). */
  products?: (organizationId: string, documentIds: readonly string[]) => Promise<Map<string, string>>
  /** Siglas do Glossário da organização: a definição entra na consulta (texto e vetor) quando a sigla está na pergunta (`query-acronyms.ts`). */
  acronyms?: (organizationId: string) => Promise<GlossaryAcronym[]>
  /**
   * Gíria do Glossário no texto do vetor (`domain/glossary-jargon.ts`, interruptor `INIA_KB_GLOSSARY_JARGON_VECTORS`, desligado por padrão).
   * Ausente = vetores sem gíria, exatamente como antes. Presente: o trecho que cita o termo oficial é procurado pelo vetor COM a gíria e,
   * enquanto a indexação não o gerou, pelo vetor sem a gíria.
   */
  jargon?: (organizationId: string) => Promise<JargonRule[]>
}

/**
 * Padrão da busca em escala, escolhido pela avaliação de 16/11/2026 (docs/dev/busca-em-escala, 41 seções em 2 gabaritos, 3 modelos, 58 e 1058
 * bases): candidatos por SEÇÃO (o que a IA lê), listas INTERCALADAS (1º do vetor, 1º do texto, 2º do vetor…) e 60 candidatos. Com o
 * Gemini, as seções que já chegam lidas à IA passaram de 34–35 para 37 de 41, e as que estão entre os candidatos, de 38–39 para 39–41.
 */
export const DEFAULT_FUSION: FusionOptions = { unit: "SECTION", method: "INTERLEAVE", limit: 60 }

const MAX_CACHED_QUERIES = 500
const DOCUMENT_RANKING_TIMEOUT_MS = 60_000
const MAX_CACHED_VERSIONS = 4_000
const MAX_CACHED_INDEXES = 64
/**
 * Tetos em BYTES (aproximados pelo tamanho dos textos) dos caches por processo, além do teto por quantidade: com bases grandes, 4 mil
 * versões ou 64 índices podiam ocupar a memória da API inteira. Passou do teto, sai o usado há mais tempo (LRU) e é refeito quando voltar.
 */
export const DEFAULT_TEXT_CACHE_MB = 128
export const DEFAULT_INDEX_CACHE_MB = 256
/** Bytes por caractere do índice BM25: o texto do trecho (UTF-16) + o mapa de termos (≈ 10 bytes por caractere, medido por estimativa). */
const INDEX_BYTES_PER_CHAR = 12

export function textsCacheBytes(texts: readonly EmbeddingText[]): number {
  return texts.reduce((sum, text) => sum + (text.text.length + text.key.length + text.hash.length + text.documentId.length) * 2 + 64, 0)
}

export function lexicalIndexBytes(index: KnowledgeIndex): number {
  return index.chunks.reduce((sum, chunk) => sum + (chunk.text.length + chunk.heading.length) * INDEX_BYTES_PER_CHAR + 128, 0)
}
/** Produtos e siglas mudam pela tela: relidos depois deste tempo. */
const METADATA_TTL_MS = 60_000

export function createKnowledgeRecall(deps: KnowledgeRecallDeps) {
  const clock = deps.clock ?? (() => performance.now())
  const queries = new Map<string, Float32Array>()
  const textsByVersion = new ByteBoundedLru<string, EmbeddingText[]>({ maxEntries: MAX_CACHED_VERSIONS, maxBytes: () => deps.cacheLimits?.textBytes ?? megabytesFromEnv(process.env.INIA_KB_RECALL_TEXT_CACHE_MB, DEFAULT_TEXT_CACHE_MB), sizeOf: textsCacheBytes })
  const indexes = new ByteBoundedLru<string, KnowledgeIndex>({ maxEntries: MAX_CACHED_INDEXES, maxBytes: () => deps.cacheLimits?.indexBytes ?? megabytesFromEnv(process.env.INIA_KB_RECALL_INDEX_CACHE_MB, DEFAULT_INDEX_CACHE_MB), sizeOf: lexicalIndexBytes })

  const touch = <K, V>(map: Map<K, V>, key: K, value: V, limit: number) => {
    map.delete(key)
    map.set(key, value)
    while (map.size > limit) map.delete(map.keys().next().value as K)
  }

  const productCache = new Map<string, { at: number; value: string | null }>()
  const acronymCache = new Map<string, { at: number; value: GlossaryAcronym[] }>()
  const jargonCache = new Map<string, { at: number; value: { rules: JargonRule[]; key: string | null } }>()

  async function jargonOf(organizationId: string): Promise<{ rules: JargonRule[]; key: string | null }> {
    if (!deps.jargon) return { rules: [], key: null }
    const cached = jargonCache.get(organizationId)
    if (cached && Date.now() - cached.at <= METADATA_TTL_MS) return cached.value
    const rules = await deps.jargon(organizationId).catch(() => [] as JargonRule[])
    const value = { rules, key: jargonKeyOf(rules) }
    jargonCache.set(organizationId, { at: Date.now(), value })
    return value
  }

  async function productsOf(organizationId: string, documentIds: readonly string[]): Promise<Map<string, string>> {
    if (!deps.products) return new Map()
    const now = Date.now()
    const missing = documentIds.filter((id) => {
      const cached = productCache.get(`${organizationId}|${id}`)
      return !cached || now - cached.at > METADATA_TTL_MS
    })
    if (missing.length > 0) {
      const loaded = await deps.products(organizationId, missing)
      for (const id of missing) productCache.set(`${organizationId}|${id}`, { at: now, value: loaded.get(id) ?? null })
      while (productCache.size > 20_000) productCache.delete(productCache.keys().next().value as string)
    }
    return new Map(documentIds.flatMap((id) => {
      const value = productCache.get(`${organizationId}|${id}`)?.value
      return value ? [[id, value] as const] : []
    }))
  }

  /** A consulta de busca: a pergunta + a definição das siglas do Glossário que aparecem nela (nenhuma sigla = a pergunta como veio). */
  async function searchQueryOf(organizationId: string, question: string): Promise<string> {
    if (!deps.acronyms) return question
    const cached = acronymCache.get(organizationId)
    let acronyms = cached && Date.now() - cached.at <= METADATA_TTL_MS ? cached.value : null
    if (!acronyms) {
      acronyms = await deps.acronyms(organizationId).catch(() => [])
      acronymCache.set(organizationId, { at: Date.now(), value: acronyms })
    }
    return expandAcronyms(question, acronyms).searchQuery
  }

  function textsOf(source: CatalogSource, products?: string | null, jargon?: { rules: JargonRule[]; key: string | null }): EmbeddingText[] {
    const key = `${source.documentId}|${source.versionId}|${source.documentTitle}|${products ?? ""}|${jargon?.key ?? ""}`
    const cached = textsByVersion.get(key)
    if (cached) return cached
    const texts = embeddingTextsOf(source, { products: products ?? null, ...(jargon?.key ? { jargon: jargon.rules } : {}) })
    textsByVersion.set(key, texts)
    return texts
  }

  function lexicalIndexOf(sources: readonly CatalogSource[]): KnowledgeIndex {
    const key = sources.map((source) => `${source.documentId}|${source.versionId}`).sort().join(",")
    const cached = indexes.get(key)
    if (cached) return cached
    const index = buildKnowledgeIndex(sources.flatMap((source) => source.chunks))
    indexes.set(key, index)
    return index
  }

  /**
   * Começa a gerar o vetor da pergunta JÁ (em paralelo com a leitura das bases). Nunca rejeita: sem policy, falha ou demora acima do teto
   * = null, e a pergunta segue só com o BM25. Cancelamento (quem perguntou saiu) também vira null — quem chamou trata o próprio cancelamento.
   */
  async function startQuery(organizationId: string, text: string, source: "CHAT" | "AGENT" = "CHAT", timeoutOverrideMs?: number): Promise<QueryEmbedding | null | "NO_POLICY"> {
    const started = clock()
    try {
      const modelKey = await deps.embeddingModel(organizationId)
      if (!modelKey) return "NO_POLICY"
      const prepared = embeddingText((await searchQueryOf(organizationId, text)).trim())
      if (!prepared) return null
      const cacheKey = `${organizationId}|${modelKey}|${source}|${prepared}`
      const cached = queries.get(cacheKey)
      if (cached) {
        touch(queries, cacheKey, cached, MAX_CACHED_QUERIES)
        return { modelKey, vector: cached, ms: Math.round(clock() - started) }
      }
      const pending = deps.embedQuery({ organizationId, text: prepared, modelKey, source }).then((vector) => {
        const unit = vector ? normalized(vector) : null
        if (unit) touch(queries, cacheKey, unit, MAX_CACHED_QUERIES)
        return unit
      })
      pending.catch(() => undefined)
      const timeoutMs = timeoutOverrideMs ?? deps.timeoutMs ?? queryEmbeddingTimeoutMs()
      let timer: NodeJS.Timeout | undefined
      const vector = await Promise.race([pending, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs) })]).finally(() => clearTimeout(timer))
      return vector ? { modelKey, vector, ms: Math.round(clock() - started) } : null
    } catch (error) {
      if (!(error instanceof AiCallCancelledError) && !currentAiAbortSignal()?.aborted) console.warn(JSON.stringify({ event: "knowledge_query_embedding_failed", name: (error as Error)?.name, category: (error as { category?: string })?.category ?? null }))
      return null
    }
  }

  /** Camada 2: candidatos do escopo recebido. `query` = o que `startQuery` devolveu (pode ainda estar em andamento). */
  async function recall(input: { organizationId: string; question: string; sources: readonly CatalogSource[]; query?: Promise<QueryEmbedding | null | "NO_POLICY"> | null; limit?: number }): Promise<KnowledgeRecallResult> {
    const started = clock()
    const lexical: RecallKey[] = rankChunks(await searchQueryOf(input.organizationId, input.question), lexicalIndexOf(input.sources)).map((chunk) => ({ documentId: chunk.documentId, chunkIndex: chunk.index }))
    const scopeChunks = input.sources.reduce((sum, source) => sum + source.chunks.length, 0)
    const query = input.query ? await input.query : "NO_POLICY"
    let vector: RecallKey[] = []
    let indexedChunks = 0
    let vectorSkipped: KnowledgeRecallTrace["vectorSkipped"]
    if (query === "NO_POLICY") vectorSkipped = "NO_POLICY"
    else if (!query) vectorSkipped = "QUERY_UNAVAILABLE"
    else {
      try {
        // A lista do chat já traz o produto de cada base; quem não traz (motor de feedback) busca pelo cadastro.
        const products = await productsOf(input.organizationId, input.sources.filter((source) => source.products === undefined).map((source) => source.documentId))
        const jargon = await jargonOf(input.organizationId)
        const productOf = (source: CatalogSource) => (source.products !== undefined ? source.products : products.get(source.documentId))
        // Com a gíria ligada, cada trecho tem o hash com gíria e o sem gíria (reserva enquanto a indexação não chega); iguais quando
        // o trecho não cita nenhum termo oficial.
        const chunkTexts = input.sources.flatMap((source) => {
          const plain = textsOf(source, productOf(source)).filter((text) => text.kind === "CHUNK")
          if (!jargon.key) return plain.map((text) => ({ text, fallback: null as string | null }))
          const enriched = textsOf(source, productOf(source), jargon).filter((text) => text.kind === "CHUNK")
          return enriched.map((text, index) => ({ text, fallback: plain[index] && plain[index]!.hash !== text.hash ? plain[index]!.hash : null }))
        })
        const vectors = await deps.loadVectors(input.organizationId, query.modelKey, [...new Set(chunkTexts.flatMap(({ text, fallback }) => (fallback ? [text.hash, fallback] : [text.hash])))])
        const items = chunkTexts.flatMap(({ text, fallback }) => {
          const found = vectors.get(text.hash) ?? (fallback ? vectors.get(fallback) : undefined)
          return found ? [{ item: { documentId: text.documentId, chunkIndex: text.chunkIndex! }, vector: found }] : []
        })
        indexedChunks = items.length
        if (items.length === 0) vectorSkipped = "NOT_INDEXED"
        vector = nearest(query.vector, items, deps.vectorDepth ?? Math.max(DEFAULT_LIST_DEPTH, (deps.fusion?.depth ?? DEFAULT_LIST_DEPTH) * 3)).map((hit) => hit.item)
      } catch (error) {
        console.warn(JSON.stringify({ event: "knowledge_vector_search_failed", name: (error as Error)?.name }))
        vectorSkipped = "FAILED"
        vector = []
      }
    }
    const fusion = deps.fusion ?? DEFAULT_FUSION
    const starts = fusion.unit === "SECTION" ? new Map(input.sources.map((source) => [source.documentId, sectionStartsOf(source)])) : null
    const recalled = fuseRecall({ lexical, vector, ...fusion, limit: input.limit ?? fusion.limit ?? DEFAULT_RECALL_LIMIT, ...(starts ? { sectionOf: (item: RecallKey) => starts.get(item.documentId)?.get(item.chunkIndex) ?? item.chunkIndex } : {}) })
    return {
      recalled,
      documentOrder: documentOrderOf(recalled),
      trace: { version: HYBRID_RECALL_VERSION, mode: vector.length > 0 ? "HYBRID" : "LEXICAL", modelKey: query && query !== "NO_POLICY" ? query.modelKey : null, candidates: recalled.length, scopeChunks, indexedChunks, embeddingMs: query && query !== "NO_POLICY" ? query.ms : null, searchMs: Math.round((clock() - started) * 10) / 10, ...(vectorSkipped ? { vectorSkipped } : {}) },
    }
  }

  /**
   * Camada 4 (motor de feedback): ordem dos DOCUMENTOS pelo cartão de cada um (título, tipo e sumário) contra o assunto e a conversa.
   * null = o vetor não pode ajudar agora (sem policy, falha, nada indexado) — o motor segue com a ordem de sempre.
   */
  async function rankDocuments(input: { organizationId: string; query: string; sources: readonly CatalogSource[] }): Promise<{ order: string[]; trace: { modelKey: string; indexedCards: number; cards: number } } | null> {
    // Lote (motor de feedback): ninguém esperando na tela, a espera pelo vetor é a do provider.
    const query = await startQuery(input.organizationId, input.query, "AGENT", DOCUMENT_RANKING_TIMEOUT_MS)
    if (!query || query === "NO_POLICY") return null
    try {
      const products = await productsOf(input.organizationId, input.sources.map((source) => source.documentId))
      const cards = input.sources.map((source) => textsOf(source, products.get(source.documentId)).find((text) => text.kind === "CARD")!)
      const vectors = await deps.loadVectors(input.organizationId, query.modelKey, cards.map((card) => card.hash))
      const items = cards.flatMap((card) => {
        const found = vectors.get(card.hash)
        return found ? [{ item: card.documentId, vector: found }] : []
      })
      if (items.length === 0) return null
      return { order: nearest(query.vector, items, items.length).map((hit) => hit.item), trace: { modelKey: query.modelKey, indexedCards: items.length, cards: cards.length } }
    } catch (error) {
      console.warn(JSON.stringify({ event: "knowledge_card_search_failed", name: (error as Error)?.name }))
      return null
    }
  }

  /** Tamanho dos caches agora (para teste e diagnóstico). */
  const cacheStats = () => ({ versions: textsByVersion.size, textBytes: textsByVersion.bytes, indexes: indexes.size, indexBytes: indexes.bytes })

  return { startQuery, recall, rankDocuments, cacheStats }
}

export type KnowledgeRecall = ReturnType<typeof createKnowledgeRecall>

/** A busca com o banco da INIA e o modelo da policy da organização. */
export function postgresKnowledgeRecall(db: Database): KnowledgeRecall {
  return createKnowledgeRecall({
    embeddingModel: knowledgeEmbeddingModel,
    embedQuery: async ({ organizationId, text, modelKey, source }) => (await embedKnowledgeTexts({ organizationId, texts: [text], purpose: "QUERY", modelKey, stage: "QUERY", source }))?.[0] ?? null,
    loadVectors: (organizationId, modelKey, hashes) => loadKnowledgeVectors(db, organizationId, modelKey, hashes),
    products: (organizationId, documentIds) => loadKnowledgeProducts(db, organizationId, documentIds),
    // Gíria do Glossário no vetor: desligada por padrão (`INIA_KB_GLOSSARY_JARGON_VECTORS=on` liga; reinicie a API e o processamento).
    ...(knowledgeGlossaryJargonEnabled() ? { jargon: (organizationId: string) => loadGlossaryJargonRules(db, organizationId) } : {}),
    // Siglas do Glossário na consulta: medidas em 16/11/2026 sem ganho (e 2 seções a menos entre os candidatos) — não ligadas. A
    // capacidade fica (`acronyms`), o Glossário continua indo inteiro para a IA no esclarecimento.
  })
}

const shared = new WeakMap<object, KnowledgeRecall>()

/** Uma instância por banco no processo (os caches de vetor da pergunta, textos por versão e índice de texto são compartilhados). */
export function sharedKnowledgeRecall(db: Database): KnowledgeRecall {
  let recall = shared.get(db)
  if (!recall) {
    recall = postgresKnowledgeRecall(db)
    shared.set(db, recall)
  }
  return recall
}

/** Camada 4 com os documentos do motor de feedback (conteúdo inteiro da versão em vigor na data da chamada). */
export function rankCandidateDocumentsByCard(db: Database) {
  return async (organizationId: string, query: string, documents: readonly { documentId: string; title: string; version: number; content: string }[]): Promise<string[] | null> => {
    if (!knowledgeScaleRetrievalEnabled() || documents.length === 0) return null
    const sources: CatalogSource[] = documents.map((document) => ({ documentId: document.documentId, documentTitle: document.title, versionId: `${document.documentId}@${document.version}`, documentType: null, chunks: chunkKnowledgeDocument({ id: document.documentId, title: document.title, content: document.content }) }))
    const ranked = await sharedKnowledgeRecall(db).rankDocuments({ organizationId, query, sources })
    return ranked?.order ?? null
  }
}
