import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { canManageScope, getManageableScopes, type ManageableScopes } from "../../auth/application/manageable-scopes.js"
import { canReadDocument, loadDocumentScopes, type DocumentScope } from "../../knowledge/application/knowledge-document-read-access.js"
import { asOperatingUniverse, universesCompatible, type OperatingUniverse } from "../../operating-universe/domain/operating-universe.js"
import { configAgentTeamIdsSql, knowledgeFitsAgentSql, liveAgentTeamIdsSql } from "../../knowledge/application/knowledge-agent-fit.js"
import { scopedTargetOf } from "../../org-structure/application/resource-scope-links.js"
import { resourceScopeOf, type ResourceScope } from "../../../shared/domain/scope-links/resource-scope.js"
import { agentScopeOf, parseAgentConfig, sameAgentConfig, type AgentConfig } from "../domain/agent-config.js"

/**
 * ASSOCIAR AGENTES A PARTIR DA BASE (20/11/2026). Antes, ligar uma base nova a um agente exigia sair da base, abrir o agente, editar
 * as bases dele e publicar. Agora o editor da base mostra os agentes e grava a associação no RASCUNHO de cada agente escolhido — ou
 * grava e publica — pelas MESMAS regras do cadastro do agente (rascunho com trava otimista, alcance, universo, publicação imutável).
 * Nada aqui cria caminho paralelo: o rascunho e a publicação são os de `agent-versions.ts`, e a rota confere tudo de novo ao gravar.
 *
 * Regra de segurança própria desta tela: publicar daqui só publica a mudança de BASES. Agente publicado cujo rascunho já tem outras
 * alterações pendentes (de outra pessoa ou de outra hora) recebe a base só no rascunho; publicar fica para a tela do agente, onde
 * quem publica vê tudo o que vai junto (resultado `DRAFT_ONLY_OTHER_CHANGES`).
 */

/** Configuração sem as bases — para saber se o rascunho tem alterações ALÉM das bases. */
export function withoutKnowledge(config: AgentConfig): AgentConfig {
  return { ...config, knowledgeDocumentIds: [] }
}

/** O rascunho muda algo além das bases em relação à versão vigente? Sem rascunho = não. */
export function draftHasOtherChanges(live: AgentConfig | null, draft: AgentConfig | null): boolean {
  if (!draft || !live) return false
  return !sameAgentConfig(withoutKnowledge(live), withoutKnowledge(draft))
}

/** Lista de bases depois de ligar/desligar uma, ordenada e sem repetição (o formato do rascunho). */
export function knowledgeIdsAfter(current: readonly string[], knowledgeDocumentId: string, linked: boolean): string[] {
  const next = new Set(current)
  if (linked) next.add(knowledgeDocumentId)
  else next.delete(knowledgeDocumentId)
  return [...next].sort()
}

/** Motivo pelo qual o agente não pode receber a base (null = pode). Desligar uma base que o agente tem nunca é bloqueado aqui. */
export type KnowledgeLinkBlock = "SCOPE" | "UNIVERSE" | "DRAFT_RESTRICTED"

export const KNOWLEDGE_LINK_BLOCK_MESSAGES: Record<KnowledgeLinkBlock, string> = {
  SCOPE: "A base não vale para nenhum Grupo deste agente — só bases globais ou de um dos Grupos dele entram num agente de Grupos.",
  UNIVERSE: "A base e o agente são de universos de atuação diferentes, e universos não se misturam.",
  DRAFT_RESTRICTED: "O rascunho deste agente é de um alcance que você não administra.",
}

export type KnowledgeLinkCandidate = {
  id: string
  name: string
  agentType: string
  active: boolean
  operatingUniverse: OperatingUniverse | null
  /** Alcance em edição (rascunho, ou a vigente): ALL_TEAMS ou GROUPS + os vínculos (Grupo inteiro ou um Subgrupo, com os nomes). */
  scopeType: "ALL_TEAMS" | "GROUPS"
  scopeLinks: KnowledgeLinkScopeLink[]
  /** A versão vigente (o que a IA usa) já consulta a base. Agente nunca publicado: sempre false. */
  linkedInUse: boolean
  /** O que está em edição (rascunho, ou a vigente sem rascunho) tem a base. */
  linkedInDraft: boolean
  published: boolean
  currentVersionNumber: number | null
  draft: { revision: number; pending: boolean; otherChanges: boolean; updatedAt: string | null; updatedByName: string | null }
  block: KnowledgeLinkBlock | null
  blockMessage: string | null
}

export type KnowledgeLinkScopeLink = { teamId: string; teamName: string | null; subteamId: string | null; subteamName: string | null }

type CandidateRow = {
  id: string
  name: string
  agent_type: string
  active: boolean
  operating_universe: string | null
  scope_type: string
  live_links: { teamId: string; subteamId: string | null }[]
  current_version_id: string | null
  current_version_number: number | null
  live_config: unknown
  draft_config: unknown
  draft_revision: number
  draft_updated_at: string | null
  draft_updated_by_name: string | null
  linked_in_use: boolean
  scope_compatible: boolean
}

export type KnowledgeLinkContext = {
  knowledgeDocumentId: string
  knowledgeTitle: string
  knowledgeUniverse: OperatingUniverse | null
  scopes: ManageableScopes
  inactiveScopes: ManageableScopes
}

/** A pessoa tem a permissão em algum alcance (deny by default: sem atribuição = nenhum). */
export function holdsAnyScope(scopes: ManageableScopes): boolean {
  return scopes.unrestricted || scopes.allTeams || scopes.teamIds.size > 0 || scopes.subteamIds.size > 0
}

const baseNotFound = () => new DomainError("Base de conhecimento não encontrada.", "KNOWLEDGE_NOT_FOUND", 404)

/**
 * Quem associa precisa LER a base pela regra da tela de bases (`knowledge.manage` no alcance dela) e administrar agentes. Base de
 * outra organização, excluída ou fora do alcance = 404 (não revela que existe).
 */
export async function loadKnowledgeLinkContext(db: Database, user: { organizationId: string; sub: string }, knowledgeDocumentId: string): Promise<KnowledgeLinkContext> {
  const documentScopes: DocumentScope[] | null = await loadDocumentScopes(db, user.organizationId, knowledgeDocumentId)
  if (!documentScopes) throw baseNotFound()
  // `canReadDocument` supõe a permissão (as rotas de bases exigem `knowledge.manage` no mount): aqui ela é conferida antes — sem
  // nenhum alcance de bases, nem a base global é lida.
  const knowledgeScopes = await getManageableScopes(db, user, "knowledge.manage")
  if (!holdsAnyScope(knowledgeScopes) || !(await canReadDocument(db, knowledgeScopes, documentScopes))) throw baseNotFound()
  const base = (await db.query<{ title: string; operating_universe: string | null }>(
    `select title, operating_universe from knowledge_documents where id = $1 and organization_id = $2 and deleted_at is null`,
    [knowledgeDocumentId, user.organizationId],
  )).rows[0]
  if (!base) throw baseNotFound()
  return {
    knowledgeDocumentId,
    knowledgeTitle: base.title,
    knowledgeUniverse: asOperatingUniverse(base.operating_universe),
    scopes: await getManageableScopes(db, user, "agents.manage"),
    inactiveScopes: await getManageableScopes(db, user, "agents.inactive.manage"),
  }
}

/**
 * Agentes que a pessoa administra, com a situação da base em cada um. O alcance considerado para a compatibilidade é o da
 * configuração EM EDIÇÃO (rascunho, ou a vigente), a mesma regra que `assertKnowledge` confere ao gravar (`knowledge-agent-fit.ts`). Inativo só
 * aparece para quem administra inativos naquele alcance (a regra da lista de agentes). `onlyIds` restringe aos agentes pedidos.
 */
export async function loadKnowledgeLinkCandidates(db: Pick<Database, "query">, organizationId: string, context: KnowledgeLinkContext, onlyIds?: readonly string[]): Promise<KnowledgeLinkCandidate[]> {
  const rows = (await db.query<CandidateRow>(
    `with cand as (
       select a.*, cv.version_number current_version_number, cv.config live_config, coalesce(a.draft_config, cv.config) edit_config
         from agents a left join agent_versions cv on cv.id = a.current_version_id
        where a.organization_id = $1 and ($3::uuid[] is null or a.id = any($3::uuid[]))
     )
     select c.id, c.name, c.agent_type, c.active, c.operating_universe, c.scope_type,
            coalesce((select json_agg(json_build_object('teamId', l.team_id, 'subteamId', l.subteam_id)) from agent_scope_links l where l.agent_id = c.id), '[]'::json) live_links,
            c.current_version_id, c.current_version_number, c.live_config, c.draft_config, c.draft_revision, c.draft_updated_at, c.draft_updated_by_name,
            -- Agente nunca publicado não está em uso: a linha viva dele só acompanha o rascunho.
            c.current_version_id is not null and exists (select 1 from agent_knowledge_documents akd where akd.agent_id = c.id and akd.knowledge_document_id = $2) linked_in_use,
            -- Alcance EM EDIÇÃO (rascunho, ou a vigente; sem nenhum dos dois, a linha viva) — a regra que assertKnowledge confere ao gravar.
            ${knowledgeFitsAgentSql("$2::uuid", {
              scopeType: "coalesce(c.edit_config->>'scopeType', c.scope_type)",
              teamIds: `(case when c.edit_config is null then ${liveAgentTeamIdsSql("c.id")} else ${configAgentTeamIdsSql("c.edit_config")} end)`,
            })} scope_compatible
       from cand c
      order by c.name, c.id`,
    [organizationId, context.knowledgeDocumentId, onlyIds ? [...onlyIds] : null],
  )).rows

  const liveScopeOf = (row: CandidateRow): ResourceScope => resourceScopeOf({ scopeType: row.scope_type === "ALL_TEAMS" ? "ALL_TEAMS" : "GROUPS", scopeLinks: row.live_links })
  const visible = rows
    .filter((row) => canManageScope(context.scopes, scopedTargetOf(liveScopeOf(row))))
    .filter((row) => row.active || canManageScope(context.inactiveScopes, scopedTargetOf(liveScopeOf(row))))
  const names = await scopeLinkNames(db, visible.flatMap((row) => [...liveScopeOf(row).links, ...(row.draft_config ? agentScopeOf(parseAgentConfig(row.draft_config)).links : []), ...(row.live_config ? agentScopeOf(parseAgentConfig(row.live_config)).links : [])]))
  const named = (scope: ResourceScope): KnowledgeLinkScopeLink[] => scope.links.map((link) => ({ teamId: link.teamId, teamName: names.teams.get(link.teamId) ?? null, subteamId: link.subteamId, subteamName: link.subteamId ? (names.subteams.get(link.subteamId) ?? null) : null }))

  return visible
    .map((row) => {
      const live = row.current_version_id && row.live_config ? parseAgentConfig(row.live_config) : null
      const draft = row.draft_config ? parseAgentConfig(row.draft_config) : null
      const draftRestricted = draft !== null && !canManageScope(context.scopes, scopedTargetOf(agentScopeOf(draft)))
      // Rascunho de outro alcance (run-8, SB-02): nada dele sai — nem o alcance, nem se tem a base, nem se tem outras alterações (o `GET /:id`
      // também o esconde com `restricted: true`). A linha mostra o agente como está em uso e fica bloqueada.
      if (draftRestricted) {
        const liveScope = liveScopeOf(row)
        return {
          id: row.id, name: row.name, agentType: row.agent_type, active: row.active, operatingUniverse: asOperatingUniverse(row.operating_universe),
          scopeType: liveScope.scopeType, scopeLinks: named(liveScope),
          linkedInUse: row.linked_in_use, linkedInDraft: row.linked_in_use, published: row.current_version_id !== null, currentVersionNumber: row.current_version_number,
          draft: { revision: row.draft_revision, pending: true, otherChanges: false, updatedAt: null, updatedByName: null },
          block: "DRAFT_RESTRICTED" as const, blockMessage: KNOWLEDGE_LINK_BLOCK_MESSAGES.DRAFT_RESTRICTED,
        }
      }
      const editing = draft ?? live
      const editingScope = editing ? agentScopeOf(editing) : liveScopeOf(row)
      const linkedInDraft = editing ? editing.knowledgeDocumentIds.includes(context.knowledgeDocumentId) : row.linked_in_use
      const universeMismatch = !universesCompatible(context.knowledgeUniverse, asOperatingUniverse(row.operating_universe))
      const block: KnowledgeLinkBlock | null = !linkedInDraft && !row.scope_compatible ? "SCOPE" : !linkedInDraft && universeMismatch ? "UNIVERSE" : null
      return {
        id: row.id,
        name: row.name,
        agentType: row.agent_type,
        active: row.active,
        operatingUniverse: asOperatingUniverse(row.operating_universe),
        scopeType: editingScope.scopeType,
        scopeLinks: named(editingScope),
        linkedInUse: row.linked_in_use,
        linkedInDraft,
        published: row.current_version_id !== null,
        currentVersionNumber: row.current_version_number,
        draft: {
          revision: row.draft_revision,
          pending: draft !== null && (live === null || !sameAgentConfig(live, draft)),
          otherChanges: draftHasOtherChanges(live, draft),
          updatedAt: row.draft_updated_at,
          updatedByName: row.draft_updated_by_name,
        },
        block,
        blockMessage: block ? KNOWLEDGE_LINK_BLOCK_MESSAGES[block] : null,
      }
    })
}

/** Nomes dos Grupos e Subgrupos dos vínculos (uma consulta para a lista inteira). */
async function scopeLinkNames(db: Pick<Database, "query">, links: readonly { teamId: string; subteamId: string | null }[]): Promise<{ teams: Map<string, string>; subteams: Map<string, string> }> {
  const teamIds = [...new Set(links.map((link) => link.teamId))]
  const subteamIds = [...new Set(links.flatMap((link) => (link.subteamId ? [link.subteamId] : [])))]
  if (teamIds.length === 0 && subteamIds.length === 0) return { teams: new Map(), subteams: new Map() }
  const rows = (await db.query<{ kind: "TEAM" | "SUBTEAM"; id: string; name: string }>(
    `select 'TEAM' kind, id, name from teams where id = any($1::uuid[]) union all select 'SUBTEAM' kind, id, name from subteams where id = any($2::uuid[])`,
    [teamIds, subteamIds],
  )).rows
  return { teams: new Map(rows.filter((row) => row.kind === "TEAM").map((row) => [row.id, row.name])), subteams: new Map(rows.filter((row) => row.kind === "SUBTEAM").map((row) => [row.id, row.name])) }
}

/** A base está ligada ao agente — no que a IA usa ou no rascunho (aba "Ligados"); senão, o agente está "Disponível". */
export const isKnowledgeLinked = (candidate: Pick<KnowledgeLinkCandidate, "linkedInUse" | "linkedInDraft">) => candidate.linkedInUse || candidate.linkedInDraft

export type KnowledgeLinkState = "PUBLISHED" | "NOT_PUBLISHED" | "DRAFT_PENDING" | "INACTIVE"

export type KnowledgeLinkListFilter = {
  tab: "LINKED" | "AVAILABLE"
  search?: string | undefined
  agentType?: string | undefined
  /** Universo do agente; PENDING = sem universo. */
  universe?: string | undefined
  /** Alcance do agente: só os de todos os Grupos, os com algum vínculo no Grupo (inteiro ou Subgrupo dele) ou com o Subgrupo escolhido. */
  scopeType?: "ALL_TEAMS" | undefined
  teamId?: string | undefined
  subteamId?: string | undefined
  state?: KnowledgeLinkState | undefined
}

const fold = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")

/** Filtros da lista (aba, busca pelo nome, tipo, universo, Grupo e situação) — os mesmos para a contagem e para a página. */
export function matchesKnowledgeLinkFilter(candidate: KnowledgeLinkCandidate, filter: Omit<KnowledgeLinkListFilter, "tab">): boolean {
  if (filter.search && !fold(candidate.name).includes(fold(filter.search))) return false
  if (filter.agentType && candidate.agentType !== filter.agentType) return false
  if (filter.universe && (filter.universe === "PENDING" ? candidate.operatingUniverse !== null : candidate.operatingUniverse !== filter.universe)) return false
  if (filter.subteamId) {
    if (!candidate.scopeLinks.some((link) => link.subteamId === filter.subteamId)) return false
  } else if (filter.teamId) {
    if (!candidate.scopeLinks.some((link) => link.teamId === filter.teamId)) return false
  } else if (filter.scopeType === "ALL_TEAMS" && candidate.scopeType !== "ALL_TEAMS") return false
  if (filter.state === "PUBLISHED" && !(candidate.published && candidate.active)) return false
  if (filter.state === "NOT_PUBLISHED" && candidate.published) return false
  if (filter.state === "DRAFT_PENDING" && !candidate.draft.pending) return false
  if (filter.state === "INACTIVE" && candidate.active) return false
  return true
}

export type KnowledgeLinkPage = {
  items: KnowledgeLinkCandidate[]
  total: number
  page: number
  pageSize: number
  /** Quantos agentes cada aba tem com os mesmos filtros (o número da aba). */
  counts: { linked: number; available: number }
  /**
   * Agentes publicados em que a base está só no rascunho (entra ao publicar) ou só no que a IA usa (sai ao publicar) — "Salvar e
   * publicar" os inclui mesmo sem a pessoa marcar de novo. Sem filtro nem página: são poucos e a tela precisa de todos.
   */
  pendingPublish: KnowledgeLinkCandidate[]
}

/** Aba + filtros + página (por posição) sobre os candidatos já autorizados. Ordem: nome. */
export function pageKnowledgeLinkCandidates(candidates: readonly KnowledgeLinkCandidate[], filter: KnowledgeLinkListFilter, page: number, pageSize: number): KnowledgeLinkPage {
  const { tab, ...rest } = filter
  const matching = candidates.filter((candidate) => matchesKnowledgeLinkFilter(candidate, rest))
  const linked = matching.filter(isKnowledgeLinked)
  const available = matching.filter((candidate) => !isKnowledgeLinked(candidate))
  const listed = tab === "LINKED" ? linked : available
  const lastPage = Math.max(1, Math.ceil(listed.length / pageSize))
  const current = Math.min(Math.max(1, page), lastPage)
  return {
    items: listed.slice((current - 1) * pageSize, current * pageSize),
    total: listed.length,
    page: current,
    pageSize,
    counts: { linked: linked.length, available: available.length },
    // Sem os de rascunho com outras alterações (run-8, QA-02): esses ficariam só no rascunho de novo e a barra nunca sumia.
    pendingPublish: candidates.filter((candidate) => candidate.published && candidate.linkedInDraft !== candidate.linkedInUse && candidate.block === null && !candidate.draft.otherChanges),
  }
}
