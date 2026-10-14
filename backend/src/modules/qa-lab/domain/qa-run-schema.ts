import { z } from "zod"
import type { KnowledgeRetrievalRecord, LlmCallRecord } from "../../../shared/application/llm-telemetry.js"
import type { FeedbackPublication } from "../../workflows/application/effect-sink.js"
import { consolidatedStructureSchema } from "../../workflows/domain/consolidated-structure-schema.js"
import { humanReviewDecisionSchema } from "../../workflows/domain/graph-schema.js"
import type { InteractionEvidence } from "../application/interaction-evidence.js"
import type { QaRunTelemetry } from "./qa-run-telemetry.js"
import type { ReviewPresentation } from "../../pending-actions/domain/review-presentation.js"

/**
 * Contrato do QA Lab — "UM RECURSO + UM CONTEXTO + UMA EXECUÇÃO". Tudo que entra aqui é escolha
 * explícita do administrador global; nada é derivado de evento/barramento.
 */
export const aiPolicySchema = z.enum(["REAL", "STOP_BEFORE_AI"])
export type AiPolicy = z.infer<typeof aiPolicySchema>

const aiControlFields = {
  aiPolicy: aiPolicySchema.default("REAL"),
  // Orçamento simples: ao atingir, a execução pausa antes da próxima chamada (nunca no meio).
  maxAiCalls: z.number().int().min(1).max(50).nullable().optional(),
}

/** QUEM/O QUÊ alimenta o Trigger — um por tipo de gatilho, sempre um dado real já existente. */
export const workflowSubjectSchema = z.discriminatedUnion("kind", [
  // Trigger por flag: uma chamada real (a flag/valor vem de interaction_flags).
  z.object({ kind: z.literal("interaction"), interactionId: z.string().uuid() }),
  // Trigger por indicador: uma medição real de um colaborador.
  z.object({ kind: z.literal("measurement"), measurementId: z.string().uuid() }),
  // Agenda em modo Individual (calendário sem estrutura consolidada, ou relativa ao expediente):
  // um colaborador.
  z.object({ kind: z.literal("operator"), operatorId: z.string().uuid() }),
  // Agenda em modo Consolidado: UMA estrutura (Equipe de Supervisor/Subgrupo/Grupo/Estrutura) —
  // pode sobrescrever a Estrutura Consolidada configurada no Workflow SÓ dentro do Simulation
  // Context.
  z.object({ kind: z.literal("unit"), consolidatedStructure: consolidatedStructureSchema }),
])
export type WorkflowSubject = z.infer<typeof workflowSubjectSchema>

export const workflowRunModeSchema = z.enum(["RUN_ALL", "STEP", "UNTIL_NODE"])
export type WorkflowRunMode = z.infer<typeof workflowRunModeSchema>

export const workflowSimulationInputSchema = z.object({
  workflowId: z.string().uuid(),
  // Testar a versão publicada (padrão, quando existe) ou o rascunho ainda não publicado.
  graphSource: z.enum(["PUBLISHED", "DRAFT"]).optional(),
  subject: workflowSubjectSchema,
  // Relógio próprio da simulação (Parte 25 do pedido). Ausente = agora.
  simulatedNow: z.iso.datetime().optional(),
  // Só pra Agenda de calendário: data/hora simulada do disparo. Ausente = simulatedNow.
  scheduledFor: z.iso.datetime().optional(),
  mode: workflowRunModeSchema.default("RUN_ALL"),
  untilNodeId: z.string().min(1).optional(),
  ...aiControlFields,
})
export type WorkflowSimulationInput = z.infer<typeof workflowSimulationInputSchema>

export const agentSimulationInputSchema = z.object({
  agentId: z.string().uuid(),
  input: z.string().trim().min(1, "Informe a entrada do agente."),
  // Opcional: injeta o mesmo contexto de operador que um especialista recebe em produção
  // (identidade, indicadores recentes, histórico de feedbacks) — ver run-specialist-tool.ts.
  operatorId: z.string().uuid().nullable().optional(),
  ...aiControlFields,
})
export type AgentSimulationInput = z.infer<typeof agentSimulationInputSchema>

export const orchestratorSimulationInputSchema = z.object({
  orchestratorId: z.string().uuid(),
  operatorId: z.string().uuid(),
  instruction: z.string().trim().min(1, "Informe a pergunta/instrução."),
  extraContext: z.string().trim().optional(),
  // Mesmo gate de produção (invocation_mode): testa o orquestrador como o chat/voz o chamaria
  // (INTERACTIVE) ou como um node de Workflow o chamaria (WORKFLOW).
  invocationContext: z.enum(["INTERACTIVE", "WORKFLOW"]).default("INTERACTIVE"),
  ...aiControlFields,
})
export type OrchestratorSimulationInput = z.infer<typeof orchestratorSimulationInputSchema>

export const qaRunDecisionSchema = z.object({
  decision: humanReviewDecisionSchema,
  // Ausente = decide o trace principal (comportamento de sempre). Presente = decide o
  // sub-trace daquele colaborador dentro de um fan-out simulado ("Aplicar individualmente" —
  // EMPLOYEE_COLLECTION), que tem seu próprio Human Review pendente independente dos demais.
  employeeId: z.string().uuid().optional(),
})
export const qaRunResumeSchema = z.object({
  // Continuar após Wait (avança o relógio até o fim da espera), após pausa de passo a passo,
  // ou após "Parar antes da IA" (trocando a política). Tudo opcional: sem nada, só continua.
  aiPolicy: aiPolicySchema.optional(),
  maxAiCalls: z.number().int().min(1).max(50).nullable().optional(),
  mode: workflowRunModeSchema.optional(),
  untilNodeId: z.string().min(1).nullable().optional(),
  // Ausente = retoma o trace principal (comportamento de sempre). Presente = retoma só o
  // sub-trace daquele colaborador dentro de um fan-out simulado — cada um pausa/retoma
  // independentemente (Parte 64 do pedido de EMPLOYEE_COLLECTION).
  employeeId: z.string().uuid().optional(),
})

// ---------------------------------------------------------------------------------------------
// Trace — o que o QA Lab mostra. Persistido em qa_runs.trace (jsonb).
// ---------------------------------------------------------------------------------------------

export type QaPerson = { id: string; name: string; role: string; teamName: string | null }

export type QaEffect =
  | {
      kind: "ALERT"
      id: number
      nodeId: string | null
      alertType: string
      recipientId: string
      title: string
      description: string
      severity: string
      caseId: string | null
      /** Superfície equivalente na UI ("Pendências"/"Notificação") — derivada do alertType/título. */
      surfaces: string[]
    }
  | { kind: "WORKFLOW_OUTPUT"; id: number; nodeId: string | null; surface: string; recipientId: string; interactionMode: string; content: unknown }
  | {
      kind: "FEEDBACK"
      id: number
      nodeId: string | null
      feedbackKind: FeedbackPublication["kind"]
      operatorId: string
      teamId: string
      caseId: string
      feedbackId: string
      title: string | null
      recommendation: string | null
      evidenceFound: string | null
      /** Materiais de apoio que a IA recomendou e o código aceitou (título real + motivo) — o que
       * seria persistido junto do Feedback. Ausente/vazio = nenhum. */
      supportMaterials?: { materialId: string; title: string; reason: string }[]
      input: unknown
    }
  | { kind: "CONFIG_VALUE"; id: number; nodeId: string | null; configKey: string; valueType: string; value: unknown; scopeType: string; teamId: string | null; subteamId: string | null }
  | { kind: "AGENT_RUN"; id: number; nodeId: string | null; runId: string; agentId: string; status: "PENDING" | "COMPLETED" | "FAILED"; outputText: string | null; errorMessage: string | null }
  /**
   * V1.5.10 — "Gerar feedback de atendimento" SIMULADO: o que a política decidiria (nada gravado, nada entregue, nada
   * notificado). Só o resultado conceitual seguro — nunca texto, trecho, prompt ou referência interna.
   */
  | {
      kind: "INTERACTION_FEEDBACK"
      id: number
      nodeId: string | null
      interactionId: string
      status: "GENERATED" | "NOT_ANALYZABLE"
      notAnalyzableReason: string | null
      feedbackStatus: string | null
      writerInvoked: boolean
      dispositions: { AUTO_DELIVER: number; HOLD_FOR_QA: number; BLOCKED: number }
      reasons: string[]
      policyVersion: string | null
    }

  /**
   * V1.5.12 — "Gerar feedback" (confiável) SIMULADO: o artefato que seria produzido (store efêmero; nada gravado, nada
   * entregue). `text` = o conteúdo EMITÍVEL (itens liberados, o que um Output publicaria) — vazio quando retido/bloqueado.
   */
  | {
      kind: "RELIABLE_FEEDBACK"
      id: number
      nodeId: string | null
      domain: "MONITORING" | "INDICATOR"
      sourceNodeId: string
      sourceType: "AGENT" | "ORCHESTRATOR"
      disposition: "READY" | "HOLD_FOR_QA" | "BLOCKED" | "REJECTED"
      itemCount: number
      emittableCount: number
      reasons: string[]
      policyVersion: string
      writerInvoked: boolean
      text: string
    }
  /** V1.5.12 — o Output publicaria o feedback confiável no Acompanhamento (simulado: ids sintéticos). */
  | { kind: "RELIABLE_FEEDBACK_EMISSION"; id: number; nodeId: string | null; surface: "FOLLOW_UP"; recipientId: string; artifactId: string; caseId: string; feedbackId: string; reused: boolean }
  /** "Avaliar política de acompanhamento" SIMULADO: a avaliação e as decisões por ação que seriam gravadas (nada gravado, nada avisado). */
  | {
      kind: "INTERVENTION_POLICY"
      id: number
      nodeId: string | null
      policyId: string
      policyName: string
      policyVersion: number | null
      personId: string
      outcome: string
      decisions: { typeKey: string; typeName: string; status: string; ruleKey: string; responsibleName: string | null; approverName: string | null; dueAt: string | null }[]
      justification: string
      reportWouldBeCreated: boolean
      narrativeWouldBeGenerated: boolean
    }

export type QaStepStatus = "completed" | "waiting" | "paused_before_ai" | "failed" | "stopped_here"

export type QaStep = {
  index: number
  nodeId: string
  nodeType: string
  label: string
  status: QaStepStatus
  startedAt: string
  simulatedNow: string
  durationMs: number
  outcome: { kind: string; branch?: string; eventType?: string; nextNodeId?: string; payload?: Record<string, unknown> } | null
  nodeOutput?: unknown
  aiCalls: number
  totalTokens: number
  error?: string
}

export type WorkflowSimulationState = {
  currentNodeId: string
  status: "active" | "waiting" | "completed" | "failed" | "paused"
  /** Por que parou (null quando ativo/completo). `FAN_IN` = aguardando "Consolidar resultados"
   * (fan-in/JOIN): pelo menos um filho do fan-out ainda não chegou a um estado terminal. */
  pauseReason: "WAIT" | "HUMAN_REVIEW" | "AI_BLOCKED" | "AI_BUDGET" | "STEP" | "UNTIL_NODE" | "FAN_IN" | null
  resumeAt: string | null
  nodeOutputs: Record<string, unknown>
  variables: Record<string, unknown>
  simulatedNow: string
  revision: number
}

/** O que precisa sobreviver entre requests pra uma simulação de Workflow ser retomada (Wait /
 * Human Review / passo a passo) — o grafo é congelado no início (editar o rascunho depois não
 * muda uma simulação em andamento, igual `version_id` pina o grafo em produção). */
export type WorkflowState = "DRAFT" | "PUBLISHED"

/**
 * Snapshot lógico da configuração testada (Parte 6/7/25 do hardening): tudo que a engine lê do
 * Workflow — grafo (rascunho atual OU versão publicada, nunca misturados), trigger, abrangência,
 * estrutura consolidada e filtro populacional — congelado no momento do "Executar". Persistido
 * em qa_runs.state.session.snapshot (jsonb, sem migration): edições posteriores no editor,
 * publicação ou até a exclusão do Workflow nunca alteram o que este QA Run testou, e "Executar
 * novamente esta versão" reexecuta exatamente isto.
 */
export type WorkflowSnapshot = {
  workflowId: string
  name: string
  workflowState: WorkflowState
  /** Id da workflow_versions publicada (só em PUBLISHED). */
  versionId: string | null
  /** Hash curto do grafo — pra UI dizer "testou o rascunho abc123" e detectar "o draft mudou". */
  graphChecksum: string
  graph: unknown
  triggerConfig: unknown
  scopeType: string
  teamId: string | null
  subteamId: string | null
  consolidatedStructure: unknown
  populationFilter: unknown
  capturedAt: string
}

/** Um sub-trace de "Aplicar individualmente" (fan-out simulado — EMPLOYEE_COLLECTION): o MESMO
 * loop de execução (`runNodeLoop`, run-workflow-simulation.ts) rodado a partir do node seguinte
 * ao fan-out, com estado/passos PRÓPRIOS por colaborador, mas sob o MESMO orçamento de IA da
 * sessão inteira (nunca resetado por colaborador). `fanOutNodeId` identifica de qual "Aplicar
 * individualmente" este colaborador nasceu — necessário pra "Consolidar resultados" (fan-in/JOIN)
 * filtrar só os filhos DESTE fan-out ao checar prontidão/montar o resultado consolidado, nunca
 * misturando com os de um fan-out sequencial anterior já resolvido (`employeeRuns` é um único
 * array acumulado pela sessão inteira, nunca resetado entre fan-outs). */
export type EmployeeRun = { employeeId: string; fanOutNodeId: string; state: WorkflowSimulationState; steps: QaStep[] }

export type WorkflowSimulationSession = {
  graph: unknown
  workflow: { scopeType: string; teamId: string | null; subteamId: string | null; consolidatedStructure?: unknown; populationFilter?: unknown }
  enrollment: Record<string, unknown>
  inputContext: string
  options: { mode: WorkflowRunMode; untilNodeId: string | null; aiPolicy: AiPolicy; maxAiCalls: number | null }
  /** Ausente só em runs anteriores a este snapshot existir. */
  snapshot?: WorkflowSnapshot
  /** Trigger por Flag: identidade + checksum da interação usada — junto com `inputContext`
   * (a transcrição) é o que "Executar novamente esta versão" reutiliza (Parte 40-43). */
  evidence?: InteractionEvidence
  /** Um item por colaborador fanned-out por "Aplicar individualmente" — ausente = nenhum fan-out
   * aconteceu ainda (ou o Workflow não usa EMPLOYEE_COLLECTION). */
  employeeRuns?: EmployeeRun[]
}

export type PersistedWorkflowState = WorkflowSimulationState & { session: WorkflowSimulationSession }

export type QaTrace = {
  steps: QaStep[]
  effects: QaEffect[]
  aiCalls: (LlmCallRecord & { agentName: string | null })[]
  /** Retrievals de KB feitos na execução — inclusive os que precederam uma request bloqueada
   * por "Parar antes da IA"/orçamento (o que TERIA entrado no prompt, sem gastar token). */
  knowledgeRetrievals?: (KnowledgeRetrievalRecord & { agentName: string | null })[]
  people: Record<string, QaPerson>
  /** Painel "Contexto utilizado" — só o que é relevante pro teste (Parte 42). */
  context: Record<string, unknown>
  /** Human Review pendente (quando status = waiting/HUMAN_REVIEW). */
  pendingReview?: { nodeId: string; reviewerIds: string[]; instruction: string | null; content: unknown; /** Apresentação legível (V1.2) — ausente em runs anteriores. */ presentation?: ReviewPresentation | null } | null
  /** Fan-out simulado (Parte 47/48 do pedido de EMPLOYEE_COLLECTION) — 1 trace agrupado por
   * colaborador dentro do MESMO QA Run, nunca N qa_runs independentes. Cada `pendingReview`
   * individual (se houver) vem embutido no próprio sub-trace — a UI resolve a partir dos steps. */
  employeeRuns?: { employeeId: string; steps: QaStep[]; status: WorkflowSimulationState["status"]; pendingReview?: QaTrace["pendingReview"] }[]
  /** Telemetria de eficiência (V1.1) — calculada por código a cada insert/update (qa-run-telemetry.ts). Ausente em runs anteriores. */
  telemetry?: QaRunTelemetry
  /** Assinatura da massa no início do run (V1.3.1 — só contagens). Ausente em runs anteriores. */
  datasetFingerprint?: import("./dataset-fingerprint.js").DatasetFingerprint | null
}
