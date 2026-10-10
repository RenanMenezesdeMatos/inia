import { describe, expect, it } from "vitest"
import { flowGraphSchema, nodeBranches } from "../../../modules/workflows/domain/graph-schema.js"
import { buildDemoMass, stubIndicatorDefinitions } from "./build-demo-mass.js"
import { DEMO_REVIEW_ALERT_ID, DEMO_REVIEW_ENROLLMENT_ID, DEMO_REVIEW_NODE_ID, DEMO_REVIEW_OPERATOR_KEY, DEMO_REVIEW_WORKFLOW_ID, deleteDemoFollowUps, demoFollowUpFeedbacks, demoFollowUpIds, demoReviewAgentOutput, demoReviewGraph, findDemoDerivedArtifacts } from "./demo-follow-ups.js"

describe("massa demo — Acompanhamento, Ciência e Pendência canônicos", () => {
  const feedbacks = demoFollowUpFeedbacks()
  const byKey = new Map(feedbacks.map((fixture) => [fixture.operatorKey, fixture]))

  it("cobre as cinco personas com ids determinísticos e feedbacks publicados pelos contratos reais (caso + evidência + feedback)", () => {
    expect(feedbacks.map((fixture) => fixture.operatorKey)).toEqual(["operator:0001", "operator:0002", "operator:0003", "operator:0004", "operator:0006"])
    expect(new Set(feedbacks.flatMap((fixture) => [fixture.caseId, fixture.evidenceId, fixture.feedbackId])).size).toBe(15)
    expect(demoFollowUpFeedbacks()).toEqual(feedbacks) // determinístico: mesma chamada, mesmos ids
    for (const fixture of feedbacks) {
      expect(fixture.evidenceFound.length).toBeGreaterThan(40)
      expect(fixture.recommendation.length).toBeGreaterThan(80)
      expect(fixture.caseId.startsWith("de00")).toBe(true)
    }
  })

  it("Larissa: reconhecimento com ciência CONFIRMADA; Mariana: performance crítica com ciência PENDENTE; Beatriz: evolução 83 → 110; Diego: lacuna de dado sem avaliação negativa", () => {
    expect(byKey.get("operator:0001")!.acknowledgedAt).not.toBeNull()
    expect(byKey.get("operator:0001")!.title).toContain("Reconhecimento")
    expect(byKey.get("operator:0002")!.acknowledgedAt).toBeNull()
    expect(byKey.get("operator:0002")!.recommendation).toContain("Q4")
    expect(byKey.get("operator:0003")!.evidenceFound).toContain("83% (abr)")
    expect(byKey.get("operator:0003")!.evidenceFound).toContain("110% (set)")
    const diego = byKey.get("operator:0006")!
    expect(diego.recommendation).toContain("Não foi possível concluir a análise")
    expect(diego.recommendation).toContain("lacuna de dado")
    expect(diego.recommendation).toContain("Nenhuma ação é necessária")
    expect(diego.indicatorCode).toBe("NOTA_URA")
  })

  it("Rafael: análise LONGA em Markdown realista — título, subtítulos, lista, tabela, destaque e link seguro (https)", () => {
    const rafael = byKey.get("operator:0004")!
    const text = rafael.recommendation
    expect(text.length).toBeGreaterThan(1200)
    expect(text).toMatch(/^## /m)
    expect(text).toMatch(/^### /m)
    expect(text).toMatch(/^- /m)
    expect(text).toMatch(/^\| .+ \|$/m)
    expect(text).toContain("**")
    expect(text).toMatch(/\[[^\]]+\]\(https:\/\/[^)]+\)/)
    expect(text).not.toMatch(/\]\(javascript:/)
  })

  it("a pendência demo é uma execução REAL do runtime: grafo válido, revisão com as 3 decisões ligadas e resultado do agente no contrato do Especialista de Performance", () => {
    const graph = flowGraphSchema.parse(demoReviewGraph("00000000-0000-4000-8000-000000000071"))
    const review = graph.nodes.find((node) => node.id === DEMO_REVIEW_NODE_ID)
    expect(review?.type).toBe("human_review")
    for (const branch of nodeBranches(review!)) expect(graph.edges.some((edge) => edge.source === review!.id && edge.sourceHandle === branch.id), branch.id).toBe(true)
    expect(graph.edges.find((edge) => edge.source === review!.id && edge.sourceHandle === "approved")?.target).toBe("output")
    expect(graph.edges.find((edge) => edge.source === review!.id && edge.sourceHandle === "escalated")?.target).toBe("escalar")

    const mass = buildDemoMass(stubIndicatorDefinitions())
    const output = demoReviewAgentOutput(mass)
    const operator = mass.structure.byKey.get(DEMO_REVIEW_OPERATOR_KEY)!
    expect(operator.name).toBe("Thiago Moreira")
    expect(output.kind).toBe("indicator")
    expect(output.input.operatorId).toBe(operator.id)
    expect(output.input.evidenceSourceType).toBe("employee_performance")
    expect(output.input.evidenceSourceId.split(",").length).toBeGreaterThanOrEqual(3)
    expect(output.input.structured.recommendation.length).toBeGreaterThan(100)
    expect(output.input.evidenceFound).toContain("PRV (atingimento oficial)")
    // O revisor é a Supervisora canônica (Daniela) — cadeia real do operador 0007.
    expect(operator.reportsToKey).toBe("supervisor:01")
  })

  it("o reset conhece exatamente o que o seed cria (ids explícitos, nunca prefixo)", () => {
    const ids = demoFollowUpIds()
    expect(ids.cases).toHaveLength(5)
    expect(ids.feedbacks).toHaveLength(5)
    expect(ids.alerts).toHaveLength(1)
    expect(ids.enrollments).toEqual([DEMO_REVIEW_ENROLLMENT_ID])
    expect(ids.workflows).toHaveLength(1)
    expect(ids.versions).toHaveLength(1)
  })
})

describe("reset por lineage — artefatos que uma decisão REAL da Pendência demo gera são descobertos pela cadeia, nunca por texto", () => {
  const DERIVED_CASE = "11111111-1111-4111-8111-111111111111"
  const DERIVED_FEEDBACK = "22222222-2222-4222-8222-222222222222"
  const ESCALATION_ALERT = "33333333-3333-4333-8333-333333333333"
  const CASE_ALERT = "44444444-4444-4444-8444-444444444444"

  type Row = Record<string, unknown>
  function fakeClient(state: { nodeOutputs: Row; eventCaseIds: (string | null)[]; feedbackIds: string[]; alertIds: string[]; outputs: number }) {
    const calls: { sql: string; params: unknown[] }[] = []
    const query = async <R extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<{ rows: R[]; rowCount: number }> => {
      calls.push({ sql, params })
      return route(sql) as unknown as { rows: R[]; rowCount: number }
    }
    const route = (sql: string) => {
      if (sql.includes("from workflow_enrollments where workflow_id = any")) return { rows: [{ id: DEMO_REVIEW_ENROLLMENT_ID, node_outputs: state.nodeOutputs }], rowCount: 1 }
      if (sql.includes("from workflow_enrollment_events where enrollment_id = any")) return { rows: state.eventCaseIds.map((case_id) => ({ case_id })), rowCount: state.eventCaseIds.length }
      if (sql.includes("select id from feedbacks where case_id = any")) return { rows: state.feedbackIds.map((id) => ({ id })), rowCount: state.feedbackIds.length }
      if (sql.includes("select id from alerts")) return { rows: state.alertIds.map((id) => ({ id })), rowCount: state.alertIds.length }
      if (sql.includes("from workflow_outputs where enrollment_id = any")) return { rows: [{ count: String(state.outputs) }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    }
    return { query, calls }
  }

  it("antes de qualquer decisão: só a matrícula canônica é conhecida; nenhum caso/feedback/alerta derivado", async () => {
    const client = fakeClient({ nodeOutputs: { trigger: {}, agent: { kind: "indicator" } }, eventCaseIds: [], feedbackIds: [], alertIds: [DEMO_REVIEW_ALERT_ID], outputs: 0 })
    const derived = await findDemoDerivedArtifacts(client)
    expect(derived).toEqual({ enrollments: [DEMO_REVIEW_ENROLLMENT_ID], cases: [], feedbacks: [], alerts: [], workflowOutputs: 0 })
    // a lineage parte SEMPRE dos ids determinísticos da fixture (workflow + matrícula), nunca de texto
    expect(client.calls[0]!.params).toEqual([[DEMO_REVIEW_WORKFLOW_ID], [DEMO_REVIEW_ENROLLMENT_ID]])
    for (const call of client.calls) expect(call.sql.toLowerCase()).not.toContain("like '%demo%'")
  })

  it("após APROVAR: o caso vem do payload do evento/node_outputs do Output; o feedback publicado, pelo FK do caso; o alerta da fixture NÃO vira derivado", async () => {
    const client = fakeClient({
      nodeOutputs: { output: { caseId: DERIVED_CASE, feedbackId: DERIVED_FEEDBACK }, review: { decision: "APPROVED" } },
      eventCaseIds: [DERIVED_CASE],
      feedbackIds: [DERIVED_FEEDBACK],
      alertIds: [DEMO_REVIEW_ALERT_ID, CASE_ALERT],
      outputs: 0,
    })
    const derived = await findDemoDerivedArtifacts(client)
    expect(derived.cases).toEqual([DERIVED_CASE])
    expect(derived.feedbacks).toEqual([DERIVED_FEEDBACK])
    expect(derived.alerts).toEqual([CASE_ALERT])
    // feedbacks são buscados pelo caso derivado E pelo id apontado no node Output
    const feedbackCall = client.calls.find((call) => call.sql.includes("select id from feedbacks"))!
    expect(feedbackCall.params).toEqual([[DERIVED_CASE], [DERIVED_FEEDBACK]])
  })

  it("após ESCALAR: o alerta ao Gerente é reconhecido pela chave estruturada do motor (segmento da dedupe_key = matrícula demo); REPROVAR não deriva nada", async () => {
    const escalated = fakeClient({ nodeOutputs: { review: { decision: "ESCALATED" }, escalar: { recipientCount: 1 } }, eventCaseIds: [], feedbackIds: [], alertIds: [ESCALATION_ALERT], outputs: 0 })
    const derived = await findDemoDerivedArtifacts(escalated)
    expect(derived).toMatchObject({ cases: [], feedbacks: [], alerts: [ESCALATION_ALERT] })
    const alertCall = escalated.calls.find((call) => call.sql.includes("select id from alerts"))!
    expect(alertCall.sql).toContain("split_part(dedupe_key, ':', 2) = any($1::text[])")
    expect(alertCall.params[0]).toEqual([DEMO_REVIEW_ENROLLMENT_ID])

    const rejected = fakeClient({ nodeOutputs: { review: { decision: "REJECTED" } }, eventCaseIds: [], feedbackIds: [], alertIds: [], outputs: 0 })
    expect(await findDemoDerivedArtifacts(rejected)).toEqual({ enrollments: [DEMO_REVIEW_ENROLLMENT_ID], cases: [], feedbacks: [], alerts: [], workflowOutputs: 0 })
  })

  it("remoção respeita as FKs: derivados (filhos → caso) antes da fixture, fixture antes da estrutura; ids do seed nunca entram nas listas de derivados", async () => {
    const labels: string[] = []
    const params: Record<string, unknown[]> = {}
    const run = async (label: string, _sql: string, values: unknown[]) => {
      labels.push(label)
      params[label] = values
    }
    const client = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Parameters<typeof deleteDemoFollowUps>[0]
    await deleteDemoFollowUps(client, run, { enrollments: [DEMO_REVIEW_ENROLLMENT_ID], cases: [DERIVED_CASE], feedbacks: [DERIVED_FEEDBACK], alerts: [ESCALATION_ALERT], workflowOutputs: 0 })
    const index = (label: string) => labels.indexOf(label)
    expect(index("derived:feedbacks")).toBeLessThan(index("derived:supervision_cases"))
    expect(index("derived:evidences")).toBeLessThan(index("derived:supervision_cases"))
    expect(index("derived:development_actions")).toBeLessThan(index("derived:development_plans"))
    expect(index("derived:supervision_cases")).toBeLessThan(index("workflow_enrollments"))
    expect(index("workflow_enrollments")).toBeLessThan(index("workflow_versions"))
    expect(index("workflow_versions")).toBeLessThan(index("workflows"))
    expect(index("feedbacks")).toBeLessThan(index("supervision_cases"))
    expect(params["derived:supervision_cases"]).toEqual([[DERIVED_CASE]])
    expect(labels).not.toContain("derived:workflow_enrollments") // a matrícula canônica é da fixture, não "derivada"
    expect(labels.some((label) => label.includes("truncate") || label.includes("cascade"))).toBe(false)
  })
})
