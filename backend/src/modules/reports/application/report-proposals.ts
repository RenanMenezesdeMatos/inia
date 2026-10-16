import type { Database } from "../../../infrastructure/database/pool.js"
import { normalizeForMatch } from "../../leadership-analytics/domain/analytic-rules.js"
import type { QueryTableCard } from "../../leadership-analytics/domain/view-models.js"
import { previousReferencePeriod } from "../../performance-analytics/domain/reference-period.js"
import { definitionSignature, reportDefinitionSchema, reportVisualizationSchema, type ReportDefinition, type ReportVisualization } from "../domain/report-definition.js"
import { suggestVisualization } from "../domain/visualization.js"
import { subjectParts, type RecipientContext } from "./report-runtime.js"

/**
 * PROPOSTA DE REPORT no chat: depois de uma resposta com ferramenta elegível, o que a ferramenta EXECUTOU (argumentos + cartão)
 * vira um rascunho reproduzível — nunca o texto da conversa. "Minha equipe" vira estrutura RELATIVA (de quem recebe); a
 * competência padrão vira "última fechada" (relativa); indicadores são guardados pelo CÓDIGO. Sem insistência: uma oferta a cada
 * 3 respostas, nunca a mesma consulta duas vezes na conversa, nunca se já existe report ativo igual. O "sim" só vale para a
 * proposta da ÚLTIMA resposta da INIA.
 */
export const OFFER_SPACING = 3
export const REPORT_OFFER_LINE = "\n\n_Quer acompanhar esta consulta com frequência? Posso transformá-la num **report recorrente**, entregue no seu Acompanhamento com os dados atualizados. Responda “sim” ou use o botão abaixo._"

export type ProposalDraft = { name: string; description: string | null; definition: ReportDefinition; visualization: ReportVisualization }
export type ProposalRecord = { id: string; organizationId: string; ownerAccountId: string; conversationId: string | null; interactionId: string | null; toolName: string; draft: ProposalDraft; signature: string; status: "OFFERED" | "ACCEPTED" | "DISMISSED" | "EXPIRED"; reportId: string | null; createdAt: string }

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null)
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [])

/** Rascunho a partir de uma chamada de ferramenta do chat (null = não reproduzível como acompanhamento recorrente). */
export function draftFromToolCall(toolName: string, args: Record<string, unknown>, card: QueryTableCard | { type: string; structure?: { subject: unknown; label: string }; title?: string; period?: string | null } | null, context: { ownSubject: unknown | null; lastClosedPeriod: string; indicatorCode: (text: string) => string | null; question: string | null }): ProposalDraft | null {
  if (!card || !card.structure || (card.type !== "QUERY_TABLE" && card.type !== "INDICATOR_ANALYSIS" && card.type !== "PEOPLE")) return null
  const subject = card.structure.subject as Record<string, unknown>
  if (!subject || subject.kind === "EMPLOYEE") return null
  const own = context.ownSubject !== null && JSON.stringify(context.ownSubject) === JSON.stringify(subject)
  const structure = own ? ({ mode: "RECIPIENT" } as const) : ({ mode: "FIXED", ...subjectParts(subject), label: card.structure.label } as const)
  // Indicador pelo CÓDIGO: o que a ferramenta resolveu (o cartão traz o código quando é um só) ou o catálogo pelo texto pedido.
  const cardCode = "indicatorCode" in card && typeof card.indicatorCode === "string" ? card.indicatorCode : null
  const codes = (texts: string[]) => texts.map((text) => (normalizeForMatch(text) === "prv" ? "PRV" : (context.indicatorCode(text) ?? (texts.length === 1 ? cardCode : null)))).filter((code): code is string => code !== null)
  // Competência: a padrão (recente) vira "última fechada" (relativa); outra, explícita, fica fixa.
  const recent = new Set([context.lastClosedPeriod, previousReferencePeriod(context.lastClosedPeriod), previousReferencePeriod(previousReferencePeriod(context.lastClosedPeriod))])
  const requestedMonth = str(args.competencia)
  const months = typeof args.ultimas_competencias === "number" && args.ultimas_competencias > 1 ? Math.min(6, Math.round(args.ultimas_competencias)) : 1
  const closedPeriod = () => (months > 1 ? { mode: "LAST_N_CLOSED" as const, months, display: (["ULTIMA", "MEDIA", "POR_MES", "RECORRENCIA"].includes(String(args.periodos_como)) ? args.periodos_como : "ULTIMA") as "ULTIMA" } : requestedMonth && !recent.has(requestedMonth) ? { mode: "FIXED_MONTH" as const, month: requestedMonth } : { mode: "LAST_CLOSED" as const })

  let candidate: Record<string, unknown> | null = null
  if (toolName === "leadership_indicator_query") {
    const window = str(args.janela)
    if (args.fonte === "OPERACIONAL" && window && !["MES_CORRENTE", "SEMANA_CORRENTE", "ULTIMOS_7_DIAS"].includes(window)) return null
    candidate = {
      tool: "INDICATOR_QUERY",
      structure,
      period: args.fonte === "OPERACIONAL" ? { mode: "CURRENT", window: window ?? "MES_CORRENTE" } : closedPeriod(),
      indicators: codes(strings(args.indicadores)),
      ...(str(args.visao) ? { view: args.visao } : {}),
      ...(str(args.agrupar_por) ? { groupBy: args.agrupar_por } : {}),
      ...(str(args.situacao) ? { situation: args.situacao } : {}),
      ...(strings(args.quartis).length > 0 ? { quartiles: strings(args.quartis) } : {}),
      ...(typeof args.minimo_indicadores_fora === "number" ? { minBelowIndicators: Math.max(1, Math.round(args.minimo_indicadores_fora)) } : {}),
      ...(str(args.ordenar_por) ? { sortBy: args.ordenar_por } : {}),
      ...(str(args.ordem) ? { order: args.ordem } : {}),
      limit: typeof args.limite === "number" ? Math.min(50, Math.max(1, Math.round(args.limite))) : 20,
    }
  } else if (toolName === "leadership_indicator_analysis") {
    const indicator = str(args.indicador)
    if (!indicator) return null
    candidate = { tool: "INDICATOR_QUERY", structure, period: closedPeriod(), indicators: codes([indicator]), groupBy: str(args.agrupar_por) ?? "UNIDADE", limit: 20 }
  } else if (toolName === "leadership_people") {
    const indicator = str(args.indicador)
    if (!indicator) return null
    candidate = { tool: "INDICATOR_QUERY", structure, period: closedPeriod(), indicators: codes([indicator]), groupBy: "PESSOA", ...(args.situacao === "BELOW_REFERENCE" || !args.situacao ? { situation: "FORA" } : args.situacao === "WITHIN_REFERENCE" ? { situation: "DENTRO" } : {}), limit: 20 }
  } else if (toolName === "leadership_workforce") {
    candidate = { tool: "WORKFORCE", structure, period: { mode: "TODAY" }, ...(str(args.agrupar_por) ? { groupBy: args.agrupar_por } : {}), ...(strings(args.situacoes).length > 0 ? { statuses: strings(args.situacoes) } : {}), ...(args.listar_pessoas === true ? { listPeople: true } : {}), ...(args.incluir_lideres === true ? { includeLeaders: true } : {}), limit: typeof args.limite === "number" ? Math.min(50, Math.max(1, Math.round(args.limite))) : 20 }
  } else if (toolName === "leadership_indicator_diagnosis") {
    const indicator = str(args.indicador)
    if (!indicator) return null
    const period = closedPeriod()
    candidate = { tool: "INDICATOR_DIAGNOSIS", structure, period: period.mode === "LAST_N_CLOSED" ? { mode: "LAST_CLOSED" } : period, indicators: codes([indicator]), ...(str(args.comparar) ? { compare: args.comparar } : {}), ...(str(args.nivel) ? { level: args.nivel } : {}), ...(typeof args.meses_de_interacoes === "number" ? { interactionMonths: Math.min(6, Math.max(1, Math.round(args.meses_de_interacoes))) } : {}) }
  } else {
    return null
  }
  const parsed = reportDefinitionSchema.safeParse(candidate)
  if (!parsed.success) return null
  if (parsed.data.tool !== "WORKFORCE" && parsed.data.indicators.length === 0 && strings(args.indicadores).length > 0) return null
  const visualization = card.type === "QUERY_TABLE" ? suggestVisualization(card as QueryTableCard) : reportVisualizationSchema.parse({ type: "TABLE" })
  return { name: (card.title ?? "Report").slice(0, 120), description: context.question ? context.question.slice(0, 500) : null, definition: parsed.data, visualization }
}

const AFFIRMATIVE = /^(sim|s|isso|claro|pode|ok|okay|beleza|bora|vamos|quero|fechado|por favor|crie|cria|criar|perfeito|aceito)\b/
const NEGATIVE = /^(nao|n|agora nao|deixa|dispensa|sem report|nao precisa|nao quero|nao obrigad)\b/

/** "sim, cria o report" × "não precisa" × outra coisa. Só respostas curtas (uma pergunta nova nunca vira aceite). */
export function classifyReply(text: string): "ACCEPT" | "DISMISS" | null {
  const normalized = normalizeForMatch(text).replace(/[!.,?]+/g, " ").replace(/\s+/g, " ").trim()
  if (!normalized || normalized.length > 60) return null
  if (NEGATIVE.test(normalized)) return "DISMISS"
  if (AFFIRMATIVE.test(normalized) && !/\?$/.test(text.trim())) return "ACCEPT"
  return null
}

type ProposalRow = { id: string; organization_id: string; owner_account_id: string; conversation_id: string | null; interaction_id: string | null; tool_name: string; draft: ProposalDraft; signature: string; status: ProposalRecord["status"]; report_id: string | null; created_at: Date }
const toProposal = (row: ProposalRow): ProposalRecord => ({ id: row.id, organizationId: row.organization_id, ownerAccountId: row.owner_account_id, conversationId: row.conversation_id, interactionId: row.interaction_id, toolName: row.tool_name, draft: row.draft, signature: row.signature, status: row.status, reportId: row.report_id, createdAt: row.created_at.toISOString() })
const PROPOSAL_COLUMNS = "id, organization_id, owner_account_id, conversation_id, interaction_id, tool_name, draft, signature, status, report_id, created_at"

export type ProposalStore = {
  /** Oferta para a última resposta, se couber (elegível, espaçada, inédita na conversa e sem report ativo igual). */
  prepareOffer(input: { organizationId: string; accountId: string; personId: string; conversationId: string; directResults: { toolName: string; args: Record<string, unknown>; card: unknown | null }[]; question: string | null; context: RecipientContext | null; activeSignatures: () => Promise<Set<string>> }): Promise<ProposalRecord | null>
  attach(proposalId: string, interactionId: string): Promise<void>
  /** A proposta OFERECIDA na última resposta da INIA desta conversa (o "sim" só vale para ela). */
  pendingForConversation(organizationId: string, accountId: string, conversationId: string): Promise<ProposalRecord | null>
  decide(proposalId: string, status: "ACCEPTED" | "DISMISSED" | "EXPIRED", reportId?: string | null): Promise<void>
  get(organizationId: string, accountId: string, proposalId: string): Promise<ProposalRecord | null>
  forInteractions(organizationId: string, interactionIds: string[]): Promise<Map<string, ProposalRecord>>
}

export function createPostgresProposalStore(db: Database): ProposalStore {
  return {
    async prepareOffer(input) {
      if (!input.context) return null
      const eligible = [...input.directResults].reverse().find((result) => result.card && ["leadership_indicator_query", "leadership_indicator_analysis", "leadership_people", "leadership_workforce", "leadership_indicator_diagnosis"].includes(result.toolName))
      if (!eligible) return null
      const options = await input.context.indicatorOptions()
      const draft = draftFromToolCall(eligible.toolName, eligible.args, eligible.card as QueryTableCard, {
        ownSubject: input.context.ownStructure?.subject ?? null,
        lastClosedPeriod: input.context.lastClosedPeriod,
        question: input.question,
        indicatorCode: (text) => {
          const exact = options.find((option) => option.code.toUpperCase() === text.toUpperCase() || normalizeForMatch(option.name) === normalizeForMatch(text))
          if (exact) return exact.code
          const partial = options.filter((option) => normalizeForMatch(option.name).includes(normalizeForMatch(text)))
          return partial.length === 1 ? partial[0]!.code : null
        },
      })
      if (!draft) return null
      const signature = definitionSignature(draft.definition)
      const recent = await db.query<{ signature: string; created_at: Date }>(`select signature, created_at from report_proposals where conversation_id = $1 order by created_at desc limit 50`, [input.conversationId])
      if (recent.rows.some((row) => row.signature === signature)) return null
      const last = recent.rows[0]
      if (last) {
        const since = await db.query<{ count: string }>(`select count(*)::text count from assistant_interactions where conversation_id = $1 and role = 'assistant' and occurred_at > $2`, [input.conversationId, last.created_at])
        if (Number(since.rows[0]?.count ?? 0) < OFFER_SPACING) return null
      }
      if ((await input.activeSignatures()).has(signature)) return null
      const result = await db.query<ProposalRow>(
        `insert into report_proposals (organization_id, owner_account_id, owner_person_id, conversation_id, tool_name, tool_args, draft, signature, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'OFFERED') returning ${PROPOSAL_COLUMNS}`,
        [input.organizationId, input.accountId, input.personId, input.conversationId, eligible.toolName, JSON.stringify(eligible.args), JSON.stringify(draft), signature],
      )
      return toProposal(result.rows[0]!)
    },
    async attach(proposalId, interactionId) {
      await db.query(`update report_proposals set interaction_id = $2 where id = $1`, [proposalId, interactionId])
    },
    async pendingForConversation(organizationId, accountId, conversationId) {
      const result = await db.query<ProposalRow & { is_last: boolean }>(
        `select ${PROPOSAL_COLUMNS.split(", ").map((column) => `p.${column}`).join(", ")},
                p.interaction_id = (select id from assistant_interactions where conversation_id = $3 and role = 'assistant' order by occurred_at desc limit 1) is_last
           from report_proposals p
          where p.organization_id = $1 and p.owner_account_id = $2 and p.conversation_id = $3 and p.status = 'OFFERED'
          order by p.created_at desc limit 1`,
        [organizationId, accountId, conversationId],
      )
      const row = result.rows[0]
      return row && row.is_last ? toProposal(row) : null
    },
    async decide(proposalId, status, reportId = null) {
      await db.query(`update report_proposals set status = $2, report_id = coalesce($3, report_id), decided_at = now() where id = $1 and status in ('OFFERED', 'ACCEPTED')`, [proposalId, status, reportId])
    },
    async get(organizationId, accountId, proposalId) {
      const result = await db.query<ProposalRow>(`select ${PROPOSAL_COLUMNS} from report_proposals where id = $1 and organization_id = $2 and owner_account_id = $3`, [proposalId, organizationId, accountId])
      return result.rows[0] ? toProposal(result.rows[0]) : null
    },
    async forInteractions(organizationId, interactionIds) {
      if (interactionIds.length === 0) return new Map()
      const result = await db.query<ProposalRow>(`select ${PROPOSAL_COLUMNS} from report_proposals where organization_id = $1 and interaction_id = any($2::uuid[])`, [organizationId, interactionIds])
      return new Map(result.rows.map((row) => [row.interaction_id!, toProposal(row)]))
    },
  }
}
