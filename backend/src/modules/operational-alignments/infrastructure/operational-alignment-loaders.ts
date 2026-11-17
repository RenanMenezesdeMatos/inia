import type { Database } from "../../../infrastructure/database/pool.js"
import { isOperatingUniverse } from "../../operating-universe/domain/operating-universe.js"
import { recordAlignmentUsage, type AlignmentUsage } from "../application/alignment-audit.js"
import { resolveOperationalAlignments, isValidDate, type AlignmentCandidate, type AlignmentResolution, type AlignmentSubject } from "../domain/operational-alignment.js"

type Queryable = Pick<Database, "query">

type CandidateRow = {
  alignment_id: string
  version_id: string
  version: number
  title: string
  guidance: string
  justification: string
  documents: { id: string; title: string }[]
  affected_topic: string | null
  operating_universe: string
  scope_type: AlignmentCandidate["scopeType"]
  team_id: string | null
  team_name: string | null
  subteam_id: string | null
  subteam_name: string | null
  product_id: string | null
  product_name: string | null
  starts_on: string
  ends_on: string
  time_zone: string
  effective_from: Date
  effective_until: Date
  ended_at: Date | null
  content_hash: string
  published_at: Date
  responsible_name: string | null
  responsible_job_title: string | null
  published_by_name: string | null
  published_by_job_title: string | null
  relations: { otherAlignmentId: string; relation: "SAME_TOPIC" | "INDEPENDENT" }[] | null
}

/** Versões publicadas (vigentes ou substituídas — a substituída continua cobrindo o intervalo dela) que cobrem `at`. */
const SELECT_CANDIDATES = `
  select v.alignment_id, v.id version_id, v.version, v.title, v.guidance, v.justification,
         (select json_agg(json_build_object('id', kd.id, 'title', kd.title) order by kd.title) from operational_alignment_version_documents vd join knowledge_documents kd on kd.id = vd.document_id where vd.version_id = v.id) documents,
         v.affected_topic, v.operating_universe, v.scope_type, v.team_id, t.name team_name, v.subteam_id, st.name subteam_name, v.product_id, pn.name product_name,
         v.starts_on::text starts_on, v.ends_on::text ends_on, v.time_zone, v.effective_from, v.effective_until, v.ended_at, v.content_hash, v.published_at,
         pr.name responsible_name, v.responsible_job_title, pp.name published_by_name, pp.job_title published_by_job_title,
         (select coalesce(json_agg(json_build_object('otherAlignmentId', r.other_alignment_id, 'relation', r.relation)), '[]'::json) from operational_alignment_relations r where r.version_id = v.id) relations
  from operational_alignment_versions v
  -- Exclusão NÃO entra aqui: excluir encurta o intervalo para "até agora", então o que já passou continua coberto (avaliação ou
  -- reprocessamento de chamada anterior à exclusão) e o que vem depois não.
  left join teams t on t.id = v.team_id
  left join subteams st on st.id = v.subteam_id
  left join product_catalog_nodes_all pn on pn.id = v.product_id
  left join people pr on pr.id = v.responsible_person_id
  left join people pp on pp.id = v.published_by
  where v.organization_id = $1 and v.status in ('PUBLISHED', 'SUPERSEDED') and v.effective_from <= $2 and v.effective_until > $2`

const toCandidate = (row: CandidateRow): AlignmentCandidate | null => {
  if (!isOperatingUniverse(row.operating_universe) || !row.documents || row.documents.length === 0) return null
  return {
    alignmentId: row.alignment_id,
    versionId: row.version_id,
    version: row.version,
    title: row.title,
    guidance: row.guidance,
    justification: row.justification,
    affectedDocuments: row.documents ?? [],
    affectedTopic: row.affected_topic,
    operatingUniverse: row.operating_universe,
    scopeType: row.scope_type,
    teamId: row.team_id,
    teamName: row.team_name,
    subteamId: row.subteam_id,
    subteamName: row.subteam_name,
    productId: row.product_id,
    productName: row.product_name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    timeZone: row.time_zone,
    effectiveFrom: new Date(row.effective_from),
    effectiveUntil: new Date(row.effective_until),
    endedEarlyAt: row.ended_at ? new Date(row.ended_at) : null,
    contentHash: row.content_hash,
    publishedAt: new Date(row.published_at),
    // Autoria (221): quem definiu (cargo copiado na publicação) e quem publicou (cargo atual do cadastro). Só o chat usa.
    definedBy: row.responsible_name ? { name: row.responsible_name, jobTitle: row.responsible_job_title } : null,
    publishedBy: row.published_by_name ? { name: row.published_by_name, jobTitle: row.published_by_job_title } : null,
    relations: row.relations ?? [],
  }
}

export async function loadAlignmentCandidatesAt(db: Queryable, organizationId: string, at: Date, documentIds: readonly string[] | null): Promise<AlignmentCandidate[]> {
  if (documentIds && documentIds.length === 0) return []
  const rows = (await db.query<CandidateRow>(`${SELECT_CANDIDATES}${documentIds ? " and exists (select 1 from operational_alignment_version_documents vd where vd.version_id = v.id and vd.document_id = any($3::uuid[]))" : ""} order by v.published_at`, documentIds ? [organizationId, at, [...documentIds]] : [organizationId, at])).rows
  return rows.flatMap((row) => {
    const candidate = toCandidate(row)
    return candidate ? [candidate] : []
  })
}

/**
 * Sujeito da regra: Grupo/Subgrupo do cadastro (o mesmo que a monitoria grava no caso e que os argumentários usam) e o universo
 * VIGENTE NA DATA DE REFERÊNCIA (`person_operating_universe_history` — trocar de operação não muda o que valia antes).
 */
export async function loadAlignmentSubject(db: Queryable, organizationId: string, personId: string, at: Date | null): Promise<AlignmentSubject | null> {
  const row = (await db.query<{ team_id: string | null; subteam_id: string | null; universe_now: string | null; universe_at: string | null; enforced: boolean }>(
    `select p.team_id, p.subteam_id, p.operating_universe universe_now,
            (select h.operating_universe from person_operating_universe_history h where h.person_id = p.id and h.valid_from <= $3 and (h.valid_until is null or h.valid_until > $3) order by h.valid_from desc limit 1) universe_at,
            (o.operating_universe_enforced_at is not null) enforced
     from people p join organizations o on o.id = p.organization_id
     where p.id = $1 and p.organization_id = $2`,
    [personId, organizationId, isValidDate(at) ? at : new Date()],
  )).rows[0]
  if (!row) return null
  // Sem linha de histórico na data (pessoa criada depois, histórico ainda não aberto): o universo do cadastro.
  const universe = row.universe_at ?? row.universe_now
  return { teamId: row.team_id, subteamId: row.subteam_id, operatingUniverse: isOperatingUniverse(universe) ? universe : null, universeEnforced: row.enforced }
}

/**
 * PONTO ÚNICO DE APLICAÇÃO (chat, voz, agentes e monitoria): carrega os candidatos das bases autorizadas e aplica a regra pura.
 * Sem pessoa (teste do agente, prévia, coordenação sem colaborador) = nenhum alinhamento: o alcance é sempre o de UM colaborador.
 */
export async function resolveOperationalAlignmentsFor(db: Queryable, input: { organizationId: string; personId: string | null; at: Date | null; documentIds: readonly string[]; usage?: Omit<AlignmentUsage, "personId"> }): Promise<AlignmentResolution> {
  const empty: AlignmentResolution = { rule: "OPERATIONAL_ALIGNMENT_RULE_V1", status: isValidDate(input.at) ? "RESOLVED" : "REFERENCE_DATE_UNKNOWN", referenceDate: isValidDate(input.at) ? input.at : null, applied: [], setAside: [], productPrecedence: [] }
  if (!input.personId || input.documentIds.length === 0 || !isValidDate(input.at)) return empty
  const candidates = await loadAlignmentCandidatesAt(db, input.organizationId, input.at, input.documentIds)
  if (candidates.length === 0) return empty
  const subject = await loadAlignmentSubject(db, input.organizationId, input.personId, input.at)
  if (!subject) return empty
  const resolution = resolveOperationalAlignments(candidates, subject, input.at, new Set(input.documentIds))
  // Rastro: qual versão a IA leu (não aguardado; nunca derruba a resposta).
  if (input.usage) recordAlignmentUsage(db, input.organizationId, resolution, { ...input.usage, personId: input.personId })
  return resolution
}

/**
 * Houve alinhamento (não excluído) para estas bases que deixou de valer nos últimos 12 meses? Sustenta o aviso de segurança da conversa
 * (uma resposta anterior pode ter se baseado nele). Consulta só de existência, pelo índice de processos.
 */
export async function hadRecentAlignments(db: Queryable, organizationId: string, documentIds: readonly string[], now: Date): Promise<boolean> {
  if (documentIds.length === 0) return false
  const row = (await db.query<{ found: boolean }>(
    `select exists (
       select 1 from operational_alignment_version_documents vd
       join operational_alignment_versions v on v.id = vd.version_id and v.status in ('PUBLISHED', 'SUPERSEDED') and v.effective_until > v.effective_from
       join operational_alignments a on a.id = v.alignment_id and a.deleted_at is null
       where vd.organization_id = $1 and vd.document_id = any($2::uuid[]) and v.effective_until <= $3 and v.effective_until > $3 - interval '12 months'
     ) found`,
    [organizationId, [...documentIds], now],
  )).rows[0]
  return row?.found ?? false
}
