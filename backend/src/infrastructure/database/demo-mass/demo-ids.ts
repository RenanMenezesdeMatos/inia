import { createHash } from "node:crypto"

/**
 * Ids determinísticos da massa demo. Todo id é derivado de uma CHAVE de negócio estável
 * (ex.: "person:operator:0417") — por isso recarregar a massa nunca duplica nada (upsert pelo
 * mesmo id) e o reset consegue apagar exatamente as linhas que o gerador produziu, por lista
 * explícita de ids, sem depender de prefixo nem de TRUNCATE.
 *
 * Formato: UUID válido (versão 4 / variante 8) cujo primeiro grupo começa com `de00`, só pra
 * ser reconhecível a olho nu em SQL. O prefixo é conveniência de leitura, NÃO critério de
 * exclusão: nada no reset usa `like 'de00%'`.
 */
export const DEMO_ID_PREFIX = "de00"
const NAMESPACE = "inia-demo-mass:"

export function demoId(key: string): string {
  const hex = createHash("sha1").update(NAMESPACE + key).digest("hex")
  return `${DEMO_ID_PREFIX}${hex.slice(0, 4)}-${hex.slice(4, 8)}-4${hex.slice(8, 11)}-8${hex.slice(11, 14)}-${hex.slice(14, 26)}`
}

export function isDemoId(id: string): boolean {
  return id.startsWith(DEMO_ID_PREFIX)
}

/** Garante que duas chaves distintas nunca colidiram no mesmo id (defesa contra erro de chave). */
export class DemoIdRegistry {
  private readonly byId = new Map<string, string>()

  claim(key: string): string {
    const id = demoId(key)
    const owner = this.byId.get(id)
    if (owner !== undefined && owner !== key) throw new Error(`Colisão de id demo entre "${owner}" e "${key}"`)
    this.byId.set(id, key)
    return id
  }

  get size(): number {
    return this.byId.size
  }
}
