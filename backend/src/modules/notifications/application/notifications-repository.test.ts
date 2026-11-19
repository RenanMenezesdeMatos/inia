import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { ALIGNMENT_STARTED_ALERT_TYPE } from "../../operational-alignments/application/my-alignments.js"
import { PgNotificationsRepository } from "./notifications-repository.js"

/**
 * AL-09 — o aviso "Novo alinhamento em vigor" de um alinhamento EXCLUÍDO não aparece nem conta no sino: lista, badge e "marcar todas"
 * levam a MESMA condição (sem banco: a prova é o SQL enviado; o comportamento contra o Postgres está em `my-alignments-proof`).
 */
function recordingDb() {
  const statements: string[] = []
  const db = { query: async (sql: string) => (statements.push(sql.replace(/\s+/g, " ")), { rows: [], rowCount: 0 }) } as unknown as Database
  return { db, statements }
}
const DELETED_ALIGNMENT = `not (case when a.alert_type = '${ALIGNMENT_STARTED_ALERT_TYPE}' then exists (select 1 from operational_alignments oa where oa.id = nullif(split_part(a.dedupe_key, ':', 2), '')::uuid and oa.deleted_at is not null) else false end)`

describe("sino × alinhamento excluído (AL-09)", () => {
  it("lista, contagem e 'marcar todas como lidas' ignoram o aviso de alinhamento excluído", async () => {
    const { db, statements } = recordingDb()
    const repository = new PgNotificationsRepository(db)
    await repository.loadRecentAlerts("viewer", "org", 20)
    await repository.countUnread("viewer", "org")
    await repository.markAllRead("viewer", "org")
    expect(statements).toHaveLength(3)
    for (const statement of statements) expect(statement).toContain(DELETED_ALIGNMENT)
  })
})
