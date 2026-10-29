import type { Database } from "../../../infrastructure/database/pool.js"
import type { EscalationRole } from "../domain/escalation-role-schema.js"

export type EnrollmentSubjectContext = {
  db: Database
  enrollment: {
    interactionId: string | null
    indicatorMeasurementId: string | null
    scheduledSubjectId: string | null
  }
}

/** Quem é "o operador" desta ocorrência — não importa qual das 3 origens de enrollment
 * (interação, medição de indicador, agenda) gerou a matrícula. Compartilhado por qualquer node
 * que precise saber de quem se trata sem chamar agente/orquestrador nenhum. */
export async function resolveEnrollmentOperatorId(context: EnrollmentSubjectContext): Promise<string | null> {
  if (context.enrollment.interactionId) {
    const row = await context.db.query<{ operator_id: string }>(`select operator_id from interactions where id = $1`, [
      context.enrollment.interactionId,
    ])
    return row.rows[0]?.operator_id ?? null
  }
  if (context.enrollment.indicatorMeasurementId) {
    const row = await context.db.query<{ subject_id: string }>(`select subject_id from indicator_measurements where id = $1`, [
      context.enrollment.indicatorMeasurementId,
    ])
    return row.rows[0]?.subject_id ?? null
  }
  return context.enrollment.scheduledSubjectId
}

/** Sobe a cadeia de `reports_to_id` a partir do operador procurando, pra cada cargo pedido, o
 * primeiro ancestral com aquele cargo — é assim que "escalonar para gerente" ou um Output node
 * com target SUPERVISOR_OF_OPERATOR/MANAGER_OF_OPERATOR/ROLE sabem pra QUAL pessoa, sem
 * precisar de uma tabela de "responsável por time" separada. Compartilhado entre a ação
 * ESCALATE e o node Output — única lógica de navegação de hierarquia do sistema. Uma guarda
 * contra ciclo (`visited`) é só defensiva — a cadeia é sempre linear na prática. */
export async function resolveByRoleChain(db: Database, operatorId: string, roles: EscalationRole[], options: { ancestorsOnly?: boolean } = {}): Promise<{ id: string; role: EscalationRole }[]> {
  const recipients: { id: string; role: EscalationRole }[] = []
  const remainingRoles = new Set(roles)
  const visited = new Set<string>()
  let currentId: string | null = operatorId
  // `ancestorsOnly` (Workflows): começa no gestor de quem é o ponto de partida — o colaborador de uma execução nunca é o
  // destinatário do cargo, nem quando passou a ter aquele cargo depois de a execução começar (achado C16 da 4ª auditoria).
  if (options.ancestorsOnly) {
    visited.add(operatorId)
    currentId = (await db.query<{ id: string; role: string; reports_to_id: string | null }>(`select id, role, reports_to_id from people where id = $1`, [operatorId])).rows[0]?.reports_to_id ?? null
  }

  while (currentId && remainingRoles.size > 0) {
    if (visited.has(currentId)) break
    visited.add(currentId)
    type PersonRow = { id: string; role: string; reports_to_id: string | null }
    const row: { rows: PersonRow[] } = await db.query<PersonRow>(`select id, role, reports_to_id from people where id = $1`, [currentId])
    const person: PersonRow | undefined = row.rows[0]
    if (!person) break
    if (remainingRoles.has(person.role as EscalationRole)) {
      recipients.push({ id: person.id, role: person.role as EscalationRole })
      remainingRoles.delete(person.role as EscalationRole)
    }
    currentId = person.reports_to_id
  }
  return recipients
}

/** De onde vem a "evidência" para um Feedback, qualquer que tenha sido a origem do enrollment —
 * usado quando quem produziu o conteúdo (ex.: um Orchestrator) não tem, como um Agent tem, um
 * `WorkflowRunContext` pré-montado com esses dados. */
export async function resolveEnrollmentEvidenceSource(
  db: Database,
  enrollment: EnrollmentSubjectContext["enrollment"],
): Promise<{ sourceType: string; sourceId: string; occurredAt: string }> {
  if (enrollment.interactionId) {
    const row = await db.query<{ started_at: string }>(`select started_at from interactions where id = $1`, [enrollment.interactionId])
    return { sourceType: "interaction", sourceId: enrollment.interactionId, occurredAt: row.rows[0]?.started_at ?? new Date().toISOString() }
  }
  if (enrollment.indicatorMeasurementId) {
    const row = await db.query<{ period_end: string }>(`select period_end from indicator_measurements where id = $1`, [enrollment.indicatorMeasurementId])
    return {
      sourceType: "indicator_measurement",
      sourceId: enrollment.indicatorMeasurementId,
      occurredAt: row.rows[0]?.period_end ?? new Date().toISOString(),
    }
  }
  return { sourceType: "scheduled_subject", sourceId: enrollment.scheduledSubjectId ?? "", occurredAt: new Date().toISOString() }
}
