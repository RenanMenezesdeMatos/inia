import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { allConflicts } from "./universe-administration.js"

/**
 * B5 — a prontidão listava os vínculos entre universos com uma consulta POR agente/Orquestrador/Workflow classificado (cada uma com
 * `jsonb_path_exists` de todos os grafos). Agora é uma consulta só para a organização, qualquer que seja o tamanho do catálogo.
 */
const ORG = "00000000-0000-4000-8000-000000000001"

describe("vínculos entre universos (prontidão) — consulta única", () => {
  it("o número de consultas não cresce com o catálogo e cada vínculo volta do lado de quem usa", async () => {
    const query = vi.fn(async (sql: string) => {
      const text = sql.replace(/\s+/g, " ")
      if (text.includes("with graphs as") && text.includes("cited as")) {
        return {
          rows: [
            { from_kind: "AGENT", from_id: "a1", from_name: "Agente B2B", from_universe: "B2B", to_kind: "KNOWLEDGE_DOCUMENT", to_id: "k1", to_name: "Base B2C", to_universe: "B2C" },
            { from_kind: "WORKFLOW", from_id: "w1", from_name: "Workflow B2X", from_universe: "B2X", to_kind: "INDICATOR", to_id: "i1", to_name: "TMA", to_universe: "B2B" },
          ],
        }
      }
      return { rows: [] }
    })
    const conflicts = await allConflicts({ query } as unknown as Database, ORG)
    expect(conflicts).toEqual([
      { from: { kind: "AGENT", id: "a1", name: "Agente B2B", operatingUniverse: "B2B" }, to: { kind: "KNOWLEDGE_DOCUMENT", id: "k1", name: "Base B2C", operatingUniverse: "B2C" }, viaCategory: false },
      { from: { kind: "WORKFLOW", id: "w1", name: "Workflow B2X", operatingUniverse: "B2X" }, to: { kind: "INDICATOR", id: "i1", name: "TMA", operatingUniverse: "B2B" }, viaCategory: false },
    ])
    const sqls = query.mock.calls.map(([sql]) => sql.replace(/\s+/g, " "))
    // Nenhuma consulta por recurso: nada de `jsonb_path_exists` (o caminho N+1) e nenhuma releitura de agentes/Orquestradores/Workflows.
    expect(sqls.some((sql) => sql.includes("jsonb_path_exists"))).toBe(false)
    expect(sqls.filter((sql) => sql.includes("with graphs as"))).toHaveLength(1)
    expect(sqls.some((sql) => /select id, name name, operating_universe from (agents|assistant_orchestrators|workflows) where/.test(sql))).toBe(false)
  })
})
