import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { AccessAssignment, AccessContext } from "../../access/domain/access-decision.js"
import { personRuleFor } from "../../operating-universe/application/universe-access.js"
import { reachableImpactPeople, type ImpactPopulationPerson } from "./impact-preview.js"
import { loadTeamOverview } from "./team-overview.js"

/**
 * POL-03 — o universo de atuação de quem consulta vale para intervenções (decisão do responsável): na visão da equipe e na
 * prévia de impacto, o que vem dos PAPÉIS (organização, Grupo, Subgrupo) só alcança pessoas do universo de quem vê — a não ser
 * com `operating_universes.all` no escopo. A própria estrutura e a organização sem universos ativados não mudam.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const VIEWER = "11111111-1111-4111-8111-111111111111"
const TEAM_B2B = "22222222-2222-4222-8222-222222222222"

const ORGANIZATION = { type: "ORGANIZATION" } as const
const assignment = (roleCode: string, scope: AccessAssignment["scope"] = ORGANIZATION): AccessAssignment => ({ id: `${roleCode}:${scope.type}`, roleCode, scope })
const accessWith = (...assignments: AccessAssignment[]): AccessContext => ({ organizationId: ORG, accountId: "33333333-3333-4333-8333-333333333333", personId: VIEWER, assignments })

function fakeDatabase(input: { enforced: boolean; own: string | null }) {
  const interventionQueries: { sql: string; params: unknown[] }[] = []
  const query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes("operating_universe_enforced_at")) return { rows: [{ enforced: input.enforced }], rowCount: 1 }
    if (sql.includes("select operating_universe from people")) return { rows: [{ operating_universe: input.own }], rowCount: 1 }
    if (sql.includes("from interventions i")) interventionQueries.push({ sql: sql.replace(/\s+/g, " "), params })
    return { rows: [], rowCount: 0 }
  }
  return { db: { query } as unknown as Database, interventionQueries }
}

const universeOf = (params: unknown[]) => params.slice(6, 10)

describe("visão da equipe × universo de atuação (POL-03)", () => {
  it("analista B2C com escopo de organização: as três consultas restringem o ramo de permissão ao universo dele", async () => {
    const { db, interventionQueries } = fakeDatabase({ enforced: true, own: "B2C" })
    await loadTeamOverview(db, { organizationId: ORG, personId: VIEWER, access: accessWith(assignment("ANALISTA_DE_ACOMPANHAMENTO")) })
    expect(interventionQueries).toHaveLength(3)
    for (const { sql, params } of interventionQueries) {
      // O universo fecha só o que vem dos papéis; estrutura própria e parte da intervenção ficam fora do parêntese.
      expect(sql).toContain("(($3::boolean or p.team_id = any($4::uuid[]) or p.subteam_id = any($5::uuid[])) and ($7::boolean or p.operating_universe = $8::text or p.team_id = any($9::uuid[]) or p.subteam_id = any($10::uuid[]))) or i.person_id in (select id from structure)")
      expect(universeOf(params)).toEqual([false, "B2C", [], []])
    }
  })

  it("universo pendente no cadastro de quem vê: nenhum universo casa (nunca vira 'todos')", async () => {
    const { db, interventionQueries } = fakeDatabase({ enforced: true, own: null })
    await loadTeamOverview(db, { organizationId: ORG, personId: VIEWER, access: accessWith(assignment("ANALISTA_DE_ACOMPANHAMENTO")) })
    expect(universeOf(interventionQueries[0]!.params)).toEqual([false, null, [], []])
  })

  it("`operating_universes.all` na organização continua vendo tudo; num Grupo, só abre aquele Grupo", async () => {
    const all = fakeDatabase({ enforced: true, own: "B2C" })
    await loadTeamOverview(all.db, { organizationId: ORG, personId: VIEWER, access: accessWith(assignment("ANALISTA_DE_ACOMPANHAMENTO"), assignment("ACESSO_A_TODOS_OS_UNIVERSOS")) })
    expect(universeOf(all.interventionQueries[0]!.params)).toEqual([true, "B2C", [], []])

    const group = fakeDatabase({ enforced: true, own: "B2C" })
    await loadTeamOverview(group.db, { organizationId: ORG, personId: VIEWER, access: accessWith(assignment("ANALISTA_DE_ACOMPANHAMENTO"), assignment("ACESSO_A_TODOS_OS_UNIVERSOS", { type: "GROUP", teamId: TEAM_B2B })) })
    expect(universeOf(group.interventionQueries[0]!.params)).toEqual([false, "B2C", [TEAM_B2B], []])
  })

  it("organização sem universos ativados: nada muda", async () => {
    const { db, interventionQueries } = fakeDatabase({ enforced: false, own: null })
    await loadTeamOverview(db, { organizationId: ORG, personId: VIEWER, access: accessWith(assignment("ANALISTA_DE_ACOMPANHAMENTO")) })
    expect(universeOf(interventionQueries[0]!.params)).toEqual([true, null, [], []])
  })
})

describe("prévia de impacto × universo de atuação (POL-03)", () => {
  const person = (id: string, operatingUniverse: string | null): ImpactPopulationPerson => ({ id, teamId: TEAM_B2B, subteamId: null, operatingUniverse })
  const population = [person("b2c", "B2C"), person("b2b", "B2B"), person("b2b-led", "B2B"), person("pending", null)]
  const reach = (access: AccessContext, enforced: boolean) => reachableImpactPeople({ access, led: new Set(["b2b-led"]), visible: () => true, universe: personRuleFor(access, enforced, "B2C"), population }).map((item) => item.id)

  it("só soma quem é do universo de quem pede — mais a própria estrutura, em qualquer universo", () => {
    expect(reach(accessWith(assignment("GESTOR_DE_POLITICAS_DE_ACOMPANHAMENTO")), true)).toEqual(["b2c", "b2b-led"])
  })

  it("com `operating_universes.all` no escopo soma todos, inclusive quem falta classificar", () => {
    expect(reach(accessWith(assignment("GESTOR_DE_POLITICAS_DE_ACOMPANHAMENTO"), assignment("ACESSO_A_TODOS_OS_UNIVERSOS")), true)).toEqual(["b2c", "b2b", "b2b-led", "pending"])
  })

  it("organização sem universos ativados: a população alcançada é a de antes", () => {
    expect(reach(accessWith(assignment("GESTOR_DE_POLITICAS_DE_ACOMPANHAMENTO")), false)).toEqual(["b2c", "b2b", "b2b-led", "pending"])
  })
})
