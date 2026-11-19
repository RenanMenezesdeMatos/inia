import type { Database } from "../../../infrastructure/database/pool.js"
import { canOnCollaborator, type AccessContext } from "../../access/domain/access-decision.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
import { isUniverseEnforced, personAllowedByUniverse, personRuleFor, personUniverse } from "../../operating-universe/application/universe-access.js"
import type { Queryable } from "../../people/application/schedule-exception-service.js"
import type { ActorRelation } from "../domain/intervention-state.js"

/**
 * Relação do VIEWER com uma intervenção — o que a regra pura (`authorizeCommand`/`canViewIntervention`) precisa saber. A
 * organização é sempre a da sessão; permissões valem só com escopo que ALCANÇA o colaborador; a cadeia de gestão (reports_to)
 * é a regra operacional de quem lidera. Configurar políticas não entra aqui: não dá acesso a colaborador nenhum.
 */
export type InterventionParties = { personId: string; responsibleId: string; approverId: string | null; approvalRecipientIds: readonly string[]; openedBy: string | null; acceptedBy: string | null }

export async function loadAccess(db: Database, organizationId: string, accountId: string): Promise<AccessContext> {
  return createPostgresAccessRepository(db).loadContext(organizationId, accountId)
}

/**
 * UNIVERSO DE ATUAÇÃO (POL-03, decisão de 19/11/2026): a mesma regra de PESSOAS da aba Equipe (`personAllowedByUniverse`), como
 * na visão da equipe e na prévia de impacto. O universo limita o que vem dos PAPÉIS (permissão na organização, no Grupo ou no
 * Subgrupo) — nunca quem lidera a pessoa pela estrutura nem quem é parte da intervenção. Organização sem universos ativados e
 * `operating_universes.all` no escopo: nada muda. Só é consultado quando o alcance dependeria de papel.
 */
async function rolesReachPersonInUniverse(db: Queryable | Database, access: AccessContext, person: { personId: string; teamId: string | null; subteamId: string | null }): Promise<boolean> {
  if (!(await isUniverseEnforced(db, access.organizationId))) return true
  const [own, theirs] = await Promise.all([personUniverse(db, access.organizationId, access.personId), personUniverse(db, access.organizationId, person.personId)])
  return personAllowedByUniverse(personRuleFor(access, true, own), { id: person.personId, teamId: person.teamId, subteamId: person.subteamId, operatingUniverse: theirs }, false)
}

const NO_ROLE_REACH = { view: false, execute: false, approve: false, sensitiveDecide: false }

export async function relationFor(db: Queryable | Database, access: AccessContext, parties: InterventionParties): Promise<ActorRelation> {
  const repository = createPostgresAccessRepository(db as Database)
  const viewer = access.personId
  const [collaborator, inStructure] = await Promise.all([repository.collaborator(access.organizationId, parties.personId), repository.isInStructure(access.organizationId, viewer, parties.personId)])
  const resource = collaborator ?? { personId: parties.personId, teamId: null, subteamId: null }
  const byRole = {
    view: canOnCollaborator(access, "interventions.view", resource, inStructure),
    execute: canOnCollaborator(access, "interventions.execute", resource, inStructure),
    approve: canOnCollaborator(access, "interventions.approve", resource, inStructure),
    sensitiveDecide: canOnCollaborator(access, "interventions.sensitive_decide", resource, inStructure),
  }
  const reachedByRole = inStructure || !Object.values(byRole).some(Boolean) || (await rolesReachPersonInUniverse(db, access, resource))
  return {
    human: true,
    isResponsible: parties.responsibleId === viewer,
    isApprover: parties.approverId === viewer || parties.approvalRecipientIds.includes(viewer),
    isOpener: parties.openedBy === viewer || parties.acceptedBy === viewer,
    isSubject: parties.personId === viewer,
    leadsSubject: inStructure,
    can: reachedByRole ? byRole : NO_ROLE_REACH,
  }
}

/** Pode abrir manualmente uma intervenção para esta pessoa? Quem a lidera (cadeia) ou quem executa intervenções no escopo. */
export async function canOpenFor(db: Database, access: AccessContext, personId: string): Promise<boolean> {
  if (personId === access.personId) return false
  const relation = await relationFor(db, access, { personId, responsibleId: "", approverId: null, approvalRecipientIds: [], openedBy: null, acceptedBy: null })
  return relation.leadsSubject || relation.can.execute
}

/** Pode ver as intervenções desta pessoa (ficha, lista)? A cadeia de gestão ou qualquer permissão de intervenção no escopo. */
export async function canSeeInterventionsOf(db: Database, access: AccessContext, personId: string): Promise<boolean> {
  if (personId === access.personId) return false
  const relation = await relationFor(db, access, { personId, responsibleId: "", approverId: null, approvalRecipientIds: [], openedBy: null, acceptedBy: null })
  return relation.leadsSubject || relation.can.view || relation.can.execute || relation.can.approve || relation.can.sensitiveDecide
}

/**
 * O TEXTO dos feedbacks do colaborador no resumo de um relatório: a mesma regra do Acompanhamento (`follow-up-briefs.ts`) — quem
 * é parte de um acompanhamento aberto por este relatório (responsável, aprovador ou destinatário da decisão) ou quem lidera o
 * colaborador na cadeia de gestão. Permissão de intervenção no escopo, sozinha, lê o relatório mas não esse texto (POL-06).
 */
export async function canReadFeedbackText(db: Queryable | Database, access: AccessContext, report: { id: string; personId: string }): Promise<boolean> {
  if (report.personId === access.personId) return false
  if (await createPostgresAccessRepository(db as Database).isInStructure(access.organizationId, access.personId, report.personId)) return true
  const party = await db.query(`select 1 from interventions i where i.organization_id = $1 and i.report_id = $2 and ($3 = i.responsible_id or $3 = i.approver_id or $3 = any(i.approval_recipient_ids)) limit 1`, [access.organizationId, report.id, access.personId])
  return (party.rowCount ?? 0) > 0
}
