import type { Database } from "../../../infrastructure/database/pool.js"
import { loadEffectiveStrategy, type ResolvedStrategy } from "../../indicator-diagnosis/application/diagnostic-strategy-service.js"
import { populationFilterAnchorId } from "../domain/population-filter-schema.js"
import type { StructureAnchor } from "../domain/structure-anchor-schema.js"
import { resolveStructureAnchorOperatorIds } from "./hierarchy-subjects.js"
import { loadEligibleOperator, type EligibleOperatorRow } from "./workflow-eligibility.js"

type Queryable = Pick<Database, "query">

export type CandidateWorkflowRow = { id: string; active_version_id: string; scope_type: string; team_id: string | null; subteam_id: string | null; population_filter: unknown }

/**
 * Leituras da matrícula por evento (Indicador/Flag) que não dependem da linha do evento: Workflows candidatos do código/flag,
 * estratégia efetiva do indicador, nó de gatilho da versão, membros da estrutura do Filtro Populacional e a linha do operador.
 * Mesmas consultas de sempre, cada uma lembrada (por chave) durante a vida desta instância.
 *
 * Quem cria decide a vida: `enrollIndicatorWorkflows`/`enrollFlagWorkflows` sem instância criam uma por evento (exatamente o
 * de antes); a carga em lote da Central de Dados cria UMA por lote aplicado, na transação do lote — 1.000 medições do mesmo
 * indicador leem os candidatos, a estratégia e o grafo uma vez, não 1.000. A decisão por linha (elegibilidade) e a gravação
 * (uma matrícula por Workflow elegível) continuam linha a linha, iguais. Nada disto lê o que o lote grava (medições, flags,
 * matrículas); o que muda é só o instante da leitura dentro do mesmo lote: uma publicação concorrente no meio do lote vale
 * para o lote inteiro ou para nenhuma linha dele — um dos resultados que o caminho linha a linha também podia dar.
 */
export type EnrollmentLookups = {
  indicatorCandidates(organizationId: string, indicatorCode: string): Promise<CandidateWorkflowRow[]>
  flagCandidates(organizationId: string, channelFlagId: string): Promise<CandidateWorkflowRow[]>
  operator(organizationId: string, operatorId: string): Promise<EligibleOperatorRow | null>
  strategy(organizationId: string, indicatorCode: string): Promise<ResolvedStrategy | null>
  /** Nó de gatilho do grafo da versão; null = versão sem gatilho (não matricula). */
  triggerNode(versionId: string): Promise<{ id: string } | null>
  structureMembers(filter: StructureAnchor): Promise<ReadonlySet<string>>
}

export function createEnrollmentLookups(db: Queryable): EnrollmentLookups {
  const caches = new Map<string, Map<string, Promise<unknown>>>()
  const remember = <T>(kind: string, key: string, load: () => Promise<T>): Promise<T> => {
    let cache = caches.get(kind)
    if (!cache) caches.set(kind, (cache = new Map()))
    let value = cache.get(key) as Promise<T> | undefined
    if (!value) {
      value = load()
      cache.set(key, value)
    }
    return value
  }
  const candidates = (organizationId: string, kind: "indicator" | "channel_flag", key: string) =>
    remember(`candidates:${kind}`, `${organizationId}|${key}`, async () => {
      const result = await db.query<CandidateWorkflowRow>(
        kind === "indicator"
          ? `select id, active_version_id, scope_type, team_id, subteam_id, population_filter
     from workflows
     where organization_id = $1 and active and active_version_id is not null
       and trigger_config->>'kind' = 'indicator' and trigger_config->>'indicatorCode' = $2`
          : `select id, active_version_id, scope_type, team_id, subteam_id, population_filter
     from workflows
     where organization_id = $1 and active and active_version_id is not null
       and trigger_config->>'kind' = 'channel_flag' and trigger_config->>'channelFlagId' = $2`,
        [organizationId, key],
      )
      return result.rows
    })
  return {
    indicatorCandidates: (organizationId, indicatorCode) => candidates(organizationId, "indicator", indicatorCode),
    flagCandidates: (organizationId, channelFlagId) => candidates(organizationId, "channel_flag", channelFlagId),
    operator: (organizationId, operatorId) => remember("operator", `${organizationId}|${operatorId}`, () => loadEligibleOperator(db as Database, organizationId, operatorId)),
    // V1.6.2 — a versão da estratégia de diagnóstico EFETIVA fica presa na execução (nada "ao vivo" depois).
    strategy: (organizationId, indicatorCode) => remember("strategy", `${organizationId}|${indicatorCode}`, () => loadEffectiveStrategy(db, organizationId, { code: indicatorCode })),
    triggerNode: (versionId) =>
      remember("trigger", versionId, async () => {
        const result = await db.query<{ graph: { nodes: { id: string; type: string }[] } }>(`select graph from workflow_versions where id = $1`, [versionId])
        return result.rows[0]?.graph.nodes.find((node) => node.type === "trigger") ?? null
      }),
    structureMembers: (filter) => remember("members", JSON.stringify(filter), async () => new Set(await resolveStructureAnchorOperatorIds(db as Database, filter, populationFilterAnchorId(filter)))),
  }
}
