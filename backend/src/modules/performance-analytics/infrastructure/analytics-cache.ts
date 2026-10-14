import { createHash } from "node:crypto"

/**
 * Cache curto em memória do analytics da liderança (por processo). A CHAVE carrega as versões lidas do banco no mesmo
 * request (versão da estrutura, do fechamento oficial, geração do read model, última marca pendente) — então uma entrada
 * nunca é servida depois que o dado mudou; a validade só limita memória e o "agora" da janela operacional. LRU por
 * número de entradas e por PESO (ex.: membros da estrutura), para que poucas estruturas enormes não ocupem a memória.
 */
export class AnalyticsCache<T> {
  private readonly entries = new Map<string, { value: Promise<T>; expiresAt: number; weight: number }>()
  private totalWeight = 0

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly maxWeight = Number.POSITIVE_INFINITY,
  ) {}

  /** Devolve o valor guardado ou calcula; `keep(value)` decide se o resultado entra no cache e até quando (ms). */
  async getOrCompute(key: string, compute: () => Promise<T>, keep: (value: T) => number | false = () => Date.now() + this.ttlMs, weight = 1): Promise<T> {
    const nowMs = Date.now()
    const cached = this.entries.get(key)
    if (cached && cached.expiresAt > nowMs) {
      this.entries.delete(key)
      this.entries.set(key, cached)
      return cached.value
    }
    if (cached) this.remove(key)
    const value = compute()
    if (weight > this.maxWeight) return value
    // Pedidos simultâneos da mesma chave esperam o mesmo cálculo.
    this.entries.set(key, { value, expiresAt: nowMs + this.ttlMs, weight })
    this.totalWeight += weight
    this.evict()
    try {
      const resolved = await value
      const until = keep(resolved)
      const entry = this.entries.get(key)
      if (entry?.value === value) {
        if (until === false) this.remove(key)
        else entry.expiresAt = Math.min(until, nowMs + this.ttlMs)
      }
      return resolved
    } catch (error) {
      if (this.entries.get(key)?.value === value) this.remove(key)
      throw error
    }
  }

  clear(): void {
    this.entries.clear()
    this.totalWeight = 0
  }

  private remove(key: string) {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    this.totalWeight -= entry.weight
  }

  private evict() {
    while (this.entries.size > this.maxEntries || this.totalWeight > this.maxWeight) this.remove(this.entries.keys().next().value!)
  }
}

/** Impressão digital de um conjunto de pessoas (ordem irrelevante). */
export function membersFingerprint(personIds: readonly string[]): string {
  return createHash("sha1").update([...personIds].sort().join(",")).digest("base64url")
}
