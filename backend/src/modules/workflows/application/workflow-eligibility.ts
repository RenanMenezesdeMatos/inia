import type { Database } from "../../../infrastructure/database/pool.js"
import { populationFilterAnchorId, populationFilterSchema, type PopulationFilter } from "../domain/population-filter-schema.js"
import { resolvePopulationFilterOperatorIds, resolveStructureAnchorOperatorIds } from "./hierarchy-subjects.js"

/**
 * UMA semântica de elegibilidade organizacional pra Workflows em modo Individual:
 *
 *   Workflow (Abrangência + Filtro Populacional) + Operador → ELEGÍVEL ou NÃO.
 *
 * Abrangência (ALL_TEAMS / TEAM / SUBTEAM) E Filtro Populacional (ausente = todos) — nunca
 * alternativas. Quem consome:
 *   - ingestão por Flag (ingestion-router.ts → flag-enrollment.ts): decisão pontual, um operador
 *     por interação (`isOperatorEligibleForWorkflow`) — nunca carrega a população inteira;
 *   - checador de agenda (schedule-check.ts): o conjunto elegível (`resolveEligibleOperatorIds`);
 *   - QA Lab (seletor de colaborador, interações compatíveis, validação da evidência): ambos.
 *
 * As duas formas compartilham os MESMOS resolvedores de estrutura (hierarchy-subjects.ts) e são
 * cobertas por testes de paridade (workflow-eligibility.test.ts): pra qualquer organização, a
 * pontual e a por conjunto devolvem a mesma resposta. Antes desta regra existir, a ingestão por
 * Flag só conhecia ALL_TEAMS/TEAM (SUBTEAM nunca casava) e ignorava o Filtro Populacional —
 * QA e produção discordavam sobre "este operador pode disparar este Workflow?".
 */
export type WorkflowPopulation = {
  scopeType: string
  teamId: string | null
  subteamId: string | null
  /** `population_filter` cru (jsonb) ou já parseado; null/ausente = ALL. */
  populationFilter: unknown
}

/** `population_filter` vem do jsonb já validado na escrita (workflow-router.ts) — aqui só se
 * garante a forma mínima (`kind`), sem revalidar uuids: o agendador sempre leu a coluna crua. */
export function parsePopulationFilter(raw: unknown): PopulationFilter | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === "object" && typeof (raw as { kind?: unknown }).kind === "string") return raw as PopulationFilter
  return populationFilterSchema.parse(raw)
}

/** Conjunto de operadores elegíveis — Abrangência ∩ Filtro Populacional. */
export async function resolveEligibleOperatorIds(db: Database, organizationId: string, population: WorkflowPopulation): Promise<string[]> {
  const filter = parsePopulationFilter(population.populationFilter)
  return resolvePopulationFilterOperatorIds(db, organizationId, filter, {
    scopeType: population.scopeType,
    teamId: population.teamId,
    subteamId: population.subteamId,
  })
}

export type EligibleOperatorRow = { id: string; team_id: string | null; subteam_id: string | null; reports_to_id: string | null }

/** Linha do operador como a elegibilidade precisa dela — null quando inexistente, inativo ou
 * não-OPERATOR (nunca elegível). Exposta pra quem avalia VÁRIOS Workflows candidatos pro mesmo
 * evento (ingestão por Flag/Indicador) carregar o operador uma vez e reaproveitar. */
export async function loadEligibleOperator(db: Database, organizationId: string, operatorId: string): Promise<EligibleOperatorRow | null> {
  const result = await db.query<EligibleOperatorRow>(
    `select id, team_id, subteam_id, reports_to_id from people where id = $1 and organization_id = $2 and role = 'OPERATOR' and active`,
    [operatorId, organizationId],
  )
  return result.rows[0] ?? null
}

/**
 * Decisão pontual pra UM operador (ingestão): lê só a linha dele e aplica a Abrangência; o Filtro
 * Populacional usa o mesmo resolvedor de estrutura do modo por conjunto — sem filtro (o caso
 * comum) nenhuma população é carregada. Operador inativo/inexistente ou que não é OPERATOR nunca
 * é elegível (mesmo universo de `resolveScopeOperatorIds`). `operator` já carregado (via
 * `loadEligibleOperator`) evita reler a mesma pessoa pra cada Workflow candidato.
 */
export async function isOperatorEligibleForWorkflow(
  db: Database,
  organizationId: string,
  population: WorkflowPopulation,
  operatorId: string,
  operator?: EligibleOperatorRow | null,
): Promise<boolean> {
  const row = operator === undefined ? await loadEligibleOperator(db, organizationId, operatorId) : operator
  if (!row || row.id !== operatorId) return false
  return isLoadedOperatorEligible(db, population, row)
}

async function isLoadedOperatorEligible(db: Database, population: WorkflowPopulation, operator: EligibleOperatorRow): Promise<boolean> {

  if (!matchesScope(population, operator)) return false

  const filter = parsePopulationFilter(population.populationFilter)
  if (!filter || filter.kind === "ALL") return true
  if (filter.kind === "EMPLOYEE") return filter.employeeId === operator.id
  // Estruturas: mesma resolução de membros do modo por conjunto (e do modo Consolidado) —
  // SUPERVISOR_TEAM = reporta direto ao supervisor; SUBTEAM/TEAM = pertence ao grupo;
  // Coordenador/Gerente/Gerente Sênior/Diretor = está na árvore abaixo da âncora.
  const members = await resolveStructureAnchorOperatorIds(db, filter, populationFilterAnchorId(filter))
  return members.includes(operator.id)
}

function matchesScope(population: WorkflowPopulation, operator: EligibleOperatorRow): boolean {
  switch (population.scopeType) {
    case "ALL_TEAMS":
      return true
    case "TEAM":
      return population.teamId !== null && operator.team_id === population.teamId
    case "SUBTEAM":
      return population.subteamId !== null && operator.subteam_id === population.subteamId
    default:
      return false
  }
}
