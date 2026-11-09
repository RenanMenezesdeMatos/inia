import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { AccessContext } from "../../access/domain/access-decision.js"
import { executeReactivation, previewReactivation } from "../application/record-cancellation-service.js"
import type { ExplorerActor } from "../application/explorer-service.js"
import { explorerLimitsFrom } from "../domain/explorer-limits.js"

/**
 * Ninguém cancela NEM REATIVA os próprios resultados. Banco falso com um lote de medições canceladas por outro administrador: uma delas é
 * de quem tenta reativar. A prova contra o banco real é `record-cancellation-proof` ("ninguém reativa os próprios resultados").
 */

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001"
const BATCH_ID = "00000000-0000-4000-8000-0000000000b1"
const INDICATOR_ID = "00000000-0000-4000-8000-0000000000d1"
const OWNER_ID = "00000000-0000-4000-8000-0000000000a1"
const OTHER_ADMIN_ID = "00000000-0000-4000-8000-0000000000a2"
const OPERATOR_ID = "00000000-0000-4000-8000-0000000000a3"

const limits = explorerLimitsFrom({ DATA_EXPLORER_DEFAULT_PAGE_SIZE: 25, DATA_EXPLORER_MAX_PAGE_SIZE: 100, DATA_EXPLORER_QUERY_TIMEOUT_MS: 5_000, DATA_EXPLORER_CANCEL_MAX_ROWS: 10_000, DATA_EXPLORER_COUNT_CAP: 10_000, DATA_EXPLORER_EXPORT_MAX_ROWS: 20_000, DATA_EXPLORER_EXPORT_MAX_BYTES: 20_971_520, DATA_EXPLORER_EXPORT_MAX_DURATION_MS: 60_000 })

type Measurement = { id: string; subjectId: string; cancellationId: string | null }

/** Responde só ao que a reativação pergunta; consulta não prevista é falha do teste, nunca resposta vazia. */
function fakeDatabase(records: Measurement[]) {
  const commands: string[] = []
  const result = (rows: unknown[], rowCount = rows.length) => ({ rows, rowCount })
  async function query(sql: string, params: unknown[] = []) {
    const text = sql.trim()
    commands.push(text)
    if (/^(begin|commit|rollback)\b/.test(text) || text.startsWith("select set_config(")) return result([])
    if (text.includes("as account_slot")) return result([{ account_slot: 0, organization_slot: 0 }])
    if (text.includes("pg_try_advisory_xact_lock($1::int, hashtext($2)) ok")) return result([{ ok: true }])
    if (text.includes("from data_record_cancellations where id = $1")) return result(params[0] === BATCH_ID ? [{ id: BATCH_ID, dataset: "indicator_measurements", indicator_rules: {} }] : [])
    if (text.includes("from data_ingestion_runs")) return result([])
    const inBatch = records.filter((record) => record.cancellationId === params[1])
    if (text.includes("group by 1, 2")) return result([{ indicator_definition_id: INDICATOR_ID, daily: true, total: inBatch.length }])
    if (text.includes("from indicator_definitions where")) return result([{ id: INDICATOR_ID, active: true, code: "TMA", unit: "SECONDS", direction: "LOWER", aggregation: "SUM", dailySupported: true, officialClosureSupported: true }])
    if (text.includes("a.cancelled_at is null and a.period_start")) return result([{ total: 0 }])
    if (text.endsWith("for update")) return result(inBatch.map((record) => ({ id: record.id })))
    if (text.includes("r.subject_type = 'PERSON' and r.subject_id = $1::uuid")) {
      // Dono no alcance: pelos ids (cancelar) ou pelo lote (reativar).
      const [personId, , target] = params
      const own = records.filter((record) => record.subjectId === personId && (Array.isArray(target) ? target.includes(record.id) : record.cancellationId === target))
      return result(own.slice(0, 1).map(() => ({ "?column?": 1 })))
    }
    if (text.startsWith("update indicator_measurements_all set cancelled_at = null")) {
      const reactivated = records.filter((record) => record.cancellationId === params[1])
      for (const record of reactivated) record.cancellationId = null
      return result([], reactivated.length)
    }
    if (text.startsWith("update data_record_cancellations") || text.startsWith("insert into audit_logs")) return result([])
    throw new Error(`Consulta não prevista pelo banco falso: ${text.slice(0, 120)}`)
  }
  const client = { query, release: () => undefined }
  const db = { query, connect: async () => client } as unknown as Database
  return { db, commands }
}

function actor(personId: string): ExplorerActor {
  const access = { organizationId: ORGANIZATION_ID, accountId: `${personId.slice(0, -2)}ff`, personId, assignments: [{ roleCode: "ADMINISTRADOR_DE_DADOS", scope: { type: "ORGANIZATION" } }] } as unknown as AccessContext
  return { organizationId: ORGANIZATION_ID, accountId: access.accountId, personId, access }
}

/** O Administrador B cancelou um lote com uma medição do Administrador A e uma de um operador. */
const batchWithOwnerRecord = (): Measurement[] => [
  { id: "00000000-0000-4000-8000-0000000000e1", subjectId: OWNER_ID, cancellationId: BATCH_ID },
  { id: "00000000-0000-4000-8000-0000000000e2", subjectId: OPERATOR_ID, cancellationId: BATCH_ID },
]

describe("reativar não vale para os próprios resultados", () => {
  it("a prévia recusa quem está no lote, com o mesmo código do cancelamento; outro administrador pode", async () => {
    const { db } = fakeDatabase(batchWithOwnerRecord())
    const own = await previewReactivation({ db, limits }, actor(OWNER_ID), BATCH_ID)
    expect(own.canReactivate).toBe(false)
    expect(own.blockers.map((blocker) => blocker.code)).toEqual(["DATA_CANCEL_OWN_RECORDS"])
    expect(own.blockers[0]?.message).toMatch(/reativar/)
    const other = await previewReactivation({ db, limits }, actor(OTHER_ADMIN_ID), BATCH_ID)
    expect(other).toMatchObject({ rows: 2, canReactivate: true, blockers: [], problems: [] })
  })

  it("a confirmação recusa com 403 e não reativa nada; outro administrador reativa o lote inteiro", async () => {
    const records = batchWithOwnerRecord()
    const { db, commands } = fakeDatabase(records)
    await expect(executeReactivation({ db, limits }, actor(OWNER_ID), BATCH_ID, { expectedRows: 2 })).rejects.toMatchObject({ code: "DATA_CANCEL_OWN_RECORDS", statusCode: 403 })
    expect(commands.some((sql) => sql.startsWith("update indicator_measurements_all set cancelled_at = null"))).toBe(false)
    expect(records.every((record) => record.cancellationId === BATCH_ID)).toBe(true)
    await expect(executeReactivation({ db, limits }, actor(OTHER_ADMIN_ID), BATCH_ID, { expectedRows: 2 })).resolves.toEqual({ rows: 2 })
    expect(records.every((record) => record.cancellationId === null)).toBe(true)
  })
})
