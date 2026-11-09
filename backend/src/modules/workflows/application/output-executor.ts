import { isRecognitionSkippedOutput } from "./recognition-fact.js"
import { ApplicationInvariantError } from "../../../shared/domain/execution-failure.js"
import { MISSING_CONTENT_MESSAGES, missingContentCauseOf } from "../domain/execution-block.js"
import { describeScalarValue, isAbsentContent, resolveContextValue } from "./execution-context.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { deliverySkipText, type DeliverySkip } from "../../feedback-engine/domain/delivery-guards.js"
import { readSupportMaterials, type SupportMaterialRejection } from "../../feedbacks/domain/support-material.js"
import type { FeedbackInvestigationFields } from "../../feedbacks/application/feedback-investigation-trace.js"
import type { ToolInvocationTrace } from "../../investigation/domain/tool-trace.js"
import type { AgentWorkflowResult } from "../../agents/application/run-agent.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { outputTargetRole, type OutputNodeConfig, type OutputTarget } from "../domain/output-schema.js"
import type { StructureAnchor } from "../domain/structure-anchor-schema.js"
import type { FeedbackPublication, WorkflowEffectSink } from "./effect-sink.js"
import {
  resolveByRoleChain,
  resolveEnrollmentEvidenceSource,
  resolveEnrollmentOperatorId,
  type EnrollmentSubjectContext,
} from "./enrollment-subject.js"
import { postgresHierarchyReader, requireStructureRecipient, ROLE_LABELS, type OrganizationalHierarchyReader, type OrganizationalPerson } from "./organizational-recipient.js"
import { isSynthesisNodeOutput } from "./synthesis-agent-executor.js"
import { isReliableFeedbackNodeOutput } from "../../reliable-feedback/domain/reliable-feedback-artifact.js"
import { isCallAnalysisNodeOutput, isEngineMessageNodeOutput, isIndicatorAnalysisNodeOutput } from "../../feedback-engine/domain/node-output.js"
import { projectForSurfaces, type ProjectionSource, type SurfaceProjection } from "../../conversational-delivery/domain/surface-projection.js"
import { loadPersonPresentation } from "../../profile-preferences/application/person-presentation-loader.js"
import { addressNameOf } from "../../profile-preferences/domain/person-presentation.js"

export type OutputExecutionContext = EnrollmentSubjectContext & {
  organizationId: string
  enrollmentId: string
  nodeId: string
  /** Rótulo do nó Output no grafo — vira o título do alerta quando a entrega é pra gestão
   * (ver dispatchOutputAlert). Opcional só por compatibilidade com chamadores antigos. */
  nodeLabel?: string | undefined
  /** O Execution Context acumulado do enrollment até agora — de onde `config.source` lê o
   * conteúdo a publicar (ex.: "nodeOutputs.<idDoNodeAgente>"). */
  nodeOutputs: Record<string, unknown>
  /** Workflow Variables: a tela oferece variável como origem do conteúdo (WF-41). */
  variables?: Record<string, unknown>
  /** Boundary de side effects (ver effect-sink.ts) — produção grava; QA só registra. */
  effects: WorkflowEffectSink
  /** A ESTRUTURA analisada, quando este Output roda FORA do caminho individual (matrícula raiz de
   * um Workflow Consolidado — contexto STRUCTURE/CONSOLIDATED_RESULT). Aí o destinatário de
   * gestão é resolvido pela estrutura (organizational-recipient.ts), nunca subindo a cadeia do
   * "sujeito técnico" da matrícula. `null`/ausente = caminho individual (a cadeia do operador). */
  structure?: StructureAnchor | null
  /** Só pra testes — Postgres por padrão. */
  hierarchy?: OrganizationalHierarchyReader
  /** Ids dos nós "Chamar agente" do grafo desta versão: só a saída RAIZ de um deles é publicada como resultado de Agent
   * (é onde run-agent.ts conferiu a evidência literal). Ausente = nenhum (fail-closed). */
  agentNodeIds?: ReadonlySet<string>
}

export type OutputRecipient = { id: string; name: string; role: string }

/** Superfícies com consumidor REAL para o feedback confiável: Acompanhamento e Notificação/Sino (V1.5.12) e, desde os
 * Workflow Outputs V1, Chat (conversa nova da INIA) e Avatar (recado de voz com aceite). */
export const RELIABLE_FEEDBACK_SURFACES: readonly string[] = ["FOLLOW_UP", "NOTIFICATION", "CHAT", "AVATAR"]
/** Superfícies conversacionais: o destinatário RECEBE o conteúdo na INIA (conversa/recado), não um aviso. */
export const CONVERSATIONAL_SURFACES: readonly string[] = ["CHAT", "AVATAR"]

export type OutputExecutionResult = {
  /** `conversationIds`/`avatarDeliveryIds`: entregas conversacionais deste nó (ausentes quando não houve). */
  nodeOutput: { caseId: string | null; feedbackId: string | null; conversationIds?: string[]; avatarDeliveryIds?: string[]; notPublished?: { reason: string; text: string } }
  /** Quem efetivamente recebeu — vai pro evento `output_dispatched` (QA Lab mostra "Destinatário
   * resolvido: Gerente Fulano" em vez de só o tipo do target). */
  recipients: OutputRecipient[]
}

/** Mesma convenção de caminho do `sourcePath` de Condition — "nodeOutputs.a.b.c". Exportada pra
 * ser reaproveitada por quem mais precisar ler o Execution Context por path (ex.: o "conteúdo a
 * revisar" do Human Review — ver human-review-executor.ts). */
export function resolveSource(nodeOutputs: Record<string, unknown>, path: string, variables: Record<string, unknown> = {}): unknown {
  return resolveContextValue({ nodeOutputs, variables }, path)
}

function isAgentWorkflowResult(value: unknown): value is AgentWorkflowResult {
  if (!value || typeof value !== "object") return false
  const kind = (value as { kind?: unknown }).kind
  return kind === "monitoring" || kind === "indicator"
}

/** Resultado de um node Orchestrator (ver orchestrator-executor.ts) — tem `text` e nunca `kind`
 * (isso o distingue de `AgentWorkflowResult`, que sempre tem `kind: "monitoring" | "indicator"`). */
function isOrchestratorNodeOutput(value: unknown): value is { text: string; orchestratorName: string; structuredResult?: Record<string, unknown> | null } {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return typeof record.text === "string" && typeof record.orchestratorName === "string" && !("kind" in record)
}

async function loadPersonSummary(db: Database, personId: string, organizationId?: string): Promise<OutputRecipient> {
  // Pessoa fixa do editor: só da organização do Workflow (o publish já valida; aqui é a segunda barreira).
  const row = await db.query<{ id: string; name: string; role: string }>(`select id, name, role from people where id = $1 and ($2::uuid is null or organization_id = $2::uuid)`, [personId, organizationId ?? null])
  return row.rows[0] ?? { id: personId, name: personId, role: "" }
}

/**
 * Quem recebe. Caminho individual (contexto EMPLOYEE): "O próprio operador" é o operador; cargos
 * sobem a cadeia `reports_to_id` DELE (resolveByRoleChain) — e um cargo que não existe na cadeia
 * é ERRO do node, nunca um alerta descartado em silêncio (antes da rodada de hardening 2026-09-16
 * o Output simplesmente não entregava pra ninguém). Fora do caminho individual (`structure`
 * presente) o cargo é resolvido pela estrutura, deterministicamente (organizational-recipient.ts).
 */
async function resolveRecipients(context: OutputExecutionContext, operatorId: string, target: OutputTarget): Promise<OutputRecipient[]> {
  if (target.type === "CURRENT_OPERATOR") return [await loadPersonSummary(context.db, operatorId)]
  if (target.type === "USER") return [await loadPersonSummary(context.db, target.userId, context.organizationId)]
  const role = outputTargetRole(target)
  if (!role) return []
  if (context.structure) {
    const person: OrganizationalPerson = await requireStructureRecipient(context.hierarchy ?? postgresHierarchyReader(context.db), context.structure, role, context.nodeId)
    return [{ id: person.id, name: person.name, role: person.role }]
  }
  const chain = await resolveByRoleChain(context.db, operatorId, [role], { ancestorsOnly: true })
  if (chain.length === 0) {
    throw new DomainError(`Não foi possível determinar um ${ROLE_LABELS[role]} na cadeia de gestão deste operador.`, "WORKFLOW_OUTPUT_RECIPIENT_NOT_FOUND", 422, { nodeId: context.nodeId })
  }
  return [await loadPersonSummary(context.db, chain[0]!.id)]
}

function isEmployeeFanInOutput(value: unknown): value is { kind: "EMPLOYEE_FAN_IN"; expectedCount: number; completedCount: number; failedCount: number } {
  return Boolean(value) && typeof value === "object" && (value as { kind?: unknown }).kind === "EMPLOYEE_FAN_IN"
}

/**
 * Texto legível do conteúdo publicado, pra um destinatário que NÃO é o próprio operador (gestão) —
 * o que aparece no Acompanhamento dele. Antes (até a rodada de hardening dos Workflows-modelo,
 * 2026-09-16) o alerta dizia só "Um workflow gerou uma saída relacionada a X": o gestor recebia
 * o aviso, nunca o resultado. Deriva do que já existe no Execution Context, nunca inventa:
 * síntese do Orquestrador (`text`), resumo/recomendação de um resultado de Agent, contagem de um
 * resultado consolidado. `null` = conteúdo sem forma conhecida → frase genérica de sempre.
 */
export function describeOutputContent(content: unknown): string | null {
  if (isRecognitionSkippedOutput(content)) return content.text
  // V1.5.12 — feedback confiável: só o texto EMITÍVEL (itens READY/aprovados, texto final do QA); nunca refs/QA interno.
  if (isReliableFeedbackNodeOutput(content)) return content.text.trim() || null
  // Motor de feedback: a mensagem publicável (ou o resumo legível de uma análise) — nunca refs internas.
  if (isEngineMessageNodeOutput(content) || isCallAnalysisNodeOutput(content) || isIndicatorAnalysisNodeOutput(content)) return content.text.trim() || null
  if (isOrchestratorNodeOutput(content)) return content.text.trim() || null
  // Agent de síntese pós-JOIN: o texto é derivado do contrato estruturado (synthesis-agent-executor.ts).
  if (isSynthesisNodeOutput(content)) return content.text.trim() || null
  if (isAgentWorkflowResult(content)) {
    // `input.structured` é o que o Agent devolveu — mas o tipo é só o que o TS enxerga: um
    // resultado montado por um teste/fake pode vir sem ele, então lê defensivamente.
    const structured = (content.input as { structured?: { summary?: unknown; recommendation?: unknown } }).structured
    const summary = typeof structured?.summary === "string" ? structured.summary.trim() : ""
    const recommendation = typeof structured?.recommendation === "string" ? structured.recommendation.trim() : ""
    if (!summary && !recommendation) return null
    return [summary, recommendation ? `**Recomendação:** ${recommendation}` : ""].filter(Boolean).join("\n\n")
  }
  if (isEmployeeFanInOutput(content)) {
    return `${content.expectedCount} colaborador(es) analisado(s) — ${content.completedCount} concluído(s), ${content.failedCount} com falha.`
  }
  // Variável ou campo escolhido na tela: texto, número ou verdadeiro/falso (WF-41).
  return describeScalarValue(content)
}

/** FOLLOW_UP/NOTIFICATION pra alguém que não é o próprio operador ainda não tem tela dedicada
 * (cada perfil vai ganhar a sua no futuro) — reaproveita o mesmo canal de alerta que ESCALATE
 * já usa hoje, em vez de inventar um mecanismo novo pra isso. O título é o rótulo do nó Output
 * (é o nome que o admin deu à entrega — "Resumo mensal ao Supervisor"), e a descrição carrega o
 * conteúdo real (ver describeOutputContent). */
async function dispatchOutputAlert(
  db: Database,
  context: OutputExecutionContext,
  recipientIds: string[],
  operatorId: string,
  caseId: string | null,
  content: unknown,
): Promise<void> {
  if (recipientIds.length === 0) return
  const operatorRow = await db.query<{ name: string }>(`select name from people where id = $1`, [operatorId])
  const operatorName = operatorRow.rows[0]?.name ?? "um operador"
  const title = context.nodeLabel?.trim() ? context.nodeLabel.trim() : `Novo output de workflow: ${operatorName}`
  const description = describeOutputContent(content) ?? `Um workflow gerou uma saída relacionada a ${operatorName}.`
  for (const recipientId of recipientIds) {
    await context.effects.dispatchAlert(db, {
      organizationId: context.organizationId,
      caseId,
      recipientId,
      title,
      description,
      severity: "MEDIUM",
      alertType: "WORKFLOW_OUTPUT",
      dedupeKey: `workflow_output:${context.enrollmentId}:${context.nodeId}:${recipientId}`,
    })
  }
}

/**
 * Workflow Outputs V1 — a PROJEÇÃO do conteúdo para Chat/Avatar, UMA por destinatário e compartilhada pelas duas superfícies
 * (o mesmo artefato, a mesma verdade). Feedback confiável: lido do store com as defesas da publicação e só para o próprio
 * colaborador. Demais conteúdos: o texto legível de `describeOutputContent` (nunca JSON cru); sem forma conhecida = erro do nó.
 */
async function conversationalProjection(context: OutputExecutionContext, config: OutputNodeConfig, content: unknown, recipient: OutputRecipient): Promise<{ projection: SurfaceProjection; source: ProjectionSource; artifactId: string | null }> {
  let source: ProjectionSource
  let artifactId: string | null = null
  if (isEngineMessageNodeOutput(content)) {
    source = await context.effects.feedbackEngine.projectionSource(context.db, { organizationId: context.organizationId, recipientId: recipient.id, messageId: content.messageId })
  } else if (isReliableFeedbackNodeOutput(content)) {
    artifactId = content.artifactId
    source = await context.effects.conversational.reliableProjectionSource(context.db, { organizationId: context.organizationId, recipientId: recipient.id, artifactId: content.artifactId, nodeOutput: content })
  } else {
    const text = describeOutputContent(content)
    if (!text) throw new Error(`Output(${config.surfaces.join(", ")}): "${config.source}" não tem um texto publicável no Chat/Avatar.`)
    source = { kind: "TEXT", title: context.nodeLabel?.trim() || null, text }
  }
  const presentation = await loadPersonPresentation(context.db, context.organizationId, recipient.id)
  const addressName = presentation ? addressNameOf({ registeredName: presentation.registeredName, preferredName: presentation.preferredName }) : null
  return { projection: projectForSurfaces(source, { addressName, outputLabel: context.nodeLabel ?? null }), source, artifactId }
}

/**
 * Único node com permissão de gerar efeito visível pra fora do motor — resolve destinatário(s)
 * (`OutputTarget`) e despacha o conteúdo (`config.source`, lido do Execution Context) pra cada
 * superfície pedida (`OutputSurface[]`). Nunca decide isso sozinho: quem fica dizendo pra quem
 * e onde é sempre a configuração do node, montada no builder visual.
 */
export async function executeOutput(config: OutputNodeConfig, context: OutputExecutionContext): Promise<OutputExecutionResult> {
  const operatorId = await resolveEnrollmentOperatorId(context)
  if (!operatorId) throw new Error("Não foi possível identificar o operador para publicar o Output.")

  const content = resolveSource(context.nodeOutputs, config.source, context.variables)
  // Conteúdo ausente nunca vira entrega vazia (D2): a versão é fixa, então repetir não resolve.
  if (isAbsentContent(content)) {
    throw new ApplicationInvariantError(`O conteúdo de "${context.nodeLabel ?? "Output"}" não está disponível: ${MISSING_CONTENT_MESSAGES[missingContentCauseOf(config.source)]}. Nada foi entregue.`, "WORKFLOW_CONTENT_MISSING")
  }
  const recipients = await resolveRecipients(context, operatorId, config.target)
  const recipientIds = recipients.map((recipient) => recipient.id)

  let caseId: string | null = null
  let feedbackId: string | null = null

  // V1.5.12 — ReliableFeedbackArtifact: só o que foi liberado pela camada de confiabilidade sai (disposição READY), e só para
  // superfícies com consumidor real. Nada é publicado a partir de um artefato retido/bloqueado/rejeitado.
  if (isReliableFeedbackNodeOutput(content)) {
    if (content.disposition !== "READY" || content.items.length === 0) throw new Error(`Output: o feedback de "${config.source}" não está liberado para emissão (${content.disposition}).`)
    const unsupported = config.surfaces.filter((surface) => !RELIABLE_FEEDBACK_SURFACES.includes(surface))
    if (unsupported.length > 0) throw new Error(`Output: a(s) superfície(s) ${unsupported.join(", ")} ainda não têm consumidor real — o feedback confiável não é emitido por elas.`)
  }
  // Motor de feedback: só a mensagem PUBLICÁVEL do próprio colaborador sai, e só por superfícies com consumidor real.
  if (isEngineMessageNodeOutput(content)) {
    const unsupported = config.surfaces.filter((surface) => !RELIABLE_FEEDBACK_SURFACES.includes(surface))
    if (unsupported.length > 0) throw new Error(`Output: a(s) superfície(s) ${unsupported.join(", ")} ainda não têm consumidor real — o feedback não é emitido por elas.`)
  }

  // REGRAS DE ENTREGA ÚNICA do motor (chamada já monitorada; indicador × período já entregue): a mensagem não sai por NENHUMA
  // superfície — a execução segue normalmente e o motivo fica na saída do nó (não é falha). Conferida UMA vez antes das superfícies
  // e de novo, com trava, dentro da transação da publicação no Acompanhamento (duas execuções concorrentes nunca publicam as duas).
  let notPublished: { reason: string; text: string } | null = null
  if (isEngineMessageNodeOutput(content)) {
    const skip: DeliverySkip | null = await context.effects.feedbackEngine.deliverySkip(context.db, { organizationId: context.organizationId, messageId: content.messageId })
    if (skip) notPublished = { reason: skip.reason, text: deliverySkipText(skip) }
  }
  // Reconhecimento sem motivo: não há o que entregar. Mesma postura: a execução segue, e o motivo fica na saída do nó.
  if (isRecognitionSkippedOutput(content)) notPublished = { reason: content.reason, text: content.text }
  const conversationIds: string[] = []
  const avatarDeliveryIds: string[] = []
  const projections = new Map<string, Awaited<ReturnType<typeof conversationalProjection>>>()
  for (const surface of config.surfaces) {
    if (notPublished && (isEngineMessageNodeOutput(content) || isRecognitionSkippedOutput(content))) continue
    if (CONVERSATIONAL_SURFACES.includes(surface)) {
      // Cada superfície × destinatário é uma entrega própria e idempotente (retry do nó nunca duplica conversa/convite);
      // Chat e Avatar do mesmo destinatário compartilham a MESMA projeção.
      for (const recipient of recipients) {
        const prepared = projections.get(recipient.id) ?? (await conversationalProjection(context, config, content, recipient))
        projections.set(recipient.id, prepared)
        const delivery = { organizationId: context.organizationId, enrollmentId: context.enrollmentId, nodeId: context.nodeId, recipientId: recipient.id, interactionMode: config.interactionMode ?? "PROMPT", artifactId: prepared.artifactId, projection: prepared.projection, sourceKind: prepared.source.kind, now: new Date() } as const
        if (surface === "CHAT") conversationIds.push((await context.effects.conversational.deliverChat(context.db, delivery)).conversationId)
        else avatarDeliveryIds.push((await context.effects.conversational.offerAvatar(context.db, delivery)).outputId)
        if (isEngineMessageNodeOutput(content) && recipient.id === operatorId) await context.effects.feedbackEngine.markDelivered(context.db, { organizationId: context.organizationId, messageId: content.messageId, at: new Date() })
      }
      continue
    }
    if (surface === "FOLLOW_UP" && config.target.type === "CURRENT_OPERATOR" && isEngineMessageNodeOutput(content)) {
      // Publicação IDEMPOTENTE por nó Output (workflow_output_emissions): retry/concorrência nunca publicam duas vezes.
      const published = await context.effects.feedbackEngine.publishFollowUp(context.db, { organizationId: context.organizationId, enrollmentId: context.enrollmentId, nodeId: context.nodeId, recipientId: operatorId, messageId: content.messageId })
      if (published.skipped) {
        notPublished = { reason: published.skipped.reason, text: deliverySkipText(published.skipped) }
        continue
      }
      caseId = published.caseId
      feedbackId = published.feedbackId
      continue
    }
    if (surface === "FOLLOW_UP" && config.target.type === "CURRENT_OPERATOR" && isReliableFeedbackNodeOutput(content)) {
      // Publicação IDEMPOTENTE por nó Output (workflow_output_emissions): retry/concorrência nunca publicam duas vezes.
      const published = await context.effects.reliableFeedback.publishFollowUp(context.db, { organizationId: context.organizationId, enrollmentId: context.enrollmentId, nodeId: context.nodeId, recipientId: operatorId, artifactId: content.artifactId })
      caseId = published.caseId
      feedbackId = published.feedbackId
      continue
    }
    if (surface === "FOLLOW_UP" && config.target.type === "CURRENT_OPERATOR") {
      // Materiais de apoio: o node de origem RECOMENDOU (Agent direto/Orquestrador, já validado na
      // execução); este Output decide se ESTA entrega os apresenta. Desligado (padrão), o Feedback
      // é publicado sem relação de material — mesmo que a IA tenha recomendado.
      const supportMaterials = config.includeSupportMaterials === true ? readSupportMaterials(content) : []
      const rejected = config.includeSupportMaterials === true ? (content as { supportMaterialsRejected?: unknown }).supportMaterialsRejected : undefined
      // Trace das ferramentas de investigação: sempre transportado ao Feedback (auditoria no
      // context_snapshot) — não depende de configuração; nunca contém prompt/raciocínio.
      const investigation = readInvestigationTrace(content)
      const materialFields = {
        ...(supportMaterials.length > 0 ? { supportMaterials } : {}),
        ...(Array.isArray(rejected) && rejected.length > 0 ? { supportMaterialsRejected: rejected as SupportMaterialRejection[] } : {}),
        ...investigation,
      }
      if (isAgentWorkflowResult(content)) {
        // Só a raiz de um nó "Chamar agente", e sempre para a organização e o colaborador DESTA matrícula — nunca para quem o
        // objeto disser (um campo de outro nó com o mesmo formato publicaria em nome de outra organização/pessoa).
        const segments = config.source.split(".")
        const sourceNodeId = segments.length === 2 && segments[0] === "nodeOutputs" ? segments[1]! : null
        if (!sourceNodeId || !context.agentNodeIds?.has(sourceNodeId)) throw new Error(`Output(FOLLOW_UP, CURRENT_OPERATOR): "${config.source}" não é o resultado de um nó "Chamar agente".`)
        const embedded = content.input as { organizationId?: unknown; operatorId?: unknown }
        if (embedded.organizationId !== context.organizationId || embedded.operatorId !== operatorId) throw new Error("Output: o resultado do agente não pertence a esta execução (organização ou colaborador divergente).")
        const teamRow = await context.db.query<{ team_id: string | null }>(`select team_id from people where id = $1 and organization_id = $2`, [operatorId, context.organizationId])
        const teamId = teamRow.rows[0]?.team_id
        if (!teamId) throw new Error("O operador desta execução não está associado a um grupo — não é possível publicar o feedback.")
        const created = await context.effects.publishFeedback(context.db, { kind: content.kind, input: { ...content.input, organizationId: context.organizationId, operatorId, teamId, ...materialFields } } as FeedbackPublication)
        caseId = created.caseId
        feedbackId = created.feedbackId
      } else if (isOrchestratorNodeOutput(content)) {
        // Um Orchestrator não analisa uma transcrição específica como um Agent — sua síntese
        // não passa pela checagem verbatim de evidência que run-agent.ts aplica ao caminho
        // channel_flag. Trade-off documentado (não um bug escondido): ver o relatório de
        // validação do motor de workflow.
        const teamRow = await context.db.query<{ team_id: string | null }>(`select team_id from people where id = $1 and organization_id = $2`, [operatorId, context.organizationId])
        const teamId = teamRow.rows[0]?.team_id
        if (!teamId) throw new Error("O operador desta execução não está associado a um grupo — não é possível publicar o feedback.")
        const evidenceSource = await resolveEnrollmentEvidenceSource(context.db, context.enrollment)
        const created = await context.effects.publishFeedback(context.db, {
          kind: "orchestrator",
          input: {
            organizationId: context.organizationId,
            operatorId,
            teamId,
            ...evidenceSource,
            orchestratorName: content.orchestratorName,
            reply: content,
            ...materialFields,
          },
        })
        caseId = created.caseId
        feedbackId = created.feedbackId
      } else {
        throw new Error(`Output(FOLLOW_UP, CURRENT_OPERATOR): "${config.source}" não é um resultado de agente ou orquestrador publicável.`)
      }
      continue
    }

    if (surface === "FOLLOW_UP" || surface === "NOTIFICATION") {
      const attachToCaseId = caseId ?? (await context.effects.findRecentCaseId(context.db, context.enrollmentId))
      await dispatchOutputAlert(context.db, context, recipientIds, operatorId, attachToCaseId, content)
      continue
    }

    await context.effects.dispatchWorkflowOutputRows(context.db, context, config, surface, recipientIds, content)
  }

  return { nodeOutput: { caseId, feedbackId, ...(conversationIds.length > 0 ? { conversationIds } : {}), ...(avatarDeliveryIds.length > 0 ? { avatarDeliveryIds } : {}), ...(notPublished ? { notPublished } : {}) }, recipients }
}

/** Trace de investigação no TOPO do resultado (Agent direto) ou nos especialistas do Orquestrador
 * (concatenados na ordem de acionamento) — só transporte, nunca reinterpretação. */
export function readInvestigationTrace(content: unknown): FeedbackInvestigationFields {
  if (!content || typeof content !== "object") return {}
  const record = content as { toolTrace?: unknown; investigation?: unknown; results?: { toolTrace?: unknown }[] }
  if (Array.isArray(record.toolTrace) && record.toolTrace.length > 0) {
    return { toolTrace: record.toolTrace as ToolInvocationTrace[], ...(record.investigation && typeof record.investigation === "object" ? { investigation: record.investigation as FeedbackInvestigationFields["investigation"] } : {}) }
  }
  if (Array.isArray(record.results)) {
    const merged = record.results.flatMap((result) => (Array.isArray(result?.toolTrace) ? (result.toolTrace as ToolInvocationTrace[]) : []))
    if (merged.length > 0) return { toolTrace: merged }
  }
  return {}
}
