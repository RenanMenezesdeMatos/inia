import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { displayIconKeySchema } from "../../../shared/domain/display-icon.js"
import { booleanParam, dateParam, listParam, respondList, searchParam, SqlFilter } from "../../../shared/presentation/list-query.js"


// Nome de exibição e ícone (migration 115): como a flag aparece para o colaborador no motivo do feedback ("Monitoria · Rechamada").
const labelSchema = z.string().trim().min(1).max(60).nullable()

const channelFlagSchema = z.object({
  channel: z.string().trim().min(2).default("VOICE"),
  flagName: z.string().trim().min(2),
  valueType: z.enum(["BOOLEAN", "NUMERIC"]),
  description: z.string().trim().optional(),
  label: labelSchema.optional(),
  iconKey: displayIconKeySchema.nullable().optional(),
})

const updateChannelFlagSchema = z.object({
  channel: z.string().trim().min(2).optional(),
  flagName: z.string().trim().min(2).optional(),
  description: z.string().trim().optional(),
  active: z.boolean().optional(),
  // Presente (mesmo null) = altera; ausente = mantém.
  label: labelSchema.optional(),
  iconKey: displayIconKeySchema.nullable().optional(),
})

const listChannelFlagsSchema = z.object({
  search: searchParam,
  channel: listParam(z.string().trim().min(1)),
  valueType: listParam(z.enum(["BOOLEAN", "NUMERIC"])),
  active: booleanParam,
  createdFrom: dateParam,
  createdTo: dateParam,
})

const SELECT_CHANNEL_FLAGS = `
  select id, channel, flag_name "flagName", value_type "valueType", description, label, icon_key "iconKey", active, created_at "createdAt"
  from channel_flags
  where organization_id = $1
`

export function createChannelFlagRouter(db: Database) {
  const router = Router()

  router.get("/", async (request, response) => {
    const organizationId = request.user!.organizationId
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
    const result = await db.query<{ channel: string }>(`select distinct channel from channel_flags where organization_id = $1 order by channel`, [request.user!.organizationId])
    response.json({ data: result.rows.map((row) => row.channel) })
  })

  router.post("/", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = channelFlagSchema.parse(request.body)
    try {
      const result = await db.query<{ id: string }>(
        `insert into channel_flags(organization_id, channel, flag_name, value_type, description, label, icon_key)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [organizationId, input.channel.toUpperCase(), input.flagName.trim().toLowerCase(), input.valueType, input.description ?? null, input.label ?? null, input.iconKey ?? null],
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
    const organizationId = request.user!.organizationId
    const input = updateChannelFlagSchema.parse(request.body)
    try {
      const result = await db.query<{ id: string }>(
        `update channel_flags set
           channel = coalesce($1, channel),
           flag_name = coalesce($2, flag_name),
           description = coalesce($3, description),
           active = coalesce($4, active),
           label = case when $7::boolean then $8 else label end,
           icon_key = case when $9::boolean then $10 else icon_key end
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
    const organizationId = request.user!.organizationId
    try {
      const result = await db.query<{ id: string }>(
        `delete from channel_flags where id = $1 and organization_id = $2 returning id`,
        [request.params.id, organizationId],
      )
      if (!result.rows[0]) return response.status(404).json({ error: { code: "CHANNEL_FLAG_NOT_FOUND", message: "Flag não encontrada." } })
      response.status(204).send()
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new DomainError(
          "Já chegaram interações com essa flag. Desative-a em vez de excluir para manter o histórico consultável.",
          "CHANNEL_FLAG_HAS_DEPENDENTS",
          409,
        )
      }
      throw error
    }
  })

  return router
}
