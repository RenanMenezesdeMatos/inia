import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { PgAnalyticsReadRepository } from "./analytics-read-repository.js"

/**
 * AL-06 — feed de quem lidera: em página seguinte (cursor), os alinhamentos da estrutura (duas consultas sobre versões × liderados) só
 * são calculados se alguma versão foi publicada até o instante do cursor. A primeira página sempre calcula. Sem banco: a porta dos
 * alinhamentos é roteirizada e o feed vem vazio.
 */
const emptyDb = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database
const feed = { organizationId: "org", viewerId: "leader", operatorIds: ["op-1"], includeViewerAlerts: true, unacknowledgedOnly: false, limit: 20 }
const cursor = { at: "2026-01-10T12:00:00.000000Z", id: "00000000-0000-4000-8000-000000000001" }

function repositoryWith(publishedUpTo: boolean) {
  const calls = { list: 0, check: [] as unknown[] }
  const repository = new PgAnalyticsReadRepository(emptyDb, {
    alignments: {
      listForStructure: async () => ((calls.list += 1), []),
      hasPublishedUpTo: async (_db, _organizationId, at) => (calls.check.push(at), publishedUpTo),
    },
  })
  return { repository, calls }
}

describe("feed da liderança × alinhamentos da estrutura (AL-06)", () => {
  it("página com cursor anterior a toda publicação: os alinhamentos não são calculados", async () => {
    const { repository, calls } = repositoryWith(false)
    expect(await repository.loadFollowUpFeed({ ...feed, before: cursor })).toEqual({ items: [], nextCursor: null })
    expect(calls).toEqual({ list: 0, check: [cursor.at] })
  })

  it("página com cursor e alguma versão publicada até ele: calcula como antes", async () => {
    const { repository, calls } = repositoryWith(true)
    await repository.loadFollowUpFeed({ ...feed, before: cursor })
    expect(calls.list).toBe(1)
  })

  it("primeira página: sempre calcula, sem a consulta de existência", async () => {
    const { repository, calls } = repositoryWith(false)
    await repository.loadFollowUpFeed({ ...feed, before: null })
    expect(calls).toEqual({ list: 1, check: [] })
  })
})
