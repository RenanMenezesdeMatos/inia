import { decodeVector, encodeVector, normalized } from "../domain/vector-math.js"

/**
 * Vetores das bases no PostgreSQL da INIA, sem extensão (`knowledge_embedding_vectors`, migration 200), com cache em memória por hash.
 * Uma versão publicada não muda, e o hash é do texto: o vetor guardado nunca fica velho — o cache só precisa de limite de tamanho.
 */
type Queryable = { query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }> }

const QUERY_BATCH = 2_000
/** Hash sem vetor (versão ainda não indexada) não é consultado de novo por este tempo. */
const MISSING_TTL_MS = 60_000

function cacheLimitFloats(): number {
  const megabytes = Number(process.env.INIA_KB_VECTOR_CACHE_MB ?? 128)
  return Math.max(1, Number.isFinite(megabytes) ? megabytes : 128) * 262_144
}

const cache = new Map<string, Float32Array>()
let cachedFloats = 0
const missing = new Map<string, number>()

const cacheKey = (organizationId: string, modelKey: string, hash: string) => `${organizationId}|${modelKey}|${hash}`

function remember(key: string, vector: Float32Array): void {
  const existing = cache.get(key)
  if (existing) {
    cache.delete(key)
    cachedFloats -= existing.length
  }
  cache.set(key, vector)
  cachedFloats += vector.length
  const limit = cacheLimitFloats()
  while (cachedFloats > limit && cache.size > 1) {
    const [oldestKey, oldest] = cache.entries().next().value as [string, Float32Array]
    cache.delete(oldestKey)
    cachedFloats -= oldest.length
  }
}

/** Vetores (normalizados) dos hashes pedidos que existem para o modelo; o que não existe simplesmente não volta. */
export async function loadKnowledgeVectors(db: Queryable, organizationId: string, modelKey: string, hashes: readonly string[], now = Date.now()): Promise<Map<string, Float32Array>> {
  const found = new Map<string, Float32Array>()
  const wanted: string[] = []
  for (const hash of new Set(hashes)) {
    const key = cacheKey(organizationId, modelKey, hash)
    const cached = cache.get(key)
    if (cached) {
      cache.delete(key)
      cache.set(key, cached)
      found.set(hash, cached)
      continue
    }
    if ((missing.get(key) ?? 0) > now) continue
    wanted.push(hash)
  }
  for (let start = 0; start < wanted.length; start += QUERY_BATCH) {
    const batch = wanted.slice(start, start + QUERY_BATCH)
    const rows = (await db.query<{ content_hash: string; vector: Buffer }>(`select content_hash, vector from knowledge_embedding_vectors where organization_id = $1 and model_key = $2 and content_hash = any($3::text[])`, [organizationId, modelKey, batch])).rows
    const present = new Set<string>()
    for (const row of rows) {
      const vector = decodeVector(row.vector)
      present.add(row.content_hash)
      found.set(row.content_hash, vector)
      remember(cacheKey(organizationId, modelKey, row.content_hash), vector)
    }
    for (const hash of batch) if (!present.has(hash)) missing.set(cacheKey(organizationId, modelKey, hash), now + MISSING_TTL_MS)
  }
  if (missing.size > 50_000) for (const [key, until] of missing) if (until <= now) missing.delete(key)
  return found
}

/** Hashes que ainda não têm vetor para o modelo (consulta direta, sem cache: é a indexação). */
export async function missingKnowledgeVectorHashes(db: Queryable, organizationId: string, modelKey: string, hashes: readonly string[]): Promise<string[]> {
  const unique = [...new Set(hashes)]
  const present = new Set<string>()
  for (let start = 0; start < unique.length; start += QUERY_BATCH) {
    const rows = (await db.query<{ content_hash: string }>(`select content_hash from knowledge_embedding_vectors where organization_id = $1 and model_key = $2 and content_hash = any($3::text[])`, [organizationId, modelKey, unique.slice(start, start + QUERY_BATCH)])).rows
    for (const row of rows) present.add(row.content_hash)
  }
  return unique.filter((hash) => !present.has(hash))
}

/** Grava vetores (normalizados aqui); vetor nulo ou inválido é recusado — nunca entra no índice. Idempotente por hash. */
export async function storeKnowledgeVectors(db: Queryable, organizationId: string, modelKey: string, entries: readonly { hash: string; vector: Float32Array }[]): Promise<number> {
  if (entries.length === 0) return 0
  const prepared = entries.map((entry) => {
    const vector = normalized(entry.vector)
    if (!vector) throw new Error("Vetor de embedding inválido (nulo ou com valor não finito).")
    return { hash: entry.hash, dimensions: vector.length, bytes: encodeVector(vector) }
  })
  await db.query(
    `insert into knowledge_embedding_vectors (organization_id, model_key, content_hash, dimensions, vector)
     select $1, $2, t.hash, t.dimensions, t.bytes from unnest($3::text[], $4::int[], $5::bytea[]) as t(hash, dimensions, bytes)
     on conflict do nothing`,
    [organizationId, modelKey, prepared.map((item) => item.hash), prepared.map((item) => item.dimensions), prepared.map((item) => item.bytes)],
  )
  for (const item of prepared) missing.delete(cacheKey(organizationId, modelKey, item.hash))
  return prepared.length
}

/** Só para testes. */
export function clearKnowledgeVectorCache(): void {
  cache.clear()
  missing.clear()
  cachedFloats = 0
}
