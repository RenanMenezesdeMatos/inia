import { isRecognitionSkippedOutput } from "./recognition-fact.js"
import { withKnowledgeConsultation } from "../../knowledge/application/knowledge-consultation-context.js"
import { enforceResponseBeforeNextStep } from "../../governance/application/response-compliance.js"
import { replyComplianceSources } from "../../governance/domain/response-compliance.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { withLlmScope } from "../../../shared/application/llm-telemetry.js"
import type { ChatTurn } from "../../assistant/infrastructure/gemini-function-calling-client.js"
import { generateForRoute, routeFor } from "../../../shared/application/model-routing/llm-gateway.js"
import { estimateTokens } from "../../../shared/application/model-routing/token-estimate.js"
import { resolveOrchestratorById } from "../../assistant/application/resolve-orchestrator.js"
import type { ScopedTarget } from "../../auth/application/manageable-scopes.js"
import { extractSupportMaterialsMarker } from "../../feedbacks/domain/support-material.js"
import { extractValidatedStructuredResult, runOrchestratedReply, withStructuredOutputInstructions, type OrchestratedReply } from "../../assistant/application/run-orchestrated-reply.js"
import type { OrchestratorNodeConfig } from "../domain/graph-schema.js"
import { projectNodeOutputsForModel } from "../domain/model-context-projection.js"
import type { EmployeeCollectionOutput } from "./select-employees-executor.js"
import type { EmployeeFanInOutput } from "./consolidate-results-executor.js"
import { resolveEnrollmentOperatorId, type EnrollmentSubjectContext } from "./enrollment-subject.js"
import type { WorkflowEffectSink } from "./effect-sink.js"

export type OrchestratorExecutionContext = EnrollmentSubjectContext & {
  /** Organização da matrícula — o Orquestrador referenciado pelo node precisa ser dela. */
  organizationId: string
  /** Transcrição/texto de contexto do enrollment (mesmo `inputContext` que um Agent node recebe) — vira contexto extra do prompt do orquestrador. */
  inputContext: string
  /** MOTOR DE FEEDBACK — com "Avaliação de processo", o especialista escolhido roda a análise do motor (memória gravada). */
  engine?: { effects: Pick<WorkflowEffectSink, "feedbackEngine" | "recordWorkflowKnowledgeUsage">; organizationId: string; workflowId: string | null; enrollmentId: string; nodeId: string; matchedFlagName: string | null } | undefined
  /** Execução de uma versão PUBLICADA do Workflow: etapa sem versão fixada = publicada antes do versionamento (PEN-076). */
  publishedRun?: boolean | undefined
  /** Alcance do Workflow (motor e QA Lab): a versão fixada do Orquestrador só roda se servir a ele. */
  workflowScope: ScopedTarget
}

/** Versão do Orquestrador que a etapa executa (PEN-076): a fixada; sem ela, numa versão publicada, a de origem da migração. A
 * resolução confere o alcance dessa versão com o do Workflow (`resolve-orchestrator.ts`). */
export function orchestratorPinOf(config: { orchestratorVersionId?: string | undefined }, publishedRun: boolean | undefined, workflowScope: ScopedTarget) {
  return { versionId: config.orchestratorVersionId ?? null, legacyPin: !config.orchestratorVersionId && publishedRun === true, workflowScope }
}

export type OrchestratorNodeOutput = OrchestratedReply & {
  orchestratorId: string
  orchestratorName: string
  /** Só presente quando o Orquestrador consolidado NÃO chamou a IA — hoje o único motivo é um
   * fan-in vazio (ver executeOrchestratorConsolidated). Nunca silencioso: o texto do resultado diz
   * o mesmo, e o evento `orchestrator_executed` carrega `skippedReason`. */
  skippedReason?: "EMPTY_FAN_IN" | "CALL_ALREADY_MONITORED"
}
export type OrchestratorExecutionResult = { nodeOutput: OrchestratorNodeOutput }

/** O que uma etapa de orquestrador entrega ao próximo passo: o texto e o resultado estruturado, quando há. */
function complianceTextOf(reply: { text: string; structuredResult?: unknown }): string {
  return reply.structuredResult ? `${reply.text}\n\n${JSON.stringify(reply.structuredResult)}` : reply.text
}

/**
 * Chama o Orchestrator (módulo assistant) como um node do Workflow — reaproveita a mesma
 * resolução e execução do caminho interativo (`resolveOrchestratorById`/`runOrchestratedReply`,
 * sem duplicar nenhuma lógica de function-calling), só que a instrução é fixa
 * (`config.instruction`), não digitada por um operador ao vivo, e quem recebe o resultado é o
 * Execution Context (`node_outputs`), não uma tela de chat. O Orchestrator nunca decide o
 * próximo node — só devolve dados; quem continua o grafo é sempre o Workflow.
 *
 * Diferente do caminho interativo (que resolve "o" orquestrador do escopo do operador), aqui o
 * node referencia um orquestrador específico (`config.orchestratorId`) — pode haver vários
 * publicados (Monitoria Geral, Retenção...) e o Workflow escolhe qual usar em cada ponto.
 *
 * Falha o node (em vez de pular silenciosamente) quando esse orquestrador não existe, está
 * inativo, ou não aceita invocação por WORKFLOW — evita um workflow publicado que nunca produz
 * o resultado esperado sem nenhum sinal do porquê.
 */
export async function executeOrchestrator(
  config: OrchestratorNodeConfig,
  context: OrchestratorExecutionContext,
): Promise<OrchestratorExecutionResult> {
  const operatorId = await resolveEnrollmentOperatorId(context)
  if (!operatorId) throw new Error("Não foi possível identificar o operador para acionar o orquestrador.")

  const orchestrator = await resolveOrchestratorById(context.db, context.organizationId, config.orchestratorId, "WORKFLOW", config.instruction, orchestratorPinOf(config, context.publishedRun, context.workflowScope))
  if (!orchestrator) {
    throw new Error("Orquestrador não encontrado, inativo, ou não habilitado para uso em workflow.")
  }

  // `ONE_MONITORING_PER_CALL_V1`: avaliação de processo de uma chamada que JÁ tem monitoria entregue (outro Workflow, outro sinal) —
  // nada é roteado nem analisado (zero IA); o "Gerar feedback" seguinte se abstém pelo mesmo motivo.
  if (config.specialistOutputContract === "PROCESS_ASSESSMENT" && context.enrollment.interactionId && context.engine) {
    const monitored = await context.engine.effects.feedbackEngine.deliveredMonitoring(context.db, { organizationId: context.engine.organizationId, interactionId: context.enrollment.interactionId })
    if (monitored) {
      const skipped: OrchestratedReply = { text: `Chamada já monitorada (${monitored.deliveredAt.toISOString().slice(0, 10)}): uma chamada recebe uma monitoria só — nada foi analisado.`, agentId: null, calls: [], results: [], structuredResult: null, supportMaterialCandidates: [] }
      return { nodeOutput: { ...skipped, orchestratorId: orchestrator.orchestratorId, orchestratorName: orchestrator.orchestratorName, skippedReason: "CALL_ALREADY_MONITORED" } }
    }
  }
  const history = [{ role: "user" as const, text: config.instruction }]
  // Uma etapa de orquestrador é uma consulta às bases: uma versão só de cada base, e as usadas ficam registradas (PEN-008).
  const reply = await withKnowledgeConsultation(async () => {
    const orchestrated = await runOrchestratedReply(
    context.db,
    orchestrator,
    history,
    context.inputContext,
    operatorId,
    {
      investigation: { interactionId: context.enrollment.interactionId },
      // V1.6.0 — o Workflow decide o formato dos especialistas (PROCESS_ASSESSMENT só com Flag, validado no publish).
      ...(config.specialistOutputContract ? { outputContract: config.specialistOutputContract } : {}),
      // MOTOR DE FEEDBACK — avaliação de processo de uma chamada: o especialista roteado analisa pelo motor (procedimento completo,
      // verificação, memória). O roteamento e a política do Orquestrador continuam os mesmos.
      ...(config.specialistOutputContract === "PROCESS_ASSESSMENT" && context.enrollment.interactionId && context.engine
        ? {
            analyzeCall: async (agentId: string) => {
              const engine = context.engine!
              const analysis = await engine.effects.feedbackEngine.analyzeCall(context.db, {
                organizationId: engine.organizationId,
                interactionId: context.enrollment.interactionId!,
                collaboratorId: operatorId,
                agentId,
                trigger: { kind: "WORKFLOW_SOURCE_NODE", workflowId: engine.workflowId, enrollmentId: engine.enrollmentId, nodeId: engine.nodeId, selectionReason: engine.matchedFlagName ? `Sinal da chamada no gatilho do Workflow: ${engine.matchedFlagName}.` : "Chamada selecionada pela execução do Workflow." },
              })
              return { text: analysis.text, structured: { callAnalysis: analysis } }
            },
          }
        : {}),
    },
    // V1.7.1 — caminho rápido: domínios declarados no nó (roteamento sem IA) e síntese dispensada quando o consumidor aceita o
    // resultado estruturado do especialista — só para nós que optaram (avaliação de processo ou roteamento declarado); nós
    // antigos continuam com a síntese de sempre (o texto dela pode ser lido por Condition/Output legados).
    {
      ...(config.routing?.mode === "DOMAINS" ? { fixedDomainIds: config.routing.businessDomainIds } : {}),
      allowSynthesisPassthrough: config.specialistOutputContract === "PROCESS_ASSESSMENT" || config.routing?.mode === "DOMAINS",
    },
  )
    if (context.engine) await context.engine.effects.recordWorkflowKnowledgeUsage(context.db, context.engine.enrollmentId)
    // Conferência antes de a saída seguir (PEN-017). A avaliação de processo roda no motor de feedback, que não recebe as regras: depende da PEN-018.
    if (config.specialistOutputContract !== "PROCESS_ASSESSMENT") {
      await enforceResponseBeforeNextStep(context.db, { organizationId: context.organizationId, text: complianceTextOf(orchestrated), agentId: orchestrator.orchestratorAgentId || null, surface: "WORKFLOW_ORCHESTRATOR", source: "WORKFLOW_ORCHESTRATOR", workflowEnrollmentId: context.engine?.enrollmentId, sources: replyComplianceSources(orchestrated, orchestrator) })
    }
    return orchestrated
  })
  return { nodeOutput: { ...reply, orchestratorId: orchestrator.orchestratorId, orchestratorName: orchestrator.orchestratorName } }
}

/** Contexto pós-JOIN (fan-in) — N colaboradores, nunca UM operador fingindo representar todos
 * (ver Parte 46/86 do pedido de fan-in/JOIN). */
export type ConsolidatedOrchestratorContext = {
  db: Database
  /** Organização da matrícula — o Orquestrador referenciado pelo node precisa ser dela. */
  organizationId: string
  inputContext: string
  fanIn: EmployeeFanInOutput
  collection: EmployeeCollectionOutput | null
  publishedRun?: boolean | undefined
  /** Alcance do Workflow: a versão fixada do Orquestrador só roda se servir a ele. */
  workflowScope: ScopedTarget
}

/** Monta um texto estruturado com os N resultados individuais — nunca UUID cru (nomes resolvidos
 * antes), nunca inventa campo que o filho não produziu (Parte 24/65/66). Cobre decisão de Human
 * Review quando presente (o dado mais importante pro Orchestrator consolidado sintetizar — Parte
 * 64) e falha quando presente; o resto do `node_outputs` de cada filho entra como referência
 * compacta (JSON) — formatação rica por tipo de node fica para uma evolução futura (V1: texto
 * minimamente estruturado, nunca um blob gigante — Parte 21). */
function describeConsolidatedContext(fanIn: EmployeeFanInOutput, collection: EmployeeCollectionOutput | null, names: Map<string, string>): string {
  const lines: string[] = []
  // Se a coleção de origem foi particionada por Grupo/Subgrupo (evolução de Ranking — Parte
  // 65/66 do pedido), preserva essa informação no contexto consolidado SEM tocar o engine de
  // fan-in/JOIN nem o schema de EmployeeFanInChild: o nome do balde de cada filho já está
  // disponível em `collection.partitions`, então só precisa de um lookup aqui.
  const partitionNameByEmployeeId = new Map<string, string>()
  if (collection) {
    // "Por critério" (mode ausente = legado, Parte 64) e "Por ranking" descrevem a coleção de
    // origem de formas diferentes — nunca um "notMatchedCount" inventado pro ranking, que não tem
    // esse conceito (tem "solicitados"/"elegíveis" em vez disso).
    if (collection.mode === "RANKING") {
      const partitionText = collection.partitionBy === "NONE" ? "" : `, separado por ${collection.partitionBy === "TEAM" ? "Grupo" : "Subgrupo"} (${collection.partitions.length} baldes)`
      lines.push(
        `Coleção original (ranking${partitionText}): ${collection.evaluatedCount} avaliados, ${collection.rankedCount} com dados, ${collection.requestedCountPerPartition} solicitados por balde, ${collection.selectedCount} selecionados.`,
      )
      if (collection.partitionBy !== "NONE") {
        for (const partition of collection.partitions) {
          if (!partition.name) continue
          for (const member of partition.members) partitionNameByEmployeeId.set(member.employeeId, partition.name)
        }
      }
    } else {
      lines.push(`Coleção original: ${collection.evaluatedCount} avaliados, ${collection.selectedCount} selecionados, ${collection.notMatchedCount} não atenderam, ${collection.noDataCount} sem dados.`)
    }
  }
  lines.push(`Execuções individuais: ${fanIn.expectedCount} esperadas, ${fanIn.completedCount} concluídas, ${fanIn.failedCount} falharam.`)
  lines.push("")
  for (const child of fanIn.children) {
    const name = names.get(child.employeeId) ?? child.employeeId
    const partitionPrefix = partitionNameByEmployeeId.has(child.employeeId) ? `[${partitionNameByEmployeeId.get(child.employeeId)}] ` : ""
    if (child.status === "failed") {
      lines.push(`${partitionPrefix}${name}: falhou — ${child.failureReason ?? "motivo não identificado"}.`)
      continue
    }
    // Sem reconhecimento: só o fato, sem os números. A pessoa não é destaque nem caso de atenção, e o modelo inventava leitura em cima deles ("estagnação").
    if (Object.values(child.nodeOutputs).some(isRecognitionSkippedOutput)) {
      lines.push(`${partitionPrefix}${name}: sem reconhecimento neste ciclo. Só esta pessoa tinha dados, então não houve comparação.`)
      continue
    }
    const reviewEntry = Object.values(child.nodeOutputs).find(
      (value): value is { decision: string } => Boolean(value) && typeof value === "object" && "decision" in (value as Record<string, unknown>),
    )
    const reviewText = reviewEntry ? `revisão humana: ${reviewEntry.decision}. ` : ""
    // MODEL context: resultados projetados (sem ids, measurementIds, contextSnapshot, toolTrace) — o Execution Context continua completo.
    lines.push(`${partitionPrefix}${name}: concluído. ${reviewText}resultados: ${JSON.stringify(projectNodeOutputsForModel(child.nodeOutputs))}`)
  }
  return lines.join("\n")
}

/**
 * O ÚNICO formato de resultado consolidado que entra num prompt — usado pelo Orchestrator pós-JOIN
 * (legado, abaixo) e pelo Agent de síntese (synthesis-agent-executor.ts). Nomes resolvidos antes;
 * nunca UUID cru. Nunca criar um segundo formato.
 */
export async function buildConsolidatedSummary(db: Database, fanIn: EmployeeFanInOutput, collection: EmployeeCollectionOutput | null): Promise<string> {
  const employeeIds = fanIn.children.map((child) => child.employeeId).filter((id) => /^[0-9a-f-]{36}$/i.test(id))
  const names = new Map<string, string>()
  if (employeeIds.length > 0) {
    const result = await db.query<{ id: string; name: string }>(`select id, name from people where id = any($1::uuid[])`, [employeeIds])
    for (const row of result.rows) names.set(row.id, row.name)
  }
  return describeConsolidatedContext(fanIn, collection, names)
}

/**
 * Orchestrator pós-JOIN (Consolidar resultados → Orchestrator) — CAMINHO LEGADO mantido durante a
 * transição para o Agent de síntese (migration 057 / synthesis-agent-executor.ts): os Workflows já
 * publicados que apontam para um Orquestrador aqui continuam funcionando igual. Nunca chama
 * `resolveEnrollmentOperatorId`: não existe "o operador" aqui, é literalmente a garantia pedida
 * (Parte 46/86 do pedido de fan-in/JOIN — não reintroduzir a pessoa-âncora fingindo representar
 * uma estrutura). Roda SEM tools/especialistas (gateway com `tools: []`) — decisão de escopo
 * V1 explícita: todo tool de um Orchestrator hoje é um especialista single-operator-backed
 * (`findSpecialistByToolName` → `runSpecialistTool(..., operatorId, ...)`), e a Parte 47 exige
 * nunca selecionar um colaborador arbitrário pra alimentá-los — a forma segura de cumprir isso
 * nesta versão é o Orchestrator consolidado nunca oferecer tool nenhum, só sintetizar o contexto
 * já estruturado (exatamente o caso de uso do pedido: "resumo executivo dos diagnósticos").
 * Specialists multi-operador ficam para uma evolução futura.
 */
export async function executeOrchestratorConsolidated(
  config: OrchestratorNodeConfig,
  context: ConsolidatedOrchestratorContext,
): Promise<OrchestratorExecutionResult> {
  const orchestrator = await resolveOrchestratorById(context.db, context.organizationId, config.orchestratorId, "WORKFLOW", config.instruction, orchestratorPinOf(config, context.publishedRun, context.workflowScope))
  if (!orchestrator) {
    throw new Error("Orquestrador não encontrado, inativo, ou não habilitado para uso em workflow.")
  }

  // JOIN vazio (rodada de hardening dos Workflows-modelo, 2026-09-16): "Selecionar colaboradores"
  // não achou ninguém → zero filhos → não há resultado individual nenhum pra sintetizar. Antes,
  // o Orquestrador gastava uma request de IA pra "resumir" uma lista vazia. Agora devolve um
  // resultado determinístico, explícito (texto + `skippedReason`), no MESMO formato de node
  // output — o Output seguinte continua entregando normalmente ("nenhum caso neste período" é
  // uma informação real pra gestão). Nunca desvia o fluxo: quem quiser um branch próprio pra
  // "vazio" usa uma Condition sobre `nodeOutputs.<join>.expectedCount`.
  if (context.fanIn.expectedCount === 0) {
    const emptyReply: OrchestratedReply = {
      text: "Nenhum colaborador foi selecionado para análise neste período — não há resultados individuais para sintetizar.",
      agentId: null,
      calls: [],
      results: [],
      structuredResult: null,
      supportMaterialCandidates: [],
    }
    return { nodeOutput: { ...emptyReply, orchestratorId: orchestrator.orchestratorId, orchestratorName: orchestrator.orchestratorName, skippedReason: "EMPTY_FAN_IN" } }
  }

  const consolidatedSummary = await buildConsolidatedSummary(context.db, context.fanIn, context.collection)
  const extraContext = context.inputContext ? `${context.inputContext}\n\n${consolidatedSummary}` : consolidatedSummary
  const baseSystemPrompt = `${orchestrator.systemPrompt}\n\n${extraContext}`
  const systemPrompt = withStructuredOutputInstructions(baseSystemPrompt, orchestrator.outputInstructions)
  const contents: ChatTurn[] = [{ role: "user", text: config.instruction }]

  // Pelo gateway (V1.3 — §43): rota ORCHESTRATOR_SYNTHESIS, classificação e telemetria completas. O prefixo
  // carrega o consolidado (dinâmico) — sem cache explícito por desenho.
  const route = routeFor({ purpose: "ORCHESTRATOR_SYNTHESIS", phase: "SYNTHESIS", specialistCount: 0, estimatedInputTokens: estimateTokens(systemPrompt, config.instruction) })
  const result = await withLlmScope({ role: "orchestrator_synthesis", agentId: orchestrator.orchestratorAgentId }, () =>
    generateForRoute({
      classification: { phase: "SYNTHESIS", purpose: "ORCHESTRATOR_SYNTHESIS", source: "WORKFLOW_ORCHESTRATOR", semanticType: orchestrator.structuredOutput ? "STRUCTURED_RESULT" : "MANAGERIAL_SUMMARY" },
      contextBreakdown: { staticPromptChars: orchestrator.systemPrompt.length, toolSchemaChars: 0, evidenceLedgerChars: consolidatedSummary.length, interactionContentChars: 0, knowledgeContentChars: 0, structuredSchemaChars: systemPrompt.length - baseSystemPrompt.length, objectiveChars: config.instruction.length },
      systemPrompt,
      contents,
      tools: [],
      structuredOutput: false,
      route,
    }),
  )
  const rawText = result.kind === "text" ? result.text : "Não consegui sintetizar uma resposta a partir do resultado consolidado."
  const { text, structuredResult, structuredResultValidation } = extractValidatedStructuredResult(extractSupportMaterialsMarker(rawText).text, orchestrator.structuredOutput)

  // Pós-JOIN não aciona especialistas (o consolidado já vem do Execution Context) — sem candidato
  // de KB nesta chamada, logo sem recomendação; qualquer marcador emitido pelo modelo é ignorado.
  await enforceResponseBeforeNextStep(context.db, { organizationId: context.organizationId, text: complianceTextOf({ text, structuredResult }), agentId: orchestrator.orchestratorAgentId || null, surface: "WORKFLOW_ORCHESTRATOR", source: "WORKFLOW_ORCHESTRATOR" })
  const reply: OrchestratedReply = { text, agentId: null, calls: [], results: [], structuredResult, supportMaterialCandidates: [], ...(structuredResultValidation ? { structuredResultValidation } : {}) }
  return { nodeOutput: { ...reply, orchestratorId: orchestrator.orchestratorId, orchestratorName: orchestrator.orchestratorName } }
}
