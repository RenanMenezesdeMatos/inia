/**
 * `Promise.all(items.map(fn))` com no máximo `limit` chamadas em andamento ao mesmo tempo.
 *
 * Existe para leituras por item que pegam uma conexão do pool (avaliação por colaborador, resumo por unidade): com
 * `Promise.all` puro, 2.000 itens disparam milhares de consultas de uma vez num pool de 20 conexões e quem espera mais que
 * `connectionTimeoutMillis` falha — inclusive o trabalho de outras pessoas no mesmo processo.
 *
 * Mesmo contrato do `Promise.all`: resultados na ordem dos itens; a primeira falha rejeita (e nenhum item novo começa depois
 * dela; os que já estavam em andamento terminam sozinhos).
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`limit deve ser um inteiro >= 1 (recebido ${limit})`)
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++
      try {
        results[index] = await fn(items[index] as T, index)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
