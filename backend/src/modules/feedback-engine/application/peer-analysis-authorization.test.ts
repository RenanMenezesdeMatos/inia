import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import type { InteractionForAnalysis } from "../infrastructure/postgres-engine-loaders.js"
import { fakeEngineModel } from "../testing/fake-engine-model.js"
import { TRANSCRIPT } from "../testing/fixtures.js"
import { CALLS, investigationOf, request, setup, strategyWith, type SetupOptions } from "../testing/investigation-world.js"
import { investigateIndicator } from "./investigate-indicator.js"

/**
 * `PEER_ANALYSIS_AUTHORIZATION_V1` — zero IA. Dev 05/10/2026: a execução do Workflow "Feedback de indicador" rodou sem estratégia
 * (matrícula sem pino); o planejador pediu `reference_practices`, que analisou 12 chamadas de colegas (pagas) — e o passo de
 * referência do contrato foi recusado ("sem estratégia de diagnóstico publicada"). Chamada de colega só é analisada quando a
 * comparação está AUTORIZADA (estratégia publicada com pares ligados, Workflow sem restringir); sem isso, a mesma consulta lê só a
 * memória que já existe.
 */
const PEERS = ["b1", "b2", "b3", "b4", "b5"].map((suffix) => `00000000-0000-4000-8000-0000000000${suffix}`)
const peerCall = (peer: string, index: number) => `00000000-0000-4000-8000-00000000c${index}${peer.slice(-2)}`
const PEER_CALLS = new Map(PEERS.flatMap((peer) => [0, 1].map((index) => [peerCall(peer, index), peer] as const)))

function build(strategy: Exclude<SetupOptions["strategy"], undefined>) {
  const model = fakeEngineModel({ planner: (_payload, round) => (round === 1 ? { calls: [{ tool: "reference_practices", args: { subject: "CONTESTACAO" }, question: "CONTEXT" }] } : { calls: [], stop: { reason: "SUFFICIENT", note: "ok" } }) })
  const built = setup({ subjects: "LOCATED", strategy, model: model.model })
  const own = built.investigate.data.segmentInteractions
  Object.assign(built.investigate.data, {
    teamPeers: async () => PEERS,
    peerOfficialValues: async () => PEERS.map((personId, index) => ({ personId, value: 300 + index })),
    segmentInteractions: async (...args: Parameters<typeof own>) => (PEERS.includes(args[1]) ? [0, 1].map((index) => ({ id: peerCall(args[1], index), startedAt: new Date(`2026-08-1${index}T13:00:00Z`), durationSeconds: 400, signaled: false })) : own(...args)),
  })
  const base = built.analyze.loadInteraction
  Object.assign(built.analyze, {
    loadInteraction: async (org: string, id: string): Promise<InteractionForAnalysis | null> => {
      const owner = PEER_CALLS.get(id)
      return owner ? { ...(await base(org, CALLS[0]!))!, id, operatorId: owner, transcript: { content: TRANSCRIPT, checksum: `t-${id}` } } : base(org, id)
    },
  })
  return { ...built, model }
}

describe("referência dos colegas: análise paga só com a comparação autorizada pela estratégia", () => {
  it("sem estratégia publicada: `reference_practices` do planejador roda, mas NENHUMA chamada de colega é analisada", async () => {
    const { investigate, memory, model } = build(null)
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(investigation.tools!.ledger.find((entry) => entry.tool === "reference_practices" && entry.via === "PLANNER")).toMatchObject({ status: "OK" })
    expect(investigation.budget.peerCallAnalyses).toBe(0)
    expect(model.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(0)
    expect([...PEER_CALLS.keys()].some((id) => model.calls.some((call) => JSON.stringify(call).includes(id)))).toBe(false)
  })

  it("estratégia com pares ligados: a mesma consulta analisa chamadas de colegas, no orçamento próprio da referência", async () => {
    const { investigate, memory, model } = build(strategyWith({ segmentation: true, sample: true, peers: true }))
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(investigation.budget.peerCallAnalyses).toBeGreaterThan(0)
    expect(investigation.budget.peerCallAnalyses).toBeLessThanOrEqual(investigation.budget.maxPeerCallAnalyses!)
    expect(model.calls.filter((call) => call.stage === "CALL_ANALYSIS").length).toBeGreaterThanOrEqual(investigation.budget.peerCallAnalyses!)
    expect(investigation.budget.callAnalyses).toBe(0)
  })

  it("estratégia com pares DESLIGADOS: nem a consulta nem análise de colega", async () => {
    const { investigate, memory, model } = build(strategyWith({ segmentation: true, sample: true, peers: false }))
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(investigation.tools!.ledger.find((entry) => entry.tool === "reference_practices" && entry.via === "PLANNER")).toMatchObject({ status: "REJECTED" })
    expect(investigation.budget.peerCallAnalyses).toBe(0)
    expect(model.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(0)
  })
})
