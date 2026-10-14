import type pg from "pg"
import type { CanonicalRecord } from "../../domain/data-contract.js"
import type { RecordError } from "../../domain/error-codes.js"
import type { DataHubContext } from "../data-hub-context.js"
import type { DataFeedRow } from "../records.js"

/**
 * Domain Writer — "como o dado entra no domínio". Um por contrato, escolhido pelo registro de
 * contratos. Duas fases:
 *  - `prepare`: resolve referências EM LOTE (zero N+1), aplica regras que dependem do catálogo
 *    (componentes exigidos pela estratégia do indicador…) e separa prontos × rejeitados.
 *  - `apply`: escreve um lote dentro da transação recebida, pelos mesmos caminhos canônicos do
 *    domínio (upsert pela chave natural, matrícula de Workflows), devolvendo contagens e
 *    lineage. Nunca 1 INSERT por registro: unnest em lote.
 */
export type ValidRecord = { recordNumber: number; record: CanonicalRecord; sourceRecordKey: string | null }
export type Rejection = { recordNumber: number; sourceRecordKey: string | null; error: RecordError }

export type LineageEntry = { entityType: string; entityId: string; action: "INSERTED" | "UPDATED"; recordNumber: number; sourceRecordKey: string | null }

/** Aviso de um registro APLICADO (ex.: conflito de situação resolvido pela precedência) — vai para a quarentena como rastro, sem contar como rejeição. */
export type ApplyWarning = Rejection

export type ApplyResult = { inserted: number; updated: number; unchanged: number; deactivated: number; businessMaxEventTime: string | null; lineage: LineageEntry[]; warnings: ApplyWarning[] }

export type WriteContext = {
  ctx: DataHubContext
  organizationId: string
  timeZone: string
  feed: DataFeedRow
  runId: string
  /** Namespace de origem para dados de evento/medição (coluna `source`). */
  sourceNamespace: string
}

export interface DomainWriter<TPrepared = unknown> {
  readonly contractKey: string
  prepare(context: WriteContext, records: ValidRecord[]): Promise<{ ready: TPrepared[]; rejections: Rejection[] }>
  apply(context: WriteContext, client: pg.PoolClient, batch: TPrepared[]): Promise<ApplyResult>
}

export function reject(record: ValidRecord, code: RecordError["code"], field: string | null, message: string): Rejection {
  return { recordNumber: record.recordNumber, sourceRecordKey: record.sourceRecordKey, error: { code, field, message } }
}

export function emptyApply(): ApplyResult {
  return { inserted: 0, updated: 0, unchanged: 0, deactivated: 0, businessMaxEventTime: null, lineage: [], warnings: [] }
}

export function mergeApply(target: ApplyResult, part: ApplyResult): ApplyResult {
  target.inserted += part.inserted
  target.updated += part.updated
  target.unchanged += part.unchanged
  target.deactivated += part.deactivated
  if (part.businessMaxEventTime && (!target.businessMaxEventTime || part.businessMaxEventTime > target.businessMaxEventTime)) target.businessMaxEventTime = part.businessMaxEventTime
  target.lineage.push(...part.lineage)
  target.warnings.push(...part.warnings)
  return target
}

/** Marca duplicidade de chave natural DENTRO da carga: a primeira ocorrência vale, as demais vão pra quarentena. */
export function dedupeByKey<T extends ValidRecord>(records: T[], keyOf: (record: T) => string): { unique: T[]; duplicates: Rejection[] } {
  const seen = new Set<string>()
  const unique: T[] = []
  const duplicates: Rejection[] = []
  for (const record of records) {
    const key = keyOf(record)
    if (seen.has(key)) {
      duplicates.push(reject(record, "DATA_DUPLICATE", null, `Registro repetido nesta carga (chave ${key}). A primeira ocorrência foi mantida.`))
      continue
    }
    seen.add(key)
    unique.push(record)
  }
  return { unique, duplicates }
}

export function str(record: CanonicalRecord, key: string): string | null {
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

export function num(record: CanonicalRecord, key: string): number | null {
  const value = record[key]
  return typeof value === "number" ? value : null
}

export function bool(record: CanonicalRecord, key: string): boolean | null {
  const value = record[key]
  return typeof value === "boolean" ? value : null
}

/** Classifica linhas devolvidas por `insert … on conflict do update … returning (xmax = 0) inserted`. */
export function countUpsert<T extends { inserted: boolean }>(rows: T[], total: number): { inserted: number; updated: number; unchanged: number } {
  const inserted = rows.filter((row) => row.inserted).length
  const updated = rows.length - inserted
  return { inserted, updated, unchanged: total - rows.length }
}
