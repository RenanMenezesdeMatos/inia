import { reciprocalRankFusion } from "./rank-fusion.js"

/**
 * CAMADA 2 DA BUSCA EM ESCALA — candidatos com foco em COBERTURA: a união do índice de texto (BM25 de sempre, `lexical-retrieval.ts`:
 * termos exatos, códigos, números) com o vetor (significado, sinônimo, paráfrase), juntados pela posição (RRF). O objetivo não é
 * acertar de primeira, é não perder o trecho necessário: quem decide o que se aplica é a IA (camada 3), sobre estes candidatos. Puro.
 */
export const HYBRID_RECALL_VERSION = "HYBRID_RECALL_V2" as const

/** Candidatos por pergunta (o desenho pede ~30 a 50). */
export const DEFAULT_RECALL_LIMIT = 40
/** Posições lidas de cada lista antes da junção (a mais, para a união não ficar presa no topo de uma só). */
export const DEFAULT_LIST_DEPTH = 60

export type RecallKey = { documentId: string; chunkIndex: number }
export type RecalledChunk = RecallKey & { score: number; lexicalRank: number | null; vectorRank: number | null }

const keyOf = (item: RecallKey) => `${item.documentId}#${item.chunkIndex}`

/**
 * `unit`: CHUNK = cada trecho disputa uma vaga; SECTION = cada lista é reduzida à melhor posição de cada SEÇÃO antes da junção (a seção é
 * o que a IA lê — três partes da mesma seção não gastam três vagas). `sectionOf` dá o início da seção de um trecho (obrigatório em SECTION).
 * `vectorWeight`: peso da lista do vetor na junção (1 = igual ao texto).
 */
export type FusionOptions = { limit?: number; depth?: number; unit?: "CHUNK" | "SECTION"; vectorWeight?: number; /** RRF (padrão) ou INTERLEAVE: 1º do vetor, 1º do texto, 2º do vetor… (sem repetir). */ method?: "RRF" | "INTERLEAVE" }

export function fuseRecall(input: { lexical: readonly RecallKey[]; vector: readonly RecallKey[]; sectionOf?: (item: RecallKey) => number } & FusionOptions): RecalledChunk[] {
  const depth = input.depth ?? DEFAULT_LIST_DEPTH
  const bySection = input.unit === "SECTION" && input.sectionOf
  const reduce = (list: readonly RecallKey[]): RecallKey[] => {
    if (!bySection) return list.slice(0, depth)
    const seen = new Set<string>()
    const out: RecallKey[] = []
    for (const item of list) {
      const section = { documentId: item.documentId, chunkIndex: input.sectionOf!(item) }
      const key = keyOf(section)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(section)
      if (out.length >= depth) break
    }
    return out
  }
  const lexical = reduce(input.lexical)
  const vector = reduce(input.vector)
  const byKey = new Map<string, RecallKey>()
  for (const item of [...lexical, ...vector]) byKey.set(keyOf(item), item)
  const fused = input.method === "INTERLEAVE" ? interleave(lexical, vector) : reciprocalRankFusion({ lexical: lexical.map((item) => ({ key: keyOf(item) })), vector: vector.map((item) => ({ key: keyOf(item) })) }, { weights: { lexical: 1, vector: input.vectorWeight ?? 1 } })
  return fused.slice(0, input.limit ?? DEFAULT_RECALL_LIMIT).map((entry) => {
    const item = byKey.get(entry.key)!
    return { documentId: item.documentId, chunkIndex: item.chunkIndex, score: entry.score, lexicalRank: entry.ranks.lexical ?? null, vectorRank: entry.ranks.vector ?? null }
  })
}

/** As duas listas alternadas (vetor primeiro), cada item uma vez, com a posição em cada lista. */
function interleave(lexical: readonly RecallKey[], vector: readonly RecallKey[]): { key: string; score: number; ranks: Record<string, number> }[] {
  const lexicalRank = new Map(lexical.map((item, index) => [keyOf(item), index + 1]))
  const vectorRank = new Map(vector.map((item, index) => [keyOf(item), index + 1]))
  const out: { key: string; score: number; ranks: Record<string, number> }[] = []
  const seen = new Set<string>()
  for (let index = 0; index < Math.max(lexical.length, vector.length); index += 1) {
    for (const item of [vector[index], lexical[index]]) {
      if (!item) continue
      const key = keyOf(item)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ key, score: 1 / (out.length + 1), ranks: { ...(lexicalRank.has(key) ? { lexical: lexicalRank.get(key)! } : {}), ...(vectorRank.has(key) ? { vector: vectorRank.get(key)! } : {}) } })
    }
  }
  return out
}

/** Ordem das bases pelos candidatos (a melhor posição de cada base); as sem candidato não entram. */
export function documentOrderOf(recalled: readonly RecalledChunk[]): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  for (const chunk of recalled) {
    if (seen.has(chunk.documentId)) continue
    seen.add(chunk.documentId)
    order.push(chunk.documentId)
  }
  return order
}
