import { describe, expect, it } from "vitest"
import { rolesWithPermission } from "../../access/domain/roles.js"
import { anjosCovering, anjosInServiceCount } from "./eligibility.js"
import { coverageClause, coordinatorScopesOf, coversRecord } from "./coverage.js"

/**
 * UNIVERSO DE ATUAÇÃO NO APOIO (auditoria HS-01): com a exigência ativada, Anjo de outro universo não recebe, não conta como em serviço
 * e o Coordenador de outro universo não lê o pedido; o Anjo com `operating_universes.all` cobrindo o lugar continua elegível; com a
 * exigência desligada nada muda. Banco falso: responde pelas consultas que o módulo faz (papéis, ativação, universo, presença).
 */
const ORG = "org-1"
const TEAM = "team-1"
const PLACE = { teamId: TEAM, subteamId: null }
const ATTEND_ROLES = rolesWithPermission("human_support.attend")
const ALL_ROLES = rolesWithPermission("operating_universes.all")
const COORDINATE_ROLES = rolesWithPermission("human_support.coordinate")

type Fixture = {
  enforced: boolean
  universes: Record<string, string | null>
  /** Quem tem o papel de Anjo cobrindo o lugar. */
  anjos: string[]
  /** Quem tem `operating_universes.all` cobrindo o lugar (escopo de Grupo). */
  allUniverses: string[]
  /** Coordenadores com escopo de Grupo. */
  coordinators?: string[]
}

function fakeDb(fixture: Fixture) {
  const sameRoles = (a: unknown, b: string[]) => Array.isArray(a) && a.length === b.length && b.every((role) => a.includes(role))
  return {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("operating_universe_enforced_at")) return { rows: [{ enforced: fixture.enforced }] }
      if (sql.includes("select id, operating_universe from people")) return { rows: (params[1] as string[]).filter((id) => id in fixture.universes).map((id) => ({ id, operating_universe: fixture.universes[id] })) }
      if (sql.includes("select operating_universe from people where id = $1")) return { rows: params[0] as string in fixture.universes ? [{ operating_universe: fixture.universes[params[0] as string] }] : [] }
      if (sql.includes("from access_role_assignments")) {
        const holders = sameRoles(params[1], ATTEND_ROLES) ? fixture.anjos : sameRoles(params[1], ALL_ROLES) ? fixture.allUniverses : sameRoles(params[1], COORDINATE_ROLES) ? (fixture.coordinators ?? []) : []
        // assignmentScopesOf (lista de pessoas em $3) devolve os escopos; personIdsWithPermissionCovering, os ids.
        if (sql.includes("a.scope_type <> 'MY_STRUCTURE'")) return { rows: holders.filter((id) => (params[2] as string[]).includes(id)).map((id) => ({ person_id: id, scope_type: "GROUP", team_id: TEAM, subteam_id: null, subteam_team_id: null })) }
        return { rows: holders.map((id) => ({ id })) }
      }
      if (sql.includes("from unnest($2::uuid[])")) return { rows: (params[1] as string[]).map((id) => ({ person_id: id, status: "AVAILABLE", pause_reason: null, max_concurrent: null, connected: true, last_assigned_at: null, active_count: 0, scheduled: false })) }
      if (sql.includes("from human_support_agent_presence where organization_id = $1 and person_id = any")) return { rows: [{ total: (params[1] as string[]).length }] }
      throw new Error(`consulta inesperada no banco falso: ${sql.slice(0, 80)}`)
    },
  }
}

const ids = async (fixture: Fixture, operator = "op-b2b") => (await anjosCovering(fakeDb(fixture) as never, ORG, PLACE, operator, 2)).map((anjo) => anjo.personId)

describe("Apoio com Anjo × universo de atuação — Anjos elegíveis", () => {
  const base = { universes: { "op-b2b": "B2B", "anjo-b2b": "B2B", "anjo-b2c": "B2C", "anjo-todos": "B2C", "anjo-pendente": null }, anjos: ["anjo-b2b", "anjo-b2c", "anjo-todos", "anjo-pendente"], allUniverses: ["anjo-todos"] }

  it("exigência ativada: o Anjo de outro universo (e o pendente) sai; o do mesmo universo fica", async () => {
    expect(await ids({ ...base, enforced: true })).toEqual(["anjo-b2b", "anjo-todos"])
  })

  it("o Anjo com a permissão de todos os universos cobrindo o lugar continua elegível, mesmo com outro universo no cadastro", async () => {
    expect(await ids({ ...base, enforced: true, anjos: ["anjo-todos"] })).toEqual(["anjo-todos"])
  })

  it("operador pendente (sem universo) só é atendido por quem tem a permissão de todos", async () => {
    expect(await ids({ ...base, enforced: true, universes: { ...base.universes, "op-b2b": null } })).toEqual(["anjo-todos"])
  })

  it("exigência desligada: comportamento anterior (todos os Anjos do lugar, fora o operador)", async () => {
    expect(await ids({ ...base, enforced: false })).toEqual(["anjo-b2b", "anjo-b2c", "anjo-todos", "anjo-pendente"])
    expect(await ids({ ...base, enforced: false, anjos: [...base.anjos, "op-b2b"] })).not.toContain("op-b2b")
  })

  it("'em serviço' (fila e ninguém em serviço) conta só os Anjos do universo do operador", async () => {
    expect(await anjosInServiceCount(fakeDb({ ...base, enforced: true }) as never, ORG, PLACE, "op-b2b")).toBe(2)
    expect(await anjosInServiceCount(fakeDb({ ...base, enforced: false }) as never, ORG, PLACE, "op-b2b")).toBe(4)
  })
})

describe("Apoio com Anjo × universo de atuação — alcance de quem acompanha", () => {
  const record = (operatorUniverse: "B2B" | "B2C" | null) => ({ teamId: TEAM, subteamId: null, operatorUniverse })
  const coverageFor = (fixture: Partial<Fixture> & { enforced: boolean }, coordinator: string) =>
    coordinatorScopesOf(fakeDb({ universes: {}, anjos: [], allUniverses: [], coordinators: [coordinator], ...fixture }) as never, ORG, coordinator)

  it("exigência ativada: o Coordenador B2C não alcança o pedido do operador B2B (detalhe e transferência dão 404)", async () => {
    const coverage = await coverageFor({ enforced: true, universes: { coord: "B2C" } }, "coord")
    expect(coversRecord(coverage, record("B2B"))).toBe(false)
    expect(coversRecord(coverage, record("B2C"))).toBe(true)
    expect(coversRecord(coverage, record(null))).toBe(false)
  })

  it("com a permissão de todos os universos no Grupo do pedido, alcança qualquer universo", async () => {
    const coverage = await coverageFor({ enforced: true, universes: { coord: "B2C" }, allUniverses: ["coord"] }, "coord")
    expect(coversRecord(coverage, record("B2B"))).toBe(true)
    expect(coversRecord(coverage, record(null))).toBe(true)
  })

  it("exigência desligada: só o escopo decide, como antes", async () => {
    const coverage = await coverageFor({ enforced: false, universes: { coord: "B2C" } }, "coord")
    expect(coversRecord(coverage, record("B2B"))).toBe(true)
    const params: unknown[] = [ORG]
    expect(coverageClause(coverage, "r", params, {}, "operator_person_id")).not.toContain("operating_universe")
  })

  it("listas e números: a cláusula SQL filtra pelo universo do operador do registro (parâmetro, nunca texto)", async () => {
    const coverage = await coverageFor({ enforced: true, universes: { coord: "B2C" } }, "coord")
    const params: unknown[] = [ORG]
    const clause = coverageClause(coverage, "e", params, {}, "person_id")
    expect(clause).toContain("up.id = e.person_id and up.operating_universe = $")
    expect(params).toContain("B2C")
  })
})
