import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { legacyAccessQuery } from "../../access/testing/legacy-admin-fixture.js"

const TEAM_A = "11111111-1111-4111-8111-111111111111"
const TEAM_B = "22222222-2222-4222-8222-222222222222"

const ACCOUNT = {
  id: "acc-1",
  organization_id: "00000000-0000-4000-8000-000000000001",
  person_id: "person-1",
  name: "Admin de Contas",
  role: "ADMIN",
  email: "admin@inia.com",
  avatar_url: null,
  job_title: null,
  team_id: null,
  team_name: null,
}

const WORKFLOW_ALL_TEAMS = { id: "wf-1", scopeType: "ALL_TEAMS", teamId: null, subteamId: null, name: "Geral" }
const WORKFLOW_TEAM_A = { id: "wf-2", scopeType: "TEAM", teamId: TEAM_A, subteamId: null, name: "Time A" }
const WORKFLOW_TEAM_B = { id: "wf-3", scopeType: "TEAM", teamId: TEAM_B, subteamId: null, name: "Time B" }

function fakeDatabase(
  roleAssignmentRows: unknown[],
  passwordHash: string,
  extra?: (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount: number } | undefined,
): Database {
  async function routedQuery(sql: string, params?: unknown[]) {
    const extraResult = extra?.(sql, params)
    if (extraResult) return extraResult
    if (sql.includes("from user_accounts ua")) {
      return { rows: [{ ...ACCOUNT, password_hash: passwordHash, active: true }], rowCount: 1 }
    }
    const access = legacyAccessQuery(sql, ACCOUNT.role, roleAssignmentRows as never)
    if (access) return access
    if (sql.includes("from user_role_assignments")) {
      return { rows: roleAssignmentRows, rowCount: roleAssignmentRows.length }
    }
    if (sql.includes("from subteams where team_id")) {
      return { rows: [], rowCount: 0 }
    }
    // Capacidades do catálogo (validate-indicator-capabilities.ts): todo código referenciado
    // existe, está ativo e tem medição operacional + fechamento oficial — os testes deste arquivo
    // exercitam as demais regras do publish, não o catálogo.
    if (sql.includes("official_closure_supported from indicator_definitions")) {
      const codes = (params?.[1] as string[] | undefined) ?? []
      const rows = codes.map((code) => ({ code, name: code, active: true, daily_supported: true, official_closure_supported: true }))
      return { rows, rowCount: rows.length }
    }
    if (sql.includes("from workflows w")) {
      // A listagem filtra o escopo gerenciável no próprio SQL (applyManageableScopeFilter) —
      // aqui a condição é reproduzida sobre os arrays de uuid que chegam nos params.
      const rows = [WORKFLOW_ALL_TEAMS, WORKFLOW_TEAM_A, WORKFLOW_TEAM_B].filter((row) => {
        if (!sql.includes(`q."scopeType" = 'TEAM'`)) return true
        const paramAt = (pattern: RegExp) => (params?.[Number(pattern.exec(sql)?.[1]) - 1] as string[] | undefined) ?? []
        const teamIds = paramAt(/"teamId" = any\(\$(\d+)::uuid\[\]\)/)
        const subteamIds = paramAt(/"subteamId" = any\(\$(\d+)::uuid\[\]\)/)
        return (row.scopeType === "TEAM" && teamIds.includes(row.teamId!)) || (row.scopeType === "SUBTEAM" && subteamIds.includes(row.subteamId!))
      })
      if (sql.startsWith("select count(*)")) return { rows: [{ total: rows.length }], rowCount: 1 }
      return { rows, rowCount: rows.length }
    }
    return { rows: [], rowCount: 0 }
  }
  return {
    query: routedQuery,
    // Só os testes de publish bem-sucedido chegam a usar uma transação de verdade (o publish
    // insere workflow_versions + atualiza active_version_id dentro de begin/commit) — os demais
    // testes deste arquivo nunca chamam connect(), então devolver um client funcional aqui não
    // muda o comportamento deles.
    connect: async () => ({
      query: routedQuery,
      release: () => {},
    }),
  } as unknown as Database
}

describe("workflow-router", () => {
  it("blocks the workflow list without a session", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const response = await request(createApp(fakeDatabase([], passwordHash))).get("/api/v1/admin/workflows")
    expect(response.status).toBe(401)
  })

  it("an admin with no role assignment (today's default) sees every workflow", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const agent = request.agent(createApp(fakeDatabase([], passwordHash)))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
    const response = await agent.get("/api/v1/admin/workflows")
    expect(response.status).toBe(200)
    expect(response.body.data.map((row: { id: string }) => row.id)).toEqual(["wf-1", "wf-2", "wf-3"])
  })

  it("an admin scoped to team A only sees team A's own workflow — not ALL_TEAMS or team B", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const scopedAssignment = [{ scope_type: "TEAM", team_id: TEAM_A, subteam_id: null }]
    const agent = request.agent(createApp(fakeDatabase(scopedAssignment, passwordHash)))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
    const response = await agent.get("/api/v1/admin/workflows")
    expect(response.status).toBe(200)
    expect(response.body.data.map((row: { id: string }) => row.id)).toEqual(["wf-2"])
  })

  it("returns a paginated envelope (items/total/page/pageSize) when page or pageSize is sent, still honoring the admin scope", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const scopedAssignment = [{ scope_type: "TEAM", team_id: TEAM_A, subteam_id: null }]
    const seenSql: { sql: string; params: unknown[] }[] = []
    const database = fakeDatabase(scopedAssignment, passwordHash, (sql, params) => {
      if (sql.includes("from workflows w")) seenSql.push({ sql, params: params ?? [] })
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
    const response = await agent.get("/api/v1/admin/workflows?page=2&pageSize=5&search=nota&triggerKind=schedule,indicator&published=true")
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({ items: [WORKFLOW_TEAM_A], total: 1, page: 2, pageSize: 5 })

    const pageQuery = seenSql.find(({ sql }) => sql.includes("limit"))!
    expect(pageQuery.sql).toContain("ilike")
    expect(pageQuery.sql).toContain("q.trigger ->> 'kind' = any(")
    expect(pageQuery.sql).toContain("q.published = ")
    expect(pageQuery.params).toEqual(expect.arrayContaining(["%nota%", ["schedule", "indicator"], true, [TEAM_A], [], 5, 5]))
  })

  it("rejects an invalid page size instead of silently clamping it", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const agent = request.agent(createApp(fakeDatabase([], passwordHash)))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
    const response = await agent.get("/api/v1/admin/workflows?page=1&pageSize=500")
    expect(response.status).toBe(400)
  })

  it("refuses to publish a graph that calls an agent but has no Output node", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        { id: "action", type: "action", label: "Ação", position: { x: 0, y: 160 }, config: { actionType: "CALL_AGENT", agentId: "11111111-1111-4111-8111-111111111111" } },
        { id: "end", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "action" },
        { id: "e2", source: "action", sourceHandle: "always", target: "end" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return {
          rows: [
            {
              scopeType: "ALL_TEAMS",
              teamId: null,
              subteamId: null,
              draftGraph,
              triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" },
            },
          ],
          rowCount: 1,
        }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("WORKFLOW_MISSING_OUTPUT")
  })

  it("publishes a condition that compares a previous node's result (sourcePath) even under a NUMERIC channel_flag trigger (regression: used to require thresholdNumeric unconditionally)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "condition",
          type: "condition",
          label: "Severidade crítica?",
          position: { x: 0, y: 160 },
          config: { comparator: "EQUALS", thresholdText: "CRITICAL", sourcePath: "nodeOutputs.orchestrator.structuredResult.diagnosis.severity" },
        },
        { id: "end-true", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
        { id: "end-false", type: "end", label: "Fim", position: { x: 200, y: 320 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
        { id: "e2", source: "condition", sourceHandle: "true", target: "end-true" },
        { id: "e3", source: "condition", sourceHandle: "false", target: "end-false" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return {
          rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }],
          rowCount: 1,
        }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      if (sql.trim().startsWith("insert into workflow_versions")) return { rows: [{ id: "version-1" }], rowCount: 1 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(200)
  })

  it("publishes a schedule-triggered workflow with a historicalQuery condition (regression: schedule used to reject any Condition node)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "condition",
          type: "condition",
          label: "Reincidência",
          position: { x: 0, y: 160 },
          config: {
            comparator: "GTE",
            thresholdNumeric: 3,
            historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "NOTA_URA", comparator: "LT", indicatorThreshold: 3, windowDays: 7 },
          },
        },
        { id: "end-true", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
        { id: "end-false", type: "end", label: "Fim", position: { x: 200, y: 320 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
        { id: "e2", source: "condition", sourceHandle: "true", target: "end-true" },
        { id: "e3", source: "condition", sourceHandle: "false", target: "end-false" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return {
          rows: [
            { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "schedule", times: ["07:00"], intervalDays: 1 } },
          ],
          rowCount: 1,
        }
      }
      if (sql.trim().startsWith("insert into workflow_versions")) return { rows: [{ id: "version-1" }], rowCount: 1 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(200)
  })

  it("rejects publishing a condition whose comparator is incompatible with a known Structured Output field's type", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "orch",
          type: "orchestrator",
          label: "Orquestrador",
          position: { x: 0, y: 160 },
          config: { orchestratorId: "22222222-2222-4222-8222-222222222222", instruction: "Analise." },
        },
        {
          id: "condition",
          type: "condition",
          label: "Confiança maior que?",
          position: { x: 0, y: 320 },
          // GT não está entre os comparadores válidos para BOOLEAN — mesmo que o frontend só ofereça
          // EQUALS pra esse tipo, o backend nunca confia nisso.
          config: { comparator: "GT", thresholdNumeric: 1, sourcePath: "nodeOutputs.orch.structuredResult.flags.offensiveLanguage" },
        },
        { id: "end-true", type: "end", label: "Fim", position: { x: 0, y: 480 }, config: {} },
        { id: "end-false", type: "end", label: "Fim", position: { x: 200, y: 480 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "orch" },
        { id: "e2", source: "orch", sourceHandle: "always", target: "condition" },
        { id: "e3", source: "condition", sourceHandle: "true", target: "end-true" },
        { id: "e4", source: "condition", sourceHandle: "false", target: "end-false" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return {
          rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }],
          rowCount: 1,
        }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      if (sql.includes("from workflow_variables where workflow_id")) return { rows: [], rowCount: 0 }
      if (sql.includes("from assistant_orchestrators where id = any")) {
        return {
          rows: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              output_schema: [{ key: "flags", label: "Flags", fields: [{ key: "offensiveLanguage", label: "Linguagem ofensiva", type: "BOOLEAN" }] }],
              scopeType: "ALL_TEAMS",
              teamId: null,
              subteamId: null,
              name: "Orquestrador",
            },
          ],
          rowCount: 1,
        }
      }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("WORKFLOW_INVALID_CONDITION")
  })

  it("publishes a condition over a known Structured Output boolean field with a compatible comparator", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "orch",
          type: "orchestrator",
          label: "Orquestrador",
          position: { x: 0, y: 160 },
          config: { orchestratorId: "22222222-2222-4222-8222-222222222222", instruction: "Analise." },
        },
        {
          id: "condition",
          type: "condition",
          label: "Linguagem ofensiva?",
          position: { x: 0, y: 320 },
          config: { comparator: "EQUALS", thresholdBoolean: true, sourcePath: "nodeOutputs.orch.structuredResult.flags.offensiveLanguage" },
        },
        { id: "end-true", type: "end", label: "Fim", position: { x: 0, y: 480 }, config: {} },
        { id: "end-false", type: "end", label: "Fim", position: { x: 200, y: 480 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "orch" },
        { id: "e2", source: "orch", sourceHandle: "always", target: "condition" },
        { id: "e3", source: "condition", sourceHandle: "true", target: "end-true" },
        { id: "e4", source: "condition", sourceHandle: "false", target: "end-false" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return {
          rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }],
          rowCount: 1,
        }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      if (sql.includes("from workflow_variables where workflow_id")) return { rows: [], rowCount: 0 }
      if (sql.includes("from assistant_orchestrators where id = any")) {
        return {
          rows: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              output_schema: [{ key: "flags", label: "Flags", fields: [{ key: "offensiveLanguage", label: "Linguagem ofensiva", type: "BOOLEAN" }] }],
              scopeType: "ALL_TEAMS",
              teamId: null,
              subteamId: null,
              name: "Orquestrador",
            },
          ],
          rowCount: 1,
        }
      }
      if (sql.trim().startsWith("insert into workflow_versions")) return { rows: [{ id: "version-1" }], rowCount: 1 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(200)
  })

  it("rejects publishing a condition over variables.<id> when the variable no longer exists", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "condition",
          type: "condition",
          label: "URA baixa?",
          position: { x: 0, y: 160 },
          config: { comparator: "EQUALS", thresholdBoolean: true, sourcePath: "variables.missing-var" },
        },
        { id: "end-true", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
        { id: "end-false", type: "end", label: "Fim", position: { x: 200, y: 320 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
        { id: "e2", source: "condition", sourceHandle: "true", target: "end-true" },
        { id: "e3", source: "condition", sourceHandle: "false", target: "end-false" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return {
          rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }],
          rowCount: 1,
        }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      if (sql.includes("from workflow_variables where workflow_id")) return { rows: [], rowCount: 0 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("WORKFLOW_INVALID_CONDITION")
  })

  it("publishes a condition over a known Workflow Variable (NUMERIC) with a compatible comparator", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "condition",
          type: "condition",
          label: "Contagem >= 3?",
          position: { x: 0, y: 160 },
          config: { comparator: "GTE", thresholdNumeric: 3, sourcePath: "variables.var-1" },
        },
        { id: "end-true", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
        { id: "end-false", type: "end", label: "Fim", position: { x: 200, y: 320 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
        { id: "e2", source: "condition", sourceHandle: "true", target: "end-true" },
        { id: "e3", source: "condition", sourceHandle: "false", target: "end-false" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return {
          rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }],
          rowCount: 1,
        }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      if (sql.includes("from workflow_variables where workflow_id")) return { rows: [{ id: "var-1", type: "NUMERIC" }], rowCount: 1 }
      if (sql.trim().startsWith("insert into workflow_versions")) return { rows: [{ id: "version-1" }], rowCount: 1 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(200)
  })

  it("still publishes a legacy structuredResult condition when the orchestrator has no output_schema configured (backward compatibility)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "orch",
          type: "orchestrator",
          label: "Orquestrador",
          position: { x: 0, y: 160 },
          config: { orchestratorId: "22222222-2222-4222-8222-222222222222", instruction: "Analise." },
        },
        {
          id: "condition",
          type: "condition",
          label: "Severidade crítica?",
          position: { x: 0, y: 320 },
          config: { comparator: "EQUALS", thresholdText: "CRITICAL", sourcePath: "nodeOutputs.orch.structuredResult.diagnosis.severity" },
        },
        { id: "end-true", type: "end", label: "Fim", position: { x: 0, y: 480 }, config: {} },
        { id: "end-false", type: "end", label: "Fim", position: { x: 200, y: 480 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "orch" },
        { id: "e2", source: "orch", sourceHandle: "always", target: "condition" },
        { id: "e3", source: "condition", sourceHandle: "true", target: "end-true" },
        { id: "e4", source: "condition", sourceHandle: "false", target: "end-false" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return {
          rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }],
          rowCount: 1,
        }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      if (sql.includes("from workflow_variables where workflow_id")) return { rows: [], rowCount: 0 }
      if (sql.includes("from assistant_orchestrators where id = any")) {
        return { rows: [{ id: "22222222-2222-4222-8222-222222222222", output_schema: null, scopeType: "ALL_TEAMS", teamId: null, subteamId: null, name: "Orquestrador" }], rowCount: 1 }
      }
      if (sql.trim().startsWith("insert into workflow_versions")) return { rows: [{ id: "version-1" }], rowCount: 1 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(200)
  })

  it("creates, renames, and blocks deletion of a referenced workflow variable", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const calls: { sql: string; params: unknown[] }[] = []
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "action",
          type: "action",
          label: "Definir variável",
          position: { x: 0, y: 160 },
          config: { actionType: "SET_VARIABLE", variableId: "var-1", value: true },
        },
        { id: "end", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "action" },
        { id: "e2", source: "action", sourceHandle: "always", target: "end" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql, params) => {
      calls.push({ sql, params: params ?? [] })
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null }], rowCount: 1 }
      }
      if (sql.trim().startsWith("insert into workflow_variables")) {
        return { rows: [{ id: "var-1", name: "URA baixa", type: "BOOLEAN", createdAt: "2026-01-01T00:00:00Z" }], rowCount: 1 }
      }
      if (sql.trim().startsWith("update workflow_variables")) {
        return { rows: [{ id: "var-1", name: "Nota URA crítica", type: "BOOLEAN", createdAt: "2026-01-01T00:00:00Z" }], rowCount: 1 }
      }
      if (sql.includes("select w.draft_graph")) {
        return { rows: [{ draft_graph: draftGraph, published_graph: null }], rowCount: 1 }
      }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const created = await agent.post("/api/v1/admin/workflows/wf-1/variables").send({ name: "URA baixa", type: "BOOLEAN" })
    expect(created.status).toBe(201)
    expect(created.body.data.id).toBe("var-1")

    const renamed = await agent.patch("/api/v1/admin/workflows/wf-1/variables/var-1").send({ name: "Nota URA crítica" })
    expect(renamed.status).toBe(200)
    expect(renamed.body.data.name).toBe("Nota URA crítica")

    const deleted = await agent.delete("/api/v1/admin/workflows/wf-1/variables/var-1")
    expect(deleted.status).toBe(409)
    expect(deleted.body.error.code).toBe("WORKFLOW_VARIABLE_IN_USE")
  })

  it("accepts a human review decision when the enrollment is waiting at that exact node", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const calls: { sql: string; params: unknown[] }[] = []
    const database = fakeDatabase([], passwordHash, (sql, params) => {
      calls.push({ sql, params: params ?? [] })
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null }], rowCount: 1 }
      }
      if (sql.includes("from workflow_enrollments where id = $1 and workflow_id = $2")) {
        return { rows: [{ id: "enr-1", status: "waiting", current_node_id: "review", revision: 3 }], rowCount: 1 }
      }
      if (sql.trim().startsWith("update workflow_enrollments")) return { rows: [], rowCount: 1 }
      if (sql.trim().startsWith("insert into workflow_enrollment_events")) return { rows: [], rowCount: 1 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/enrollments/enr-1/decision").send({ nodeId: "review", decision: "approved" })
    expect(response.status).toBe(204)
    const update = calls.find((call) => call.sql.trim().startsWith("update workflow_enrollments"))
    expect(update?.params).toEqual(["review", expect.stringContaining('"decision":"approved"'), "enr-1", 3])
  })

  it("refuses a decision when the enrollment isn't waiting at that node", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null }], rowCount: 1 }
      }
      if (sql.includes("from workflow_enrollments where id = $1 and workflow_id = $2")) {
        return { rows: [{ id: "enr-1", status: "active", current_node_id: "review", revision: 3 }], rowCount: 1 }
      }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/enrollments/enr-1/decision").send({ nodeId: "review", decision: "approved" })
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe("ENROLLMENT_NOT_AWAITING_DECISION")
  })

  it("publica uma Condition com group ANY (OU) quando todas as regras são válidas", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "condition",
          type: "condition",
          label: "Q4 indicador ou PRV",
          position: { x: 0, y: 160 },
          config: {
            comparator: "EQUALS",
            group: {
              operator: "ANY",
              rules: [
                { comparator: "EQUALS", thresholdText: "Q4", sourcePath: "variables.var-quartil" },
                { comparator: "EQUALS", thresholdBoolean: true, sourcePath: "nodeOutputs.orch.structuredResult.flags.q4" },
              ],
            },
          },
        },
        { id: "end-true", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
        { id: "end-false", type: "end", label: "Fim", position: { x: 200, y: 320 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
        { id: "e2", source: "condition", sourceHandle: "true", target: "end-true" },
        { id: "e3", source: "condition", sourceHandle: "false", target: "end-false" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }], rowCount: 1 }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      if (sql.includes("from workflow_variables where workflow_id")) return { rows: [{ id: "var-quartil", type: "TEXT" }], rowCount: 1 }
      if (sql.includes("from assistant_orchestrators where id = any")) return { rows: [], rowCount: 0 }
      if (sql.trim().startsWith("insert into workflow_versions")) return { rows: [{ id: "version-1" }], rowCount: 1 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(200)
  })

  it("rejeita group quando uma das regras não tem valor pra comparar", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "condition",
          type: "condition",
          label: "Grupo",
          position: { x: 0, y: 160 },
          config: {
            comparator: "EQUALS",
            group: { operator: "ALL", rules: [{ comparator: "LT", sourcePath: "nodeOutputs.orch.structuredResult.diagnosis.confidence" }] },
          },
        },
        { id: "end-true", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
        { id: "end-false", type: "end", label: "Fim", position: { x: 200, y: 320 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
        { id: "e2", source: "condition", sourceHandle: "true", target: "end-true" },
        { id: "e3", source: "condition", sourceHandle: "false", target: "end-false" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }], rowCount: 1 }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      if (sql.includes("from workflow_variables where workflow_id")) return { rows: [], rowCount: 0 }
      if (sql.includes("from assistant_orchestrators where id = any")) return { rows: [], rowCount: 0 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("WORKFLOW_INVALID_CONDITION")
  })

  it("rejeita histórico (Parte 2) sem período definido (nem windowDays nem period)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "condition",
          type: "condition",
          label: "Média URA",
          position: { x: 0, y: 160 },
          config: {
            comparator: "LT",
            thresholdNumeric: 3.3,
            historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "NOTA_URA", aggregation: "AVERAGE" },
          },
        },
        { id: "end-true", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
        { id: "end-false", type: "end", label: "Fim", position: { x: 200, y: 320 }, config: {} },
        { id: "end-no-data", type: "end", label: "Fim", position: { x: 400, y: 320 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
        { id: "e2", source: "condition", sourceHandle: "true", target: "end-true" },
        { id: "e3", source: "condition", sourceHandle: "false", target: "end-false" },
        { id: "e4", source: "condition", sourceHandle: "no_data", target: "end-no-data" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }], rowCount: 1 }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("WORKFLOW_INVALID_CONDITION")
  })

  it("publica uma Condition de performanceQuery sobre quartil do PRV com 3 saídas (sim/não/sem dados)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "condition",
          type: "condition",
          label: "Quartil PRV",
          position: { x: 0, y: 160 },
          config: { comparator: "EQUALS", thresholdText: "Q4", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE" } },
        },
        { id: "end-true", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
        { id: "end-false", type: "end", label: "Fim", position: { x: 200, y: 320 }, config: {} },
        { id: "end-no-data", type: "end", label: "Fim", position: { x: 400, y: 320 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
        { id: "e2", source: "condition", sourceHandle: "true", target: "end-true" },
        { id: "e3", source: "condition", sourceHandle: "false", target: "end-false" },
        { id: "e4", source: "condition", sourceHandle: "no_data", target: "end-no-data" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }], rowCount: 1 }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      if (sql.trim().startsWith("insert into workflow_versions")) return { rows: [{ id: "version-1" }], rowCount: 1 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(200)
  })

  it("publica uma Condition de historicalQuery sobre Atingimento do PRV sem indicatorCode (regressão: PRV é fonte própria, sem indicador)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "condition",
          type: "condition",
          label: "Atingimento do PRV",
          position: { x: 0, y: 160 },
          config: {
            comparator: "LT",
            thresholdNumeric: 70,
            historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", aggregation: "AVERAGE", source: "PRV_ACHIEVEMENT", windowDays: 30 },
          },
        },
        { id: "end-true", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
        { id: "end-false", type: "end", label: "Fim", position: { x: 200, y: 320 }, config: {} },
        { id: "end-no-data", type: "end", label: "Fim", position: { x: 400, y: 320 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
        { id: "e2", source: "condition", sourceHandle: "true", target: "end-true" },
        { id: "e3", source: "condition", sourceHandle: "false", target: "end-false" },
        { id: "e4", source: "condition", sourceHandle: "no_data", target: "end-no-data" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }], rowCount: 1 }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      if (sql.trim().startsWith("insert into workflow_versions")) return { rows: [{ id: "version-1" }], rowCount: 1 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(200)
  })

  it("rejeita historicalQuery sobre Atingimento do indicador sem indicatorCode (a exceção do PRV não vale pras outras origens)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "condition",
          type: "condition",
          label: "Atingimento do indicador",
          position: { x: 0, y: 160 },
          config: {
            comparator: "LT",
            thresholdNumeric: 70,
            historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", aggregation: "AVERAGE", source: "INDICATOR_ACHIEVEMENT", windowDays: 30 },
          },
        },
        { id: "end-true", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
        { id: "end-false", type: "end", label: "Fim", position: { x: 200, y: 320 }, config: {} },
        { id: "end-no-data", type: "end", label: "Fim", position: { x: 400, y: 320 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
        { id: "e2", source: "condition", sourceHandle: "true", target: "end-true" },
        { id: "e3", source: "condition", sourceHandle: "false", target: "end-false" },
        { id: "e4", source: "condition", sourceHandle: "no_data", target: "end-no-data" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }], rowCount: 1 }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("WORKFLOW_INVALID_CONDITION")
  })

  it("rejeita Quantidade de ocorrências (COUNT) junto de Atingimento do indicador (COUNT conta medição bruta, só existe pra Valor)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "condition",
          type: "condition",
          label: "Atingimento do indicador",
          position: { x: 0, y: 160 },
          config: {
            comparator: "GTE",
            thresholdNumeric: 3,
            historicalQuery: {
              kind: "INDICATOR_THRESHOLD_COUNT",
              indicatorCode: "Qualidade",
              aggregation: "COUNT",
              source: "INDICATOR_ACHIEVEMENT",
              comparator: "LT",
              indicatorThreshold: 3,
              windowDays: 7,
            },
          },
        },
        { id: "end-true", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
        { id: "end-false", type: "end", label: "Fim", position: { x: 200, y: 320 }, config: {} },
        { id: "end-no-data", type: "end", label: "Fim", position: { x: 400, y: 320 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
        { id: "e2", source: "condition", sourceHandle: "true", target: "end-true" },
        { id: "e3", source: "condition", sourceHandle: "false", target: "end-false" },
        { id: "e4", source: "condition", sourceHandle: "no_data", target: "end-no-data" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }], rowCount: 1 }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("WORKFLOW_INVALID_CONDITION")
  })

  it("rejeita Quantidade de ocorrências (COUNT) junto de Atingimento do PRV (payload manual — a UI nunca oferece essa combinação)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "condition",
          type: "condition",
          label: "Atingimento do PRV",
          position: { x: 0, y: 160 },
          config: {
            comparator: "GTE",
            thresholdNumeric: 3,
            historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", aggregation: "COUNT", source: "PRV_ACHIEVEMENT", comparator: "LT", indicatorThreshold: 3, windowDays: 7 },
          },
        },
        { id: "end-true", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
        { id: "end-false", type: "end", label: "Fim", position: { x: 200, y: 320 }, config: {} },
        { id: "end-no-data", type: "end", label: "Fim", position: { x: 400, y: 320 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
        { id: "e2", source: "condition", sourceHandle: "true", target: "end-true" },
        { id: "e3", source: "condition", sourceHandle: "false", target: "end-false" },
        { id: "e4", source: "condition", sourceHandle: "no_data", target: "end-no-data" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }], rowCount: 1 }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("WORKFLOW_INVALID_CONDITION")
  })

  it("publica Atingimento do PRV com Mínimo (matriz de agregação — só COUNT é proibido, AVG/MIN/MAX continuam válidos)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "condition",
          type: "condition",
          label: "Atingimento do PRV",
          position: { x: 0, y: 160 },
          config: {
            comparator: "LT",
            thresholdNumeric: 70,
            historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", aggregation: "MINIMUM", source: "PRV_ACHIEVEMENT", windowDays: 30 },
          },
        },
        { id: "end-true", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
        { id: "end-false", type: "end", label: "Fim", position: { x: 200, y: 320 }, config: {} },
        { id: "end-no-data", type: "end", label: "Fim", position: { x: 400, y: 320 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
        { id: "e2", source: "condition", sourceHandle: "true", target: "end-true" },
        { id: "e3", source: "condition", sourceHandle: "false", target: "end-false" },
        { id: "e4", source: "condition", sourceHandle: "no_data", target: "end-no-data" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }], rowCount: 1 }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      if (sql.trim().startsWith("insert into workflow_versions")) return { rows: [{ id: "version-1" }], rowCount: 1 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(200)
  })

  it("rejeita quartil com valor fora de Q1-Q4 (nunca input livre)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "condition",
          type: "condition",
          label: "Quartil inválido",
          position: { x: 0, y: 160 },
          config: { comparator: "EQUALS", thresholdText: "Q9", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE" } },
        },
        { id: "end-true", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
        { id: "end-false", type: "end", label: "Fim", position: { x: 200, y: 320 }, config: {} },
        { id: "end-no-data", type: "end", label: "Fim", position: { x: 400, y: 320 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
        { id: "e2", source: "condition", sourceHandle: "true", target: "end-true" },
        { id: "e3", source: "condition", sourceHandle: "false", target: "end-false" },
        { id: "e4", source: "condition", sourceHandle: "no_data", target: "end-no-data" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }], rowCount: 1 }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("WORKFLOW_INVALID_CONDITION")
  })

  it("rejeita Human Review cujo revisor anterior não é de fato ancestral no grafo", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "review-a",
          type: "human_review",
          label: "Revisão A",
          position: { x: 0, y: 160 },
          config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } },
        },
        {
          id: "review-b",
          type: "human_review",
          label: "Revisão B",
          position: { x: 200, y: 160 },
          // review-b referencia review-a, mas está desconectado dele no grafo (não é ancestral).
          config: { reviewTarget: { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: "review-a" } },
        },
        { id: "end-a", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
        { id: "end-b", type: "end", label: "Fim", position: { x: 200, y: 320 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "review-b" },
        { id: "e2", source: "review-a", sourceHandle: "approved", target: "end-a" },
        { id: "e3", source: "review-a", sourceHandle: "rejected", target: "end-a" },
        { id: "e4", source: "review-a", sourceHandle: "escalated", target: "end-a" },
        { id: "e5", source: "review-b", sourceHandle: "approved", target: "end-b" },
        { id: "e6", source: "review-b", sourceHandle: "rejected", target: "end-b" },
        { id: "e7", source: "review-b", sourceHandle: "escalated", target: "end-b" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }], rowCount: 1 }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("WORKFLOW_INVALID_HUMAN_REVIEW")
  })

  it("rejeita Output publicando resultado completo (objeto multi-campo) pra superfície Avatar", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        {
          id: "orch",
          type: "orchestrator",
          label: "Orquestrador",
          position: { x: 0, y: 160 },
          config: { orchestratorId: "22222222-2222-4222-8222-222222222222", instruction: "Analise." },
        },
        {
          id: "out",
          type: "output",
          label: "Output",
          position: { x: 0, y: 320 },
          // Workflow Outputs V1: Avatar/Chat do PRÓPRIO operador com resultado investigativo exige "Gerar feedback" (teste
          // abaixo); aqui o destinatário é a gestão, para provar só a regra do objeto multi-campo.
          config: { target: { type: "SUPERVISOR_OF_OPERATOR" }, surfaces: ["AVATAR"], source: "nodeOutputs.orch" },
        },
        { id: "end", type: "end", label: "Fim", position: { x: 0, y: 480 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "orch" },
        { id: "e2", source: "orch", sourceHandle: "always", target: "out" },
        { id: "e3", source: "out", sourceHandle: "always", target: "end" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }], rowCount: 1 }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      if (sql.includes("from workflow_variables where workflow_id")) return { rows: [], rowCount: 0 }
      if (sql.includes("from assistant_orchestrators where id = any")) {
        return {
          rows: [{ id: "22222222-2222-4222-8222-222222222222", output_schema: [{ key: "diagnosis", label: "Diagnóstico", fields: [{ key: "cause", label: "Causa", type: "STRING" }] }], scopeType: "ALL_TEAMS", teamId: null, subteamId: null, name: "Orquestrador" }],
          rowCount: 1,
        }
      }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("WORKFLOW_INVALID_OUTPUT")
  })

  it("bloqueia publicar uma Condition/Output apontando pra um campo que não existe mais no resultado estruturado (definição nova, construtor visual)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const structuredOutput = {
      schemaVersion: 1,
      nodes: [{ kind: "GROUP", key: "sintese", label: "Síntese", children: [{ kind: "FIELD", key: "severidade", label: "Severidade", type: "ENUM", required: false, options: [{ value: "BAIXA" }, { value: "ALTA" }] }] }],
    }
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        { id: "orch", type: "orchestrator", label: "Orquestrador", position: { x: 0, y: 160 }, config: { orchestratorId: "22222222-2222-4222-8222-222222222222", instruction: "Analise." } },
        {
          id: "cond",
          type: "condition",
          label: "Criticidade alta?",
          position: { x: 0, y: 320 },
          // "criticidade" foi renomeada para "severidade" no Orquestrador depois que esta Condition foi montada
          config: { sourcePath: "nodeOutputs.orch.structuredResult.sintese.criticidade", comparator: "EQUALS", thresholdText: "ALTA" },
        },
        { id: "end", type: "end", label: "Fim", position: { x: 0, y: 480 }, config: {} },
        { id: "end2", type: "end", label: "Fim 2", position: { x: 200, y: 480 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "orch" },
        { id: "e2", source: "orch", sourceHandle: "always", target: "cond" },
        { id: "e3", source: "cond", sourceHandle: "true", target: "end" },
        { id: "e4", source: "cond", sourceHandle: "false", target: "end2" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }], rowCount: 1 }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      if (sql.includes("from workflow_variables where workflow_id")) return { rows: [], rowCount: 0 }
      if (sql.includes("from assistant_orchestrators where id = any")) {
        return { rows: [{ id: "22222222-2222-4222-8222-222222222222", output_schema: null, structured_output: structuredOutput, output_instructions: "gerado", scopeType: "ALL_TEAMS", teamId: null, subteamId: null, name: "Orquestrador", active: true, invocation_mode: "WORKFLOW" }], rowCount: 1 }
      }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("WORKFLOW_STRUCTURED_FIELD_NOT_FOUND")
    expect(response.body.error.message).toContain('"sintese.criticidade"')
  })

  it("permite Output publicando pra Avatar a partir de um CALL_AGENT sem schema conhecido (preserva TESTE 07)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const draftGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        { id: "agent", type: "action", label: "Agente", position: { x: 0, y: 160 }, config: { actionType: "CALL_AGENT", agentId: "11111111-1111-4111-8111-111111111111" } },
        {
          id: "out",
          type: "output",
          label: "Output",
          position: { x: 0, y: 320 },
          // V1.5.12 / Workflow Outputs V1: feedback oficial (gatilho por Flag) no Acompanhamento, Chat ou Avatar do PRÓPRIO
          // operador exige "Gerar feedback" (teste abaixo); este teste continua provando só o Avatar a partir de um CALL_AGENT
          // sem schema, entregue à gestão.
          config: { target: { type: "SUPERVISOR_OF_OPERATOR" }, surfaces: ["AVATAR"], source: "nodeOutputs.agent" },
        },
        { id: "end", type: "end", label: "Fim", position: { x: 0, y: 480 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "agent" },
        { id: "e2", source: "agent", sourceHandle: "always", target: "out" },
        { id: "e3", source: "out", sourceHandle: "always", target: "end" },
      ],
    }
    const database = fakeDatabase([], passwordHash, (sql) => {
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }], rowCount: 1 }
      }
      if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
      if (sql.includes("from workflow_variables where workflow_id")) return { rows: [], rowCount: 0 }
      if (sql.includes("from agents where id = any")) return { rows: [{ id: "11111111-1111-4111-8111-111111111111", name: "Agente", active: true, agent_type: "CALL_FEEDBACK" }], rowCount: 1 }
      if (sql.trim().startsWith("insert into workflow_versions")) return { rows: [{ id: "version-1" }], rowCount: 1 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })

    const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
    expect(response.status).toBe(200)
  })

  it("Workflow Outputs V1: resultado de Agent (gatilho por Flag) no Avatar/Chat do próprio operador exige \"Gerar feedback\"", async () => {
    const passwordHash = await hashPassword("Inia@123")
    for (const surface of ["AVATAR", "CHAT"]) {
      const draftGraph = {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          { id: "agent", type: "action", label: "Agente", position: { x: 0, y: 160 }, config: { actionType: "CALL_AGENT", agentId: "11111111-1111-4111-8111-111111111111" } },
          { id: "out", type: "output", label: "Output", position: { x: 0, y: 320 }, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: [surface], source: "nodeOutputs.agent" } },
          { id: "end", type: "end", label: "Fim", position: { x: 0, y: 480 }, config: {} },
        ],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "agent" },
          { id: "e2", source: "agent", sourceHandle: "always", target: "out" },
          { id: "e3", source: "out", sourceHandle: "always", target: "end" },
        ],
      }
      const database = fakeDatabase([], passwordHash, (sql) => {
        if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
          return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }], rowCount: 1 }
        }
        if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
        if (sql.includes("from workflow_variables where workflow_id")) return { rows: [], rowCount: 0 }
        if (sql.includes("from agents where id = any")) return { rows: [{ id: "11111111-1111-4111-8111-111111111111", name: "Agente", active: true, agent_type: "CALL_FEEDBACK" }], rowCount: 1 }
        return undefined
      })
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.post("/api/v1/admin/workflows/wf-1/publish")
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_FEEDBACK_REQUIRES_RELIABILITY")
    }
  })

  describe("Definir variável — valor dinâmico (evolução de Variáveis do Workflow)", () => {
    const VAR_1 = "44444444-4444-4444-8444-444444444444"
    const VAR_A = "55555555-5555-4555-8555-555555555555"
    const VAR_B = "66666666-6666-4666-8666-666666666666"
    const VAR_GONE = "77777777-7777-4777-8777-777777777777"
    const ORCHESTRATOR_ID = "22222222-2222-4222-8222-222222222222"
    const SIBLING_ORCHESTRATOR_ID = "33333333-3333-4333-8333-333333333333"

    function setVariableGraph(actionConfig: Record<string, unknown>, extraNodes: unknown[] = [], extraEdges: unknown[] = []) {
      return {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          {
            id: "orch",
            type: "orchestrator",
            label: "Orquestrador",
            position: { x: 0, y: 160 },
            config: { orchestratorId: ORCHESTRATOR_ID, instruction: "Analise." },
          },
          { id: "action", type: "action", label: "Definir variável", position: { x: 0, y: 320 }, config: actionConfig },
          { id: "end", type: "end", label: "Fim", position: { x: 0, y: 480 }, config: {} },
          ...extraNodes,
        ],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "orch" },
          { id: "e2", source: "orch", sourceHandle: "always", target: "action" },
          { id: "e3", source: "action", sourceHandle: "always", target: "end" },
          ...extraEdges,
        ],
      }
    }

    const ORCH_SCHEMA = [{ key: "diagnosis", label: "Diagnóstico", fields: [{ key: "risk", label: "Risco", type: "NUMBER" }, { key: "tags", label: "Tags", type: "ARRAY" }] }]

    async function runPublish(draftGraph: unknown, variableRows: unknown[], orchestratorSchema: unknown = ORCH_SCHEMA) {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabase([], passwordHash, (sql) => {
        if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
          return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }], rowCount: 1 }
        }
        if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
        if (sql.includes("from workflow_variables where workflow_id")) return { rows: variableRows, rowCount: variableRows.length }
        if (sql.includes("from assistant_orchestrators where id = any")) {
          return { rows: [{ id: ORCHESTRATOR_ID, output_schema: orchestratorSchema, scopeType: "ALL_TEAMS", teamId: null, subteamId: null, name: "Orquestrador" }], rowCount: 1 }
        }
        if (sql.includes("from agents where id = any")) return { rows: [{ id: "11111111-1111-4111-8111-111111111111", name: "Agente", active: true, agent_type: "CALL_FEEDBACK" }], rowCount: 1 }
        if (sql.trim().startsWith("insert into workflow_versions")) return { rows: [{ id: "version-1" }], rowCount: 1 }
        return undefined
      })
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      return agent.post("/api/v1/admin/workflows/wf-1/publish")
    }

    it("publica com origem dinâmica = valor do gatilho", async () => {
      const response = await runPublish(setVariableGraph({ actionType: "SET_VARIABLE", variableId: VAR_1, sourcePath: "nodeOutputs.trigger" }), [
        { id: VAR_1, type: "NUMERIC", name: "Nota recebida" },
      ])
      expect(response.status).toBe(200)
    })

    it("publica com origem dinâmica = campo de Structured Output de tipo compatível", async () => {
      const response = await runPublish(
        setVariableGraph({ actionType: "SET_VARIABLE", variableId: VAR_1, sourcePath: "nodeOutputs.orch.structuredResult.diagnosis.risk" }),
        [{ id: VAR_1, type: "NUMERIC", name: "Pontuação de risco" }],
      )
      expect(response.status).toBe(200)
    })

    it("rejeita origem dinâmica = campo de Structured Output do tipo ARRAY (nunca compatível com variável nenhuma)", async () => {
      const response = await runPublish(
        setVariableGraph({ actionType: "SET_VARIABLE", variableId: VAR_1, sourcePath: "nodeOutputs.orch.structuredResult.diagnosis.tags" }),
        [{ id: VAR_1, type: "TEXT", name: "Tags" }],
      )
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_ACTION")
    })

    it("rejeita origem dinâmica = campo de Structured Output de tipo incompatível com a variável", async () => {
      const response = await runPublish(
        setVariableGraph({ actionType: "SET_VARIABLE", variableId: VAR_1, sourcePath: "nodeOutputs.orch.structuredResult.diagnosis.risk" }),
        [{ id: VAR_1, type: "BOOLEAN", name: "Pontuação de risco" }],
      )
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_ACTION")
    })

    it("rejeita origem dinâmica apontando pra um nó que não é ancestral (branch impossível)", async () => {
      const draftGraph = setVariableGraph(
        { actionType: "SET_VARIABLE", variableId: VAR_1, sourcePath: "nodeOutputs.sibling.structuredResult.diagnosis.risk" },
        [
          {
            id: "sibling",
            type: "orchestrator",
            label: "Outro orquestrador",
            position: { x: 300, y: 160 },
            config: { orchestratorId: SIBLING_ORCHESTRATOR_ID, instruction: "Outro." },
          },
        ],
        // "sibling" não tem NENHUMA edge chegando a partir do trigger — nunca é ancestral de "action".
      )
      const response = await runPublish(draftGraph, [{ id: VAR_1, type: "NUMERIC", name: "Pontuação de risco" }])
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_ACTION")
    })

    it("rejeita origem dinâmica = variável de outro tipo", async () => {
      const response = await runPublish(setVariableGraph({ actionType: "SET_VARIABLE", variableId: VAR_B, sourcePath: `variables.${VAR_A}` }), [
        { id: VAR_A, type: "TEXT", name: "Feedback" },
        { id: VAR_B, type: "NUMERIC", name: "Pontuação" },
      ])
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_ACTION")
    })

    it("rejeita valor fixo de tipo incompatível com a variável, mesmo sem sourcePath", async () => {
      const response = await runPublish(setVariableGraph({ actionType: "SET_VARIABLE", variableId: VAR_1, value: "não é número" }), [
        { id: VAR_1, type: "NUMERIC", name: "Pontuação de risco" },
      ])
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_ACTION")
    })

    it("rejeita um ciclo entre variáveis (A depende de B, B depende de A), mesmo indireto", async () => {
      const draftGraph = {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          { id: "set-a", type: "action", label: "Definir A", position: { x: 0, y: 160 }, config: { actionType: "SET_VARIABLE", variableId: VAR_A, sourcePath: `variables.${VAR_B}` } },
          { id: "set-b", type: "action", label: "Definir B", position: { x: 0, y: 320 }, config: { actionType: "SET_VARIABLE", variableId: VAR_B, sourcePath: `variables.${VAR_A}` } },
          { id: "end", type: "end", label: "Fim", position: { x: 0, y: 480 }, config: {} },
        ],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "set-a" },
          { id: "e2", source: "set-a", sourceHandle: "always", target: "set-b" },
          { id: "e3", source: "set-b", sourceHandle: "always", target: "end" },
        ],
      }
      const response = await runPublish(draftGraph, [
        { id: VAR_A, type: "NUMERIC", name: "Variável A" },
        { id: VAR_B, type: "NUMERIC", name: "Variável B" },
      ])
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_VARIABLE_CYCLE")
    })

    it("rejeita uma variável referenciando a si mesma", async () => {
      const response = await runPublish(setVariableGraph({ actionType: "SET_VARIABLE", variableId: VAR_1, sourcePath: `variables.${VAR_1}` }), [
        { id: VAR_1, type: "NUMERIC", name: "Pontuação de risco" },
      ])
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_VARIABLE_CYCLE")
    })

    it("rejeita quando a variável referenciada no SET_VARIABLE não existe mais", async () => {
      const response = await runPublish(setVariableGraph({ actionType: "SET_VARIABLE", variableId: VAR_GONE, value: 1 }), [])
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_ACTION")
    })
  })

  describe("Escalonar — Target + Conteúdo + Surface compartilhados (evolução do Escalonamento)", () => {
    const ORCHESTRATOR_ID = "22222222-2222-4222-8222-222222222222"
    const ORCH_SCHEMA = [{ key: "diagnosis", label: "Diagnóstico", fields: [{ key: "cause", label: "Causa", type: "STRING" }, { key: "tags", label: "Tags", type: "ARRAY" }] }]

    async function runEscalatePublish(draftGraph: unknown, orchestratorSchema: unknown = ORCH_SCHEMA) {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabase([], passwordHash, (sql) => {
        if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
          return { rows: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }], rowCount: 1 }
        }
        if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
        if (sql.includes("from workflow_variables where workflow_id")) return { rows: [], rowCount: 0 }
        if (sql.includes("from assistant_orchestrators where id = any")) {
          return { rows: [{ id: ORCHESTRATOR_ID, output_schema: orchestratorSchema, scopeType: "ALL_TEAMS", teamId: null, subteamId: null, name: "Orquestrador" }], rowCount: 1 }
        }
        if (sql.includes("from agents where id = any")) return { rows: [{ id: "11111111-1111-4111-8111-111111111111", name: "Agente", active: true, agent_type: "CALL_FEEDBACK" }], rowCount: 1 }
        if (sql.trim().startsWith("insert into workflow_versions")) return { rows: [{ id: "version-1" }], rowCount: 1 }
        return undefined
      })
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      return agent.post("/api/v1/admin/workflows/wf-1/publish")
    }

    it("publica com target ROLE_OF_OPERATOR e Surface simples", async () => {
      const draftGraph = {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          {
            id: "escalate",
            type: "action",
            label: "Escalonar",
            position: { x: 0, y: 160 },
            config: { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, surfaces: ["NOTIFICATION"] },
          },
          { id: "end", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
        ],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "escalate" },
          { id: "e2", source: "escalate", sourceHandle: "always", target: "end" },
        ],
      }
      const response = await runEscalatePublish(draftGraph)
      expect(response.status).toBe(200)
    })

    it("publica com continuation END_BRANCH e nenhuma edge de saída (mesma validação de grafo de sempre não exige 'always' aqui)", async () => {
      const draftGraph = {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          {
            id: "escalate",
            type: "action",
            label: "Escalonar",
            position: { x: 0, y: 160 },
            config: { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, surfaces: ["INBOX"], continuation: "END_BRANCH" },
          },
          { id: "end", type: "end", label: "Fim", position: { x: 400, y: 0 }, config: {} },
        ],
        edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "escalate" }],
      }
      const response = await runEscalatePublish(draftGraph)
      expect(response.status).toBe(200)
    })

    it("rejeita target ROLE_OF_PREVIOUS_REVIEWER apontando pra uma revisão que não é ancestral (mesma validação já usada pelo Human Review, reaproveitada)", async () => {
      const draftGraph = {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          {
            id: "review",
            type: "human_review",
            label: "Revisão",
            position: { x: 200, y: 0 },
            config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } },
          },
          {
            id: "escalate",
            type: "action",
            label: "Escalonar",
            position: { x: 0, y: 160 },
            // "escalate" referencia "review", mas está desconectado dele no grafo — não é ancestral.
            config: { actionType: "ESCALATE", target: { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: "review" }, surfaces: ["INBOX"] },
          },
          { id: "end-a", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
          { id: "end-b", type: "end", label: "Fim", position: { x: 200, y: 160 }, config: {} },
        ],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "escalate" },
          { id: "e2", source: "escalate", sourceHandle: "always", target: "end-a" },
          { id: "e3", source: "review", sourceHandle: "approved", target: "end-b" },
          { id: "e4", source: "review", sourceHandle: "rejected", target: "end-b" },
          { id: "e5", source: "review", sourceHandle: "escalated", target: "end-b" },
        ],
      }
      const response = await runEscalatePublish(draftGraph)
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_ACTION")
    })

    it("rejeita conteúdo do tipo ARRAY escalonado pra uma superfície conversacional (Avatar/Chat) — mesma guarda já usada pelo Output, reaproveitada", async () => {
      const draftGraph = {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          {
            id: "orch",
            type: "orchestrator",
            label: "Orquestrador",
            position: { x: 0, y: 160 },
            config: { orchestratorId: ORCHESTRATOR_ID, instruction: "Analise." },
          },
          {
            id: "escalate",
            type: "action",
            label: "Escalonar",
            position: { x: 0, y: 320 },
            config: {
              actionType: "ESCALATE",
              target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" },
              contentSource: "nodeOutputs.orch.structuredResult.diagnosis.tags",
              surfaces: ["CHAT"],
            },
          },
          { id: "end", type: "end", label: "Fim", position: { x: 0, y: 480 }, config: {} },
        ],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "orch" },
          { id: "e2", source: "orch", sourceHandle: "always", target: "escalate" },
          { id: "e3", source: "escalate", sourceHandle: "always", target: "end" },
        ],
      }
      const response = await runEscalatePublish(draftGraph)
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_ACTION")
    })

    it("nunca bloqueia quando a origem do conteúdo escalonado não tem schema conhecido (preserva o mesmo princípio do Output — TESTE 07)", async () => {
      const draftGraph = {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          { id: "agent", type: "action", label: "Agente", position: { x: 0, y: 160 }, config: { actionType: "CALL_AGENT", agentId: "11111111-1111-4111-8111-111111111111" } },
          {
            id: "escalate",
            type: "action",
            label: "Escalonar",
            position: { x: 0, y: 320 },
            config: { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, contentSource: "nodeOutputs.agent", surfaces: ["CHAT", "INBOX"] },
          },
          { id: "end", type: "end", label: "Fim", position: { x: 0, y: 480 }, config: {} },
        ],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "agent" },
          { id: "e2", source: "agent", sourceHandle: "always", target: "escalate" },
          { id: "e3", source: "escalate", sourceHandle: "always", target: "end" },
        ],
      }
      const response = await runEscalatePublish(draftGraph)
      expect(response.status).toBe(200)
    })
  })

  describe("Trigger por agenda — recorrências de calendário (evolução do Trigger)", () => {
    it("POST /schedule-preview devolve as próximas execuções usando a MESMA lógica do checador real", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabase([], passwordHash, (sql) => {
        if (sql.includes("from operations")) return { rows: [{ timezone: "America/Fortaleza" }], rowCount: 1 }
        return undefined
      })
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent
        .post("/api/v1/admin/workflows/schedule-preview")
        .send({ trigger: { kind: "schedule", times: ["09:00"], intervalDays: 1, frequency: { type: "WEEKLY", weekdays: ["MON"] } } })
      expect(response.status).toBe(200)
      expect(response.body.data.timezone).toBe("America/Fortaleza")
      expect(response.body.data.occurrences.length).toBe(5)
      // Toda ocorrência devolvida precisa realmente cair numa segunda-feira às 09:00 locais.
      for (const iso of response.body.data.occurrences as string[]) {
        const localHour = new Date(iso).getUTCHours() // America/Fortaleza = UTC-3, sem horário de verão
        expect(localHour).toBe(12)
      }
    })

    it("rejeita horários repetidos na criação, com mensagem amigável (nunca erro técnico de schema)", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const agent = request.agent(createApp(fakeDatabase([], passwordHash)))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.post("/api/v1/admin/workflows").send({
        name: "TESTE - Horários duplicados",
        trigger: { kind: "schedule", times: ["09:00", "09:00"], intervalDays: 1 },
      })
      expect(response.status).toBe(422)
      expect(response.body.error.message).toBe("Horários repetidos não são permitidos.")
    })

    it("rejeita Mensal por dia do mês sem o dia escolhido, com mensagem amigável", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const agent = request.agent(createApp(fakeDatabase([], passwordHash)))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.post("/api/v1/admin/workflows").send({
        name: "TESTE - Mensal sem dia",
        trigger: { kind: "schedule", times: ["09:00"], intervalDays: 1, frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH" } },
      })
      expect(response.status).toBe(422)
      expect(response.body.error.message).toBe("Escolha o dia do mês.")
    })
  })

  describe("Trigger por agenda — relativo ao expediente do colaborador (evolução do Trigger)", () => {
    it("POST /schedule-preview devolve exemplos por colaborador usando a MESMA calculadora do checador real", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabase([], passwordHash, (sql) => {
        if (sql.includes("from operations")) return { rows: [{ timezone: "America/Fortaleza" }], rowCount: 1 }
        if (sql.includes("from people") && sql.includes("role = 'OPERATOR'")) {
          return { rows: [{ id: "joao", name: "João Silva" }, { id: "maria", name: "Maria Santos" }, { id: "sem-jornada", name: "Carlos Souza" }], rowCount: 3 }
        }
        if (sql.includes("from employee_work_shifts")) {
          return {
            rows: [
              { person_id: "joao", start_time: "08:00:00", work_minutes: 480 },
              { person_id: "maria", start_time: "09:00:00", work_minutes: 480 },
            ],
            rowCount: 2,
          }
        }
        return undefined
      })
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent
        .post("/api/v1/admin/workflows/schedule-preview")
        .send({ trigger: { kind: "schedule", mode: "RELATIVE_TO_SHIFT", intervalDays: 1, relative: { anchor: "START", offsetMinutes: 15 } } })
      expect(response.status).toBe(200)
      expect(response.body.data.mode).toBe("RELATIVE_TO_SHIFT")
      expect(response.body.data.totalEligible).toBe(3)
      expect(response.body.data.withoutValidShift).toBe(1) // Carlos Souza não tem jornada
      const names = (response.body.data.examples as { name: string; iso: string }[]).map((example) => example.name)
      expect(names).toEqual(expect.arrayContaining(["João Silva", "Maria Santos"]))
    })

    it("rejeita quando nenhum momento (relative) foi escolhido", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const agent = request.agent(createApp(fakeDatabase([], passwordHash)))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.post("/api/v1/admin/workflows").send({
        name: "TESTE - Relativo sem momento",
        trigger: { kind: "schedule", mode: "RELATIVE_TO_SHIFT", intervalDays: 1 },
      })
      expect(response.status).toBe(422)
      expect(response.body.error.message).toBe("Escolha o momento do expediente.")
    })

    it("rejeita 'Após o início' sem a quantidade de minutos", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const agent = request.agent(createApp(fakeDatabase([], passwordHash)))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.post("/api/v1/admin/workflows").send({
        name: "TESTE - Após início sem minutos",
        trigger: { kind: "schedule", mode: "RELATIVE_TO_SHIFT", intervalDays: 1, relative: { anchor: "START" } },
      })
      expect(response.status).toBe(422)
      expect(response.body.error.message).toBe("Defina quantos minutos após o início.")
    })

    it("rejeita 'Percentual da jornada' sem o percentual", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const agent = request.agent(createApp(fakeDatabase([], passwordHash)))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.post("/api/v1/admin/workflows").send({
        name: "TESTE - Percentual sem valor",
        trigger: { kind: "schedule", mode: "RELATIVE_TO_SHIFT", intervalDays: 1, relative: { anchor: "PERCENTAGE" } },
      })
      expect(response.status).toBe(422)
      expect(response.body.error.message).toBe("Defina o percentual da jornada.")
    })

    it("aceita um Trigger relativo bem formado (passa da validação, chega até o insert)", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabase([], passwordHash, (sql) => {
        if (sql.trim().startsWith("insert into workflows")) return { rows: [{ id: "new-wf-id" }], rowCount: 1 }
        return undefined
      })
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.post("/api/v1/admin/workflows").send({
        name: "TESTE - Metade do expediente",
        trigger: { kind: "schedule", mode: "RELATIVE_TO_SHIFT", intervalDays: 1, relative: { anchor: "PERCENTAGE", percentage: 50 } },
      })
      expect(response.status).toBe(201)
    })
  })

  describe("Escopo Administrativo — acesso a um workflow específico por id (Parte 32/33 do pedido)", () => {
    // A suíte já cobria a listagem (linha 88 acima); GET/:id, PATCH e DELETE por id nunca tinham
    // sido testados contra um admin restrito — o mock genérico de "from workflows w" não
    // distingue qual id foi pedido, então estes testes usam sua própria fixture ciente do id.
    function fakeDatabaseById(roleAssignmentRows: unknown[], passwordHash: string) {
      return fakeDatabase(roleAssignmentRows, passwordHash, (sql, params) => {
        if (sql.includes("from workflows w") && sql.includes("w.id = $2")) {
          const id = params?.[1] as string
          const row = [WORKFLOW_ALL_TEAMS, WORKFLOW_TEAM_A, WORKFLOW_TEAM_B].find((w) => w.id === id)
          return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 }
        }
        if (sql.includes("select scope_type") && sql.includes("from workflows where id = $1")) {
          const id = params?.[0] as string
          const row = [WORKFLOW_ALL_TEAMS, WORKFLOW_TEAM_A, WORKFLOW_TEAM_B].find((w) => w.id === id)
          return row ? { rows: [{ scopeType: row.scopeType, teamId: row.teamId, subteamId: row.subteamId, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }], rowCount: 1 } : { rows: [], rowCount: 0 }
        }
        return undefined
      })
    }

    it("admin restrito ao TEAM_A lê o workflow do TEAM_A e recebe 404 (nunca 403) pro do TEAM_B", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseById([{ scope_type: "TEAM", team_id: TEAM_A, subteam_id: null }], passwordHash)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const [a, b] = await Promise.all([agent.get("/api/v1/admin/workflows/wf-2"), agent.get("/api/v1/admin/workflows/wf-3")])
      expect(a.status).toBe(200)
      expect(b.status).toBe(404)
    })

    it("mesma regra pra PATCH e DELETE — nunca revela nem permite alterar um workflow de outro grupo", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseById([{ scope_type: "TEAM", team_id: TEAM_A, subteam_id: null }], passwordHash)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const [patch, del] = await Promise.all([
        agent.patch("/api/v1/admin/workflows/wf-3").send({ name: "Tentativa" }),
        agent.delete("/api/v1/admin/workflows/wf-3"),
      ])
      expect(patch.status).toBe(404)
      expect(del.status).toBe(404)
    })

    it("admin multi-grupo (TEAM_A + TEAM_B) lê os dois, mas não o ALL_TEAMS", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseById(
        [
          { scope_type: "TEAM", team_id: TEAM_A, subteam_id: null },
          { scope_type: "TEAM", team_id: TEAM_B, subteam_id: null },
        ],
        passwordHash,
      )
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const [a, b, all] = await Promise.all([
        agent.get("/api/v1/admin/workflows/wf-2"),
        agent.get("/api/v1/admin/workflows/wf-3"),
        agent.get("/api/v1/admin/workflows/wf-1"),
      ])
      expect(a.status).toBe(200)
      expect(b.status).toBe(200)
      expect(all.status).toBe(404)
    })
  })

  describe("Escopo Administrativo — nunca vazamento cross-group entre Workflow e Orchestrator (Parte 6/24/34 do pedido)", () => {
    it("rejeita publicar um Workflow do TEAM_A que chama um Orchestrator exclusivo do TEAM_B", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const draftGraph = {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          { id: "orch", type: "orchestrator", label: "Orquestrador", position: { x: 0, y: 160 }, config: { orchestratorId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", instruction: "Analise." } },
          { id: "end", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
        ],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "orch" },
          { id: "e2", source: "orch", sourceHandle: "always", target: "end" },
        ],
      }
      const database = fakeDatabase([], passwordHash, (sql) => {
        if (sql.includes("select") && sql.includes("draftGraph") && sql.includes("from workflows where id = $1")) {
          return { rows: [{ scopeType: "TEAM", teamId: TEAM_A, subteamId: null, draftGraph, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } }], rowCount: 1 }
        }
        if (sql.includes("select value_type from channel_flags")) return { rows: [{ value_type: "NUMERIC" }], rowCount: 1 }
        if (sql.includes("from workflow_variables where workflow_id")) return { rows: [], rowCount: 0 }
        if (sql.includes("from assistant_orchestrators where id = any")) {
          return { rows: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", output_schema: null, scopeType: "TEAM", teamId: TEAM_B, subteamId: null, name: "Orquestrador RETENÇÃO" }], rowCount: 1 }
        }
        return undefined
      })
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.post("/api/v1/admin/workflows/wf-2/publish")
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_ORCHESTRATOR_SCOPE_FORBIDDEN")
    })
  })

  describe("Modo de avaliação — Estrutura Consolidada e Filtro Populacional só dentro da Abrangência do workflow", () => {
    const supervisorInScope = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    const supervisorOutOfScope = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"

    function fakeDatabaseForAnalysisConfig(
      row: { scopeType: string; teamId: string | null; triggerConfig: unknown; draftGraph?: unknown },
      extra?: (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount: number } | undefined,
    ) {
      return (passwordHash: string) =>
        fakeDatabase([], passwordHash, (sql, params) => {
          if (sql.includes("select scope_type") && sql.includes("consolidated_structure") && sql.includes("from workflows where id = $1")) {
            return {
              rows: [
                {
                  scopeType: row.scopeType,
                  teamId: row.teamId,
                  subteamId: null,
                  triggerConfig: row.triggerConfig,
                  consolidatedStructure: null,
                  populationFilter: null,
                  draftGraph: row.draftGraph ?? { nodes: [], edges: [] },
                },
              ],
              rowCount: 1,
            }
          }
          if (sql.includes("from people where id = $1 and organization_id = $2")) {
            const id = params?.[0]
            if (id === supervisorInScope) return { rows: [{ teamId: TEAM_A, subteamId: null }], rowCount: 1 }
            if (id === supervisorOutOfScope) return { rows: [{ teamId: TEAM_B, subteamId: null }], rowCount: 1 }
            return { rows: [], rowCount: 0 }
          }
          return extra?.(sql, params)
        })
    }

    const calendarWorkflow = { scopeType: "TEAM", teamId: TEAM_A, triggerConfig: { kind: "schedule", mode: "CALENDAR", intervalDays: 1 } }

    it("modo Consolidado: aceita um Supervisor dentro da Abrangência do workflow", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForAnalysisConfig(calendarWorkflow, (sql) => {
        if (sql.trim().startsWith("update workflows set consolidated_structure = $1")) return { rows: [], rowCount: 1 }
        if (sql.includes("from workflows w") && sql.includes("w.id = $2")) return { rows: [WORKFLOW_TEAM_A], rowCount: 1 }
        return undefined
      })(passwordHash)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent
        .put("/api/v1/admin/workflows/wf-2/analysis-config")
        .send({ mode: "CONSOLIDATED", consolidatedStructure: { kind: "SUPERVISOR_TEAM", supervisorId: supervisorInScope } })
      expect(response.status).toBe(200)
    })

    it("modo Consolidado: rejeita um Supervisor de outro grupo (fora da Abrangência) — nunca aceita silenciosamente", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForAnalysisConfig(calendarWorkflow)(passwordHash)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent
        .put("/api/v1/admin/workflows/wf-2/analysis-config")
        .send({ mode: "CONSOLIDATED", consolidatedStructure: { kind: "SUPERVISOR_TEAM", supervisorId: supervisorOutOfScope } })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_CONSOLIDATED_STRUCTURE_OUT_OF_SCOPE")
    })

    it("modo Consolidado: aceita qualquer Supervisor quando a Abrangência do workflow é Todos os grupos", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabase([], passwordHash, (sql, params) => {
        if (sql.includes("select scope_type") && sql.includes("consolidated_structure") && sql.includes("from workflows where id = $1")) {
          return {
            rows: [
              {
                scopeType: "ALL_TEAMS",
                teamId: null,
                subteamId: null,
                triggerConfig: { kind: "schedule", mode: "CALENDAR", intervalDays: 1 },
                consolidatedStructure: null,
                populationFilter: null,
                draftGraph: { nodes: [], edges: [] },
              },
            ],
            rowCount: 1,
          }
        }
        if (sql.includes("from people where id = $1 and organization_id = $2")) {
          const id = params?.[0]
          if (id === supervisorOutOfScope) return { rows: [{ teamId: TEAM_B, subteamId: null }], rowCount: 1 }
          return { rows: [], rowCount: 0 }
        }
        if (sql.trim().startsWith("update workflows set consolidated_structure = $1")) return { rows: [], rowCount: 1 }
        if (sql.includes("from workflows w") && sql.includes("w.id = $2")) return { rows: [{ ...WORKFLOW_TEAM_A, scopeType: "ALL_TEAMS", teamId: null }], rowCount: 1 }
        return undefined
      })
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent
        .put("/api/v1/admin/workflows/wf-2/analysis-config")
        .send({ mode: "CONSOLIDATED", consolidatedStructure: { kind: "SUPERVISOR_TEAM", supervisorId: supervisorOutOfScope } })
      expect(response.status).toBe(200)
    })

    it("modo Consolidado: rejeita trocar quando o rascunho tem uma Condition de Performance do colaborador (individual-only)", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const draftGraph = {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          {
            id: "condition",
            type: "condition",
            label: "PRV do colaborador",
            position: { x: 0, y: 1 },
            config: { comparator: "LT", thresholdNumeric: 80, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_ACHIEVEMENT" } },
          },
          { id: "end", type: "end", label: "Fim", position: { x: 0, y: 2 }, config: {} },
        ],
        edges: [],
      }
      const database = fakeDatabaseForAnalysisConfig({ ...calendarWorkflow, draftGraph })(passwordHash)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent
        .put("/api/v1/admin/workflows/wf-2/analysis-config")
        .send({ mode: "CONSOLIDATED", consolidatedStructure: { kind: "SUPERVISOR_TEAM", supervisorId: supervisorInScope } })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_PERFORMANCE_QUERY_INVALID_MODE")
    })

    it('modo Consolidado: rejeita trocar quando o rascunho tem um Output "O próprio operador" (individual-only)', async () => {
      const passwordHash = await hashPassword("Inia@123")
      const draftGraph = {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          {
            id: "output",
            type: "output",
            label: "Notificar",
            position: { x: 0, y: 1 },
            config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["INBOX"], source: "nodeOutputs.agent-1.summary" },
          },
          { id: "end", type: "end", label: "Fim", position: { x: 0, y: 2 }, config: {} },
        ],
        edges: [],
      }
      const database = fakeDatabaseForAnalysisConfig({ ...calendarWorkflow, draftGraph })(passwordHash)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent
        .put("/api/v1/admin/workflows/wf-2/analysis-config")
        .send({ mode: "CONSOLIDATED", consolidatedStructure: { kind: "SUPERVISOR_TEAM", supervisorId: supervisorInScope } })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_OUTPUT_TARGET_INVALID_MODE")
    })

    it("modo Consolidado: rejeita quando o gatilho não é Agenda de calendário", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForAnalysisConfig({ scopeType: "TEAM", teamId: TEAM_A, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } })(passwordHash)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent
        .put("/api/v1/admin/workflows/wf-2/analysis-config")
        .send({ mode: "CONSOLIDATED", consolidatedStructure: { kind: "SUPERVISOR_TEAM", supervisorId: supervisorInScope } })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_CONSOLIDATED_MODE_INVALID_TRIGGER")
    })

    it("modo Consolidado: rejeita Agenda relativa ao expediente, com mensagem específica — nunca é uma escolha real", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForAnalysisConfig({ scopeType: "TEAM", teamId: TEAM_A, triggerConfig: { kind: "schedule", mode: "RELATIVE_TO_SHIFT", intervalDays: 1 } })(passwordHash)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent
        .put("/api/v1/admin/workflows/wf-2/analysis-config")
        .send({ mode: "CONSOLIDATED", consolidatedStructure: { kind: "SUPERVISOR_TEAM", supervisorId: supervisorInScope } })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_CONSOLIDATED_MODE_INVALID_TRIGGER")
      expect(response.body.error.message).toContain("sempre executados individualmente")
    })

    it("modo Individual: aceita um Filtro Populacional (Equipe de Supervisor) dentro da Abrangência", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForAnalysisConfig(calendarWorkflow, (sql) => {
        if (sql.trim().startsWith("update workflows set consolidated_structure = null")) return { rows: [], rowCount: 1 }
        if (sql.includes("from workflows w") && sql.includes("w.id = $2")) return { rows: [WORKFLOW_TEAM_A], rowCount: 1 }
        return undefined
      })(passwordHash)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent
        .put("/api/v1/admin/workflows/wf-2/analysis-config")
        .send({ mode: "INDIVIDUAL", populationFilter: { kind: "SUPERVISOR_TEAM", supervisorId: supervisorInScope } })
      expect(response.status).toBe(200)
    })

    it("modo Individual: rejeita um Filtro Populacional fora da Abrangência", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForAnalysisConfig(calendarWorkflow)(passwordHash)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent
        .put("/api/v1/admin/workflows/wf-2/analysis-config")
        .send({ mode: "INDIVIDUAL", populationFilter: { kind: "SUPERVISOR_TEAM", supervisorId: supervisorOutOfScope } })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_POPULATION_FILTER_OUT_OF_SCOPE")
    })

    it("modo Individual: aceita ausência de Filtro Populacional (todos elegíveis) sem consultar Abrangência de pessoa nenhuma", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForAnalysisConfig(calendarWorkflow, (sql) => {
        if (sql.trim().startsWith("update workflows set consolidated_structure = null")) return { rows: [], rowCount: 1 }
        if (sql.includes("from workflows w") && sql.includes("w.id = $2")) return { rows: [WORKFLOW_TEAM_A], rowCount: 1 }
        return undefined
      })(passwordHash)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.put("/api/v1/admin/workflows/wf-2/analysis-config").send({ mode: "INDIVIDUAL", populationFilter: null })
      expect(response.status).toBe(200)
    })

    it("modo Individual: rejeita Filtro Populacional quando o gatilho é Flag/Indicador — não existe filtro pra esses casos", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForAnalysisConfig({ scopeType: "TEAM", teamId: TEAM_A, triggerConfig: { kind: "channel_flag", channelFlagId: "flag-1" } })(passwordHash)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent
        .put("/api/v1/admin/workflows/wf-2/analysis-config")
        .send({ mode: "INDIVIDUAL", populationFilter: { kind: "SUPERVISOR_TEAM", supervisorId: supervisorInScope } })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_POPULATION_FILTER_INVALID_TRIGGER")
    })
  })

  describe("PATCH /:id — trocar o Trigger não pode deixar Estrutura Consolidada/Filtro Populacional numa combinação inválida", () => {
    const anchorPerson = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    const flagId = "ffffffff-ffff-4fff-8fff-ffffffffffff"

    const updates: string[] = []

    function fakeDatabaseForTriggerConflict(current: { consolidatedStructure?: unknown; populationFilter?: unknown }) {
      return (passwordHash: string) =>
        fakeDatabase([], passwordHash, (sql) => {
          if (sql.includes("select scope_type") && sql.includes("consolidated_structure") && sql.includes("from workflows where id = $1")) {
            return {
              rows: [
                {
                  scopeType: "TEAM",
                  teamId: TEAM_A,
                  subteamId: null,
                  triggerConfig: { kind: "schedule", mode: "CALENDAR", intervalDays: 1 },
                  consolidatedStructure: current.consolidatedStructure ?? null,
                  populationFilter: current.populationFilter ?? null,
                  draftGraph: { nodes: [], edges: [] },
                },
              ],
              rowCount: 1,
            }
          }
          if (sql.includes("select id from channel_flags where id = $1")) return { rows: [{ id: flagId }], rowCount: 1 }
          if (sql.includes("update workflows set")) {
            updates.push(sql)
            return { rows: [{ id: "wf-2" }], rowCount: 1 }
          }
          if (sql.includes("from workflows w") && sql.includes("w.id = $2")) return { rows: [WORKFLOW_TEAM_A], rowCount: 1 }
          return undefined
        })
    }

    it("rejeita trocar pra Flag de canal quando o workflow já tem Estrutura Consolidada configurada", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForTriggerConflict({ consolidatedStructure: { kind: "SUPERVISOR_TEAM", supervisorId: anchorPerson } })(passwordHash)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.patch("/api/v1/admin/workflows/wf-2").send({ trigger: { kind: "channel_flag", channelFlagId: flagId } })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_TRIGGER_CONSOLIDATED_MODE_CONFLICT")
    })

    it("rejeita trocar pra Agenda relativa ao expediente quando o workflow já tem Estrutura Consolidada configurada, com mensagem específica", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForTriggerConflict({ consolidatedStructure: { kind: "SUPERVISOR_TEAM", supervisorId: anchorPerson } })(passwordHash)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent
        .patch("/api/v1/admin/workflows/wf-2")
        .send({ trigger: { kind: "schedule", mode: "RELATIVE_TO_SHIFT", intervalDays: 1, relative: { anchor: "PERCENTAGE", percentage: 50 } } })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_TRIGGER_CONSOLIDATED_MODE_CONFLICT")
      expect(response.body.error.message).toContain("sempre executados individualmente")
    })

    it("rejeita trocar pra Flag de canal quando o workflow já tem Filtro Populacional configurado", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForTriggerConflict({ populationFilter: { kind: "SUPERVISOR_TEAM", supervisorId: anchorPerson } })(passwordHash)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.patch("/api/v1/admin/workflows/wf-2").send({ trigger: { kind: "channel_flag", channelFlagId: flagId } })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_TRIGGER_POPULATION_FILTER_CONFLICT")
    })

    it("aceita trocar o gatilho quando nenhuma Estrutura Consolidada nem Filtro Populacional estão configurados", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForTriggerConflict({})(passwordHash)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      updates.length = 0
      const response = await agent.patch("/api/v1/admin/workflows/wf-2").send({ trigger: { kind: "channel_flag", channelFlagId: flagId } })
      expect(response.status).toBe(200)
      // O gatilho vai para o RASCUNHO; a coluna que o runtime lê só muda quando não há versão publicada.
      const triggerWrite = updates.find((sql) => sql.includes("draft_trigger_config = case"))!
      expect(triggerWrite).toContain("trigger_config = case when active_version_id is null and $1::boolean then $2::jsonb else trigger_config end")
    })
  })

  describe("Publish — Performance do colaborador é inválida quando o workflow está em modo Consolidado", () => {
    it("rejeita publicar um grafo com Condition de performanceQuery quando consolidated_structure está configurado", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const graph = {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          {
            id: "condition",
            type: "condition",
            label: "PRV do colaborador",
            position: { x: 0, y: 1 },
            config: { comparator: "LT", thresholdNumeric: 80, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_ACHIEVEMENT" } },
          },
          { id: "end", type: "end", label: "Fim", position: { x: 0, y: 2 }, config: {} },
        ],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
          { id: "e2", source: "condition", sourceHandle: "true", target: "end" },
          { id: "e3", source: "condition", sourceHandle: "false", target: "end" },
        ],
      }
      const database = fakeDatabase([], passwordHash, (sql) => {
        if (sql.includes("draft_graph") && sql.includes("from workflows where id = $1 and organization_id = $2")) {
          return {
            rows: [
              {
                scopeType: "TEAM",
                teamId: TEAM_A,
                subteamId: null,
                draftGraph: graph,
                triggerConfig: { kind: "schedule", mode: "CALENDAR", intervalDays: 1 },
                consolidatedStructure: { kind: "SUPERVISOR_TEAM", supervisorId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
              },
            ],
            rowCount: 1,
          }
        }
        return undefined
      })
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.post("/api/v1/admin/workflows/wf-2/publish")
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_PERFORMANCE_QUERY_INVALID_MODE")
    })

    it('rejeita publicar um grafo com Output "O próprio operador" quando consolidated_structure está configurado', async () => {
      const passwordHash = await hashPassword("Inia@123")
      const graph = {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          {
            id: "output",
            type: "output",
            label: "Notificar",
            position: { x: 0, y: 1 },
            config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["INBOX"], source: "nodeOutputs.agent-1.summary" },
          },
          { id: "end", type: "end", label: "Fim", position: { x: 0, y: 2 }, config: {} },
        ],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "output" },
          { id: "e2", source: "output", sourceHandle: "always", target: "end" },
        ],
      }
      const database = fakeDatabase([], passwordHash, (sql) => {
        if (sql.includes("draft_graph") && sql.includes("from workflows where id = $1 and organization_id = $2")) {
          return {
            rows: [
              {
                scopeType: "TEAM",
                teamId: TEAM_A,
                subteamId: null,
                draftGraph: graph,
                triggerConfig: { kind: "schedule", mode: "CALENDAR", intervalDays: 1 },
                consolidatedStructure: { kind: "SUPERVISOR_TEAM", supervisorId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
              },
            ],
            rowCount: 1,
          }
        }
        return undefined
      })
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.post("/api/v1/admin/workflows/wf-2/publish")
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_OUTPUT_TARGET_INVALID_MODE")
    })
  })

  describe("Publish — Selecionar colaboradores / Aplicar individualmente (EMPLOYEE_COLLECTION)", () => {
    const SELECTION_CRITERION = {
      comparator: "GTE",
      thresholdNumeric: 80,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "QUALIDADE", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 } },
    }

    function fakeDatabaseForCollectionPublish(passwordHash: string, graph: unknown, consolidatedStructure: unknown) {
      return fakeDatabase([], passwordHash, (sql) => {
        if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
          return {
            rows: [{ scopeType: "TEAM", teamId: TEAM_A, subteamId: null, draftGraph: graph, triggerConfig: { kind: "schedule", mode: "CALENDAR", intervalDays: 1 }, consolidatedStructure }],
            rowCount: 1,
          }
        }
        if (sql.includes("from assistant_orchestrators where id = any")) {
          return { rows: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", output_schema: null, scopeType: "ALL_TEAMS", teamId: null, subteamId: null, name: "Resumo", active: true, invocation_mode: "WORKFLOW" }], rowCount: 1 }
        }
        if (sql.trim().startsWith("insert into workflow_versions")) return { rows: [{ id: "version-1" }], rowCount: 1 }
        return undefined
      })
    }

    it("publica um grafo válido: STRUCTURE -> Selecionar colaboradores -> Aplicar individualmente -> Revisão humana", async () => {
      const graph = {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          { id: "select", type: "select_employees", label: "Selecionar Q4", position: { x: 0, y: 1 }, config: { criterion: SELECTION_CRITERION } },
          { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position: { x: 0, y: 2 }, config: {} },
          { id: "review", type: "human_review", label: "Revisão", position: { x: 0, y: 3 }, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } } },
          { id: "end-a", type: "end", label: "Fim", position: { x: 0, y: 4 }, config: {} },
          { id: "end-b", type: "end", label: "Fim", position: { x: 200, y: 4 }, config: {} },
          { id: "end-c", type: "end", label: "Fim", position: { x: 400, y: 4 }, config: {} },
        ],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
          { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
          { id: "e3", source: "apply", sourceHandle: "always", target: "review" },
          { id: "e4", source: "review", sourceHandle: "approved", target: "end-a" },
          { id: "e5", source: "review", sourceHandle: "rejected", target: "end-b" },
          { id: "e6", source: "review", sourceHandle: "escalated", target: "end-c" },
        ],
      }
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForCollectionPublish(passwordHash, graph, { kind: "SUPERVISOR_TEAM", supervisorId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" })
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.post("/api/v1/admin/workflows/wf-2/publish")
      expect(response.status).toBe(200)
    })

    it("rejeita STRUCTURE -> Selecionar colaboradores -> Revisão humana (sem 'Aplicar individualmente' antes)", async () => {
      const graph = {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          { id: "select", type: "select_employees", label: "Selecionar Q4", position: { x: 0, y: 1 }, config: { criterion: SELECTION_CRITERION } },
          { id: "review", type: "human_review", label: "Revisão", position: { x: 0, y: 2 }, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } } },
          { id: "end-a", type: "end", label: "Fim", position: { x: 0, y: 3 }, config: {} },
          { id: "end-b", type: "end", label: "Fim", position: { x: 200, y: 3 }, config: {} },
          { id: "end-c", type: "end", label: "Fim", position: { x: 400, y: 3 }, config: {} },
        ],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
          { id: "e2", source: "select", sourceHandle: "always", target: "review" },
          { id: "e3", source: "review", sourceHandle: "approved", target: "end-a" },
          { id: "e4", source: "review", sourceHandle: "rejected", target: "end-b" },
          { id: "e5", source: "review", sourceHandle: "escalated", target: "end-c" },
        ],
      }
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForCollectionPublish(passwordHash, graph, { kind: "SUPERVISOR_TEAM", supervisorId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" })
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.post("/api/v1/admin/workflows/wf-2/publish")
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_HUMAN_REVIEW_INVALID_MODE")
    })

    it("rejeita STRUCTURE -> Aplicar individualmente direto (sem 'Selecionar colaboradores' antes)", async () => {
      const graph = {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position: { x: 0, y: 1 }, config: {} },
          { id: "end", type: "end", label: "Fim", position: { x: 0, y: 2 }, config: {} },
        ],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "apply" },
          { id: "e2", source: "apply", sourceHandle: "always", target: "end" },
        ],
      }
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForCollectionPublish(passwordHash, graph, { kind: "SUPERVISOR_TEAM", supervisorId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" })
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.post("/api/v1/admin/workflows/wf-2/publish")
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_APPLY_INDIVIDUALLY_INVALID_MODE")
    })

    it("rejeita 'Selecionar colaboradores' sem critério configurado", async () => {
      const graph = {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          { id: "select", type: "select_employees", label: "Selecionar", position: { x: 0, y: 1 }, config: {} },
          { id: "end", type: "end", label: "Fim", position: { x: 0, y: 2 }, config: {} },
        ],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
          { id: "e2", source: "select", sourceHandle: "always", target: "end" },
        ],
      }
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForCollectionPublish(passwordHash, graph, { kind: "SUPERVISOR_TEAM", supervisorId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" })
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.post("/api/v1/admin/workflows/wf-2/publish")
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_SELECT_EMPLOYEES_MISSING_CRITERION")
    })

    it("rejeita 'Selecionar colaboradores'/'Aplicar individualmente' num Workflow que NÃO está em modo Consolidado (consolidated_structure nulo)", async () => {
      const graph = {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          { id: "select", type: "select_employees", label: "Selecionar", position: { x: 0, y: 1 }, config: { criterion: SELECTION_CRITERION } },
          { id: "end", type: "end", label: "Fim", position: { x: 0, y: 2 }, config: {} },
        ],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
          { id: "e2", source: "select", sourceHandle: "always", target: "end" },
        ],
      }
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForCollectionPublish(passwordHash, graph, null)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.post("/api/v1/admin/workflows/wf-2/publish")
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_EMPLOYEE_COLLECTION_INVALID_MODE")
    })
  })

  describe("Publish — Consolidar resultados (fan-in/JOIN)", () => {
    function fakeDatabaseForJoinPublish(passwordHash: string, graph: unknown, consolidatedStructure: unknown) {
      return fakeDatabase([], passwordHash, (sql) => {
        if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
          return {
            rows: [{ scopeType: "TEAM", teamId: TEAM_A, subteamId: null, draftGraph: graph, triggerConfig: { kind: "schedule", mode: "CALENDAR", intervalDays: 1 }, consolidatedStructure }],
            rowCount: 1,
          }
        }
        if (sql.includes("from assistant_orchestrators where id = any")) {
          return { rows: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", output_schema: null, scopeType: "ALL_TEAMS", teamId: null, subteamId: null, name: "Resumo", active: true, invocation_mode: "WORKFLOW" }], rowCount: 1 }
        }
        if (sql.trim().startsWith("insert into workflow_versions")) return { rows: [{ id: "version-1" }], rowCount: 1 }
        return undefined
      })
    }

    async function publishWith(graph: unknown) {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForJoinPublish(passwordHash, graph, { kind: "SUPERVISOR_TEAM", supervisorId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" })
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      return agent.post("/api/v1/admin/workflows/wf-2/publish")
    }

    const trigger = { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} }
    const select = { id: "select", type: "select_employees", label: "Selecionar Q4", position: { x: 0, y: 1 }, config: { criterion: { comparator: "EQUALS", thresholdText: "Q4", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "NOTA_URA" } } } }
    const apply = { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position: { x: 0, y: 2 }, config: {} }
    const join = { id: "join", type: "consolidate_results", label: "Consolidar resultados", position: { x: 0, y: 3 }, config: {} }
    const orchestrator = { id: "orchestrator", type: "orchestrator", label: "Resumo executivo", position: { x: 0, y: 4 }, config: { orchestratorId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", instruction: "Resuma os diagnósticos." } }
    const end = { id: "end", type: "end", label: "Fim", position: { x: 0, y: 5 }, config: {} }

    it("publica um fan-out completo: Apply -> Join -> Orchestrator -> Fim", async () => {
      const graph = {
        nodes: [trigger, select, apply, join, orchestrator, end],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
          { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
          { id: "e3", source: "apply", sourceHandle: "always", target: "join" },
          { id: "e4", source: "join", sourceHandle: "always", target: "orchestrator" },
          { id: "e5", source: "orchestrator", sourceHandle: "always", target: "end" },
        ],
      }
      const response = await publishWith(graph)
      expect(response.status).toBe(200)
    })

    it("rejeita Join sem 'Aplicar individualmente' de origem — pego primeiro pela checagem de contexto (EMPLOYEE só existe depois de um Apply, então 'sem origem' aqui já significa contexto errado; WORKFLOW_CONSOLIDATE_RESULTS_MISSING_ORIGIN em si só é alcançável em runtime, coberto em node-handlers.test.ts)", async () => {
      const graph = {
        nodes: [trigger, join, end],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "join" },
          { id: "e2", source: "join", sourceHandle: "always", target: "end" },
        ],
      }
      const response = await publishWith(graph)
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_CONSOLIDATE_RESULTS_INVALID_MODE")
    })

    it("rejeita Join alcançado por DOIS 'Aplicar individualmente' diferentes (WORKFLOW_CONSOLIDATE_RESULTS_AMBIGUOUS_ORIGIN)", async () => {
      const applyB = { id: "apply-b", type: "apply_individually", label: "Aplicar B", position: { x: 200, y: 2 }, config: {} }
      const selectB = { id: "select-b", type: "select_employees", label: "Selecionar B", position: { x: 200, y: 1 }, config: select.config }
      const branch = { id: "branch", type: "condition", label: "Ramo", position: { x: 100, y: 0 }, config: { comparator: "EQUALS", thresholdBoolean: true } }
      const graph = {
        nodes: [trigger, branch, select, apply, selectB, applyB, join, end],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "branch" },
          { id: "e2", source: "branch", sourceHandle: "true", target: "select" },
          { id: "e3", source: "select", sourceHandle: "always", target: "apply" },
          { id: "e4", source: "apply", sourceHandle: "always", target: "join" },
          { id: "e5", source: "branch", sourceHandle: "false", target: "select-b" },
          { id: "e6", source: "select-b", sourceHandle: "always", target: "apply-b" },
          { id: "e7", source: "apply-b", sourceHandle: "always", target: "join" },
          { id: "e8", source: "join", sourceHandle: "always", target: "end" },
        ],
      }
      const response = await publishWith(graph)
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_CONSOLIDATE_RESULTS_AMBIGUOUS_ORIGIN")
    })

    it("rejeita um 'Aplicar individualmente' que alcança DOIS Joins diferentes (WORKFLOW_APPLY_INDIVIDUALLY_MULTIPLE_JOINS)", async () => {
      const review = { id: "review", type: "human_review", label: "Revisão", position: { x: 0, y: 3 }, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } } }
      const joinB = { id: "join-b", type: "consolidate_results", label: "Consolidar B", position: { x: 200, y: 4 }, config: {} }
      const graph = {
        nodes: [trigger, select, apply, review, join, joinB, end],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
          { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
          { id: "e3", source: "apply", sourceHandle: "always", target: "review" },
          { id: "e4", source: "review", sourceHandle: "approved", target: "join" },
          { id: "e5", source: "review", sourceHandle: "rejected", target: "join-b" },
          { id: "e6", source: "review", sourceHandle: "escalated", target: "join" },
          { id: "e7", source: "join", sourceHandle: "always", target: "end" },
          { id: "e8", source: "join-b", sourceHandle: "always", target: "end" },
        ],
      }
      const response = await publishWith(graph)
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_APPLY_INDIVIDUALLY_MULTIPLE_JOINS")
    })

    it("rejeita um caminho que ESCAPA do fan-out sem passar pelo Join (WORKFLOW_FAN_OUT_PATH_ESCAPES_JOIN)", async () => {
      const branch = { id: "branch", type: "condition", label: "Ramo", position: { x: 0, y: 3 }, config: { comparator: "EQUALS", thresholdBoolean: true } }
      const escapedEnd = { id: "escaped-end", type: "end", label: "Fim (escapou)", position: { x: 200, y: 4 }, config: {} }
      const graph = {
        nodes: [trigger, select, apply, branch, join, end, escapedEnd],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
          { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
          { id: "e3", source: "apply", sourceHandle: "always", target: "branch" },
          { id: "e4", source: "branch", sourceHandle: "true", target: "join" },
          { id: "e5", source: "branch", sourceHandle: "false", target: "escaped-end" },
          { id: "e6", source: "join", sourceHandle: "always", target: "end" },
        ],
      }
      const response = await publishWith(graph)
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_FAN_OUT_PATH_ESCAPES_JOIN")
    })

    it("aceita convergência com branch: Condition TRUE e FALSE, ambos levando ao MESMO Join", async () => {
      // Trigger é Agenda (schedule) — um Condition "legado" (valor bruto do gatilho) não é válido
      // nesse modo (WORKFLOW_INVALID_CONDITION, sem relação com fan-in/JOIN); usa historicalQuery,
      // mesmo shape já válido usado no resto deste arquivo.
      const branch = {
        id: "branch",
        type: "condition",
        label: "Ramo",
        position: { x: 0, y: 3 },
        config: { comparator: "GTE", thresholdNumeric: 80, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "QUALIDADE", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 } } },
      }
      const setVar = { id: "set-var", type: "action", label: "Marcar", position: { x: 200, y: 4 }, config: { actionType: "SET_CONFIG_VALUE", configKey: "flag_teste", valueType: "BOOLEAN", value: true } }
      const graph = {
        nodes: [trigger, select, apply, branch, setVar, join, end],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
          { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
          { id: "e3", source: "apply", sourceHandle: "always", target: "branch" },
          { id: "e4", source: "branch", sourceHandle: "true", target: "join" },
          { id: "e5", source: "branch", sourceHandle: "false", target: "set-var" },
          { id: "e6", source: "set-var", sourceHandle: "always", target: "join" },
          { id: "e7", source: "join", sourceHandle: "always", target: "end" },
          // Condição histórica tem a saída "Sem dados": desligada, a execução morreria sem dados (todas as saídas convergem no Join).
          { id: "e8", source: "branch", sourceHandle: "no_data", target: "join" },
        ],
      }
      const response = await publishWith(graph)
      expect(response.status).toBe(200)
    })

    it("Orchestrator é liberado logo após o Join (CONSOLIDATED_RESULT), mas Revisão humana continua exigindo EMPLOYEE mesmo pós-JOIN", async () => {
      const review = { id: "review", type: "human_review", label: "Revisão", position: { x: 0, y: 4 }, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } } }
      const graph = {
        nodes: [trigger, select, apply, join, review, end],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
          { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
          { id: "e3", source: "apply", sourceHandle: "always", target: "join" },
          { id: "e4", source: "join", sourceHandle: "always", target: "review" },
          { id: "e5", source: "review", sourceHandle: "approved", target: "end" },
          { id: "e6", source: "review", sourceHandle: "rejected", target: "end" },
          { id: "e7", source: "review", sourceHandle: "escalated", target: "end" },
        ],
      }
      const response = await publishWith(graph)
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_HUMAN_REVIEW_INVALID_MODE")
    })

    it("rejeita Join sem 'Aplicar individualmente' entre ele e o Select (contexto de entrada EMPLOYEE_COLLECTION, não EMPLOYEE)", async () => {
      const graph = {
        nodes: [trigger, select, join, end],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
          { id: "e2", source: "select", sourceHandle: "always", target: "join" },
          { id: "e3", source: "join", sourceHandle: "always", target: "end" },
        ],
      }
      const response = await publishWith(graph)
      expect(response.status).toBe(422)
      expect(["WORKFLOW_CONSOLIDATE_RESULTS_INVALID_MODE", "WORKFLOW_CONSOLIDATE_RESULTS_MISSING_ORIGIN"]).toContain(response.body.error.code)
    })

    it("fan-out sequencial válido: Apply A -> Join A -> Select B -> Apply B -> Join B, cada Join pareado ao seu próprio Apply", async () => {
      const selectB = { id: "select-b", type: "select_employees", label: "Selecionar B", position: { x: 0, y: 6 }, config: select.config }
      const applyB = { id: "apply-b", type: "apply_individually", label: "Aplicar B", position: { x: 0, y: 7 }, config: {} }
      const joinB = { id: "join-b", type: "consolidate_results", label: "Consolidar B", position: { x: 0, y: 8 }, config: {} }
      const graph = {
        nodes: [trigger, select, apply, join, selectB, applyB, joinB, end],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
          { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
          { id: "e3", source: "apply", sourceHandle: "always", target: "join" },
          { id: "e4", source: "join", sourceHandle: "always", target: "select-b" },
          { id: "e5", source: "select-b", sourceHandle: "always", target: "apply-b" },
          { id: "e6", source: "apply-b", sourceHandle: "always", target: "join-b" },
          { id: "e7", source: "join-b", sourceHandle: "always", target: "end" },
        ],
      }
      const response = await publishWith(graph)
      expect(response.status).toBe(200)
    })

    it("regressão: 'Aplicar individualmente' sem Join continua publicando normalmente (JOIN é opcional)", async () => {
      const review = { id: "review", type: "human_review", label: "Revisão", position: { x: 0, y: 3 }, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } } }
      const graph = {
        nodes: [trigger, select, apply, review, end],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
          { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
          { id: "e3", source: "apply", sourceHandle: "always", target: "review" },
          { id: "e4", source: "review", sourceHandle: "approved", target: "end" },
          { id: "e5", source: "review", sourceHandle: "rejected", target: "end" },
          { id: "e6", source: "review", sourceHandle: "escalated", target: "end" },
        ],
      }
      const response = await publishWith(graph)
      expect(response.status).toBe(200)
    })
  })

  describe("Publish — 'Selecionar colaboradores': criterion validado pela MESMA regra de negócio de uma Condition (hardening)", () => {
    const CONSOLIDATED_STRUCTURE = { kind: "SUPERVISOR_TEAM", supervisorId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }

    function fakeDatabaseForCollectionPublish(passwordHash: string, graph: unknown, consolidatedStructure: unknown) {
      return fakeDatabase([], passwordHash, (sql) => {
        if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
          return {
            rows: [{ scopeType: "TEAM", teamId: TEAM_A, subteamId: null, draftGraph: graph, triggerConfig: { kind: "schedule", mode: "CALENDAR", intervalDays: 1 }, consolidatedStructure }],
            rowCount: 1,
          }
        }
        if (sql.includes("from assistant_orchestrators where id = any")) {
          return { rows: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", output_schema: null, scopeType: "ALL_TEAMS", teamId: null, subteamId: null, name: "Resumo", active: true, invocation_mode: "WORKFLOW" }], rowCount: 1 }
        }
        if (sql.trim().startsWith("insert into workflow_versions")) return { rows: [{ id: "version-1" }], rowCount: 1 }
        return undefined
      })
    }

    function graphWithCriterion(criterion: object) {
      return {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          { id: "select", type: "select_employees", label: "Selecionar colaboradores", position: { x: 0, y: 1 }, config: { criterion } },
          { id: "end", type: "end", label: "Fim", position: { x: 0, y: 2 }, config: {} },
        ],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
          { id: "e2", source: "select", sourceHandle: "always", target: "end" },
        ],
      }
    }

    async function publishWith(criterion: object) {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForCollectionPublish(passwordHash, graphWithCriterion(criterion), CONSOLIDATED_STRUCTURE)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      return agent.post("/api/v1/admin/workflows/wf-2/publish")
    }

    it("rejeita Atingimento do PRV (PRV_ACHIEVEMENT) + Quantidade de ocorrências (COUNT) — mesma regra da Condition, nunca uma combinação nova", async () => {
      const response = await publishWith({
        comparator: "GTE",
        thresholdNumeric: 3,
        historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", aggregation: "COUNT", source: "PRV_ACHIEVEMENT", comparator: "LT", indicatorThreshold: 3, period: { kind: "ROLLING_DAYS", days: 7 } },
      })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_SELECTION_CRITERION")
      expect(response.body.error.message).toContain("Selecionar colaboradores")
    })

    it("rejeita Atingimento do indicador (INDICATOR_ACHIEVEMENT) + Meta vigente (compareTo GOAL) — Atingimento já representa a relação com a meta", async () => {
      const response = await publishWith({
        comparator: "LT",
        thresholdNumeric: null,
        historicalQuery: {
          kind: "INDICATOR_THRESHOLD_COUNT",
          indicatorCode: "QUALIDADE",
          aggregation: "AVERAGE",
          source: "INDICATOR_ACHIEVEMENT",
          period: { kind: "ROLLING_DAYS", days: 30 },
          compareTo: { kind: "GOAL" },
        },
      })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_SELECTION_CRITERION")
    })

    it("rejeita Valor do indicador (MEASUREMENT, fonte ausente) sem indicatorCode", async () => {
      const response = await publishWith({
        comparator: "GTE",
        thresholdNumeric: 3,
        historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 } },
      })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_SELECTION_CRITERION")
      expect(response.body.error.message).toContain("indicador")
    })

    it("rejeita Atingimento do indicador (INDICATOR_ACHIEVEMENT) sem indicatorCode", async () => {
      const response = await publishWith({
        comparator: "LT",
        thresholdNumeric: 80,
        historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", aggregation: "AVERAGE", source: "INDICATOR_ACHIEVEMENT", period: { kind: "ROLLING_DAYS", days: 30 } },
      })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_SELECTION_CRITERION")
    })

    it("aceita Atingimento do PRV (PRV_ACHIEVEMENT) SEM indicatorCode — fonte própria, nunca exige indicador (regressão)", async () => {
      const response = await publishWith({
        comparator: "LT",
        thresholdNumeric: 80,
        historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", aggregation: "AVERAGE", source: "PRV_ACHIEVEMENT", period: { kind: "ROLLING_DAYS", days: 90 } },
      })
      expect(response.status).toBe(200)
    })

    it("publica um critério válido: Quartil de Qualidade, Q4, 3 dos últimos 3 fechamentos", async () => {
      const response = await publishWith({
        comparator: "GTE",
        thresholdNumeric: 3,
        performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "QUALIDADE", recurrence: { periods: 3, matchQuartile: "Q4" } },
      })
      expect(response.status).toBe(200)
    })

    it("publica um critério válido: Atingimento do PRV, Média, últimos 3 meses, abaixo de 80%", async () => {
      const response = await publishWith({
        comparator: "LT",
        thresholdNumeric: 80,
        historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", aggregation: "AVERAGE", source: "PRV_ACHIEVEMENT", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } },
      })
      expect(response.status).toBe(200)
    })
  })

  describe("Publish — Selecionar colaboradores por Ranking (evolução: Por critério vs Por ranking)", () => {
    const CONSOLIDATED_STRUCTURE = { kind: "SUPERVISOR_TEAM", supervisorId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }
    const VALID_RANKING = {
      source: "MEASUREMENT",
      indicatorCode: "QUALIDADE",
      aggregation: "AVERAGE",
      period: { kind: "ROLLING_DAYS", days: 90 },
      selection: "LOWEST",
      count: 5,
    }

    function fakeDatabaseForRankingPublish(passwordHash: string, graph: unknown, directionByCode: Record<string, string> = {}) {
      return fakeDatabase([], passwordHash, (sql, params) => {
        if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
          return {
            rows: [
              {
                scopeType: "TEAM",
                teamId: TEAM_A,
                subteamId: null,
                draftGraph: graph,
                triggerConfig: { kind: "schedule", mode: "CALENDAR", intervalDays: 1 },
                consolidatedStructure: CONSOLIDATED_STRUCTURE,
              },
            ],
            rowCount: 1,
          }
        }
        if (sql.includes("desired_direction from indicator_definitions")) {
          const code = params?.[0] as string
          const direction = directionByCode[code]
          return direction ? { rows: [{ desired_direction: direction }], rowCount: 1 } : { rows: [], rowCount: 0 }
        }
        if (sql.trim().startsWith("insert into workflow_versions")) return { rows: [{ id: "version-1" }], rowCount: 1 }
        return undefined
      })
    }

    function graphWithRanking(ranking: object, selectionMode: "RANKING" | undefined = "RANKING") {
      return {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          { id: "select", type: "select_employees", label: "Selecionar colaboradores", position: { x: 0, y: 1 }, config: { selectionMode, ranking } },
          { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position: { x: 0, y: 2 }, config: {} },
          { id: "review", type: "human_review", label: "Revisão", position: { x: 0, y: 3 }, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } } },
          { id: "end-a", type: "end", label: "Fim", position: { x: 0, y: 4 }, config: {} },
          { id: "end-b", type: "end", label: "Fim", position: { x: 200, y: 4 }, config: {} },
          { id: "end-c", type: "end", label: "Fim", position: { x: 400, y: 4 }, config: {} },
        ],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
          { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
          { id: "e3", source: "apply", sourceHandle: "always", target: "review" },
          { id: "e4", source: "review", sourceHandle: "approved", target: "end-a" },
          { id: "e5", source: "review", sourceHandle: "rejected", target: "end-b" },
          { id: "e6", source: "review", sourceHandle: "escalated", target: "end-c" },
        ],
      }
    }

    async function publishWith(ranking: object, directionByCode: Record<string, string> = {}, selectionMode: "RANKING" | undefined = "RANKING") {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForRankingPublish(passwordHash, graphWithRanking(ranking, selectionMode), directionByCode)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      return agent.post("/api/v1/admin/workflows/wf-2/publish")
    }

    it("publica um ranking válido: 5 piores em Qualidade, Média, últimos 90 dias", async () => {
      const response = await publishWith(VALID_RANKING)
      expect(response.status).toBe(200)
    })

    it("rejeita selectionMode RANKING sem nenhuma configuração de ranking", async () => {
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForRankingPublish(passwordHash, graphWithRanking(undefined as unknown as object))
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.post("/api/v1/admin/workflows/wf-2/publish")
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_SELECT_EMPLOYEES_MISSING_RANKING")
    })

    it("rejeita ranking sem indicatorCode (fonte MEASUREMENT)", async () => {
      const response = await publishWith({ ...VALID_RANKING, indicatorCode: undefined })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_SELECTION_RANKING")
      expect(response.body.error.message).toContain("indicador")
    })

    it("rejeita ranking sem agregação", async () => {
      const response = await publishWith({ ...VALID_RANKING, aggregation: undefined })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_SELECTION_RANKING")
    })

    it("rejeita ranking sem período", async () => {
      const response = await publishWith({ ...VALID_RANKING, period: undefined })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_SELECTION_RANKING")
    })

    it("rejeita ranking sem quantidade (count)", async () => {
      const response = await publishWith({ ...VALID_RANKING, count: undefined })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_SELECTION_RANKING")
      expect(response.body.error.message).toContain("quantidade")
    })

    it("aceita PRV_ACHIEVEMENT sem indicatorCode — fonte própria, mesma regra da Condition (regressão)", async () => {
      const response = await publishWith({ source: "PRV_ACHIEVEMENT", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 90 }, selection: "WORST", count: 3 })
      expect(response.status).toBe(200)
    })

    it("Maiores/Menores (HIGHEST/LOWEST) nunca consultam direção — publicam mesmo sem indicator_definitions.desired_direction cadastrada", async () => {
      const response = await publishWith({ ...VALID_RANKING, selection: "HIGHEST" }, {})
      expect(response.status).toBe(200)
    })

    it("Melhores/Piores (BEST/WORST) exigem indicador com direção HIGHER/LOWER — publica quando existe", async () => {
      const response = await publishWith({ ...VALID_RANKING, selection: "BEST" }, { QUALIDADE: "HIGHER" })
      expect(response.status).toBe(200)
    })

    it("Melhores/Piores rejeitam indicador com direção TARGET (sem HIGHER/LOWER oficial) — nunca inventa, mensagem orienta pra Maiores/Menores", async () => {
      const response = await publishWith({ ...VALID_RANKING, selection: "WORST" }, { QUALIDADE: "TARGET" })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_SELECTION_RANKING_DIRECTION_UNAVAILABLE")
      expect(response.body.error.message).toContain("Maiores valores")
    })

    it("Melhores/Piores rejeitam indicador inexistente", async () => {
      const response = await publishWith({ ...VALID_RANKING, selection: "BEST" }, {})
      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe("INDICATOR_NOT_FOUND")
    })

    it("selectionMode ausente continua exigindo `criterion` (Por critério), nunca `ranking` — backward compatibility (Parte 64)", async () => {
      // Monta o grafo sem a chave `selectionMode` (nunca `undefined` explícito — parâmetro
      // default de JS trataria isso como "use o default", mascarando o caso real de payload
      // legado onde a chave simplesmente não existe).
      const graph = graphWithRanking(VALID_RANKING)
      const legacyNode = graph.nodes.find((node) => node.id === "select")!
      delete (legacyNode.config as { selectionMode?: unknown }).selectionMode
      const passwordHash = await hashPassword("Inia@123")
      const database = fakeDatabaseForRankingPublish(passwordHash, graph)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      const response = await agent.post("/api/v1/admin/workflows/wf-2/publish")
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_SELECT_EMPLOYEES_MISSING_CRITERION")
    })

    // --- Evolução de Ranking: rankingBasis CHANGE (Evolução/Queda) + partitionBy (Grupo/Subgrupo) ---
    const VALID_CHANGE_RANKING = {
      source: "MEASUREMENT",
      indicatorCode: "QUALIDADE",
      aggregation: "AVERAGE",
      period: { kind: "ROLLING_DAYS", days: 30 },
      rankingBasis: "CHANGE",
      selection: "DECLINED",
      count: 2,
    }

    it("publica um ranking CHANGE válido: 2 maiores quedas em Qualidade, últimos 30 dias vs 30 dias anteriores", async () => {
      const response = await publishWith(VALID_CHANGE_RANKING, { QUALIDADE: "HIGHER" })
      expect(response.status).toBe(200)
    })

    it("publica um ranking CHANGE + partitionBy SUBTEAM válido (cenário canônico do pedido)", async () => {
      const response = await publishWith({ ...VALID_CHANGE_RANKING, partitionBy: "SUBTEAM" }, { QUALIDADE: "HIGHER" })
      expect(response.status).toBe(200)
    })

    it("rejeita CHANGE com direção de seleção de VALUE (ex.: HIGHEST) — nunca mistura os dois vocabulários", async () => {
      const response = await publishWith({ ...VALID_CHANGE_RANKING, selection: "HIGHEST" }, { QUALIDADE: "HIGHER" })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_SELECTION_RANKING")
      expect(response.body.error.message).toContain("Evolução")
    })

    it("rejeita VALUE com direção de seleção de CHANGE (ex.: IMPROVED)", async () => {
      const response = await publishWith({ ...VALID_RANKING, selection: "IMPROVED" })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_SELECTION_RANKING")
      expect(response.body.error.message).toContain("Valor")
    })

    it('rejeita CHANGE com período "Últimos N fechamentos" (CLOSURES) — sem período anterior equivalente resolvível (Parte 7)', async () => {
      const response = await publishWith({ ...VALID_CHANGE_RANKING, period: { kind: "CLOSURES", unit: "MONTH", count: 3 } }, { QUALIDADE: "HIGHER" })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_SELECTION_RANKING")
      expect(response.body.error.message).toContain("fechamentos")
    })

    it('rejeita CHANGE (Evolução/Queda) num indicador com direção TARGET — mensagem amigável orientando HIGHER/LOWER (Parte 18/70/82)', async () => {
      const response = await publishWith(VALID_CHANGE_RANKING, { QUALIDADE: "TARGET" })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_SELECTION_RANKING_DIRECTION_UNAVAILABLE")
      expect(response.body.error.message).toContain("TARGET")
      expect(response.body.error.message).toContain("HIGHER ou LOWER")
    })

    it("CHANGE com Atingimento do PRV nunca consulta indicator_definitions — direção já é sempre HIGHER (regressão da regra de VALUE)", async () => {
      const response = await publishWith({ source: "PRV_ACHIEVEMENT", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 }, rankingBasis: "CHANGE", selection: "IMPROVED", count: 2 }, {})
      expect(response.status).toBe(200)
    })

    it("aceita partitionBy NONE explícito (equivalente ao ausente) e partitionBy TEAM/SUBTEAM em VALUE (regressão)", async () => {
      const withNone = await publishWith({ ...VALID_RANKING, partitionBy: "NONE" })
      expect(withNone.status).toBe(200)
      const withTeam = await publishWith({ ...VALID_RANKING, partitionBy: "TEAM" })
      expect(withTeam.status).toBe(200)
    })
  })

  describe("Publish — Condition: Recorrência de Quartil e Comparação temporal percentual (evolução do domínio da Condition)", () => {
    function fakeDatabaseForConditionPublish(graph: unknown, extra?: { triggerConfig?: unknown; consolidatedStructure?: unknown }) {
      return async (passwordHash: string) =>
        fakeDatabase([], passwordHash, (sql) => {
          if (sql.includes("draft_graph") && sql.includes("from workflows where id = $1 and organization_id = $2")) {
            return {
              rows: [
                {
                  scopeType: "TEAM",
                  teamId: TEAM_A,
                  subteamId: null,
                  draftGraph: graph,
                  triggerConfig: extra?.triggerConfig ?? { kind: "schedule", mode: "CALENDAR", intervalDays: 1 },
                  consolidatedStructure: extra?.consolidatedStructure ?? null,
                },
              ],
              rowCount: 1,
            }
          }
          if (sql.trim().startsWith("insert into workflow_versions")) return { rows: [{ id: "version-1" }], rowCount: 1 }
          return undefined
        })
    }

    function conditionGraph(config: unknown) {
      return {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          { id: "condition", type: "condition", label: "Regra", position: { x: 0, y: 1 }, config },
          { id: "end", type: "end", label: "Fim", position: { x: 0, y: 2 }, config: {} },
        ],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
          { id: "e2", source: "condition", sourceHandle: "true", target: "end" },
          { id: "e3", source: "condition", sourceHandle: "false", target: "end" },
          { id: "e4", source: "condition", sourceHandle: "no_data", target: "end" },
        ],
      }
    }

    async function publish(graph: unknown) {
      const passwordHash = await hashPassword("Inia@123")
      const database = await fakeDatabaseForConditionPublish(graph)(passwordHash)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      return agent.post("/api/v1/admin/workflows/wf-2/publish")
    }

    it('rejeita "Comparar com" (compareTo) junto de Quantidade de ocorrências (COUNT) — só faz sentido pra Média/Mínimo/Máximo', async () => {
      const graph = conditionGraph({
        comparator: "GTE",
        thresholdNumeric: 3,
        historicalQuery: {
          kind: "INDICATOR_THRESHOLD_COUNT",
          indicatorCode: "NOTA_URA",
          aggregation: "COUNT",
          comparator: "LT",
          indicatorThreshold: 3,
          period: { kind: "ROLLING_DAYS", days: 7 },
          compareTo: { kind: "GOAL" },
        },
      })
      const response = await publish(graph)
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_CONDITION")
    })

    it('rejeita "Mínimo de medições" junto de Quantidade de ocorrências (COUNT)', async () => {
      const graph = conditionGraph({
        comparator: "GTE",
        thresholdNumeric: 3,
        historicalQuery: {
          kind: "INDICATOR_THRESHOLD_COUNT",
          indicatorCode: "NOTA_URA",
          aggregation: "COUNT",
          comparator: "LT",
          indicatorThreshold: 3,
          period: { kind: "ROLLING_DAYS", days: 7 },
          minimumSampleSize: 3,
        },
      })
      const response = await publish(graph)
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_CONDITION")
    })

    it("aceita Média + Comparar com Meta SEM valor de referência fixo (resolvido em tempo de execução) — regressão do bug encontrado na auditoria", async () => {
      const graph = conditionGraph({
        comparator: "LT",
        thresholdNumeric: null,
        historicalQuery: {
          kind: "INDICATOR_THRESHOLD_COUNT",
          indicatorCode: "QUALIDADE",
          aggregation: "AVERAGE",
          period: { kind: "ROLLING_DAYS", days: 30 },
          compareTo: { kind: "GOAL" },
        },
      })
      const response = await publish(graph)
      expect(response.status).toBe(200)
    })

    it("rejeita Recorrência (últimos N fechamentos) numa métrica que não é Quartil", async () => {
      const graph = conditionGraph({
        comparator: "GTE",
        thresholdNumeric: 3,
        performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_ACHIEVEMENT", indicatorCode: "QUALIDADE", recurrence: { periods: 3, matchQuartile: "Q4" } },
      })
      const response = await publish(graph)
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_CONDITION")
    })

    it("aceita Recorrência de Quartil válida (Quartil do indicador + quantidade de fechamentos)", async () => {
      const graph = conditionGraph({
        comparator: "GTE",
        thresholdNumeric: 3,
        performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "MONITORIA", recurrence: { periods: 3, matchQuartile: "Q4" } },
      })
      const response = await publish(graph)
      expect(response.status).toBe(200)
    })

    it("rejeita Recorrência de Quartil com comparador não-numérico (a comparação é sobre a CONTAGEM de fechamentos)", async () => {
      const graph = conditionGraph({
        comparator: "CONTAINS",
        thresholdNumeric: 3,
        performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE", recurrence: { periods: 3, matchQuartile: "Q4" } },
      })
      const response = await publish(graph)
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_CONDITION")
    })
  })

  describe("Publish — Condition: Últimos N fechamentos (Parte 3/4 do pedido de Meta/Fechamentos)", () => {
    function fakeDatabaseForConditionPublish(graph: unknown) {
      return async (passwordHash: string) =>
        fakeDatabase([], passwordHash, (sql) => {
          if (sql.includes("draft_graph") && sql.includes("from workflows where id = $1 and organization_id = $2")) {
            return {
              rows: [
                { scopeType: "TEAM", teamId: TEAM_A, subteamId: null, draftGraph: graph, triggerConfig: { kind: "schedule", mode: "CALENDAR", intervalDays: 1 }, consolidatedStructure: null },
              ],
              rowCount: 1,
            }
          }
          if (sql.trim().startsWith("insert into workflow_versions")) return { rows: [{ id: "version-1" }], rowCount: 1 }
          return undefined
        })
    }

    function conditionGraph(config: unknown) {
      return {
        nodes: [
          { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
          { id: "condition", type: "condition", label: "Regra", position: { x: 0, y: 1 }, config },
          { id: "end", type: "end", label: "Fim", position: { x: 0, y: 2 }, config: {} },
        ],
        edges: [
          { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
          { id: "e2", source: "condition", sourceHandle: "true", target: "end" },
          { id: "e3", source: "condition", sourceHandle: "false", target: "end" },
          { id: "e4", source: "condition", sourceHandle: "no_data", target: "end" },
        ],
      }
    }

    async function publish(graph: unknown) {
      const passwordHash = await hashPassword("Inia@123")
      const database = await fakeDatabaseForConditionPublish(graph)(passwordHash)
      const agent = request.agent(createApp(database))
      await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
      return agent.post("/api/v1/admin/workflows/wf-2/publish")
    }

    it("rejeita Últimos N fechamentos junto de Quantidade de ocorrências (COUNT)", async () => {
      const graph = conditionGraph({
        comparator: "GTE",
        thresholdNumeric: 3,
        historicalQuery: {
          kind: "INDICATOR_THRESHOLD_COUNT",
          indicatorCode: "NOTA_URA",
          aggregation: "COUNT",
          comparator: "LT",
          indicatorThreshold: 3,
          period: { kind: "CLOSURES", unit: "MONTH", count: 3 },
        },
      })
      const response = await publish(graph)
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_CONDITION")
    })

    it("rejeita Últimos N fechamentos junto de Comparar com Período anterior", async () => {
      const graph = conditionGraph({
        comparator: "GT",
        thresholdNumeric: null,
        historicalQuery: {
          kind: "INDICATOR_THRESHOLD_COUNT",
          indicatorCode: "TMA",
          aggregation: "AVERAGE",
          period: { kind: "CLOSURES", unit: "MONTH", count: 3 },
          compareTo: { kind: "PREVIOUS_PERIOD" },
        },
      })
      const response = await publish(graph)
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_CONDITION")
    })

    it("aceita Últimos N fechamentos com Média e Comparar com Meta — Valor do indicador (source MEASUREMENT, única origem em que Meta é uma referência válida)", async () => {
      const graph = conditionGraph({
        comparator: "LT",
        thresholdNumeric: null,
        historicalQuery: {
          kind: "INDICATOR_THRESHOLD_COUNT",
          indicatorCode: "QUALIDADE",
          aggregation: "AVERAGE",
          period: { kind: "CLOSURES", unit: "MONTH", count: 3 },
          compareTo: { kind: "GOAL" },
        },
      })
      const response = await publish(graph)
      expect(response.status).toBe(200)
    })

    it("rejeita Atingimento do indicador + Comparar com Meta — Atingimento já representa a relação com a meta, nunca comparado de novo contra ela", async () => {
      const graph = conditionGraph({
        comparator: "LT",
        thresholdNumeric: null,
        historicalQuery: {
          kind: "INDICATOR_THRESHOLD_COUNT",
          indicatorCode: "QUALIDADE",
          aggregation: "AVERAGE",
          source: "INDICATOR_ACHIEVEMENT",
          period: { kind: "CLOSURES", unit: "MONTH", count: 3 },
          compareTo: { kind: "GOAL" },
        },
      })
      const response = await publish(graph)
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_CONDITION")
    })

    it("rejeita Atingimento do PRV + Comparar com Meta — mesma regra, sem indicador nenhum envolvido", async () => {
      const graph = conditionGraph({
        comparator: "LT",
        thresholdNumeric: null,
        historicalQuery: {
          kind: "INDICATOR_THRESHOLD_COUNT",
          aggregation: "AVERAGE",
          source: "PRV_ACHIEVEMENT",
          period: { kind: "CLOSURES", unit: "MONTH", count: 3 },
          compareTo: { kind: "GOAL" },
        },
      })
      const response = await publish(graph)
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("WORKFLOW_INVALID_CONDITION")
    })
  })
})
