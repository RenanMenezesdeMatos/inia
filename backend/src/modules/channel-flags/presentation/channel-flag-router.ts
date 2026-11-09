import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { displayIconKeySchema } from "../../../shared/domain/display-icon.js"
import { booleanParam, dateParam, listParam, respondList, searchParam, SqlFilter } from "../../../shared/presentation/list-query.js"
import { callOutcomeSchema, type CallOutcome } from "../domain/call-outcome.js"
import { sessionUser } from "../../auth/presentation/session-user.js"
import { loadPoliciesCiting } from "../../interventions/application/policy-references.js"
import { loadWorkflowsCitingFlag } from "../../workflows/application/workflow-node-references.js"


// Nome de exibição e ícone (migration 115): como a flag aparece para o colaborador no motivo do feedback ("Monitoria · Rechamada").
const labelSchema = z.string().trim().min(1).max(60).nullable()

// Chamada boa × ruim e indicador relacionado (migration 156): o que a base de boas práticas e o feedback precisam saber do sinal.
const callOutcomeFields = {
  callOutcome: callOutcomeSchema.nullable().optional(),
  relatedIndicatorId: z.string().uuid().nullable().optional(),
}

const channelFlagSchema = z.object({
  channel: z.string().trim().min(2).default("VOICE"),
  flagName: z.string().trim().min(2),
  valueType: z.enum(["BOOLEAN", "NUMERIC"]),
  description: z.string().trim().optional(),
  label: labelSchema.optional(),
  iconKey: displayIconKeySchema.nullable().optional(),
  ...callOutcomeFields,
})

const updateChannelFlagSchema = z.object({
  channel: z.string().trim().min(2).optional(),
  flagName: z.string().trim().min(2).optional(),
  description: z.string().trim().optional(),
  active: z.boolean().optional(),
  // Presente (mesmo null) = altera; ausente = mantém.
  label: labelSchema.optional(),
  iconKey: displayIconKeySchema.nullable().optional(),
  ...callOutcomeFields,
})

/** O critério de chamada boa/ruim tem de ser do tipo do sinal; o indicador relacionado, da organização. */
async function validateOutcome(db: Database, organizationId: string, valueType: string, outcome: CallOutcome | null | undefined, relatedIndicatorId: string | null | undefined) {
  if (outcome && outcome.kind !== valueType) throw new DomainError(valueType === "NUMERIC" ? "Sinal numérico: informe as faixas de chamada boa e ruim." : "Sinal sim/não: informe qual valor é o ruim.", "CHANNEL_FLAG_OUTCOME_TYPE", 422)
  if (relatedIndicatorId && !(await db.query(`select 1 from indicator_definitions where id = $1 and organization_id = $2`, [relatedIndicatorId, organizationId])).rowCount) throw new DomainError("Indicador relacionado não encontrado.", "CHANNEL_FLAG_INDICATOR_NOT_FOUND", 422)
}

const listChannelFlagsSchema = z.object({
  search: searchParam,
  channel: listParam(z.string().trim().min(1)),
  valueType: listParam(z.enum(["BOOLEAN", "NUMERIC"])),
  active: booleanParam,
  createdFrom: dateParam,
  createdTo: dateParam,
})

const SELECT_CHANNEL_FLAGS = `
  select f.id, f.channel, f.flag_name "flagName", f.value_type "valueType", f.description, f.label, f.icon_key "iconKey", f.active, f.created_at "createdAt",
         f.call_outcome "callOutcome", f.related_indicator_definition_id "relatedIndicatorId", i.name "relatedIndicatorName"
  from channel_flags f left join indicator_definitions i on i.id = f.related_indicator_definition_id
  where f.organization_id = $1
`

export function createChannelFlagRouter(db: Database) {
  const router = Router()

  router.get("/", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = listChannelFlagsSchema.parse(request.query)
    const filter = new SqlFilter([organizationId])
      .search(input.search, ['q."flagName"', "q.description", "q.label"])
      .in("q.channel", input.channel?.map((channel) => channel.toUpperCase()))
      .in('q."valueType"', input.valueType)
      .equals("q.active", input.active)
      .dateRange('q."createdAt"', input.createdFrom, input.createdTo)
    const data = await respondList(db, request.query, { select: SELECT_CHANNEL_FLAGS, filter, orderBy: 'q.channel, q."flagName"' })
    response.json({ data })
  })

  // Canais distintos já cadastrados — alimenta o filtro de canal sem a UI precisar varrer a
  // lista inteira.
  router.get("/channels", async (request, response) => {
    const result = await db.query<{ channel: string }>(`select distinct channel from channel_flags where organization_id = $1 order by channel`, [sessionUser(request).organizationId])
    response.json({ data: result.rows.map((row) => row.channel) })
  })

  router.post("/", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = channelFlagSchema.parse(request.body)
    await validateOutcome(db, organizationId, input.valueType, input.callOutcome, input.relatedIndicatorId)
    try {
      const result = await db.query<{ id: string }>(
        `insert into channel_flags(organization_id, channel, flag_name, value_type, description, label, icon_key, call_outcome, related_indicator_definition_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [organizationId, input.channel.toUpperCase(), input.flagName.trim().toLowerCase(), input.valueType, input.description ?? null, input.label ?? null, input.iconKey ?? null, input.callOutcome ? JSON.stringify(input.callOutcome) : null, input.relatedIndicatorId ?? null],
      )
      response.status(201).json({ data: { id: result.rows[0]!.id } })
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new DomainError("Esse canal já tem uma flag com esse nome.", "CHANNEL_FLAG_TAKEN", 409)
      }
      throw error
    }
  })

  router.patch("/:id", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = updateChannelFlagSchema.parse(request.body)
    const current = (await db.query<{ value_type: string }>(`select value_type from channel_flags where id = $1 and organization_id = $2`, [request.params.id, organizationId])).rows[0]
    if (current) await validateOutcome(db, organizationId, current.value_type, input.callOutcome, input.relatedIndicatorId)
    try {
      const result = await db.query<{ id: string }>(
        `update channel_flags set
           channel = coalesce($1, channel),
           flag_name = coalesce($2, flag_name),
           description = coalesce($3, description),
           active = coalesce($4, active),
           label = case when $7::boolean then $8 else label end,
           icon_key = case when $9::boolean then $10 else icon_key end,
           call_outcome = case when $11::boolean then $12::jsonb else call_outcome end,
           related_indicator_definition_id = case when $13::boolean then $14::uuid else related_indicator_definition_id end
         where id = $5 and organization_id = $6 returning id`,
        [
          input.channel ? input.channel.toUpperCase() : null,
          input.flagName ? input.flagName.trim().toLowerCase() : null,
          input.description ?? null,
          input.active ?? null,
          request.params.id,
          organizationId,
          input.label !== undefined,
          input.label ?? null,
          input.iconKey !== undefined,
          input.iconKey ?? null,
          input.callOutcome !== undefined,
          input.callOutcome ? JSON.stringify(input.callOutcome) : null,
          input.relatedIndicatorId !== undefined,
          input.relatedIndicatorId ?? null,
        ],
      )
      if (!result.rows[0]) return response.status(404).json({ error: { code: "CHANNEL_FLAG_NOT_FOUND", message: "Flag não encontrada." } })
      response.json({ data: { id: result.rows[0]!.id } })
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new DomainError("Esse canal já tem uma flag com esse nome.", "CHANNEL_FLAG_TAKEN", 409)
      }
      throw error
    }
  })

  router.delete("/:id", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    // Exclusão lógica (migration 177): interações já recebidas continuam guardadas e mostram o nome dela, porque o histórico lê `channel_flags_all`. Só barra o que depende dela agora.
    const current = (await db.query<{ flag_name: string }>(`select flag_name from channel_flags where id = $1 and organization_id = $2`, [request.params.id, organizationId])).rows[0]
    if (current) {
      const [workflows, policies] = await Promise.all([loadWorkflowsCitingFlag(db, organizationId, request.params.id!), loadPoliciesCiting(db, organizationId, { key: "flagName", value: current.flag_name })])
      const users = [...workflows.map((name) => `Workflow "${name}"`), ...policies.map((name) => `política "${name}"`)]
      if (users.length > 0) throw new DomainError(`Esta flag é usada por ${users.slice(0, 3).join(", ")}${users.length > 3 ? ` e mais ${users.length - 3}` : ""}. Tire-a de lá antes de excluir, ou desative-a.`, "CHANNEL_FLAG_IN_USE", 409, { workflows, policies })
    }
    const result = await db.query<{ id: string }>(
      `with deleted as (update channel_flags_all set active = false, deleted_at = now(), deleted_by_person_id = $3 where id = $1 and organization_id = $2 and deleted_at is null returning id, channel, flag_name),
            logged as (insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) select $2, $3, 'CHANNEL_FLAG_DELETED', 'channel_flag', id, jsonb_build_object('channel', channel, 'flagName', flag_name) from deleted)
       select id from deleted`,
      [request.params.id, organizationId, sessionUser(request).personId ?? null],
    )
    if (!result.rows[0]) return response.status(404).json({ error: { code: "CHANNEL_FLAG_NOT_FOUND", message: "Flag não encontrada." } })
    response.status(204).send()
  })

  return router
}
