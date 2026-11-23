import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import {
  resolveDirectReportOperatorIds,
  resolvePopulationFilterOperatorIds,
  resolveScopeOperatorIds,
  resolveStructureAnchorOperatorIds,
  resolveStructureOperatorIds,
  resolveSubteamOperatorIds,
  resolveTeamOperatorIds,
} from "./hierarchy-subjects.js"

function fakeDb(handler: (sql: string, params?: unknown[]) => { rows: unknown[] }) {
  return { query: vi.fn(async (sql: string, params?: unknown[]) => ({ ...handler(sql, params), rowCount: 0 })) } as unknown as Database
}

describe("resolveDirectReportOperatorIds — Equipe de Supervisor", () => {
  it("retorna só quem reporta DIRETAMENTE ao supervisor, nunca uma estrutura mais funda", async () => {
    const db = fakeDb((sql) => {
      expect(sql).toContain("reports_to_id = $1 and role = 'OPERATOR'")
      return { rows: [{ id: "op-1" }, { id: "op-2" }] }
    })
    const ids = await resolveDirectReportOperatorIds(db, "supervisor-1")
    expect(ids).toEqual(["op-1", "op-2"])
  })
})

describe("resolveStructureOperatorIds — Estrutura de Coordenador/Gerente/etc.", () => {
  it("desce a hierarquia recursivamente até os operadores, mesmo com um Supervisor no meio", async () => {
    const db = fakeDb((sql) => {
      expect(sql).toContain("with recursive subordinates")
      return { rows: [{ id: "op-1" }, { id: "op-2" }, { id: "op-3" }] }
    })
    const ids = await resolveStructureOperatorIds(db, "coordinator-1")
    expect(ids).toEqual(["op-1", "op-2", "op-3"])
  })
})

describe("resolveTeamOperatorIds / resolveSubteamOperatorIds — Grupo/Subgrupo", () => {
  it("resolve operadores por team_id", async () => {
    const db = fakeDb(() => ({ rows: [{ id: "op-1" }] }))
    expect(await resolveTeamOperatorIds(db, "team-1")).toEqual(["op-1"])
  })

  it("resolve operadores por subteam_id", async () => {
    const db = fakeDb(() => ({ rows: [{ id: "op-1" }] }))
    expect(await resolveSubteamOperatorIds(db, "subteam-1")).toEqual(["op-1"])
  })
})

describe("resolveStructureAnchorOperatorIds — despacho conforme a Estrutura (Consolidada ou parte do Filtro Populacional)", () => {
  it("SUPERVISOR_TEAM sem anchorId (nunca deveria acontecer, mas não inventa sujeito) devolve vazio", async () => {
    const db = fakeDb(() => ({ rows: [{ id: "op-1" }] }))
    expect(await resolveStructureAnchorOperatorIds(db, { kind: "SUPERVISOR_TEAM", supervisorId: "sup-1" }, null)).toEqual([])
  })

  it("SUBTEAM/TEAM não dependem de anchorId — o próprio structure já carrega o id do grupo", async () => {
    const db = fakeDb(() => ({ rows: [{ id: "op-1" }] }))
    expect(await resolveStructureAnchorOperatorIds(db, { kind: "SUBTEAM", subteamId: "subteam-1" }, null)).toEqual(["op-1"])
    expect(await resolveStructureAnchorOperatorIds(db, { kind: "TEAM", teamId: "team-1" }, null)).toEqual(["op-1"])
  })
})

describe("resolveScopeOperatorIds — todo operador ativo elegível pela Abrangência", () => {
  it("usa scope_type/team_id do Workflow — ALL_TEAMS ignora o team_id", async () => {
    const db = fakeDb((sql) => {
      expect(sql).toContain("role = 'OPERATOR' and active")
      return { rows: [{ id: "op-1" }, { id: "op-2" }] }
    })
    expect(await resolveScopeOperatorIds(db, "org-1", { scopeType: "ALL_TEAMS", teamId: null, operatingUniverse: null, requireActiveAccess: false })).toEqual(["op-1", "op-2"])
  })

  it('"Somente quem tem acesso ativo à INIA" exige conta de acesso ativa — e só quando o chamador pede', async () => {
    const seen: unknown[][] = []
    const db = fakeDb((sql, params) => {
      // A exigência é condicional ao parâmetro: desligada, a consulta devolve a população inteira.
      expect(sql).toContain("not $6::boolean or exists (select 1 from user_accounts ua where ua.person_id = people.id and ua.organization_id = people.organization_id and ua.active)")
      seen.push(params ?? [])
      return { rows: [{ id: "op-1" }] }
    })
    await resolveScopeOperatorIds(db, "org-1", { scopeType: "TEAM", teamId: "team-1", operatingUniverse: null, requireActiveAccess: true })
    await resolveScopeOperatorIds(db, "org-1", { scopeType: "TEAM", teamId: "team-1", operatingUniverse: null, requireActiveAccess: false })
    expect(seen.map((params) => params[5])).toEqual([true, false])
  })
})

describe("resolvePopulationFilterOperatorIds — Filtro Populacional (modo Individual)", () => {
  const scope = { scopeType: "TEAM", teamId: "team-1", operatingUniverse: null, requireActiveAccess: false }

  it("ausente (null) = ALL — todo operador ativo elegível pela Abrangência", async () => {
    const db = fakeDb((sql) => {
      expect(sql).toContain("role = 'OPERATOR' and active")
      return { rows: [{ id: "op-1" }, { id: "op-2" }] }
    })
    expect(await resolvePopulationFilterOperatorIds(db, "org-1", null, scope)).toEqual(["op-1", "op-2"])
  })

  it("kind ALL explícito tem o mesmo efeito de ausente", async () => {
    const db = fakeDb(() => ({ rows: [{ id: "op-1" }] }))
    expect(await resolvePopulationFilterOperatorIds(db, "org-1", { kind: "ALL" }, scope)).toEqual(["op-1"])
  })

  it("EMPLOYEE devolve só aquela pessoa — e só se ela também está na Abrangência (Abrangência E filtro)", async () => {
    const db = fakeDb(() => ({ rows: [{ id: "person-1" }, { id: "op-2" }] }))
    expect(await resolvePopulationFilterOperatorIds(db, "org-1", { kind: "EMPLOYEE", employeeId: "person-1" }, scope)).toEqual(["person-1"])
    const outside = fakeDb(() => ({ rows: [{ id: "op-2" }] }))
    expect(await resolvePopulationFilterOperatorIds(outside, "org-1", { kind: "EMPLOYEE", employeeId: "person-1" }, scope)).toEqual([])
  })

  it("estruturas (Equipe de Supervisor/Subgrupo/Grupo/Coordenador/...) reaproveitam a mesma resolução do modo Consolidado — nunca vira análise agregada, só filtra quem participa (dentro da Abrangência)", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("role = 'OPERATOR' and active")) return { rows: [{ id: "op-1" }, { id: "op-2" }, { id: "op-9" }] }
      expect(sql).toContain("reports_to_id = $1 and role = 'OPERATOR'")
      return { rows: [{ id: "op-1" }, { id: "op-2" }, { id: "op-outro-grupo" }] }
    })
    expect(await resolvePopulationFilterOperatorIds(db, "org-1", { kind: "SUPERVISOR_TEAM", supervisorId: "sup-1" }, scope)).toEqual(["op-1", "op-2"])
  })

  it("SUBTEAM (legado) casa por subteam_id (nunca pelo Grupo inteiro)", async () => {
    const db = fakeDb((sql, params) => {
      expect(sql).toContain("people.subteam_id = any($4::uuid[])")
      expect(params).toEqual(["org-1", false, [], ["sub-1"], null, false])
      return { rows: [{ id: "op-1" }] }
    })
    expect(await resolveScopeOperatorIds(db, "org-1", { scopeType: "SUBTEAM", teamId: null, subteamId: "sub-1", operatingUniverse: null, requireActiveAccess: false })).toEqual(["op-1"])
  })

  it("GROUPS (249): Grupo inteiro por team_id, Subgrupo só por subteam_id — uma condição sobre a linha da pessoa (cada uma uma vez)", async () => {
    const db = fakeDb((sql, params) => {
      expect(sql).toContain("people.team_id = any($3::uuid[])")
      expect(sql).not.toContain("join")
      expect(params).toEqual(["org-1", false, ["team-a"], ["sub-b1"], null, false])
      return { rows: [{ id: "op-1" }] }
    })
    const scope = { scopeType: "GROUPS", scopeLinks: [{ teamId: "team-a", subteamId: null }, { teamId: "team-b", subteamId: "sub-b1" }], operatingUniverse: null, requireActiveAccess: false }
    expect(await resolveScopeOperatorIds(db, "org-1", scope)).toEqual(["op-1"])
  })

  it("ALL_TEAMS não carrega Grupo nenhum (todos, inclusive os criados depois); GROUPS sem vínculo não alcança ninguém", async () => {
    const seen: unknown[][] = []
    const db = fakeDb((_sql, params) => {
      seen.push(params ?? [])
      return { rows: [] }
    })
    await resolveScopeOperatorIds(db, "org-1", { scopeType: "ALL_TEAMS", operatingUniverse: null, requireActiveAccess: false })
    await resolveScopeOperatorIds(db, "org-1", { scopeType: "GROUPS", scopeLinks: [], operatingUniverse: null, requireActiveAccess: false })
    expect(seen).toEqual([
      ["org-1", true, [], [], null, false],
      ["org-1", false, [], [], null, false],
    ])
  })
})
