import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { evaluateAttainment, type IndicatorDirection } from "../../indicators/domain/evaluate-attainment.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { enrollFlagWorkflows } from "../../workflows/application/flag-enrollment.js"
import { enrollIndicatorWorkflows } from "../../workflows/application/indicator-enrollment.js"

// Ingestão LEGADA (anterior à Central de Dados) — montada só para `data_hub.manage` com escopo de organização. Organização =
// a da sessão; colaborador precisa ser dela; tamanhos limitados (achado I-F5).
const measurementSchema = z.object({
  operatorId: z.uuid(), indicatorCode: z.string().trim().min(1).max(40), value: z.number().finite(),
  periodStart: z.iso.datetime(), periodEnd: z.iso.datetime(), source: z.string().trim().min(1).max(100),
})

const interactionSchema = z.object({
  externalId: z.string().trim().min(1).max(200), operatorId: z.uuid(), reason: z.string().trim().min(2).max(500),
  // Submotivo opcional (o recorte específico dentro do motivo); ausente/vazio mantém o já gravado — mesma regra da Central de Dados.
  subReason: z.string().trim().max(500).nullish().transform((value) => (value ? value : null)),
  channel: z.string().trim().min(1).max(40).default("VOICE"), startedAt: z.iso.datetime(), endedAt: z.iso.datetime(),
  transcript: z.object({ content: z.string().trim().min(10).max(200_000), language: z.string().max(20).default("pt-BR"), confidence: z.number().min(0).max(1).optional() }),
  flags: z.record(z.string().max(100), z.union([z.boolean(), z.number()])).refine((flags) => Object.keys(flags).length <= 50, "No máximo 50 flags por interação.").default({}),
})

/** Diferença de relógio aceita entre o sistema de origem e o servidor ao receber o fim de uma chamada. */
export const INGESTION_CLOCK_SKEW_MS = 5 * 60_000

export function createIngestionRouter(db: Database) {
  const router = Router()
  router.post("/indicator-measurements/batch", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = z.array(measurementSchema).min(1).max(1000).parse(request.body)
    const client = await db.connect()
    try {
      await client.query("begin")
      const results = []
      for (const item of input) {
        const context = await client.query<{ indicator_id: string; direction: string; target: string | null }>(`
          select i.id indicator_id,i.desired_direction direction,
            (select g.target_value from goals g where g.indicator_definition_id=i.id and g.subject_type='TEAM' and g.subject_id=p.team_id and g.valid_from <= $4::timestamptz::date and (g.valid_until is null or g.valid_until >= $4::timestamptz::date) order by g.valid_from desc limit 1) target
          from indicator_definitions i cross join people p where i.organization_id=$1 and i.code=$2 and p.id=$3 and p.organization_id=$1`, [organizationId, item.indicatorCode, item.operatorId, item.periodEnd])
        const row = context.rows[0]
        if (!row) throw new Error(`Indicador ou colaborador inválido: ${item.indicatorCode}`)
        const measurement = await client.query<{ id: string }>(
          `insert into indicator_measurements(organization_id,indicator_definition_id,subject_type,subject_id,value,period_start,period_end,source)
           values($1,$2,'PERSON',$3,$4,$5,$6,$7)
           on conflict (organization_id, indicator_definition_id, subject_type, subject_id, period_start, period_end, source)
           do update set value = excluded.value
           returning id`,
          [organizationId, row.indicator_id, item.operatorId, item.value, item.periodStart, item.periodEnd, item.source],
        )
        const measurementId = measurement.rows[0]!.id
        const target = row.target === null ? null : Number(row.target)
        const achieved = evaluateAttainment(item.value, target, row.direction as IndicatorDirection)
        results.push({ operatorId: item.operatorId, indicatorCode: item.indicatorCode, value: item.value, target, achieved })

        // Só matricula (Abrangência + Filtro Populacional — mesma regra do Trigger por Flag, do
        // agendador e do QA Lab, ver indicator-enrollment.ts/workflow-eligibility.ts): quem avalia
        // a condição e roda a ação é o motor de workflow (engine.ts), em ticks periódicos.
        await enrollIndicatorWorkflows(client, { organizationId, measurementId, operatorId: item.operatorId, indicatorCode: item.indicatorCode, value: item.value })
      }
      await client.query("commit")
      response.status(202).json({ data: results })
    } catch (error) { await client.query("rollback"); throw error } finally { client.release() }
  })

  router.post("/interactions", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = interactionSchema.parse(request.body)
    const operator = await db.query(`select 1 from people where id = $1 and organization_id = $2`, [input.operatorId, organizationId])
    if (!operator.rows[0]) return response.status(422).json({ error: { code: "OPERATOR_NOT_FOUND", message: "Colaborador não encontrado nesta organização." } })
    if (new Date(input.endedAt) <= new Date(input.startedAt)) return response.status(422).json({ error: { code: "INVALID_PERIOD", message: "O fim da chamada deve ser posterior ao início." } })
    // Chamada que termina no futuro é dado errado (relógio ou fuso do sistema de origem) e disparava Workflows como se já tivesse
    // acontecido (validação funcional de 20/10/2026, D12). Tolerância para diferença de relógio entre os sistemas.
    if (new Date(input.endedAt).getTime() > Date.now() + INGESTION_CLOCK_SKEW_MS) {
      return response.status(422).json({ error: { code: "INTERACTION_ENDS_IN_FUTURE", message: "O fim da chamada está no futuro. Confira o relógio e o fuso horário do sistema de origem." } })
    }
    const client = await db.connect()
    let id: string
    try {
      await client.query("begin")
      const interaction = await client.query<{ id: string }>(`insert into interactions(organization_id,operator_id,reason,sub_reason,channel,started_at,ended_at,external_id) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(organization_id,external_id) do update set reason=excluded.reason,sub_reason=coalesce(excluded.sub_reason,interactions.sub_reason) returning id`, [organizationId, input.operatorId, input.reason, input.subReason, input.channel, input.startedAt, input.endedAt, input.externalId])
      id = interaction.rows[0]!.id
      await client.query(`insert into transcripts(organization_id,interaction_id,version,content,language,confidence) values($1,$2,1,$3,$4,$5) on conflict(interaction_id,version) do update set content=excluded.content,language=excluded.language,confidence=excluded.confidence`, [organizationId, id, input.transcript.content, input.transcript.language, input.transcript.confidence ?? null])

      const flagEntries = Object.entries(input.flags)
      if (flagEntries.length > 0) {
        const catalog = await client.query<{ id: string; flag_name: string; value_type: string }>(
          `select id, flag_name, value_type from channel_flags where organization_id = $1 and channel = $2 and active`,
          [organizationId, input.channel],
        )
        const catalogByName = new Map(catalog.rows.map((row) => [row.flag_name, row]))

        for (const [flagName, value] of flagEntries) {
          const flag = catalogByName.get(flagName)
          if (!flag) {
            throw new DomainError(
              `Flag "${flagName}" não está cadastrada para o canal ${input.channel}. Cadastre-a no catálogo antes de enviar.`,
              "UNKNOWN_CHANNEL_FLAG",
              422,
            )
          }
          const isBoolean = typeof value === "boolean"
          if ((flag.value_type === "BOOLEAN") !== isBoolean) {
            throw new DomainError(
              `Flag "${flagName}" espera um valor ${flag.value_type === "BOOLEAN" ? "booleano" : "numérico"}.`,
              "CHANNEL_FLAG_TYPE_MISMATCH",
              422,
            )
          }
          // Reenvio da MESMA flag com o MESMO valor não devolve linha: nada mudou, nada matricula de novo (mesma regra da Central de
          // Dados, `interaction-writers.ts`). Antes cada reenvio rematriculava todos os Workflows da flag e duplicava escalonamentos e
          // avisos (validação funcional de 20/10/2026, D4). A linha da interação, travada pelo upsert acima, serializa reenvios simultâneos.
          const written = await client.query(
            `insert into interaction_flags(organization_id, interaction_id, channel_flag_id, value_boolean, value_numeric)
             values ($1,$2,$3,$4,$5)
             on conflict (interaction_id, channel_flag_id) do update set
               value_boolean = excluded.value_boolean, value_numeric = excluded.value_numeric, received_at = now()
             where interaction_flags.value_boolean is distinct from excluded.value_boolean or interaction_flags.value_numeric is distinct from excluded.value_numeric
             returning id`,
            [organizationId, id, flag.id, isBoolean ? value : null, isBoolean ? null : value],
          )
          if (written.rows.length === 0) continue

          // Só matricula (Abrangência + Filtro Populacional — mesma regra do agendador e do QA
          // Lab, ver flag-enrollment.ts/workflow-eligibility.ts): quem avalia a condição (SE) e
          // roda a ação é o motor de workflow, em ticks periódicos (engine.ts).
          await enrollFlagWorkflows(client, { organizationId, interactionId: id, operatorId: input.operatorId, channelFlagId: flag.id, flagName, value })
        }
      }

      await client.query("commit")
    } catch (error) { await client.query("rollback"); throw error } finally { client.release() }

    response.status(202).json({ data: { interactionId: id, status: "RECEIVED" } })
  })
  return router
}
