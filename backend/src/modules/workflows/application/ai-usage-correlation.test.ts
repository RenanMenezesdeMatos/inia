import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { currentAiWorkflowCorrelation, runWithAiOrganization, runWithAiWorkflowCorrelation, type AiUsageEventInput, type AiWorkflowCorrelation } from "../../../shared/application/model-routing/ai-runtime.js"

/**
 * V1.5.13 — correlação DETERMINÍSTICA do uso de IA com a execução de Workflow: o motor abre o contexto por nó
 * (workflow → versão → disparo/raiz → matrícula → nó) e o ponto único de registro grava esses ids. Sem heurística.
 */
const seen: (AiWorkflowCorrelation | null)[] = []
vi.mock("./node-handlers.js", () => ({
  processNode: vi.fn(async () => {
    seen.push(currentAiWorkflowCorrelation())
    return { kind: "complete" }
  }),
}))

const { processEnrollment } = await import("./engine.js")
const { createAiRuntime } = await import("../../ai-management/application/ai-runtime-service.js")

const GRAPH = { nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} }, { id: "end", type: "end", label: "Fim", position: { x: 0, y: 0 }, config: {} }], edges: [] }
const fakeDb = () => {
  const calls: { sql: string; params: unknown[] }[] = []
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] })
      if (sql.includes("select graph from workflow_versions")) return { rows: [{ graph: GRAPH }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
  return { db, calls }
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "child-1", organization_id: "org-1", workflow_id: "wf-1", version_id: "ver-1", interaction_id: null, indicator_measurement_id: null,
  scheduled_subject_id: "op-1", scheduled_for: null, current_node_id: "end", matched_flag_name: null, matched_value_boolean: null, matched_value_numeric: null,
  status: "active", attempts: 0, revision: 1, node_outputs: {}, variables: {}, parent_enrollment_id: "root-1",
  scope_type: "ALL_TEAMS", workflow_team_id: null, workflow_subteam_id: null, consolidated_structure: null, population_filter: null, claimed_until: new Date().toISOString(),
  ...overrides,
}) as Parameters<typeof processEnrollment>[1]

describe("V1.5.13 — correlação do uso de IA", () => {
  it("o motor processa cada nó dentro do contexto da execução: filho de fan-out → raiz = pai; raiz → ela mesma", async () => {
    seen.length = 0
    await processEnrollment(fakeDb().db, row())
    await processEnrollment(fakeDb().db, row({ id: "root-2", parent_enrollment_id: null, current_node_id: "trigger" }))
    expect(seen).toEqual([
      { workflowId: "wf-1", workflowVersionId: "ver-1", enrollmentId: "child-1", rootEnrollmentId: "root-1", nodeId: "end" },
      { workflowId: "wf-1", workflowVersionId: "ver-1", enrollmentId: "root-2", rootEnrollmentId: "root-2", nodeId: "trigger" },
    ])
    expect(currentAiWorkflowCorrelation()).toBeNull()
  })

  const event = (): AiUsageEventInput => ({
    organizationId: "org-1", occurredAt: new Date("2026-09-24T12:00:00Z"), useCase: "FEEDBACK_WRITER", purpose: "FEEDBACK_WRITING", phase: "SYNTHESIS", source: "FEEDBACK_WRITER",
    providerKey: "GOOGLE_GENAI", connectionId: null, modelId: null, modelName: "gemini-3.1-flash-lite", isLocal: false, correlationId: "11111111-1111-4111-8111-111111111111",
    attempt: 1, fallbackIndex: 0, usage: { promptTokens: 300, outputTokens: 120, totalTokens: 420, cachedInputTokens: null, reasoningTokens: null }, durationMs: 10,
    status: "SUCCESS", errorCategory: null, routingMode: "LEGACY", routeReason: "DEFAULT_POLICY", fallbackReason: null, origin: "RUNTIME", legacyCost: null,
  })
  const insertParams = (calls: { sql: string; params: unknown[] }[]) => calls.find((call) => call.sql.includes("insert into ai_usage_events"))!.params

  it("o ponto único de registro grava workflow/versão/matrícula/raiz/nó do contexto — com os tokens REAIS informados", async () => {
    const { db, calls } = fakeDb()
    const correlation = { workflowId: "wf-1", workflowVersionId: "ver-1", enrollmentId: "child-1", rootEnrollmentId: "root-1", nodeId: "gen" }
    await runWithAiWorkflowCorrelation("org-1", correlation, () => createAiRuntime(db).recordUsage(event()))
    const params = insertParams(calls)
    expect(params.slice(-5)).toEqual(["wf-1", "ver-1", "child-1", "root-1", "gen"])
    expect(params.slice(15, 20)).toEqual([300, 120, null, null, 420])
  })

  it("fora do motor (chat, teste de modelo, QA Lab) não há correlação — nunca inventada", async () => {
    const { db, calls } = fakeDb()
    await runWithAiOrganization("org-1", () => createAiRuntime(db).recordUsage(event()))
    expect(insertParams(calls).slice(-5)).toEqual([null, null, null, null, null])
  })
})
