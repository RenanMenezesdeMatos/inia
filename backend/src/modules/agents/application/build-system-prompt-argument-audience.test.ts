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
type AgentScopeRow = { scope_type: "ALL_TEAMS" | "GROUPS"; links: { teamId: string; subteamId: string | null }[] }
const ALL: AgentScopeRow = { scope_type: "ALL_TEAMS", links: [] }
const groups = (...links: { teamId: string; subteamId: string | null }[]): AgentScopeRow => ({ scope_type: "GROUPS", links })

/** `scripts`: as linhas que cada público (Grupo|Subgrupo) recebe do banco — para provar a interseção entre vínculos. */
function fakeDb(rows: { person?: { team_id: string | null; subteam_id: string | null }; agent?: AgentScopeRow; scripts?: Record<string, string[]> }) {
  const scriptQueries: { sql: string; params: unknown[] }[] = []
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("argument_scripts")) {
        scriptQueries.push({ sql, params })
        const names = rows.scripts?.[`${params[2]}|${params[3]}`] ?? []
        return { rows: names.map((name) => ({ name, scope_type: "ALL_TEAMS", scope_links: [], subject_name: null, content: { operatorGuidance: [{ text: name }], legacyExpectation: name } })) }
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
    const { db, scriptQueries } = fakeDb({ person: { team_id: "team-a", subteam_id: "sub-a1" }, agent: ALL })
    await buildSystemPromptWithTrace(db, "agent-1", AGENT, { query: "transcrição", governanceSubjectPersonId: "operator-1" })
    expect(scriptQueries).toHaveLength(1)
    // Escopo da VERSÃO vigente (223): todos os Grupos, ou algum vínculo (Grupo inteiro = $3, ou o Subgrupo = $4).
    expect(scriptQueries[0]!.sql).toMatch(/v\.scope_type = 'ALL_TEAMS' or exists \(select 1 from argument_script_version_scopes l where l\.version_id = v\.id and \(\(l\.subteam_id is null and l\.team_id = \$3::uuid\) or l\.subteam_id = \$4::uuid\)\)/)
    expect(scriptQueries[0]!.params.slice(2)).toEqual(["team-a", "sub-a1"])
  })

  it("sem colaborador (teste, coordenador, síntese, prévia): o alcance do Agent — Agent de Subgrupo leva o Grupo pai", async () => {
    const { db, scriptQueries } = fakeDb({ agent: groups({ teamId: "team-a", subteamId: "sub-a1" }) })
    await buildSystemPromptWithTrace(db, "agent-1", AGENT, { query: "teste manual" })
    expect(scriptQueries[0]!.params.slice(2)).toEqual(["team-a", "sub-a1"])
  })

  it("Agent de todos os grupos e sem colaborador: só argumentários de todos os grupos (Grupo e Subgrupo nulos)", async () => {
    const { db, scriptQueries } = fakeDb({ agent: ALL })
    await buildSystemPromptWithTrace(db, "agent-1", AGENT, { query: "teste manual" })
    expect(scriptQueries[0]!.params.slice(2)).toEqual([null, null])
  })

  it("colaborador que não está na organização: cai no alcance do Agent, nunca em todos os argumentários", async () => {
    const { db, scriptQueries } = fakeDb({ agent: groups({ teamId: "team-b", subteamId: null }) })
    await buildSystemPromptWithTrace(db, "agent-1", AGENT, { query: "transcrição", governanceSubjectPersonId: "someone-else" })
    expect(scriptQueries[0]!.params.slice(2)).toEqual(["team-b", null])
  })

  it("Agent de vários vínculos (249) e sem colaborador: um público por vínculo e só os argumentários que valem para TODOS eles", async () => {
    const { db, scriptQueries } = fakeDb({
      agent: groups({ teamId: "team-a", subteamId: null }, { teamId: "team-b", subteamId: "sub-b1" }),
      scripts: { "team-a|null": ["Regra geral", "Só do Grupo A"], "team-b|sub-b1": ["Regra geral", "Só do Subgrupo B1"] },
    })
    const built = await buildSystemPromptWithTrace(db, "agent-1", AGENT, { query: "teste manual" })
    expect(scriptQueries.map((query) => query.params.slice(2))).toEqual([["team-a", null], ["team-b", "sub-b1"]])
    expect(built.systemPrompt).toContain("Regra geral")
    expect(built.systemPrompt).not.toContain("Só do Grupo A")
    expect(built.systemPrompt).not.toContain("Só do Subgrupo B1")
  })

  it("Agent sem nenhum vínculo: nunca vira todos os Grupos — só argumentários de todos os grupos", async () => {
    const { db, scriptQueries } = fakeDb({ agent: groups() })
    await buildSystemPromptWithTrace(db, "agent-1", AGENT, { query: "teste manual" })
    expect(scriptQueries.map((query) => query.params.slice(2))).toEqual([[null, null]])
  })
})
