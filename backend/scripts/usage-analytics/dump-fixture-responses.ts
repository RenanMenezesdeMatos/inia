/**
 * Gera as respostas REAIS da API da Monitoria de usabilidade sobre a massa determinística (banco de TESTE), para conferir o
 * contrato do frontend e alimentar as fixtures dos testes de tela. Cria a organização da prova, consulta e APAGA tudo no fim.
 *   NODE_ENV=test npx tsx scripts/usage-analytics/dump-fixture-responses.ts <pasta de saída> [--frontend]
 * `--frontend` grava também `frontend/src/components/admin/usability/testing/usability-fixtures.json` (fixtures da tela).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"
import { env } from "../../src/config/env.js"
import type { Database } from "../../src/infrastructure/database/pool.js"
import { createPostgresAccessRepository } from "../../src/modules/access/infrastructure/postgres-access-repository.js"
import { runActivityProjection } from "../../src/modules/usage-analytics/application/activity-projection.js"
import { projectOrganization } from "../../src/modules/usage-analytics/application/eligibility-projection.js"
import { invalidateUsageSettings } from "../../src/modules/usage-analytics/application/usage-settings.js"
import { contextQuery } from "../../src/modules/usage-analytics/application/query/context-query.js"
import { conversationsQuery } from "../../src/modules/usage-analytics/application/query/conversations-query.js"
import { feedbacksQuery } from "../../src/modules/usage-analytics/application/query/feedbacks-query.js"
import { journeysQuery } from "../../src/modules/usage-analytics/application/query/journeys-query.js"
import { overviewQuery } from "../../src/modules/usage-analytics/application/query/overview-query.js"
import { peopleQuery } from "../../src/modules/usage-analytics/application/query/people-query.js"
import { personDetailQuery, personTimelineQuery } from "../../src/modules/usage-analytics/application/query/person-query.js"
import { qualityQuery } from "../../src/modules/usage-analytics/application/query/quality-query.js"
import { retentionQuery } from "../../src/modules/usage-analytics/application/query/retention-query.js"
import { screensQuery } from "../../src/modules/usage-analytics/application/query/screens-query.js"
import { buildUsabilityContext } from "../../src/modules/usage-analytics/application/query/usability-context.js"
import type { UsabilityTab } from "../../src/modules/usage-analytics/application/query/usability-filters.js"
import { workflowsQuery } from "../../src/modules/usage-analytics/application/query/workflows-query.js"
import { COLLECTION_START, FIXTURE_NOW, cleanupFixture, cleanupLeftovers, seedFixtureBase } from "../../src/modules/usage-analytics/testing/usability-fixture.js"
import { seedFixtureEvents } from "../../src/modules/usage-analytics/testing/usability-fixture-events.js"

const out = process.argv[2]
if (!out) throw new Error("Informe a pasta de saída.")
if (!env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL ausente.")
mkdirSync(out, { recursive: true })
const pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 8 })
const db = pool as unknown as Database
const PERIOD = { period: "CUSTOM", from: "2026-10-05", to: "2026-10-06" }
await cleanupLeftovers(pool)
const ids = await seedFixtureBase(pool)
try {
  invalidateUsageSettings()
  await projectOrganization(pool, ids.org, COLLECTION_START)
  await seedFixtureEvents(pool, ids)
  for (let round = 0; round < 20; round += 1) {
    const result = await runActivityProjection(db, { now: FIXTURE_NOW, maxBatches: 20 })
    if (result.processed === 0 && result.failed === 0) break
  }
  const ctxFor = async (viewer: "vera" | "lia" | "alan", tab: UsabilityTab, query: Record<string, unknown> = {}) => {
    const access = await createPostgresAccessRepository(pool).loadContext(ids.org, ids.accounts[viewer])
    return buildUsabilityContext(pool, { access, personId: ids.people[viewer], tab, query: { ...PERIOD, ...query }, now: FIXTURE_NOW })
  }
  const write = (name: string, value: unknown) => writeFileSync(join(out, `${name}.json`), JSON.stringify(value, null, 1))
  write("context", await contextQuery(pool, await ctxFor("vera", "overview")))
  write("overview", await overviewQuery(pool, await ctxFor("vera", "overview")))
  write("overview-aggregate", await overviewQuery(pool, await ctxFor("lia", "overview")))
  write("people", await peopleQuery(pool, await ctxFor("vera", "people")))
  write("people-aggregate", await peopleQuery(pool, await ctxFor("lia", "people")))
  write("retention", await retentionQuery(pool, await ctxFor("vera", "people")))
  write("screens", await screensQuery(pool, await ctxFor("vera", "screens")))
  write("feedbacks", await feedbacksQuery(pool, await ctxFor("vera", "feedbacks")))
  write("conversations", await conversationsQuery(pool, await ctxFor("vera", "conversations")))
  write("workflows", await workflowsQuery(pool, await ctxFor("vera", "workflows")))
  write("journeys", await journeysQuery(pool, await ctxFor("vera", "journeys")))
  write("quality", await qualityQuery(pool, await ctxFor("vera", "quality")))
  write("person", await personDetailQuery(pool, await ctxFor("vera", "person"), ids.people.ana))
  write("timeline", await personTimelineQuery(pool, await ctxFor("vera", "person"), ids.people.ana))
  write("ids", ids)
  if (process.argv.includes("--frontend")) {
    const read = (name: string) => JSON.parse(readFileSync(join(out, `${name}.json`), "utf8")) as Record<string, unknown>
    // O endpoint /users devolve a lista de pessoas junto da retenção (mesmo formato que a tela recebe).
    const fixtures = {
      context: read("context"),
      overview: read("overview"),
      people: { ...read("people"), retention: read("retention") },
      peopleAggregate: { ...read("people-aggregate"), retention: read("retention") },
      screens: read("screens"),
      feedbacks: read("feedbacks"),
      conversations: read("conversations"),
      workflows: read("workflows"),
      journeys: read("journeys"),
      quality: read("quality"),
      person: read("person"),
      timeline: read("timeline"),
    }
    const target = resolve(dirname(fileURLToPath(import.meta.url)), "../../../frontend/src/components/admin/usability/testing/usability-fixtures.json")
    writeFileSync(target, `${JSON.stringify(fixtures, null, 1)}\n`)
  }
} finally {
  await cleanupFixture(pool, ids)
  await pool.end()
}
