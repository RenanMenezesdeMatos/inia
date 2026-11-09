import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { booleanParam, respondList, searchParam, SqlFilter } from "../../../shared/presentation/list-query.js"
import { canOrganizationWide } from "../../access/domain/access-decision.js"
import { sessionUser } from "../../auth/presentation/session-user.js"
import { responseCheckMode } from "../domain/response-compliance.js"

const topicSchema = z.object({ name: z.string().trim().min(2), requiredBehavior: z.string().trim().min(5) })
const topicUpdateSchema = z.object({ name: z.string().trim().min(2).optional(), requiredBehavior: z.string().trim().min(5).optional(), active: z.boolean().optional() })
const glossarySchema = z.object({ term: z.string().trim().min(1), definition: z.string().trim().min(2), feedbackApplication: z.string().trim().min(2) })
const glossaryUpdateSchema = z.object({ term: z.string().trim().min(1).optional(), definition: z.string().trim().min(2).optional(), feedbackApplication: z.string().trim().min(2).optional(), active: z.boolean().optional() })

const listGovernanceSchema = z.object({ search: searchParam, active: booleanParam })

const SELECT_TOPICS = `select id,name,required_behavior "requiredBehavior",active from prohibited_topics where organization_id=$1`
const SELECT_GLOSSARY = `select id,term,definition,feedback_application "feedbackApplication",active from glossary_terms where organization_id=$1`

/**
 * Exclusão lógica (migration 177): sai das telas e da IA, continua guardado e volta pela Central de Dados, desligado. O texto também fica em `audit_logs` na MESMA instrução:
 * é o rastro do que a IA deixou de respeitar. Para só suspender, `active=false`.
 */
const DELETE_WITH_AUDIT = (table: "prohibited_topics" | "glossary_terms", entityType: string, payload: string) =>
  `with removed as (update ${table}_all set active=false, deleted_at=now(), deleted_by_person_id=$3::uuid, updated_at=now() where id=$1 and organization_id=$2 and deleted_at is null returning *)
   insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload)
   select organization_id, $3::uuid, 'DELETE', '${entityType}', id, ${payload} from removed returning entity_id`
const DELETE_TOPIC = DELETE_WITH_AUDIT("prohibited_topics", "prohibited_topic", `jsonb_build_object('name', name, 'requiredBehavior', required_behavior, 'active', active)`)
const DELETE_GLOSSARY_TERM = DELETE_WITH_AUDIT("glossary_terms", "glossary_term", `jsonb_build_object('term', term, 'definition', definition, 'active', active)`)

/** O registro da conferência das respostas (PEN-017): só o que foi barrado, detectado ou não pôde ser conferido. */
const SELECT_RESPONSE_CHECKS = `select c.id, c.surface, c.control, c.outcome, c.action, c.rules, c.reason, c.error_code "errorCode", c.flagged_content "flaggedContent", c.conversation_id "conversationId", c.agent_id "agentId", a.name "agentName", c.created_at "createdAt"
  from response_compliance_checks c left join agents_all a on a.id = c.agent_id and a.organization_id = c.organization_id
  where c.organization_id=$1 and c.outcome <> 'ALLOWED'`
const RESPONSE_CHECK_SUMMARY_DAYS = 30

export function createGovernanceRouter(db: Database) {
  const router = Router()

  /** O texto barrado vem de conversas de toda a organização: ler este registro exige alcançá-la inteira, mesmo sendo leitura. */
  const requireOrganizationWide = (request: Parameters<typeof sessionUser>[0] & { access?: Parameters<typeof canOrganizationWide>[0] | undefined }, response: { status: (code: number) => { json: (body: unknown) => unknown } }) => {
    if (request.access && canOrganizationWide(request.access, "configuration.manage")) return true
    response.status(403).json({ error: { code: "ORGANIZATION_SCOPE_REQUIRED", message: "Este registro vale para a organização inteira: só quem a administra em toda a organização pode lê-lo." } })
    return false
  }
  router.get("/response-checks/summary", async (request, response) => {
    if (!requireOrganizationWide(request, response)) return
    const organizationId = sessionUser(request).organizationId
    const row = (await db.query<{ checked: number; delivered: number; blocked: number; detected: number; failed: number }>(
      `select count(*)::int checked, count(*) filter (where outcome = 'ALLOWED')::int delivered, count(*) filter (where outcome = 'VIOLATION' and action = 'BLOCKED')::int blocked,
              count(*) filter (where outcome = 'VIOLATION' and action = 'RECORDED')::int detected, count(*) filter (where outcome = 'CHECK_FAILED')::int failed
         from response_compliance_checks where organization_id = $1 and created_at > now() - make_interval(days => $2)`,
      [organizationId, RESPONSE_CHECK_SUMMARY_DAYS],
    )).rows[0]
    // O modo em vigor vai junto: a tela nunca apresenta AUDIT ou OFF como prevenção.
    response.json({ data: { days: RESPONSE_CHECK_SUMMARY_DAYS, mode: responseCheckMode(), ...row } })
  })
  router.get("/response-checks", async (request, response) => {
    if (!requireOrganizationWide(request, response)) return
    const data = await respondList(db, request.query, { select: SELECT_RESPONSE_CHECKS, filter: new SqlFilter([sessionUser(request).organizationId]), orderBy: 'q."createdAt" desc, q.id' })
    response.json({ data })
  })

  router.get("/prohibited-topics", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = listGovernanceSchema.parse(request.query)
    const filter = new SqlFilter([organizationId]).search(input.search, ["q.name", 'q."requiredBehavior"']).equals("q.active", input.active)
    const data = await respondList(db, request.query, { select: SELECT_TOPICS, filter, orderBy: "q.name, q.id" })
    response.json({ data })
  })
  router.post("/prohibited-topics", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = topicSchema.parse(request.body)
    const result = await db.query(`insert into prohibited_topics(organization_id,name,required_behavior) values($1,$2,$3) returning id,name,required_behavior "requiredBehavior",active`, [organizationId, input.name, input.requiredBehavior])
    response.status(201).json({ data: result.rows[0] })
  })
  router.patch("/prohibited-topics/:id", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = topicUpdateSchema.parse(request.body)
    const result = await db.query(
      `update prohibited_topics set name=coalesce($1,name), required_behavior=coalesce($2,required_behavior), active=coalesce($3,active), updated_at=now()
       where id=$4 and organization_id=$5 returning id,name,required_behavior "requiredBehavior",active`,
      [input.name ?? null, input.requiredBehavior ?? null, input.active ?? null, request.params.id, organizationId],
    )
    if (!result.rows[0]) return response.status(404).json({ error: { code: "TOPIC_NOT_FOUND", message: "Assunto não encontrado." } })
    response.json({ data: result.rows[0] })
  })
  router.delete("/prohibited-topics/:id", async (request, response) => {
    const result = await db.query(DELETE_TOPIC, [request.params.id, sessionUser(request).organizationId, sessionUser(request).personId ?? null])
    if (!result.rows[0]) return response.status(404).json({ error: { code: "TOPIC_NOT_FOUND", message: "Assunto não encontrado." } })
    response.status(204).send()
  })

  router.get("/glossary", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = listGovernanceSchema.parse(request.query)
    const filter = new SqlFilter([organizationId])
      .search(input.search, ["q.term", "q.definition", 'q."feedbackApplication"'])
      .equals("q.active", input.active)
    const data = await respondList(db, request.query, { select: SELECT_GLOSSARY, filter, orderBy: "q.term, q.id" })
    response.json({ data })
  })
  router.post("/glossary", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = glossarySchema.parse(request.body)
    const result = await db.query(`insert into glossary_terms(organization_id,term,definition,feedback_application) values($1,$2,$3,$4) returning id,term,definition,feedback_application "feedbackApplication",active`, [organizationId, input.term, input.definition, input.feedbackApplication])
    response.status(201).json({ data: result.rows[0] })
  })
  router.patch("/glossary/:id", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = glossaryUpdateSchema.parse(request.body)
    const result = await db.query(
      `update glossary_terms set term=coalesce($1,term), definition=coalesce($2,definition), feedback_application=coalesce($3,feedback_application), active=coalesce($4,active), updated_at=now()
       where id=$5 and organization_id=$6 returning id,term,definition,feedback_application "feedbackApplication",active`,
      [input.term ?? null, input.definition ?? null, input.feedbackApplication ?? null, input.active ?? null, request.params.id, organizationId],
    )
    if (!result.rows[0]) return response.status(404).json({ error: { code: "GLOSSARY_TERM_NOT_FOUND", message: "Termo não encontrado." } })
    response.json({ data: result.rows[0] })
  })
  router.delete("/glossary/:id", async (request, response) => {
    const result = await db.query(DELETE_GLOSSARY_TERM, [request.params.id, sessionUser(request).organizationId, sessionUser(request).personId ?? null])
    if (!result.rows[0]) return response.status(404).json({ error: { code: "GLOSSARY_TERM_NOT_FOUND", message: "Termo não encontrado." } })
    response.status(204).send()
  })
  return router
}
