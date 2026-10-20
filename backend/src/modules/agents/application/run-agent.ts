import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { AiCallBlockedError, withLlmScope, type LlmRequestClassification, type LlmSemanticType } from "../../../shared/application/llm-telemetry.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { productionAgentRuns, type AgentRunRecorder, type AgentRunSource } from "../../workflows/application/effect-sink.js"
import type { createMonitoringFeedback, StructuredMonitoringFeedback } from "../../feedbacks/application/create-monitoring-feedback.js"
import type { createIndicatorFeedback, StructuredIndicatorFeedback } from "../../feedbacks/application/create-indicator-feedback.js"
import { buildSystemPromptWithTrace, type AgentConfig } from "./build-system-prompt.js"
import { attachKnowledgeTrace } from "../../../shared/application/llm-telemetry.js"
import { loadInteractionSubject, withoutCheckpointCatalog, type KnowledgeTrace } from "../../knowledge/application/retrieve-knowledge.js"
import { processAuditSchema, verifyProcessAudit, type VerifiedProcessAudit } from "../domain/process-audit.js"
import { PROCESS_ASSESSMENT_CONTRACT, PROCESS_ASSESSMENT_INSTRUCTIONS_V5, PROCESS_ASSESSMENT_MODEL_CONTRACT_V5, PROCESS_ASSESSMENT_MODEL_CONTRACT_VERSION, validateProcessAssessmentOutput, type PresentedExcerptForContract, type RawProcessAssessment } from "../domain/process-assessment-contract.js"
import { ModelOutputContractError } from "../../../shared/domain/model-output-contract-error.js"
import { closingPhaseReached } from "../../reliable-feedback/domain/verified-omission.js"
import type { CheckpointGovernanceSnapshot, ProcessCheckpointCatalog } from "../../reliable-feedback/domain/checkpoint-catalog.js"
import { INDICATOR_DIAGNOSIS_INSTRUCTIONS, parseInteractionAssessments, type InteractionAssessment } from "../domain/indicator-diagnosis-contract.js"
import {
  buildSupportMaterialCandidates,
  buildSupportMaterialsOutputField,
  buildSupportMaterialsPromptSection,
  extractSupportMaterialsMarker,
  mergeSupportMaterialCandidates,
  selectSupportMaterialRecommendations,
  type SupportMaterialCandidate,
  type SupportMaterialsOutcome,
} from "../../feedbacks/domain/support-material.js"
import { effectiveCapabilities, normalizeCapabilities, type InvestigationCapability } from "../../investigation/domain/capabilities.js"
import type { InvestigationSummary, ToolInvocationTrace } from "../../investigation/domain/tool-trace.js"
import { accountRequests, runInvestigation, type InvestigationOutcome } from "../../investigation/application/investigation-runtime.js"
import { claimSupportOptionsOf, stripInternalRefs } from "../../investigation/domain/evidence-gating.js"
import { buildClaimCandidates } from "../../investigation/domain/claim-candidates.js"
import { criticalFactsOf } from "../../investigation/domain/decision-critical-facts.js"
import { foldTemporalClaims } from "../../investigation/domain/temporal-semantics.js"
import { escalateRoute, generateForRoute, routeFor, routeRecordOf } from "../../../shared/application/model-routing/llm-gateway.js"
import { ASSESSMENT_COVERAGE_REPAIR_PURPOSE, ASSESSMENT_COVERAGE_REPAIR_TAG, completeAssessmentCoverage, type CoverageRepairCall } from "./assessment-coverage-repair.js"
import { completeDiagnosisCoverage, INDICATOR_DIAGNOSIS_REPAIR_TAG } from "./indicator-diagnosis-repair.js"
import { STRUCTURED_OUTPUT_RETRY_TAG, STRUCTURED_OUTPUT_RETRY_TRIGGER, withStructuredOutputRetry, type StructuredOutputRetryTelemetry } from "./structured-output-retry.js"
import type { DiagnosisAssessmentCoverage } from "../domain/indicator-diagnosis-coverage.js"
import { estimateTokens } from "../../../shared/application/model-routing/token-estimate.js"
import { composeUserTurn } from "../../../shared/application/prompting/prompt-components.js"
import type { LedgerEntry } from "../../investigation/domain/evidence-ledger.js"
import { gateStructuredReply, gateTextReply, StructuredGatingError } from "../../investigation/application/text-evidence-gating.js"
import { assembleAgentSynthesisPrompt, type SynthesisPromptInput } from "./agent-synthesis-prompt.js"
import { loadSubject, type InvestigationPeriod } from "../../investigation/application/tool-context.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateOf } from "../../workflows/application/time-window.js"

/** Formato da análise pedido pelo Workflow a um Agent de chamada (Flag + transcrição) —
 * FEEDBACK (padrão, comportamento de sempre), PROCESS_AUDIT (conformidade etapa a etapa contra o
 * procedimento oficial da KB) ou PROCESS_ASSESSMENT (V1.6.0: monitoria PROCESS-CENTRIC — processos
 * aplicáveis × etapas × evidência × regra da base, verificado pela camada de confiabilidade). É decisão
 * do Workflow, não do Agent: o mesmo Especialista de Faturamento serve aos três. */
export type AgentOutputContract = "FEEDBACK" | "PROCESS_AUDIT" | "PROCESS_ASSESSMENT" | "INDICATOR_DIAGNOSIS"

/**
 * V1.6.1 — diagnóstico do indicador que segue na saída do Agent: a AMOSTRA escolhida pelo sistema (handle → atendimento) e a
 * avaliação de processo PROPOSTA por atendimento. Nada disso é confiável por si: "Gerar feedback" recalcula o plano e verifica.
 */
export type AgentIndicatorDiagnosis = { measurementId: string; strategyVersionId: string | null; sample: { handle: string; interactionId: string }[]; interactionAssessments: InteractionAssessment[]; /** V1.0.1 — cobertura da avaliação por chamada (primeira resposta × reparo único). Ausente = sem plano de reparo. */ coverage?: DiagnosisAssessmentCoverage; /** V1.0.2 — retry técnico do structured output (separado do reparo semântico). */ structuredOutput?: StructuredOutputRetryTelemetry }

/** V1.6.0 — trecho de KB que ENTROU no prompt desta execução (o rastro, não o que o modelo diz ter lido). É o que permite à
 * camada de confiabilidade provar que uma citação da base veio de um trecho efetivamente apresentado nesta chamada. */
export type AgentKnowledgeExcerpt = { documentId: string; documentTitle: string; heading: string; excerpt: string; /** V1.7.1d — posição do trecho no documento. */ chunkIndex?: number }

/**
 * O que um Agent node precisa pra, mais tarde, um node Output (não mais o próprio runAgent)
 * publicar um Feedback/SupervisionCase — exatamente os argumentos de createMonitoringFeedback/
 * createIndicatorFeedback, já montados aqui onde todo o contexto determinístico (flags,
 * indicadores, metas) está disponível. runAgent nunca decide se/quando isso é publicado.
 */
/** `supportMaterials` (metadata semântica da resposta, ver feedbacks/domain/support-material.ts)
 * viaja no TOPO do resultado — o Workflow só transporta; quem decide apresentar é o Output
 * (`includeSupportMaterials`), que então repassa ao publicador do Feedback. */
export type AgentWorkflowResult = (
  | { kind: "monitoring"; input: Omit<Parameters<typeof createMonitoringFeedback>[1], "supportMaterials" | "supportMaterialsRejected">; knowledgeExcerpts?: AgentKnowledgeExcerpt[]; /** Checkpoint Registry — recorte aplicado no prompt (a verificação aplica o mesmo). */ checkpointGovernance?: CheckpointGovernanceSnapshot }
  | { kind: "indicator"; input: Omit<Parameters<typeof createIndicatorFeedback>[1], "supportMaterials" | "supportMaterialsRejected">; knowledgeExcerpts?: AgentKnowledgeExcerpt[]; diagnosis?: AgentIndicatorDiagnosis; checkpointGovernance?: CheckpointGovernanceSnapshot }
) &
  SupportMaterialsOutcome &
  InvestigationOutcomeFields

/** Trace seguro das Tools de investigação (investigation/domain/tool-trace.ts) — presente só
 * quando o Agent investigou. O Workflow transporta; Revisão humana/QA Lab/Feedback mostram. */
export type InvestigationOutcomeFields = {
  toolTrace?: ToolInvocationTrace[]
  investigation?: InvestigationSummary
}


const COMPARATOR_TEXT: Record<string, string> = {
  EQUALS: "é igual a",
  GT: "é maior que",
  LT: "é menor que",
  GTE: "é maior ou igual a",
  LTE: "é menor ou igual a",
}

const structuredFeedbackSchema = z.object({
  title: z.string().trim().min(2),
  summary: z.string().trim().min(2),
  impactedIndicator: z.string().trim().min(1),
  evidenceFound: z.string().trim().min(1),
  observedBehavior: z.string().trim().min(1),
  relatedProcedure: z.string().trim().min(1),
  recommendation: z.string().trim().min(1),
})

const structuredIndicatorFeedbackSchema = z.object({
  title: z.string().trim().min(2),
  summary: z.string().trim().min(2),
  relatedProcedure: z.string().trim().min(1),
  recommendation: z.string().trim().min(1),
})

export type WorkflowRunContext =
  | {
      kind: "channel_flag"
      interactionId: string
      operatorId: string
      teamId: string
      startedAt: string
      flagName: string
      matchedValueBoolean: boolean | null
      matchedValueNumeric: string | null
      comparator: string
      thresholdBoolean: boolean | null
      thresholdNumeric: string | null
      outputContract?: AgentOutputContract | undefined
    }
  | {
      kind: "indicator"
      operatorId: string
      teamId: string
      // null quando o valor vem de um resumo agregado de período (ver periodSummary), não
      // de uma medição específica.
      indicatorMeasurementId: string | null
      measuredAt: string
      indicatorCode: string
      indicatorName: string
      unit: string
      value: number
      targetValue: number | null
      comparator: string
      thresholdNumeric: string | null
      periodSummary?: { measurementIds: string[]; periodLabel: string; periodStart: string; periodEnd: string }
      /** V1.6.1 — formato INDICATOR_DIAGNOSIS: a amostra do sistema (a transcrição dela já está no inputContext). */
      outputContract?: AgentOutputContract | undefined
      diagnosisSample?: { measurementId: string; strategyVersionId: string | null; sample: { handle: string; interactionId: string }[] } | undefined
      /** Indicator Diagnosis V1 — plano de cobertura do encerramento para as chamadas da amostra (motivo investigado). Ausente = sem. */
      diagnosisCoverage?: { subject: string | null; /** V1.0.1 — reparo seletivo por chamada (faltantes + inconsistentes), no máximo um por chamada e até o limite. */ repair?: { maxInteractions: number; conversations: { handle: string; transcript: string }[] } } | undefined
    }
  | {
      kind: "indicator_summary"
      operatorId: string
      teamId: string
      periodLabel: string
      periodStart: string
      periodEnd: string
      /** Proveniência da evidência — "indicator_period_summary" (médias de medições, padrão) ou
       * "employee_performance" (fechamentos oficiais de employee_*_performance, ver
       * callAgentForPerformance em action-executors.ts). */
      evidenceSourceType?: "indicator_period_summary" | "employee_performance" | undefined
      indicators: {
        code: string
        name: string
        unit: string
        value: number
        targetValue: number | null
        direction: string
        measurementIds: string[]
      }[]
    }

export const STRUCTURED_OUTPUT_INSTRUCTIONS = `
Responda SOMENTE com um JSON válido (sem markdown, sem texto fora do JSON), neste formato exato:
{
  "title": "título curto do caso, até 80 caracteres",
  "summary": "resumo em 1-2 frases do que foi encontrado",
  "impactedIndicator": "o que foi avaliado (ex.: nome da flag ou critério de monitoria)",
  "evidenceFound": "uma citação LITERAL e EXATA de um trecho da transcrição — copie e cole, nunca parafraseie ou invente",
  "observedBehavior": "em 1 frase curta, o que o operador fez ou deixou de fazer",
  "relatedProcedure": "o TÍTULO EXATO do documento (como aparece depois de ### em 'Bases de conhecimento disponíveis') ou da expectativa de chamada usada — nunca invente um nome de procedimento que não esteja literalmente nas fontes fornecidas",
  "recommendation": "o feedback em si, escrito como um texto corrido dirigido diretamente ao operador (2ª pessoa: 'você'), não uma lista de campos genéricos. Antes de escrever, escolha UM documento (pelo título exato) ou UMA expectativa de chamada — a mais relevante para o motivo desta ligação — e ignore o resto; não misture vários procedimentos no mesmo feedback. Se nenhum documento ou expectativa cobrir esta situação específica, diga isso explicitamente ('não há um procedimento específico cadastrado para este caso, a orientação a seguir é uma boa prática geral') em vez de inventar um. Nunca crie nome de procedimento, número de item/seção ou regra que não apareça literalmente no texto fornecido. Estruture o texto assim: cite um trecho literal da fonte escolhida entre aspas (copie palavras do documento/expectativa, não parafraseie a ponto de mudar o sentido); mostre o contraste 'o procedimento diz [trecho citado], mas você...' usando o que realmente aconteceu na chamada, citando a evidência entre aspas (o mesmo trecho de evidenceFound); sugira de 2 a 4 ações concretas para a próxima vez, cada uma começando com um hífen '-' em sua própria linha; dê um exemplo de frase que o operador poderia ter dito, entre aspas; termine com uma dica específica para este tipo de situação (nunca uma dica genérica que serviria para qualquer chamada). Separe os parágrafos com uma linha em branco. Texto simples, sem markdown — nunca use #, ## ou **."
}
Todos os campos são obrigatórios. "evidenceFound" precisa ser um trecho que existe literalmente no texto de entrada.`

const PROCESS_AUDIT_INSTRUCTIONS = `
Além dos campos acima, inclua no MESMO JSON o campo "processAudit" com a análise de conformidade etapa a etapa:
"processAudit": {
  "procedureTitle": "o TÍTULO EXATO do documento da base de conhecimento usado como procedimento oficial (como aparece depois de ###). Se nenhum documento cobrir esta chamada, escreva 'Nenhum procedimento específico cadastrado' e use status NAO_APLICAVEL em todas as etapas",
  "steps": [
    {
      "step": "nome da etapa esperada, com as palavras do procedimento oficial (nunca invente etapa que não esteja no documento recuperado)",
      "status": "CONFORME | NAO_CONFORME | NAO_FOI_POSSIVEL_CONFIRMAR | NAO_APLICAVEL",
      "evidence": "trecho LITERAL e EXATO da transcrição que sustenta CONFORME ou NAO_CONFORME (copie e cole; nunca parafraseie, nunca invente, nunca troque quem fala). Use null quando o status for NAO_FOI_POSSIVEL_CONFIRMAR ou NAO_APLICAVEL",
      "knowledgeReference": "título exato do documento + seção (ex.: 'Procedimento X — Seção 3. Etapas') de onde vem a etapa; null se a base não a descreve",
      "note": "uma frase objetiva sobre o que foi observado, separando fato de hipótese"
    }
  ]
}
Regras de conformidade: (1) NAO_CONFORME exige evidência literal do que o operador fez em desacordo com o procedimento — nunca conclua NAO_CONFORME só porque não encontrou a etapa na transcrição; nesse caso use NAO_FOI_POSSIVEL_CONFIRMAR. (2) CONFORME também exige evidência literal. (3) NAO_APLICAVEL é para etapas que o procedimento prevê mas que não cabem nesta situação específica. (4) Nunca crie regra, prazo ou etapa que não esteja literalmente no texto recuperado da base.`

const STRUCTURED_OUTPUT_INSTRUCTIONS_INDICATOR = `
Responda SOMENTE com um JSON válido (sem markdown, sem texto fora do JSON), neste formato exato:
{
  "title": "título curto do caso, até 80 caracteres",
  "summary": "resumo em 1-2 frases do que foi encontrado",
  "relatedProcedure": "o TÍTULO EXATO do documento (como aparece depois de ### em 'Bases de conhecimento disponíveis') que orienta como melhorar esse indicador — nunca invente um nome que não esteja literalmente nas fontes fornecidas; se nenhum documento cobrir o caso, escreva 'Nenhum procedimento específico cadastrado'",
  "recommendation": "o feedback em si, escrito como texto corrido dirigido diretamente ao operador (2ª pessoa: 'você'). Use SOMENTE os números fornecidos no contexto (valor medido, meta, quanto falta) — nunca calcule, arredonde ou invente um número que não esteja lá. Sugira de 2 a 4 ações concretas para melhorar o indicador, cada uma começando com um hífen '-' em sua própria linha. Termine com uma dica específica para esse indicador (nunca uma dica genérica). Separe os parágrafos com uma linha em branco. Texto simples, sem markdown."
}
Todos os campos são obrigatórios.`

const STRUCTURED_OUTPUT_INSTRUCTIONS_INDICATOR_SUMMARY = `
Responda SOMENTE com um JSON válido (sem markdown, sem texto fora do JSON), neste formato exato:
{
  "title": "título curto do caso, até 80 caracteres",
  "summary": "resumo em 1-2 frases do panorama geral do período",
  "relatedProcedure": "o TÍTULO EXATO do documento (como aparece depois de ### em 'Bases de conhecimento disponíveis') mais relevante pros indicadores que ficaram abaixo da meta — nunca invente um nome que não esteja literalmente nas fontes fornecidas; se nenhum documento cobrir o caso, escreva 'Nenhum procedimento específico cadastrado'",
  "recommendation": "um resumo geral corrido dirigido diretamente ao operador (2ª pessoa: 'você'), cobrindo TODOS os indicadores listados no contexto — não invente nem omita nenhum. Use SOMENTE os números fornecidos (valor médio do período, meta, quanto falta) — nunca calcule, arredonde ou invente um número que não esteja lá. Para cada indicador fora da meta, uma frase objetiva de orientação; indicadores dentro da meta podem ser citados brevemente como ponto positivo. Termine com 1-2 ações concretas prioritárias pro próximo período. Separe os parágrafos com uma linha em branco. Texto simples, sem markdown."
}
Todos os campos são obrigatórios.`

/** Tamanho mínimo (depois de normalizar) de uma citação inteira para valer como evidência — com pelo menos duas palavras. */
export const MIN_VERBATIM_EVIDENCE_LENGTH = 12

/**
 * Citação literal: o trecho inteiro existe na transcrição — ou, quando o modelo marca omissão com
 * reticências ("… / ..." ou "[...]"), CADA segmento (≥ 15 caracteres) existe literalmente. Emendar
 * dois trechos reais com reticências não fabrica fala; emendar sem marcar, ou parafrasear, continua
 * rejeitado. Aspas em volta de cada fala ("Cliente: 'Retorno quando?'") são formatação, não conteúdo:
 * saem da comparação dos dois lados (V1.3 — as palavras continuam tendo que ser as da transcrição).
 */
export function isVerbatimEvidence(transcript: string, evidence: string): boolean {
  const haystack = normalizeForComparison(transcript)
  const whole = normalizeForComparison(evidence)
  // Um trecho mínimo é condição para ser evidência (achado AI-07 da auditoria de 17/10/2026): "o", "sim" ou uma aspa solta
  // (que vira "" e está em qualquer texto) não apontam fala nenhuma.
  if (whole.length < MIN_VERBATIM_EVIDENCE_LENGTH || whole.split(" ").length < 2) return false
  if (haystack.includes(whole)) return true
  const segments = evidence.split(/\s*(?:\[\s*(?:\.\.\.|…)\s*\]|\.\.\.|…)\s*/).map((segment) => normalizeForComparison(segment)).filter((segment) => segment.length > 0)
  if (segments.length < 2) return false
  return segments.every((segment) => segment.length >= 15 && haystack.includes(segment))
}

/** Espaços colapsados e ASPAS removidas (o modelo troca "…" por '…' ao escapar JSON ou envolve cada fala em aspas — a citação continua literal em conteúdo). */
function normalizeForComparison(text: string): string {
  return text.replace(/[\u201C\u201D\u2018\u2019"']/g, "").replace(/\s+/g, " ").trim()
}

/** V1.7.4 — `processAssessment` presente = objeto (não nulo, não lista). */
function isAssessmentObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseJsonOutput(raw: string): unknown {
  const stripped = raw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim()
  try {
    return JSON.parse(stripped)
  } catch {
    // Tolerância mínima: texto antes/depois do objeto (visto ao vivo em 2026-09-17 com o dossiê
    // de investigação no input — o modelo às vezes abre com uma frase). Só recorta o primeiro
    // "{" até o último "}"; nunca reinterpreta o conteúdo.
    const start = stripped.indexOf("{")
    const end = stripped.lastIndexOf("}")
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(stripped.slice(start, end + 1))
      } catch {
        // cai no erro abaixo
      }
    }
    console.warn(JSON.stringify({ event: "agent_structured_output_invalid", preview: stripped.slice(0, 200) }))
    throw new ModelOutputContractError("O agente não retornou um JSON válido.", "AGENT_STRUCTURED_OUTPUT_INVALID", { contract: "STRUCTURED_JSON", violations: [{ path: "$", code: "JSON_INVALID", message: "A resposta não é um JSON válido." }], rawResponse: raw })
  }
}

/**
 * `supportMaterialCandidates` = os materiais que ESTA execução colocou no prompt (ver
 * feedbacks/domain/support-material.ts). Sem candidatos (chamada sem KB, especialista via
 * Orquestrador que não expôs candidatos), qualquer "supportMaterials" que o modelo devolva é
 * ignorado — nunca aceito por vir do LLM.
 */
export function parseStructuredFeedback(
  raw: string,
  transcript: string,
  outputContract: AgentOutputContract = "FEEDBACK",
  supportMaterialCandidates: SupportMaterialCandidate[] = [],
  /** V1.7.1c — trechos da base apresentados NESTA chamada (definem o teto de etapas por processo); null = só a trava técnica. */
  presented: readonly PresentedExcerptForContract[] | null = null,
  /** V1.7.1n — catálogo de etapas marcado no prompt ([CP-…]): contrato V3 (checkpointRef obrigatório, cobertura obrigatória). */
  catalog: ProcessCheckpointCatalog | null = null,
): StructuredMonitoringFeedback & SupportMaterialsOutcome {
  const json = parseJsonOutput(raw)
  // V1.7.4 — na avaliação de processo o `processAssessment` é o campo OBRIGATÓRIO da resposta: ausente (ou não objeto) é
  // structured output inválido — o mesmo gatilho do retry técnico homologado (STRUCTURED_OUTPUT_RETRY_V1: no máximo UMA repetição
  // só com o aviso de formato); persistindo, falha fechada. Verificado antes de qualquer outro campo: sem ele não há análise.
  if (outputContract === "PROCESS_ASSESSMENT" && !isAssessmentObject((json as { processAssessment?: unknown } | null)?.processAssessment)) {
    throw new ModelOutputContractError("O agente não retornou o campo obrigatório processAssessment.", STRUCTURED_OUTPUT_RETRY_TRIGGER, { contract: PROCESS_ASSESSMENT_CONTRACT, contractVersion: PROCESS_ASSESSMENT_MODEL_CONTRACT_V5, violations: [{ path: "processAssessment", code: "PROCESS_ASSESSMENT_MISSING", message: "O campo obrigatório processAssessment não veio como objeto." }], rawResponse: raw })
  }
  const parsed = structuredFeedbackSchema.safeParse(json)
  if (!parsed.success) {
    throw new ModelOutputContractError("O agente não retornou todos os campos obrigatórios do feedback.", "AGENT_STRUCTURED_OUTPUT_INCOMPLETE", { contract: "STRUCTURED_FEEDBACK", violations: violationsOf(parsed.error), rawResponse: raw })
  }
  const verbatim = isVerbatimEvidence(transcript, parsed.data.evidenceFound)
  // V1.7.4 — AVALIAÇÃO DE PROCESSO: a evidência que vale é a do `processAssessment` (cada fala conferida por turno e falante na
  // confiabilidade); o campo legado `evidenceFound` não sustenta nada quando a avaliação existe. Não literal ali NÃO derruba a
  // análise verificada — o campo é ESVAZIADO (nunca usado nem como caminho de reserva) e o descarte fica no log. Sem
  // `processAssessment` a regra de sempre vale (a resposta é recusada pelo próprio contrato).
  if (!verbatim && outputContract === "PROCESS_ASSESSMENT" && (json as { processAssessment?: unknown } | null)?.processAssessment) {
    console.warn(JSON.stringify({ event: "agent_legacy_evidence_discarded", reason: "EVIDENCE_NOT_VERBATIM", evidencePreview: parsed.data.evidenceFound.slice(0, 200) }))
    const structured: StructuredMonitoringFeedback & SupportMaterialsOutcome = { ...parsed.data, evidenceFound: "", ...withSupportMaterials(json, supportMaterialCandidates) }
    return { ...structured, processAssessment: parseProcessAssessment(json, raw, presented, catalog) }
  }
  if (!verbatim) {
    // Diagnóstico (sem transcrição): só o trecho que o modelo alegou — auditável no log do servidor.
    console.warn(JSON.stringify({ event: "agent_evidence_not_verbatim", evidencePreview: parsed.data.evidenceFound.slice(0, 200) }))
    throw new ModelOutputContractError(
      "A evidência retornada pelo agente não corresponde a um trecho literal da transcrição — descartado para evitar evidência fabricada.",
      "AGENT_EVIDENCE_NOT_VERBATIM",
      { contract: "STRUCTURED_FEEDBACK", violations: [{ path: "evidenceFound", code: "EVIDENCE_NOT_VERBATIM", message: "Não é trecho literal da transcrição." }], rawResponse: raw },
    )
  }
  const structured: StructuredMonitoringFeedback & SupportMaterialsOutcome = { ...parsed.data, ...withSupportMaterials(json, supportMaterialCandidates) }
  if (outputContract === "PROCESS_ASSESSMENT") return { ...structured, processAssessment: parseProcessAssessment(json, raw, presented, catalog) }
  if (outputContract !== "PROCESS_AUDIT") return structured
  return { ...structured, processAudit: parseProcessAudit(json, transcript, raw) }
}

/** Seleção validada por código: só ids entre os candidatos, motivo específico, sem duplicata,
 * até o limite. Rejeições ficam no resultado (auditáveis no context_snapshot do Feedback) e em
 * aviso estruturado — o Feedback nunca falha por uma referência inválida. */
function withSupportMaterials(json: unknown, candidates: SupportMaterialCandidate[]): SupportMaterialsOutcome {
  if (candidates.length === 0) return {}
  const selection = selectSupportMaterialRecommendations((json as { supportMaterials?: unknown })?.supportMaterials, candidates)
  if (selection.rejected.length > 0) {
    console.warn(JSON.stringify({ event: "agent_support_materials_rejected", rejected: selection.rejected }))
  }
  return {
    ...(selection.accepted.length > 0 ? { supportMaterials: selection.accepted } : {}),
    ...(selection.rejected.length > 0 ? { supportMaterialsRejected: selection.rejected } : {}),
  }
}

/** Instruções de saída + contrato de materiais de apoio (só quando há candidatos). */
export function composeStructuredInstructions(base: string, candidates: SupportMaterialCandidate[]): string {
  if (candidates.length === 0) return base
  return `${base}\n${buildSupportMaterialsOutputField(candidates)}\n\n${buildSupportMaterialsPromptSection(candidates)}`
}

/** V1.6.0 — o rastro de KB desta execução (trechos que entraram no prompt), sem score. */
export function knowledgeExcerptsOf(trace: KnowledgeTrace): AgentKnowledgeExcerpt[] {
  return trace.retrieved.map((entry) => ({ documentId: entry.documentId, documentTitle: entry.documentTitle, heading: entry.heading, excerpt: entry.excerpt, ...(typeof entry.chunkIndex === "number" ? { chunkIndex: entry.chunkIndex } : {}) }))
}

/** V1.6.1 — avaliações por atendimento do diagnóstico: só o FORMATO (fail-closed quando ausente/malformado); refs fora da
 * amostra do sistema são descartadas. A verificação é da camada de confiabilidade. */
function parseDiagnosisAssessments(raw: string, allowedRefs: readonly string[], presented: readonly PresentedExcerptForContract[], catalog: ProcessCheckpointCatalog | null = null): InteractionAssessment[] {
  const parsed = parseInteractionAssessments((parseJsonOutput(raw) as { interactionAssessments?: unknown })?.interactionAssessments, allowedRefs, presented, catalog)
  if (!parsed.valid) throw new ModelOutputContractError("O agente não retornou as avaliações dos atendimentos (interactionAssessments) no formato esperado.", "AGENT_INDICATOR_DIAGNOSIS_INCOMPLETE", { contract: "INDICATOR_DIAGNOSIS_ASSESSMENTS_V1", contractVersion: PROCESS_ASSESSMENT_MODEL_CONTRACT_VERSION, violations: parsed.issues, rawResponse: raw })
  // Indicator Diagnosis V1 — atendimento com avaliação fora do contrato sai sozinho (registrado), os demais seguem.
  if (parsed.rejected.length > 0) console.warn(JSON.stringify({ event: "indicator_diagnosis_assessment_rejected", rejected: parsed.rejected.map((entry) => ({ interactionRef: entry.interactionRef, violations: entry.issues.slice(0, 5).map((issue) => ({ code: issue.code, path: issue.path })) })) }))
  return parsed.accepted
}

/** V1.7.3 — chamada ÚNICA de reparo da cobertura (Agent direto): mesma rota do Agent, propósito próprio no uso, zero retry. */
const agentCoverageRepairCall: CoverageRepairCall = async ({ system, user }) => {
  const route = routeFor({ purpose: "AGENT_SYNTHESIS", phase: "SYNTHESIS", structuredOutputComplexity: "SIMPLE", estimatedInputTokens: estimateTokens(system, user) })
  const reply = await generateForRoute({
    classification: { phase: "SYNTHESIS", purpose: ASSESSMENT_COVERAGE_REPAIR_PURPOSE, source: "AGENT", semanticType: "PROCESS_AUDIT", tags: [ASSESSMENT_COVERAGE_REPAIR_TAG] },
    systemPrompt: system,
    contents: [{ role: "user", text: user }],
    tools: [],
    structuredOutput: true,
    transport: { retries: 0 },
    route,
  })
  if (reply.kind !== "text") throw new DomainError("Resposta inesperada do agente no reparo de cobertura.", "AGENT_UNEXPECTED_RESPONSE", 502)
  return reply.text
}

/** V1.0.1 — reparo seletivo do diagnóstico do fechamento: mesma rota do Agent, propósito do reparo de cobertura, tag própria (custo à parte), zero retry. */
const diagnosisRepairCall: CoverageRepairCall = async ({ system, user }) => {
  const route = routeFor({ purpose: "AGENT_SYNTHESIS", phase: "SYNTHESIS", structuredOutputComplexity: "SIMPLE", estimatedInputTokens: estimateTokens(system, user) })
  const reply = await generateForRoute({
    classification: { phase: "SYNTHESIS", purpose: ASSESSMENT_COVERAGE_REPAIR_PURPOSE, source: "AGENT", semanticType: "PROCESS_AUDIT", tags: [INDICATOR_DIAGNOSIS_REPAIR_TAG] },
    systemPrompt: system,
    contents: [{ role: "user", text: user }],
    tools: [],
    structuredOutput: true,
    transport: { retries: 0 },
    route,
  })
  if (reply.kind !== "text") throw new DomainError("Resposta inesperada do agente no reparo do diagnóstico.", "AGENT_UNEXPECTED_RESPONSE", 502)
  return reply.text
}

/** V1.6.0 — avaliação de processo: aqui só o FORMATO. V1.7.1c — pelo validador único do contrato: envelope inválido falha
 * fechado (com as violações e a resposta bruta para diagnóstico); etapa inválida sai da avaliação e a deixa PARTIAL. A
 * verificação de evidência e da base é da camada de confiabilidade (reliable-feedback/domain/process-assessment.ts). */
function parseProcessAssessment(json: unknown, raw: string, presented: readonly PresentedExcerptForContract[] | null, catalog: ProcessCheckpointCatalog | null = null): RawProcessAssessment {
  // Monitoring Architecture V2 — a monitoria pede o contrato V5 (o diagnóstico de indicador tem parser próprio e continua no V4).
  const result = validateProcessAssessmentOutput((json as { processAssessment?: unknown })?.processAssessment, { presented, catalog, modelContract: "V5" })
  if (!result.ok) {
    throw new ModelOutputContractError("O agente não retornou a avaliação de processo (processAssessment) no formato esperado.", "AGENT_PROCESS_ASSESSMENT_INCOMPLETE", { contract: PROCESS_ASSESSMENT_CONTRACT, contractVersion: PROCESS_ASSESSMENT_MODEL_CONTRACT_V5, violations: result.issues, rawResponse: raw })
  }
  if (result.validation.completeness === "PARTIAL") console.warn(JSON.stringify({ event: "agent_process_assessment_partial", invalidItems: result.validation.invalidItems.map((item) => ({ path: item.path, code: item.code })), missingRequired: result.validation.missingRequired.map((item) => item.checkpointRef) }))
  return result.assessment
}

/** Violações do zod → caminhos/códigos (nunca o conteúdo). */
function violationsOf(error: { issues: readonly { path: readonly PropertyKey[]; code: string; message: string }[] }) {
  return error.issues.slice(0, 50).map((issue) => ({ path: issue.path.map(String).join(".") || "$", code: issue.code.toUpperCase(), message: issue.message }))
}

/** A auditoria etapa a etapa é verificada por código: etapa CONFORME/NAO_CONFORME sem citação
 * literal da transcrição é rebaixada para NAO_FOI_POSSIVEL_CONFIRMAR (ver process-audit.ts) —
 * nunca aceita nem descarta silenciosamente. */
function parseProcessAudit(json: unknown, transcript: string, raw: string): VerifiedProcessAudit {
  const audit = processAuditSchema.safeParse((json as { processAudit?: unknown })?.processAudit)
  if (!audit.success) {
    throw new ModelOutputContractError("O agente não retornou a análise de conformidade (processAudit) no formato esperado.", "AGENT_PROCESS_AUDIT_INCOMPLETE", { contract: "PROCESS_AUDIT", violations: violationsOf(audit.error), rawResponse: raw })
  }
  return verifyProcessAudit(audit.data, transcript)
}

export function parseStructuredIndicatorFeedback(raw: string, supportMaterialCandidates: SupportMaterialCandidate[] = []): StructuredIndicatorFeedback & SupportMaterialsOutcome {
  const json = parseJsonOutput(raw)
  const parsed = structuredIndicatorFeedbackSchema.safeParse(json)
  if (!parsed.success) {
    throw new ModelOutputContractError("O agente não retornou todos os campos obrigatórios do feedback.", "AGENT_STRUCTURED_OUTPUT_INCOMPLETE", { contract: "STRUCTURED_INDICATOR_FEEDBACK", violations: violationsOf(parsed.error), rawResponse: raw })
  }
  return { ...parsed.data, ...withSupportMaterials(json, supportMaterialCandidates) }
}

type AgentRunOutcome = { id: string; outputText: string | null; status: string; errorMessage: string | null; workflowResult?: AgentWorkflowResult; /** V1.7.1c — o erro original (classificável) quando FAILED. */ error?: unknown } & SupportMaterialsOutcome & InvestigationOutcomeFields

/** Evidência da interação em foco (feedback de chamada): a transcrição inteira está no input — ref fixa aceita pelo gating. */
const TRANSCRIPT_REF = "TRANSCRICAO"

/**
 * SÍNTESE FINAL com EVIDENCE GATING (V1.1 — itens 18–21; V1.3 fail-closed): a chamada estruturada
 * recebe o dossiê (ledger + limitações + notas) e devolve, além do feedback, hipóteses/limitações/
 * afirmações comportamentais/suporte de cada recomendação. O código valida as refs contra o ledger;
 * envelope ausente ou claim rejeitada → UMA re-request corretiva; persistindo, a resposta é descartada
 * (a mesma postura da evidência não literal). Todas as requests entram no Token Budget.
 */
async function synthesizeWithGating(
  prompt: SynthesisPromptInput,
  inputContext: string,
  investigation: InvestigationOutcome,
  options: { knowledgeAvailable: boolean; transcriptEvidence: boolean; knowledgeChars: number; semanticType: LlmSemanticType },
): Promise<string> {
  const ledger: LedgerEntry[] = options.transcriptEvidence
    ? [{ ref: TRANSCRIPT_REF, sequence: 0, round: 0, tool: "get_interaction_context", capability: "INTERACTION_ANALYSIS", keyArgs: "", summary: "transcrição da interação em foco (input)", qualityStatus: "SUFFICIENT", qualityNote: null, sampleCount: 1, periodLabel: null, preflight: true }, ...investigation.ledger]
    : investigation.ledger
  const gating = { ledger, knowledgeAvailable: options.knowledgeAvailable, interactionUniverse: investigation.summary.interactionsInPeriod ?? null, operationalUniverse: investigation.operationalUniverse, criticalFacts: criticalFactsOf(ledger, investigation.objective), objective: investigation.objective, temporalBuckets: investigation.summary.temporal?.buckets ?? [] }
  const assembled = assembleAgentSynthesisPrompt("STRUCTURED", { ...prompt, evidenceRefs: ledger.map((entry) => entry.ref), claimSupports: claimSupportOptionsOf(ledger), claimCandidates: buildClaimCandidates(ledger), transcriptRef: options.transcriptEvidence ? TRANSCRIPT_REF : undefined, investigated: true })
  const profile = assembled.profile
  const userText = composeUserTurn(assembled, inputContext)
  const structuredSchemaChars = assembled.components.filter((item) => item.id.startsWith("synthesis.") || item.id.startsWith("evidence.") || item.id.startsWith("materials.")).reduce((sum, item) => sum + item.chars, 0)
  const contextBreakdown = {
    staticPromptChars: profile === "CURRENT" ? assembled.system.length : assembled.staticChars - structuredSchemaChars,
    dynamicPromptChars: profile === "CURRENT" ? 0 : assembled.dynamicChars,
    toolSchemaChars: 0,
    evidenceLedgerChars: investigation.dossier.length,
    interactionContentChars: options.transcriptEvidence ? Math.max(0, inputContext.length - investigation.dossier.length) : 0,
    knowledgeContentChars: options.knowledgeChars,
    structuredSchemaChars,
    objectiveChars: Math.max(0, inputContext.length - investigation.dossier.length),
  }
  let route = routeFor({ purpose: "AGENT_SYNTHESIS", phase: "SYNTHESIS", structuredOutputComplexity: "SIMPLE", estimatedInputTokens: estimateTokens(assembled.system, userText) })
  const classification: LlmRequestClassification = { phase: "SYNTHESIS", purpose: "AGENT_SYNTHESIS", source: "AGENT", semanticType: options.semanticType }
  try {
    const gated = await gateStructuredReply(
      async (correction) => {
        // Escalação de MODELO por causa explícita (correção de gating) — nunca por erro de rede.
        if (correction) route = escalateRoute(route, "GATING_CORRECTION")
        const reply = await generateForRoute({
          classification: correction ? { ...classification, purpose: "GATING_CORRECTION" } : classification,
          contextBreakdown,
          promptComponents: assembled.components,
          cache: { cacheable: profile === "COMPACT", cacheKeyVersion: assembled.cacheKeyVersion },
          systemPrompt: assembled.system,
          contents: [{ role: "user", text: correction ? `${userText}\n\n${correction}` : userText }],
          tools: [],
          structuredOutput: true,
          route,
        })
        investigation.requests.push({ phase: "SYNTHESIS", model: reply.model, usage: reply.usage, durationMs: reply.durationMs, toolCalls: [], route: routeRecordOf(route) })
        return reply.kind === "text" ? reply.text : ""
      },
      safeJson,
      gating,
      (still) => `A resposta do agente mantém afirmações sem evidência após correção (${still.map((item) => `"${item.text}"`).join("; ")}) — descartada para evitar conclusão comportamental inventada.`,
    )
    investigation.summary.synthesis = gated.synthesis
    investigation.summary.evidenceGating = gated.gating
    if (investigation.summary.temporal) investigation.summary.temporal = foldTemporalClaims(investigation.summary.temporal, gated.synthesis, gated.gating.rejectedClaims)
    accountRequests(investigation.summary, investigation.requests)
    return stripInternalRefsFromJson(gated.raw)
  } catch (error) {
    if (error instanceof StructuredGatingError) {
      investigation.summary.synthesis = error.synthesis
      investigation.summary.evidenceGating = error.gating
      if (investigation.summary.temporal) investigation.summary.temporal = foldTemporalClaims(investigation.summary.temporal, error.synthesis, error.gating.rejectedClaims)
      accountRequests(investigation.summary, investigation.requests)
    }
    throw error
  }
}

/** Refs internas coladas nos campos de texto do JSON (title/summary/recommendation…) saem por código; o JSON continua o mesmo. */
function stripInternalRefsFromJson(raw: string): string {
  try {
    const json = parseJsonOutput(raw) as Record<string, unknown>
    for (const key of ["title", "summary", "recommendation", "observedBehavior", "relatedProcedure", "impactedIndicator"]) {
      if (typeof json[key] === "string") json[key] = stripInternalRefs(json[key] as string)
    }
    return JSON.stringify(json)
  } catch {
    return raw
  }
}

function safeJson(raw: string): unknown {
  try {
    return parseJsonOutput(raw)
  } catch {
    return {}
  }
}

/** Sujeito da investigação quando o Agent roda FORA de um Workflow (teste manual/QA "Agent" com
 * operador escolhido, especialista de chat). Sem sujeito não há investigação — as Tools sempre
 * operam sobre um colaborador definido pelo runtime, nunca escolhido pelo modelo. */
export type AgentInvestigationSubject = { operatorId: string; interactionId?: string | null; indicatorCode?: string | null; period?: { start: Date; end: Date; label: string } | null }

type RunAgentInput = {
  /** Organização da execução — a da sessão (teste manual, QA Lab) ou a do registro (matrícula do Workflow). O Agent precisa ser dela. */
  organizationId: string
  agentId: string
  inputContext: string
  source: AgentRunSource
  workflow?: WorkflowRunContext
  /** Onde a execução é registrada — `agent_runs` por padrão; o QA Lab injeta um registrador
   * em memória pra nunca contaminar `usageCount`/histórico produtivo (ver effect-sink.ts). */
  recorder?: AgentRunRecorder
  /** Restrição do Workflow (node "Chamar agente"): effective = Agent ∩ allowed. Ausente = as do Agent. */
  allowedCapabilities?: InvestigationCapability[] | null | undefined
  subject?: AgentInvestigationSubject | null | undefined
  /** Relógio da execução (Workflow/QA) — padrão: agora. */
  now?: Date | undefined
}

export async function runAgent(db: Database, input: RunAgentInput): Promise<AgentRunOutcome> {
  const { organizationId } = input
  const recorder = input.recorder ?? productionAgentRuns
  const agentResult = await db.query<AgentConfig & { active: boolean; recommend_support_materials: boolean; investigation_capabilities: string[] | null }>(
    `select name, objective, description, context_prompt, active, recommend_support_materials, investigation_capabilities, organization_id from agents where id = $1 and organization_id = $2`,
    [input.agentId, organizationId],
  )
  const agent = agentResult.rows[0]
  if (!agent) throw new DomainError("Agente não encontrado.", "AGENT_NOT_FOUND", 404)
  if (!agent.active) throw new DomainError("Este agente está inativo.", "AGENT_INACTIVE", 422)

  const runId = await recorder.start(db, { organizationId, agentId: input.agentId, source: input.source, inputContext: input.inputContext })

  // `withLlmScope` só etiqueta a telemetria de IA (papel "agent" + qual agente) — ver
  // shared/application/llm-telemetry.ts; no-op fora do QA Lab.
  return withLlmScope({ role: "agent", agentId: input.agentId }, () => executeAgentRun(db, input, agent, runId, recorder))
}

/** Sujeito + período padrão da investigação a partir do contexto do Workflow (ou do sujeito explícito). */
async function resolveInvestigationSubject(db: Database, input: RunAgentInput, timeZone: string, now: Date): Promise<{ subject: Awaited<ReturnType<typeof loadSubject>>; period: InvestigationPeriod } | null> {
  const { organizationId } = input
  const dayMs = 24 * 60 * 60 * 1000
  const label = (start: Date, end: Date) => `${localDateOf(start, timeZone)} a ${localDateOf(new Date(end.getTime() - 1), timeZone)}`
  // Rótulo com as datas inclusivas (o modelo precisa delas para pedir períodos explícitos) — sem duplicar quando o Workflow já as trouxe.
  const labeled = (periodLabel: string, start: Date, end: Date) => (periodLabel.includes(label(start, end)) ? periodLabel : `${periodLabel} (${label(start, end)})`)
  const lastDays = (endExclusive: Date, days: number): InvestigationPeriod => {
    const end = endExclusive
    const start = new Date(end.getTime() - days * dayMs)
    return { start, end, label: label(start, end) }
  }
  const workflow = input.workflow
  if (workflow?.kind === "channel_flag") {
    const anchor = new Date(workflow.startedAt)
    const endExclusive = new Date(anchor.getTime() + dayMs)
    return { subject: await loadSubject(db, organizationId, workflow.operatorId, { interactionId: workflow.interactionId }), period: lastDays(endExclusive, 30) }
  }
  if (workflow?.kind === "indicator") {
    // Rótulo com as datas locais INCLUSIVAS da janela (fim exclusivo − 1): é o que o modelo copia
    // ao pedir um período explícito às Tools — sem isso ele tende a incluir o dia seguinte.
    const period: InvestigationPeriod = workflow.periodSummary
      ? (() => {
          const start = new Date(workflow.periodSummary.periodStart)
          const end = new Date(workflow.periodSummary.periodEnd)
          return { start, end, label: labeled(workflow.periodSummary.periodLabel, start, end) }
        })()
      : lastDays(new Date(new Date(workflow.measuredAt).getTime() + dayMs), 30)
    return { subject: await loadSubject(db, organizationId, workflow.operatorId, { indicatorCode: workflow.indicatorCode }), period }
  }
  if (workflow?.kind === "indicator_summary") {
    const start = new Date(workflow.periodStart)
    const end = new Date(workflow.periodEnd)
    return { subject: await loadSubject(db, organizationId, workflow.operatorId), period: { start, end, label: labeled(workflow.periodLabel, start, end) } }
  }
  if (input.subject) {
    const period = input.subject.period ?? lastDays(new Date(now.getTime() + dayMs), 30)
    return { subject: await loadSubject(db, organizationId, input.subject.operatorId, { interactionId: input.subject.interactionId ?? null, indicatorCode: input.subject.indicatorCode ?? null }), period }
  }
  return null
}

async function executeAgentRun(
  db: Database,
  input: RunAgentInput,
  agent: AgentConfig & { recommend_support_materials: boolean; investigation_capabilities: string[] | null },
  runId: string,
  recorder: AgentRunRecorder,
): Promise<AgentRunOutcome> {
  const { organizationId } = input
  try {
    // O retrieval de KB usa a própria entrada (transcrição/indicadores) como consulta — só os
    // trechos pertinentes a ESTA chamada entram no prompt (ver retrieve-knowledge.ts).
    // V1.7.1d — avaliação de processo de uma chamada que chegou ao fim: o plano de cobertura garante as seções de fechamento.
    const assessingProcess = input.workflow?.kind === "channel_flag" && input.workflow.outputContract === "PROCESS_ASSESSMENT" && closingPhaseReached(input.inputContext)
    // V1.7.1l — qualquer avaliação de processo (monitoria ou diagnóstico de indicador): seções não executáveis chegam como CONTEXTO.
    const markProcessRoles = input.workflow !== undefined && "outputContract" in input.workflow && (input.workflow.outputContract === "PROCESS_ASSESSMENT" || input.workflow.outputContract === "INDICATOR_DIAGNOSIS")
    // V1.7.1m — o assunto estruturado da interação identifica o documento PRIMÁRIO do processo na cobertura.
    const coverageSubject = assessingProcess && input.workflow?.kind === "channel_flag" ? await loadInteractionSubject(db, organizationId, input.workflow.interactionId) : null
    // Indicator Diagnosis V1 — diagnóstico do FECHAMENTO: as chamadas da amostra são do MESMO motivo (escolhido pelo sistema) e
    // gravações completas; o mesmo plano de cobertura do encerramento marca as etapas que cada chamada precisa ter avaliadas
    // (sem ele o Agent avaliava uma etapa por chamada e nenhuma omissão podia ser verificada). Só quando o nó pede (campo novo).
    const diagnosisCoverage = input.workflow?.kind === "indicator" && input.workflow.outputContract === "INDICATOR_DIAGNOSIS" && input.workflow.diagnosisCoverage ? input.workflow.diagnosisCoverage : null
    const coverage = assessingProcess ? { phases: ["CLOSING" as const], subject: coverageSubject } : diagnosisCoverage ? { phases: ["CLOSING" as const], subject: diagnosisCoverage.subject } : null
    // V1.7.4 — monitoria (avaliação de processo por Flag): a régua é só a base aplicável; Regras de chamada genéricas ficam fora do prompt.
    const monitoringProcessAssessment = input.workflow?.kind === "channel_flag" && input.workflow.outputContract === "PROCESS_ASSESSMENT"
    const built = await buildSystemPromptWithTrace(db, input.agentId, agent, { query: input.inputContext, coverage, markProcessRoles, processAssessment: monitoringProcessAssessment, governanceSubjectPersonId: input.workflow && "operatorId" in input.workflow ? input.workflow.operatorId : null })
    attachKnowledgeTrace(withoutCheckpointCatalog(built.knowledge))
    const baseSystemPrompt = built.systemPrompt

    // INVESTIGAÇÃO (Tools): effective = capacidades do Agent ∩ restrição do Workflow. Com
    // capacidades e um sujeito definido pelo runtime, o Agent investiga ANTES de responder: o loop
    // devolve um dossiê de fatos (com proveniência/qualidade) que entra na chamada final como
    // evidência — a resposta continua saindo pelos MESMOS contratos/parsers de sempre.
    const capabilities = effectiveCapabilities(normalizeCapabilities(agent.investigation_capabilities), input.allowedCapabilities)
    const now = input.now ?? new Date()
    const investigationSubject = capabilities.length > 0 ? await resolveInvestigationSubject(db, input, await resolveOrganizationTimezone(db, organizationId), now) : null
    const investigation = investigationSubject
      ? await runInvestigation({
          db,
          organizationId,
          agentId: input.agentId,
          systemPrompt: baseSystemPrompt,
          promptParts: built.parts,
          capabilities,
          subject: investigationSubject.subject,
          defaultPeriod: investigationSubject.period,
          objective: input.inputContext,
          // INVESTIGATION OBJECTIVE (V1.3.1): derivado do Workflow/contrato/pergunta — nunca pelo modelo.
          objectiveContext: {
            outputContract: input.workflow?.kind === "channel_flag" ? (input.workflow.outputContract === "PROCESS_ASSESSMENT" ? "PROCESS_AUDIT" : input.workflow.outputContract === "INDICATOR_DIAGNOSIS" ? "FEEDBACK" : (input.workflow.outputContract ?? "FEEDBACK")) : null,
            multiIndicator: input.workflow?.kind === "indicator_summary",
            query: input.source === "WORKFLOW" ? null : input.inputContext,
          },
          transcriptInFocus: input.workflow?.kind === "channel_flag",
          // V1.3.2: o sinal que trouxe a interação (flag do gatilho) — a suficiência exige contextualizá-lo além da transcrição.
          signalFlag: input.workflow?.kind === "channel_flag" && input.workflow.flagName ? input.workflow.flagName : null,
          knowledgeAvailable: built.knowledge.retrieved.length > 0,
          now,
          timeZone: await resolveOrganizationTimezone(db, organizationId),
          initialKnowledgeCandidates: buildSupportMaterialCandidates(built.knowledge),
        })
      : null
    const investigationFields: InvestigationOutcomeFields = investigation ? { toolTrace: investigation.trace, investigation: investigation.summary } : {}
    const inputContext = investigation && investigation.trace.length > 0 ? `${input.inputContext}\n\n${investigation.dossier}` : input.inputContext
    // Base real para KNOWLEDGE_GUIDANCE: trechos que entraram no prompt ou consultados por query_knowledge.
    const knowledgeAvailable = built.knowledge.retrieved.length > 0 || (investigation?.knowledgeCandidates.length ?? 0) > 0
    /** Chamada final: com investigação passa pelo gating de evidência (fail-closed); sem ela, o mesmo contrato de sempre — agora pelo gateway. */
    const finalReply = async (outputContract: string, candidates: SupportMaterialCandidate[], transcriptEvidence: boolean, semanticType: LlmSemanticType, /** V1.0.2 — só na repetição técnica do structured output: aviso de formato no fim do turno + tag de custo própria. */ retry: { notice: string } | null = null) => {
      const promptInput: SynthesisPromptInput = { systemPrompt: baseSystemPrompt, parts: built.parts, outputContract, candidates, evidenceRefs: [], investigated: false }
      if (investigation && investigation.trace.length > 0) return synthesizeWithGating(promptInput, inputContext, investigation, { knowledgeAvailable, transcriptEvidence, knowledgeChars: built.knowledge.injectedChars, semanticType })
      const assembled = assembleAgentSynthesisPrompt("STRUCTURED", promptInput)
      const userText = retry ? `${composeUserTurn(assembled, inputContext)}\n\n${retry.notice}` : composeUserTurn(assembled, inputContext)
      const route = routeFor({ purpose: "AGENT_SYNTHESIS", phase: "SYNTHESIS", structuredOutputComplexity: "SIMPLE", estimatedInputTokens: estimateTokens(assembled.system, userText) })
      const reply = await generateForRoute({
        classification: { phase: "SYNTHESIS", purpose: "AGENT_SYNTHESIS", source: "AGENT", semanticType, ...(retry ? { tags: [STRUCTURED_OUTPUT_RETRY_TAG] } : {}) },
        contextBreakdown: { staticPromptChars: assembled.profile === "CURRENT" ? assembled.system.length : assembled.staticChars, dynamicPromptChars: assembled.profile === "CURRENT" ? 0 : assembled.dynamicChars, toolSchemaChars: 0, evidenceLedgerChars: 0, interactionContentChars: transcriptEvidence ? inputContext.length : 0, knowledgeContentChars: built.knowledge.injectedChars, structuredSchemaChars: outputContract.length, objectiveChars: transcriptEvidence ? 0 : inputContext.length },
        promptComponents: assembled.components,
        cache: { cacheable: assembled.profile === "COMPACT", cacheKeyVersion: assembled.cacheKeyVersion },
        systemPrompt: assembled.system,
        contents: [{ role: "user", text: userText }],
        tools: [],
        structuredOutput: true,
        route,
      })
      return reply.kind === "text" ? reply.text : ""
    }
    // Candidatos a material de apoio = documentos distintos entre os trechos que ENTRARAM neste
    // prompt (+ os consultados pela investigação) — a IA só pode recomendar o que ela mesma
    // recebeu, pelo id. Aqui o Agent é o RESPONDENTE FINAL (Workflow "Chamar agente"/teste manual/
    // QA), então a recomendação só existe quando o Agent está habilitado para isso
    // (`recommend_support_materials`) OU quando a capacidade "Materiais de apoio" está ligada e a
    // investigação já selecionou (recommend_support_materials como Tool — mesma validação).
    const investigationSelected = investigation?.supportMaterials ?? null
    const supportMaterialCandidates = investigationSelected
      ? []
      : agent.recommend_support_materials || capabilities.includes("SUPPORT_MATERIALS")
        ? mergeSupportMaterialCandidates([buildSupportMaterialCandidates(built.knowledge), investigation?.knowledgeCandidates ?? []])
        : []
    const withInvestigationMaterials = (outcome: SupportMaterialsOutcome): SupportMaterialsOutcome => (investigationSelected ? { supportMaterials: investigationSelected } : outcome)

    if (input.source === "WORKFLOW" && input.workflow) {
      const workflow = input.workflow
      if (!workflow.teamId) throw new DomainError("O operador desta interação não está associado a um grupo.", "OPERATOR_WITHOUT_TEAM", 422)

      if (workflow.kind === "channel_flag") {
        const outputContract = workflow.outputContract ?? "FEEDBACK"
        const contractInstructions = outputContract === "PROCESS_AUDIT" ? STRUCTURED_OUTPUT_INSTRUCTIONS + PROCESS_AUDIT_INSTRUCTIONS : outputContract === "PROCESS_ASSESSMENT" ? STRUCTURED_OUTPUT_INSTRUCTIONS + PROCESS_ASSESSMENT_INSTRUCTIONS_V5 : STRUCTURED_OUTPUT_INSTRUCTIONS
        const semantic = outputContract === "FEEDBACK" ? "FEEDBACK" : "PROCESS_AUDIT"
        const parseReply = (reply: string) => parseStructuredFeedback(reply, input.inputContext, outputContract, supportMaterialCandidates, knowledgeExcerptsOf(built.knowledge), built.knowledge.checkpointCatalog ?? null)
        // V1.7.4 — o MESMO retry técnico homologado do diagnóstico (V1.0.2): resposta que nem é JSON legível (ex.: quebra de linha crua
        // dentro de uma string) ou sem o `processAssessment` obrigatório → UMA repetição da mesma tarefa só com o aviso de formato;
        // outros campos ausentes/evidência não literal/contrato continuam sem retry. Só no caminho direto (sem investigação).
        const replied = !(investigation && investigation.trace.length > 0)
          ? await withStructuredOutputRetry({ call: (notice) => finalReply(contractInstructions, supportMaterialCandidates, true, semantic, notice ? { notice } : null), parse: parseReply })
          : await (async () => { const reply = await finalReply(contractInstructions, supportMaterialCandidates, true, semantic); return { raw: reply, value: parseReply(reply), telemetry: null } })()
        const raw = replied.raw
        const { supportMaterials: selected, supportMaterialsRejected, ...parsedStructured } = replied.value
        const { supportMaterials } = withInvestigationMaterials({ ...(selected ? { supportMaterials: selected } : {}) })
        // V1.7.3 — COBERTURA DA AVALIAÇÃO: MUST_ASSESS sem disposição → no máximo UM reparo só com as faltantes (nunca o redator).
        const structured = parsedStructured.processAssessment
          ? { ...parsedStructured, processAssessment: await completeAssessmentCoverage({ assessment: parsedStructured.processAssessment, catalog: built.knowledge.checkpointCatalog ?? null, presented: knowledgeExcerptsOf(built.knowledge), conversation: input.inputContext, call: agentCoverageRepairCall, agentId: input.agentId }) }
          : parsedStructured

        const matchedValueText = workflow.matchedValueBoolean !== null ? (workflow.matchedValueBoolean ? "verdadeiro" : "falso") : (workflow.matchedValueNumeric ?? "")
        const thresholdValueText = workflow.thresholdBoolean !== null ? (workflow.thresholdBoolean ? "verdadeiro" : "falso") : (workflow.thresholdNumeric ?? "")
        const thresholdText = `${workflow.flagName} ${COMPARATOR_TEXT[workflow.comparator] ?? workflow.comparator} ${thresholdValueText}`

        const workflowResult: AgentWorkflowResult = {
          kind: "monitoring",
          input: {
            organizationId,
            operatorId: workflow.operatorId,
            teamId: workflow.teamId,
            interactionId: workflow.interactionId,
            interactionOccurredAt: workflow.startedAt,
            flagName: workflow.flagName,
            matchedValueText,
            thresholdText,
            structured,
          },
          knowledgeExcerpts: knowledgeExcerptsOf(built.knowledge),
          ...(built.knowledge.checkpointGovernance ? { checkpointGovernance: built.knowledge.checkpointGovernance } : {}),
          ...(supportMaterials ? { supportMaterials } : {}),
          ...(supportMaterialsRejected ? { supportMaterialsRejected } : {}),
          ...investigationFields,
        }

        await recorder.complete(db, runId, raw, investigation?.trace)
        return { id: runId, outputText: raw, status: "COMPLETED", errorMessage: null, workflowResult, ...investigationFields }
      }

      if (workflow.kind === "indicator") {
        // V1.6.1 — diagnóstico: com amostra, o Agent avalia cada atendimento (mesmo contrato de processo da monitoria).
        const diagnosisSample = workflow.outputContract === "INDICATOR_DIAGNOSIS" ? workflow.diagnosisSample ?? null : null
        const assessing = Boolean(diagnosisSample && diagnosisSample.sample.length > 0)
        const instructions = assessing ? STRUCTURED_OUTPUT_INSTRUCTIONS_INDICATOR + INDICATOR_DIAGNOSIS_INSTRUCTIONS : STRUCTURED_OUTPUT_INSTRUCTIONS_INDICATOR
        const parseIndicatorReply = (reply: string) => ({
          indicator: parseStructuredIndicatorFeedback(reply, supportMaterialCandidates),
          assessments: assessing && diagnosisSample ? parseDiagnosisAssessments(reply, diagnosisSample.sample.map((entry) => entry.handle), knowledgeExcerptsOf(built.knowledge), built.knowledge.checkpointCatalog ?? null) : [],
        })
        // V1.0.2 — diagnóstico: JSON ilegível na 1ª resposta = no máximo UMA repetição técnica da MESMA tarefa (só o aviso de formato).
        // Só no caminho direto (sem investigação, como no fechamento do PRV); nunca conta no orçamento do reparo semântico.
        const retryable = assessing && !(investigation && investigation.trace.length > 0)
        const replied = retryable
          ? await withStructuredOutputRetry({ call: (notice) => finalReply(instructions, supportMaterialCandidates, assessing, "FEEDBACK", notice ? { notice } : null), parse: parseIndicatorReply })
          : await (async () => { const reply = await finalReply(instructions, supportMaterialCandidates, assessing, "FEEDBACK"); return { raw: reply, value: parseIndicatorReply(reply), telemetry: null } })()
        const raw = replied.raw
        const { supportMaterials: selected, supportMaterialsRejected, ...structured } = replied.value.indicator
        const initialAssessments = replied.value.assessments
        // V1.0.1 — COBERTURA: MUST_ASSESS faltantes + disposições inconsistentes → no máximo UM reparo por chamada (até o limite).
        const repairPlan = workflow.diagnosisCoverage?.repair ?? null
        const catalog = built.knowledge.checkpointCatalog ?? null
        const completed = assessing && diagnosisSample && repairPlan && catalog?.coveragePlan
          ? await completeDiagnosisCoverage({ sample: diagnosisSample.sample.map((entry) => entry.handle), accepted: initialAssessments, catalog, presented: knowledgeExcerptsOf(built.knowledge), conversations: new Map(repairPlan.conversations.map((entry) => [entry.handle, entry.transcript])), maxRepairInteractions: repairPlan.maxInteractions, call: diagnosisRepairCall, agentId: input.agentId })
          : null
        const diagnosis: AgentIndicatorDiagnosis | null = diagnosisSample ? { ...diagnosisSample, interactionAssessments: completed?.assessments ?? initialAssessments, ...(completed ? { coverage: completed.coverage } : {}), ...(replied.telemetry ? { structuredOutput: replied.telemetry } : {}) } : null
        const { supportMaterials } = withInvestigationMaterials({ ...(selected ? { supportMaterials: selected } : {}) })

        const comparatorText = COMPARATOR_TEXT[workflow.comparator] ?? workflow.comparator
        const thresholdText = workflow.thresholdNumeric ?? ""
        const periodPrefix = workflow.periodSummary ? `${workflow.periodSummary.periodLabel} — ` : ""
        const evidenceFound =
          workflow.targetValue !== null
            ? `${periodPrefix}${workflow.indicatorName}: ${workflow.value} ${workflow.unit} (meta vigente: ${workflow.targetValue} ${workflow.unit})`
            : `${periodPrefix}${workflow.indicatorName}: ${workflow.value} ${workflow.unit} (sem meta cadastrada para o período)`
        // Resumo de período (agenda) não vem de uma Condition: descreve o valor médio observado em vez
        // de um comparador vazio ("é igual a  SECONDS").
        const observedBehavior = workflow.periodSummary
          ? `${workflow.indicatorName} médio de ${Math.round(workflow.value * 100) / 100} ${workflow.unit} no período${workflow.targetValue !== null ? ` (meta ${workflow.targetValue} ${workflow.unit})` : ""}`
          : `${workflow.indicatorName} ${comparatorText} ${thresholdText} ${workflow.unit}`.trim()

        const workflowResult: AgentWorkflowResult = {
          kind: "indicator",
          input: {
            organizationId,
            operatorId: workflow.operatorId,
            teamId: workflow.teamId,
            evidenceSourceType: workflow.periodSummary ? "indicator_period_summary" : "indicator_measurement",
            evidenceSourceId: workflow.periodSummary ? workflow.periodSummary.measurementIds.join(",") : workflow.indicatorMeasurementId!,
            contextSnapshot: workflow.periodSummary
              ? { periodSummary: { indicatorCode: workflow.indicatorCode, ...workflow.periodSummary } }
              : { indicatorMeasurementId: workflow.indicatorMeasurementId },
            measuredAt: workflow.measuredAt,
            indicatorCode: workflow.indicatorCode,
            indicatorName: workflow.indicatorName,
            evidenceFound,
            impactedIndicator: workflow.indicatorName,
            observedBehavior,
            structured,
          },
          ...(diagnosis ? { diagnosis, knowledgeExcerpts: knowledgeExcerptsOf(built.knowledge), ...(built.knowledge.checkpointGovernance ? { checkpointGovernance: built.knowledge.checkpointGovernance } : {}) } : {}),
          ...(supportMaterials ? { supportMaterials } : {}),
          ...(supportMaterialsRejected ? { supportMaterialsRejected } : {}),
          ...investigationFields,
        }

        await recorder.complete(db, runId, raw, investigation?.trace)
        return { id: runId, outputText: raw, status: "COMPLETED", errorMessage: null, workflowResult, ...investigationFields }
      }

      // kind === "indicator_summary"
      const raw = await finalReply(STRUCTURED_OUTPUT_INSTRUCTIONS_INDICATOR_SUMMARY, supportMaterialCandidates, false, "INDICATOR_SUMMARY")
      const { supportMaterials: selected, supportMaterialsRejected, ...structured } = parseStructuredIndicatorFeedback(raw, supportMaterialCandidates)
      const { supportMaterials } = withInvestigationMaterials({ ...(selected ? { supportMaterials: selected } : {}) })

      const evidenceFound = `${workflow.periodLabel} — ${workflow.indicators
        .map((indicator) =>
          indicator.targetValue !== null
            ? `${indicator.name}: ${indicator.value} ${indicator.unit} (meta: ${indicator.targetValue} ${indicator.unit})`
            : `${indicator.name}: ${indicator.value} ${indicator.unit} (sem meta cadastrada)`,
        )
        .join(" | ")}`
      const observedBehavior = `Resumo de ${workflow.indicators.length} indicador(es) no período ${workflow.periodLabel}.`

      const workflowResult: AgentWorkflowResult = {
        kind: "indicator",
        input: {
          organizationId,
          operatorId: workflow.operatorId,
          teamId: workflow.teamId,
          evidenceSourceType: workflow.evidenceSourceType ?? "indicator_period_summary",
          evidenceSourceId: workflow.indicators.flatMap((indicator) => indicator.measurementIds).join(","),
          contextSnapshot: {
            periodSummary: {
              periodLabel: workflow.periodLabel,
              periodStart: workflow.periodStart,
              periodEnd: workflow.periodEnd,
              indicators: workflow.indicators.map((indicator) => ({ code: indicator.code, measurementIds: indicator.measurementIds })),
            },
          },
          measuredAt: workflow.periodEnd,
          indicatorCode: "GERAL",
          indicatorName: "Resumo geral de indicadores",
          evidenceFound,
          impactedIndicator: "Resumo geral de indicadores",
          observedBehavior,
          structured,
        },
        ...(supportMaterials ? { supportMaterials } : {}),
        ...(supportMaterialsRejected ? { supportMaterialsRejected } : {}),
        ...investigationFields,
      }

      await recorder.complete(db, runId, raw, investigation?.trace)
      return { id: runId, outputText: raw, status: "COMPLETED", errorMessage: null, workflowResult, ...investigationFields }
    }

    // Resposta em texto livre (teste manual/QA "Agent"): o Agent também é o respondente final —
    // com a recomendação habilitada e candidatos, a seção de materiais entra no prompt e a escolha
    // sai pelo marcador em linha própria (extraído do texto antes de gravar/mostrar).
    const investigated = Boolean(investigation && investigation.trace.length > 0)
    // Texto livre com investigação (QA "Agent", chat direto): mesmo gating de evidência via linha interna EVIDENCE_JSON (V1.2; fail-closed na V1.3).
    const freeTextAssembled = assembleAgentSynthesisPrompt("FREE_TEXT", { systemPrompt: baseSystemPrompt, parts: built.parts, outputContract: null, candidates: supportMaterialCandidates, evidenceRefs: investigation?.ledger.map((entry) => entry.ref) ?? [], claimSupports: investigation ? claimSupportOptionsOf(investigation.ledger) : undefined, claimCandidates: investigation ? buildClaimCandidates(investigation.ledger) : undefined, investigated })
    const freeTextUser = composeUserTurn(freeTextAssembled, inputContext)
    const freeTextBreakdown = { staticPromptChars: freeTextAssembled.profile === "CURRENT" ? freeTextAssembled.system.length : freeTextAssembled.staticChars, dynamicPromptChars: freeTextAssembled.profile === "CURRENT" ? 0 : freeTextAssembled.dynamicChars, toolSchemaChars: 0, evidenceLedgerChars: investigation?.dossier.length ?? 0, interactionContentChars: 0, knowledgeContentChars: built.knowledge.injectedChars, structuredSchemaChars: 0, objectiveChars: input.inputContext.length }
    let route = routeFor({ purpose: "AGENT_SYNTHESIS", phase: "SYNTHESIS", estimatedInputTokens: estimateTokens(freeTextAssembled.system, freeTextUser) })
    const askFreeText = async (correction: string | null): Promise<string> => {
      if (correction) route = escalateRoute(route, "GATING_CORRECTION")
      const reply = await generateForRoute({
        classification: { phase: "SYNTHESIS", purpose: correction ? "GATING_CORRECTION" : "AGENT_SYNTHESIS", source: "AGENT", semanticType: "TEXT" },
        contextBreakdown: freeTextBreakdown,
        promptComponents: freeTextAssembled.components,
        cache: { cacheable: freeTextAssembled.profile === "COMPACT", cacheKeyVersion: freeTextAssembled.cacheKeyVersion },
        systemPrompt: freeTextAssembled.system,
        contents: [{ role: "user", text: correction ? `${freeTextUser}\n\n${correction}` : freeTextUser }],
        tools: [],
        structuredOutput: false,
        route,
      })
      if (investigation) {
        investigation.requests.push({ phase: "SYNTHESIS", model: reply.model, usage: reply.usage, durationMs: reply.durationMs, toolCalls: [], route: routeRecordOf(route) })
        accountRequests(investigation.summary, investigation.requests)
      }
      return reply.kind === "text" ? reply.text : ""
    }
    let rawOutput: string
    if (investigation && investigated) {
      const gated = await gateTextReply(askFreeText, { ledger: investigation.ledger, knowledgeAvailable, interactionUniverse: investigation.summary.interactionsInPeriod ?? null, operationalUniverse: investigation.operationalUniverse, limitations: investigation.limitations, criticalFacts: criticalFactsOf(investigation.ledger, investigation.objective), objective: investigation.objective, temporalBuckets: investigation.summary.temporal?.buckets ?? [] }, "FACTUAL")
      investigation.summary.synthesis = gated.synthesis
      investigation.summary.evidenceGating = gated.gating
      if (investigation.summary.temporal) investigation.summary.temporal = foldTemporalClaims(investigation.summary.temporal, gated.synthesis, gated.gating.rejectedClaims)
      rawOutput = gated.text
    } else {
      rawOutput = await askFreeText(null)
    }
    const extracted = extractSupportMaterialsMarker(rawOutput)
    const selection = supportMaterialCandidates.length > 0 ? selectSupportMaterialRecommendations(extracted.raw, supportMaterialCandidates) : { accepted: [], rejected: [] }
    if (selection.rejected.length > 0) console.warn(JSON.stringify({ event: "agent_support_materials_rejected", rejected: selection.rejected }))
    await recorder.complete(db, runId, extracted.text, investigation?.trace)
    const freeTextMaterials = withInvestigationMaterials(selection.accepted.length > 0 ? { supportMaterials: selection.accepted } : {})
    return {
      id: runId,
      outputText: extracted.text,
      status: "COMPLETED",
      errorMessage: null,
      ...freeTextMaterials,
      ...(selection.rejected.length > 0 ? { supportMaterialsRejected: selection.rejected } : {}),
      ...investigationFields,
    }
  } catch (error) {
    // Pausa de QA ("Parar antes da IA"/orçamento) não é uma falha do agente — a chamada nunca
    // aconteceu. Propaga como sinal de controle em vez de marcar a execução como FAILED.
    if (error instanceof AiCallBlockedError) throw error
    const message = error instanceof Error ? error.message : "Erro desconhecido ao executar o agente."
    // V1.7.1c — resposta fora do contrato: a resposta bruta fica na execução (diagnóstico administrativo) e o erro
    // CLASSIFICADO segue para o Workflow (política de retry por categoria), nunca só a mensagem.
    const contractError = error instanceof ModelOutputContractError ? error : null
    if (contractError) Object.assign(contractError.diagnostics, { agentId: input.agentId, agentRunId: runId })
    await recorder.fail(db, runId, message, contractError?.diagnostics.rawResponse ?? null)
    return { id: runId, outputText: null, status: "FAILED", errorMessage: message, error }
  }
}
