import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { buildStructuredOutputContract, type StructuredOutputDefinition } from "../domain/structured-output-definition.js"
import { legacyAccessQuery } from "../../access/testing/legacy-admin-fixture.js"

/**
 * Construtor visual de resultado estruturado (2026-09-17): a API grava UMA definição e GERA as
 * colunas legadas; a leitura devolve a definição efetiva (persistida ou convertida do legado)
 * com a revisão pendente quando texto × campos divergem; alteração breaking em uso por
 * Workflow é bloqueada (publicado) ou exige confirmação (rascunho).
 */

const TEAM_A = "11111111-1111-4111-8111-111111111111"
const ORCH_AGENT_A = "33333333-3333-4333-8333-333333333333"
const ORCHESTRATOR_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const WORKFLOW_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"

const ACCOUNT = {
  id: "acc-1",
  organization_id: "00000000-0000-4000-8000-000000000001",
  person_id: "person-1",
  name: "Admin",
  role: "ADMIN",
  email: "admin@inia.com",
  avatar_url: null,
  job_title: null,
  team_id: null,
  team_name: null,
}

const SINTESE: StructuredOutputDefinition = {
  schemaVersion: 1,
  nodes: [
    {
      kind: "GROUP",
      key: "sintese",
      label: "Síntese",
      children: [
        { kind: "FIELD", key: "severidade", label: "Severidade", type: "ENUM", required: false, options: [{ value: "BAIXA" }, { value: "MEDIA" }, { value: "ALTA" }, { value: "CRITICA" }] },
        { kind: "FIELD", key: "requerAcompanhamento", label: "Requer acompanhamento", type: "BOOLEAN", required: false },
      ],
    },
  ],
}

const LEGACY_SCHEMA = [
  {
    key: "sintese",
    label: "Síntese",
    fields: [
      { key: "severidade", type: "STRING", label: "Severidade", enumValues: ["BAIXA", "MEDIA", "ALTA", "CRITICA"] },
      { key: "requerAcompanhamento", type: "BOOLEAN", label: "Requer acompanhamento" },
    ],
  },
]

/** Grafo de Workflow com um node Orquestrador apontando pro ORCHESTRATOR_A e uma Condition em `sintese.severidade`. */
function graphUsing(path: string) {
  return {
    nodes: [
      { id: "trigger", type: "trigger", label: "Gatilho", config: {} },
      { id: "orq", type: "orchestrator", label: "Atendimento", config: { orchestratorId: ORCHESTRATOR_A, instruction: "Analise." } },
      { id: "cond", type: "condition", label: "Severidade alta?", config: { sourcePath: `nodeOutputs.orq.structuredResult.${path}`, comparator: "EQUALS", thresholdText: "ALTA" } },
    ],
    edges: [],
  }
}

type Row = Record<string, unknown>

function fakeDatabase(options: {
  passwordHash: string
  current: { structured_output: unknown; output_schema: unknown; output_instructions: string | null }
  workflows?: { id: string; name: string; draft_graph: unknown; published_graph: unknown }[]
  updates: unknown[][]
}): Database {
  async function routedQuery(sql: string, params?: unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
    if (sql.includes("from user_accounts ua")) return { rows: [{ ...ACCOUNT, password_hash: options.passwordHash, active: true }], rowCount: 1 }
    if (sql.includes("from user_role_assignments")) return { rows: [], rowCount: 0 }
    const access = legacyAccessQuery(sql, ACCOUNT.role, [])
    if (access) return access
    if (sql.includes("select structured_output, output_schema, output_instructions from assistant_orchestrators")) return { rows: [options.current], rowCount: 1 }
    if (sql.includes("from assistant_orchestrators where id = $1")) return { rows: [{ scopeType: "TEAM", teamId: TEAM_A, subteamId: null }], rowCount: 1 }
    if (sql.includes("from assistant_orchestrator_specialists where orchestrator_id")) return { rows: [], rowCount: 0 }
    if (sql.includes("select o.policy_kind, o.policy_domains")) {
      return { rows: [{ policy_kind: "OPEN", policy_domains: [], routing_policy: "OPEN", routing_domains: [], business_domains: [], active: true, invocation_mode: "WORKFLOW" }], rowCount: 1 }
    }
    if (sql.includes("from workflows w")) return { rows: options.workflows ?? [], rowCount: options.workflows?.length ?? 0 }
    if (sql.startsWith("update assistant_orchestrators set")) {
      options.updates.push(params ?? [])
      return { rows: [{ id: ORCHESTRATOR_A }], rowCount: 1 }
    }
    if (sql.includes("from assistant_orchestrators o") && sql.includes("o.id = $2")) {
      const last = options.updates[options.updates.length - 1]
      const touched = last?.[17] === true
      return {
        rows: [
          {
            id: ORCHESTRATOR_A,
            name: "Atendimento multidomínio",
            scopeType: "TEAM",
            teamId: TEAM_A,
            subteamId: null,
            active: true,
            invocationMode: "WORKFLOW",
            orchestratorAgentId: ORCH_AGENT_A,
            outputInstructions: touched ? (last?.[8] as string | null) : options.current.output_instructions,
            outputSchema: touched && last?.[9] === true ? (last?.[10] ? JSON.parse(last[10] as string) : null) : options.current.output_schema,
            structuredOutputRaw: touched ? (last?.[18] ? JSON.parse(last[18] as string) : null) : options.current.structured_output,
            specialists: [],
          },
        ],
        rowCount: 1,
      }
    }
    return { rows: [], rowCount: 0 }
  }
  return { query: routedQuery, connect: async () => ({ query: routedQuery, release: () => {} }) } as unknown as Database
}

async function loginAgent(database: Database) {
  const agent = request.agent(createApp(database))
  await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
  return agent
}

describe("assistant-router — resultado estruturado (fonte única da verdade)", () => {
  it("GET de um legado devolve a definição convertida (paths preservados) e a revisão quando texto × campos divergem", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const divergent = 'um JSON { "sintese": { "criticidade": "BAIXA|ALTA", "requerAcompanhamento": true|false } }'
    const database = fakeDatabase({ passwordHash, current: { structured_output: null, output_schema: LEGACY_SCHEMA, output_instructions: divergent }, updates: [] })
    const agent = await loginAgent(database)
    const response = await agent.get(`/api/v1/admin/assistant-orchestrators/${ORCHESTRATOR_A}`)
    expect(response.status).toBe(200)
    expect(response.body.data.structuredOutputSource).toBe("LEGACY_SCHEMA")
    expect(response.body.data.structuredOutput.nodes[0].children.map((node: { key: string }) => node.key)).toEqual(["severidade", "requerAcompanhamento"])
    expect(response.body.data.structuredOutputFields.map((field: { path: string }) => field.path)).toEqual(["sintese.severidade", "sintese.requerAcompanhamento"])
    expect(response.body.data.structuredOutputReview).toMatchObject({ reason: "KEY_MISMATCH", missingInInstructions: ["severidade"], unknownInInstructions: ["criticidade"] })
    // o texto legado NÃO foi reescrito
    expect(response.body.data.outputInstructions).toBe(divergent)
  })

  it("PATCH com a definição grava a fonte única e GERA as colunas legadas (contrato + metadado)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const updates: unknown[][] = []
    const database = fakeDatabase({ passwordHash, current: { structured_output: null, output_schema: LEGACY_SCHEMA, output_instructions: "texto antigo" }, updates })
    const agent = await loginAgent(database)
    const response = await agent.patch(`/api/v1/admin/assistant-orchestrators/${ORCHESTRATOR_A}`).send({ structuredOutput: SINTESE })
    expect(response.status).toBe(200)
    const params = updates[0]!
    expect(params[7]).toBe(true)
    expect(params[8]).toBe(buildStructuredOutputContract(SINTESE))
    expect(params[9]).toBe(true)
    expect(JSON.parse(params[10] as string)).toEqual(LEGACY_SCHEMA)
    expect(params[17]).toBe(true)
    expect(JSON.parse(params[18] as string)).toEqual(SINTESE)
    expect(response.body.data.structuredOutputSource).toBe("DEFINITION")
    expect(response.body.data.structuredOutputReview).toBeNull()
  })

  it("PATCH com structuredOutput: null desliga tudo (texto livre) e PATCH sem o campo não mexe nas colunas", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const updates: unknown[][] = []
    const database = fakeDatabase({ passwordHash, current: { structured_output: SINTESE, output_schema: LEGACY_SCHEMA, output_instructions: "x" }, updates })
    const agent = await loginAgent(database)
    const off = await agent.patch(`/api/v1/admin/assistant-orchestrators/${ORCHESTRATOR_A}`).send({ structuredOutput: null })
    expect(off.status).toBe(200)
    expect(updates[0]!.slice(7, 11)).toEqual([true, null, true, null])
    expect(updates[0]![17]).toBe(true)
    expect(updates[0]![18]).toBeNull()
    const untouched = await agent.patch(`/api/v1/admin/assistant-orchestrators/${ORCHESTRATOR_A}`).send({ name: "Outro nome" })
    expect(untouched.status).toBe(200)
    expect(updates[1]![7]).toBe(false)
    expect(updates[1]![17]).toBe(false)
  })

  it("definição inválida é recusada com mensagem humana (422 STRUCTURED_OUTPUT_INVALID)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = fakeDatabase({ passwordHash, current: { structured_output: null, output_schema: null, output_instructions: null }, updates: [] })
    const agent = await loginAgent(database)
    const response = await agent.patch(`/api/v1/admin/assistant-orchestrators/${ORCHESTRATOR_A}`).send({
      structuredOutput: { schemaVersion: 1, nodes: [{ kind: "GROUP", key: "analise", label: "Análise", children: [{ kind: "FIELD", key: "assunto", label: "Assunto", type: "STRING", required: false }, { kind: "FIELD", key: "assunto", label: "Assunto 2", type: "STRING", required: false }] }] },
    })
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("STRUCTURED_OUTPUT_INVALID")
    expect(response.body.error.message).toContain('Já existe um campo com a chave "assunto" dentro de Análise')
  })

  it("apagar um campo usado por um Workflow em RASCUNHO exige confirmação; com ela, salva", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const updates: unknown[][] = []
    const database = fakeDatabase({
      passwordHash,
      current: { structured_output: null, output_schema: LEGACY_SCHEMA, output_instructions: "x" },
      workflows: [{ id: WORKFLOW_ID, name: "Modelo · 08", draft_graph: graphUsing("sintese.severidade"), published_graph: null }],
      updates,
    })
    const agent = await loginAgent(database)
    const withoutSeveridade: StructuredOutputDefinition = { schemaVersion: 1, nodes: [{ kind: "GROUP", key: "sintese", label: "Síntese", children: [{ kind: "FIELD", key: "requerAcompanhamento", label: "Requer acompanhamento", type: "BOOLEAN", required: false }] }] }
    const blocked = await agent.patch(`/api/v1/admin/assistant-orchestrators/${ORCHESTRATOR_A}`).send({ structuredOutput: withoutSeveridade })
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.code).toBe("STRUCTURED_OUTPUT_IN_USE_DRAFT")
    expect(blocked.body.error.details.impacts).toEqual([expect.objectContaining({ workflowId: WORKFLOW_ID, published: false, nodeLabel: "Severidade alta?", path: "sintese.severidade", change: { kind: "REMOVED", path: "sintese.severidade" } })])
    expect(updates).toHaveLength(0)

    const confirmed = await agent.patch(`/api/v1/admin/assistant-orchestrators/${ORCHESTRATOR_A}`).send({ structuredOutput: withoutSeveridade, acknowledgeStructuredOutputImpacts: true })
    expect(confirmed.status).toBe(200)
    expect(updates).toHaveLength(1)
  })

  it("apagar um campo usado por um Workflow PUBLICADO é sempre bloqueado; mudança compatível passa sem consultar nada", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const updates: unknown[][] = []
    const database = fakeDatabase({
      passwordHash,
      current: { structured_output: SINTESE, output_schema: LEGACY_SCHEMA, output_instructions: "x" },
      workflows: [{ id: WORKFLOW_ID, name: "Modelo · 08", draft_graph: graphUsing("sintese.severidade"), published_graph: graphUsing("sintese.severidade") }],
      updates,
    })
    const agent = await loginAgent(database)
    const renamed: StructuredOutputDefinition = JSON.parse(JSON.stringify(SINTESE))
    const group = renamed.nodes[0]
    if (group?.kind === "GROUP" && group.children[0]?.kind === "FIELD") group.children[0].key = "criticidade"
    const blocked = await agent.patch(`/api/v1/admin/assistant-orchestrators/${ORCHESTRATOR_A}`).send({ structuredOutput: renamed, acknowledgeStructuredOutputImpacts: true })
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.code).toBe("STRUCTURED_OUTPUT_IN_USE_PUBLISHED")
    expect(blocked.body.error.message).toContain("Modelo · 08 (publicado)")

    const compatible: StructuredOutputDefinition = JSON.parse(JSON.stringify(SINTESE))
    const compatibleGroup = compatible.nodes[0]
    if (compatibleGroup?.kind === "GROUP") {
      compatibleGroup.label = "Síntese da interação"
      compatibleGroup.children.push({ kind: "FIELD", key: "assunto", label: "Assunto", type: "STRING", required: false, description: "Identifique o principal motivo do contato." })
    }
    const ok = await agent.patch(`/api/v1/admin/assistant-orchestrators/${ORCHESTRATOR_A}`).send({ structuredOutput: compatible })
    expect(ok.status).toBe(200)
    expect(ok.body.data.structuredOutputFields.map((field: { path: string }) => field.path)).toEqual(["sintese.severidade", "sintese.requerAcompanhamento", "sintese.assunto"])
  })

  describe("compatibilidade direcional (hardening) — Workflow PUBLICADO dependente de sintese.severidade", () => {
    /** Definição com Nota 0..10 além da SINTESE; "Nota" NÃO é lida por nenhum Workflow — o que prova
     * que estreitar a faixa/obrigatoriedade impacta o resultado INTEIRO, não só o path lido. */
    const WITH_NOTA: StructuredOutputDefinition = {
      schemaVersion: 1,
      nodes: [
        {
          kind: "GROUP",
          key: "sintese",
          label: "Síntese",
          children: [
            { kind: "FIELD", key: "severidade", label: "Severidade", type: "ENUM", required: false, options: [{ value: "BAIXA" }, { value: "MEDIA" }, { value: "ALTA" }, { value: "CRITICA" }] },
            { kind: "FIELD", key: "requerAcompanhamento", label: "Requer acompanhamento", type: "BOOLEAN", required: true },
            { kind: "FIELD", key: "nota", label: "Nota", type: "NUMBER", required: false, minimum: 0, maximum: 10 },
          ],
        },
      ],
    }
    function mutated(mutate: (children: Extract<StructuredOutputDefinition["nodes"][number], { kind: "FIELD" }>[]) => void): StructuredOutputDefinition {
      const next: StructuredOutputDefinition = JSON.parse(JSON.stringify(WITH_NOTA))
      const group = next.nodes[0]
      if (group?.kind !== "GROUP") throw new Error("expected group")
      mutate(group.children as Extract<StructuredOutputDefinition["nodes"][number], { kind: "FIELD" }>[])
      return next
    }
    async function attempt(next: StructuredOutputDefinition) {
      const passwordHash = await hashPassword("Inia@123")
      const updates: unknown[][] = []
      const database = fakeDatabase({
        passwordHash,
        current: { structured_output: WITH_NOTA, output_schema: null, output_instructions: "x" },
        workflows: [{ id: WORKFLOW_ID, name: "Modelo · 08", draft_graph: graphUsing("sintese.severidade"), published_graph: graphUsing("sintese.severidade") }],
        updates,
      })
      const agent = await loginAgent(database)
      const response = await agent.patch(`/api/v1/admin/assistant-orchestrators/${ORCHESTRATOR_A}`).send({ structuredOutput: next, acknowledgeStructuredOutputImpacts: true })
      return { response, updates }
    }

    it("opcional → obrigatório (mesmo num campo que o Workflow não lê) → 409 bloqueio", async () => {
      const { response, updates } = await attempt(mutated((children) => (children.find((child) => child.key === "nota")!.required = true)))
      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe("STRUCTURED_OUTPUT_IN_USE_PUBLISHED")
      expect(response.body.error.details.impacts).toEqual([expect.objectContaining({ published: true, path: "sintese.severidade", change: { kind: "REQUIRED_ADDED", path: "sintese.nota" } })])
      expect(response.body.error.message).toContain("passaria a ser obrigatório")
      expect(updates).toHaveLength(0)
    })

    it("campo NOVO já obrigatório → 409 bloqueio (campo novo opcional continua permitido)", async () => {
      const blocked = await attempt(mutated((children) => children.push({ kind: "FIELD", key: "assunto", label: "Assunto", type: "STRING", required: true })))
      expect(blocked.response.status).toBe(409)
      expect(blocked.response.body.error.details.impacts[0].change).toEqual({ kind: "REQUIRED_ADDED", path: "sintese.assunto" })
      const allowed = await attempt(mutated((children) => children.push({ kind: "FIELD", key: "assunto", label: "Assunto", type: "STRING", required: false })))
      expect(allowed.response.status).toBe(200)
    })

    it("obrigatório → opcional → permitido", async () => {
      const { response, updates } = await attempt(mutated((children) => (children.find((child) => child.key === "requerAcompanhamento")!.required = false)))
      expect(response.status).toBe(200)
      expect(updates).toHaveLength(1)
    })

    it("ENUM: adicionar opção (e mudar só rótulo) → permitido", async () => {
      const { response } = await attempt(
        mutated((children) => {
          const severidade = children.find((child) => child.key === "severidade")!
          severidade.options!.push({ value: "URGENTE", label: "Urgente" })
          severidade.options![0]!.label = "Baixa"
        }),
      )
      expect(response.status).toBe(200)
    })

    it("ENUM: remover opção → 409 bloqueio", async () => {
      const { response } = await attempt(mutated((children) => (children.find((child) => child.key === "severidade")!.options = [{ value: "BAIXA" }, { value: "ALTA" }])))
      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe("STRUCTURED_OUTPUT_IN_USE_PUBLISHED")
      expect(response.body.error.details.impacts[0].change).toEqual({ kind: "ENUM_OPTION_REMOVED", path: "sintese.severidade", values: ["MEDIA", "CRITICA"] })
    })

    it("NUMBER: faixa mais estreita → 409 bloqueio (política de publicado)", async () => {
      const { response } = await attempt(mutated((children) => (children.find((child) => child.key === "nota")!.maximum = 5)))
      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe("STRUCTURED_OUTPUT_IN_USE_PUBLISHED")
      expect(response.body.error.details.impacts[0].change).toEqual({ kind: "RANGE_NARROWED", path: "sintese.nota", from: { minimum: 0, maximum: 10 }, to: { minimum: 0, maximum: 5 } })
      expect(response.body.error.message).toContain("0 a 10 → 0 a 5")
    })

    it("NUMBER: faixa mais larga → permitido", async () => {
      const { response, updates } = await attempt(
        mutated((children) => {
          const nota = children.find((child) => child.key === "nota")!
          nota.minimum = -10
          delete nota.maximum
        }),
      )
      expect(response.status).toBe(200)
      expect(updates).toHaveLength(1)
    })
  })

  it("GET /:id/structured-output-usage lista onde cada path é usado", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = fakeDatabase({
      passwordHash,
      current: { structured_output: SINTESE, output_schema: null, output_instructions: null },
      workflows: [{ id: WORKFLOW_ID, name: "Modelo · 08", draft_graph: graphUsing("sintese.severidade"), published_graph: null }],
      updates: [],
    })
    const agent = await loginAgent(database)
    const response = await agent.get(`/api/v1/admin/assistant-orchestrators/${ORCHESTRATOR_A}/structured-output-usage`)
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual([{ workflowId: WORKFLOW_ID, workflowName: "Modelo · 08", published: false, nodeId: "cond", nodeLabel: "Severidade alta?", path: "sintese.severidade" }])
  })
})
