/**
 * BUSCA NAS BASES EM ESCALA: junção de rankings por posição (Reciprocal Rank Fusion, Cormack et al., 2009).
 * Usa só a posição de cada lista, então a nota do texto e a distância do vetor não precisam estar na mesma escala. É a junção indicada pela
 * documentação do pgvector para busca híbrida. Puro, sem banco e sem nenhuma lista de palavras.
 */
export const DEFAULT_RRF_K = 60

export type RankedKey = { key: string }
export type FusedKey = { key: string; score: number; ranks: Record<string, number> }

export function reciprocalRankFusion(lists: Readonly<Record<string, readonly RankedKey[]>>, options: { k?: number; weights?: Readonly<Record<string, number>> } = {}): FusedKey[] {
  const k = options.k ?? DEFAULT_RRF_K
  const fused = new Map<string, FusedKey>()
  for (const [name, list] of Object.entries(lists)) {
    const weight = options.weights?.[name] ?? 1
    const seen = new Set<string>()
    let rank = 0
    for (const { key } of list) {
      // Repetição na mesma lista conta só a melhor posição.
      if (seen.has(key)) continue
      seen.add(key)
      rank += 1
      const entry = fused.get(key) ?? { key, score: 0, ranks: {} }
      entry.score += weight / (k + rank)
      entry.ranks[name] = rank
      fused.set(key, entry)
    }
  }
  return [...fused.values()].sort((left, right) => right.score - left.score || left.key.localeCompare(right.key))
}
