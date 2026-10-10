import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { ENGINE_TOOL_SPECS, plannerArgsView, plannerResponseSchemaFor, validatePlannedArgs } from "../domain/investigation-toolbox.js"
import { fakeEngineModel, plannerPayloadOf } from "../testing/fake-engine-model.js"
import { catalogRunner, investigationOf, ok, request, setup, strategyWith } from "../testing/investigation-world.js"
import { investigateIndicator } from "./investigate-indicator.js"

/**
 * CONTRATO DOS ARGUMENTOS DAS FERRAMENTAS (`TOOL_ARGUMENT_CONTRACT_V1`) — defeito da rodada real V9, sem IA.
 *
 * DEFEITO: o schema da resposta do planejador declarava `args: { type: "object" }` SEM propriedades. Com saída estruturada, o modelo
 * só conseguia devolver `{}` — a resposta paga foi `{"calls":[{"tool":"segment_indicator","question":"WHERE","args":{}}]}` e a
 * consulta foi recusada por "dimensão não permitida (—)". Nenhuma ferramenta podia receber argumento.
 */
const noConfig = { allowedDimensions: [] as string[], subjectSlices: [] as string[] }

describe("o schema da resposta declara os argumentos reais", () => {
  it("args tem as propriedades de todas as ferramentas; a dimensão vem com os valores permitidos da execução", () => {
    const schema = plannerResponseSchemaFor({ tools: ["segment_indicator", "detect_anomalies"], allowedDimensions: ["SUBJECT"] }) as { properties: { calls: { items: { properties: { tool: { enum: string[] }; args: { properties: Record<string, { type: string; enum?: string[] }> } } } } } }
    const call = schema.properties.calls.items.properties
    expect(call.tool.enum).toEqual(["segment_indicator", "detect_anomalies"])
    expect(Object.keys(call.args.properties).sort()).toEqual(["dimension", "flag", "interaction", "interactions", "layer", "limit", "offset", "orderBy", "path", "query", "question", "ref", "reference", "slice", "subject", "window"])
    expect(call.args.properties.dimension).toEqual({ type: "string", enum: ["SUBJECT"] })
    expect(call.args.properties.interactions).toEqual({ type: "array", items: { type: "string" } })
  })
  it("o planejador recebe tipo, obrigatoriedade e valores de cada argumento (dinâmicos resolvidos pela configuração)", () => {
    expect(plannerArgsView("segment_indicator", { allowedDimensions: ["SUBJECT", "DAY"], subjectSlices: [] }).dimension).toEqual({ type: "string", required: true, values: ["SUBJECT", "DAY"], description: ENGINE_TOOL_SPECS.segment_indicator.args.dimension!.description })
    expect(plannerArgsView("detect_anomalies", noConfig).window).toMatchObject({ required: false, values: ["CURRENT", "PREVIOUS"], default: "CURRENT" })
  })
})

describe("argumento obrigatório ausente: configuração só com UMA opção válida; senão erro estruturado", () => {
  it("dimensão ausente com uma só permitida → preenchida e registrada; com várias → recusa com as opções", () => {
    expect(validatePlannedArgs("segment_indicator", {}, { allowedDimensions: ["SUBJECT"], subjectSlices: [] })).toEqual({ ok: true, args: { dimension: "SUBJECT" }, defaulted: ["dimension"] })
    expect(validatePlannedArgs("segment_indicator", {}, { allowedDimensions: ["SUBJECT", "DAY"], subjectSlices: [] })).toEqual({ ok: false, refusal: { code: "ARGUMENT_MISSING", argument: "dimension", allowed: ["SUBJECT", "DAY"], message: 'argumento obrigatório "dimension" ausente — escolha um de: SUBJECT, DAY' } })
  })
  it("valor fora da lista é recusado (nunca o mais parecido); referência sem padrão único também", () => {
    expect(validatePlannedArgs("segment_indicator", { dimension: "HOUR" }, { allowedDimensions: ["SUBJECT"], subjectSlices: [] })).toMatchObject({ ok: false, refusal: { code: "ARGUMENT_INVALID", argument: "dimension", allowed: ["SUBJECT"] } })
    expect(validatePlannedArgs("compare_population", {}, noConfig)).toMatchObject({ ok: false, refusal: { code: "ARGUMENT_MISSING", argument: "reference", allowed: ["SUBGROUP", "GROUP"] } })
    expect(validatePlannedArgs("analyze_calls", { question: "o que houve" }, noConfig)).toMatchObject({ ok: false, refusal: { code: "ARGUMENT_MISSING", argument: "interactions", allowed: null } })
    expect(validatePlannedArgs("reference_practices", {}, { allowedDimensions: [], subjectSlices: ["CONTESTACAO", "SEGUNDA_VIA"] })).toMatchObject({ ok: false, refusal: { code: "ARGUMENT_MISSING", argument: "subject", allowed: ["CONTESTACAO", "SEGUNDA_VIA"] } })
    expect(validatePlannedArgs("reference_practices", {}, { allowedDimensions: [], subjectSlices: ["CONTESTACAO"] })).toMatchObject({ ok: true, args: { subject: "CONTESTACAO" }, defaulted: ["subject"] })
  })
  it("opcional ausente segue o padrão documentado (sem recusa); tipo errado é recusado", () => {
    expect(validatePlannedArgs("detect_anomalies", {}, noConfig)).toEqual({ ok: true, args: {}, defaulted: [] })
    expect(validatePlannedArgs("find_interactions", { limit: "dez" }, noConfig)).toMatchObject({ ok: false, refusal: { code: "ARGUMENT_INVALID", argument: "limit" } })
  })
})

describe("recusa volta ao planejador e nunca responde a pergunta", () => {
  it("rodada 1 sem dimensão (várias permitidas) → recusa estruturada; rodada 2 recebe o erro, corrige e a consulta roda", async () => {
    const tools = catalogRunner({ segment_indicator: () => ok({ dimension: "SUBJECT", buckets: [] }), detect_anomalies: () => ok({ anomalies: [] }) })
    const payloads: ReturnType<typeof plannerPayloadOf>[] = []
    const model = fakeEngineModel({
      planner: (payload, round) => {
        payloads.push(payload)
        if (round === 1) return { calls: [{ tool: "segment_indicator", args: {}, question: "WHERE" }] }
        if (round === 2) return { calls: [{ tool: "segment_indicator", args: { dimension: "SUBJECT" }, question: "WHERE" }] }
        return { calls: [], stop: { reason: "SUFFICIENT", note: "A localização por assunto respondeu." } }
      },
    })
    // Sem estratégia: todas as dimensões do catálogo são permitidas — não há opção única para preencher.
    const { investigate, memory } = setup({ model: model.model, tools: tools.runner, subjects: "STABLE" })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    const ledger = investigation.tools!.ledger.filter((entry) => entry.tool === "segment_indicator")
    expect(ledger[0]).toMatchObject({ status: "REJECTED", refusal: { code: "ARGUMENT_MISSING", argument: "dimension" } })
    expect(ledger[0]!.refusal!.allowed!.length).toBeGreaterThan(1)
    // A rodada seguinte recebe a recusa com o argumento e as opções (o planejador corrige).
    const refused = (payloads[1] as unknown as { refused?: { ref: string; code: string; argument: string; allowed: string[] }[] }).refused
    expect(refused).toEqual([expect.objectContaining({ ref: ledger[0]!.ref, code: "ARGUMENT_MISSING", argument: "dimension" })])
    expect(ledger[1]).toMatchObject({ status: "OK", requestedArgs: { dimension: "SUBJECT" } })
    expect(tools.invoked.filter((call) => call.tool === "segment_indicator")).toHaveLength(1)
    // A recusa não respondeu nada: depois da rodada 1 a pergunta WHERE continuava aberta.
    const afterRound1 = investigation.tools!.questionHistory!.find((entry) => entry.round === 1)
    expect(afterRound1?.questions.find((question) => question.id === "WHERE")?.status).not.toBe("ANSWERED")
  })
  it("com uma só dimensão permitida pela estratégia, a consulta sem dimensão roda e registra o preenchimento", async () => {
    const tools = catalogRunner({ segment_indicator: () => ok({ dimension: "SUBJECT", buckets: [] }) })
    const model = fakeEngineModel({ planner: (_payload, round) => (round === 1 ? { calls: [{ tool: "segment_indicator", args: {}, question: "WHERE" }] } : { calls: [], stop: { reason: "SUFFICIENT", note: "ok" } }) })
    const { investigate, memory } = setup({ model: model.model, tools: tools.runner, strategy: strategyWith({ segmentation: true }), subjects: "STABLE" })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(investigation.tools!.ledger.find((entry) => entry.tool === "segment_indicator")).toMatchObject({ status: "OK", defaulted: ["dimension"], requestedArgs: { dimension: "SUBJECT" } })
  })
})
