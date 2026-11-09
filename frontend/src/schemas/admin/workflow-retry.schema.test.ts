import { describe, expect, it } from "vitest"

import { AdminApiError } from "@/lib/admin/admin-api"

import { workflowRetryPreviewSchema, workflowRetryRefusalFrom, type WorkflowRetryPreview } from "./workflow-retry.schema"
import { ENROLLMENT_STATUS_LABELS, enrollmentStatusLabel, enrollmentStatusLabelOf, workflowEnrollmentSchema } from "./workflow.schema"

const BASE = { id: "e-1", currentNodeId: "agent", status: "active", nextEvalAt: "2026-11-03T12:00:00Z", createdAt: "2026-11-03T11:00:00Z", updatedAt: "2026-11-03T11:00:00Z", events: [] }

const PREVIEW: WorkflowRetryPreview = {
  enrollmentId: "e-1",
  workflowId: "wf-1",
  workflowName: "Monitoria",
  workflowActive: false,
  blockers: [{ code: "WORKFLOW_RETRY_WORKFLOW_INACTIVE", message: "Este Workflow está desligado. Reative-o para solicitar uma nova tentativa." }],
  workflowVersion: { id: "v4", number: 4 },
  originalVersion: { id: "v3", number: 3 },
  blockedNode: { id: "agent", label: "Analisar chamada", agentName: "Especialista" },
  agents: [],
  orchestrators: [],
  destinations: [],
  approvals: [],
  startsAt: "TRIGGER",
  fanOut: null,
  fingerprint: "fp-1",
}

describe("execução do Workflow — bloqueio (agente inativo ou acesso não autorizado) e nova tentativa (PEN-070, PEN-073, PEN-074)", () => {
  it("payload anterior ao bloqueio continua válido: campos novos caem em padrões vazios", () => {
    const parsed = workflowEnrollmentSchema.parse(BASE)
    expect(parsed).toMatchObject({ versionId: null, versionNumber: null, blockedAt: null, blockedDetails: null, retryOfEnrollmentId: null, retryAgents: [], retries: [], agentRuns: [] })
  })

  it("execução bloqueada traz o agente, a versão do Workflow e os vínculos; valores inesperados não derrubam a lista", () => {
    const parsed = workflowEnrollmentSchema.parse({
      ...BASE,
      status: "blocked",
      versionId: "v3",
      versionNumber: 3,
      blockedNodeId: "agent",
      blockedReason: "AGENT_INACTIVE",
      blockedDetails: { agentId: "ag-1", agentName: "Especialista", agentVersionId: "agv-2", agentVersionNumber: 2 },
      retryAgents: null,
      retries: [{ id: "r-1", status: "active", requestedAt: "2026-11-03T13:00:00Z", requestedByName: "Renata" }],
      agentRuns: [{ nodeId: "agent", agentRunId: "run-1", agentId: "ag-0", agentName: "Classificador", agentActive: false, agentVersionNumber: null, status: "COMPLETED" }],
    })
    expect(parsed.status).toBe("blocked")
    expect(ENROLLMENT_STATUS_LABELS[parsed.status]).toBe("Bloqueada")
    expect(enrollmentStatusLabelOf(parsed)).toBe("Bloqueada — agente inativo")
    expect(parsed.blockedDetails).toEqual({ agentId: "ag-1", agentName: "Especialista", agentVersionId: "agv-2", agentVersionNumber: 2 })
    expect(parsed.retryAgents).toEqual([])
    expect(parsed.retries[0]).toMatchObject({ id: "r-1", requestedByName: "Renata" })
    expect(parsed.agentRuns[0]).toMatchObject({ agentActive: false, agentVersionNumber: null })
    expect(enrollmentStatusLabel("blocked")).toBe("Bloqueada")
    expect(enrollmentStatusLabel("desconhecido")).toBe("desconhecido")
  })

  it("bloqueio por acesso não autorizado (revisão de 03/11/2026): rótulo pelo motivo e o detalhe da negação; motivo inesperado cai no genérico", () => {
    const parsed = workflowEnrollmentSchema.parse({
      ...BASE,
      status: "blocked",
      blockedReason: "AGENT_ACCESS_NOT_AUTHORIZED",
      blockedDetails: { agentId: "ag-1", agentName: "Especialista", agentVersionId: "agv-4", agentVersionNumber: 4, denial: "SCOPE" },
      retryAgents: [{ nodeId: "agent", agentId: "ag-1", nodeLabel: "Analisar chamada", agentName: "Especialista", agentVersionId: "agv-4", agentVersionNumber: 4, active: true }],
    })
    expect(enrollmentStatusLabelOf(parsed)).toBe("Bloqueada — acesso não autorizado")
    expect(parsed.blockedDetails?.denial).toBe("SCOPE")
    expect(parsed.retryAgents[0]).toMatchObject({ nodeId: "agent", agentId: "ag-1", agentVersionNumber: 4 })
    expect(enrollmentStatusLabelOf({ status: "blocked", blockedReason: "OUTRO" })).toBe("Bloqueada")
    expect(enrollmentStatusLabelOf({ status: "completed", blockedReason: null })).toBe("Concluído")
  })

  it("prévia da nova tentativa: agentes de cada Orquestrador na versão vigente, AFTER_FAN_OUT e o vínculo com a execução principal; prévia antiga cai nos padrões", () => {
    const parsed = workflowRetryPreviewSchema.parse({
      ...PREVIEW,
      startsAt: "AFTER_FAN_OUT",
      fanOut: { parentEnrollmentId: "p-1", parentStatus: "waiting", joinsConsolidation: true },
      orchestrators: [
        {
          nodeId: "orq",
          nodeLabel: "Responder",
          orchestratorId: "o-1",
          orchestratorName: "INIA — Contas",
          orchestratorVersionId: "ov-2",
          orchestratorVersionNumber: 2,
          agents: [{ agentId: "a-1", agentName: "Coordenação", role: "ORCHESTRATOR_AGENT", agentVersionId: "av-3", agentVersionNumber: 3, active: true }],
        },
      ],
    })
    expect(parsed.startsAt).toBe("AFTER_FAN_OUT")
    expect(parsed.fanOut).toEqual({ parentEnrollmentId: "p-1", parentStatus: "waiting", joinsConsolidation: true })
    expect(parsed.orchestrators[0]!.agents[0]).toMatchObject({ role: "ORCHESTRATOR_AGENT", agentVersionNumber: 3 })

    const { fanOut: _fanOut, ...legacy } = PREVIEW
    void _fanOut
    const old = workflowRetryPreviewSchema.parse({ ...legacy, orchestrators: [{ nodeId: "orq", nodeLabel: "Responder", orchestratorId: "o-1", orchestratorName: null, orchestratorVersionId: null, orchestratorVersionNumber: null }] })
    expect(old.fanOut).toBeNull()
    expect(old.orchestrators[0]!.agents).toEqual([])
  })

  it("recusas da confirmação: o diálogo trata as conhecidas (com a prévia nova quando vem) e deixa o resto para o toast", () => {
    const reconfirm = workflowRetryRefusalFrom(new AdminApiError("mudou", "WORKFLOW_RETRY_RECONFIRM", { preview: PREVIEW }))
    expect(reconfirm).toEqual({ code: "WORKFLOW_RETRY_RECONFIRM", message: "mudou", preview: PREVIEW })
    expect(workflowRetryRefusalFrom(new AdminApiError("em andamento", "WORKFLOW_RETRY_IN_PROGRESS"))).toEqual({ code: "WORKFLOW_RETRY_IN_PROGRESS", message: "em andamento", preview: null })
    expect(workflowRetryRefusalFrom(new AdminApiError("desligado", "WORKFLOW_RETRY_WORKFLOW_INACTIVE", { preview: { broken: true } }))?.preview).toBeNull()
    // Impedimentos novos (revisão de 03/11/2026) também ficam no diálogo; a filha de "Selecionar colaboradores" não é mais recusada por ser filha.
    for (const code of ["WORKFLOW_AGENT_NOT_PUBLISHED", "WORKFLOW_AGENT_NOT_AUTHORIZED", "WORKFLOW_RETRY_FAN_OUT_MISSING"]) {
      expect(workflowRetryRefusalFrom(new AdminApiError("impedido", code))?.code).toBe(code)
    }
    expect(workflowRetryRefusalFrom(new AdminApiError("filha", "WORKFLOW_RETRY_FAN_OUT_CHILD"))).toBeNull()
    expect(workflowRetryRefusalFrom(new AdminApiError("outro", "SOMETHING_ELSE"))).toBeNull()
    expect(workflowRetryRefusalFrom(new Error("rede"))).toBeNull()
  })
})
