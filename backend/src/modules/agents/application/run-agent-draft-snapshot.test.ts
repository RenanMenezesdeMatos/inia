import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { AgentConfig } from "../domain/agent-config.js"
import { answerAgentVersionQuery, fakeAgentConfig } from "../testing/agent-version-fakes.js"

// Nenhum provedor de IA: os clientes são trocados por falhas e a montagem do prompt encerra a execução logo depois de dizer qual
// configuração recebeu. O assunto aqui é só QUAL rascunho executa.
vi.mock("../infrastructure/gemini-agent-client.js", () => ({
  generateAgentReplyWithUsage: async () => {
    throw new Error("nenhuma IA neste teste")
  },
  AGENT_LLM_MODEL: "test",
}))
vi.mock("../../assistant/infrastructure/gemini-function-calling-client.js", () => ({
  generateWithTools: async () => {
    throw new Error("nenhuma IA neste teste")
  },
}))
const promptConfigs = vi.hoisted(() => [] as unknown[])
vi.mock("./build-system-prompt.js", async (importOriginal) => {
  const { agentSnapshotFor } = await import("./agent-runtime-context.js")
  return {
    ...(await importOriginal<typeof import("./build-system-prompt.js")>()),
    buildSystemPromptWithTrace: async (_db: unknown, agentId: string) => {
      promptConfigs.push(agentSnapshotFor(agentId)?.config)
      throw new Error("fim do teste: o prompt seria montado com esta configuração")
    },
  }
})

const { runAgent } = await import("./run-agent.js")

const ORG = "00000000-0000-4000-8000-000000000001"
const AGENT = "c0000000-0000-4000-8000-00000000000c"
const TEAM_B = "b0000000-0000-4000-8000-00000000000b"
const CHECKED: AgentConfig = fakeAgentConfig({ name: "Agente de Retenção", contextPrompt: "rascunho do Grupo B", scopeType: "TEAM", teamId: TEAM_B })
/** O rascunho gravado AGORA: outra pessoa salvou um de todos os Grupos depois que a rota conferiu o alcance. */
const SAVED_MEANWHILE: AgentConfig = fakeAgentConfig({ name: "Agente de Retenção", contextPrompt: "procedimentos de todos os Grupos", scopeType: "ALL_TEAMS" })

function fakeDb() {
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    const versioned = answerAgentVersionQuery(text, params, (agentId) => (agentId === AGENT ? { active: true } : undefined))
    if (versioned) return versioned
    if (text.includes('a.draft_config "draftConfig"')) {
      return { rows: [{ id: AGENT, organizationId: ORG, active: true, currentVersionId: null, currentVersionNumber: null, draftConfig: SAVED_MEANWHILE, draftRevision: 5, draftUpdatedAt: null, draftUpdatedByName: null, scopeType: "TEAM", teamId: TEAM_B, subteamId: null }], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  })
  return { db: { query } as unknown as Database, query }
}

describe("runAgent — teste do rascunho", () => {
  it("executa a configuração que quem chamou leu e conferiu; o rascunho não é relido, e o registro guarda o que executou", async () => {
    promptConfigs.length = 0
    const { db, query } = fakeDb()
    const recorder = { start: vi.fn(async () => "run-1"), complete: vi.fn(async () => undefined), fail: vi.fn(async () => undefined) }

    await runAgent(db, { organizationId: ORG, agentId: AGENT, inputContext: "Cliente pediu o cancelamento da linha.", source: "MANUAL_TEST", recorder, target: { kind: "DRAFT", config: CHECKED } }).catch(() => undefined)

    expect(recorder.start).toHaveBeenCalledWith(db, expect.objectContaining({ runTarget: "DRAFT", agentVersionId: null, testedConfig: CHECKED }))
    expect(promptConfigs).toEqual([CHECKED])
    expect(query.mock.calls.some(([sql]) => String(sql).includes("draft_config"))).toBe(false)
  })

  it("agente desativado depois da conferência também não executa o rascunho (a situação continua lida na hora)", async () => {
    const db = { query: vi.fn(async (text: string, params?: unknown[]) => answerAgentVersionQuery(text, params, () => ({ active: false })) ?? { rows: [], rowCount: 0 }) } as unknown as Database
    const recorder = { start: vi.fn(async () => "run-1"), complete: vi.fn(async () => undefined), fail: vi.fn(async () => undefined) }

    await expect(runAgent(db, { organizationId: ORG, agentId: AGENT, inputContext: "Cliente pediu o cancelamento da linha.", source: "MANUAL_TEST", recorder, target: { kind: "DRAFT", config: CHECKED } })).rejects.toMatchObject({ code: "AGENT_INACTIVE" })
    expect(recorder.start).not.toHaveBeenCalled()
  })
})
