import { describe, expect, it, vi } from "vitest"

const DOC = "44444444-4444-4444-8444-444444444444"
vi.mock("../../knowledge/application/retrieve-knowledge.js", () => ({
  retrieveKnowledgeForAgent: async () => ({ trace: { mode: "RETRIEVED", authorizedDocuments: [{ id: DOC, title: "PR — Envio de fatura", chars: 100, versionId: "kv", version: 3 }], retrieved: [], injectedChars: 0 }, promptBlock: "### PR — Envio de fatura\nEnviar a fatura ao cliente pelo e-mail cadastrado quando ele solicitar." }),
}))

import type { Database } from "../../../infrastructure/database/pool.js"
import { buildSystemPromptWithTrace } from "../../agents/application/build-system-prompt.js"
import { loadLeaderStructureBlock } from "./leader-structure-context.js"

/**
 * VISÃO DA ESTRUTURA DO GESTOR (`LEADER_STRUCTURE_CONTEXT_V1`) — exemplo da fatura: o alinhamento vale para o Grupo Ouvidoria; o
 * gerente Carlos (cadastrado em outro Grupo) lidera a Ouvidoria e Vendas. Perguntando sobre a Ouvidoria, ele recebe o alinhamento DELA,
 * marcado com o público; perguntando sobre Vendas, não. No chat só de liderança, entram os relacionados à pergunta.
 */
const OUVIDORIA = "11111111-1111-4111-8111-111111111111"
const VENDAS = "22222222-2222-4222-8222-222222222222"
const ALIGNMENT = {
  alignment_id: "aaaaaaaa-0000-4000-8000-000000000001", version_id: "bbbbbbbb-0000-4000-8000-000000000001", version: 1, title: "Fatura pelo App Meu Vivo ou site",
  guidance: "Oriente o cliente a acessar a fatura pelo App Meu Vivo ou pelo site. Não envie a fatura.", justification: "Envio suspenso durante a troca do sistema.",
  documents: [{ id: DOC, title: "PR — Envio de fatura" }], affected_topic: "Envio da fatura quando o cliente solicita", operating_universe: "B2C", scope_type: "GROUPS",
  links: [{ teamId: OUVIDORIA, teamName: "Ouvidoria", subteamId: null, subteamName: null }], product_id: null, product_name: null, starts_on: "2026-11-10", ends_on: "2026-11-30", time_zone: "America/Sao_Paulo",
  effective_from: new Date("2026-11-10T03:00:00Z"), effective_until: new Date("2026-12-01T03:00:00Z"), ended_at: null, content_hash: "h", published_at: new Date("2026-11-09T18:00:00Z"), relations: [],
}
const AT = new Date("2026-11-15T14:00:00Z")

/** Banco falso: a estrutura do Carlos tem operadores na Ouvidoria e em Vendas; `teamIds` filtra como o SQL real. */
function fakeDb(sqls: { sql: string; params: unknown[] }[] = []) {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      sqls.push({ sql, params })
      if (sql.includes("from operational_alignment_versions v")) return { rows: [ALIGNMENT] }
      if (sql.includes("structure_people sp") && sql.includes("select distinct")) {
        const teams = (params[2] as string[] | null) ?? [OUVIDORIA, VENDAS]
        return { rows: teams.map((team) => ({ team_id: team, subteam_id: null, operating_universe: "B2C", enforced: true })) }
      }
      if (sql.includes("from communications")) return { rows: [] }
      if (sql.includes("person_operating_universe_history")) return { rows: [{ team_id: "grupo-do-gerente", subteam_id: null, universe_now: "B2C", universe_at: "B2C", enforced: true }] }
      if (sql.includes("from prohibited_topics")) return { rows: [{ name: "Cancelamento", required_behavior: "Nunca orientar cancelamento." }] }
      if (sql.includes("from operations")) return { rows: [{ timezone: "America/Sao_Paulo" }] }
      return { rows: [] }
    },
  } as unknown as Database
}

const AGENT = { organization_id: "org-1", name: "Especialista Ouvidoria", objective: "Orientar", description: "Ouvidoria", context_prompt: "Oriente." }
const QUESTION = "Como a equipe deve atender pedido de segunda via da fatura?"

describe("visão da estrutura do gestor — consulta de processo de um Grupo", () => {
  it("perguntando sobre a Ouvidoria, o gerente recebe o alinhamento DELA (não o do próprio público), com o público marcado", async () => {
    const sqls: { sql: string; params: unknown[] }[] = []
    const built = await buildSystemPromptWithTrace(fakeDb(sqls), "agent-1", AGENT, { query: QUESTION, askerQuestion: QUESTION, governanceSubjectPersonId: "carlos", collaboratorConversation: true, alignmentReferenceDate: AT, structureScope: { kind: "LEADER_STRUCTURE", leaderPersonId: "carlos", teamIds: [OUVIDORIA], groupNames: ["Ouvidoria"] } })
    expect(built.systemPrompt).toContain("ALINHAMENTOS OPERACIONAIS VIGENTES PARA OS PÚBLICOS DO GRUPO OUVIDORIA")
    expect(built.systemPrompt).toContain("Cada alinhamento vale SÓ para o público indicado nele")
    expect(built.systemPrompt).toContain("público: B2C · Grupo Ouvidoria")
    expect(built.systemPrompt).not.toContain("para o público de quem está na conversa")
    expect(built.systemPrompt.indexOf("PÚBLICOS DO GRUPO")).toBeLessThan(built.systemPrompt.indexOf("Cancelamento"))
    // Rastro: a versão lida fica gravada em nome do gerente (como no caminho pessoal).
    await new Promise((resolve) => setTimeout(resolve, 0))
    const usage = sqls.find((call) => call.sql.includes("insert into operational_alignment_usages"))!
    expect(usage.params).toEqual(["org-1", [ALIGNMENT.alignment_id], [ALIGNMENT.version_id], "CONVERSATION", "carlos", "agent-1", null, AT])
    // Nunca o público do próprio gerente: a regra pessoal nem é lida.
    expect(sqls.some((call) => call.sql.includes("person_operating_universe_history"))).toBe(false)
    // Os comunicados também vêm pelos públicos dos Grupos consultados.
    const communications = sqls.find((call) => call.sql.includes("from communications"))!
    expect(communications.sql).toContain("structure_people")
    expect(communications.params).toEqual(["org-1", "carlos", [OUVIDORIA]])
  })

  it("perguntando sobre Vendas, o alinhamento da Ouvidoria não entra", async () => {
    const built = await buildSystemPromptWithTrace(fakeDb(), "agent-1", AGENT, { query: QUESTION, askerQuestion: QUESTION, governanceSubjectPersonId: "carlos", collaboratorConversation: true, alignmentReferenceDate: AT, structureScope: { kind: "LEADER_STRUCTURE", leaderPersonId: "carlos", teamIds: [VENDAS], groupNames: ["Vendas"] } })
    expect(built.systemPrompt).not.toContain("ALINHAMENTOS OPERACIONAIS VIGENTES")
  })
})

describe("visão da estrutura do gestor — chat só de liderança", () => {
  it("traz o alinhamento da estrutura relacionado à pergunta; pergunta sem relação não traz nada", async () => {
    const sqls: { sql: string; params: unknown[] }[] = []
    const related = await loadLeaderStructureBlock(fakeDb(sqls), { organizationId: "org-1", scope: { kind: "LEADER_STRUCTURE", leaderPersonId: "carlos", teamIds: null }, question: "Mudou alguma coisa no envio da fatura?", at: AT })
    expect(related.alignments.map((candidate) => candidate.title)).toEqual(["Fatura pelo App Meu Vivo ou site"])
    expect(related.text).toContain("PÚBLICOS DA ESTRUTURA DE QUEM PERGUNTA")
    expect(related.text).toContain("público: B2C · Grupo Ouvidoria")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sqls.filter((call) => call.sql.includes("insert into operational_alignment_usages")).map((call) => call.params[2])).toEqual([[ALIGNMENT.version_id]])
    const unrelatedSqls: { sql: string; params: unknown[] }[] = []
    const unrelated = await loadLeaderStructureBlock(fakeDb(unrelatedSqls), { organizationId: "org-1", scope: { kind: "LEADER_STRUCTURE", leaderPersonId: "carlos", teamIds: null }, question: "Qual foi o TMA da equipe ontem?", at: AT })
    expect(unrelated.text).toBe("")
    // Nada entrou, nada é registrado.
    expect(unrelatedSqls.some((call) => call.sql.includes("insert into operational_alignment_usages"))).toBe(false)
  })
})
