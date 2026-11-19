import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { AccessAssignment, AccessContext } from "../../access/domain/access-decision.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { canOpenFor, canSeeInterventionsOf, relationFor } from "./intervention-access.js"
import { listPersonInterventions } from "./intervention-service.js"

/**
 * POL-03 (restante) — o universo de atuação vale também para o acesso POR ID (ficha, lista por caso ou pessoa, detalhe, relatório):
 * o que vem dos PAPÉIS só alcança pessoas do universo de quem vê (ou onde a conta tem `operating_universes.all`). Quem é parte da
 * intervenção ou lidera a pessoa pela estrutura continua vendo; organização sem universos ativados não muda. Fora do universo: 404.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const VIEWER = "11111111-1111-4111-8111-111111111111"
const PERSON = "44444444-4444-4444-8444-444444444444"
const TEAM_B2B = "22222222-2222-4222-8222-222222222222"

const ORGANIZATION = { type: "ORGANIZATION" } as const
const assignment = (roleCode: string, scope: AccessAssignment["scope"] = ORGANIZATION): AccessAssignment => ({ id: `${roleCode}:${scope.type}`, roleCode, scope })
const accessWith = (...assignments: AccessAssignment[]): AccessContext => ({ organizationId: ORG, accountId: "33333333-3333-4333-8333-333333333333", personId: VIEWER, assignments })
const analyst = accessWith(assignment("ANALISTA_DE_ACOMPANHAMENTO"))

function fakeDatabase(input: { enforced: boolean; viewerUniverse: string | null; personUniverse: string | null; inStructure?: boolean }) {
  const universeReads: unknown[] = []
  const query = async (sql: string, params: unknown[] = []) => {
    const text = sql.replace(/\s+/g, " ").trim()
    if (text.includes("operating_universe_enforced_at")) return { rows: [{ enforced: input.enforced }], rowCount: 1 }
    if (text.startsWith("select operating_universe from people")) {
      universeReads.push(params[0])
      return { rows: [{ operating_universe: params[0] === VIEWER ? input.viewerUniverse : input.personUniverse }], rowCount: 1 }
    }
    if (text.startsWith("select id, team_id, subteam_id from people")) return { rows: [{ id: PERSON, team_id: TEAM_B2B, subteam_id: null }], rowCount: 1 }
    if (text.startsWith("with recursive subordinates")) return input.inStructure ? { rows: [{}], rowCount: 1 } : { rows: [], rowCount: 0 }
    return { rows: [], rowCount: 0 }
  }
  return { db: { query } as unknown as Database, universeReads }
}

const parties = (overrides: Partial<Parameters<typeof relationFor>[2]> = {}) => ({ personId: PERSON, responsibleId: "", approverId: null, approvalRecipientIds: [], openedBy: null, acceptedBy: null, ...overrides })

describe("acesso às intervenções de uma pessoa × universo de atuação (POL-03)", () => {
  it("analista B2C com escopo de organização não alcança pessoa B2B: ficha e lista respondem 404", async () => {
    const { db } = fakeDatabase({ enforced: true, viewerUniverse: "B2C", personUniverse: "B2B" })
    expect(await canSeeInterventionsOf(db, analyst, PERSON)).toBe(false)
    expect(await canOpenFor(db, analyst, PERSON)).toBe(false)
    const error = await listPersonInterventions(db, { organizationId: ORG, personId: VIEWER, access: analyst }, PERSON).then(() => null, (reason: unknown) => reason)
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toMatchObject({ code: "PERSON_NOT_FOUND", statusCode: 404 })
  })

  it("mesmo universo continua vendo; universo pendente no cadastro de quem vê nunca vira 'todos'", async () => {
    expect(await canSeeInterventionsOf(fakeDatabase({ enforced: true, viewerUniverse: "B2C", personUniverse: "B2C" }).db, analyst, PERSON)).toBe(true)
    expect(await canSeeInterventionsOf(fakeDatabase({ enforced: true, viewerUniverse: null, personUniverse: "B2B" }).db, analyst, PERSON)).toBe(false)
  })

  it("`operating_universes.all` na organização ou no Grupo da pessoa abre os outros universos", async () => {
    const database = () => fakeDatabase({ enforced: true, viewerUniverse: "B2C", personUniverse: "B2B" }).db
    expect(await canSeeInterventionsOf(database(), accessWith(assignment("ANALISTA_DE_ACOMPANHAMENTO"), assignment("ACESSO_A_TODOS_OS_UNIVERSOS")), PERSON)).toBe(true)
    expect(await canSeeInterventionsOf(database(), accessWith(assignment("ANALISTA_DE_ACOMPANHAMENTO"), assignment("ACESSO_A_TODOS_OS_UNIVERSOS", { type: "GROUP", teamId: TEAM_B2B })), PERSON)).toBe(true)
  })

  it("organização sem universos ativados: nada muda (e os universos nem são lidos)", async () => {
    const { db, universeReads } = fakeDatabase({ enforced: false, viewerUniverse: "B2C", personUniverse: "B2B" })
    expect(await canSeeInterventionsOf(db, analyst, PERSON)).toBe(true)
    expect(universeReads).toEqual([])
  })

  it("quem lidera pela estrutura vê em qualquer universo, com as permissões do papel intactas", async () => {
    const { db, universeReads } = fakeDatabase({ enforced: true, viewerUniverse: "B2C", personUniverse: "B2B", inStructure: true })
    const relation = await relationFor(db, analyst, parties())
    expect(relation.leadsSubject).toBe(true)
    expect(relation.can.view).toBe(true)
    expect(universeReads).toEqual([])
  })

  it("quem é parte da intervenção continua sendo parte; só o alcance vindo do papel cai fora do universo", async () => {
    const { db } = fakeDatabase({ enforced: true, viewerUniverse: "B2C", personUniverse: "B2B" })
    const relation = await relationFor(db, analyst, parties({ responsibleId: VIEWER, approvalRecipientIds: [VIEWER] }))
    expect(relation).toMatchObject({ isResponsible: true, isApprover: true, leadsSubject: false, can: { view: false, execute: false, approve: false, sensitiveDecide: false } })
  })
})
