import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { PgAnalyticsReadRepository } from "../application/analytics-read-repository.js"
import { isUncommittedVersion, loadAnalyticsVersion } from "../infrastructure/analytics-versions.js"
import { OrganizationPeopleGraphCache } from "../infrastructure/organization-people-graph.js"

/**
 * PROVA no banco de TESTE real — as versões por organização do analytics sobem NO COMMIT (migration 141):
 *  - uma transação longa que grava pessoas não segura outro gravador da mesma organização. Na 128, a linha da versão ficava
 *    travada até o commit, e a prova do gatilho Manual travou por isso (13/10/2026);
 *  - escritas em ordem cruzada (STRUCTURE × OFFICIAL) em duas transações abertas não esperam nem travam;
 *  - a versão que os outros veem só muda no commit; rollback e savepoint desfeito não sobem nada;
 *  - a própria transação enxerga a sua pendência: o grafo em cache nunca chega a ela sem a própria escrita, e o que ela
 *    carrega não substitui o grafo dos outros.
 * Organização própria da prova, gravada de verdade (são várias conexões) e apagada no fim. Cada espera tem `lock_timeout`
 * de 2 s: se a linha da versão voltar a ficar travada, a prova falha com erro de lock em vez de estourar o tempo.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run analytics-versions-proof --no-file-parallelism
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "7c000000-0000-4000-8000-000000000001"
const id = (n: number) => `7c000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const MANAGER = id(11)
const OPERATOR = id(12)
const OTHER_MANAGER = id(13)

let pool: pg.Pool

const structure = (db: Pick<Database, "query">) => loadAnalyticsVersion(db, ORG, "STRUCTURE")
const official = (db: Pick<Database, "query">) => loadAnalyticsVersion(db, ORG, "OFFICIAL")
const insertPerson = (db: Pick<Database, "query">, name: string) => db.query("insert into people (organization_id, name, role) values ($1, $2, 'OPERATOR')", [ORG, `Proof Versões ${name}`])
const insertIndicator = (db: Pick<Database, "query">, code: string) =>
  db.query("insert into indicator_definitions (organization_id, code, name, unit, desired_direction) values ($1, $2, 'Proof Versões Indicador', 'SECONDS', 'LOWER')", [ORG, code])
const ids = (people: { id: string }[]) => people.map((person) => person.id)

/** Devolve a conexão sem transação pendurada: uma falha no meio de um caso não contamina o seguinte. */
async function release(...clients: pg.PoolClient[]) {
  for (const client of clients) {
    await client.query("rollback").catch(() => undefined)
    client.release()
  }
}

async function cleanup() {
  await pool.query("delete from people where organization_id = $1", [ORG])
  await pool.query("delete from indicator_definitions where organization_id = $1", [ORG])
  await pool.query("delete from analytics_operational_dirty where organization_id = $1", [ORG])
  await pool.query("delete from organizations where id = $1", [ORG])
}

describe.skipIf(!ENABLED)("Versões do analytics sobem no commit — prova Postgres (várias conexões)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 4 })
    await cleanup()
    await pool.query("insert into organizations (id, name, slug) values ($1, 'Proof Versões do analytics', 'proof-versoes-analytics')", [ORG])
  })
  afterAll(async () => {
    if (!pool) return
    await cleanup()
    await pool.end()
  })

  it("transação longa não segura outro gravador; a versão só muda no commit, uma vez por transação; desfeito não sobe", async () => {
    const a = await pool.connect()
    const b = await pool.connect()
    try {
      const before = await structure(pool)
      await a.query("begin")
      await a.query("set local lock_timeout = '2s'")
      await insertPerson(a, "A1")
      expect(await structure(pool)).toBe(before)

      // B grava e confirma com A aberta: na 128 esperaria A terminar (aqui, erro de lock em 2 s).
      await b.query("begin")
      await b.query("set local lock_timeout = '2s'")
      await insertPerson(b, "B1")
      await b.query("commit")
      const afterB = await structure(pool)
      expect(afterB).not.toBe(before)

      // A continua escrevendo: só ela vê a pendência (uma por organização × domínio), os outros veem a versão de B.
      await insertPerson(a, "A2")
      await a.query("update people set name = 'Proof Versões A1 renomeada' where organization_id = $1 and name = 'Proof Versões A1'", [ORG])
      expect((await a.query<{ n: number }>("select count(*)::int n from analytics_version_pending where xact_id = pg_current_xact_id()")).rows[0]!.n).toBe(1)
      expect(isUncommittedVersion(await structure(a))).toBe(true)
      expect(await structure(pool)).toBe(afterB)
      await a.query("commit")
      const afterA = await structure(pool)
      expect(afterA).not.toBe(afterB)
      expect(isUncommittedVersion(afterA)).toBe(false)
      expect((await pool.query<{ n: number }>("select count(*)::int n from analytics_version_pending where organization_id = $1", [ORG])).rows[0]!.n).toBe(0)

      await a.query("begin")
      await insertPerson(a, "desfeita")
      await a.query("rollback")
      await a.query("begin")
      await a.query("savepoint proof")
      await insertPerson(a, "savepoint desfeito")
      await a.query("rollback to savepoint proof")
      expect(isUncommittedVersion(await structure(a))).toBe(false)
      await a.query("commit")
      expect(await structure(pool)).toBe(afterA)
    } finally {
      await release(a, b)
    }
  })

  it("ordem cruzada STRUCTURE × OFFICIAL em duas transações abertas: nenhuma espera, nenhum deadlock, as duas sobem", async () => {
    const a = await pool.connect()
    const b = await pool.connect()
    try {
      const [structureBefore, officialBefore] = [await structure(pool), await official(pool)]
      for (const tx of [a, b]) {
        await tx.query("begin")
        await tx.query("set local lock_timeout = '2s'")
      }
      await insertIndicator(a, `PROOF_VERSIONS_A_${Date.now()}`)
      await insertPerson(b, "cruzada B")
      await insertPerson(a, "cruzada A")
      await insertIndicator(b, `PROOF_VERSIONS_B_${Date.now()}`)
      await Promise.all([a.query("commit"), b.query("commit")])
      expect(await structure(pool)).not.toBe(structureBefore)
      expect(await official(pool)).not.toBe(officialBefore)
    } finally {
      await release(a, b)
    }
  })

  it("grafo em cache: quem gravou vê a própria escrita antes do commit; o grafo dos outros só muda no commit", async () => {
    await pool.query(
      "insert into people (id, organization_id, name, role) values ($1, $4, 'Proof Versões Gestor', 'SUPERVISOR'), ($2, $4, 'Proof Versões Operador', 'OPERATOR'), ($3, $4, 'Proof Versões Outro Gestor', 'SUPERVISOR')",
      [MANAGER, OPERATOR, OTHER_MANAGER, ORG],
    )
    await pool.query("update people set reports_to_id = $1 where id = $2", [MANAGER, OPERATOR])
    const cache = new OrganizationPeopleGraphCache()
    const shared = new PgAnalyticsReadRepository(pool as unknown as Database, { peopleGraphCache: cache })
    expect(ids(await shared.loadDirectReports(ORG, MANAGER))).toEqual([OPERATOR])
    const committedGraph = await cache.get(pool, ORG)

    const a = await pool.connect()
    try {
      await a.query("begin")
      await a.query("update people set reports_to_id = $1 where id = $2", [OTHER_MANAGER, OPERATOR])
      const writer = new PgAnalyticsReadRepository(a as unknown as Database, { peopleGraphCache: cache })
      expect(ids(await writer.loadDirectReports(ORG, MANAGER))).toEqual([])
      expect(ids(await writer.loadDirectReports(ORG, OTHER_MANAGER))).toEqual([OPERATOR])
      // O que a transação aberta carregou não entrou no cache: os outros continuam com o grafo comprometido.
      expect(await cache.get(pool, ORG)).toBe(committedGraph)
      expect(ids(await shared.loadDirectReports(ORG, MANAGER))).toEqual([OPERATOR])
      await a.query("commit")
    } finally {
      await release(a)
    }
    expect(ids(await shared.loadDirectReports(ORG, MANAGER))).toEqual([])
    expect(ids(await shared.loadDirectReports(ORG, OTHER_MANAGER))).toEqual([OPERATOR])
  })
})
