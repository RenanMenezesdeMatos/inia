import type { Database } from "../../../infrastructure/database/pool.js"
import { canonicalSubjectSql, rawSubjectSql } from "../../interactions/domain/interaction-subject.js"
import { interactionLabelOf, otherOperatorNamesOf, subjectOperatorNameOf } from "../../interaction-feedback/application/prepare-interaction-for-feedback.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { loadLatestTranscriptForModel } from "../../workflows/application/transcript.js"
import type { IndicatorContextLoader, MonitoringContextLoader, PublishedKnowledgeLoader, RecipientLoader } from "../application/generate-reliable-feedback.js"
import { firstNameOf } from "../domain/feedback-presentation.js"
import { loadPersonPresentation } from "../../profile-preferences/application/person-presentation-loader.js"
import type { PublishedKnowledgeDocument } from "../domain/process-assessment.js"
import { loadIndicatorCanonicalContext } from "../../indicators/application/load-indicator-canonical-context.js"

/**
 * Leitura do contexto REAL de cada domínio (V1.5.12) — sempre escopada: a interação/medição precisa ser DA organização e DO
 * colaborador da matrícula; qualquer divergência = null (o caso de uso bloqueia, fail-closed). Nunca lê texto de modelo.
 */
export function createPostgresMonitoringContextLoader(db: Database): MonitoringContextLoader {
  return async (organizationId, interactionId, collaboratorId) => {
    const row = await db.query<{ id: string; operator_id: string; started_at: Date; team_id: string | null; subject_code: string | null; reason: string | null }>(
      `select i.id, i.operator_id, i.started_at, p.team_id, ${rawSubjectSql("i")} reason, ${canonicalSubjectSql("i")} subject_code
       from interactions i join people p on p.id = i.operator_id
       where i.id = $1 and i.organization_id = $2 and p.organization_id = $2`,
      [interactionId, organizationId],
    )
    const interaction = row.rows[0]
    if (!interaction || interaction.operator_id !== collaboratorId) return null
    const transcript = await loadLatestTranscriptForModel(db, interaction.id)
    if (!transcript) return null
    const timeZone = await resolveOrganizationTimezone(db, organizationId)
    const label = await interactionLabelOf(db, organizationId, localDateOf(new Date(interaction.started_at), timeZone), interaction.subject_code, interaction.reason)
    return { transcript: transcript.content, label, otherOperatorNames: await otherOperatorNamesOf(db, organizationId, collaboratorId, interaction.team_id), subjectOperatorName: await subjectOperatorNameOf(db, organizationId, collaboratorId) }
  }
}

/** Contexto CANÔNICO de UMA medição de indicador — a MESMA leitura que "Chamar agente" usa (loadIndicatorCanonicalContext). */
export function createPostgresIndicatorContextLoader(db: Database, clock: () => Date = () => new Date()): IndicatorContextLoader {
  return (organizationId, measurementId, collaboratorId) => loadIndicatorCanonicalContext(db, { organizationId, measurementId, collaboratorId, now: clock() })
}

/**
 * V1.6.0 — versão PUBLICADA atual dos documentos citados, DA organização e não excluídos (o mesmo critério de
 * `retrieveKnowledgeForAgent`). Id de outra organização, excluído ou sem versão publicada simplesmente não volta —
 * a verificação da citação falha fechada (DOCUMENT_NOT_PUBLISHED).
 */
export function createPostgresPublishedKnowledgeLoader(db: Database): PublishedKnowledgeLoader {
  return async (organizationId, documentIds) => {
    const ids = [...new Set(documentIds)].filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    const map = new Map<string, PublishedKnowledgeDocument>()
    if (ids.length === 0) return map
    const rows = await db.query<{ id: string; title: string; content: string; version: number }>(
      `select kd.id, kd.title, kv.content, kv.version
       from knowledge_documents kd
       join lateral (select content, version from knowledge_versions where document_id = kd.id and status = 'PUBLISHED' order by version desc limit 1) kv on true
       where kd.id = any($1::uuid[]) and kd.organization_id = $2 and kd.deleted_at is null`,
      [ids, organizationId],
    )
    for (const row of rows.rows) map.set(row.id, { documentId: row.id, title: row.title, content: row.content, version: Number(row.version) })
    return map
  }
}

/**
 * V1.7.1b — nome de TRATAMENTO do colaborador para a SAUDAÇÃO ("Olá, Rafael!"), na MESMA organização, pela resolução ÚNICA de
 * profile-preferences: o nome que a própria pessoa escolheu, inteiro ("Maria Clara" nunca vira "Maria"); sem preferência, o
 * primeiro nome do cadastro. Nunca inferência, nunca enviado ao modelo (o sistema monta a saudação). Pessoa de outra
 * organização ou nome sem palavra válida = null ("Olá!"). O campo continua `firstName` (contrato dos artefatos gravados).
 */
export function createPostgresRecipientLoader(db: Database): RecipientLoader {
  return async (organizationId, collaboratorId) => {
    const presentation = await loadPersonPresentation(db, organizationId, collaboratorId)
    const firstName = presentation?.preferredName ?? firstNameOf(presentation?.registeredName)
    return firstName ? { firstName } : null
  }
}
