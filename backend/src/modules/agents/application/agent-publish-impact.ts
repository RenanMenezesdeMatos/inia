import type { Database } from "../../../infrastructure/database/pool.js"
import { scopesAreCompatible } from "../../auth/application/manageable-scopes.js"
import { INVESTIGATION_CAPABILITY_LABELS, normalizeCapabilities, type InvestigationCapability } from "../../investigation/domain/capabilities.js"
import { describeActionLimits } from "../domain/action-limits.js"
import type { AgentConfig } from "../domain/agent-config.js"
import { loadVisibleAgentReferences, type AgentReference } from "./agent-deletion.js"
import { loadAgentLifecycle, loadAgentVersion, loadLiveAgentConfig } from "./agent-versions.js"

/**
 * Prévia da publicação (condição de segurança da revisão aprovada da PEN-002/PEN-076, 03/11/2026). Com a atualização automática,
 * publicar muda o que TODOS os consumidores executam a partir da próxima execução. Antes de publicar, a pessoa vê:
 * - os consumidores afetados que ela pode consultar (Workflows e orquestradores, com status e link) e o aviso de que existem
 *   outros fora do alcance dela, sem nenhum dado deles;
 * - as mudanças sensíveis em relação à versão vigente: bases, ferramentas de investigação, alcance e limites de atuação;
 * - quais consumidores visíveis deixariam de ser atendidos (o alcance novo não os cobre): neles a execução passa a ser bloqueada
 *   com o motivo — a publicação nunca amplia acesso nem concede permissão a ninguém.
 * Reverter também publica (versão nova com a configuração de uma anterior): com `revertToVersionId`, a prévia compara essa
 * versão com a vigente em vez do rascunho. Versão que não é do agente nesta organização = null (404 na rota).
 */

const SCOPE_LABEL = (config: Pick<AgentConfig, "scopeType">, teamName: string | null, subteamName: string | null) =>
  config.scopeType === "ALL_TEAMS" ? "Todos os grupos" : config.scopeType === "TEAM" ? `Grupo ${teamName ?? "—"}` : `Subgrupo ${subteamName ?? "—"}`

export type PublishImpact = {
  /** Versão que nasce ao publicar e a vigente hoje (null = primeira publicação). */
  nextVersionNumber: number
  currentVersionNumber: number | null
  consumers: (AgentReference & { losesAccess: boolean })[]
  hasRestrictedConsumers: boolean
  changes: {
    knowledge: { added: { id: string; title: string }[]; removed: { id: string; title: string }[] }
    tools: { added: string[]; removed: string[] }
    scope: { from: string; to: string } | null
    limits: { from: string; to: string } | null
    otherFields: string[]
  }
}

async function scopeLabelOf(db: Pick<Database, "query">, config: AgentConfig): Promise<string> {
  const names = (await db.query<{ team: string | null; subteam: string | null }>(
    `select (select name from teams where id = $1::uuid) team, (select name from subteams where id = $2::uuid) subteam`,
    [config.teamId, config.subteamId],
  )).rows[0]
  return SCOPE_LABEL(config, names?.team ?? null, names?.subteam ?? null)
}

export async function computePublishImpact(
  db: Database,
  viewer: { organizationId: string; sub: string },
  agentId: string,
  /**
   * `authorizeTarget`: a rota confere se quem pede alcança a configuração que seria publicada (versão escolhida ou rascunho) antes
   * de qualquer dado dela sair na prévia — títulos das bases, alcance, consumidores (agent-router.ts › authorizeAgentConfig).
   */
  options: { revertToVersionId?: string | undefined; authorizeTarget?: (config: AgentConfig) => void } = {},
): Promise<PublishImpact | null> {
  const lifecycle = await loadAgentLifecycle(db, viewer.organizationId, agentId)
  if (!lifecycle) return null
  const live = lifecycle.currentVersionId ? await loadLiveAgentConfig(db, viewer.organizationId, agentId) : null
  const revertTo = options.revertToVersionId ? await loadAgentVersion(db, viewer.organizationId, agentId, options.revertToVersionId) : null
  if (options.revertToVersionId && !revertTo) return null
  const next = revertTo?.config ?? lifecycle.draftConfig ?? live
  if (next) options.authorizeTarget?.(next)
  const visible = await loadVisibleAgentReferences(db, viewer, agentId)
  const consumers = await Promise.all(
    visible.references.map(async ({ scope, ...reference }) => ({
      ...reference,
      losesAccess: next ? !(await scopesAreCompatible(db, scope, { scopeType: next.scopeType, teamId: next.teamId, subteamId: next.subteamId })) : false,
    })),
  )
  const before = live
  const knowledgeIds = [...new Set([...(before?.knowledgeDocumentIds ?? []), ...(next?.knowledgeDocumentIds ?? [])])]
  const titles = new Map(knowledgeIds.length === 0 ? [] : (await db.query<{ id: string; title: string }>(`select id, title from knowledge_documents where id = any($1::uuid[]) and organization_id = $2`, [knowledgeIds, viewer.organizationId])).rows.map((row) => [row.id, row.title]))
  const titled = (ids: string[]) => ids.map((id) => ({ id, title: titles.get(id) ?? "Base removida" }))
  const beforeKnowledge = before?.knowledgeDocumentIds ?? []
  const nextKnowledge = next?.knowledgeDocumentIds ?? []
  const label = (capability: string) => INVESTIGATION_CAPABILITY_LABELS[capability as InvestigationCapability] ?? capability
  const beforeTools = normalizeCapabilities(before?.investigationCapabilities ?? [])
  const nextTools = normalizeCapabilities(next?.investigationCapabilities ?? [])
  const scopeFrom = before ? await scopeLabelOf(db, before) : null
  const scopeTo = next ? await scopeLabelOf(db, next) : null
  const limitsFrom = before ? describeActionLimits({ enabled: before.actionLimitsEnabled, text: before.actionLimits }) : null
  const limitsTo = next ? describeActionLimits({ enabled: next.actionLimitsEnabled, text: next.actionLimits }) : null
  const FIELD_LABELS: Partial<Record<keyof AgentConfig, string>> = { name: "Nome", agentType: "Tipo", objective: "Objetivo", description: "Descrição", contextPrompt: "Contexto", specialtyKind: "Especialidade", businessDomainId: "Domínio de negócio", capability: "Competência", recommendSupportMaterials: "Recomendar materiais" }
  const otherFields = before && next ? (Object.keys(FIELD_LABELS) as (keyof AgentConfig)[]).filter((field) => JSON.stringify(before[field]) !== JSON.stringify(next[field])).map((field) => FIELD_LABELS[field]!) : []
  return {
    nextVersionNumber: (lifecycle.currentVersionNumber ?? 0) + 1,
    currentVersionNumber: lifecycle.currentVersionNumber,
    consumers,
    hasRestrictedConsumers: visible.hasRestrictedReferences,
    changes: {
      knowledge: { added: titled(nextKnowledge.filter((id) => !beforeKnowledge.includes(id))), removed: titled(beforeKnowledge.filter((id) => !nextKnowledge.includes(id))) },
      tools: { added: nextTools.filter((tool) => !beforeTools.includes(tool)).map(label), removed: beforeTools.filter((tool) => !nextTools.includes(tool)).map(label) },
      scope: before && scopeFrom !== scopeTo ? { from: scopeFrom!, to: scopeTo! } : null,
      limits: before && limitsFrom !== limitsTo ? { from: limitsFrom!, to: limitsTo! } : null,
      otherFields,
    },
  }
}
