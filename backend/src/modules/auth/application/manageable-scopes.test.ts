import { describe, expect, it } from "vitest"
import { canManageScope, normalizeScopedTarget, scopesAreCompatible, type ManageableScopes } from "./manageable-scopes.js"
import type { Database } from "../../../infrastructure/database/pool.js"

const TEAM_A = "11111111-1111-4111-8111-111111111111"
const TEAM_B = "22222222-2222-4222-8222-222222222222"
const SUBTEAM_A1 = "33333333-3333-4333-8333-333333333333"
const SUBTEAM_B1 = "44444444-4444-4444-8444-444444444444"

describe("canManageScope", () => {
  it("allows anything when unrestricted (no role assignments — today's every admin)", () => {
    const scopes: ManageableScopes = { unrestricted: true }
    expect(canManageScope(scopes, { scopeType: "ALL_TEAMS", teamId: null, subteamId: null })).toBe(true)
    expect(canManageScope(scopes, { scopeType: "TEAM", teamId: TEAM_A, subteamId: null })).toBe(true)
  })

  it("allows anything for an admin with an ALL_TEAMS assignment", () => {
    const scopes: ManageableScopes = { unrestricted: false, allTeams: true, teamIds: new Set(), subteamIds: new Set() }
    expect(canManageScope(scopes, { scopeType: "TEAM", teamId: TEAM_B, subteamId: null })).toBe(true)
  })

  it("restricts a team-scoped admin to their team and its subteams, never ALL_TEAMS or another team", () => {
    const scopes: ManageableScopes = {
      unrestricted: false,
      allTeams: false,
      teamIds: new Set([TEAM_A]),
      subteamIds: new Set([SUBTEAM_A1]),
    }
    expect(canManageScope(scopes, { scopeType: "TEAM", teamId: TEAM_A, subteamId: null })).toBe(true)
    expect(canManageScope(scopes, { scopeType: "SUBTEAM", teamId: null, subteamId: SUBTEAM_A1 })).toBe(true)
    expect(canManageScope(scopes, { scopeType: "TEAM", teamId: TEAM_B, subteamId: null })).toBe(false)
    expect(canManageScope(scopes, { scopeType: "ALL_TEAMS", teamId: null, subteamId: null })).toBe(false)
  })

  it("restricts a subteam-scoped admin to exactly that subteam", () => {
    const scopes: ManageableScopes = { unrestricted: false, allTeams: false, teamIds: new Set(), subteamIds: new Set([SUBTEAM_A1]) }
    expect(canManageScope(scopes, { scopeType: "SUBTEAM", teamId: null, subteamId: SUBTEAM_A1 })).toBe(true)
    expect(canManageScope(scopes, { scopeType: "TEAM", teamId: TEAM_A, subteamId: null })).toBe(false)
  })
})

function fakeDb(): Database {
  return {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("from subteams where id = $1")) {
        const id = params?.[0]
        if (id === SUBTEAM_A1) return { rows: [{ team_id: TEAM_A }], rowCount: 1 }
        if (id === SUBTEAM_B1) return { rows: [{ team_id: TEAM_B }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }
      throw new Error(`unexpected query: ${sql}`)
    },
  } as unknown as Database
}

// scopesAreCompatible(referencer, referenced) — achado real desta sessão (auditoria de
// Abrangência/Unidade de Análise): a validação da pessoa-âncora da Unidade de Análise chamava
// esta função com os argumentos TROCADOS (workflow como referencer, pessoa como referenced),
// o que rejeitava qualquer pessoa num workflow com Abrangência "Todos os grupos" — o oposto do
// esperado. Estes testes travam as DUAS direções de uso reais no código: Workflow→Orchestrator
// (referencer = quem CHAMA) e pessoa-âncora→Workflow (referencer = o recurso mais específico,
// "contido" na Abrangência do workflow, que aqui é o `referenced`).
describe("scopesAreCompatible", () => {
  it("um recurso ALL_TEAMS referenciado sempre serve, não importa o escopo de quem referencia", async () => {
    const db = fakeDb()
    const allTeams = { scopeType: "ALL_TEAMS", teamId: null, subteamId: null }
    expect(await scopesAreCompatible(db, { scopeType: "TEAM", teamId: TEAM_A, subteamId: null }, allTeams)).toBe(true)
    expect(await scopesAreCompatible(db, { scopeType: "SUBTEAM", teamId: null, subteamId: SUBTEAM_A1 }, allTeams)).toBe(true)
  })

  it("um referencer ALL_TEAMS só pode referenciar outro recurso ALL_TEAMS", async () => {
    const db = fakeDb()
    const referencer = { scopeType: "ALL_TEAMS", teamId: null, subteamId: null }
    expect(await scopesAreCompatible(db, referencer, { scopeType: "TEAM", teamId: TEAM_A, subteamId: null })).toBe(false)
  })

  it("exige o MESMO time efetivo fora dos casos ALL_TEAMS — SUBTEAM resolve pro time-pai", async () => {
    const db = fakeDb()
    expect(await scopesAreCompatible(db, { scopeType: "TEAM", teamId: TEAM_A, subteamId: null }, { scopeType: "TEAM", teamId: TEAM_A, subteamId: null })).toBe(true)
    expect(await scopesAreCompatible(db, { scopeType: "TEAM", teamId: TEAM_A, subteamId: null }, { scopeType: "TEAM", teamId: TEAM_B, subteamId: null })).toBe(false)
    expect(await scopesAreCompatible(db, { scopeType: "SUBTEAM", teamId: null, subteamId: SUBTEAM_A1 }, { scopeType: "TEAM", teamId: TEAM_A, subteamId: null })).toBe(true)
    expect(await scopesAreCompatible(db, { scopeType: "SUBTEAM", teamId: null, subteamId: SUBTEAM_B1 }, { scopeType: "TEAM", teamId: TEAM_A, subteamId: null })).toBe(false)
  })

  it("direção Workflow → Orchestrator: um Orchestrator de outro time nunca é compatível com um Workflow TEAM", async () => {
    const db = fakeDb()
    const workflow = { scopeType: "TEAM", teamId: TEAM_A, subteamId: null }
    const orchestratorSameTeam = { scopeType: "TEAM", teamId: TEAM_A, subteamId: null }
    const orchestratorOtherTeam = { scopeType: "TEAM", teamId: TEAM_B, subteamId: null }
    expect(await scopesAreCompatible(db, workflow, orchestratorSameTeam)).toBe(true)
    expect(await scopesAreCompatible(db, workflow, orchestratorOtherTeam)).toBe(false)
  })

  it("direção pessoa-âncora → Workflow: qualquer pessoa serve quando o Workflow é Todos os grupos", async () => {
    const db = fakeDb()
    const workflowAllTeams = { scopeType: "ALL_TEAMS", teamId: null, subteamId: null }
    const personTeamA = { scopeType: "TEAM", teamId: TEAM_A, subteamId: null }
    const personTeamB = { scopeType: "TEAM", teamId: TEAM_B, subteamId: null }
    expect(await scopesAreCompatible(db, personTeamA, workflowAllTeams)).toBe(true)
    expect(await scopesAreCompatible(db, personTeamB, workflowAllTeams)).toBe(true)
  })

  it("direção pessoa-âncora → Workflow: rejeita uma pessoa de outro time quando o Workflow é restrito a um time", async () => {
    const db = fakeDb()
    const workflowTeamA = { scopeType: "TEAM", teamId: TEAM_A, subteamId: null }
    expect(await scopesAreCompatible(db, { scopeType: "TEAM", teamId: TEAM_A, subteamId: null }, workflowTeamA)).toBe(true)
    expect(await scopesAreCompatible(db, { scopeType: "TEAM", teamId: TEAM_B, subteamId: null }, workflowTeamA)).toBe(false)
  })
})

describe("normalizeScopedTarget", () => {
  // Subgrupo da organização da sessão: só o A1 (do Grupo A) existe em "org-1".
  const db = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("from subteams where id = $1 and organization_id = $2")) return params?.[0] === SUBTEAM_A1 && params?.[1] === "org-1" ? { rows: [{ team_id: TEAM_A }] } : { rows: [] }
      throw new Error(`unexpected query: ${sql}`)
    },
  } as unknown as Database

  it("Subgrupo grava sempre o Grupo-pai real — mesmo sem teamId enviado", async () => {
    expect(await normalizeScopedTarget(db, "org-1", { scopeType: "SUBTEAM", teamId: null, subteamId: SUBTEAM_A1 })).toEqual({ scopeType: "SUBTEAM", teamId: TEAM_A, subteamId: SUBTEAM_A1 })
    expect(await normalizeScopedTarget(db, "org-1", { scopeType: "SUBTEAM", teamId: TEAM_A, subteamId: SUBTEAM_A1 })).toEqual({ scopeType: "SUBTEAM", teamId: TEAM_A, subteamId: SUBTEAM_A1 })
  })

  it("recusa Subgrupo com o teamId de outro Grupo, de outra organização ou inexistente (achado C02 da 4ª auditoria)", async () => {
    expect(await normalizeScopedTarget(db, "org-1", { scopeType: "SUBTEAM", teamId: TEAM_B, subteamId: SUBTEAM_A1 })).toBeNull()
    expect(await normalizeScopedTarget(db, "org-2", { scopeType: "SUBTEAM", teamId: null, subteamId: SUBTEAM_A1 })).toBeNull()
    expect(await normalizeScopedTarget(db, "org-1", { scopeType: "SUBTEAM", teamId: null, subteamId: SUBTEAM_B1 })).toBeNull()
    expect(await normalizeScopedTarget(db, "org-1", { scopeType: "SUBTEAM", teamId: TEAM_A, subteamId: null })).toBeNull()
  })

  it("TEAM sem Subgrupo e ALL_TEAMS sem ids, sem consultar o banco", async () => {
    expect(await normalizeScopedTarget(db, "org-1", { scopeType: "TEAM", teamId: TEAM_B, subteamId: SUBTEAM_A1 })).toEqual({ scopeType: "TEAM", teamId: TEAM_B, subteamId: null })
    expect(await normalizeScopedTarget(db, "org-1", { scopeType: "ALL_TEAMS", teamId: TEAM_A, subteamId: SUBTEAM_A1 })).toEqual({ scopeType: "ALL_TEAMS", teamId: null, subteamId: null })
  })
})
