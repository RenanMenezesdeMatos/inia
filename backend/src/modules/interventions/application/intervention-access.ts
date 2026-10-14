import type { Database } from "../../../infrastructure/database/pool.js"
import { canOnCollaborator, type AccessContext } from "../../access/domain/access-decision.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
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

export async function relationFor(db: Queryable | Database, access: AccessContext, parties: InterventionParties): Promise<ActorRelation> {
  const repository = createPostgresAccessRepository(db as Database)
  const viewer = access.personId
  const [collaborator, inStructure] = await Promise.all([repository.collaborator(access.organizationId, parties.personId), repository.isInStructure(access.organizationId, viewer, parties.personId)])
  const resource = collaborator ?? { personId: parties.personId, teamId: null, subteamId: null }
  return {
    human: true,
    isResponsible: parties.responsibleId === viewer,
    isApprover: parties.approverId === viewer || parties.approvalRecipientIds.includes(viewer),
    isOpener: parties.openedBy === viewer || parties.acceptedBy === viewer,
    isSubject: parties.personId === viewer,
    leadsSubject: inStructure,
    can: {
      view: canOnCollaborator(access, "interventions.view", resource, inStructure),
      execute: canOnCollaborator(access, "interventions.execute", resource, inStructure),
      approve: canOnCollaborator(access, "interventions.approve", resource, inStructure),
      sensitiveDecide: canOnCollaborator(access, "interventions.sensitive_decide", resource, inStructure),
    },
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
