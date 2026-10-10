import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { FlowGraph } from "../domain/graph-schema.js"
import type { GenerationOutcome, GenerationRequest } from "../../interaction-feedback/application/generate-interaction-feedback.js"

const flags = vi.hoisted(() => ({ pipeline: "ON" as "ON" | "OFF" }))
vi.mock("../../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../config/env.js")>()
  return { env: new Proxy(original.env, { get: (target, key) => (key === "INIA_INTERACTION_FEEDBACK_PIPELINE" ? flags.pipeline : Reflect.get(target, key)) }) }
})

const { processNode } = await import("./node-handlers.js")
const { createFakeEffects } = await import("../testing/fake-effect-sink.js")
const { validateWorkflowForPublish } = await import("./validate-workflow-for-publish.js")

const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATOR = "00000000-0000-4000-8000-0000000000aa"
const INTERACTION = "00000000-0000-4000-8000-0000000000f1"
const CANDIDATES = Array.from({ length: 12 }, (_, index) => ({ id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`, started_at: new Date(Date.UTC(2026, 2, 2 + index, 13)) }))

const actionNode = (interactionSource: Record<string, unknown>) => ({ id: "gerar", type: "action", label: "Gerar feedback de atendimento", position: { x: 0, y: 1 }, config: { actionType: "GENERATE_INTERACTION_FEEDBACK", interactionSource } })
const graphWith = (interactionSource: Record<string, unknown>): FlowGraph => ({
  nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} }, actionNode(interactionSource), { id: "end", type: "end", label: "Fim", position: { x: 0, y: 2 }, config: {} }],
  edges: [{ id: "e1", source: "trigger", target: "gerar", sourceHandle: "always" }, { id: "e2", source: "gerar", target: "end", sourceHandle: "always" }],
}) as unknown as FlowGraph
const SAMPLE = { kind: "COLLABORATOR_SAMPLE", period: "MONTH", sampleSize: 3, strategy: "DETERMINISTIC_SAMPLE" }

function fakeDb() {
  const queries: string[] = []
  const query = vi.fn(async (sql: string) => {
    queries.push(sql)
    if (sql.includes("select operator_id from interactions")) return { rows: [{ operator_id: OPERATOR }], rowCount: 1 }
    if (sql.includes("select id from people where id = $1 and organization_id")) return { rows: [{ id: OPERATOR }], rowCount: 1 }
    if (sql.includes("from operations")) return { rows: [{ timezone: "America/Sao_Paulo" }], rowCount: 1 }
    if (sql.includes("from interactions i") && sql.includes("exists (select 1 from transcripts")) return { rows: CANDIDATES, rowCount: CANDIDATES.length }
    return { rows: [], rowCount: 0 }
  })
  return { db: { query } as unknown as Database, queries }
}
const outcome = (request: GenerationRequest, dispositions: Partial<GenerationOutcome["dispositions"]>, extra: Partial<GenerationOutcome> = {}): GenerationOutcome => ({ status: "GENERATED", notAnalyzableReason: null, feedbackStatus: "HAS_POINTS", runId: "run", writerInvoked: true, dispositions: { AUTO_DELIVER: 0, HOLD_FOR_QA: 0, BLOCKED: 0, ...dispositions }, reasons: [], policyVersion: "FEEDBACK_DELIVERY_POLICY_AUTONOMOUS_V1", interactionId: request.interactionId, generationId: "gen", reused: false, ...extra })

function run(graph: FlowGraph, enrollment: { id?: string; interactionId?: string | null; scheduledSubjectId?: string | null }, effects = createFakeEffects(), db = fakeDb().db) {
  return processNode(
    {
      db, graph, inputContext: "", now: new Date("2026-04-10T12:00:00Z"), effects,
      workflow: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null },
      enrollment: { id: enrollment.id ?? "00000000-0000-4000-8000-0000000000e1", organization_id: ORG, workflow_id: "00000000-0000-4000-8000-0000000000b1", version_id: "00000000-0000-4000-8000-0000000000b2", interaction_id: enrollment.interactionId ?? null, indicator_measurement_id: null, scheduled_subject_id: enrollment.scheduledSubjectId ?? null, scheduled_for: null, current_node_id: "gerar", matched_flag_name: null, matched_value_boolean: null, matched_value_numeric: null, status: "active", attempts: 0, revision: 0, node_outputs: {}, variables: {} },
    },
    graph.nodes.find((node) => node.id === "gerar")!,
  )
}

beforeEach(() => { flags.pipeline = "ON" })

describe("V1.5.10 — ação \"Gerar feedback de atendimento\" no motor real", () => {
  it("B) Flag: usa a interação do gatilho — nenhuma busca de candidatas, nenhum sorteio", async () => {
    const effects = createFakeEffects()
    effects.interactionFeedback.generate.mockImplementation(async (_db, request) => outcome(request, { AUTO_DELIVER: 1 }))
    const { db, queries } = fakeDb()
    const result = await run(graphWith({ kind: "TRIGGER_INTERACTION" }), { interactionId: INTERACTION }, effects, db)
    expect(effects.interactionFeedback.generate).toHaveBeenCalledTimes(1)
    expect(effects.interactionFeedback.generate.mock.calls[0]![1]).toMatchObject({ organizationId: ORG, collaboratorId: OPERATOR, interactionId: INTERACTION, intent: { kind: "WORKFLOW_ACTION", nodeId: "gerar", workflowVersionId: "00000000-0000-4000-8000-0000000000b2" }, selection: { source: "TRIGGER_INTERACTION" } })
    expect(queries.some((sql) => sql.includes("exists (select 1 from transcripts"))).toBe(false)
    expect(effects.interactionFeedback.reserveSelection).not.toHaveBeenCalled()
    expect(result).toMatchObject({ kind: "advance", nextNodeId: "end", eventType: "action_executed", nodeOutput: { kind: "INTERACTION_FEEDBACK", source: "TRIGGER_INTERACTION", totals: { interactions: 1, generated: 1, autoDeliver: 1 } } })
  })

  it("A/28) Agenda: amostra DETERMINÍSTICA do colaborador na janela, reservada antes de gerar; outra execução pode escolher outra", async () => {
    const effects = createFakeEffects()
    effects.interactionFeedback.generate.mockImplementation(async (_db, request) => outcome(request, { AUTO_DELIVER: 1 }))
    const first = await run(graphWith(SAMPLE), { scheduledSubjectId: OPERATOR }, effects)
    const reserved = effects.interactionFeedback.reserveSelection.mock.calls[0]![1] as GenerationRequest[]
    expect(reserved).toHaveLength(3)
    expect(reserved.map((request) => request.selection)).toEqual([1, 2, 3].map((rank) => ({ source: "COLLABORATOR_SAMPLE", strategy: "DETERMINISTIC_SAMPLE", rank })))
    expect(effects.interactionFeedback.generate.mock.calls.map((call) => (call[1] as GenerationRequest).interactionId)).toEqual(reserved.map((request) => request.interactionId))
    expect(first).toMatchObject({ kind: "advance", nodeOutput: { selection: { strategy: "DETERMINISTIC_SAMPLE", candidateCount: 12, selectedCount: 3, persisted: true }, totals: { interactions: 3, autoDeliver: 3 } } })
    // Mesma execução de novo (mesma matrícula, mesmos candidatos) → mesma amostra.
    const again = createFakeEffects()
    again.interactionFeedback.generate.mockImplementation(async (_db, request) => outcome(request, {}))
    await run(graphWith(SAMPLE), { scheduledSubjectId: OPERATOR }, again)
    expect((again.interactionFeedback.reserveSelection.mock.calls[0]![1] as GenerationRequest[]).map((request) => request.interactionId)).toEqual(reserved.map((request) => request.interactionId))
    // Execução NOVA → outra semente → outra amostra; o que o nó já atendeu fica fora.
    const next = createFakeEffects()
    next.interactionFeedback.selectedInteractionIds.mockResolvedValue(reserved.map((request) => request.interactionId))
    next.interactionFeedback.generate.mockImplementation(async (_db, request) => outcome(request, {}))
    await run(graphWith(SAMPLE), { id: "00000000-0000-4000-8000-0000000000e2", scheduledSubjectId: OPERATOR }, next)
    const nextIds = (next.interactionFeedback.reserveSelection.mock.calls[0]![1] as GenerationRequest[]).map((request) => request.interactionId)
    expect(nextIds).toHaveLength(3)
    expect(nextIds.some((id) => reserved.some((request) => request.interactionId === id))).toBe(false)
  })

  it("C) retry da MESMA execução: relê a seleção persistida — nunca reescolhe nem consulta candidatas", async () => {
    const effects = createFakeEffects()
    const persisted = [CANDIDATES[4]!.id, CANDIDATES[9]!.id]
    effects.interactionFeedback.persistedSelection.mockResolvedValue(persisted)
    effects.interactionFeedback.generate.mockImplementation(async (_db, request) => outcome(request, { AUTO_DELIVER: 1 }, { reused: true }))
    const { db, queries } = fakeDb()
    const result = await run(graphWith(SAMPLE), { scheduledSubjectId: OPERATOR }, effects, db)
    expect(queries.some((sql) => sql.includes("exists (select 1 from transcripts"))).toBe(false)
    expect(effects.interactionFeedback.reserveSelection).not.toHaveBeenCalled()
    expect(effects.interactionFeedback.generate.mock.calls.map((call) => (call[1] as GenerationRequest).interactionId)).toEqual(persisted)
    expect(result).toMatchObject({ nodeOutput: { selection: { persisted: true, selectedCount: 2 }, totals: { reused: 2, generated: 0 } } })
  })

  it("F/G) HOLD_FOR_QA e BLOCKED são resultados FUNCIONAIS: a ação conclui (advance), o Workflow NÃO espera QA", async () => {
    const effects = createFakeEffects()
    effects.interactionFeedback.generate.mockImplementationOnce(async (_db, request) => outcome(request, { HOLD_FOR_QA: 1 }, { reasons: ["FINDING_KIND_NOT_RELEASED_FOR_AUTONOMY"] }))
    const hold = await run(graphWith({ kind: "TRIGGER_INTERACTION" }), { interactionId: INTERACTION }, effects)
    expect(hold).toMatchObject({ kind: "advance", nextNodeId: "end", nodeOutput: { totals: { holdForQa: 1, autoDeliver: 0 } } })
    effects.interactionFeedback.generate.mockImplementationOnce(async (_db, request) => outcome(request, { BLOCKED: 1 }, { writerInvoked: false, reasons: ["INSUFFICIENT_DISPLAY_EVIDENCE"] }))
    const blocked = await run(graphWith({ kind: "TRIGGER_INTERACTION" }), { interactionId: INTERACTION }, effects)
    expect(blocked).toMatchObject({ kind: "advance", nodeOutput: { totals: { blocked: 1 }, results: [{ reasons: ["INSUFFICIENT_DISPLAY_EVIDENCE"] }] } })
    expect(hold.kind).not.toBe("wait")
  })

  it("sem interação na janela → resultado funcional vazio (nenhuma geração inventada)", async () => {
    const effects = createFakeEffects()
    const db = { query: vi.fn(async (sql: string) => (sql.includes("select id from people") ? { rows: [{ id: OPERATOR }], rowCount: 1 } : { rows: [], rowCount: 0 })) } as unknown as Database
    const result = await run(graphWith(SAMPLE), { scheduledSubjectId: OPERATOR }, effects, db)
    expect(effects.interactionFeedback.generate).not.toHaveBeenCalled()
    expect(result).toMatchObject({ kind: "advance", nodeOutput: { selection: { candidateCount: 0, selectedCount: 0 }, totals: { interactions: 0 } } })
  })

  it("H) falha técnica na geração é PROPAGADA (o motor aplica retry/backoff); módulo desligado não executa", async () => {
    const effects = createFakeEffects()
    effects.interactionFeedback.generate.mockRejectedValue(Object.assign(new Error("provider indisponível"), { name: "PROVIDER_UNAVAILABLE" }))
    await expect(run(graphWith({ kind: "TRIGGER_INTERACTION" }), { interactionId: INTERACTION }, effects)).rejects.toThrow("provider indisponível")
    flags.pipeline = "OFF"
    const off = createFakeEffects()
    await expect(run(graphWith({ kind: "TRIGGER_INTERACTION" }), { interactionId: INTERACTION }, off)).rejects.toThrow(/desligado/)
    expect(off.interactionFeedback.generate).not.toHaveBeenCalled()
  })
})

describe("V1.5.10 — publicação só quando o caminho garante uma interação válida", () => {
  const db = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database
  const row = (graph: FlowGraph, triggerConfig: Record<string, unknown>, consolidatedStructure: unknown = null) => ({ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph: graph, triggerConfig: triggerConfig as never, consolidatedStructure: consolidatedStructure as never })
  const FLAG = { kind: "channel_flag", channelFlagId: "00000000-0000-4000-8000-0000000000c1" }
  const SCHEDULE = { kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1, anchorDate: "2026-09-16" }

  it("Flag + interação do gatilho publica; Agenda + amostra do colaborador publica (nenhum Output exigido)", async () => {
    await expect(validateWorkflowForPublish(db, ORG, "wf", row(graphWith({ kind: "TRIGGER_INTERACTION" }), FLAG))).resolves.toBeTruthy()
    await expect(validateWorkflowForPublish(db, ORG, "wf", row(graphWith(SAMPLE), SCHEDULE))).resolves.toBeTruthy()
  })
  it("\"Interação que disparou o Workflow\" sem gatilho por Flag é recusada no publish (nunca só em runtime)", async () => {
    await expect(validateWorkflowForPublish(db, ORG, "wf", row(graphWith({ kind: "TRIGGER_INTERACTION" }), SCHEDULE))).rejects.toMatchObject({ code: "WORKFLOW_INTERACTION_FEEDBACK_NO_INTERACTION", details: { nodeId: "gerar" } })
    await expect(validateWorkflowForPublish(db, ORG, "wf", row(graphWith({ kind: "TRIGGER_INTERACTION" }), { kind: "indicator", indicatorCode: "TMA" }))).rejects.toMatchObject({ code: "WORKFLOW_INTERACTION_FEEDBACK_NO_INTERACTION" })
  })
  it("modo Consolidado: sem \"Aplicar individualmente\" antes (estrutura, não colaborador) é recusado", async () => {
    await expect(validateWorkflowForPublish(db, ORG, "wf", row(graphWith(SAMPLE), SCHEDULE, { kind: "SUPERVISOR_TEAM", supervisorId: "00000000-0000-4000-8000-0000000000d1" }))).rejects.toMatchObject({ code: "WORKFLOW_ACTION_INVALID_MODE", details: { nodeId: "gerar" } })
  })
  it("módulo desligado neste ambiente: a ação não publica", async () => {
    flags.pipeline = "OFF"
    await expect(validateWorkflowForPublish(db, ORG, "wf", row(graphWith(SAMPLE), SCHEDULE))).rejects.toMatchObject({ code: "WORKFLOW_INTERACTION_FEEDBACK_DISABLED" })
  })
})
