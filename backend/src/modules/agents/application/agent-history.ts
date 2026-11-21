import type { Database } from "../../../infrastructure/database/pool.js"
import type { ManageableScopes, ScopedTarget } from "../../auth/application/manageable-scopes.js"
import { INVESTIGATION_CAPABILITY_LABELS, normalizeCapabilities, type InvestigationCapability } from "../../investigation/domain/capabilities.js"
import { describeActionLimits } from "../domain/action-limits.js"
import type { AgentConfig } from "../domain/agent-config.js"
import { canReadAgentConfig } from "./agent-config-rules.js"
import type { AgentActor } from "./agent-versions.js"

/**
 * HISTÓRICO DE ALTERAÇÕES DO AGENTE (`agent_history`): o que mudou entre duas configurações, a gravação e a leitura por alcance. Saiu do
 * router de agentes (run-8, ARQ-02) sem mudar o formato gravado.
 */

const FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  agentType: "Tipo",
  objective: "Objetivo",
  description: "Descrição",
  contextPrompt: "Contexto",
  active: "Status",
  scopeType: "Alcance",
  knowledgeDocumentIds: "Bases de conhecimento",
  actionLimits: "Limites de atuação",
  investigationCapabilities: "Ferramentas de investigação",
  specialty: "Especialidade",
  recommendSupportMaterials: "Recomendar materiais",
  version: "Versão",
  draft: "Rascunho",
}

export type FieldChange = { field: string; label: string; from: string; to: string }
/** Alteração com o alcance das configurações envolvidas (antes e depois) — o alcance delas decide quem lê os valores. */
export type StoredFieldChange = FieldChange & { configScopes?: ScopedTarget[] }
export type HistoryAction = "CREATED" | "UPDATED" | "DUPLICATED" | "PUBLISHED" | "REVERTED" | "DRAFT_DISCARDED"

/** Uma linha do histórico com o rótulo do campo. */
export const fieldChange = (field: keyof typeof FIELD_LABELS & string, from: string, to: string): FieldChange => ({ field, label: FIELD_LABELS[field]!, from, to })

/** "Versão 3" (ou "Não publicado") — o texto das linhas de versão. */
export const versionLabel = (number: number | null) => (number ? `Versão ${number}` : "Não publicado")

function diffIdList(field: string, before: string[], after: string[]): FieldChange | null {
  const added = after.filter((id) => !before.includes(id))
  const removed = before.filter((id) => !after.includes(id))
  if (!added.length && !removed.length) return null
  const parts: string[] = []
  if (added.length) parts.push(`+${added.length}`)
  if (removed.length) parts.push(`-${removed.length}`)
  return fieldChange(field, "", parts.join(" "))
}

const capabilityLabel = (list: string[]) => (list.length === 0 ? "Nenhuma" : list.map((capability) => INVESTIGATION_CAPABILITY_LABELS[capability as InvestigationCapability] ?? capability).join(", "))

/** Diferenças entre duas configurações completas (rascunho anterior → rascunho novo). */
export function diffConfigs(before: AgentConfig, after: AgentConfig): FieldChange[] {
  const changes: FieldChange[] = []
  for (const field of ["name", "agentType", "objective", "description", "contextPrompt"] as const) {
    if (before[field] !== after[field]) changes.push(fieldChange(field, String(before[field]), String(after[field])))
  }
  if (before.scopeType !== after.scopeType || before.teamId !== after.teamId || before.subteamId !== after.subteamId) changes.push(fieldChange("scopeType", before.scopeType, after.scopeType))
  const knowledgeChange = diffIdList("knowledgeDocumentIds", before.knowledgeDocumentIds, after.knowledgeDocumentIds)
  if (knowledgeChange) changes.push(knowledgeChange)
  const limitsBefore = describeActionLimits({ enabled: before.actionLimitsEnabled, text: before.actionLimits })
  const limitsAfter = describeActionLimits({ enabled: after.actionLimitsEnabled, text: after.actionLimits })
  if (limitsBefore !== limitsAfter) changes.push(fieldChange("actionLimits", limitsBefore, limitsAfter))
  const capabilitiesBefore = normalizeCapabilities(before.investigationCapabilities)
  const capabilitiesAfter = normalizeCapabilities(after.investigationCapabilities)
  if (capabilitiesBefore.join(",") !== capabilitiesAfter.join(",")) changes.push(fieldChange("investigationCapabilities", capabilityLabel(capabilitiesBefore), capabilityLabel(capabilitiesAfter)))
  if (before.specialtyKind !== after.specialtyKind || before.businessDomainId !== after.businessDomainId || before.capability !== after.capability || before.consolidatedInput !== after.consolidatedInput) {
    changes.push(fieldChange("specialty", before.specialty ?? before.specialtyKind ?? "—", after.specialty ?? after.specialtyKind ?? "—"))
  }
  if (before.recommendSupportMaterials !== after.recommendSupportMaterials) changes.push(fieldChange("recommendSupportMaterials", before.recommendSupportMaterials ? "Sim" : "Não", after.recommendSupportMaterials ? "Sim" : "Não"))
  return changes
}

/** `configs`: as configurações cujos valores a alteração mostra (antes e depois) — o alcance delas decide quem lê os valores. */
export async function recordAgentHistory(client: Pick<Database, "query">, organizationId: string, input: { agentId: string; action: HistoryAction; actor: AgentActor; changes: FieldChange[]; configs?: AgentConfig[] }): Promise<void> {
  const configScopes = input.configs?.map((config) => ({ scopeType: config.scopeType, teamId: config.teamId, subteamId: config.subteamId }))
  const changes: StoredFieldChange[] = configScopes ? input.changes.map((change) => ({ ...change, configScopes })) : input.changes
  await client.query(
    `insert into agent_history(organization_id, agent_id, action, changed_by_person_id, changed_by_name, changes)
     values ($1,$2,$3,$4,$5,$6)`,
    [organizationId, input.agentId, input.action, input.actor.personId, input.actor.name, JSON.stringify(changes)],
  )
}

/** Situação, versão e rascunho não são configuração e saem sempre. */
export const NON_CONFIG_HISTORY_FIELDS = new Set(["active", "version", "draft"])

/**
 * Alteração do histórico com os valores completos (contexto, limites) só para quem alcança as configurações envolvidas; quem não
 * alcança vê quem alterou, quando e quais campos (`restricted`). Registro gravado antes de 09/11/2026 não guarda o alcance: falha
 * fechado — os valores dele só aparecem para quem alcança TODOS os alcances que o agente já teve (`readsLegacyValues`).
 */
export function readableHistoryEntry<T extends { changes: StoredFieldChange[] }>(scopes: ManageableScopes, entry: T, readsLegacyValues: boolean) {
  const restricted = entry.changes.some((change) =>
    change.configScopes ? change.configScopes.some((scope) => !canReadAgentConfig(scopes, scope)) : !readsLegacyValues && !NON_CONFIG_HISTORY_FIELDS.has(change.field),
  )
  return {
    ...entry,
    changes: entry.changes.map((change) => ({ field: change.field, label: change.label, from: restricted ? "" : change.from, to: restricted ? "" : change.to })),
    restricted,
  }
}
