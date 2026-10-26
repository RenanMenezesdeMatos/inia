import { describe, expect, it, vi } from "vitest"

vi.mock("../../knowledge/application/retrieve-knowledge.js", () => ({
  retrieveKnowledgeForAgent: async () => ({ trace: { mode: "NONE", authorizedDocuments: [], retrieved: [], injectedChars: 0 }, promptBlock: "" }),
}))

import { buildSystemPromptWithTrace } from "./build-system-prompt.js"
import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * Argumentários no prompt LEGADO dos Agents: só os que valem para o público avaliado — o colaborador da execução ou, sem ele, o
 * alcance do próprio Agent. Antes entravam todos os da organização, inclusive os restritos a outro Grupo/Subgrupo (validação
 * funcional de 20/10/2026, D3). O filtro em si é SQL (provado em `argument-scripts-proof`); aqui, qual público é usado.
 */
function fakeDb(rows: { person?: { team_id: string | null; subteam_id: string | null }; agent?: { team_id: string | null; subteam_id: string | null } }) {
  const scriptQueries: { sql: string; params: unknown[] }[] = []
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("argument_scripts")) {
        scriptQueries.push({ sql, params })
        return { rows: [] }
      }
      if (sql.includes("from people")) return { rows: rows.person ? [rows.person] : [] }
      if (sql.includes("from agents a")) return { rows: rows.agent ? [rows.agent] : [] }
      return { rows: [] }
    },
  } as unknown as Database
  return { db, scriptQueries }
}

const AGENT = { organization_id: "org-1", name: "Especialista", objective: "Avaliar", description: "Especialista", context_prompt: "Avalie." }

describe("Argumentários do prompt do Agent — público avaliado (D3)", () => {
  it("com colaborador: o Grupo e o Subgrupo DELE filtram os argumentários", async () => {
    const { db, scriptQueries } = fakeDb({ person: { team_id: "team-a", subteam_id: "sub-a1" }, agent: { team_id: null, subteam_id: null } })
    await buildSystemPromptWithTrace(db, "agent-1", AGENT, { query: "transcrição", governanceSubjectPersonId: "operator-1" })
    expect(scriptQueries).toHaveLength(1)
    expect(scriptQueries[0]!.sql).toMatch(/s\.scope_type = 'ALL_TEAMS' or \(s\.scope_type = 'TEAM' and s\.team_id = \$3\) or \(s\.scope_type = 'SUBTEAM' and s\.subteam_id = \$4\)/)
    expect(scriptQueries[0]!.params.slice(2)).toEqual(["team-a", "sub-a1"])
  })

  it("sem colaborador (teste, coordenador, síntese, prévia): o alcance do Agent — Agent de Subgrupo leva o Grupo pai", async () => {
    const { db, scriptQueries } = fakeDb({ agent: { team_id: "team-a", subteam_id: "sub-a1" } })
    await buildSystemPromptWithTrace(db, "agent-1", AGENT, { query: "teste manual" })
    expect(scriptQueries[0]!.params.slice(2)).toEqual(["team-a", "sub-a1"])
  })

  it("Agent de todos os grupos e sem colaborador: só argumentários de todos os grupos (Grupo e Subgrupo nulos)", async () => {
    const { db, scriptQueries } = fakeDb({ agent: { team_id: null, subteam_id: null } })
    await buildSystemPromptWithTrace(db, "agent-1", AGENT, { query: "teste manual" })
    expect(scriptQueries[0]!.params.slice(2)).toEqual([null, null])
  })

  it("colaborador que não está na organização: cai no alcance do Agent, nunca em todos os argumentários", async () => {
    const { db, scriptQueries } = fakeDb({ agent: { team_id: "team-b", subteam_id: null } })
    await buildSystemPromptWithTrace(db, "agent-1", AGENT, { query: "transcrição", governanceSubjectPersonId: "someone-else" })
    expect(scriptQueries[0]!.params.slice(2)).toEqual(["team-b", null])
  })
})
