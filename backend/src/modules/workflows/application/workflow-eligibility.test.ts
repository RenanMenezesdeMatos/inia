import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createEnrollmentLookups } from "./enrollment-lookups.js"
import { enrollFlagWorkflows } from "./flag-enrollment.js"
import { enrollIndicatorWorkflows } from "./indicator-enrollment.js"
import { comparisonPopulationOf, isOperatorEligibleForWorkflow, resolveEligibleOperatorIds, type WorkflowPopulation } from "./workflow-eligibility.js"

/**
 * Paridade QA × Scheduler × Ingestão (bug produtivo: a ingestão por Flag só conhecia
 * ALL_TEAMS/TEAM e ignorava o Filtro Populacional). Uma organização em memória; a decisão
 * pontual (`isOperatorEligibleForWorkflow`, usada pela ingestão e pela validação do QA) e o
 * conjunto (`resolveEligibleOperatorIds`, usado pelo agendador e pelo seletor do QA) precisam
 * concordar operador a operador, em TODAS as combinações de Abrangência e Filtro.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const TEAM_FATURAS = "11111111-1111-4111-8111-111111111111"
const TEAM_RETENCAO = "11111111-1111-4111-8111-111111111112"
const SUB_PREMIUM = "22222222-2222-4222-8222-222222222221" // dentro de RETENÇÃO
const SUB_BASICO = "22222222-2222-4222-8222-222222222222" // dentro de RETENÇÃO
const CARLOS = "ffffffff-ffff-4fff-8fff-fffffffffff1" // supervisor (FATURAS)
const ANA = "ffffffff-ffff-4fff-8fff-fffffffffff2" // supervisora (FATURAS)
const FATIMA = "ffffffff-ffff-4fff-8fff-fffffffffff3" // coordenadora — Carlos e Ana reportam a ela
const JOAO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1" // FATURAS · equipe Carlos
const MARIA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2" // FATURAS · equipe Ana
const PEDRO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3" // RETENÇÃO · PREMIUM
const LUCAS = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4" // RETENÇÃO · BÁSICO
const INATIVO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5" // FATURAS · equipe Carlos · inativo
const RITA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6" // RETENÇÃO · PREMIUM · equipe Carlos
const TIAGO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7" // RETENÇÃO · PREMIUM · equipe Ana
const BIA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee8" // RETENÇÃO · BÁSICO · equipe Carlos
const FLAG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

type Person = { id: string; role: string; active: boolean; team_id: string | null; subteam_id: string | null; reports_to_id: string | null }
const people: Person[] = [
  { id: FATIMA, role: "COORDINATOR", active: true, team_id: TEAM_FATURAS, subteam_id: null, reports_to_id: null },
  { id: CARLOS, role: "SUPERVISOR", active: true, team_id: TEAM_FATURAS, subteam_id: null, reports_to_id: FATIMA },
  { id: ANA, role: "SUPERVISOR", active: true, team_id: TEAM_FATURAS, subteam_id: null, reports_to_id: FATIMA },
  { id: JOAO, role: "OPERATOR", active: true, team_id: TEAM_FATURAS, subteam_id: null, reports_to_id: CARLOS },
  { id: MARIA, role: "OPERATOR", active: true, team_id: TEAM_FATURAS, subteam_id: null, reports_to_id: ANA },
  { id: PEDRO, role: "OPERATOR", active: true, team_id: TEAM_RETENCAO, subteam_id: SUB_PREMIUM, reports_to_id: null },
  { id: LUCAS, role: "OPERATOR", active: true, team_id: TEAM_RETENCAO, subteam_id: SUB_BASICO, reports_to_id: null },
  { id: INATIVO, role: "OPERATOR", active: false, team_id: TEAM_FATURAS, subteam_id: null, reports_to_id: CARLOS },
  { id: RITA, role: "OPERATOR", active: true, team_id: TEAM_RETENCAO, subteam_id: SUB_PREMIUM, reports_to_id: CARLOS },
  { id: TIAGO, role: "OPERATOR", active: true, team_id: TEAM_RETENCAO, subteam_id: SUB_PREMIUM, reports_to_id: ANA },
  { id: BIA, role: "OPERATOR", active: true, team_id: TEAM_RETENCAO, subteam_id: SUB_BASICO, reports_to_id: CARLOS },
]
const OPERATORS = [JOAO, MARIA, PEDRO, LUCAS, INATIVO, RITA, TIAGO, BIA]
/** Quem tem conta de acesso ATIVA (piloto): João, Pedro e Rita. Maria tem conta DESATIVADA; os demais nunca tiveram conta.
 * O inativo no cadastro tem conta ativa de propósito — cadastro inativo nunca entra, com ou sem acesso. */
const ACTIVE_ACCOUNTS = new Set([JOAO, PEDRO, RITA, INATIVO])

type WorkflowRow = { id: string; active_version_id: string | null; active: boolean; scope_type: string; scope_links?: readonly { teamId: string | null; subteamId: string | null }[] | undefined; team_id?: string | null | undefined; subteam_id?: string | null | undefined; population_filter: unknown; require_active_access?: boolean; channelFlagId?: string; indicatorCode?: string }

/** Banco fake que implementa de verdade as consultas de people (mesmo SQL de hierarchy-subjects/
 * workflow-eligibility), workflows por flag e a tabela de matrículas. */
function fakeDatabase(workflows: WorkflowRow[] = []) {
  const log: string[] = []
  const enrollments: { workflowId: string; interactionId?: string; measurementId?: string; flagName?: string; value?: number }[] = []
  const descendants = (anchorId: string): Person[] => {
    const out: Person[] = []
    const stack = people.filter((person) => person.reports_to_id === anchorId)
    while (stack.length > 0) {
      const current = stack.pop()!
      out.push(current)
      stack.push(...people.filter((person) => person.reports_to_id === current.id))
    }
    return out
  }
  async function query(sql: string, params: unknown[] = []) {
    const text = sql.replace(/\s+/g, " ").trim()
    log.push(text)
    if (text.startsWith("select id from people where organization_id = $1 and role = 'OPERATOR' and active")) {
      const rows = people
        .filter((person) => person.role === "OPERATOR" && person.active)
        // Abrangência ($2 todos, $3 Grupos inteiros por team_id, $4 Subgrupos por subteam_id — workflowReachSql).
        .filter((person) => params[1] === true || (params[2] as string[]).includes(person.team_id ?? "") || (params[3] as string[]).includes(person.subteam_id ?? ""))
        // "Somente quem tem acesso ativo à INIA" ($6): só quem tem conta de acesso ativa.
        .filter((person) => params[5] !== true || ACTIVE_ACCOUNTS.has(person.id))
        .map((person) => ({ id: person.id }))
      return { rows, rowCount: rows.length }
    }
    if (text.startsWith("select p.id, p.team_id, p.subteam_id, p.reports_to_id")) {
      const rows = people.filter((person) => person.id === params[0] && person.role === "OPERATOR" && person.active).map((person) => ({ ...person, has_active_access: ACTIVE_ACCOUNTS.has(person.id) }))
      return { rows, rowCount: rows.length }
    }
    if (text.includes("reports_to_id = $1 and role = 'OPERATOR'")) {
      const rows = people.filter((person) => person.reports_to_id === params[0] && person.role === "OPERATOR").map((person) => ({ id: person.id }))
      return { rows, rowCount: rows.length }
    }
    if (text.includes("where subteam_id = $1 and role = 'OPERATOR'")) {
      const rows = people.filter((person) => person.subteam_id === params[0] && person.role === "OPERATOR").map((person) => ({ id: person.id }))
      return { rows, rowCount: rows.length }
    }
    if (text.includes("where team_id = $1 and role = 'OPERATOR'")) {
      const rows = people.filter((person) => person.team_id === params[0] && person.role === "OPERATOR").map((person) => ({ id: person.id }))
      return { rows, rowCount: rows.length }
    }
    if (text.startsWith("with recursive subordinates")) {
      const rows = descendants(params[0] as string).filter((person) => person.role === "OPERATOR").map((person) => ({ id: person.id }))
      return { rows, rowCount: rows.length }
    }
    if (text.includes("from workflows where organization_id = $1 and active and active_version_id is not null and trigger_config->>'kind' = 'channel_flag'")) {
      const rows = workflows.filter((workflow) => workflow.active && workflow.active_version_id && workflow.channelFlagId === params[1])
      return { rows, rowCount: rows.length }
    }
    if (text.includes("from workflows where organization_id = $1 and active and active_version_id is not null and trigger_config->>'kind' = 'indicator'")) {
      const rows = workflows.filter((workflow) => workflow.active && workflow.active_version_id && workflow.indicatorCode === params[1])
      return { rows, rowCount: rows.length }
    }
    // V1.6.2 — versão efetiva da estratégia de diagnóstico (presa na matrícula): nenhuma nestes cenários.
    if (text.includes("from indicator_diagnostic_strategy_versions v")) return { rows: [], rowCount: 0 }
    if (text.startsWith("select graph from workflow_versions")) return { rows: [{ graph: { nodes: [{ id: "trigger", type: "trigger" }] } }], rowCount: 1 }
    if (text.startsWith("insert into workflow_enrollments") && text.includes("interaction_id")) {
      enrollments.push({ workflowId: params[1] as string, interactionId: params[3] as string, flagName: params[5] as string })
      return { rows: [], rowCount: 1 }
    }
    if (text.startsWith("insert into workflow_enrollments") && text.includes("indicator_measurement_id")) {
      enrollments.push({ workflowId: params[1] as string, measurementId: params[3] as string, value: params[5] as number })
      return { rows: [], rowCount: 1 }
    }
    throw new Error(`SQL não previsto no fake: ${text.slice(0, 80)}`)
  }
  return { db: { query } as unknown as Database, enrollments, log }
}

const cases: { name: string; population: WorkflowPopulation; eligible: string[] }[] = [
  { name: "ALL_TEAMS sem filtro → todo operador ativo", population: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, populationFilter: null, operatingUniverse: null, requireActiveAccess: false }, eligible: [JOAO, MARIA, PEDRO, LUCAS, RITA, TIAGO, BIA] },
  { name: "TEAM FATURAS → só operadores de FATURAS (RETENÇÃO fora)", population: { scopeType: "TEAM", teamId: TEAM_FATURAS, subteamId: null, populationFilter: null, operatingUniverse: null, requireActiveAccess: false }, eligible: [JOAO, MARIA] },
  { name: "SUBTEAM PREMIUM → só o Subgrupo (mesmo Grupo, outro Subgrupo fora)", population: { scopeType: "SUBTEAM", teamId: null, subteamId: SUB_PREMIUM, populationFilter: null, operatingUniverse: null, requireActiveAccess: false }, eligible: [PEDRO, RITA, TIAGO] },
  { name: "SUBTEAM PREMIUM com team_id preenchido → ainda só o Subgrupo", population: { scopeType: "SUBTEAM", teamId: TEAM_RETENCAO, subteamId: SUB_PREMIUM, populationFilter: null, operatingUniverse: null, requireActiveAccess: false }, eligible: [PEDRO, RITA, TIAGO] },
  { name: "TEAM FATURAS + Filtro Equipe do Supervisor Carlos → só João (Maria é da Ana)", population: { scopeType: "TEAM", teamId: TEAM_FATURAS, subteamId: null, populationFilter: { kind: "SUPERVISOR_TEAM", supervisorId: CARLOS }, operatingUniverse: null, requireActiveAccess: false }, eligible: [JOAO] },
  { name: "SUBTEAM PREMIUM + Filtro Equipe do Carlos → só Rita (Tiago é da Ana; Bia é do BÁSICO)", population: { scopeType: "SUBTEAM", teamId: null, subteamId: SUB_PREMIUM, populationFilter: { kind: "SUPERVISOR_TEAM", supervisorId: CARLOS }, operatingUniverse: null, requireActiveAccess: false }, eligible: [RITA] },
  { name: "ALL_TEAMS + Filtro Subgrupo BÁSICO → Lucas e Bia", population: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, populationFilter: { kind: "SUBTEAM", subteamId: SUB_BASICO }, operatingUniverse: null, requireActiveAccess: false }, eligible: [LUCAS, BIA] },
  { name: "ALL_TEAMS + Filtro Estrutura da Coordenadora Fátima → toda a árvore abaixo dela (João, Maria, Rita, Tiago, Bia)", population: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, populationFilter: { kind: "COORDINATOR_STRUCTURE", coordinatorId: FATIMA }, operatingUniverse: null, requireActiveAccess: false }, eligible: [JOAO, MARIA, RITA, TIAGO, BIA] },
  { name: "ALL_TEAMS + Filtro Colaborador específico → só ele", population: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, populationFilter: { kind: "EMPLOYEE", employeeId: MARIA }, operatingUniverse: null, requireActiveAccess: false }, eligible: [MARIA] },
  { name: "Abrangência E filtro: TEAM FATURAS + Filtro Subgrupo PREMIUM (RETENÇÃO) → ninguém", population: { scopeType: "TEAM", teamId: TEAM_FATURAS, subteamId: null, populationFilter: { kind: "SUBTEAM", subteamId: SUB_PREMIUM }, operatingUniverse: null, requireActiveAccess: false }, eligible: [] },
  { name: "SUBTEAM PREMIUM + Filtro Grupo RETENÇÃO → só quem satisfaz os dois", population: { scopeType: "SUBTEAM", teamId: null, subteamId: SUB_PREMIUM, populationFilter: { kind: "TEAM", teamId: TEAM_RETENCAO }, operatingUniverse: null, requireActiveAccess: false }, eligible: [PEDRO, RITA, TIAGO] },
  // Vários Grupos (249): vínculos Grupo inteiro FATURAS + Subgrupo PREMIUM de RETENÇÃO → FATURAS inteiro e só PREMIUM (BÁSICO, irmão, fora),
  // cada operador uma vez. GROUPS sem vínculo não alcança ninguém (nunca vira "todos").
  { name: "GROUPS [FATURAS inteiro, PREMIUM] → FATURAS + PREMIUM, BÁSICO fora", population: { scopeType: "GROUPS", scopeLinks: [{ teamId: TEAM_FATURAS, subteamId: null }, { teamId: TEAM_RETENCAO, subteamId: SUB_PREMIUM }], populationFilter: null, operatingUniverse: null, requireActiveAccess: false }, eligible: [JOAO, MARIA, PEDRO, RITA, TIAGO] },
  { name: "GROUPS [RETENÇÃO inteiro] → os dois Subgrupos de RETENÇÃO", population: { scopeType: "GROUPS", scopeLinks: [{ teamId: TEAM_RETENCAO, subteamId: null }], populationFilter: null, operatingUniverse: null, requireActiveAccess: false }, eligible: [PEDRO, LUCAS, RITA, TIAGO, BIA] },
  { name: "GROUPS [FATURAS, PREMIUM] + Filtro Equipe do Carlos → João e Rita (Bia é do BÁSICO)", population: { scopeType: "GROUPS", scopeLinks: [{ teamId: TEAM_FATURAS, subteamId: null }, { teamId: TEAM_RETENCAO, subteamId: SUB_PREMIUM }], populationFilter: { kind: "SUPERVISOR_TEAM", supervisorId: CARLOS }, operatingUniverse: null, requireActiveAccess: false }, eligible: [JOAO, RITA] },
  { name: "GROUPS sem vínculo → ninguém", population: { scopeType: "GROUPS", scopeLinks: [], populationFilter: null, operatingUniverse: null, requireActiveAccess: false }, eligible: [] },
  // "Somente quem tem acesso ativo à INIA" (migration 225): só quem tem conta de acesso ativa, somado à Abrangência e ao Filtro.
  { name: "ALL_TEAMS + acesso ativo → só quem tem conta ativa (conta desativada e sem conta ficam fora)", population: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, populationFilter: null, operatingUniverse: null, requireActiveAccess: true }, eligible: [JOAO, PEDRO, RITA] },
  { name: "TEAM FATURAS + acesso ativo → só João (Maria tem conta desativada)", population: { scopeType: "TEAM", teamId: TEAM_FATURAS, subteamId: null, populationFilter: null, operatingUniverse: null, requireActiveAccess: true }, eligible: [JOAO] },
  { name: "SUBTEAM PREMIUM + acesso ativo → Pedro e Rita (Tiago sem conta)", population: { scopeType: "SUBTEAM", teamId: null, subteamId: SUB_PREMIUM, populationFilter: null, operatingUniverse: null, requireActiveAccess: true }, eligible: [PEDRO, RITA] },
  { name: "SUBTEAM PREMIUM + Filtro Equipe do Carlos + acesso ativo → só Rita", population: { scopeType: "SUBTEAM", teamId: null, subteamId: SUB_PREMIUM, populationFilter: { kind: "SUPERVISOR_TEAM", supervisorId: CARLOS }, operatingUniverse: null, requireActiveAccess: true }, eligible: [RITA] },
  { name: "ALL_TEAMS + Filtro Colaborador específico SEM conta + acesso ativo → ninguém", population: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, populationFilter: { kind: "EMPLOYEE", employeeId: MARIA }, operatingUniverse: null, requireActiveAccess: true }, eligible: [] },
  { name: "ALL_TEAMS + Filtro Subgrupo BÁSICO + acesso ativo → ninguém (Lucas e Bia sem conta)", population: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, populationFilter: { kind: "SUBTEAM", subteamId: SUB_BASICO }, operatingUniverse: null, requireActiveAccess: true }, eligible: [] },
]

describe("Elegibilidade organizacional — paridade decisão pontual (ingestão/QA) × conjunto (agendador/QA)", () => {
  for (const scenario of cases) {
    it(scenario.name, async () => {
      const { db } = fakeDatabase()
      const set = await resolveEligibleOperatorIds(db, ORG, scenario.population)
      expect([...set].sort()).toEqual([...scenario.eligible].sort())
      for (const operatorId of OPERATORS) {
        const point = await isOperatorEligibleForWorkflow(db, ORG, scenario.population, operatorId)
        expect(point, `operador ${operatorId}`).toBe(set.includes(operatorId))
      }
      // Inativo nunca é elegível em nenhuma forma.
      expect(set).not.toContain(INATIVO)
      expect(await isOperatorEligibleForWorkflow(db, ORG, scenario.population, INATIVO)).toBe(false)
    })
  }

  it("scope_type desconhecido não elege ninguém em nenhuma das duas formas", async () => {
    const { db } = fakeDatabase()
    const population = { scopeType: "REGION", teamId: null, subteamId: null, populationFilter: null, operatingUniverse: null, requireActiveAccess: false }
    expect(await resolveEligibleOperatorIds(db, ORG, population)).toEqual([])
    expect(await isOperatorEligibleForWorkflow(db, ORG, population, JOAO)).toBe(false)
  })
})

describe("População de comparação — nunca usa o corte de acesso", () => {
  it("comparisonPopulationOf devolve a Abrangência ∩ Filtro inteira, mesmo com a opção ligada no Workflow", async () => {
    const { db } = fakeDatabase()
    const workflowPopulation: WorkflowPopulation = { scopeType: "SUBTEAM", teamId: null, subteamId: SUB_PREMIUM, populationFilter: null, operatingUniverse: null, requireActiveAccess: true }
    // Quem ENTRA: só quem tem acesso. Com quem a pessoa é COMPARADA (quartil, ranking): o Subgrupo inteiro.
    expect((await resolveEligibleOperatorIds(db, ORG, workflowPopulation)).sort()).toEqual([PEDRO, RITA].sort())
    const comparison = comparisonPopulationOf(workflowPopulation)
    expect(comparison.requireActiveAccess).toBe(false)
    expect((await resolveEligibleOperatorIds(db, ORG, comparison)).sort()).toEqual([PEDRO, RITA, TIAGO].sort())
  })
})

describe("Ingestão por Flag — matrícula produtiva respeita Abrangência + Filtro Populacional (ponta a ponta, sem IA)", () => {
  const publish = (overrides: Partial<WorkflowRow>): WorkflowRow => ({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    active_version_id: "77777777-7777-4777-8777-777777777777",
    active: true,
    scope_type: "ALL_TEAMS",
    team_id: null,
    subteam_id: null,
    population_filter: null,
    channelFlagId: FLAG,
    ...overrides,
  })
  const event = (operatorId: string) => ({ organizationId: ORG, interactionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", operatorId, channelFlagId: FLAG, flagName: "rechamada", value: true as const })

  it("SUBTEAM: operador do Subgrupo matricula; mesmo Grupo mas outro Subgrupo não (antes SUBTEAM nunca disparava)", async () => {
    const { db, enrollments } = fakeDatabase([publish({ scope_type: "SUBTEAM", subteam_id: SUB_PREMIUM })])
    expect(await enrollFlagWorkflows(db, event(PEDRO))).toBe(1)
    expect(await enrollFlagWorkflows(db, event(LUCAS))).toBe(0)
    expect(enrollments).toEqual([{ workflowId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", interactionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", flagName: "rechamada" }])
  })

  it("Filtro Populacional (Equipe do Supervisor Carlos): João matricula, Maria (mesmo Grupo, equipe da Ana) não (antes o filtro era ignorado)", async () => {
    const { db, enrollments } = fakeDatabase([publish({ scope_type: "TEAM", team_id: TEAM_FATURAS, population_filter: { kind: "SUPERVISOR_TEAM", supervisorId: CARLOS } })])
    expect(await enrollFlagWorkflows(db, event(JOAO))).toBe(1)
    expect(await enrollFlagWorkflows(db, event(MARIA))).toBe(0)
    expect(enrollments).toHaveLength(1)
  })

  it("Somente quem tem acesso ativo: com conta ativa matricula; sem conta, com conta desativada ou inativo no cadastro, não", async () => {
    const { db, enrollments } = fakeDatabase([publish({ scope_type: "TEAM", team_id: TEAM_FATURAS, require_active_access: true })])
    expect(await enrollFlagWorkflows(db, event(JOAO))).toBe(1) // conta ativa
    expect(await enrollFlagWorkflows(db, event(MARIA))).toBe(0) // conta desativada
    expect(await enrollFlagWorkflows(db, event(INATIVO))).toBe(0) // conta ativa, cadastro inativo
    expect(enrollments).toHaveLength(1)
    // A mesma pessoa sem conta entra num Workflow que não liga a opção (padrão: desligada).
    const off = fakeDatabase([publish({ scope_type: "TEAM", team_id: TEAM_FATURAS })])
    expect(await enrollFlagWorkflows(off.db, event(MARIA))).toBe(1)
  })

  it("TEAM: operador de outro Grupo não matricula; ALL_TEAMS matricula qualquer operador ativo; inativo nunca", async () => {
    const team = fakeDatabase([publish({ scope_type: "TEAM", team_id: TEAM_FATURAS })])
    expect(await enrollFlagWorkflows(team.db, event(JOAO))).toBe(1)
    expect(await enrollFlagWorkflows(team.db, event(PEDRO))).toBe(0)
    const all = fakeDatabase([publish({})])
    expect(await enrollFlagWorkflows(all.db, event(PEDRO))).toBe(1)
    expect(await enrollFlagWorkflows(all.db, event(INATIVO))).toBe(0)
  })

  it("só Workflows publicados/ativos com ESTA flag são candidatos; a semântica do gatilho (flag/valor) segue com o motor", async () => {
    const { db, enrollments } = fakeDatabase([
      publish({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", active_version_id: null }), // rascunho
      publish({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", channelFlagId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc9" }), // outra flag
      publish({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3" }),
    ])
    expect(await enrollFlagWorkflows(db, event(JOAO))).toBe(1)
    expect(enrollments.map((row) => row.workflowId)).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"])
  })
})

describe("Ingestão por Indicador — matrícula produtiva respeita Abrangência + Filtro Populacional (mesma regra do Flag, sem IA)", () => {
  const publish = (overrides: Partial<WorkflowRow>): WorkflowRow => ({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
    active_version_id: "77777777-7777-4777-8777-777777777777",
    active: true,
    scope_type: "ALL_TEAMS",
    team_id: null,
    subteam_id: null,
    population_filter: null,
    indicatorCode: "QUALIDADE",
    ...overrides,
  })
  const measurement = (operatorId: string, indicatorCode = "QUALIDADE") => ({ organizationId: ORG, measurementId: "mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm", operatorId, indicatorCode, value: 72 })

  it("ALL_TEAMS: operador ativo matricula; inativo nunca", async () => {
    const { db, enrollments } = fakeDatabase([publish({})])
    expect(await enrollIndicatorWorkflows(db, measurement(PEDRO))).toBe(1)
    expect(await enrollIndicatorWorkflows(db, measurement(INATIVO))).toBe(0)
    expect(enrollments).toEqual([{ workflowId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", measurementId: "mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm", value: 72 }])
  })

  it("TEAM FATURAS: operador FATURAS sim; RETENÇÃO não", async () => {
    const { db } = fakeDatabase([publish({ scope_type: "TEAM", team_id: TEAM_FATURAS })])
    expect(await enrollIndicatorWorkflows(db, measurement(JOAO))).toBe(1)
    expect(await enrollIndicatorWorkflows(db, measurement(PEDRO))).toBe(0)
  })

  it("SUBTEAM PREMIUM: Pedro (PREMIUM) sim; Lucas (mesmo Grupo, BÁSICO) não — antes SUBTEAM nunca disparava", async () => {
    const { db } = fakeDatabase([publish({ scope_type: "SUBTEAM", subteam_id: SUB_PREMIUM })])
    expect(await enrollIndicatorWorkflows(db, measurement(PEDRO))).toBe(1)
    expect(await enrollIndicatorWorkflows(db, measurement(LUCAS))).toBe(0)
  })

  it("TEAM FATURAS + Filtro Equipe do Carlos: João sim; Maria (equipe da Ana) não — antes o filtro era ignorado", async () => {
    const { db } = fakeDatabase([publish({ scope_type: "TEAM", team_id: TEAM_FATURAS, population_filter: { kind: "SUPERVISOR_TEAM", supervisorId: CARLOS } })])
    expect(await enrollIndicatorWorkflows(db, measurement(JOAO))).toBe(1)
    expect(await enrollIndicatorWorkflows(db, measurement(MARIA))).toBe(0)
  })

  it("ponta a ponta — SUBTEAM PREMIUM + Filtro Equipe do Carlos: PREMIUM+Carlos inicia; PREMIUM+Ana não; BÁSICO+Carlos não (interseção)", async () => {
    const { db, enrollments } = fakeDatabase([publish({ scope_type: "SUBTEAM", subteam_id: SUB_PREMIUM, population_filter: { kind: "SUPERVISOR_TEAM", supervisorId: CARLOS } })])
    expect(await enrollIndicatorWorkflows(db, measurement(RITA))).toBe(1)
    expect(await enrollIndicatorWorkflows(db, measurement(TIAGO))).toBe(0)
    expect(await enrollIndicatorWorkflows(db, measurement(BIA))).toBe(0)
    expect(enrollments).toHaveLength(1)
  })

  it("Filtro Colaborador específico (João): só João; Maria não", async () => {
    const { db } = fakeDatabase([publish({ population_filter: { kind: "EMPLOYEE", employeeId: JOAO } })])
    expect(await enrollIndicatorWorkflows(db, measurement(JOAO))).toBe(1)
    expect(await enrollIndicatorWorkflows(db, measurement(MARIA))).toBe(0)
  })

  it("Workflow compatível mas inativo/não publicado não dispara; indicador diferente não dispara; a Condition segue com o motor", async () => {
    const { db, enrollments } = fakeDatabase([
      publish({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", active_version_id: null }),
      publish({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", active: false }),
      publish({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", indicatorCode: "TMA" }),
      publish({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4" }),
    ])
    expect(await enrollIndicatorWorkflows(db, measurement(JOAO))).toBe(1)
    expect(enrollments.map((row) => row.workflowId)).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4"])
  })

  it("vários Workflows candidatos pra mesma medição: o operador é carregado UMA vez", async () => {
    const { db, log } = fakeDatabase([publish({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1" }), publish({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2" }), publish({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3" })])
    expect(await enrollIndicatorWorkflows(db, measurement(JOAO))).toBe(3)
    expect(log.filter((sql) => sql.startsWith("select p.id, p.team_id, p.subteam_id, p.reports_to_id"))).toHaveLength(1)
  })
})

describe("Paridade Flag × Indicador × QA Lab — a elegibilidade organizacional não depende do Trigger", () => {
  const populations = cases.map((scenario) => scenario.population)
  const publishBoth = (population: WorkflowPopulation): WorkflowRow[] => [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf", active_version_id: "77777777-7777-4777-8777-777777777777", active: true, scope_type: population.scopeType, scope_links: population.scopeLinks ?? undefined, team_id: population.teamId, subteam_id: population.subteamId, population_filter: population.populationFilter, require_active_access: population.requireActiveAccess, channelFlagId: FLAG },
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaai", active_version_id: "77777777-7777-4777-8777-777777777777", active: true, scope_type: population.scopeType, scope_links: population.scopeLinks ?? undefined, team_id: population.teamId, subteam_id: population.subteamId, population_filter: population.populationFilter, require_active_access: population.requireActiveAccess, indicatorCode: "QUALIDADE" },
  ]

  it("para a mesma Abrangência + Filtro + operador, Flag e Indicador matriculam (ou não) igual — e igual ao que o QA Lab considera elegível", async () => {
    for (const population of populations) {
      const { db } = fakeDatabase(publishBoth(population))
      // O que o QA Lab mostra como elegível (seletor de colaborador / interações compatíveis).
      const qaEligible = new Set(await resolveEligibleOperatorIds(db, ORG, population))
      for (const operatorId of OPERATORS) {
        const byFlag = await enrollFlagWorkflows(db, { organizationId: ORG, interactionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", operatorId, channelFlagId: FLAG, flagName: "rechamada", value: true })
        const byIndicator = await enrollIndicatorWorkflows(db, { organizationId: ORG, measurementId: "mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm", operatorId, indicatorCode: "QUALIDADE", value: 1 })
        const expected = qaEligible.has(operatorId) ? 1 : 0
        expect(byFlag, `flag · ${JSON.stringify(population)} · ${operatorId}`).toBe(expected)
        expect(byIndicator, `indicador · ${JSON.stringify(population)} · ${operatorId}`).toBe(expected)
      }
    }
  })
})

/**
 * Matrícula em lote (Central de Dados): as leituras que não dependem da linha — candidatos, operador, estratégia, grafo,
 * membros da estrutura — são lembradas pelo lote inteiro. As matrículas gravadas precisam ser EXATAMENTE as do caminho evento a
 * evento (mesmas linhas, mesma ordem), com bem menos consultas.
 */
describe("Matrícula em lote — leituras lembradas pelo lote, mesmas matrículas", () => {
  const suffix = (index: number) => String(index).padStart(12, "0")
  const workflows: WorkflowRow[] = cases.flatMap((scenario, index) => [
    { id: `aaaaaaaa-aaaa-4aaa-8aaa-${suffix(index)}`, active_version_id: `77777777-7777-4777-8777-${suffix(index)}`, active: true, scope_type: scenario.population.scopeType, scope_links: scenario.population.scopeLinks ?? undefined, team_id: scenario.population.teamId, subteam_id: scenario.population.subteamId, population_filter: scenario.population.populationFilter, channelFlagId: FLAG },
    { id: `bbbbbbbb-bbbb-4bbb-8bbb-${suffix(index)}`, active_version_id: `88888888-8888-4888-8888-${suffix(index)}`, active: true, scope_type: scenario.population.scopeType, scope_links: scenario.population.scopeLinks ?? undefined, team_id: scenario.population.teamId, subteam_id: scenario.population.subteamId, population_filter: scenario.population.populationFilter, require_active_access: scenario.population.requireActiveAccess, indicatorCode: index % 2 === 0 ? "QUALIDADE" : "TMA" },
  ])
  // Um lote: cada pessoa com várias medições (dois indicadores com Workflow, um sem) e várias flags — como numa carga real.
  const events = [0, 1, 2].flatMap((day) => [...OPERATORS, CARLOS].flatMap((operatorId) => ["QUALIDADE", "TMA", "SEM_WORKFLOW"].map((indicatorCode) => ({ day, operatorId, indicatorCode }))))

  async function runBatch(shared: boolean) {
    const fake = fakeDatabase(workflows)
    const lookups = shared ? createEnrollmentLookups(fake.db) : undefined
    let enrolled = 0
    for (const [index, event] of events.entries()) {
      const id = `mmmmmmmm-mmmm-4mmm-8mmm-${suffix(index)}`
      enrolled += await enrollIndicatorWorkflows(fake.db, { organizationId: ORG, measurementId: id, operatorId: event.operatorId, indicatorCode: event.indicatorCode, value: event.day }, lookups)
      enrolled += await enrollFlagWorkflows(fake.db, { organizationId: ORG, interactionId: id, operatorId: event.operatorId, channelFlagId: FLAG, flagName: "rechamada", value: event.day > 0 }, lookups)
    }
    const inserts = fake.log.filter((sql) => sql.startsWith("insert into workflow_enrollments")).length
    return { enrolled, enrollments: fake.enrollments, reads: fake.log.length - inserts, inserts }
  }

  it("mesmas matrículas, na mesma ordem; cada leitura uma vez por chave no lote", async () => {
    const perEvent = await runBatch(false)
    const batched = await runBatch(true)
    expect(perEvent.enrolled).toBeGreaterThan(50)
    expect(batched.enrollments).toEqual(perEvent.enrollments)
    expect(batched.enrolled).toBe(perEvent.enrolled)
    expect(batched.inserts).toBe(perEvent.inserts)
    expect(batched.reads).toBeLessThan(perEvent.reads / 5)
  })
})
