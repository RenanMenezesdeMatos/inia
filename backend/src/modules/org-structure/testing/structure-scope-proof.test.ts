import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { PgAnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { postgresHierarchyReader } from "../../workflows/application/organizational-recipient.js"
import { loadManagementMetrics } from "../application/load-management-metrics.js"
import { buildPersonOrganizationStructure, type PersonOrganizationStructureDeps } from "../application/person-organization-structure.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"

/**
 * PROVA no banco de TESTE real (Postgres, migrations aplicadas) do hardening de escopo:
 *  - `PgAnalyticsReadRepository.loadDescendants` termina com ciclo (A → B → A), com auto-referência
 *    (A → A), numa cadeia longa (60 níveis) e devolve EXATAMENTE a mesma subárvore para dados
 *    válidos que a leitura ingênua devolveria (semântica preservada);
 *  - `countActiveOperators` (DIRECT/ANY) bate com a contagem sobre `loadDescendants` do leitor de
 *    hierarquia — a mesma população, sem carregar a subárvore;
 *  - navegação aberta (política 2026-09-17) contra o banco: qualquer pessoa ativa da organização
 *    é focável (leituras pontuais filtradas por organização); inativo e OUTRA ORGANIZAÇÃO — mesmo
 *    com um `reports_to_id` corrompido apontando para fora — → 403;
 *  - métricas gerenciais (`loadManagementMetrics`) contra o banco: população = ativos abaixo (com
 *    a travessia passando por inativos), situação vigente pelos PERÍODOS na data local (legado
 *    traduzido), referência do Grupo por (cargo, Grupo), e número FIXO de consultas por request —
 *    igual com 1 ou com N líderes no payload (nenhum N+1).
 * Tudo dentro de uma transação revertida ao final: o banco volta ao estado anterior.
 *
 *   INIA_DB_PROOF=1 npx vitest run structure-scope-proof
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const OTHER_ORG = "7a0000ff-0000-4000-8000-000000000000"
const id = (n: number) => `7a000000-0000-4000-8000-${String(n).padStart(12, "0")}`

let pool: pg.Pool
let client: pg.PoolClient

async function insertPerson(n: number, name: string, role: string, reportsTo: number | null, active = true) {
  await client.query(`insert into people (id, organization_id, name, role, reports_to_id, active) values ($1, $2, $3, $4, $5, $6)`, [id(n), ORG, name, role, reportsTo === null ? null : id(reportsTo), active])
}

/** V1.5.8: a conta da sessão é consultada (papéis); esta não existe → nenhuma visão ampliada, só a regra operacional. */
const NO_ROLE_ACCOUNT = "00000000-0000-4000-8000-0000000acc00"

describe.skipIf(!ENABLED)("Escopo organizacional — ciclos, auto-referência, cadeia longa e contagem (banco real)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    client = await pool.connect()
    await client.query("begin")
    // Guarda de segurança: se a proteção anticiclo regredir, a query falha em vez de travar a suíte.
    await client.query("set local statement_timeout = '5s'")
    // Gerente 1 → Coordenador 2 → Supervisor 3 → operadores 4, 5 (ativos), 6 (inativo); Supervisor 7
    // (inativo) → operador 8 (ativo) — o inativo é atravessado, o operador dele conta em ANY.
    await insertPerson(1, "Prova Gerente", "MANAGER", null)
    await insertPerson(2, "Prova Coordenador", "COORDINATOR", 1)
    await insertPerson(3, "Prova Supervisor", "SUPERVISOR", 2)
    await insertPerson(4, "Prova Op A", "OPERATOR", 3)
    await insertPerson(5, "Prova Op B", "OPERATOR", 3)
    await insertPerson(6, "Prova Op Inativo", "OPERATOR", 3, false)
    await insertPerson(7, "Prova Sup Inativo", "SUPERVISOR", 2, false)
    await insertPerson(8, "Prova Op do Inativo", "OPERATOR", 7)
    // Ciclo A(10) ⇄ B(11) e auto-referência C(12) → C(12) (a FK é para a própria tabela — o banco aceita).
    await insertPerson(10, "Prova Ciclo A", "MANAGER", null)
    await insertPerson(11, "Prova Ciclo B", "SUPERVISOR", 10)
    await client.query(`update people set reports_to_id = $1 where id = $2`, [id(11), id(10)])
    await insertPerson(12, "Prova Auto", "SUPERVISOR", null)
    await client.query(`update people set reports_to_id = $1 where id = $1`, [id(12)])
    // Cadeia longa: 100 → 101 → … → 160.
    await insertPerson(100, "Prova Longa 0", "MANAGER", null)
    for (let n = 101; n <= 160; n++) await insertPerson(n, `Prova Longa ${n - 100}`, n === 160 ? "OPERATOR" : "SUPERVISOR", n - 1)
    await client.query(`insert into organizations (id, name, slug) values ($1, 'Prova Outra Org', 'prova-outra-org')`, [OTHER_ORG])
  })

  afterAll(async () => {
    await client.query("rollback")
    client.release()
    await pool.end()
  })

  it("hierarquia normal: a subárvore é exatamente a esperada (semântica preservada) e cada pessoa aparece uma vez", async () => {
    const repository = new PgAnalyticsReadRepository(client as unknown as Database)
    const names = (await repository.loadDescendants(ORG, id(1))).map((node) => node.name)
    expect([...names].sort()).toEqual(["Prova Coordenador", "Prova Op A", "Prova Op B", "Prova Op Inativo", "Prova Op do Inativo", "Prova Sup Inativo", "Prova Supervisor"])
    expect(new Set(names).size).toBe(names.length)
  })

  it("cadeia longa (60 níveis): termina e traz todos os níveis", async () => {
    const repository = new PgAnalyticsReadRepository(client as unknown as Database)
    const rows = await repository.loadDescendants(ORG, id(100))
    expect(rows).toHaveLength(60)
  })

  it("ciclo A ⇄ B: termina (não estoura linhas, não trava o request)", async () => {
    const repository = new PgAnalyticsReadRepository(client as unknown as Database)
    const rows = await repository.loadDescendants(ORG, id(10))
    expect(rows.map((node) => node.name).sort()).toEqual(["Prova Ciclo A", "Prova Ciclo B"])
  })

  it("auto-referência A → A: termina", async () => {
    const repository = new PgAnalyticsReadRepository(client as unknown as Database)
    const rows = await repository.loadDescendants(ORG, id(12))
    expect(rows.map((node) => node.name)).toEqual(["Prova Auto"])
  })

  it("countActiveOperators DIRECT/ANY = mesma população de loadDescendants filtrado (inativos fora; gestor inativo é atravessado)", async () => {
    const reader = postgresHierarchyReader(client as unknown as Database)
    const below = async (personId: string, depth: "DIRECT" | "ANY") => (await reader.loadDescendants(personId)).filter((person) => person.role === "OPERATOR" && (depth === "ANY" || person.reportsToId === personId)).length
    expect(await reader.countActiveOperators(id(3), "DIRECT")).toBe(2)
    expect(await reader.countActiveOperators(id(3), "DIRECT")).toBe(await below(id(3), "DIRECT"))
    expect(await reader.countActiveOperators(id(2), "ANY")).toBe(3)
    expect(await reader.countActiveOperators(id(2), "ANY")).toBe(await below(id(2), "ANY"))
    expect(await reader.countActiveOperators(id(1), "ANY")).toBe(3)
    expect(await reader.countActiveOperators(id(10), "ANY")).toBe(0)
    expect(await reader.countActiveOperators(id(100), "ANY")).toBe(1)
  })

  it("navegação aberta no banco: qualquer ativo da organização → permitido com leituras pontuais; inativo e outra organização → 403; resumo de situação para gestão", async () => {
    const db = client as unknown as Database
    const deps: PersonOrganizationStructureDeps = {
      analytics: new PgAnalyticsReadRepository(db),
      hierarchy: postgresHierarchyReader(db),
      corporateEmails: async () => new Map(),
      personAvatars: async () => new Map(),
      structureFreshness: async () => ({ state: "UNKNOWN", configured: false, feeds: [], consideredFeedIds: [], lastSuccessAt: null, lastDataAt: null, lastSuccessLocalDate: null }),
      managementMetrics: (organizationId, roots, at) => loadManagementMetrics(db, organizationId, roots, at),
    }
    const user = (personId: string, role: AuthTokenPayload["role"], organizationId = ORG): AuthTokenPayload => ({ sub: NO_ROLE_ACCOUNT, personId, organizationId, role, name: "x", email: "x@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null })

    // Operador 4 sobe: Supervisor 3 (colegas 4 e 5 como subordinados; 6 inativo fora), Coordenador 2, Gerente 1.
    const supervisor = await buildPersonOrganizationStructure(deps, user(id(4), "OPERATOR"), id(3))
    expect(supervisor.subject.personId).toBe(id(3))
    expect(supervisor.directReports.map((report) => [report.name, report.capabilities.canViewStructure, report.capabilities.canViewProfile])).toEqual([["Prova Op A", true, false], ["Prova Op B", true, false]])
    expect(supervisor.breadcrumb.map((entry) => entry.name)).toEqual(["Prova Op A", "Prova Supervisor"])
    const coordinator = await buildPersonOrganizationStructure(deps, user(id(4), "OPERATOR"), id(2))
    expect(coordinator.breadcrumb.map((entry) => entry.name)).toEqual(["Prova Op A", "Prova Supervisor", "Prova Coordenador"])
    // Só o Supervisor ativo aparece (7 é inativo), e ele tem subordinados contados em lote.
    expect(coordinator.directReports.map((report) => [report.name, report.directReportCount, report.capabilities.hasReports])).toEqual([["Prova Supervisor", 2, true]])
    expect((await buildPersonOrganizationStructure(deps, user(id(4), "OPERATOR"), id(1))).subject.personId).toBe(id(1))
    // Inativo na cadeia (8 reporta ao Supervisor 7, inativo): 7 não é focável; o próximo ativo (2) é.
    await expect(buildPersonOrganizationStructure(deps, user(id(8), "OPERATOR"), id(7))).rejects.toMatchObject({ code: "STRUCTURE_ACCESS_DENIED" })
    expect((await buildPersonOrganizationStructure(deps, user(id(8), "OPERATOR"), id(2))).subject.personId).toBe(id(2))
    // Outra árvore (ciclo A/B, cadeia longa) e o colega: focáveis (organograma aberto), sem métricas para o Operador.
    for (const target of [id(10), id(100), id(5)]) {
      const opened = await buildPersonOrganizationStructure(deps, user(id(4), "OPERATOR"), target)
      expect(opened.subject.personId).toBe(target)
      expect(opened.subject.managementMetrics).toBeNull()
      expect(JSON.stringify(opened)).not.toContain("statusDistribution")
    }
    // Outra organização: o intruso "reporta" (vínculo corrompido) ao Coordenador da org 1, mas as
    // leituras da pessoa focal e dos subordinados são filtradas pela organização do token → 403.
    await client.query(`insert into people (id, organization_id, name, role, reports_to_id, active) values ($1, $2, 'Prova Intruso', 'OPERATOR', $3, true)`, [id(200), OTHER_ORG, id(2)])
    await expect(buildPersonOrganizationStructure(deps, user(id(200), "OPERATOR", OTHER_ORG), id(2))).rejects.toMatchObject({ code: "STRUCTURE_ACCESS_DENIED" })
    await expect(buildPersonOrganizationStructure(deps, user(id(200), "OPERATOR", OTHER_ORG), id(3))).rejects.toMatchObject({ code: "STRUCTURE_ACCESS_DENIED" })
    await expect(buildPersonOrganizationStructure(deps, user(id(4), "OPERATOR"), id(200))).rejects.toMatchObject({ code: "STRUCTURE_ACCESS_DENIED" })
    await client.query(`delete from people where id = $1`, [id(200)])
  })

  it("métricas gerenciais no banco: população ativa abaixo (travessia passa por inativos), situação pelos PERÍODOS na data local com legado traduzido, referência do Grupo, e consultas FIXAS (1 líder ou N líderes: mesmo número)", async () => {
    const queries: string[] = []
    const db = { query: (text: string, params?: unknown[]) => (queries.push(text), client.query(text, params)) } as unknown as Database
    const deps: PersonOrganizationStructureDeps = {
      analytics: new PgAnalyticsReadRepository(db),
      hierarchy: postgresHierarchyReader(db),
      corporateEmails: async () => new Map(),
      personAvatars: async () => new Map(),
      structureFreshness: async () => ({ state: "UNKNOWN", configured: false, feeds: [], consideredFeedIds: [], lastSuccessAt: null, lastDataAt: null, lastSuccessLocalDate: null }),
      managementMetrics: (organizationId, roots, at) => loadManagementMetrics(db, organizationId, roots, at),
      now: () => new Date("2026-09-17T15:00:00.000Z"),
    }
    const user = (personId: string, role: AuthTokenPayload["role"]): AuthTokenPayload => ({ sub: NO_ROLE_ACCOUNT, personId, organizationId: ORG, role, name: "x", email: "x@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null })
    // Situação vigente vem dos PERÍODOS (não da coluna): 5 de férias hoje; 8 com legado VACATION (→ FERIAS);
    // 4 com um período que já TERMINOU (presumido em produção — e sem feed atrasado, conta como produção).
    await client.query(`insert into employee_status_periods (organization_id, person_id, status, effective_from, effective_to, source) values ($1, $2, 'FERIAS', '2026-09-10', '2026-09-20', 'prova'), ($1, $3, 'VACATION', '2026-09-01', null, 'prova'), ($1, $4, 'INSS', '2026-08-01', '2026-08-31', 'prova')`, [ORG, id(5), id(8), id(4)])
    // Grupo "Prova Grupo": Supervisores 3 (span 2) e 11 (span 1, no ciclo) são pares de mesmo cargo + mesmo Grupo; o Coordenador 2 no mesmo Grupo NÃO entra (cargo diferente).
    const operation = await client.query<{ id: string }>(`select id from operations where organization_id = $1 order by created_at limit 1`, [ORG])
    const team = await client.query<{ id: string }>(`insert into teams (organization_id, operation_id, name) values ($1, $2, 'Prova Grupo') returning id`, [ORG, operation.rows[0]!.id])
    await client.query(`update people set team_id = $1 where id = any($2::uuid[])`, [team.rows[0]!.id, [id(3), id(11), id(2)]])

    const manager = await buildPersonOrganizationStructure(deps, user(id(1), "MANAGER"), id(1))
    const managerQueries = queries.length
    // Abaixo do Gerente 1: 2, 3, 4, 5, 8 ativos (6 e 7 inativos ficam fora; 8 é alcançado ATRAVÉS do 7 inativo).
    expect(manager.subject.managementMetrics).toMatchObject({ structuralPopulation: 5, directSpan: 1, operatorReach: 3, privacy: { sensitiveBreakdownSuppressed: false } })
    expect(manager.subject.managementMetrics?.statusDistribution).toEqual([
      { bucket: "EM_PRODUCAO", count: 3, percent: 60 },
      { bucket: "FERIAS", count: 2, percent: 40 },
      { bucket: "INSS", count: 0, percent: 0 },
      { bucket: "MATERNIDADE", count: 0, percent: 0 },
      { bucket: "PATERNIDADE", count: 0, percent: 0 },
    ])
    expect(manager.subject.managementMetrics?.layerMetrics).toEqual([
      { managerRole: "COORDINATOR", reportRole: "SUPERVISOR", managers: 1, reports: 1, average: 1 },
      { managerRole: "SUPERVISOR", reportRole: "OPERATOR", managers: 1, reports: 2, average: 2 },
    ])
    expect(manager.subject.managementMetrics?.groupBenchmark).toBeNull()
    // O Coordenador 2 (subordinado direto que lidera) vem no MESMO lote, com a referência do Grupo dele (único Coordenador do Grupo).
    const coordinatorMetrics = manager.directReports.find((report) => report.personId === id(2))?.managementMetrics
    expect(coordinatorMetrics).toMatchObject({ structuralPopulation: 4, directSpan: 1, operatorReach: 3, groupBenchmark: { groupName: "Prova Grupo", peerRole: "COORDINATOR", peerCount: 1, averageDirectSpan: 1 } })

    // Supervisor 3 pela Coordenadora: pares de mesmo cargo + mesmo Grupo = 3 (span 2) e 11 (span 1) → média 1,5; população 2 (< 5) → afastamentos só somados.
    const coordinator = await buildPersonOrganizationStructure(deps, user(id(2), "COORDINATOR"), id(2))
    const supervisor = coordinator.directReports.find((report) => report.personId === id(3))?.managementMetrics
    expect(supervisor).toMatchObject({ structuralPopulation: 2, directSpan: 2, groupBenchmark: { groupName: "Prova Grupo", peerRole: "SUPERVISOR", peerCount: 2, averageDirectSpan: 1.5 }, privacy: { sensitiveBreakdownSuppressed: true } })
    expect(supervisor?.statusDistribution.map((share) => share.bucket)).toEqual(["EM_PRODUCAO", "FERIAS", "SENSITIVE_LEAVE"])
    // Nenhum N+1: o Gerente abrindo a Coordenadora (2 líderes no payload: 2 e 3) e abrindo o
    // Supervisor (1 líder: 3) custam o MESMO número de consultas — o lote não cresce com os líderes.
    queries.length = 0
    await buildPersonOrganizationStructure(deps, user(id(1), "MANAGER"), id(2))
    const twoLeaders = queries.length
    queries.length = 0
    await buildPersonOrganizationStructure(deps, user(id(1), "MANAGER"), id(3))
    expect(queries.length).toBe(twoLeaders)
    expect(managerQueries).toBeLessThan(twoLeaders + 2)
    // O carregador em si: 4 consultas (fuso, freshness, CTE multi-raiz, referência do Grupo), para 1 ou para 3 raízes.
    queries.length = 0
    await loadManagementMetrics(db, ORG, [{ id: id(3), role: "SUPERVISOR", teamId: team.rows[0]!.id }], new Date("2026-09-17T15:00:00.000Z"))
    expect(queries).toHaveLength(4)
    queries.length = 0
    await loadManagementMetrics(db, ORG, [{ id: id(1), role: "MANAGER", teamId: null }, { id: id(2), role: "COORDINATOR", teamId: team.rows[0]!.id }, { id: id(3), role: "SUPERVISOR", teamId: team.rows[0]!.id }], new Date("2026-09-17T15:00:00.000Z"))
    expect(queries).toHaveLength(4)
  })
})
