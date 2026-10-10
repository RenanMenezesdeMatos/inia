import type { Database } from "../../../infrastructure/database/pool.js"
import { argumentScriptSourceOf, criterionItemsOf, readStoredContent, scopeAppliesTo, type ArgumentScriptSource, type ScriptScope } from "../domain/argument-script.js"

type Queryable = Pick<Database, "query">

type SourceRow = {
  script_id: string
  name: string
  area_name: string | null
  scope_type: ScriptScope["scopeType"]
  team_id: string | null
  team_name: string | null
  subteam_id: string | null
  subteam_name: string | null
  subject_name: string | null
  conversion: "NATIVE" | "LEGACY_UNSTRUCTURED"
  version_id: string
  version: number
  content: unknown
  content_hash: string
  effective_from: Date
  effective_until: Date | null
  source_document_id: string | null
  source_document_title: string | null
  source_reference: string | null
  previous_content: unknown | null
}

const SELECT_IN_FORCE = `
  select s.id script_id, s.name, bd.name area_name, s.scope_type, s.team_id, t.name team_name, s.subteam_id, st.name subteam_name, sub.name subject_name, s.conversion,
         v.id version_id, v.version, v.content, v.content_hash, v.effective_from, v.effective_until, v.source_document_id, kd.title source_document_title, v.source_reference,
         prev.content previous_content
  from argument_scripts s
  join argument_script_versions v on v.script_id = s.id and v.status in ('PUBLISHED', 'SUPERSEDED') and v.effective_from <= $2 and (v.effective_until is null or v.effective_until > $2)
  left join business_domains bd on bd.id = s.business_domain_id
  left join teams t on t.id = s.team_id
  left join subteams st on st.id = s.subteam_id
  left join subjects sub on sub.id = s.subject_id
  left join knowledge_documents kd on kd.id = v.source_document_id and kd.deleted_at is null
  left join lateral (select p.content from argument_script_versions p where p.script_id = s.id and p.version < v.version and p.status in ('PUBLISHED', 'SUPERSEDED') order by p.version desc limit 1) prev on true
  where s.organization_id = $1`

const toSource = (row: SourceRow): ArgumentScriptSource =>
  argumentScriptSourceOf(
    {
      scriptId: row.script_id,
      versionId: row.version_id,
      version: row.version,
      name: row.name,
      areaName: row.area_name,
      scope: { scopeType: row.scope_type, teamId: row.team_id, subteamId: row.subteam_id, teamName: row.team_name, subteamName: row.subteam_name },
      subjectName: row.subject_name,
      conversion: row.conversion,
      content: readStoredContent(row.content),
      contentHash: row.content_hash,
      effectiveFrom: new Date(row.effective_from),
      effectiveUntil: row.effective_until ? new Date(row.effective_until) : null,
      sourceDocumentId: row.source_document_id,
      sourceDocumentTitle: row.source_document_title,
      sourceReference: row.source_reference,
    },
    row.previous_content ? readStoredContent(row.previous_content) : null,
  )

/**
 * Argumentários que valem para ESTA chamada: versão publicada VIGENTE NA DATA DA CHAMADA (nunca uma publicada depois — regra nova
 * nunca é obrigação histórica) e escopo que cobre o Grupo/Subgrupo do colaborador. Argumentário encerrado depois da chamada
 * continua valendo para ela (a vigência guarda a história). A área responsável é dono do conteúdo, não filtro.
 */
export async function loadArgumentScriptsInForce(db: Queryable, organizationId: string, person: { teamId: string | null; subteamId: string | null }, at: Date): Promise<ArgumentScriptSource[]> {
  const rows = (await db.query<SourceRow>(`${SELECT_IN_FORCE} and (s.scope_type = 'ALL_TEAMS' or (s.scope_type = 'TEAM' and s.team_id = $3) or (s.scope_type = 'SUBTEAM' and s.subteam_id = $4)) order by s.name`, [organizationId, at, person.teamId, person.subteamId])).rows
  return rows.map(toSource).filter((source) => scopeAppliesTo(source.scope, person))
}

/**
 * Linhas para o prompt LEGADO dos Agents (`buildSystemPrompt`, caminho fora do motor de feedback): o que antes vinha de
 * `call_expectations` (todas as regras da organização com o nome do grupo/assunto) agora vem dos argumentários vigentes e ativos.
 * Conversão antiga = o mesmo texto de antes, com o mesmo grupo/assunto; argumentário estruturado = resumo dos campos.
 */
export async function loadArgumentScriptPromptLines(db: Queryable, organizationId: string, at: Date): Promise<{ expectation: string; team_name: string | null; subject_name: string | null }[]> {
  const rows = (await db.query<SourceRow>(`${SELECT_IN_FORCE} and s.status = 'ACTIVE' /* argument_scripts (ex-call_expectations) */ order by s.created_at`, [organizationId, at])).rows
  return rows.map((row) => {
    const content = readStoredContent(row.content)
    const items = criterionItemsOf(content)
    if (items.length === 0) return { expectation: content.legacyExpectation?.trim() || content.operatorGuidance.map((item) => item.text).join(" "), team_name: row.subteam_name ?? row.team_name, subject_name: row.subject_name }
    const must = items.filter((item) => item.field !== "AVOID" && item.modality !== "MAY").map((item) => item.text)
    const avoid = items.filter((item) => item.field === "AVOID").map((item) => item.text)
    const parts = [`Argumentário "${row.name}"`, content.trigger ? `quando ${content.trigger}` : null, must.length > 0 ? `pontos: ${must.join("; ")}` : null, avoid.length > 0 ? `evitar: ${avoid.join("; ")}` : null]
    return { expectation: parts.filter(Boolean).join(" — "), team_name: row.subteam_name ?? row.team_name, subject_name: row.subject_name }
  })
}
