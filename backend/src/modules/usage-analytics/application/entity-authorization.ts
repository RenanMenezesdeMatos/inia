import type { Database } from "../../../infrastructure/database/pool.js"
import { SqlParams } from "../../../shared/infrastructure/sql-params.js"
import { scopedPeopleSql } from "../../access/application/scope-people-reader.js"
import { ownersOfConversations } from "../../assistant/application/usage-analytics-reader.js"
import { recipientsOfWorkflowOutputs } from "../../conversational-delivery/application/usage-analytics-reader.js"
import { recipientsOfFeedbacks } from "../../feedbacks/application/usage-analytics-reader.js"
import { recipientsOfDeliveries } from "./feedback-sources.js"
import { existingMaterials } from "../../knowledge/application/usage-analytics-reader.js"
import { recipientsOfAlerts } from "../../notifications/application/usage-analytics-reader.js"
import { loadAncestors } from "../../people/application/usage-analytics-reader.js"
import { operatorsOfCases } from "../../supervision-cases/application/usage-analytics-reader.js"
import { existingWorkflows } from "../../workflows/application/usage-analytics-reader.js"
import type { EntityRef, RejectionReason } from "../domain/ingestion-rules.js"

/**
 * Entidade citada por um evento do navegador: precisa EXISTIR na organização e estar no ALCANCE de quem usa. O dono vira o
 * SUJEITO do evento (ex.: o destinatário do feedback) — ator e sujeito nunca se confundem: um gestor abrindo o feedback de
 * alguém da equipe é ator = gestor, sujeito = colaborador (e não conta como consumo do destinatário).
 *
 *   feedback publicado / entrega / caso / conversa / pessoa → o próprio ou alguém da cadeia de gestão acima dele
 *     (pessoa também: quem tem `indicators.view` alcançando-a);
 *   notificação / recado de Workflow → só o próprio destinatário;
 *   material / workflow → existe na organização (o acesso ao conteúdo é decidido pelas telas de origem).
 */
type Queryable = Pick<Database, "query">
export type EntityDecision = { ok: true; subjectPersonId: string | null } | { ok: false; reason: RejectionReason }

const key = (entity: EntityRef) => `${entity.type}:${entity.id}`

export async function authorizeEntities(db: Queryable, input: { organizationId: string; actorPersonId: string; entities: readonly EntityRef[] }): Promise<Map<string, EntityDecision>> {
  const ids = (type: EntityRef["type"]) => [...new Set(input.entities.filter((entity) => entity.type === type).map((entity) => entity.id))]
  const org = input.organizationId
  const [feedbacks, deliveries, alerts, materials, conversations, workflows, cases, outputs, persons] = await Promise.all([
    recipientsOfFeedbacks(db, org, ids("PUBLISHED_FEEDBACK")),
    recipientsOfDeliveries(db, org, ids("INTERACTION_FEEDBACK_DELIVERY")),
    recipientsOfAlerts(db, org, ids("ALERT")),
    existingMaterials(db, org, ids("KNOWLEDGE_MATERIAL")),
    ownersOfConversations(db, org, ids("CONVERSATION")),
    existingWorkflows(db, org, ids("WORKFLOW")),
    operatorsOfCases(db, org, ids("CASE")),
    recipientsOfWorkflowOutputs(db, org, ids("WORKFLOW_OUTPUT")),
    personsInOrganization(db, org, ids("PERSON")),
  ])
  const owners = new Map<string, string>()
  for (const [type, map] of [["PUBLISHED_FEEDBACK", feedbacks], ["INTERACTION_FEEDBACK_DELIVERY", deliveries], ["CONVERSATION", conversations], ["CASE", cases]] as const) {
    for (const [id, owner] of map) owners.set(`${type}:${id}`, owner)
  }
  for (const id of persons) owners.set(`PERSON:${id}`, id)
  const ancestors = await loadAncestors(db, org, [...new Set(owners.values())])
  const personIds = ids("PERSON")
  const reachableByIndicators = personIds.length > 0 ? await peopleReachable(db, org, input.actorPersonId, personIds) : new Set<string>()

  const decisions = new Map<string, EntityDecision>()
  for (const entity of input.entities) {
    const id = key(entity)
    if (decisions.has(id)) continue
    switch (entity.type) {
      case "ALERT":
      case "WORKFLOW_OUTPUT": {
        const recipient = (entity.type === "ALERT" ? alerts : outputs).get(entity.id)
        decisions.set(id, !recipient ? { ok: false, reason: "ENTITY_NOT_FOUND" } : recipient === input.actorPersonId ? { ok: true, subjectPersonId: recipient } : { ok: false, reason: "ENTITY_NOT_AUTHORIZED" })
        break
      }
      case "KNOWLEDGE_MATERIAL":
        decisions.set(id, materials.has(entity.id) ? { ok: true, subjectPersonId: null } : { ok: false, reason: "ENTITY_NOT_FOUND" })
        break
      case "WORKFLOW":
        decisions.set(id, workflows.has(entity.id) ? { ok: true, subjectPersonId: null } : { ok: false, reason: "ENTITY_NOT_FOUND" })
        break
      default: {
        const owner = owners.get(id)
        if (!owner) {
          decisions.set(id, { ok: false, reason: "ENTITY_NOT_FOUND" })
          break
        }
        const allowed = owner === input.actorPersonId || (ancestors.get(owner)?.has(input.actorPersonId) ?? false) || (entity.type === "PERSON" && reachableByIndicators.has(owner))
        decisions.set(id, allowed ? { ok: true, subjectPersonId: owner } : { ok: false, reason: "ENTITY_NOT_AUTHORIZED" })
      }
    }
  }
  return decisions
}

export const entityKey = key

async function personsInOrganization(db: Queryable, organizationId: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const result = await db.query<{ id: string }>(`select id from people where organization_id = $1 and id = any($2::uuid[])`, [organizationId, ids])
  return new Set(result.rows.map((row) => row.id))
}

async function peopleReachable(db: Queryable, organizationId: string, viewerPersonId: string, personIds: readonly string[]): Promise<Set<string>> {
  const p = new SqlParams()
  const scoped = scopedPeopleSql(p, { organizationId, viewerPersonId, permission: "indicators.view" })
  const result = await db.query<{ person_id: string }>(`select person_id from (${scoped}) s where person_id = any(${p.typed([...personIds], "uuid[]")})`, p.values)
  return new Set(result.rows.map((row) => row.person_id))
}
