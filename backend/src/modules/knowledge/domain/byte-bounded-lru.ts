/**
 * Cache LRU limitado por QUANTIDADE e por BYTES (tamanho aproximado, dado por quem guarda — ex.: caracteres × 2 do UTF-16). Usado pelos
 * caches por processo da busca em escala (`knowledge-recall.ts`): com bases grandes, o teto por quantidade sozinho deixava a memória crescer
 * com o tamanho das bases. O item mais novo sempre fica (quem acabou de pedir vai usá-lo), mesmo maior que o teto — como no cache de vetores.
 */
export class ByteBoundedLru<K, V> {
  private readonly entries = new Map<K, { value: V; bytes: number }>()
  private total = 0

  constructor(private readonly limits: { maxEntries: number; maxBytes: () => number; sizeOf: (value: V) => number }) {}

  get size(): number {
    return this.entries.size
  }

  get bytes(): number {
    return this.total
  }

  /** Lê e marca como usado agora. */
  get(key: K): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: K, value: V): void {
    const existing = this.entries.get(key)
    if (existing) {
      this.entries.delete(key)
      this.total -= existing.bytes
    }
    const bytes = Math.max(0, this.limits.sizeOf(value))
    this.entries.set(key, { value, bytes })
    this.total += bytes
    const maxBytes = this.limits.maxBytes()
    while (this.entries.size > 1 && (this.entries.size > this.limits.maxEntries || this.total > maxBytes)) {
      const [oldestKey, oldest] = this.entries.entries().next().value as [K, { value: V; bytes: number }]
      this.entries.delete(oldestKey)
      this.total -= oldest.bytes
    }
  }
}

/** Teto em bytes de uma variável de ambiente em MB (inválida ou ausente = o padrão). */
export function megabytesFromEnv(value: string | undefined, fallbackMb: number): number {
  const megabytes = Number(value ?? fallbackMb)
  return Math.max(1, Number.isFinite(megabytes) && megabytes > 0 ? megabytes : fallbackMb) * 1_048_576
}
