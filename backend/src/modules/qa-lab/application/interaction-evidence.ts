import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { loadLatestTranscript, transcriptChecksum } from "../../workflows/application/transcript.js"
import { isOperatorEligibleForWorkflow, resolveEligibleOperatorIds as resolveEligibleOperatorIdsShared, type WorkflowPopulation } from "../../workflows/application/workflow-eligibility.js"
import type { FlowGraph } from "../../workflows/domain/graph-schema.js"
import { triggerConfigSchema } from "../../workflows/domain/trigger-config-schema.js"
import { comparatorSchema } from "../../workflows/domain/graph-schema.js"
import type { QaWorkflowRow } from "./build-simulated-enrollment.js"
import { findInteractions } from "./test-data-finders.js"


/**
 * Massa de teste de um Workflow disparado por Flag de canal: UMA interação real, escolhida
 * explicitamente pelo administrador global. Este módulo concentra as três coisas que QA e
 * produção precisam concordar sobre uma interação: quem é elegível (Abrangência + Filtro
 * Populacional), se a interação pode disparar o gatilho (canal + flag) e qual evidência foi
 * usada (identidade + checksum da transcrição) — o evento em si continua sendo montado por
 * `buildSimulatedEnrollment` no MESMO formato que a ingestão grava em `workflow_enrollments`.
 */

/** Identidade e "impressão digital" da evidência de um QA Run — persistida no run (nunca a
 * transcrição inteira aqui: ela já vive em session.inputContext, que é o que a engine recebe). */
export type InteractionEvidence = {
  interactionId: string
  externalId: string
  operatorId: string
  operatorName: string
  teamId: string | null
  teamName: string | null
  channel: string
  reason: string
  /** Submotivo como a fonte cadastrou; null = não informado. */
  subReason: string | null
  startedAt: string
  endedAt: string
  durationSeconds: number
  /** null = gatilho Manual com interação: nenhuma flag disparou (a interação foi escolhida por quem executou). */
  flag: { channelFlagId: string; name: string; valueType: string; value: boolean | number | null } | null
  transcript: {
    available: boolean
    version: number | null
    /** sha256 curto do conteúdo — a ingestão faz upsert na mesma versão, então só o checksum
     * diz se o texto mudou desde o QA Run (Parte 43). */
    checksum: string | null
    length: number
    language: string | null
    confidence: number | null
  }
}

type ChannelFlagRow = { id: string; channel: string; flag_name: string; value_type: string }

/** Só o que a elegibilidade precisa ler do Workflow (linha atual ou reconstruída do snapshot). */
export type QaWorkflowRowForEligibility = Pick<QaWorkflowRow, "scope_type" | "team_id" | "subteam_id" | "population_filter">

function populationOf(row: QaWorkflowRowForEligibility): WorkflowPopulation {
  return { scopeType: row.scope_type, teamId: row.team_id, subteamId: row.subteam_id, populationFilter: row.population_filter }
}

async function loadChannelFlag(db: Database, organizationId: string, channelFlagId: string): Promise<ChannelFlagRow | null> {
  const result = await db.query<ChannelFlagRow>(`select id, channel, flag_name, value_type from channel_flags where id = $1 and organization_id = $2`, [channelFlagId, organizationId])
  return result.rows[0] ?? null
}

export function flagLabel(flag: { channel: string; flag_name: string }): string {
  return `${flag.channel}.${flag.flag_name}`
}

/** Operadores elegíveis pra este Workflow — a MESMA regra (Abrangência + Filtro Populacional)
 * da ingestão por Flag e do checador de agenda (workflow-eligibility.ts). */
export async function resolveEligibleOperatorIds(db: Database, organizationId: string, row: QaWorkflowRowForEligibility): Promise<string[]> {
  return resolveEligibleOperatorIdsShared(db, organizationId, populationOf(row))
}

export async function assertOperatorEligible(db: Database, organizationId: string, row: QaWorkflowRowForEligibility, operatorId: string): Promise<void> {
  // Decisão pontual — exatamente a função que a ingestão produtiva usa por interação.
  if (!(await isOperatorEligibleForWorkflow(db, organizationId, populationOf(row), operatorId))) {
    throw new DomainError("O colaborador não pertence à população deste Workflow (Abrangência/Filtro Populacional).", "QA_OPERATOR_OUT_OF_POPULATION", 422)
  }
}

/** Gatilhos cuja execução carrega UMA interação: Flag de canal (a flag disparou) ou Manual com interação (alguém escolheu). */
function requireInteractionTrigger(row: QaWorkflowRow): { kind: "channel_flag"; channelFlagId: string } | { kind: "manual" } {
  const trigger = triggerConfigSchema.parse(row.trigger_config)
  if (trigger.kind === "channel_flag") return trigger
  if (trigger.kind === "manual" && trigger.context === "INTERACTION") return { kind: "manual" }
  throw new DomainError("Este workflow não parte de uma interação (Flag de canal ou Manual com interação) — a massa de teste por interação não se aplica.", "QA_TRIGGER_NOT_FLAG", 422)
}

/** Manual com interação: qualquer interação REAL do colaborador com transcrição (a mesma lista do "Executar agora"). */
async function findManualInteractions(db: Database, organizationId: string, input: FindCompatibleInteractionsInput) {
  const result = await db.query<{ id: string; external_id: string; reason: string; sub_reason: string | null; channel: string; started_at: string; ended_at: string; operator_id: string; operator_name: string; team_name: string | null }>(
    `select i.id, i.external_id, i.reason, i.sub_reason, i.channel, i.started_at, i.ended_at, i.operator_id, p.name operator_name, t.name team_name
       from interactions i join people p on p.id = i.operator_id left join teams t on t.id = p.team_id
      where i.organization_id = $1 and i.operator_id = $2
        and exists (select 1 from transcripts tr where tr.interaction_id = i.id)
        and ($3::timestamptz is null or i.started_at >= $3) and ($4::timestamptz is null or i.started_at < $4)
        and ($5::text is null or i.external_id ilike $5)
      order by i.started_at desc
      limit $6 offset $7`,
    [organizationId, input.operatorId, input.from ?? null, input.to ?? null, input.search ? `%${input.search}%` : null, input.limit + 1, input.offset],
  )
  return result.rows.map((row) => ({
    id: row.id,
    externalId: row.external_id,
    reason: row.reason,
    subReason: row.sub_reason,
    channel: row.channel,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: durationSeconds(row.started_at, row.ended_at),
    operatorId: row.operator_id,
    operatorName: row.operator_name,
    teamName: row.team_name,
    flagName: null,
    value: null,
    hasTranscript: true,
  }))
}

// ---------------------------------------------------------------------------------------------
// Busca de interações compatíveis (colaborador-first)
// ---------------------------------------------------------------------------------------------

const booleanParam = z.union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")])

export const findCompatibleInteractionsSchema = z.object({
  operatorId: z.string().uuid(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  /** Busca por identificador externo/protocolo (único campo de identificação persistido). */
  search: z.string().trim().max(120).optional(),
  // Cenário "Atende / Não atende" da Condition sobre o valor do gatilho (mesmo comparatorMatches
  // do motor, aplicado em findInteractions).
  comparator: comparatorSchema.optional(),
  thresholdNumeric: z.coerce.number().optional(),
  thresholdBoolean: booleanParam.optional(),
  negate: booleanParam.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})
export type FindCompatibleInteractionsInput = z.infer<typeof findCompatibleInteractionsSchema>

/**
 * Só interações que REALMENTE poderiam disparar este Workflow: colaborador elegível
 * (Abrangência + Filtro Populacional), flag do gatilho presente, canal da flag, período. Reusa
 * `findInteractions` (a única busca de interações do QA Lab) — nunca uma segunda consulta.
 * Paginação por offset (`hasMore`), mais recentes primeiro. Zero IA, só leitura.
 */
export async function findCompatibleInteractions(db: Database, organizationId: string, row: QaWorkflowRow, input: FindCompatibleInteractionsInput) {
  const trigger = requireInteractionTrigger(row)
  if (trigger.kind === "manual") {
    await assertOperatorEligible(db, organizationId, row, input.operatorId)
    const rows = await findManualInteractions(db, organizationId, input)
    return { flag: null, rows: rows.slice(0, input.limit), hasMore: rows.length > input.limit }
  }
  const flag = await loadChannelFlag(db, organizationId, trigger.channelFlagId)
  if (!flag) throw new DomainError("A flag configurada no gatilho não existe mais no catálogo.", "QA_FLAG_NOT_FOUND", 422)
  await assertOperatorEligible(db, organizationId, row, input.operatorId)
  const rows = await findInteractions(db, organizationId, {
    channelFlagId: flag.id,
    operatorId: input.operatorId,
    ...(input.from ? { from: input.from } : {}),
    ...(input.to ? { to: input.to } : {}),
    ...(input.search ? { search: input.search } : {}),
    ...(input.comparator ? { comparator: input.comparator } : {}),
    ...(input.thresholdNumeric !== undefined ? { thresholdNumeric: input.thresholdNumeric } : {}),
    ...(input.thresholdBoolean !== undefined ? { thresholdBoolean: input.thresholdBoolean } : {}),
    ...(input.negate !== undefined ? { negate: input.negate } : {}),
    limit: input.limit + 1,
    offset: input.offset,
  })
  return {
    flag: { channelFlagId: flag.id, channel: flag.channel, name: flag.flag_name, valueType: flag.value_type, label: flagLabel(flag) },
    rows: rows.slice(0, input.limit),
    hasMore: rows.length > input.limit,
  }
}

// ---------------------------------------------------------------------------------------------
// Detalhe da interação (metadados + flags + transcrição) — só leitura, nunca IA
// ---------------------------------------------------------------------------------------------

type InteractionRow = {
  id: string
  external_id: string
  operator_id: string
  operator_name: string
  team_id: string | null
  team_name: string | null
  channel: string
  reason: string
  sub_reason: string | null
  started_at: string
  ended_at: string
}

async function loadInteraction(db: Database, organizationId: string, interactionId: string): Promise<InteractionRow | null> {
  const result = await db.query<InteractionRow>(
    `select i.id, i.external_id, i.operator_id, p.name operator_name, p.team_id, t.name team_name, i.channel, i.reason, i.sub_reason, i.started_at, i.ended_at
     from interactions i join people p on p.id = i.operator_id left join teams t on t.id = p.team_id
     where i.id = $1 and i.organization_id = $2`,
    [interactionId, organizationId],
  )
  return result.rows[0] ?? null
}

function durationSeconds(startedAt: string, endedAt: string): number {
  return Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000))
}

export type InteractionDetail = {
  id: string
  externalId: string
  operatorId: string
  operatorName: string
  teamName: string | null
  channel: string
  reason: string
  subReason: string | null
  startedAt: string
  endedAt: string
  durationSeconds: number
  flags: { channelFlagId: string; name: string; valueType: string; value: boolean | number | null; receivedAt: string }[]
  /** Transcrição como está persistida — texto puro. Não existe speaker/timestamp estruturado
   * na base (transcripts.content é `text`); a UI não inventa essa estrutura. */
  transcript: { content: string; version: number; language: string; confidence: number | null; checksum: string } | null
}

export async function getInteractionDetail(db: Database, organizationId: string, interactionId: string): Promise<InteractionDetail | null> {
  const row = await loadInteraction(db, organizationId, interactionId)
  if (!row) return null
  const flags = await db.query<{ channel_flag_id: string; flag_name: string; value_type: string; value_boolean: boolean | null; value_numeric: string | null; received_at: string }>(
    `select f.channel_flag_id, cf.flag_name, cf.value_type, f.value_boolean, f.value_numeric, f.received_at
     from interaction_flags f join channel_flags cf on cf.id = f.channel_flag_id
     where f.interaction_id = $1 order by cf.flag_name`,
    [row.id],
  )
  const transcript = await loadLatestTranscript(db, row.id)
  return {
    id: row.id,
    externalId: row.external_id,
    operatorId: row.operator_id,
    operatorName: row.operator_name,
    teamName: row.team_name,
    channel: row.channel,
    reason: row.reason,
    subReason: row.sub_reason,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: durationSeconds(row.started_at, row.ended_at),
    flags: flags.rows.map((flag) => ({
      channelFlagId: flag.channel_flag_id,
      name: flag.flag_name,
      valueType: flag.value_type,
      value: flag.value_boolean ?? (flag.value_numeric !== null ? Number(flag.value_numeric) : null),
      receivedAt: flag.received_at,
    })),
    transcript: transcript ? { ...transcript, checksum: transcriptChecksum(transcript.content) } : null,
  }
}

// ---------------------------------------------------------------------------------------------
// Validação de compatibilidade + evidência congelada (usada pela execução)
// ---------------------------------------------------------------------------------------------

export type ResolvedInteractionEvidence = {
  evidence: InteractionEvidence
  /** Texto que vira `inputContext` da engine — a transcrição vigente, ou a congelada no QA Run
   * original quando é uma reexecução e o texto mudou desde então. */
  inputContext: string
  /** Só em reexecução: a transcrição persistida difere da usada no QA Run original. */
  transcriptChangedSinceOriginalRun: boolean
  matched: { flagName: string | null; valueBoolean: boolean | null; valueNumeric: string | null }
}

/**
 * O backend nunca confia na lista do frontend (Parte 22): antes de executar, confirma que a
 * interação existe, é do canal da flag, possui a flag do gatilho e que o operador dela pertence
 * à população do Workflow. Erros são específicos (nunca "erro inesperado"). `frozen` é a
 * evidência do QA Run original numa reexecução — a interação precisa continuar existindo (nunca
 * inventa outra); a transcrição usada é a congelada, e a divergência fica registrada.
 */
export async function resolveInteractionEvidence(
  db: Database,
  organizationId: string,
  row: QaWorkflowRow,
  interactionId: string,
  frozen?: { evidence: InteractionEvidence; inputContext: string } | undefined,
): Promise<ResolvedInteractionEvidence> {
  const trigger = requireInteractionTrigger(row)
  const call = await loadInteraction(db, organizationId, interactionId)
  if (!call) {
    if (frozen) throw new DomainError("A interação original deste QA Run não está mais disponível.", "QA_INTERACTION_UNAVAILABLE", 422)
    throw new DomainError("Interação não encontrada.", "QA_INTERACTION_NOT_FOUND", 404)
  }
  // Manual com interação: nenhuma flag disparou — só colaborador elegível (a mesma regra do "Executar agora").
  let flag: ChannelFlagRow | null = null
  let matched: { value_boolean: boolean | null; value_numeric: string | null } | null = null
  if (trigger.kind === "channel_flag") {
    flag = await loadChannelFlag(db, organizationId, trigger.channelFlagId)
    if (!flag) throw new DomainError("A flag configurada no gatilho não existe mais no catálogo.", "QA_FLAG_NOT_FOUND", 422)
    if (call.channel !== flag.channel) {
      throw new DomainError(`Esta interação é do canal ${call.channel}, mas o gatilho exige a Flag ${flagLabel(flag)} (canal ${flag.channel}).`, "QA_CHANNEL_MISMATCH", 422)
    }
    const flagValue = await db.query<{ value_boolean: boolean | null; value_numeric: string | null }>(
      `select f.value_boolean, f.value_numeric from interaction_flags f where f.interaction_id = $1 and f.channel_flag_id = $2`,
      [call.id, flag.id],
    )
    matched = flagValue.rows[0] ?? null
    if (!matched) {
      throw new DomainError(`Esta interação não possui a Flag ${flagLabel(flag)} exigida pelo gatilho.`, "QA_FLAG_MISSING_ON_INTERACTION", 422)
    }
  }
  await assertOperatorEligible(db, organizationId, row, call.operator_id)

  const current = await loadLatestTranscript(db, call.id)
  const currentChecksum = current ? transcriptChecksum(current.content) : null
  const useFrozen = Boolean(frozen && frozen.evidence.transcript.available && frozen.evidence.transcript.checksum !== currentChecksum)
  const transcriptText = useFrozen ? frozen!.inputContext : (current?.content ?? "")
  const transcriptMeta: InteractionEvidence["transcript"] = useFrozen
    ? frozen!.evidence.transcript
    : {
        available: Boolean(current),
        version: current?.version ?? null,
        checksum: currentChecksum,
        length: current?.content.length ?? 0,
        language: current?.language ?? null,
        confidence: current?.confidence ?? null,
      }
  return {
    evidence: {
      interactionId: call.id,
      externalId: call.external_id,
      operatorId: call.operator_id,
      operatorName: call.operator_name,
      teamId: call.team_id,
      teamName: call.team_name,
      channel: call.channel,
      reason: call.reason,
      subReason: call.sub_reason,
      startedAt: call.started_at,
      endedAt: call.ended_at,
      durationSeconds: durationSeconds(call.started_at, call.ended_at),
      flag: flag && matched ? { channelFlagId: flag.id, name: flag.flag_name, valueType: flag.value_type, value: matched.value_boolean ?? (matched.value_numeric !== null ? Number(matched.value_numeric) : null) } : null,
      transcript: transcriptMeta,
    },
    inputContext: transcriptText,
    transcriptChangedSinceOriginalRun: useFrozen,
    matched: { flagName: flag?.flag_name ?? null, valueBoolean: matched?.value_boolean ?? null, valueNumeric: matched?.value_numeric ?? null },
  }
}

/** O grafo tem alguma etapa que envia a transcrição pra IA (Action "Chamar Agent" ou node
 * Orchestrator)? Usado pra avisar cedo — sem transcrição, essa request seria inútil. */
export function graphNeedsTranscript(graph: FlowGraph): boolean {
  return graph.nodes.some((node) => node.type === "orchestrator" || (node.type === "action" && node.config.actionType === "CALL_AGENT"))
}
