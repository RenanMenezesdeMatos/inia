/**
 * Vetores de embedding SEM extensão no PostgreSQL: guardados como bytea (float32 little-endian) e comparados na aplicação. Todo vetor é
 * normalizado (norma 1) ao ser guardado e ao chegar da pergunta, então a similaridade de cosseno vira um produto escalar. Puro.
 */

/** Cópia com norma 1. Vetor nulo (todos zero) ou com valor não finito = null: nunca entra no índice. */
export function normalized(vector: Float32Array): Float32Array | null {
  let sum = 0
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index]!
    if (!Number.isFinite(value)) return null
    sum += value * value
  }
  if (sum === 0) return null
  const norm = Math.sqrt(sum)
  const out = new Float32Array(vector.length)
  for (let index = 0; index < vector.length; index += 1) out[index] = vector[index]! / norm
  return out
}

export function encodeVector(vector: Float32Array): Buffer {
  const buffer = Buffer.alloc(vector.length * 4)
  for (let index = 0; index < vector.length; index += 1) buffer.writeFloatLE(vector[index]!, index * 4)
  return buffer
}

export function decodeVector(buffer: Buffer): Float32Array {
  const vector = new Float32Array(Math.floor(buffer.length / 4))
  for (let index = 0; index < vector.length; index += 1) vector[index] = buffer.readFloatLE(index * 4)
  return vector
}

/** Produto escalar (= cosseno entre vetores normalizados). Dimensões diferentes = null (modelo trocado): nunca uma nota inventada. */
export function dot(left: Float32Array, right: Float32Array): number | null {
  if (left.length !== right.length) return null
  let sum = 0
  for (let index = 0; index < left.length; index += 1) sum += left[index]! * right[index]!
  return sum
}

/** Os `limit` itens mais parecidos com a pergunta, do mais para o menos parecido (empate: ordem de entrada). */
export function nearest<T>(query: Float32Array, items: readonly { item: T; vector: Float32Array }[], limit: number): { item: T; similarity: number }[] {
  const scored: { item: T; similarity: number; order: number }[] = []
  items.forEach(({ item, vector }, order) => {
    const similarity = dot(query, vector)
    if (similarity !== null) scored.push({ item, similarity, order })
  })
  scored.sort((left, right) => right.similarity - left.similarity || left.order - right.order)
  return scored.slice(0, Math.max(0, limit)).map(({ item, similarity }) => ({ item, similarity }))
}
