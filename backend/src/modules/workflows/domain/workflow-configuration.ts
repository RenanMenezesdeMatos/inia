import type { ConsolidatedStructure } from "./consolidated-structure-schema.js"
import type { PopulationFilter } from "./population-filter-schema.js"
import type { TriggerConfig } from "./trigger-config-schema.js"

/**
 * CONFIGURAÇÃO de um Workflow — tudo que, fora do grafo, decide QUANDO ele nasce e PARA QUEM:
 * Gatilho, Abrangência e Modo de avaliação (Estrutura Consolidada ou Filtro Populacional).
 *
 * Existe em DOIS estados que nunca se misturam (migration 144, incidente de 2026-10-05):
 *   - RASCUNHO (`workflows.draft_*`): o que o editor grava. Nenhum leitor de runtime olha para ele.
 *   - PUBLICADA (`workflows.trigger_config`, `scope_type`, …): o que o checador de agenda, a ingestão
 *     por Flag/Indicador, o "Executar agora" e o motor leem. Só muda ao Publicar (junto com
 *     `active_version_id`, na mesma transação) — e é registrada na própria versão publicada.
 *
 * Workflow nunca publicado não tem runtime (todo leitor exige versão ativa), então nele as duas
 * cópias andam juntas.
 */
export type WorkflowConfiguration = {
  triggerConfig: TriggerConfig
  scopeType: string
  teamId: string | null
  subteamId: string | null
  consolidatedStructure: ConsolidatedStructure | null
  populationFilter: PopulationFilter | null
}

/** O que mudou entre o rascunho e a configuração publicada — na ordem em que o editor apresenta. */
export type ConfigurationChange = "TRIGGER" | "SCOPE" | "ANALYSIS"

export const CONFIGURATION_CHANGE_LABELS: Record<ConfigurationChange, string> = {
  TRIGGER: "Gatilho",
  SCOPE: "Abrangência",
  ANALYSIS: "Alvo da avaliação / população",
}

/** JSON com chaves ordenadas — a ordem das chaves do jsonb nunca conta como mudança. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value ?? null))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, sortKeys(entry)]),
    )
  }
  return value
}

/** Filtro "Todos os colaboradores elegíveis" e filtro ausente são a mesma população. */
function normalizedPopulation(filter: PopulationFilter | null | undefined): PopulationFilter | null {
  return filter && filter.kind !== "ALL" ? filter : null
}

export function configurationChanges(draft: WorkflowConfiguration, published: WorkflowConfiguration): ConfigurationChange[] {
  const changes: ConfigurationChange[] = []
  if (stableJson(draft.triggerConfig) !== stableJson(published.triggerConfig)) changes.push("TRIGGER")
  if (draft.scopeType !== published.scopeType || (draft.teamId ?? null) !== (published.teamId ?? null) || (draft.subteamId ?? null) !== (published.subteamId ?? null)) {
    changes.push("SCOPE")
  }
  if (
    stableJson(draft.consolidatedStructure) !== stableJson(published.consolidatedStructure) ||
    stableJson(normalizedPopulation(draft.populationFilter)) !== stableJson(normalizedPopulation(published.populationFilter))
  ) {
    changes.push("ANALYSIS")
  }
  return changes
}
