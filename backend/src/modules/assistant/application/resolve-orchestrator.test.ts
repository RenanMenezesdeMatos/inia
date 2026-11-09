import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { classifyExecutionError } from "../../../shared/domain/execution-failure.js"
import { answerAgentVersionQuery } from "../../agents/testing/agent-version-fakes.js"
import { resolveOrchestratorById } from "./resolve-orchestrator.js"

/**
 * A versão fixada pelo Workflow leva o alcance e os especialistas DELA para a execução. A publicação já recusa versão de alcance
 * incompatível (`WORKFLOW_ORCHESTRATOR_VERSION_SCOPE_FORBIDDEN`), mas versões publicadas antes dessa conferência e o rascunho do
 * QA Lab chegam à execução sem passar por ela: aqui a mesma regra fecha a etapa antes de qualquer especialista, base ou IA.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const ORCHESTRATOR_ID = "00000000-0000-4000-8000-0000000000a2"
const COORDINATOR_ID = "00000000-0000-4000-8000-0000000000a3"
const SPECIALIST_ID = "00000000-0000-4000-8000-0000000000a4"
const VERSION_ID = "00000000-0000-4000-8000-0000000000a5"
const TEAM_A = "00000000-0000-4000-8000-0000000000b1"
const TEAM_B = "00000000-0000-4000-8000-0000000000b2"
const SUBTEAM_OF_B = "00000000-0000-4000-8000-0000000000b3"

type VersionScope = { scopeType: string; teamId: string | null; subteamId: string | null }

/** O Orquestrador hoje é do Grupo B (passa na publicação); a versão consultada guarda o alcance de quando ela foi publicada. */
function fakeDb(versionScope: VersionScope, origin: "PINNED" | "LEGACY" = "PINNED") {
  const seen: string[] = []
  const version = { id: VERSION_ID, number: 1, config: { ...versionScope, specialists: [{ agentId: SPECIALIST_ID, toolName: "especialista_a" }] } }
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const text = sql.replace(/\s+/g, " ")
    seen.push(text)
    const rows = (list: unknown[]) => ({ rows: list, rowCount: list.length })
    if (text.includes("from assistant_orchestrators o join agents a")) {
      return rows([{ organization_id: ORG, id: ORCHESTRATOR_ID, name: "Monitoria", scope_type: "TEAM", team_id: TEAM_B, subteam_id: null, orchestrator_agent_id: COORDINATOR_ID, objective: "Coordenar", description: "", context_prompt: "", output_instructions: null, output_schema: null, structured_output: null, recommend_support_materials: false }])
    }
    if (text.includes("from assistant_orchestrator_versions where id = $1 and orchestrator_id = $2")) return rows(origin === "PINNED" && params[0] === VERSION_ID ? [version] : [])
    if (text.includes("from assistant_orchestrator_versions where orchestrator_id = $1")) return rows(origin === "LEGACY" ? [version] : [])
    if (text.includes("select team_id from subteams where id = $1")) return rows(params[0] === SUBTEAM_OF_B ? [{ team_id: TEAM_B }] : [])
    const versioned = answerAgentVersionQuery(text, params, (agentId) => (agentId === COORDINATOR_ID || agentId === SPECIALIST_ID ? { id: agentId, name: agentId === COORDINATOR_ID ? "Coordenador" : "Especialista A", active: true } : undefined))
    if (versioned) return versioned
    return rows([])
  })
  return { db: { query } as unknown as Database, seen }
}

const WORKFLOW_OF_B = { scopeType: "TEAM", teamId: TEAM_B, subteamId: null }

describe("resolveOrchestratorById — versão fixada × alcance do Workflow", () => {
  it("versão fixada de outro Grupo: falha fechada, terminal e registrada, antes de qualquer especialista", async () => {
    const { db, seen } = fakeDb({ scopeType: "TEAM", teamId: TEAM_A, subteamId: null })
    const error = await resolveOrchestratorById(db, ORG, ORCHESTRATOR_ID, "WORKFLOW", "Analise", { versionId: VERSION_ID, legacyPin: false, workflowScope: WORKFLOW_OF_B }).then(
      () => null,
      (caught: unknown) => caught,
    )

    expect(error).toMatchObject({ code: "WORKFLOW_ORCHESTRATOR_VERSION_SCOPE_FORBIDDEN" })
    expect((error as Error).message).toContain('Orquestrador "Monitoria"')
    expect((error as Error).message).toContain("não está disponível para o grupo deste workflow")
    // O motor encerra sem nova tentativa (nada muda entre uma tentativa e outra) e grava o motivo no evento da execução.
    expect(classifyExecutionError(error)).toMatchObject({ category: "APPLICATION_INVARIANT_VIOLATION", code: "WORKFLOW_ORCHESTRATOR_VERSION_SCOPE_FORBIDDEN" })
    // Nem os especialistas da versão, nem a lista atual do Orquestrador: nada roda com o alcance errado nem cai na versão atual.
    expect(seen.some((sql) => sql.includes("agent_versions") || sql.includes("assistant_orchestrator_specialists") || sql.includes("from agents"))).toBe(false)
    expect(seen.some((sql) => /^\s*(insert|update)/i.test(sql))).toBe(false)
  })

  it("etapa publicada antes do versionamento (versão de origem da migração) de outro Grupo: a mesma falha", async () => {
    const { db } = fakeDb({ scopeType: "TEAM", teamId: TEAM_A, subteamId: null }, "LEGACY")
    await expect(resolveOrchestratorById(db, ORG, ORCHESTRATOR_ID, "WORKFLOW", "Analise", { versionId: null, legacyPin: true, workflowScope: WORKFLOW_OF_B })).rejects.toMatchObject({
      code: "WORKFLOW_ORCHESTRATOR_VERSION_SCOPE_FORBIDDEN",
    })
  })

  it("versão de um Subgrupo do Grupo do Workflow: compatível pela mesma regra da publicação, executa com o alcance e os especialistas dela", async () => {
    const { db } = fakeDb({ scopeType: "SUBTEAM", teamId: TEAM_B, subteamId: SUBTEAM_OF_B })
    const resolved = await resolveOrchestratorById(db, ORG, ORCHESTRATOR_ID, "WORKFLOW", "Analise", { versionId: VERSION_ID, legacyPin: false, workflowScope: WORKFLOW_OF_B })

    expect(resolved).toMatchObject({ orchestratorVersionId: VERSION_ID, consumerScope: { scopeType: "SUBTEAM", teamId: TEAM_B, subteamId: SUBTEAM_OF_B } })
    expect(resolved!.specialists.map((specialist) => specialist.agentId)).toEqual([SPECIALIST_ID])
  })

  it("versão de Todos os grupos serve a qualquer Workflow", async () => {
    const { db } = fakeDb({ scopeType: "ALL_TEAMS", teamId: null, subteamId: null })
    const resolved = await resolveOrchestratorById(db, ORG, ORCHESTRATOR_ID, "WORKFLOW", "Analise", { versionId: VERSION_ID, legacyPin: false, workflowScope: WORKFLOW_OF_B })
    expect(resolved!.specialists.map((specialist) => specialist.agentId)).toEqual([SPECIALIST_ID])
  })
})
