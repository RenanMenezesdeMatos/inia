import type { Database } from "../../../infrastructure/database/pool.js"
import type { FunctionDeclaration } from "../../assistant/infrastructure/gemini-function-calling-client.js"
import { alignmentReferenceOf, audienceReasonOf, periodLabelOf } from "../domain/operational-alignment.js"
import { loadAlignmentSubject } from "../infrastructure/operational-alignment-loaders.js"

type Queryable = Pick<Database, "query">

/**
 * HISTÓRICO DE ALINHAMENTOS (decisão do usuário, 17/11/2026): quando a pessoa pergunta por alinhamentos ANTERIORES, a INIA consulta
 * esta ferramenta e responde como REGISTRO — nunca como orientação atual. Entram só os que já NÃO valem (expiraram, foram encerrados
 * antes ou substituídos por outra versão) nos últimos 12 meses, do público da pessoa (universo e Grupo/Subgrupo de hoje). Excluídos
 * NUNCA entram (excluir = "não deveria ter existido"). Os que valem hoje já estão nas instruções e não aparecem aqui.
 */
export const ALIGNMENT_HISTORY_TOOL = "alinhamentos_anteriores"
export const ALIGNMENT_HISTORY_MONTHS = 12
export const ALIGNMENT_HISTORY_LIMIT = 20

export const ALIGNMENT_HISTORY_DECLARATION: FunctionDeclaration = {
  name: ALIGNMENT_HISTORY_TOOL,
  description:
    "Histórico de alinhamentos operacionais que JÁ NÃO VALEM (expirados, encerrados antes do prazo ou substituídos) nos últimos 12 meses, do público da própria pessoa. Use SOMENTE quando a pessoa perguntar por alinhamentos anteriores/antigos ou pelo que valia antes (\"teve algum alinhamento sobre…?\", \"o que dizia aquele alinhamento de…?\"). O resultado é registro histórico: nunca é orientação atual.",
  parameters: { type: "object", properties: {}, required: [] },
}

export const ALIGNMENT_HISTORY_RULE = [
  "[Alinhamentos operacionais — regra do sistema]",
  "- Só vale como orientação atual o alinhamento operacional que estiver nas instruções DESTA resposta. Se uma mensagem anterior desta conversa citou um alinhamento que não está nas instruções agora, ele NÃO vale mais: oriente pela base oficial e diga que aquela orientação temporária não está mais em vigor.",
  `- Pergunta sobre alinhamentos anteriores: acione ${ALIGNMENT_HISTORY_TOOL} e responda como histórico ("houve um alinhamento operacional (referência), válido de … a …, que orientava: …"), sempre dizendo que não vale mais e o que vale hoje pela base oficial. Nunca oriente a pessoa a seguir um alinhamento do histórico.`,
].join("\n")

type HistoryRow = {
  alignment_id: string
  version: number
  title: string
  guidance: string
  affected_topic: string | null
  operating_universe: string
  scope_type: "UNIVERSE" | "TEAM" | "SUBTEAM"
  team_id: string | null
  subteam_id: string | null
  product_name: string | null
  starts_on: string
  ends_on: string
  time_zone: string
  effective_until: Date
  status: string
  ended_at: Date | null
  end_reason: string | null
  superseded_by_version: number | null
  processes: string[] | null
}

export async function loadAlignmentHistory(db: Queryable, input: { organizationId: string; personId: string; now?: Date }) {
  const now = input.now ?? new Date()
  const subject = await loadAlignmentSubject(db, input.organizationId, input.personId, now)
  if (!subject) return []
  const rows = (await db.query<HistoryRow>(
    `select v.alignment_id, v.version, v.title, v.guidance, v.affected_topic, v.operating_universe, v.scope_type, v.team_id, v.subteam_id, pn.name product_name,
            v.starts_on::text starts_on, v.ends_on::text ends_on, v.time_zone, v.effective_until, v.status, v.ended_at, v.end_reason,
            (select n.version from operational_alignment_versions n where n.id = v.superseded_by_version_id) superseded_by_version,
            (select array_agg(kd.title order by kd.title) from operational_alignment_version_documents vd join knowledge_documents kd on kd.id = vd.document_id where vd.version_id = v.id) processes
     from operational_alignment_versions v
     join operational_alignments a on a.id = v.alignment_id and a.deleted_at is null
     left join product_catalog_nodes_all pn on pn.id = v.product_id
     where v.organization_id = $1 and v.status in ('PUBLISHED', 'SUPERSEDED')
       and v.effective_until > v.effective_from and v.effective_until <= $2 and v.effective_until > $2 - make_interval(months => $3)
     order by v.effective_until desc
     limit 200`,
    [input.organizationId, now, ALIGNMENT_HISTORY_MONTHS],
  )).rows
  return rows
    .filter((row) => audienceReasonOf({ operatingUniverse: row.operating_universe as never, scopeType: row.scope_type, teamId: row.team_id, subteamId: row.subteam_id }, subject) === null)
    .slice(0, ALIGNMENT_HISTORY_LIMIT)
    .map((row) => ({
      reference: alignmentReferenceOf(row.alignment_id, row.version),
      title: row.title,
      guidance: row.guidance,
      affectedTopic: row.affected_topic,
      processes: row.processes ?? [],
      productName: row.product_name,
      period: periodLabelOf({ startsOn: row.starts_on, endsOn: row.ends_on, endedEarlyAt: row.ended_at, timeZone: row.time_zone }),
      noLongerValidSince: new Intl.DateTimeFormat("pt-BR", { timeZone: row.time_zone, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(row.effective_until)),
      why: row.status === "SUPERSEDED" ? `substituído pela versão ${row.superseded_by_version ?? "seguinte"}` : row.ended_at ? `encerrado antes do prazo${row.end_reason ? ` (${row.end_reason})` : ""}` : "chegou ao fim da vigência",
    }))
}

/** Texto para o modelo: cabeçalho que proíbe usar como orientação atual + um item por alinhamento. */
export async function executeAlignmentHistory(db: Queryable, input: { organizationId: string; personId: string; now?: Date }): Promise<{ text: string; card: null }> {
  const history = await loadAlignmentHistory(db, input)
  if (history.length === 0) return { text: "[Histórico de alinhamentos operacionais] Nenhum alinhamento operacional deixou de valer para o público desta pessoa nos últimos 12 meses. Diga isso; a orientação atual é a das bases oficiais (e dos alinhamentos que estiverem nas instruções).", card: null }
  const lines = history.map((entry) => [
    `- ${entry.reference} · "${entry.title}" — valeu ${entry.period}; não vale mais desde ${entry.noLongerValidSince} (${entry.why}).`,
    `  Processos: ${entry.processes.join(", ") || "—"}${entry.affectedTopic ? ` · trecho que mudava: ${entry.affectedTopic}` : ""}${entry.productName ? ` · produto: ${entry.productName}` : ""}`,
    `  Orientação que valia: ${entry.guidance.trim()}`,
  ].join("\n"))
  return { text: ["[Histórico de alinhamentos operacionais — REGISTRO: nenhum destes vale mais; nunca oriente por eles]", ...lines].join("\n"), card: null }
}
