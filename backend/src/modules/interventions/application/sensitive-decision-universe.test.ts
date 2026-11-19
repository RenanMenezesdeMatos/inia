import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { AccessAssignment, AccessContext } from "../../access/domain/access-decision.js"
import { authorizeCommand } from "../domain/intervention-state.js"
import { resolveSensitiveDecisionRecipients } from "./evaluate-policy.js"
import { relationFor } from "./intervention-access.js"

/**
 * DC-01 — decisão de continuidade × universo de atuação: quem é ESCOLHIDO como destinatário (`resolveSensitiveDecisionRecipients`)
 * tem de conseguir decidir (`relationFor(...).can.sensitiveDecide`) — as duas leituras nunca divergem — e a solicitação nunca fica
 * sem ninguém que decida: se o corte por universo esvaziar a lista, vale a regra anterior ao universo, registrada.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const PERSON = "44444444-4444-4444-8444-444444444444"
const TEAM = "22222222-2222-4222-8222-222222222222"
const SAME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const PENDING = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const CROSS = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

type Holder = { id: string; universe: string | null; cross?: boolean; inStructure?: boolean }

function fakeDatabase(input: { enforced: boolean; personUniverse: string | null; holders: Holder[] }) {
  const query = async (sql: string, params: unknown[] = []) => {
    const text = sql.replace(/\s+/g, " ").trim()
    if (text.includes("operating_universe_enforced_at")) return { rows: [{ enforced: input.enforced }], rowCount: 1 }
    if (text.startsWith("select operating_universe from people")) {
      const universe = params[0] === PERSON ? input.personUniverse : input.holders.find((holder) => holder.id === params[0])?.universe ?? null
      return { rows: [{ operating_universe: universe }], rowCount: 1 }
    }
    if (text.includes("from access_role_assignments a")) {
      const rows = input.holders.map((holder) => ({ id: holder.id, operating_universe: holder.universe, in_structure: holder.inStructure ?? false, cross_universe: holder.cross ?? false }))
      return { rows, rowCount: rows.length }
    }
    if (text.startsWith("select id, team_id, subteam_id from people")) return { rows: [{ id: PERSON, team_id: TEAM, subteam_id: null }], rowCount: 1 }
    if (text.startsWith("with recursive subordinates")) return input.holders.find((holder) => holder.id === params[1])?.inStructure ? { rows: [{}], rowCount: 1 } : { rows: [], rowCount: 0 }
    return { rows: [], rowCount: 0 }
  }
  return { query } as unknown as Database
}

const assignment = (roleCode: string): AccessAssignment => ({ id: roleCode, roleCode, scope: { type: "ORGANIZATION" } })
const accessOf = (holder: Holder): AccessContext => ({ organizationId: ORG, accountId: `account:${holder.id}`, personId: holder.id, assignments: [assignment("AVALIADOR_DE_CONTINUIDADE"), ...(holder.cross ? [assignment("ACESSO_A_TODOS_OS_UNIVERSOS")] : [])] })
const person = { id: PERSON, teamId: TEAM, subteamId: null }

async function canDecide(db: Database, holder: Holder, recipients: readonly string[]) {
  const relation = await relationFor(db, accessOf(holder), { personId: PERSON, responsibleId: "", approverId: null, approvalRecipientIds: recipients, openedBy: null, acceptedBy: null })
  return relation.can.sensitiveDecide
}

describe("decisão de continuidade × universo de atuação (DC-01)", () => {
  const holders: Holder[] = [{ id: SAME, universe: "B2B" }, { id: OTHER, universe: "B2C" }, { id: PENDING, universe: null }, { id: CROSS, universe: "B2C", cross: true }]

  it("só é destinatário quem consegue decidir: outro universo e universo pendente ficam fora, como em can.sensitiveDecide", async () => {
    const db = fakeDatabase({ enforced: true, personUniverse: "B2B", holders })
    const resolved = await resolveSensitiveDecisionRecipients(db, ORG, person)
    expect(resolved).toEqual({ ids: [SAME, CROSS], outsideUniverse: false })
    for (const holder of holders) expect(await canDecide(db, holder, resolved.ids)).toBe(resolved.ids.includes(holder.id))
  })

  it("corte por universo sem ninguém: vale a regra anterior, fica registrado e os escolhidos decidem", async () => {
    const outside: Holder[] = [{ id: OTHER, universe: "B2C" }, { id: PENDING, universe: null }]
    const db = fakeDatabase({ enforced: true, personUniverse: "B2B", holders: outside })
    const resolved = await resolveSensitiveDecisionRecipients(db, ORG, person)
    expect(resolved).toEqual({ ids: [OTHER, PENDING], outsideUniverse: true })
    for (const holder of outside) {
      const relation = await relationFor(db, accessOf(holder), { personId: PERSON, responsibleId: "", approverId: null, approvalRecipientIds: resolved.ids, openedBy: null, acceptedBy: null })
      expect(relation.can).toEqual({ view: false, execute: false, approve: false, sensitiveDecide: true })
      expect(authorizeCommand("DECIDE_CONTINUITY", relation, true)).toBeNull()
    }
  })

  it("fora do universo e sem ser destinatário, a permissão do papel continua sem alcançar a pessoa", async () => {
    const db = fakeDatabase({ enforced: true, personUniverse: "B2B", holders })
    expect(await canDecide(db, holders[1]!, [SAME])).toBe(false)
  })

  it("organização sem universos ativados: todos os titulares do escopo, sem registro de exceção", async () => {
    const db = fakeDatabase({ enforced: false, personUniverse: "B2B", holders })
    expect(await resolveSensitiveDecisionRecipients(db, ORG, person)).toEqual({ ids: holders.map((holder) => holder.id), outsideUniverse: false })
  })
})
