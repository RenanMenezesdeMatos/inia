import type { RecordError } from "./error-codes.js"

/**
 * Contrato de Dados — "qual é o formato que a INIA entende" para um conjunto de dados.
 *
 * Cada dataset tem UMA definição canônica (campos, tipos, obrigatórios, chave natural,
 * dependências, semântica de escrita, exemplo). Validador de campo e writer são escolhidos
 * pelo contrato; nada de validator de Employee num router e natural key em outro arquivo.
 *
 * Versionamento: `EMPLOYEES@1`. Feeds e Runs guardam contract_key + contract_version; a
 * evolução de payload é uma nova versão no registro, nunca uma migração silenciosa.
 */
export type DataFieldType = "STRING" | "INTEGER" | "DECIMAL" | "BOOLEAN" | "DATE" | "DATETIME" | "TIME" | "MONTH" | "ENUM"

export type DataContractField = {
  key: string
  label: string
  type: DataFieldType
  required: boolean
  description: string
  example: string | number | boolean
  enumValues?: readonly string[]
  maxLength?: number
  /** Campo que identifica o registro na origem (sourceRecordKey na quarentena/lineage). */
  identity?: boolean
}

export type ContractCategory = "MASTER" | "EVENT" | "PERFORMANCE"

/**
 * UPSERT: dado mestre — cria ou atualiza pela chave natural (ausência NUNCA é delete).
 * IDEMPOTENT_EVENT: dado de evento/medição — mesma chave natural (com namespace de origem)
 * substitui em vez de duplicar.
 */
export type WriteSemantics = "UPSERT" | "IDEMPOTENT_EVENT"

/**
 * PARTIAL_ALLOWED: válidos são aplicados, inválidos vão para a quarentena.
 * ATOMIC: qualquer rejeição impede a aplicação de TODOS os registros (estrutura hierárquica).
 */
export type WritePolicy = "PARTIAL_ALLOWED" | "ATOMIC"

export type CanonicalRecord = Record<string, string | number | boolean | null>

export type DataContract = {
  key: string
  version: number
  label: string
  description: string
  category: ContractCategory
  /** Tabela/entidade de destino no domínio da INIA (informativo — o writer é quem escreve). */
  targetEntity: string
  fields: readonly DataContractField[]
  /** Campos que identificam o registro no domínio (explicativo; a chave real é aplicada pelo writer). */
  naturalKey: readonly string[]
  /** Grupos de alternativas: ao menos UM campo de cada grupo precisa estar presente. */
  atLeastOne?: readonly (readonly string[])[]
  /** Contratos que precisam existir antes (referências resolvidas contra o domínio). */
  dependencies: readonly string[]
  writeSemantics: WriteSemantics
  writePolicy: WritePolicy
  /** Campo (DATETIME/DATE/MONTH) que representa o "tempo de negócio" — base do "último dado recebido". */
  businessTimeField: string | null
  /** Validações puras por registro (sem banco): coerência entre campos. */
  validateRecord?: (record: CanonicalRecord) => RecordError[]
  /**
   * Campos cujo valor de origem é NORMALIZADO pela camada canônica (ex.: situação funcional "FER" →
   * FÉRIAS; regime "6X1" → 6x1). O preview mostra origem e normalizado lado a lado; desconhecido = null.
   */
  displayNormalizers?: Readonly<Record<string, (value: unknown) => string | null>>
  examples: readonly CanonicalRecord[]
}
