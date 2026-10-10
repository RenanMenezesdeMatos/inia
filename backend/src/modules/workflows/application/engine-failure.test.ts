import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { ModelOutputContractError } from "../../../shared/domain/model-output-contract-error.js"
import { classifyExecutionError } from "../../../shared/domain/execution-failure.js"
import { decideNodeRetry, MAX_NODE_ATTEMPTS } from "../domain/node-retry-policy.js"
import type { NodeOutcome } from "./node-handlers.js"

/**
 * V1.7.1c (§23/§24) — falha de nó classificada: transitório tenta de novo; resposta fora do contrato e invariante encerram
 * JÁ (nenhuma chamada nova), com o diagnóstico registrado — a resposta bruta só em agent_runs (caminho administrativo).
 */
const processNode = vi.fn<() => Promise<NodeOutcome>>()
vi.mock("./node-handlers.js", () => ({ processNode: () => processNode() }))

const { processEnrollment } = await import("./engine.js")
type Row = Parameters<typeof processEnrollment>[1]

const GRAPH = { nodes: [{ id: "orq", type: "end", label: "Nó", config: {}, position: { x: 0, y: 0 } }], edges: [] }
const row = (attempts: number): Row => ({
  id: "enr-1", organization_id: "org-1", workflow_id: "wf-1", version_id: "v-1", interaction_id: null, indicator_measurement_id: null, scheduled_subject_id: null, scheduled_for: null,
  current_node_id: "orq", matched_flag_name: null, matched_value_boolean: null, matched_value_numeric: null, status: "active", attempts, revision: 7, node_outputs: {}, variables: {},
  parent_enrollment_id: null, scope_type: "ALL_TEAMS", workflow_team_id: null, workflow_subteam_id: null, consolidated_structure: null, population_filter: null, claimed_until: new Date().toISOString(),
} as unknown as Row)

function fakeDb() {
  const calls: { sql: string; params: unknown[] }[] = []
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      if (sql.includes("from workflow_versions")) return { rows: [{ graph: GRAPH }], rowCount: 1 }
      if (sql.includes("insert into agent_runs")) return { rows: [{ id: "run-rejected" }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    }),
  } as unknown as Database
  const event = () => {
    const insert = calls.find((call) => call.sql.includes("insert into workflow_enrollment_events"))!
    return { type: insert.params[2] as string, payload: JSON.parse(insert.params[3] as string) as Record<string, unknown>, agentRunId: insert.params[5] as string | null }
  }
  const update = () => calls.find((call) => call.sql.includes("update workflow_enrollments") && call.sql.includes("attempts = $2"))!.params
  return { db, calls, event, update }
}

const contractError = () => {
  const error = new ModelOutputContractError("O agente não retornou a avaliação de processo (processAssessment) no formato esperado.", "AGENT_PROCESS_ASSESSMENT_INCOMPLETE", {
    contract: "PROCESS_ASSESSMENT_V1",
    contractVersion: "PROCESS_ASSESSMENT_MODEL_CONTRACT_V2",
    violations: [{ path: "processAssessment.processes.0.checkpoints.3.evidenceType", code: "EVIDENCE_TYPE_REQUIRED", message: "…" }],
    rawResponse: '{"title":"resposta do modelo com a transcrição citada"}',
  })
  Object.assign(error.diagnostics, { agentId: "agent-faturamento", model: "gemini-3.8-flash" })
  return error
}

beforeEach(() => {
  processNode.mockReset()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("V1.7.1c — classificação e política de retry (§11/§23)", () => {
  it("A/B) timeout e 503 do provedor = transitório → tenta de novo (com backoff); no limite de tentativas, encerra", () => {
    expect(classifyExecutionError(new DomainError("O agente demorou demais para responder.", "AGENT_EXECUTION_TIMEOUT", 504)).category).toBe("TRANSIENT_PROVIDER_ERROR")
    expect(classifyExecutionError(new DomainError("O modelo de IA não retornou uma resposta válida.", "AGENT_EXECUTION_FAILED", 502, { status: 503, category: "PROVIDER_ERROR" })).category).toBe("TRANSIENT_PROVIDER_ERROR")
    expect(classifyExecutionError(new DomainError("rate", "AI_RATE_LIMIT", 429, { category: "RATE_LIMIT" })).category).toBe("TRANSIENT_PROVIDER_ERROR")
    const now = new Date("2026-09-25T18:00:00Z")
    expect(decideNodeRetry("TRANSIENT_PROVIDER_ERROR", 0, now)).toMatchObject({ attempts: 1, willRetry: true, retryReason: "TRANSIENT_PROVIDER_ERROR", nextRetryAt: new Date("2026-09-25T18:05:00Z"), repairAttempt: false })
    expect(decideNodeRetry("TRANSIENT_PROVIDER_ERROR", MAX_NODE_ATTEMPTS - 1, now)).toMatchObject({ willRetry: false, retryReason: "MAX_ATTEMPTS_REACHED", nextRetryAt: null })
  })

  it("C/D/E) resposta fora do contrato → nunca entra nos 5 retries cegos; não existe reparo (repairAttempt sempre false)", () => {
    for (const code of ["AGENT_PROCESS_ASSESSMENT_INCOMPLETE", "AGENT_STRUCTURED_OUTPUT_INVALID", "AGENT_EVIDENCE_NOT_VERBATIM", "AGENT_EXECUTION_EMPTY"]) {
      expect(classifyExecutionError(new DomainError("x", code, 502)).category).toBe("MODEL_OUTPUT_CONTRACT_INVALID")
    }
    expect(classifyExecutionError(contractError()).category).toBe("MODEL_OUTPUT_CONTRACT_INVALID")
    for (const previous of [0, 2]) expect(decideNodeRetry("MODEL_OUTPUT_CONTRACT_INVALID", previous, new Date())).toMatchObject({ willRetry: false, retryReason: "MODEL_OUTPUT_CONTRACT_INVALID_NO_SAFE_REPAIR", nextRetryAt: null, repairAttempt: false })
  })

  it("F) invariante da aplicação → sem retry cego; erro desconhecido mantém o comportamento histórico (UNCLASSIFIED)", () => {
    expect(classifyExecutionError(new DomainError("O operador desta interação não está associado a um grupo.", "OPERATOR_WITHOUT_TEAM", 422)).category).toBe("APPLICATION_INVARIANT_VIOLATION")
    expect(decideNodeRetry("APPLICATION_INVARIANT_VIOLATION", 0, new Date())).toMatchObject({ willRetry: false, retryReason: "APPLICATION_INVARIANT_NOT_RETRYABLE" })
    expect(classifyExecutionError(new Error("algo inesperado")).category).toBe("UNCLASSIFIED")
    expect(decideNodeRetry("UNCLASSIFIED", 1, new Date())).toMatchObject({ willRetry: true, retryReason: "UNCLASSIFIED_LEGACY_RETRY" })
  })
})

describe("V1.7.1c — o motor aplica a decisão e registra o diagnóstico (§14/§18/§24)", () => {
  it("a MESMA situação do smoke real (2 tentativas, 3ª fora do contrato) encerra a execução: nenhuma nova tentativa, resposta bruta só em agent_runs", async () => {
    processNode.mockRejectedValue(contractError())
    const { db, calls, event, update } = fakeDb()
    await processEnrollment(db, row(2))
    expect(processNode).toHaveBeenCalledTimes(1)
    const recorded = event()
    expect(recorded.type).toBe("flow_dead")
    expect(recorded.payload).toMatchObject({
      attempts: 3,
      errorCategory: "MODEL_OUTPUT_CONTRACT_INVALID",
      errorCategoryLabel: "Resposta do Agent incompatível com o contrato",
      errorCode: "AGENT_PROCESS_ASSESSMENT_INCOMPLETE",
      willRetry: false,
      retryReason: "MODEL_OUTPUT_CONTRACT_INVALID_NO_SAFE_REPAIR",
      nextRetryAt: null,
      repairAttempt: false,
      contract: { name: "PROCESS_ASSESSMENT_V1", version: "PROCESS_ASSESSMENT_MODEL_CONTRACT_V2", violationCount: 1, violations: [{ path: "processAssessment.processes.0.checkpoints.3.evidenceType", code: "EVIDENCE_TYPE_REQUIRED" }], rawResponseStored: true },
      model: "gemini-3.8-flash",
      agentId: "agent-faturamento",
      agentRunId: "run-rejected",
    })
    expect(recorded.agentRunId).toBe("run-rejected")
    // A resposta bruta NÃO vai para o evento (que aparece em Execuções/Resultados) — só para a execução do agente.
    expect(JSON.stringify(recorded.payload)).not.toContain("resposta do modelo")
    const runFail = calls.find((call) => call.sql.includes("update agent_runs set status = 'FAILED'"))!
    expect(runFail.params).toEqual([expect.stringContaining("processAssessment"), "run-rejected", '{"title":"resposta do modelo com a transcrição citada"}'])
    const [status, attempts, nextEvalAt] = update()
    expect([status, attempts, nextEvalAt]).toEqual(["dead", 3, null])
    // Nenhum efeito de negócio: nada de feedback, Output ou emissão.
    expect(calls.some((call) => /insert into (feedbacks|workflow_output_emissions|workflow_outputs|alerts)/.test(call.sql))).toBe(false)
  })

  it("Agent direto: a resposta já ficou na própria execução (agentRunId) — o motor não cria outra", async () => {
    const error = contractError()
    Object.assign(error.diagnostics, { agentRunId: "run-direct" })
    processNode.mockRejectedValue(error)
    const { db, calls, event } = fakeDb()
    await processEnrollment(db, row(0))
    expect(calls.some((call) => call.sql.includes("insert into agent_runs"))).toBe(false)
    expect(event()).toMatchObject({ type: "flow_dead", agentRunId: "run-direct", payload: { attempts: 1, agentRunId: "run-direct" } })
  })

  it("timeout do provedor → node_failed com retry agendado e o motivo registrado", async () => {
    processNode.mockRejectedValue(new DomainError("O agente demorou demais para responder.", "AGENT_EXECUTION_TIMEOUT", 504))
    const { db, event, update } = fakeDb()
    await processEnrollment(db, row(0))
    expect(event()).toMatchObject({ type: "node_failed", payload: { attempts: 1, errorCategory: "TRANSIENT_PROVIDER_ERROR", willRetry: true, retryReason: "TRANSIENT_PROVIDER_ERROR", repairAttempt: false } })
    expect(typeof event().payload.nextRetryAt).toBe("string")
    const [status, attempts, nextEvalAt] = update()
    expect([status, attempts]).toEqual(["active", 1])
    expect(nextEvalAt).toBeInstanceOf(Date)
  })

  it("nó que decidiu falhar (aresta ausente) é invariante: encerra na 1ª vez", async () => {
    processNode.mockResolvedValue({ kind: "fail", message: 'Nó "orq" não tem aresta de saída "always".' })
    const { db, event, update } = fakeDb()
    await processEnrollment(db, row(0))
    expect(event()).toMatchObject({ type: "flow_dead", payload: { errorCategory: "APPLICATION_INVARIANT_VIOLATION", errorCode: "WORKFLOW_NODE_INVARIANT", willRetry: false } })
    expect(update()[0]).toBe("dead")
  })
})
