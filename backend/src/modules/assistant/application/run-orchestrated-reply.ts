import { extractMarkerPayload, type MarkerParseStatus } from "../../../shared/application/prompting/structured-markers.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { StructuredMonitoringFeedback } from "../../feedbacks/application/create-monitoring-feedback.js"
import { withLlmScope } from "../../../shared/application/llm-telemetry.js"
import type { ChatTurn } from "../infrastructure/gemini-function-calling-client.js"
import { escalateRoute, generateForRoute, routeFor } from "../../../shared/application/model-routing/llm-gateway.js"
import { estimateTokens } from "../../../shared/application/model-routing/token-estimate.js"
import { collectSpecialistClaims, collectSpecialistTemporalAuthorization, extractEvidenceMarker, gateOrchestratorClaims, renderGatingCorrection as renderOrchestratorCorrection, renderSpecialistClaims, renderTextEvidenceInstructions } from "../../investigation/application/text-evidence-gating.js"
import { renderEnvelopeCorrection } from "../../investigation/domain/evidence-gating.js"
import type { EvidenceGatingResult, InvestigationSynthesis } from "../../investigation/domain/tool-trace.js"
import { findSpecialistByToolName, type ResolvedOrchestrator } from "./resolve-orchestrator.js"
import { runSpecialistTool } from "./run-specialist-tool.js"
import { describeStructuredResult, validateStructuredResult, type StructuredOutputDefinition, type StructuredResultIssue } from "../domain/structured-output-definition.js"
import {
  buildSupportMaterialsFreeTextPromptSection,
  extractSupportMaterialsMarker,
  mergeSupportMaterialCandidates,
  selectSupportMaterialRecommendations,
  type SupportMaterialCandidate,
  type SupportMaterialsOutcome,
} from "../../feedbacks/domain/support-material.js"
import type { KnowledgeTrace } from "../../knowledge/application/retrieve-knowledge.js"
import type { InvestigationOutcomeFields } from "../../agents/application/run-agent.js"
import type { SpecialistToolOptions } from "./run-specialist-tool.js"

export type OrchestratedReply = {
  text: string
  agentId: string | null
  calls: { toolName: string; query: string }[]
  // Resposta crua de cada especialista acionado, antes da síntese final — descartada pelo
  // caminho interativo (o chat só mostra `text`), mas é exatamente o que um node Orchestrator
  // de workflow precisa gravar no Execution Context pra Conditions/Outputs posteriores lerem.
  results: {
    agentId: string | null
    toolName: string
    text: string
    /** Contrato do especialista (run-specialist-tool.ts): FEEDBACK = estruturado com evidência
     * literal verificada; TEXT = texto livre (chat/voz, legados). Ausente em respostas antigas. */
    contract?: "FEEDBACK" | "TEXT"
    structured?: StructuredMonitoringFeedback
    /** O que este especialista consultou e os materiais que ele entregou como CANDIDATOS à
     * recomendação final (nunca uma recomendação própria — ver support-material.ts). */
    knowledge?: KnowledgeTrace
    supportMaterialCandidates?: SupportMaterialCandidate[]
    /** Ferramentas de investigação usadas pelo especialista (só quando ele tem capacidades). */
    toolTrace?: InvestigationOutcomeFields["toolTrace"]
    investigation?: InvestigationOutcomeFields["investigation"]
  }[]
  /** União deduplicada (por materialId) dos candidatos de TODOS os especialistas acionados —
   * o conjunto que o Orquestrador pôde escolher. Vazio quando nenhum especialista trouxe KB. */
  supportMaterialCandidates: SupportMaterialCandidate[]
  // Presente só quando o orquestrador tem `outputInstructions` configurado e o modelo
  // devolveu um JSON válido seguindo o marcador (ver `extractStructuredResult`) — nunca
  // hardcoded a um formato específico (diagnóstico, flags etc.), o formato é o que o admin
  // escreveu em `outputInstructions`. null no caminho interativo de sempre (sem essa opção
  // configurada, comportamento 100% inalterado).
  structuredResult: Record<string, unknown> | null
  /** Só quando o orquestrador tem a definição nova de resultado estruturado: resultado da
   * validação do JSON devolvido (tipo/obrigatório/opções/estrutura). Inválido ⇒ `structuredResult`
   * fica null (um Condition nunca lê um campo inválido como válido) e os motivos ficam aqui —
   * registrados no Execution Context/QA Lab, nunca descartados em silêncio. */
  structuredResultValidation?: StructuredResultValidationSummary
  /** EVIDENCE GATING do Orquestrador (V1.2): só quando algum especialista investigou — o Orquestrador
   * não pode elevar o escopo de uma claim (validado por código; persistindo, a síntese vira factual). */
  evidenceGating?: EvidenceGatingResult
  synthesis?: InvestigationSynthesis
  /** V1.7.1 — COMO a coordenação aconteceu (observabilidade honesta: nunca uma chamada de IA que não existiu). */
  orchestration?: OrchestrationTrace
} & SupportMaterialsOutcome

/**
 * V1.7.1 — CAMINHO RÁPIDO do Orquestrador. routing: DETERMINISTIC = especialistas decididos pela configuração declarativa do
 * Workflow (domínios do disparo), sem chamada de IA; MODEL = a IA escolheu. synthesis: PASSTHROUGH = um único especialista com
 * contrato estruturado, resultado repassado sem reescrita; MODEL = síntese pela IA; NONE = nenhum especialista acionado.
 */
export type OrchestrationTrace = {
  routing: { mode: "DETERMINISTIC" | "MODEL"; reason: string; domainIds?: string[] }
  synthesis: { mode: "PASSTHROUGH" | "MODEL" | "NONE"; reason: string }
}

/**
 * Ganchos de uma CONVERSA específica sobre o turno com especialistas (chat/voz). `annotateSpecialistResult` acrescenta, ao texto
 * que a SÍNTESE lê de cada especialista, um bloco calculado pelo sistema (ex.: a relação da resposta com o feedback em tela na
 * sessão de feedback) — o resultado do especialista gravado/devolvido não muda.
 */
export type OrchestrationConversationHooks = {
  annotateSpecialistResult?: (result: { agentId: string | null; toolName: string; query: string; periodDays?: number | undefined; knowledge?: KnowledgeTrace | undefined }) => Promise<string | null>
}

/** Opções do caminho rápido (só o nó de Workflow as passa; chat/voz nunca). */
export type OrchestrationFastPath = {
  /** Domínios de negócio DECLARADOS pelo Workflow para este disparo (roteamento determinístico). */
  fixedDomainIds?: readonly string[]
  /** O consumidor aceita o resultado estruturado do especialista sem síntese (ex.: "Gerar feedback"). */
  allowSynthesisPassthrough?: boolean
}

/**
 * Especialistas decididos pela configuração: cada domínio precisa resolver para EXATAMENTE um especialista DOMAIN do
 * Orquestrador. Qualquer ambiguidade (0 ou 2+) ⇒ null — o roteamento volta para a IA (nunca um palpite).
 */
export function resolveDeterministicRouting(orchestrator: Pick<ResolvedOrchestrator, "specialists">, domainIds: readonly string[]): { toolName: string; agentId: string }[] | null {
  if (domainIds.length === 0) return null
  const chosen: { toolName: string; agentId: string }[] = []
  for (const domainId of new Set(domainIds)) {
    const matches = orchestrator.specialists.filter((specialist) => specialist.specialtyKind === "DOMAIN" && specialist.businessDomainId === domainId)
    if (matches.length !== 1) return null
    if (!chosen.some((entry) => entry.agentId === matches[0]!.agentId)) chosen.push({ toolName: matches[0]!.toolName, agentId: matches[0]!.agentId })
  }
  return chosen
}

export type StructuredResultValidationSummary =
  | { valid: true; fields: { path: string; label: string; displayValue: string }[] }
  | { valid: false; issues: StructuredResultIssue[]; rawResult: Record<string, unknown> | null }

const STRUCTURED_RESULT_MARKER = "STRUCTURED_RESULT_JSON:"

/** Exportado pra ser reaproveitado por `executeOrchestratorConsolidated` (orchestrator-executor.ts)
 * — o Orchestrator pós-JOIN faz sua própria chamada (sem tools/operatorId, nunca especialista
 * escolhendo um colaborador arbitrário — ver Parte 46/47/85/86 do pedido de fan-in/JOIN), mas
 * quando o orquestrador tem `outputInstructions` configurado o resultado estruturado continua
 * funcionando igual, nunca uma segunda implementação do marcador. */
export function withStructuredOutputInstructions(systemPrompt: string, outputInstructions: string | null): string {
  if (!outputInstructions) return systemPrompt
  return `${systemPrompt}\n\nAlém da sua resposta normal em texto, ao terminá-la adicione uma linha própria começando exatamente com "${STRUCTURED_RESULT_MARKER}" (sem nada antes) seguida de um JSON válido (sem markdown, sem texto extra depois) representando: ${outputInstructions}`
}

/** Separa o texto normal (mostrado ao operador) do JSON estruturado (consumido por
 * Conditions/Outputs de workflow) — best-effort: se o marcador não aparecer, ou o JSON não for
 * um objeto válido, `structuredResult` fica null e `text` continua intocado. Nunca lança. */
export function extractStructuredResult(rawText: string): { text: string; structuredResult: Record<string, unknown> | null; markerStatus: MarkerParseStatus } {
  // V1.3.2: framing por scanner balanceado (só o payload deste marcador; duplicado/malformado = null, fail-closed).
  const extraction = extractMarkerPayload(rawText, STRUCTURED_RESULT_MARKER)
  if (extraction.status === "MARKER_NOT_FOUND") return { text: rawText, structuredResult: null, markerStatus: extraction.status }
  const parsed = extraction.payload
  if (extraction.status === "VALID" && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return { text: extraction.text, structuredResult: parsed as Record<string, unknown>, markerStatus: "VALID" }
  }
  return { text: rawText, structuredResult: null, markerStatus: extraction.status === "VALID" ? "MARKER_PAYLOAD_INVALID" : extraction.status }
}

/**
 * Extração + validação contra a definição (quando o orquestrador tem a fonte da verdade nova).
 * Sem definição (legado/sem resultado estruturado) o comportamento é o de sempre: o JSON
 * extraído entra como está, sem validação. Com definição: JSON inválido ⇒ `structuredResult`
 * null + motivos em `structuredResultValidation`; marcador ausente ⇒ também inválido (a
 * definição pedia um resultado que não veio). Reaproveitado por todos os pontos que extraem
 * o marcador (chat, node de Workflow, Orquestrador consolidado, QA Lab) — uma implementação só.
 */
export function extractValidatedStructuredResult(
  rawText: string,
  definition: StructuredOutputDefinition | null,
): { text: string; structuredResult: Record<string, unknown> | null; structuredResultValidation?: StructuredResultValidationSummary } {
  const extracted = extractStructuredResult(rawText)
  // Sem definição, a resposta fica exatamente como sempre foi (sem a chave de validação).
  if (!definition) return extracted
  if (!extracted.structuredResult) {
    return {
      text: extracted.text,
      structuredResult: null,
      structuredResultValidation: { valid: false, issues: [{ path: "", message: "A IA não devolveu o resultado estruturado esperado (marcador ausente ou JSON inválido)." }], rawResult: null },
    }
  }
  const validation = validateStructuredResult(definition, extracted.structuredResult)
  if (!validation.valid) {
    return { text: extracted.text, structuredResult: null, structuredResultValidation: { valid: false, issues: validation.issues, rawResult: extracted.structuredResult } }
  }
  return { text: extracted.text, structuredResult: validation.value, structuredResultValidation: { valid: true, fields: describeStructuredResult(definition, validation.value) } }
}

/**
 * Um turno de chat completo com o orquestrador: pergunta o quê fazer (podendo vir 0, 1 ou N
 * tools acionadas em paralelo), roda cada especialista de verdade, reinjeta os resultados e
 * pede a síntese final — no máximo uma rodada de tool calling (a segunda chamada vai sem
 * `tools`, forçando texto), o suficiente pro caso de uso real (uma pergunta, um ou mais
 * especialistas, uma resposta só).
 */
export async function runOrchestratedReply(
  db: Database,
  orchestrator: ResolvedOrchestrator,
  history: { role: "user" | "model"; text: string }[],
  extraContext: string,
  operatorId: string,
  /** Sujeito da investigação dos especialistas (Workflow: interação/indicador do enrollment). */
  specialistOptions: Pick<SpecialistToolOptions, "investigation" | "outputContract" | "collaboratorConversation" | "analyzeCall" | "excludedCapabilities" | "conversationFrame"> = {},
  fastPath: OrchestrationFastPath = {},
  conversation: OrchestrationConversationHooks = {},
): Promise<OrchestratedReply> {
  const contents: ChatTurn[] = history.map((turn) => ({ role: turn.role, text: turn.text }))
  const baseSystemPrompt = extraContext ? `${orchestrator.systemPrompt}\n\n${extraContext}` : orchestrator.systemPrompt
  const systemPrompt = withStructuredOutputInstructions(baseSystemPrompt, orchestrator.outputInstructions)

  // `withLlmScope` só etiqueta a telemetria (papel/agente de cada chamada, pro trace do QA
  // Lab) — não muda nada na chamada em si.
  const orchestratorScope = { agentId: orchestrator.orchestratorAgentId, ...(orchestrator.knowledge ? { knowledge: orchestrator.knowledge } : {}) }
  // V1.7.1 — ROTEAMENTO DETERMINÍSTICO: com os domínios declarados pelo Workflow resolvendo cada um para um único especialista,
  // a escolha não depende de IA — nenhuma chamada de roteamento. A pergunta ao especialista é a própria instrução do nó.
  const declared = fastPath.fixedDomainIds && fastPath.fixedDomainIds.length > 0 ? resolveDeterministicRouting(orchestrator, fastPath.fixedDomainIds) : null
  const lastUserText = [...history].reverse().find((turn) => turn.role === "user")?.text ?? ""
  const routingTrace: OrchestrationTrace["routing"] = declared
    ? { mode: "DETERMINISTIC", reason: "DECLARED_DOMAINS", domainIds: [...new Set(fastPath.fixedDomainIds)] }
    : { mode: "MODEL", reason: fastPath.fixedDomainIds && fastPath.fixedDomainIds.length > 0 ? "DECLARED_DOMAINS_AMBIGUOUS" : "NOT_DECLARED" }
  const first = declared
    ? { kind: "calls" as const, calls: declared.map((entry) => ({ name: entry.toolName, args: { query: lastUserText } as Record<string, unknown> })) }
    : await (async () => {
        const routingRoute = routeFor({ purpose: "ORCHESTRATOR_ROUTING", phase: "PLANNING", toolSchemaCount: orchestrator.tools.length, estimatedInputTokens: estimateTokens(systemPrompt, JSON.stringify(contents)) })
        return withLlmScope({ role: "orchestrator_routing", ...orchestratorScope }, () => generateForRoute({ classification: { phase: "PLANNING", purpose: "ORCHESTRATOR_ROUTING", source: "ORCHESTRATOR", semanticType: "ROUTING" }, systemPrompt, contents, tools: orchestrator.tools, structuredOutput: false, route: routingRoute }))
      })()
  if (first.kind === "text") {
    // Sem especialista acionado não há candidato algum (o Orquestrador não consulta KB por conta
    // própria) — logo, nunca há recomendação aqui; um marcador que o modelo emita por conta
    // própria é removido do texto e descartado.
    const stripped = extractSupportMaterialsMarker(first.text)
    const { text, structuredResult, structuredResultValidation } = extractValidatedStructuredResult(stripped.text, orchestrator.structuredOutput)
    return { text, agentId: null, calls: [], results: [], structuredResult, supportMaterialCandidates: [], ...(structuredResultValidation ? { structuredResultValidation } : {}), orchestration: { routing: routingTrace, synthesis: { mode: "NONE", reason: "NO_SPECIALIST_CALLED" } } }
  }

  const calls = first.calls
  const results = await Promise.all(
    calls.map(async (call) => {
      const agentId = findSpecialistByToolName(orchestrator, call.name)
      const query = typeof call.args.query === "string" ? call.args.query : JSON.stringify(call.args)
      const periodDays = typeof call.args.periodDays === "number" ? call.args.periodDays : undefined
      const engineAnalysis = agentId && specialistOptions.analyzeCall ? await specialistOptions.analyzeCall(agentId) : null
      const specialist = engineAnalysis
        // A referência da análise do motor viaja no lugar do resultado estruturado (lida por `callAnalysisRefOf` no "Gerar feedback").
        ? ({ contract: "FEEDBACK", text: engineAnalysis.text, structured: engineAnalysis.structured as StructuredMonitoringFeedback } as const)
        : agentId
          ? await withLlmScope({ role: "specialist", agentId }, () => runSpecialistTool(db, orchestrator.organizationId, agentId, query, operatorId, periodDays, extraContext || undefined, specialistOptions))
          : ({ contract: "TEXT", text: "Especialista não encontrado para esse pedido." } as const)
      return {
        toolName: call.name,
        agentId,
        query,
        periodDays,
        text: specialist.text,
        contract: specialist.contract,
        ...(specialist.contract === "FEEDBACK" ? { structured: specialist.structured } : {}),
        ...("knowledge" in specialist ? { knowledge: specialist.knowledge, supportMaterialCandidates: specialist.supportMaterialCandidates } : {}),
        ...("toolTrace" in specialist && specialist.toolTrace ? { toolTrace: specialist.toolTrace, investigation: specialist.investigation } : {}),
      }
    }),
  )

  // Agregação: candidatos de TODOS os especialistas acionados (qualquer domínio), deduplicados
  // por material. A seleção final é do Orquestrador e só existe quando habilitada — desligado, os
  // especialistas continuam usando KB normalmente e a resposta sai sem recomendação.
  const supportMaterialCandidates = mergeSupportMaterialCandidates(results.map((result) => result.supportMaterialCandidates ?? []))
  const recommendationEnabled = orchestrator.recommendSupportMaterials && supportMaterialCandidates.length > 0

  // V1.7.1 — SÍNTESE DISPENSADA: um único especialista, com contrato ESTRUTURADO já verificado por ele, sem resultado
  // estruturado nem recomendação de material pedidos ao Orquestrador, e um consumidor que aceita o resultado do especialista.
  // Não há o que coordenar nem combinar: reescrever com IA só gastaria (e poderia ampliar) o resultado.
  const single = results.length === 1 ? results[0]! : null
  const passthrough = fastPath.allowSynthesisPassthrough === true && single !== null && single.contract === "FEEDBACK" && single.agentId !== null && !orchestrator.outputInstructions && !orchestrator.structuredOutput && !recommendationEnabled
  if (passthrough && single) {
    return {
      text: single.text,
      agentId: single.agentId,
      calls: [{ toolName: single.toolName, query: single.query }],
      results: [{
        agentId: single.agentId,
        toolName: single.toolName,
        text: single.text,
        contract: single.contract,
        ...(single.structured ? { structured: single.structured } : {}),
        ...(single.knowledge ? { knowledge: single.knowledge } : {}),
        ...(single.supportMaterialCandidates ? { supportMaterialCandidates: single.supportMaterialCandidates } : {}),
        ...(single.toolTrace ? { toolTrace: single.toolTrace, investigation: single.investigation } : {}),
      }],
      structuredResult: null,
      supportMaterialCandidates,
      orchestration: { routing: routingTrace, synthesis: { mode: "PASSTHROUGH", reason: "SINGLE_STRUCTURED_SPECIALIST" } },
    }
  }
  const synthesisReason = results.length > 1 ? "MULTIPLE_SPECIALISTS" : !fastPath.allowSynthesisPassthrough ? "PASSTHROUGH_NOT_ALLOWED" : single?.contract !== "FEEDBACK" ? "SPECIALIST_NOT_STRUCTURED" : orchestrator.outputInstructions || orchestrator.structuredOutput ? "STRUCTURED_RESULT_REQUESTED" : recommendationEnabled ? "SUPPORT_MATERIAL_SELECTION" : "SPECIALIST_NOT_FOUND"

  // O que a síntese lê de cada especialista: a resposta + o bloco do sistema da conversa, quando há (o resultado gravado não muda).
  const synthesisTexts = await Promise.all(
    results.map(async (result) => {
      const annotation = conversation.annotateSpecialistResult ? await conversation.annotateSpecialistResult({ agentId: result.agentId, toolName: result.toolName, query: result.query, periodDays: result.periodDays, knowledge: "knowledge" in result ? result.knowledge : undefined }) : null
      return annotation ? `${result.text}\n\n${annotation}` : result.text
    }),
  )
  // Roteamento determinístico: o modelo NUNCA emitiu essas function calls — a síntese recebe as respostas como texto (nada de
  // turno "model" fabricado).
  const followUp: ChatTurn[] = declared
    ? [...contents, { role: "user", text: `Respostas dos especialistas acionados:\n\n${results.map((result, index) => `— ${result.toolName}: ${synthesisTexts[index]}`).join("\n\n")}` }]
    : [
        ...contents,
        { role: "model", functionCalls: calls },
        { role: "user", functionResponses: results.map((result, index) => ({ name: result.toolName, response: { result: synthesisTexts[index] } })) },
      ]
  // Síntese: UMA rodada de roteamento por desenho (sem tools aqui). O modelo às vezes emite uma
  // nova function call mesmo sem tool declarada (visto ao vivo em 2026-09-16: pediu Retenção na
  // síntese do Modelo 08) — em vez de devolver "não consegui sintetizar", repete a síntese UMA vez
  // com a instrução explícita de que não há mais especialistas (custo máximo: +1 request; nunca
  // uma segunda rodada de roteamento — dependência entre especialistas é evolução futura).
  // EVIDÊNCIA DOS ESPECIALISTAS (V1.2): claims C1..Cn com escopo/representatividade; a síntese só pode
  // citar/repetir — nunca ampliar o escopo ("em I1 houve pausa" nunca vira "pausas recorrentes").
  const specialistClaims = collectSpecialistClaims(results.map((result) => ({ agentName: result.toolName, synthesis: result.investigation?.synthesis })))
  const specialistLimitations = [...new Set(results.flatMap((result) => result.investigation?.synthesis?.limitations ?? []))]
  const anyInvestigated = results.some((result) => result.investigation)
  const specialistOutcomes = results.filter((result) => result.investigation?.stopReason).map((result) => ({ specialist: result.toolName, stopReason: result.investigation!.stopReason!, status: result.investigation!.sufficiency?.status ?? null }))
  // V1.3.4.2 (§18): o que os especialistas autorizam sobre o tempo — a síntese não pode escrever "permaneceu estável" que ninguém sustentou.
  const specialistTemporal = collectSpecialistTemporalAuthorization(results)
  const evidenceBlock = anyInvestigated ? renderSpecialistClaims(specialistClaims, specialistLimitations, specialistOutcomes) : ""
  const synthesisSystemPrompt =
    `${systemPrompt}\n\nAs respostas dos especialistas acionados já estão acima. Escreva agora a síntese final em texto — não acione mais nenhum especialista.` +
    (evidenceBlock ? `\n\n${evidenceBlock}\n\n${renderTextEvidenceInstructions(specialistClaims.map((claim) => claim.ref), { claimRefsLabel: "refs = afirmações dos especialistas (C-n); nunca amplie o escopo delas" })}` : "") +
    (recommendationEnabled ? `\n\n${buildSupportMaterialsFreeTextPromptSection(supportMaterialCandidates)}` : "")
  const crossDomain = new Set(results.map((result) => result.agentId).filter(Boolean)).size > 1
  let synthesisRoute = routeFor({ purpose: "ORCHESTRATOR_SYNTHESIS", phase: "SYNTHESIS", specialistCount: results.length, crossDomain, estimatedInputTokens: estimateTokens(synthesisSystemPrompt, JSON.stringify(followUp)) })
  const synthesisClassification = { phase: "SYNTHESIS" as const, purpose: "ORCHESTRATOR_SYNTHESIS", source: "ORCHESTRATOR" as const, semanticType: orchestrator.structuredOutput ? ("STRUCTURED_RESULT" as const) : ("TEXT" as const) }
  const synthesize = async (turns: ChatTurn[], correction = false) => {
    const classification = correction ? { ...synthesisClassification, purpose: "GATING_CORRECTION" } : synthesisClassification
    let final = await withLlmScope({ role: "orchestrator_synthesis", ...orchestratorScope }, () => generateForRoute({ classification, systemPrompt: synthesisSystemPrompt, contents: turns, tools: [], structuredOutput: false, route: synthesisRoute }))
    if (final.kind !== "text") {
      const retry: ChatTurn[] = [...turns, { role: "user", text: "Não há mais especialistas disponíveis nesta análise. Sintetize com as respostas já recebidas, em texto." }]
      final = await withLlmScope({ role: "orchestrator_synthesis", ...orchestratorScope }, () => generateForRoute({ classification, systemPrompt: synthesisSystemPrompt, contents: retry, tools: [], structuredOutput: false, route: synthesisRoute }))
    }
    return final.kind === "text" ? final.text : "Não consegui sintetizar uma resposta a partir dos especialistas consultados."
  }
  let rawFinalText = await synthesize(followUp)
  let evidenceGating: EvidenceGatingResult | undefined
  let orchestratorSynthesis: InvestigationSynthesis | undefined
  if (evidenceBlock) {
    // FAIL-CLOSED (V1.3): envelope ausente/inválido ou claim que amplia o escopo → UMA correção; persistindo → síntese FACTUAL
    // (as respostas dos especialistas, já validadas por eles) — o texto não validado nunca chega ao usuário.
    const firstPass = extractEvidenceMarker(rawFinalText)
    const rejected = firstPass.present ? gateOrchestratorClaims(firstPass.synthesis, specialistClaims, { ...specialistTemporal, text: firstPass.text }) : []
    rawFinalText = firstPass.text
    orchestratorSynthesis = firstPass.synthesis
    if (firstPass.present && rejected.length === 0) {
      evidenceGating = { rejectedClaims: [], corrected: false, envelopePresent: true, parseStatus: "PARSED", correctionAttempted: false, correctionSucceeded: false, fallbackUsed: false, fallbackReason: null }
    } else {
      console.warn(JSON.stringify({ event: firstPass.present ? "orchestrator_evidence_gating_rejected" : "orchestrator_evidence_envelope_missing", orchestratorId: orchestrator.orchestratorId, parseStatus: firstPass.parseStatus, rejected }))
      synthesisRoute = escalateRoute(synthesisRoute, "GATING_CORRECTION")
      const correction = firstPass.present ? renderOrchestratorCorrection(rejected) : renderEnvelopeCorrection("MARKER_LINE")
      const retryPass = extractEvidenceMarker(await synthesize([...followUp, { role: "user", text: `${correction}\n\nRESPOSTA ANTERIOR (a corrigir):\n${firstPass.text}` }], true))
      const still = retryPass.present ? gateOrchestratorClaims(retryPass.synthesis, specialistClaims, { ...specialistTemporal, text: retryPass.text }) : []
      orchestratorSynthesis = retryPass.synthesis
      if (retryPass.present && still.length === 0) {
        rawFinalText = retryPass.text
        evidenceGating = { rejectedClaims: rejected, corrected: true, envelopePresent: true, parseStatus: "PARSED", correctionAttempted: true, correctionSucceeded: true, fallbackUsed: false, fallbackReason: null }
      } else {
        // Persistindo, a síntese vira FACTUAL: as respostas dos especialistas (já validadas) sem a camada que ampliou o escopo.
        rawFinalText = ["Não foi possível sintetizar com evidência suficiente; seguem as respostas dos especialistas consultados:", ...results.map((result) => `— ${result.text}`)].join("\n\n")
        evidenceGating = { rejectedClaims: [...rejected, ...still], corrected: false, envelopePresent: retryPass.present, parseStatus: retryPass.parseStatus, correctionAttempted: true, correctionSucceeded: false, fallbackUsed: true, fallbackReason: retryPass.present ? "CLAIMS_REJECTED" : "ENVELOPE_MISSING" }
        orchestratorSynthesis = { ...retryPass.synthesis, behavioralClaims: [] }
      }
    }
  }
  // Marcador de materiais sai ANTES e independente do marcador do resultado estruturado
  // (supportMaterials nunca é campo do Structured Output). Sem habilitação, qualquer marcador
  // que o modelo emita é removido do texto e ignorado.
  const materials = extractSupportMaterialsMarker(rawFinalText)
  const selection = recommendationEnabled ? selectSupportMaterialRecommendations(materials.raw, supportMaterialCandidates) : { accepted: [], rejected: [] }
  if (selection.rejected.length > 0) console.warn(JSON.stringify({ event: "orchestrator_support_materials_rejected", orchestratorId: orchestrator.orchestratorId, rejected: selection.rejected }))
  const { text: finalText, structuredResult, structuredResultValidation } = extractValidatedStructuredResult(materials.text, orchestrator.structuredOutput)

  const uniqueAgentIds = [...new Set(results.map((result) => result.agentId).filter((id): id is string => Boolean(id)))]
  return {
    ...(evidenceGating ? { evidenceGating } : {}),
    ...(orchestratorSynthesis ? { synthesis: orchestratorSynthesis } : {}),
    text: finalText,
    agentId: uniqueAgentIds.length === 1 ? uniqueAgentIds[0]! : null,
    calls: results.map((result) => ({ toolName: result.toolName, query: result.query })),
    results: results.map((result) => ({
      agentId: result.agentId,
      toolName: result.toolName,
      text: result.text,
      contract: result.contract,
      ...(result.structured ? { structured: result.structured } : {}),
      ...(result.knowledge ? { knowledge: result.knowledge } : {}),
      ...(result.supportMaterialCandidates ? { supportMaterialCandidates: result.supportMaterialCandidates } : {}),
      ...(result.toolTrace ? { toolTrace: result.toolTrace, investigation: result.investigation } : {}),
    })),
    structuredResult,
    supportMaterialCandidates,
    ...(selection.accepted.length > 0 ? { supportMaterials: selection.accepted } : {}),
    ...(selection.rejected.length > 0 ? { supportMaterialsRejected: selection.rejected } : {}),
    ...(structuredResultValidation ? { structuredResultValidation } : {}),
    orchestration: { routing: routingTrace, synthesis: { mode: "MODEL", reason: synthesisReason } },
  }
}
