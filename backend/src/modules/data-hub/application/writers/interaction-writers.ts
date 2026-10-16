import { enrollFlagWorkflows } from "../../../workflows/application/flag-enrollment.js"
import { resolveChannelFlags, resolveEmployees, resolveInteractions, type ChannelFlagRef } from "../reference-resolver.js"
import { dedupeByKey, emptyApply, num, reject, str, type DomainWriter, type Rejection, type ValidRecord } from "./domain-writer.js"
import { withLineage } from "./master-data-writers.js"

/**
 * Writers de interação — mesmo modelo e mesmos efeitos da ingestão em tempo real (`/ingestion`):
 * interação idempotente por `external_id` (motivo sempre; submotivo do contrato @2 só quando informado —
 * vazio mantém o já recebido), transcrição por versão e flag aplicada matricula Workflows
 * por Flag (nova/alterada — inalterada não rematricula).
 * Assim QA Lab, Agents, retrieval de transcrição e gatilhos continuam funcionando sem saber por
 * onde o dado entrou.
 */
type PreparedInteraction = ValidRecord & {
  externalId: string
  operatorId: string
  channel: string
  reason: string
  /** Submotivo (contrato @2); nulo = a fonte não informou nesta carga — mantém o que já existe. */
  subReason: string | null
  startedAt: string
  endedAt: string
  transcript: { content: string; language: string; confidence: number | null } | null
}

export const interactionsWriter: DomainWriter<PreparedInteraction> = {
  contractKey: "INTERACTIONS",
  async prepare(context, records) {
    const { unique, duplicates } = dedupeByKey(records, (record) => String(record.record.externalInteractionId))
    const people = await resolveEmployees(context.ctx.db, context.organizationId, unique.map((record) => str(record.record, "externalEmployeeId")))
    const ready: PreparedInteraction[] = []
    const rejections: Rejection[] = [...duplicates]
    for (const record of unique) {
      const matricula = str(record.record, "externalEmployeeId")!
      const person = people.get(matricula)
      if (!person) {
        rejections.push(reject(record, "DATA_EMPLOYEE_NOT_FOUND", "externalEmployeeId", `Colaborador "${matricula}" não existe na INIA.`))
        continue
      }
      const content = str(record.record, "transcriptContent")
      ready.push({
        ...record,
        externalId: str(record.record, "externalInteractionId")!,
        operatorId: person.id,
        channel: (str(record.record, "channel") ?? "VOICE").toUpperCase(),
        reason: str(record.record, "reason")!,
        subReason: str(record.record, "subReason"),
        startedAt: str(record.record, "startedAt")!,
        endedAt: str(record.record, "endedAt")!,
        transcript: content ? { content, language: str(record.record, "transcriptLanguage") ?? "pt-BR", confidence: num(record.record, "transcriptConfidence") } : null,
      })
    }
    return { ready, rejections }
  },
  async apply(context, client, batch) {
    if (batch.length === 0) return emptyApply()
    const org = context.organizationId
    const result = await client.query<{ id: string; external_id: string; inserted: boolean }>(
      `insert into interactions (organization_id, operator_id, reason, sub_reason, channel, started_at, ended_at, external_id)
       select $1, operator_id, reason, sub_reason, channel, started_at::timestamptz, ended_at::timestamptz, external_id
       from unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) as t(operator_id, reason, sub_reason, channel, started_at, ended_at, external_id)
       on conflict (organization_id, external_id) do update set operator_id = excluded.operator_id, reason = excluded.reason, sub_reason = coalesce(excluded.sub_reason, interactions.sub_reason),
         channel = excluded.channel, started_at = excluded.started_at, ended_at = excluded.ended_at
       where interactions.operator_id is distinct from excluded.operator_id or interactions.reason is distinct from excluded.reason
          or interactions.sub_reason is distinct from coalesce(excluded.sub_reason, interactions.sub_reason) or interactions.channel is distinct from excluded.channel
          or interactions.started_at is distinct from excluded.started_at or interactions.ended_at is distinct from excluded.ended_at
       returning id, external_id, (xmax = 0) inserted`,
      [org, batch.map((r) => r.operatorId), batch.map((r) => r.reason), batch.map((r) => r.subReason), batch.map((r) => r.channel), batch.map((r) => r.startedAt), batch.map((r) => r.endedAt), batch.map((r) => r.externalId)],
    )
    const outcome = withLineage("interactions", batch, (row) => row.externalId, result.rows.map((row) => ({ key: row.external_id, id: row.id, inserted: row.inserted })))
    outcome.businessMaxEventTime = batch.reduce<string | null>((max, row) => (max === null || row.endedAt > max ? row.endedAt : max), null)

    // Transcrição inline: precisa do id da interação (nova ou já existente).
    const withTranscript = batch.filter((row) => row.transcript)
    if (withTranscript.length > 0) {
      const ids = await client.query<{ id: string; external_id: string }>(`select id, external_id from interactions where organization_id = $1 and external_id = any($2::text[])`, [org, withTranscript.map((row) => row.externalId)])
      const idByExternal = new Map(ids.rows.map((row) => [row.external_id, row.id]))
      const rows = withTranscript.map((row) => ({ interactionId: idByExternal.get(row.externalId)!, ...row.transcript! }))
      await client.query(
        `insert into transcripts (organization_id, interaction_id, version, content, language, confidence)
         select $1, interaction_id, 1, content, language, confidence from unnest($2::uuid[], $3::text[], $4::text[], $5::numeric[]) as t(interaction_id, content, language, confidence)
         on conflict (interaction_id, version) do update set content = excluded.content, language = excluded.language, confidence = excluded.confidence
         where transcripts.content is distinct from excluded.content or transcripts.language is distinct from excluded.language or transcripts.confidence is distinct from excluded.confidence`,
        [org, rows.map((r) => r.interactionId), rows.map((r) => r.content), rows.map((r) => r.language), rows.map((r) => r.confidence)],
      )
    }
    return outcome
  },
}

// ---------------------------------------------------------------------------------------------
// TRANSCRIPTS → transcripts
// ---------------------------------------------------------------------------------------------
type PreparedTranscript = ValidRecord & { interactionId: string; operatorId: string; externalInteractionId: string; version: number; content: string; language: string; confidence: number | null }

export const transcriptsWriter: DomainWriter<PreparedTranscript> = {
  contractKey: "TRANSCRIPTS",
  async prepare(context, records) {
    const { unique, duplicates } = dedupeByKey(records, (record) => `${record.record.externalInteractionId}|${record.record.version ?? 1}`)
    const interactions = await resolveInteractions(context.ctx.db, context.organizationId, unique.map((record) => str(record.record, "externalInteractionId")))
    const ready: PreparedTranscript[] = []
    const rejections: Rejection[] = [...duplicates]
    for (const record of unique) {
      const externalId = str(record.record, "externalInteractionId")!
      const interaction = interactions.get(externalId)
      if (!interaction) {
        rejections.push(reject(record, "DATA_INTERACTION_NOT_FOUND", "externalInteractionId", `Interação "${externalId}" não existe na INIA (envie o feed de Interações antes).`))
        continue
      }
      ready.push({ ...record, interactionId: interaction.id, operatorId: interaction.operatorId, externalInteractionId: externalId, version: num(record.record, "version") ?? 1, content: str(record.record, "content")!, language: str(record.record, "language") ?? "pt-BR", confidence: num(record.record, "confidence") })
    }
    return { ready, rejections }
  },
  async apply(context, client, batch) {
    if (batch.length === 0) return emptyApply()
    const result = await client.query<{ id: string; interaction_id: string; version: number; inserted: boolean }>(
      `insert into transcripts (organization_id, interaction_id, version, content, language, confidence)
       select $1, interaction_id, version, content, language, confidence from unnest($2::uuid[], $3::int[], $4::text[], $5::text[], $6::numeric[]) as t(interaction_id, version, content, language, confidence)
       on conflict (interaction_id, version) do update set content = excluded.content, language = excluded.language, confidence = excluded.confidence
       where transcripts.content is distinct from excluded.content or transcripts.language is distinct from excluded.language or transcripts.confidence is distinct from excluded.confidence
       returning id, interaction_id, version, (xmax = 0) inserted`,
      [context.organizationId, batch.map((r) => r.interactionId), batch.map((r) => r.version), batch.map((r) => r.content), batch.map((r) => r.language), batch.map((r) => r.confidence)],
    )
    return withLineage("transcripts", batch, (row) => `${row.interactionId}|${row.version}`, result.rows.map((row) => ({ key: `${row.interaction_id}|${row.version}`, id: row.id, inserted: row.inserted })))
  },
}

// ---------------------------------------------------------------------------------------------
// INTERACTION_FLAGS → interaction_flags (+ matrícula de Workflows por Flag)
// ---------------------------------------------------------------------------------------------
type PreparedFlag = ValidRecord & { interactionId: string; operatorId: string; flag: ChannelFlagRef; value: boolean | number }

export const interactionFlagsWriter: DomainWriter<PreparedFlag> = {
  contractKey: "INTERACTION_FLAGS",
  async prepare(context, records) {
    const { unique, duplicates } = dedupeByKey(records, (record) => `${record.record.externalInteractionId}|${String(record.record.flagName).toLowerCase()}`)
    const interactions = await resolveInteractions(context.ctx.db, context.organizationId, unique.map((record) => str(record.record, "externalInteractionId")))
    const catalog = await resolveChannelFlags(context.ctx.db, context.organizationId, [...interactions.values()].map((interaction) => interaction.channel))
    const ready: PreparedFlag[] = []
    const rejections: Rejection[] = [...duplicates]
    for (const record of unique) {
      const externalId = str(record.record, "externalInteractionId")!
      const interaction = interactions.get(externalId)
      if (!interaction) {
        rejections.push(reject(record, "DATA_INTERACTION_NOT_FOUND", "externalInteractionId", `Interação "${externalId}" não existe na INIA (envie o feed de Interações antes).`))
        continue
      }
      const flagName = str(record.record, "flagName")!.toLowerCase()
      const flag = catalog.get(interaction.channel)?.get(flagName)
      if (!flag) {
        rejections.push(reject(record, "DATA_FLAG_NOT_FOUND", "flagName", `Flag "${flagName}" não está cadastrada (ou ativa) para o canal ${interaction.channel}.`))
        continue
      }
      const raw = String(record.record.value).trim().toLowerCase()
      let value: boolean | number
      if (flag.valueType === "BOOLEAN") {
        if (["true", "1", "sim", "s", "yes"].includes(raw)) value = true
        else if (["false", "0", "nao", "não", "n", "no"].includes(raw)) value = false
        else {
          rejections.push(reject(record, "DATA_TYPE_INVALID", "value", `Flag "${flagName}" espera um valor booleano.`))
          continue
        }
      } else {
        const parsed = Number(raw.replace(",", "."))
        if (!Number.isFinite(parsed)) {
          rejections.push(reject(record, "DATA_TYPE_INVALID", "value", `Flag "${flagName}" espera um valor numérico.`))
          continue
        }
        value = parsed
      }
      ready.push({ ...record, interactionId: interaction.id, operatorId: interaction.operatorId, flag, value })
    }
    return { ready, rejections }
  },
  async apply(context, client, batch) {
    if (batch.length === 0) return emptyApply()
    const result = await client.query<{ id: string; interaction_id: string; channel_flag_id: string; inserted: boolean }>(
      `insert into interaction_flags (organization_id, interaction_id, channel_flag_id, value_boolean, value_numeric)
       select $1, interaction_id, channel_flag_id, value_boolean, value_numeric from unnest($2::uuid[], $3::uuid[], $4::boolean[], $5::numeric[]) as t(interaction_id, channel_flag_id, value_boolean, value_numeric)
       on conflict (interaction_id, channel_flag_id) do update set value_boolean = excluded.value_boolean, value_numeric = excluded.value_numeric, received_at = now()
       where interaction_flags.value_boolean is distinct from excluded.value_boolean or interaction_flags.value_numeric is distinct from excluded.value_numeric
       returning id, interaction_id, channel_flag_id, (xmax = 0) inserted`,
      [context.organizationId, batch.map((r) => r.interactionId), batch.map((r) => r.flag.id), batch.map((r) => (typeof r.value === "boolean" ? r.value : null)), batch.map((r) => (typeof r.value === "number" ? r.value : null))],
    )
    const outcome = withLineage("interaction_flags", batch, (row) => `${row.interactionId}|${row.flag.id}`, result.rows.map((row) => ({ key: `${row.interaction_id}|${row.channel_flag_id}`, id: row.id, inserted: row.inserted })))
    // Flag nova/alterada matricula Workflows por Flag — exatamente como a ingestão em tempo real.
    const touched = new Set(result.rows.map((row) => `${row.interaction_id}|${row.channel_flag_id}`))
    const touchedRows = batch.filter((row) => touched.has(`${row.interactionId}|${row.flag.id}`))
    if (touchedRows.length === 0) return outcome
    // Mesmo filtro das medições: UMA consulta por lote diz quais flags têm Workflow publicado; a matrícula (candidatos,
    // elegibilidade, grafo) só roda para essas. Antes cada flag gravada consultava os candidatos, mesmo sem Workflow nenhum.
    const triggered = await client.query<{ channel_flag_id: string }>(
      `select distinct trigger_config->>'channelFlagId' channel_flag_id from workflows
       where organization_id = $1 and active and active_version_id is not null and trigger_config->>'kind' = 'channel_flag'`,
      [context.organizationId],
    )
    const triggeredFlags = new Set(triggered.rows.map((row) => row.channel_flag_id))
    for (const row of touchedRows) {
      if (!triggeredFlags.has(row.flag.id)) continue
      await enrollFlagWorkflows(client, { organizationId: context.organizationId, interactionId: row.interactionId, operatorId: row.operatorId, channelFlagId: row.flag.id, flagName: row.flag.flagName, value: row.value })
    }
    return outcome
  },
}
