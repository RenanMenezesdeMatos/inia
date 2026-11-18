import type { Database } from "../../../infrastructure/database/pool.js"
import { populationFilterAnchorId, populationFilterSchema, type PopulationFilter } from "../domain/population-filter-schema.js"
import type { StructureAnchor } from "../domain/structure-anchor-schema.js"
import { activeAccessSql, resolvePopulationFilterOperatorIds, resolveStructureAnchorOperatorIds } from "./hierarchy-subjects.js"

/**
 * UMA semântica de elegibilidade organizacional pra Workflows em modo Individual:
 *
 *   Workflow (Abrangência + Filtro Populacional) + Operador → ELEGÍVEL ou NÃO.
 *
 * Abrangência (ALL_TEAMS / TEAM / SUBTEAM) E Filtro Populacional (ausente = todos) — nunca
 * alternativas — E, quando o Workflow liga "Somente quem tem acesso ativo à INIA" (migration 225),
 * conta de acesso ativa. Quem consome:
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
  /** Universo do Workflow (publicado). Com a exigência ativa na organização, só operadores do MESMO universo; null (pendente) = ninguém. */
  operatingUniverse: string | null
  /**
   * "Somente quem tem acesso ativo à INIA" (publicado; migration 225). Obrigatório para cada chamador decidir: quem resolve
   * QUEM ENTRA passa a opção do Workflow; quem resolve a população de COMPARAÇÃO usa `comparisonPopulationOf`.
   */
  requireActiveAccess: boolean
}

/**
 * População de COMPARAÇÃO do Workflow (quartil operacional, ranking, "Selecionar colaboradores"): a mesma Abrangência e o
 * mesmo Filtro, SEM o corte de acesso. A opção decide quem recebe uma execução, nunca com quem a pessoa é comparada — com
 * 15 pessoas com acesso num Subgrupo de 300, o quartil continua sendo sobre as 300.
 */
export function comparisonPopulationOf(population: Omit<WorkflowPopulation, "requireActiveAccess">): WorkflowPopulation {
  return { ...population, requireActiveAccess: false }
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
    operatingUniverse: population.operatingUniverse,
    requireActiveAccess: population.requireActiveAccess,
  })
}

export type EligibleOperatorRow = { id: string; team_id: string | null; subteam_id: string | null; reports_to_id: string | null; operating_universe?: string | null; universe_enforced?: boolean; /** Conta de acesso ativa (mesma definição de `activeAccessSql`). */ has_active_access?: boolean }

/** Membros (operadores) da estrutura de um Filtro Populacional — a mesma resposta de `resolveStructureAnchorOperatorIds`, quando
 * quem chama já a tem lembrada (matrícula em lote, ver enrollment-lookups.ts). */
export type StructureMembersResolver = (filter: StructureAnchor) => Promise<ReadonlySet<string>>

/** Linha do operador como a elegibilidade precisa dela — null quando inexistente, inativo ou
 * não-OPERATOR (nunca elegível). Exposta pra quem avalia VÁRIOS Workflows candidatos pro mesmo
 * evento (ingestão por Flag/Indicador) carregar o operador uma vez e reaproveitar. */
export async function loadEligibleOperator(db: Database, organizationId: string, operatorId: string): Promise<EligibleOperatorRow | null> {
  const result = await db.query<EligibleOperatorRow>(
    `select p.id, p.team_id, p.subteam_id, p.reports_to_id, p.operating_universe, o.operating_universe_enforced_at is not null universe_enforced,
            ${activeAccessSql("p")} has_active_access
       from people p join organizations o on o.id = p.organization_id where p.id = $1 and p.organization_id = $2 and p.role = 'OPERATOR' and p.active`,
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
  structureMembers?: StructureMembersResolver,
): Promise<boolean> {
  const row = operator === undefined ? await loadEligibleOperator(db, organizationId, operatorId) : operator
  if (!row || row.id !== operatorId) return false
  return isLoadedOperatorEligible(db, population, row, structureMembers)
}

async function isLoadedOperatorEligible(db: Database, population: WorkflowPopulation, operator: EligibleOperatorRow, structureMembers?: StructureMembersResolver): Promise<boolean> {

  if (!matchesScope(population, operator)) return false
  // Universos não se misturam: com a exigência ativa, o operador precisa ser do universo do Workflow (pendente de qualquer lado = fora).
  if (operator.universe_enforced && (population.operatingUniverse === null || operator.operating_universe !== population.operatingUniverse)) return false
  // "Somente quem tem acesso ativo à INIA": sem conta de acesso ativa a pessoa não entra (linha sem a informação = sem acesso).
  if (population.requireActiveAccess && operator.has_active_access !== true) return false

  const filter = parsePopulationFilter(population.populationFilter)
  if (!filter || filter.kind === "ALL") return true
  if (filter.kind === "EMPLOYEE") return filter.employeeId === operator.id
  // Estruturas: mesma resolução de membros do modo por conjunto (e do modo Consolidado) —
  // SUPERVISOR_TEAM = reporta direto ao supervisor; SUBTEAM/TEAM = pertence ao grupo;
  // Coordenador/Gerente/Gerente Sênior/Diretor = está na árvore abaixo da âncora.
  if (structureMembers) return (await structureMembers(filter)).has(operator.id)
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
