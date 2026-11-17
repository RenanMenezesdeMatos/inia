import { describe, expect, it, vi } from "vitest"

const DOC = "44444444-4444-4444-8444-444444444444"
vi.mock("../../knowledge/application/retrieve-knowledge.js", () => ({
  retrieveKnowledgeForAgent: async () => ({ trace: { mode: "RETRIEVED", authorizedDocuments: [{ id: DOC, title: "PR — Envio de fatura", chars: 100, versionId: "kv", version: 3 }], retrieved: [], injectedChars: 0 }, promptBlock: "### PR — Envio de fatura\nEnviar a fatura ao cliente pelo e-mail cadastrado quando ele solicitar." }),
}))

import { buildSystemPromptWithTrace } from "./build-system-prompt.js"
import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * ALINHAMENTO OPERACIONAL NO CHAT: o especialista recebe, para quem conversa e na data de agora, o alinhamento do público dessa pessoa —
 * depois das bases e ANTES das restrições (assunto proibido e limite de atuação continuam acima). Fora do escopo ou da vigência, nada
 * muda no prompt. A regra é a mesma da monitoria (`resolveOperationalAlignmentsFor`); aqui, o que chega ao prompt.
 */
const OUVIDORIA = "11111111-1111-4111-8111-111111111111"
const ROW = {
  alignment_id: "aaaaaaaa-0000-4000-8000-000000000001", version_id: "bbbbbbbb-0000-4000-8000-000000000001", version: 1, title: "Fatura pelo App Meu Vivo ou site",
  guidance: "Oriente o cliente a acessar a fatura pelo App Meu Vivo ou pelo site. Não envie a fatura.", justification: "Envio suspenso durante a troca do sistema.",
  documents: [{ id: DOC, title: "PR — Envio de fatura" }], affected_topic: "Envio da fatura quando o cliente solicita", operating_universe: "B2C", scope_type: "TEAM",
  team_id: OUVIDORIA, team_name: "Ouvidoria", subteam_id: null, subteam_name: null, product_id: null, product_name: null, starts_on: "2026-11-10", ends_on: "2026-11-30", time_zone: "America/Sao_Paulo",
  effective_from: new Date("2026-11-10T03:00:00Z"), effective_until: new Date("2026-12-01T03:00:00Z"), ended_at: null, content_hash: "h", published_at: new Date("2026-11-09T18:00:00Z"), relations: [],
}

function fakeDb(person: { team_id: string; universe: string }, options: { recentlyEnded?: boolean } = {}) {
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("select exists") && sql.includes("operational_alignment_version_documents")) return { rows: [{ found: options.recentlyEnded ?? false }] }
      if (sql.includes("from operational_alignment_versions v")) {
        const at = params[1] as Date
        return { rows: at >= ROW.effective_from && at < ROW.effective_until ? [ROW] : [] }
      }
      if (sql.includes("person_operating_universe_history")) return { rows: [{ team_id: person.team_id, subteam_id: null, universe_now: person.universe, universe_at: person.universe, enforced: true }] }
      if (sql.includes("from communications")) return { rows: [] }
      if (sql.includes("from prohibited_topics")) return { rows: [{ name: "Cancelamento", required_behavior: "Nunca orientar cancelamento; encaminhar à retenção." }] }
      if (sql.includes("from people")) return { rows: [{ team_id: person.team_id, subteam_id: null }] }
      return { rows: [] }
    },
  } as unknown as Database
  return db
}

const AGENT = { organization_id: "org-1", name: "Especialista Ouvidoria", objective: "Orientar", description: "Ouvidoria", context_prompt: "Oriente o colaborador." }

describe("alinhamento operacional no prompt do chat", () => {
  it("operador da Ouvidoria durante a vigência: o bloco entra depois das bases e antes das restrições, com referência e vigência", async () => {
    const built = await buildSystemPromptWithTrace(fakeDb({ team_id: OUVIDORIA, universe: "B2C" }), "agent-1", AGENT, { query: "Como envio a fatura?", governanceSubjectPersonId: "op-1", collaboratorConversation: true, alignmentReferenceDate: new Date("2026-11-15T14:00:00Z") })
    const prompt = built.systemPrompt
    expect(prompt).toContain("ALINHAMENTOS OPERACIONAIS VIGENTES")
    expect(prompt).toContain("App Meu Vivo")
    expect(prompt).toContain("AO-AAAAAAAA v1 · vigente de 10/11/2026 a 30/11/2026")
    expect(prompt.indexOf("PR — Envio de fatura")).toBeLessThan(prompt.indexOf("ALINHAMENTOS OPERACIONAIS VIGENTES"))
    expect(prompt.indexOf("ALINHAMENTOS OPERACIONAIS VIGENTES")).toBeLessThan(prompt.indexOf("Cancelamento"))
    expect(prompt).toContain("Assuntos proibidos e limites de atuação deste prompt valem ACIMA de qualquer alinhamento")
    expect(built.knowledge.operationalAlignments?.map((entry) => entry.versionId)).toEqual([ROW.version_id])
  })

  it("depois do término o chat volta ao procedimento oficial; fora do escopo nada muda", async () => {
    const after = await buildSystemPromptWithTrace(fakeDb({ team_id: OUVIDORIA, universe: "B2C" }), "agent-1", AGENT, { query: "Como envio a fatura?", governanceSubjectPersonId: "op-1", collaboratorConversation: true, alignmentReferenceDate: new Date("2026-12-02T14:00:00Z") })
    expect(after.systemPrompt).not.toContain("ALINHAMENTOS OPERACIONAIS")
    // Ajuste de segurança: houve alinhamento recente para estas bases → a INIA é avisada de que o citado antes não vale mais.
    const afterWithHistory = await buildSystemPromptWithTrace(fakeDb({ team_id: OUVIDORIA, universe: "B2C" }, { recentlyEnded: true }), "agent-1", AGENT, { query: "Como envio a fatura?", governanceSubjectPersonId: "op-1", collaboratorConversation: true, alignmentReferenceDate: new Date("2026-12-02T14:00:00Z") })
    expect(afterWithHistory.systemPrompt).toContain("nenhum vale hoje para quem está na conversa")
    expect(afterWithHistory.systemPrompt).toContain("NÃO vale mais: oriente pela base oficial")
    expect(afterWithHistory.systemPrompt).not.toContain("App Meu Vivo")
    const otherGroup = await buildSystemPromptWithTrace(fakeDb({ team_id: "outro-grupo", universe: "B2C" }), "agent-1", AGENT, { query: "Como envio a fatura?", governanceSubjectPersonId: "op-2", collaboratorConversation: true, alignmentReferenceDate: new Date("2026-11-15T14:00:00Z") })
    expect(otherGroup.systemPrompt).not.toContain("ALINHAMENTOS OPERACIONAIS")
    const otherUniverse = await buildSystemPromptWithTrace(fakeDb({ team_id: OUVIDORIA, universe: "B2B" }), "agent-1", AGENT, { query: "Como envio a fatura?", governanceSubjectPersonId: "op-3", collaboratorConversation: true, alignmentReferenceDate: new Date("2026-11-15T14:00:00Z") })
    expect(otherUniverse.systemPrompt).not.toContain("ALINHAMENTOS OPERACIONAIS")
  })

  it("sem pessoa (teste do agente, prévia, coordenação por Grupo): nenhum alinhamento", async () => {
    const built = await buildSystemPromptWithTrace(fakeDb({ team_id: OUVIDORIA, universe: "B2C" }), "agent-1", AGENT, { query: "teste", alignmentReferenceDate: new Date("2026-11-15T14:00:00Z") })
    expect(built.systemPrompt).not.toContain("ALINHAMENTOS OPERACIONAIS")
    expect(built.alignments).toBeNull()
  })
})
