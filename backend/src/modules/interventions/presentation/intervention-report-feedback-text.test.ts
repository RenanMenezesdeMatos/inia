import express from "express"
import request from "supertest"
import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createInterventionRouter } from "./intervention-router.js"

/**
 * POL-06 — o relatório da avaliação guarda, no resumo da INIA, o texto dos feedbacks do colaborador. Quem lê o relatório só por
 * ter permissão de intervenção no escopo (sem ser parte do acompanhamento nem liderar o colaborador) recebe as datas e a
 * contagem, nunca o título nem o que foi dito — a mesma regra que o Acompanhamento aplica ao entregar o resumo.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const REPORT = "11111111-1111-4111-8111-111111111111"
const VIEWER = "22222222-2222-4222-8222-222222222222"
const OPERATOR = "33333333-3333-4333-8333-333333333333"

// A leitura do relatório (permissão no escopo) é dada como certa: o que se prova aqui é o TEXTO dos feedbacks, pela regra real.
vi.mock("../application/intervention-access.js", async (original) => ({
  ...(await original<typeof import("../application/intervention-access.js")>()),
  loadAccess: async () => ({ organizationId: ORG, accountId: "44444444-4444-4444-8444-444444444444", personId: VIEWER, assignments: [] }),
  canSeeInterventionsOf: async () => true,
}))

const structured = {
  subject: { personId: OPERATOR, name: "Operadora" },
  priorInterventions: [],
  actions: [],
  brief: {
    contract: "INTERVENTION_LEADER_BRIEF_V1",
    situation: ["TMA acima da meta em 3 fechamentos"],
    alreadyDone: { windowDays: 180, feedbackCount: 3, feedbacks: [{ id: "55555555-5555-4555-8555-555555555555", kind: "MONITORING", title: "Atendimento de 10/11", publishedAt: "2026-11-10T12:00:00.000Z", acknowledgedAt: null, recommendation: "Você disse “vou verificar” e não retornou ao cliente." }] },
    evolution: null,
    unknowns: [],
    actions: [],
  },
}

function appFor(relation: { leads: boolean; party: boolean }) {
  const query = async (sql: string) => {
    if (sql.includes("from intervention_reports where id = $1")) return { rows: [{ id: REPORT, evaluation_id: "66666666-6666-4666-8666-666666666666", created_at: new Date("2026-11-18T12:00:00Z"), structured }], rowCount: 1 }
    if (sql.includes("from subordinates where id = $3")) return { rows: relation.leads ? [{}] : [], rowCount: relation.leads ? 1 : 0 }
    if (sql.includes("from interventions i where i.organization_id = $1 and i.report_id = $2")) return { rows: relation.party ? [{}] : [], rowCount: relation.party ? 1 : 0 }
    return { rows: [], rowCount: 0 }
  }
  const app = express()
  app.use((incoming, _response, next) => {
    ;(incoming as unknown as { user: unknown }).user = { organizationId: ORG, personId: VIEWER, sub: "44444444-4444-4444-8444-444444444444", role: "ANALYST" }
    next()
  })
  app.use("/interventions", createInterventionRouter({ query } as unknown as Database))
  return app
}

const feedbackOf = (body: { data: { structured: typeof structured } }) => body.data.structured.brief.alreadyDone

describe("GET /interventions/reports/:id — texto dos feedbacks (POL-06)", () => {
  it("só com permissão no escopo (não lidera, não é parte): contagem e datas, sem título nem o que foi dito", async () => {
    const response = await request(appFor({ leads: false, party: false })).get(`/interventions/reports/${REPORT}`)
    expect(response.status).toBe(200)
    const done = feedbackOf(response.body)
    expect(done.feedbackCount).toBe(3)
    expect(done.feedbacks).toEqual([{ id: "55555555-5555-4555-8555-555555555555", kind: "MONITORING", title: null, publishedAt: "2026-11-10T12:00:00.000Z", acknowledgedAt: null, recommendation: "" }])
    expect(JSON.stringify(response.body)).not.toContain("vou verificar")
  })

  it("quem lidera o colaborador continua lendo o texto", async () => {
    const response = await request(appFor({ leads: true, party: false })).get(`/interventions/reports/${REPORT}`)
    expect(feedbackOf(response.body).feedbacks[0]).toMatchObject({ title: "Atendimento de 10/11", recommendation: structured.brief.alreadyDone.feedbacks[0]!.recommendation })
  })

  it("quem é parte do acompanhamento aberto pelo relatório continua lendo o texto", async () => {
    const response = await request(appFor({ leads: false, party: true })).get(`/interventions/reports/${REPORT}`)
    expect(feedbackOf(response.body).feedbacks[0]!.recommendation).toContain("vou verificar")
  })
})
