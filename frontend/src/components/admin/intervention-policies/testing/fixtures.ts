import { vi } from "vitest"

import type { CapabilityCatalog, EditorCatalog, InterventionTypeView, PolicyDefinition, PolicyView } from "@/schemas/admin/intervention-policy.schema"

/** Dados de teste da administração de políticas (nunca chamam API real). */
export function createServiceMock() {
  return {
    fetchCapabilityCatalog: vi.fn(),
    fetchEditorCatalog: vi.fn().mockResolvedValue(EDITOR_CATALOG),
    fetchInterventionTypes: vi.fn(),
    createInterventionType: vi.fn(),
    saveInterventionTypeDraft: vi.fn(),
    validateInterventionType: vi.fn(),
    publishInterventionType: vi.fn(),
    discardInterventionTypeDraft: vi.fn(),
    setInterventionTypeActive: vi.fn(),
    fetchCompetencies: vi.fn(),
    createCompetency: vi.fn(),
    updateCompetency: vi.fn(),
    setCompetencyActive: vi.fn(),
    fetchPolicies: vi.fn(),
    fetchPolicy: vi.fn(),
    createPolicy: vi.fn(),
    updatePolicyHeader: vi.fn(),
    savePolicyDraft: vi.fn(),
    validatePolicy: vi.fn(),
    publishPolicy: vi.fn(),
    discardPolicyDraft: vi.fn(),
    setPolicyActive: vi.fn(),
    fetchPublishedPolicySummaries: vi.fn(),
    searchSimulationPeople: vi.fn(),
    simulatePolicy: vi.fn(),
    fetchPolicyAudit: vi.fn(),
    fetchPolicyEvaluations: vi.fn(),
    reevaluate: vi.fn(),
  }
}

export const EDITOR_CATALOG: EditorCatalog = {
  teams: [{ id: "team-1", name: "Atendimento", operationId: "op-1", subteams: [{ id: "sub-1", teamId: "team-1", name: "Manhã" }] }],
  unrestricted: true,
  indicators: [{ code: "TMA", name: "Tempo médio de atendimento", unit: "SECONDS", active: true, dailySupported: true, officialClosureSupported: true }],
  documents: [{ id: "doc-1", title: "Procedimento de espera", published: true }],
  flags: [{ channel: "VOICE", flagName: "rechamada", valueType: "BOOLEAN", description: "Cliente voltou a ligar", active: true }],
}

export const CAPABILITIES = {
  canEditInterventionPolicies: true,
  canSimulateInterventionPolicies: true,
  canPublishInterventionPolicies: true,
  canAuditInterventionPolicies: true,
  canManageWorkflows: false,
}

export const CATALOG: CapabilityCatalog = {
  capabilities: [
    { key: "TASKS", label: "Tarefas", description: "Lista de tarefas.", allowedOnInconclusive: false, assertsSkillGap: false, implies: [] },
    { key: "OBSERVATION", label: "Observação", description: "Foco e período de observação.", allowedOnInconclusive: true, assertsSkillGap: false, implies: [] },
    { key: "TRAINING", label: "Treinamento", description: "Ligado a uma competência.", allowedOnInconclusive: false, assertsSkillGap: true, implies: [] },
    { key: "CONTINUITY_REVIEW", label: "Solicitar avaliação de continuidade", description: "Processo humano restrito.", allowedOnInconclusive: false, assertsSkillGap: false, implies: [] },
  ],
  evidenceKinds: [{ key: "EVALUATION", label: "Avaliação da política" }],
}

const NOW = "2026-10-01T12:00:00.000Z"

export const OBSERVE_TYPE: InterventionTypeView = {
  id: "t1",
  key: "OBSERVAR",
  active: true,
  published: {
    id: "tv1",
    version: 1,
    status: "PUBLISHED",
    updatedAt: NOW,
    publishedAt: NOW,
    definition: { schemaVersion: "INTERVENTION_TYPE_V1", name: "Observação", description: "", capabilities: ["OBSERVATION"], responsibleRole: "SUPERVISOR", defaultDueDays: 15, approval: { required: false }, evidence: { minimumItems: 1, acceptedKinds: ["EVALUATION"] }, form: [], completion: { requireAllTasksDone: false, requireLearningAssessment: false, requireOperationalReading: false, requireOutcomeNote: true }, incompatibleWith: [], aiDraft: false },
  },
  draft: null,
  versions: [],
  usage: { active: 0, total: 0 },
}

export const EMPTY_DEFINITION: PolicyDefinition = { schemaVersion: "INTERVENTION_POLICY_V1", description: "", indicatorCode: null, matchStrategy: "FIRST_MATCH", rules: [], report: { aiNarrative: false } }

export function policyWithDraft(definition: PolicyDefinition = EMPTY_DEFINITION, overrides: Partial<PolicyView> = {}): PolicyView {
  const draft = { id: "pv1", version: 1, status: "DRAFT" as const, definition, updatedAt: NOW, publishedAt: null, effectiveFrom: null }
  return {
    id: "p1",
    key: "ACOMPANHAMENTO_TMA",
    name: "Acompanhamento de TMA",
    scopeType: "ORGANIZATION",
    teamId: null,
    subteamId: null,
    active: true,
    scopeLabel: "Organização inteira",
    draft,
    inForce: null,
    scheduled: [],
    versions: [draft],
    evaluations: { last30Days: 0 },
    can: { edit: true, publish: true, simulate: true, audit: true },
    ...overrides,
  }
}
