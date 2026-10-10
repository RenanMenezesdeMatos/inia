import { createHash } from "node:crypto"
import type { Database } from "../../../infrastructure/database/pool.js"
import { validatePublishableFeedback } from "../../feedbacks/domain/feedback.js"
import { confirmedProductsOf, nodeOutputOf, renderPublishedNarrative, supportMaterialLineageOf, supportMaterialsOf, type EmittedItem } from "../domain/reliable-feedback-artifact.js"
import { NATURAL_FEEDBACK_VERSION, presentationViolations } from "../domain/feedback-presentation.js"
import { feedbackViewOf } from "../domain/feedback-view.js"
import { prvCollaboratorViewOf, prvSupervisorViewOf, resolvePrvNarrative, type PrvClosingArtifactData } from "../domain/prv-closing-views.js"
import type { ApplicabilityResolution } from "../domain/applicability-resolution.js"
import { exampleContentAsFactIn, suggestedResponseScopeOf, suggestedResponseViolations } from "../domain/suggested-response.js"
import { persistSupportMaterialsWithSnapshot } from "../../feedbacks/application/feedback-support-materials.js"
import type { ReliableFeedbackStore } from "../application/ports.js"
import { effectClaimsInContent } from "../domain/effect-claims.js"

/**
 * V1.5.12 — PUBLICAÇÃO do ReliableFeedbackArtifact no ACOMPANHAMENTO (Output FOLLOW_UP + O próprio operador).
 *
 * Reaproveita a publicação real do feedback (supervision_cases + evidences + feedbacks PUBLISHED + timeline + outbox):
 * o feed do colaborador, a CIÊNCIA (`acknowledged_at`), o contexto do chat e os analytics leem exatamente o mesmo registro
 * de sempre. Diferenças de propósito:
 *   - IDEMPOTENTE por nó Output (`workflow_output_emissions`, unique matrícula × nó × superfície × destinatário): retry,
 *     duplo processamento ou instância concorrente publicam EXATAMENTE uma vez — a linha de emissão entra na MESMA transação
 *     do feedback (o segundo espera a unique, vê o conflito e devolve o que o primeiro publicou);
 *   - tudo numa transação só (nunca o caso/feedback APPROVED órfão do caminho legado);
 *   - conteúdo SÓ do artefato confiável lido do banco (a fonte da verdade, com o texto final do QA quando editado) — nunca
 *     do Execution Context; disposição precisa ser READY e o destinatário precisa ser o colaborador do artefato.
 * No `context_snapshot` vai proveniência SEGURA (artefato, domínio, política, fonte do texto) — nunca prompt, refs, QA interno.
 */
export type PublishReliableInput = { organizationId: string; enrollmentId: string; nodeId: string; recipientId: string; artifactId: string }

const NO_PROCEDURE = "Sem procedimento da base associado a este ponto (orientação como sugestão)."
const joinFacts = (items: readonly EmittedItem[]) => items.flatMap((item) => item.facts.map((fact) => (fact.role === "DADO_OFICIAL" || fact.role === "ANALISE" || fact.role === "REFERENCIA" ? fact.text : `${fact.role === "OPERADOR" ? "Operador" : fact.role === "CLIENTE" ? "Cliente" : fact.role === "EVENTO" ? "Evento da chamada" : "Participante"}: “${fact.text}${fact.truncated ? "…" : ""}”`)))

/**
 * V1.7.1a — DEFESA FINAL do exemplo de condução e do EXEMPLO DA BASE como fato: o conteúdo que vai ao colaborador (redator,
 * fallback ou edição do QA) passa de novo pelas guardas — nada é reescrito em silêncio; violação = nada publicado.
 */
export function unsupportedSuggestedContentOf(items: readonly EmittedItem[]): string[] {
  return items.flatMap((item) => {
    const scope = suggestedResponseScopeOf({ ...item, domain: item.domain ?? "MONITORING" })
    const example = suggestedResponseViolations(item.wording.suggestedResponse, scope)
    const asFact = exampleContentAsFactIn([item.wording.observed, item.wording.whyItMatters, item.wording.whatYouCanDo, item.wording.suggestedResponse ?? ""], scope) ? ["EXAMPLE_CONTENT_AS_FACT"] : []
    return [...example, ...asFact]
  })
}
/** V1.6.0 — o procedimento relacionado é o DOCUMENTO real cuja regra sustentou o item (nunca o título que o modelo citou). */
const relatedProcedureOf = (items: readonly EmittedItem[]) => {
  const titles = [...new Set(items.flatMap((item) => (item.knowledge ? [item.knowledge.documentTitle] : [])))]
  return titles.length > 0 ? titles.join("; ") : NO_PROCEDURE
}

/**
 * Workflow Outputs V1 — a PREPARAÇÃO da emissão (leitura do artefato no store + defesas finais), compartilhada por TODA superfície
 * que entrega o feedback confiável: Acompanhamento, Chat e Avatar recebem o MESMO conteúdo verificado (nunca três análises).
 * Sem efeito colateral: só lê e valida.
 */
export type PreparedReliableEmission = {
  record: NonNullable<Awaited<ReturnType<ReliableFeedbackStore["get"]>>> & { artifact: NonNullable<NonNullable<Awaited<ReturnType<ReliableFeedbackStore["get"]>>>["artifact"]> }
  output: ReturnType<typeof nodeOutputOf>
  prv: ReturnType<typeof prvPublicationOf> | null
  feedbackView: ReturnType<typeof feedbackViewOf> | null
  confirmedProducts: ReturnType<typeof confirmedProductsOf>
}

export async function prepareReliableEmission(store: ReliableFeedbackStore, input: { organizationId: string; recipientId: string; artifactId: string }): Promise<PreparedReliableEmission> {
  const record = await store.get(input.organizationId, input.artifactId)
  if (!record || record.status !== "COMPLETED" || !record.artifact) throw new Error("Feedback confiável não encontrado nesta organização — nada publicado.")
  if (record.collaboratorId !== input.recipientId) throw new Error("O destinatário do Output não é o colaborador do feedback confiável — nada publicado.")
  const output = nodeOutputOf(record.id, record.artifact, (await store.listReviews(input.organizationId, record.id)).map((review) => ({ itemIndex: review.itemIndex, status: review.reviewStatus, finalWording: review.finalWording })))
  if (output.disposition !== "READY" || output.items.length === 0) throw new Error(`Feedback confiável não está pronto para emissão (${output.disposition}) — nada publicado.`)
  // V1.7.1 — DEFESA FINAL sobre o conteúdo que vai ao colaborador (texto do redator, fallback ou edição do QA): efeito
  // garantido/causal que a regra do item não sustenta nunca é publicado (fail-closed; o texto não é reescrito em silêncio).
  const unsupportedEffects = output.items.flatMap((item) => effectClaimsInContent(item.wording, [item.knowledge?.quote, item.knowledge?.leadIn, item.knowledge?.detail?.quote]))
  if (unsupportedEffects.length > 0) {
    const error = new Error(`O feedback confiável afirma efeito garantido sem base na regra oficial (${[...new Set(unsupportedEffects)].join(", ")}) — nada publicado.`)
    error.name = "RELIABLE_FEEDBACK_UNSUPPORTED_EFFECT"
    throw error
  }
  // V1.7.1b — a apresentação publicada é revalidada contra os itens que saem (a do redator ou a do sistema — nunca fato novo).
  // FEEDBACK POR FLAG V2 — a narrativa já foi resolvida campo a campo contra ESTES itens (`nodeOutputOf` → `resolveNarrative`:
  // o texto do redator só fica se descreve os mesmos itens e passa na validação; senão é a versão do sistema).
  if (output.presentation && output.presentation.version !== NATURAL_FEEDBACK_VERSION && output.presentation.source === "WRITER" && presentationViolations(output.presentation, output.items, { domain: record.domain, label: record.artifact.label, firstName: record.artifact.presentation?.recipient?.firstName ?? null, indicatorName: record.domain === "INDICATOR" ? record.artifact.label.split(" · ")[0] ?? null : null }).length > 0) {
    const error = new Error("A abertura/fechamento do feedback afirma algo fora dos pontos publicados — nada publicado.")
    error.name = "RELIABLE_FEEDBACK_UNSUPPORTED_PRESENTATION"
    throw error
  }
  const unsupportedExample = unsupportedSuggestedContentOf(output.items)
  if (unsupportedExample.length > 0) {
    const error = new Error(`O exemplo de condução (ou o texto) traz conteúdo sem base na regra oficial nem na chamada (${[...new Set(unsupportedExample)].join(", ")}) — nada publicado.`)
    error.name = "RELIABLE_FEEDBACK_UNSUPPORTED_SUGGESTED_RESPONSE"
    throw error
  }

  const confirmedProducts = confirmedProductsOf(record.artifact.processAssessment?.applicability as ApplicabilityResolution[] | undefined)
  // V2 — o view model da apresentação (narrativa + detalhes) fica no snapshot: a tela do Acompanhamento lê ele; o texto do
  // campo recomendação continua existindo (leitores antigos, chat, auditoria) e é derivado do MESMO view model.
  // INDICATOR DIAGNOSIS V1 — fechamento do PRV: UMA verdade, duas projeções (colaborador no feed; supervisor só para a liderança).
  const prv = record.artifact.prvClosing ? prvPublicationOf(record.artifact.prvClosing, output.items) : null
  const feedbackView = prv ? prv.collaboratorView : output.presentation?.version === NATURAL_FEEDBACK_VERSION ? feedbackViewOf(output.items, output.presentation, { confirmedProducts, label: record.artifact.label }) : null
  return { record: record as PreparedReliableEmission["record"], output, prv, feedbackView, confirmedProducts }
}

export async function publishReliableFeedbackToFollowUp(db: Database, store: ReliableFeedbackStore, input: PublishReliableInput): Promise<{ caseId: string; feedbackId: string; reused: boolean }> {
  const { record, output, prv, feedbackView, confirmedProducts } = await prepareReliableEmission(store, input)
  const team = (await db.query<{ team_id: string | null }>(`select team_id from people where id = $1 and organization_id = $2`, [record.collaboratorId, input.organizationId])).rows[0]
  if (!team?.team_id) throw new Error("O colaborador não está associado a um grupo — não é possível publicar no Acompanhamento.")

  const facts = joinFacts(output.items)
  const indicator = prv ? prv.indicatorLabel : record.domain === "INDICATOR" ? (record.artifact.label.split(" · ")[0] ?? "Indicador") : null
  const content = validatePublishableFeedback({
    impactedIndicator: indicator ?? record.artifact.label,
    evidenceFound: facts.join(" · ") || record.artifact.label,
    observedBehavior: output.items.map((item) => item.wording.observed).join("\n\n"),
    relatedProcedure: relatedProcedureOf(output.items),
    recommendation: prv ? output.text : renderPublishedNarrative(output.items, output.limitations, { presentation: output.presentation ?? null, confirmedProducts }),
  })

  const client = await db.connect()
  try {
    await client.query("begin")
    const emission = await client.query<{ id: string }>(
      `insert into workflow_output_emissions (organization_id, enrollment_id, node_id, surface, recipient_id, artifact_id, created_at)
       values ($1,$2,$3,'FOLLOW_UP',$4,$5,now())
       on conflict (enrollment_id, node_id, surface, recipient_id) do nothing
       returning id`,
      [input.organizationId, input.enrollmentId, input.nodeId, input.recipientId, record.id],
    )
    if (!emission.rows[0]) {
      await client.query("rollback")
      const existing = (await db.query<{ case_id: string | null; feedback_id: string | null }>(`select case_id, feedback_id from workflow_output_emissions where enrollment_id = $1 and node_id = $2 and surface = 'FOLLOW_UP' and recipient_id = $3`, [input.enrollmentId, input.nodeId, input.recipientId])).rows[0]
      if (!existing?.case_id || !existing.feedback_id) throw new Error("Emissão deste Output já registrada sem feedback — estado inconsistente, nada publicado de novo.")
      return { caseId: existing.case_id, feedbackId: existing.feedback_id, reused: true }
    }
    const origin = record.domain === "MONITORING"
      ? (await client.query<{ started_at: Date }>(`select started_at from interactions where id = $1 and organization_id = $2`, [record.interactionId, input.organizationId])).rows[0]?.started_at
      : prv ? null
      : (await client.query<{ period_end: Date; value: string }>(`select period_end, value from indicator_measurements where id = $1 and organization_id = $2`, [record.indicatorMeasurementId, input.organizationId])).rows[0]?.period_end
    const occurredAt = origin ?? new Date()
    const title = record.domain === "MONITORING" ? "Feedback de atendimento" : `Feedback de indicador · ${indicator}`
    const createdCase = await client.query<{ id: string }>(
      `insert into supervision_cases(organization_id, operator_id, team_id, title, summary, status, priority, indicator_code, indicator_value, indicator_target)
       values ($1,$2,$3,$4,$5,'DIAGNOSED','P2',$6,$7,$8) returning id`,
      // V1.7.2 — o card do Acompanhamento (resumo do caso) é o resumo de supervisor quando existe (monitoria de processo).
      [input.organizationId, record.collaboratorId, team.team_id, title, feedbackView?.card ?? output.presentation?.card ?? output.items[0]!.wording.observed, record.domain === "MONITORING" ? "MONITORIA" : prv ? prv.indicatorCode : (indicator ?? "INDICADOR"), record.artifact.label, output.policyVersion],
    )
    const caseId = createdCase.rows[0]!.id
    const evidenceText = facts.join("\n") || record.artifact.label
    await client.query(
      `insert into evidences(organization_id, case_id, evidence_type, title, description, source_type, source_id, occurred_at, checksum)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [input.organizationId, caseId, record.domain === "MONITORING" ? "TRANSCRIPT" : "INDICATOR", record.domain === "MONITORING" ? "Trecho da transcrição (verificado)" : prv ? "Fechamento oficial do indicador" : "Dado oficial do indicador", evidenceText, record.domain === "MONITORING" ? "interaction" : prv ? "employee_indicator_performance" : "indicator_measurement", record.domain === "MONITORING" ? record.interactionId : prv ? prv.snapshotId : record.indicatorMeasurementId, occurredAt, createHash("sha256").update(evidenceText).digest("hex")],
    )
    const snapshot = {
      reliableFeedback: {
        artifactId: record.id,
        contract: output.contract,
        domain: record.domain,
        sourceNodeId: record.sourceNodeId,
        sourceType: record.sourceType,
        policyVersion: output.policyVersion,
        // V1.7.1a — análise completa × feedback e a linhagem dos materiais (documento → etapas em que foi usado).
        ...(output.findings ? { findings: output.findings } : {}),
        // V1.7.1b — de onde veio a abertura/fechamento (redator validado ou sistema); o nome é do cadastro, nunca do modelo.
        ...(output.presentation ? { presentation: { version: output.presentation.version, source: output.presentation.source, violations: output.presentation.violations, ...(output.presentation.narrativeResolution ? { narrative: output.presentation.narrativeResolution } : {}) } } : {}),
        // V2 — o que a tela do Acompanhamento renderiza (narrativa + card + detalhes determinísticos); sem ids internos nem QA.
        ...(feedbackView ? { feedbackView } : {}),
        // INDICATOR DIAGNOSIS V1 — visão TÉCNICA (população, mix, padrões, Subgrupo, limitações): lida só pela liderança.
        ...(prv ? { supervisorView: prv.supervisorView, prvClosing: prv.provenance } : {}),
        supportMaterials: supportMaterialLineageOf(output.items).map((material) => ({ documentId: material.documentId, applicability: material.applicability, usedIn: material.usedIn.map((use) => ({ itemIndex: use.itemIndex, section: use.section, step: use.step })) })),
        // V1.7.1 — por item: etapa exibível, status, tipo da evidência e a linhagem da regra (documento, versão, seção, base da aplicabilidade).
        items: output.items.map((item) => ({
          section: item.section,
          wordingSource: item.wordingSource,
          qaStatus: item.qaStatus,
          grounding: item.grounding,
          ...(item.priority ? { priority: { rank: item.priority.rank, policy: item.priority.policy, basis: item.priority.basis } } : {}),
          ...(item.suggestedResponse ? { suggestedResponse: item.suggestedResponse.provenance } : {}),
          ...(item.applicability ? { applicability: { status: item.applicability.status, statementComparison: item.applicability.statementComparison, compatibleProducts: item.applicability.compatibleProducts, candidates: item.applicability.candidates.map((candidate) => ({ product: candidate.product, documentId: candidate.documentId })) } } : {}),
          ...(item.process ? { checkpoint: { stepTitle: item.process.stepTitle ?? null, status: item.process.status, evidenceType: item.process.evidenceType ?? null } } : {}),
          ...(item.knowledge ? { knowledge: { documentId: item.knowledge.documentId, version: item.knowledge.version, heading: item.knowledge.heading, applicability: item.knowledge.applicability, applicabilityBasis: item.knowledge.applicabilityBasis ?? null, detail: Boolean(item.knowledge.detail) } } : {}),
        })),
      },
      ...(record.interactionId ? { interactionId: record.interactionId } : {}),
      ...(record.indicatorMeasurementId ? { indicatorMeasurementId: record.indicatorMeasurementId } : {}),
    }
    const feedback = await client.query<{ id: string }>(
      `insert into feedbacks(organization_id, case_id, operator_id, status, feedback_kind, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation, context_snapshot, published_at, updated_at)
       values ($1,$2,$3,'PUBLISHED',$4,$5,$6,$7,$8,$9,$10,now(),now()) returning id`,
      [input.organizationId, caseId, record.collaboratorId, record.domain, content.impactedIndicator, content.evidenceFound, content.observedBehavior, content.relatedProcedure, content.recommendation, JSON.stringify(snapshot)],
    )
    const feedbackId = feedback.rows[0]!.id
    // V1.6.0 — Material de apoio: os documentos que sustentaram os itens, revalidados contra o ACESSO do colaborador (a mesma
    // persistência do feedback de sempre — sem acesso, o material não entra e o aviso fica no context_snapshot).
    await persistSupportMaterialsWithSnapshot(client, { organizationId: input.organizationId, feedbackId, operatorId: record.collaboratorId, supportMaterials: supportMaterialsOf(output.items) })
    await client.query(`insert into case_timeline_events (organization_id, case_id, event_type, payload) values ($1, $2, 'FEEDBACK_PUBLISHED', $3)`, [input.organizationId, caseId, { feedbackId }])
    await client.query(`insert into outbox_events (aggregate_type, aggregate_id, event_type, payload) values ('Feedback', $1, 'FeedbackPublished', $2)`, [feedbackId, { feedbackId, caseId }])
    await client.query(`update workflow_output_emissions set case_id = $2, feedback_id = $3 where id = $1`, [emission.rows[0].id, caseId, feedbackId])
    await client.query("commit")
    return { caseId, feedbackId, reused: false }
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

/** INDICATOR DIAGNOSIS V1 — as projeções do fechamento a partir dos itens que REALMENTE saem (narrativa conferida contra eles). */
export function prvPublicationOf(data: PrvClosingArtifactData, items: readonly EmittedItem[]) {
  const narrative = resolvePrvNarrative(data.narrative, items, data)
  const investigations = data.diagnosis.investigations
  return {
    collaboratorView: prvCollaboratorViewOf(items, data, narrative),
    supervisorView: prvSupervisorViewOf(data, narrative),
    // V2 — diagnóstico direto: "<indicador> · <período>" (nunca "Fechamento do PRV").
    indicatorLabel: `${investigations.map((investigation) => investigation.indicatorName).join(", ") || "Indicadores"} · ${data.diagnosis.source?.kind === "DIRECT_INDICATOR" ? data.diagnosis.referencePeriodLabel : `Fechamento de ${data.diagnosis.referencePeriodLabel}`}`,
    snapshotId: investigations[0]?.snapshotId ?? null,
    indicatorCode: investigations.map((investigation) => investigation.indicatorCode).join(",") || "INDICADOR",
    provenance: {
      idempotencyKey: data.idempotencyKey,
      referencePeriod: data.referencePeriod,
      logicVersion: data.diagnosis.version,
      ...(data.diagnosis.source ? { source: data.diagnosis.source } : {}),
      versions: data.diagnosis.versions,
      strategies: investigations.map((investigation) => ({ indicatorCode: investigation.indicatorCode, strategyVersionId: investigation.strategy.versionId, snapshotId: investigation.snapshotId, conclusion: investigation.conclusion.type })),
      narrative: { promptVersion: data.narrative?.promptVersion ?? null, source: narrative.source, violations: narrative.violations },
      generatedAt: data.diagnosis.generatedAt,
    },
  }
}
