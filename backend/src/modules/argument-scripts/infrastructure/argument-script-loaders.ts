import type { Database } from "../../../infrastructure/database/pool.js"
import { argumentScriptSourceOf, criterionItemsOf, readStoredContent, scopeAppliesTo, scopeLinksLabel, type ArgumentScriptSource, type ScriptScope } from "../domain/argument-script.js"

type Queryable = Pick<Database, "query">

type SourceRow = {
  script_id: string
  name: string
  area_name: string | null
  scope_type: ScriptScope["scopeType"]
  scope_links: ScriptScope["links"] | null
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

/** Vínculos de uma VERSÃO do argumentário (223) com os nomes, em ordem estável. `versionAlias` = a versão (vigente, publicada ou rascunho). */
export const argumentScriptLinksSql = (versionAlias: string) => `(select coalesce(json_agg(json_build_object('teamId', l.team_id, 'teamName', lt.name, 'subteamId', l.subteam_id, 'subteamName', lst.name) order by lt.name, l.team_id, lst.name nulls first), '[]'::json)
     from argument_script_version_scopes l join teams lt on lt.id = l.team_id left join subteams lst on lst.id = l.subteam_id where l.version_id = ${versionAlias}.id)`

/**
 * Alcance da VERSÃO pela posição da pessoa ($team, $subteam): todos os Grupos, ou ALGUM vínculo (Grupo inteiro ou o Subgrupo). EXISTS:
 * uma linha por argumentário, qualquer que seja o número de vínculos que alcançam a pessoa.
 */
export const argumentScriptReachSql = (versionAlias: string, teamParam: string, subteamParam: string) =>
  `(${versionAlias}.scope_type = 'ALL_TEAMS' or exists (select 1 from argument_script_version_scopes l where l.version_id = ${versionAlias}.id and ((l.subteam_id is null and l.team_id = ${teamParam}::uuid) or l.subteam_id = ${subteamParam}::uuid)))`

const SELECT_IN_FORCE = `
  select s.id script_id, s.name, bd.name area_name, v.scope_type, ${argumentScriptLinksSql("v")} scope_links, sub.name subject_name, s.conversion,
         v.id version_id, v.version, v.content, v.content_hash, v.effective_from, v.effective_until, v.source_document_id, kd.title source_document_title, v.source_reference,
         prev.content previous_content
  from argument_scripts s
  join argument_script_versions v on v.script_id = s.id and v.status in ('PUBLISHED', 'SUPERSEDED') and v.effective_from <= $2 and (v.effective_until is null or v.effective_until > $2)
  left join business_domains bd on bd.id = s.business_domain_id
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
      scope: { scopeType: row.scope_type, links: row.scope_links ?? [] },
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
  const rows = (await db.query<SourceRow>(`${SELECT_IN_FORCE} and ${argumentScriptReachSql("v", "$3", "$4")} order by s.name`, [organizationId, at, person.teamId, person.subteamId])).rows
  return rows.map(toSource).filter((source) => scopeAppliesTo(source.scope, person))
}

/** Quem o prompt vai avaliar, pelo Grupo/Subgrupo: entram só os argumentários cujo escopo o cobre (mesma regra de `scopeAppliesTo`). */
export type ArgumentScriptAudience = { teamId: string | null; subteamId: string | null }

/**
 * Linhas para o prompt LEGADO dos Agents (`buildSystemPrompt`, caminho fora do motor de feedback): o que antes vinha de
 * `call_expectations` agora vem dos argumentários vigentes e ativos que valem para o PÚBLICO avaliado — antes entravam todos os
 * da organização, inclusive os restritos a outros Grupos/Subgrupos (validação funcional de 20/10/2026, D3).
 * Conversão antiga = o mesmo texto de antes, com o mesmo grupo/assunto; argumentário estruturado = resumo dos campos.
 */
export async function loadArgumentScriptPromptLines(db: Queryable, organizationId: string, at: Date, audience: ArgumentScriptAudience): Promise<{ expectation: string; team_name: string | null; subject_name: string | null }[]> {
  const rows = (await db.query<SourceRow>(`${SELECT_IN_FORCE} and s.status = 'ACTIVE' /* argument_scripts (ex-call_expectations) */ and ${argumentScriptReachSql("v", "$3", "$4")} order by s.created_at`, [organizationId, at, audience.teamId, audience.subteamId])).rows
  return rows.map((row) => {
    const content = readStoredContent(row.content)
    const items = criterionItemsOf(content)
    if (items.length === 0) return { expectation: content.legacyExpectation?.trim() || content.operatorGuidance.map((item) => item.text).join(" "), team_name: scopeLinksLabelOfRow(row), subject_name: row.subject_name }
    const must = items.filter((item) => item.field !== "AVOID" && item.modality !== "MAY").map((item) => item.text)
    const avoid = items.filter((item) => item.field === "AVOID").map((item) => item.text)
    const parts = [`Argumentário "${row.name}"`, content.trigger ? `quando ${content.trigger}` : null, must.length > 0 ? `pontos: ${must.join("; ")}` : null, avoid.length > 0 ? `evitar: ${avoid.join("; ")}` : null]
    return { expectation: parts.filter(Boolean).join(" — "), team_name: scopeLinksLabelOfRow(row), subject_name: row.subject_name }
  })
}

/** Grupo(s) do argumentário na linha do prompt legado (antes: o nome do único Grupo/Subgrupo; global = sem Grupo). */
function scopeLinksLabelOfRow(row: Pick<SourceRow, "scope_type" | "scope_links">): string | null {
  return row.scope_type === "ALL_TEAMS" ? null : scopeLinksLabel({ scopeType: row.scope_type, links: row.scope_links ?? [] })
}

/**
 * Versões que GOVERNAM o argumentário agora (para quem pode alterá-lo ou vê-lo): o rascunho e a vigente — sem publicada, a última que
 * valeu. Mesma escolha do cadastro (`gov` + `dr` em argument-script-service).
 */
export const argumentScriptGoverningVersionIdsSql = (scriptIdExpression: string) =>
  `(select gv.id from argument_script_versions gv where gv.script_id = ${scriptIdExpression} and (gv.status = 'DRAFT' or gv.id = (
     select g.id from argument_script_versions g where g.script_id = ${scriptIdExpression} and g.status <> 'DRAFT' order by (g.status = 'PUBLISHED') desc, g.version desc limit 1)))`
