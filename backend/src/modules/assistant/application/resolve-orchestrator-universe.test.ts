import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { listInteractiveOrchestratorScopes, orchestratorForTeam, resolveOrchestratorById, type InteractiveOrchestratorScope } from "./resolve-orchestrator.js"

/**
 * U4-01 — a consulta de processo da liderança não atravessa universos de atuação: a lista de Orquestradores do chat, a escolha do
 * Orquestrador de um Grupo (inclusive o de "Todos os grupos" usado no lugar) e a resolução por id respeitam os universos de quem
 * consulta. Sem filtro (organização sem a exigência ativa), nada muda.
 */
const ORG = "00000000-0000-4000-8000-0000000000c1"
const ORCHESTRATORS = [
  { id: "orch-b2c-team", name: "B2C Faturamento", scope_type: "TEAM", team_id: "team-b2c", operating_universe: "B2C" },
  { id: "orch-b2c-all", name: "B2C Geral", scope_type: "ALL_TEAMS", team_id: null, operating_universe: "B2C" },
  { id: "orch-b2b-all", name: "B2B Geral", scope_type: "ALL_TEAMS", team_id: null, operating_universe: "B2B" },
]

/** Dublê que aplica o predicado de universo como o SQL (`$n::text[] is null or o.operating_universe = any($n)`). */
function fakeDb() {
  const calls: { sql: string; params: unknown[] }[] = []
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const text = sql.replace(/\s+/g, " ")
    calls.push({ sql: text, params })
    const allowed = (universes: unknown, universe: string | null) => universes === null || universes === undefined || (Array.isArray(universes) && universe !== null && universes.includes(universe))
    if (text.includes("from assistant_orchestrators o where o.organization_id = $1 and o.active")) {
      const rows = ORCHESTRATORS.filter((row) => allowed(params[1], row.operating_universe))
      return { rows, rowCount: rows.length }
    }
    if (text.includes("from assistant_orchestrators o join agents a")) {
      // Um Orquestrador B2C existe com este id; o que a consulta devolve depende do filtro.
      if (!allowed(params[3], "B2C")) return { rows: [], rowCount: 0 }
      throw new Error("ENCONTRADO")
    }
    return { rows: [], rowCount: 0 }
  })
  return { db: { query } as unknown as Database, calls }
}

describe("Orquestradores do chat × universo de atuação (consulta de processo da liderança)", () => {
  it("a lista só traz Orquestradores dos universos de quem consulta; sem filtro, todos (como antes)", async () => {
    const { db, calls } = fakeDb()
    expect((await listInteractiveOrchestratorScopes(db, ORG, ["B2B"])).map((item) => item.id)).toEqual(["orch-b2b-all"])
    expect(calls[0]!.sql).toContain("o.operating_universe = any($2::text[])")
    expect(calls[0]!.params[1]).toEqual(["B2B"])
    expect((await listInteractiveOrchestratorScopes(db, ORG)).map((item) => item.id)).toEqual(["orch-b2c-team", "orch-b2c-all", "orch-b2b-all"])
    expect(calls[1]!.params[1]).toBeNull()
    // Pendente (sem universo) com a exigência: lista vazia, nunca a de outro universo.
    expect(await listInteractiveOrchestratorScopes(db, ORG, [])).toEqual([])
  })

  it("resolução por id: Orquestrador de outro universo não é resolvido; sem filtro, segue a regra de sempre", async () => {
    const { db, calls } = fakeDb()
    expect(await resolveOrchestratorById(db, ORG, "orch-b2c-all", "INTERACTIVE", "pergunta", undefined, ["B2B"])).toBeNull()
    expect(calls[0]!.sql).toContain("o.operating_universe = any($4::text[])")
    expect(calls[0]!.params[3]).toEqual(["B2B"])
    // Universo permitido (ou sem filtro): a linha é encontrada (o dublê para aí).
    await expect(resolveOrchestratorById(db, ORG, "orch-b2c-all", "INTERACTIVE", "pergunta", undefined, ["B2C"])).rejects.toThrow("ENCONTRADO")
    await expect(resolveOrchestratorById(db, ORG, "orch-b2c-all", "WORKFLOW", "pergunta")).rejects.toThrow("ENCONTRADO")
    expect(calls[2]!.params[3]).toBeNull()
  })

  it("Orquestrador do Grupo: com os universos do Grupo, o de 'Todos os grupos' de OUTRO universo não entra no lugar", () => {
    const scopes: InteractiveOrchestratorScope[] = ORCHESTRATORS.map((row) => ({ id: row.id, name: row.name, scopeType: row.scope_type as "TEAM" | "ALL_TEAMS", teamId: row.team_id, operatingUniverse: row.operating_universe }))
    // Sem filtro (antes da exigência): o mais recente de "Todos os grupos", de qualquer universo.
    expect(orchestratorForTeam(scopes, "team-b2b")?.id).toBe("orch-b2c-all")
    // Grupo B2B: o de "Todos os grupos" do B2B; Grupo B2C: o do próprio Grupo.
    expect(orchestratorForTeam(scopes, "team-b2b", ["B2B"])?.id).toBe("orch-b2b-all")
    expect(orchestratorForTeam(scopes, "team-b2c", ["B2C"])?.id).toBe("orch-b2c-team")
    // O Orquestrador do próprio Grupo também precisa ser do universo dos operadores dele.
    expect(orchestratorForTeam(scopes, "team-b2c", ["B2X"])).toBeNull()
    // Grupo só com operadores pendentes (nenhum universo): nenhum Orquestrador.
    expect(orchestratorForTeam(scopes, "team-b2c", [])).toBeNull()
  })
})
