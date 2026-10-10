import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { buildIndicatorBrief } from "../domain/indicator-brief.js"
import { compactForModel, DETAIL_MAX_CHARS, detailOf, perResultBudget, RESULT_MIN_CHARS, RESULTS_ROUND_BUDGET_CHARS, toolOutcomeOf, TOOL_OUTCOME_LABEL } from "../domain/tool-result-view.js"
import { fakeEngineModel, plannerPayloadOf, type PlannerPayload } from "../testing/fake-engine-model.js"
import { anomaly, catalogRunner, DAILY_WITH_PEAK, investigationOf, ok, PEAK_DAY, request, setup, type ToolScript } from "../testing/investigation-world.js"
import { EngineMeter, meteredModel } from "./engine-meter.js"
import { investigateIndicator } from "./investigate-indicator.js"

/**
 * INVESTIGAÇÃO ADAPTATIVA COM FERRAMENTAS (`INDICATOR_INVESTIGATION_V7`, `ENGINE_INVESTIGATION_TOOLS_V4`, `TOOL_RESULT_VIEW_V1`,
 * `PLANNER_QUESTIONS_V1`, `ENGINE_BUDGET_V2`) — planejador e ferramentas FALSOS, zero IA. Provam o CAMINHO (ferramenta disponível →
 * argumentos → execução → resultado acessível ao planejador → aprofundamento → diagnóstico), nunca a qualidade de um planejador real.
 */
type Turn = PlannerPayload & { lastResults?: { ref: string; tool: string; outcome: string; data: unknown; omitted?: { path: string; kind: string; shown: number; total: number }[] }[]; refused?: { ref: string; code: string; argument: string | null; allowed: string[] | null }[]; limits: Record<string, number> }
const turnOf = (fake: ReturnType<typeof fakeEngineModel>, index: number) => plannerPayloadOf(fake.calls.filter((call) => call.stage === "INVESTIGATION_PLANNING")[index]!) as Turn

/** Série com 60 pontos — o PICO fica no item 51, além do que cabe na visão compacta (40 itens). */
const LONG_SERIES = Array.from({ length: 60 }, (_, index) => (index === 50 ? anomaly(PEAK_DAY) : { date: `2026-0${index < 30 ? 7 : 8}-${String((index % 28) + 1).padStart(2, "0")}`, observedValue: 405 + (index % 9), baseline: 410, classification: "NORMAL", performance: "NORMAL", score: 0.2 }))
const discoveryTools: ToolScript = {
  detect_anomalies: () => ok({ pattern: "ISOLATED_SPIKES", baseline: 410, pointsAnalyzed: 60, anomalies: LONG_SERIES }),
  compare_population: () => ok({ reference: "SUBGROUP", targetValue: 450, referenceValue: 440, referencePopulation: 12, difference: 10, differencePercent: 2.3, performance: "IN_LINE_WITH_REFERENCE" }, "pares do Subgrupo (n=12)"),
  get_interaction_flags: () => ok({ total: 3, flags: [{ flag: "transferencia", count: 0 }, { flag: "rechamada", count: 0 }] }, "chamadas do colaborador", "INTERACTIONS"),
}

describe("caminho completo: a ferramenta revela algo novo → o planejador pergunta, aprofunda e decide com materialidade", () => {
  it("pico além da visão compacta abre o recorte com fatos de comparabilidade; H1 nasce, é investigada por consulta e resolvida; o recorte é deixado de lado com justificativa — sem causa inventada", async () => {
    const tools = catalogRunner(discoveryTools)
    const fake = fakeEngineModel({
      planner: (payload, round) => {
        if (round === 1) return { calls: [{ tool: "detect_anomalies", args: {}, question: "WHERE" }, { tool: "compare_population", args: { reference: "SUBGROUP" }, question: "CONTEXT" }] }
        if (round === 2) return {
          calls: [{ tool: "inspect_result", args: { ref: "F1", path: "anomalies", offset: 40, limit: 20 }, question: "CALLS:R1" }, { tool: "get_interaction_flags", args: {}, question: "H1" }],
          newQuestions: [{ id: "H1", question: "O dia 14/08 teve transferências ou rechamadas fora do padrão?", why: "Um pico isolado de duração costuma acompanhar transferências; isso mudaria se vale examinar as chamadas." }],
        }
        return { calls: [], stop: { reason: "SUFFICIENT", note: "Grupo comparável no mesmo nível e nenhum sinal no dia.", resolved: [{ question: "H1", evidence: ["F4"] }], declined: [{ question: "CALLS:R1", why: "O dia ficou +100% acima da base, mas só 3 chamadas foram gravadas e nenhuma teve transferência ou rechamada; examiná-las não sustentaria uma causa do mês." }] } }
      },
    })
    const { investigate, memory } = setup({ model: fake.model, tools: tools.runner, subjects: "STABLE" })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)

    // Rodada 1: sem resultado anterior, `inspect_result` nem é oferecida.
    expect(turnOf(fake, 0).tools.map((tool) => tool.tool)).not.toContain("inspect_result")
    // Rodada 2: o planejador recebe o resultado INTEIRO no que cabe (listas por item inteiro, JSON válido) e o que ficou de fora.
    const second = turnOf(fake, 1)
    const f1 = second.lastResults!.find((entry) => entry.ref === "F1")!
    expect(f1).toMatchObject({ tool: "detect_anomalies", outcome: "ok", omitted: [{ path: "anomalies", kind: "ITEMS", shown: 40, total: 60 }] })
    expect((f1.data as { anomalies: unknown[] }).anomalies).toHaveLength(40)
    expect(second.tools.map((tool) => tool.tool)).toContain("inspect_result")
    // O pico (item 51, fora da visão) ainda assim abriu o recorte: o código lê o resultado inteiro. Fatos de comparabilidade no recorte.
    expect(second.slices![0]).toMatchObject({ ref: "R1", label: "dia 14/08", universe: 3 })
    const observation = investigation.slices![0]!.observation
    expect(observation).toMatch(/\(\+100(,0)?%\)/)
    expect(observation).toContain("Chamadas gravadas com transcrição nesse dia: 3")
    // Rodada 3: o detalhe pedido (itens 41–60, com o pico) e a pergunta própria do planejador aberta, como pergunta material.
    const third = turnOf(fake, 2)
    const f3 = third.lastResults!.find((entry) => entry.ref === "F3")!
    expect(f3).toMatchObject({ tool: "inspect_result", outcome: "ok", data: { of: "F1", ofTool: "detect_anomalies", path: "anomalies", page: { status: "COMPLETE", kind: "ITEMS", from: 40, to: 60, total: 60 } } })
    expect(JSON.stringify(f3.data)).toContain(PEAK_DAY)
    expect(third.openQuestions.map((question) => question.id)).toEqual(expect.arrayContaining(["CALLS:R1", "H1"]))
    expect(third.evidence.find((line) => line.startsWith("F4"))).toMatch(/^F4 \[ok\] \(get_interaction_flags · H1\)/)

    // Decisões registradas: H1 resolvida por consulta CONCLUÍDA; recorte deixado de lado COM justificativa (materialidade/comparabilidade).
    expect(investigation.tools!.plannerQuestions).toEqual([expect.objectContaining({ id: "H1", status: "RESOLVED", evidence: ["F4"], accepted: true, round: 2 })])
    expect(investigation.tools!.openQuestions.find((question) => question.id === "CALLS:R1")).toMatchObject({ status: "DECLINED", resolution: { justified: true } })
    expect(investigation.tools!.stopReason).toBe("PLANNER_SUFFICIENT")
    // Nenhuma chamada paga sem necessidade; localizar o dia NÃO virou causa; nota ao leitor só sem justificativa (aqui não há).
    expect(fake.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(0)
    expect(investigation.conclusion).not.toBe("PATTERN_SUPPORTED")
    expect(investigation.evidence.filter((entry) => entry.sliceRef === "R1")).toEqual([expect.objectContaining({ universe: 3, analyzedCalls: 0, patterns: [] })])
    expect(investigation.readerNotes).toEqual([])
    const brief = buildIndicatorBrief(investigation, { documentVersions: new Map(), delivered: new Set(), factualWhenInconclusive: false })
    expect(brief.developments).toEqual([])
    // A pergunta do planejador é registro da investigação (texto do modelo): nunca vira limitação nem fato da mensagem.
    expect(JSON.stringify(brief)).not.toContain("transferências ou rechamadas fora do padrão")
  })

  it("parar sem decidir sobre a própria pergunta, ou 'resolvê-la' com consulta que falhou, nunca vale como resposta", async () => {
    const tools = catalogRunner({ ...discoveryTools, get_interaction_flags: () => { throw new Error("tempo esgotado na leitura das flags") } })
    const fake = fakeEngineModel({
      planner: (_payload, round) => {
        if (round === 1) return { calls: [{ tool: "detect_anomalies", args: {}, question: "WHERE" }], newQuestions: [{ id: "H1", question: "Houve transferências no dia?", why: "Mudaria a leitura do pico." }, { id: "H2", question: "Houve rechamadas?", why: "Idem." }] }
        if (round === 2) return { calls: [{ tool: "get_interaction_flags", args: {}, question: "H1" }] }
        return { calls: [], stop: { reason: "SUFFICIENT", note: "Basta.", resolved: [{ question: "H1", evidence: ["F2"] }], declined: [] } }
      },
    })
    const { investigate, memory } = setup({ model: fake.model, tools: tools.runner, subjects: "STABLE" })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(turnOf(fake, 2).evidence.find((line) => line.startsWith("F2"))).toContain(`[${TOOL_OUTCOME_LABEL.FAILED}]`)
    expect(investigation.tools!.plannerQuestions).toEqual([
      expect.objectContaining({ id: "H1", status: "DECLINED", accepted: false, reason: "a evidência citada não é uma consulta concluída com estado ok" }),
      expect.objectContaining({ id: "H2", status: "DECLINED", accepted: false, reason: "o planejador parou sem decidir sobre esta pergunta" }),
    ])
    const violations = investigation.tools!.planner.proposals.flatMap((proposal) => proposal.violations)
    expect(violations).toEqual(expect.arrayContaining(["RESOLVED_WITHOUT_OK_EVIDENCE:H1", "STOP_WITHOUT_DECISION:H2"]))
  })
})

describe("`inspect_result` no fluxo real: texto longo de uma ferramenta recuperado inteiro, em páginas, sem refazer a consulta nem chamar modelo", () => {
  it("evidência no FINAL de um texto de ~15 mil caracteres: o planejador segue a continuação até o fim; a consulta original roda uma vez", async () => {
    const evidence = "NOTA FINAL: a medição de 14/08 inclui 12 atendimentos transferidos de outra fila."
    const longNote = `${"Registro operacional sem relação com a pergunta. ".repeat(300)}${evidence}`
    const tools = catalogRunner({ ...discoveryTools, validate_data_quality: () => ok({ status: "WARN", note: longNote }) })
    const seenTexts: string[] = []
    const fake = fakeEngineModel({
      planner: (payload, round) => {
        const turn = payload as Turn
        if (round === 1) return { calls: [{ tool: "validate_data_quality", args: {}, question: "DATA_QUALITY" }, { tool: "detect_anomalies", args: {}, question: "WHERE" }] }
        const pages = (turn.lastResults ?? []).filter((entry) => entry.tool === "inspect_result") as unknown as { data: { value: string; page: { continueWith?: { ref: string; path: string; offset: number } } } }[]
        if (pages.length > 0) {
          for (const page of pages) seenTexts.push(page.data.value)
          const next = pages.at(-1)!.data.page.continueWith
          if (next) return { calls: [{ tool: "inspect_result", args: { ...next, limit: 6000 }, question: "DATA_QUALITY" }] }
          return { calls: [], stop: { reason: "SUFFICIENT", note: "Nota lida inteira.", resolved: [], declined: [{ question: "CALLS:R1", why: "Dia afetado por transferências de outra fila, segundo a nota da qualidade de dados." }] } }
        }
        // A visão compacta declarou o texto encurtado: as janelas são exatas, então dá para pedir as páginas seguintes de uma vez.
        const original = (turn.lastResults ?? []).find((entry) => entry.tool === "validate_data_quality")!
        const omitted = original.omitted!.find((part) => part.path === "note" && part.kind === "CHARS")!
        seenTexts.push((original.data as { note: string }).note.slice(0, omitted.shown))
        return { calls: [0, 1, 2].map((index) => ({ tool: "inspect_result", args: { ref: original.ref, path: "note", offset: omitted.shown + index * 6000, limit: 6000 }, question: "DATA_QUALITY" })) }
      },
    })
    const { investigate } = setup({ model: fake.model, tools: tools.runner, subjects: "STABLE" })
    await investigateIndicator({ ...investigate, maxToolCalls: 12 }, request())
    // A consulta original rodou UMA vez; as páginas não consultaram dados de novo; nenhum modelo além do planejador.
    expect(tools.invoked.filter((entry) => entry.tool === "validate_data_quality")).toHaveLength(1)
    expect(new Set(fake.calls.map((call) => call.stage))).toEqual(new Set(["INVESTIGATION_PLANNING"]))
    // O texto recuperado pelas páginas, emendado ao que já veio na visão compacta, é o texto INTEIRO — inclusive a evidência do final.
    expect(seenTexts.join("")).toBe(longNote)
    expect(seenTexts.at(-1)).toContain(evidence)
  })
})

describe("consulta recusada × falha × sem dados: estados distintos, nenhum é resposta; o planejador corrige a recusa", () => {
  it("dimensão não permitida volta como recusa estruturada; a correção roda; a falha e a ausência de dado ficam marcadas", async () => {
    const tools = catalogRunner({
      ...discoveryTools,
      segment_indicator: (call) => ok({ dimension: call.args.dimension, buckets: [], total: { value: 450 } }),
      get_employee_history: () => { throw new Error("histórico indisponível") },
      validate_data_quality: () => ({ ...ok({ issues: [] }), quality: { status: "NO_DATA", sampleCount: 0, coverage: 0, freshness: "UNKNOWN" } }),
    })
    const fake = fakeEngineModel({
      planner: (_payload, round) => {
        if (round === 1) return { calls: [{ tool: "segment_indicator", args: { dimension: "HOUR" }, question: "WHERE" }, { tool: "get_employee_history", args: {}, question: "CONTEXT" }, { tool: "validate_data_quality", args: {}, question: "DATA_QUALITY" }] }
        if (round === 2) return { calls: [{ tool: "segment_indicator", args: { dimension: "SUBJECT" }, question: "WHERE" }] }
        return { calls: [], stop: { reason: "INSUFFICIENT_DATA", note: "Sem dado para localizar.", resolved: [], declined: [] } }
      },
    })
    const { investigate, memory } = setup({ model: fake.model, tools: tools.runner, subjects: "STABLE", strategy: { id: "s", version: 1, config: { segmentation: { enabled: true, dimensions: ["SUBJECT"], minimumSegmentInteractions: 3 }, interactionInvestigation: { enabled: true, maxInteractions: 5, minimumAnalyzed: 3, minimumCoveragePercent: null }, processAssessment: { enabled: true }, allowedBusinessDomainIds: [], peerComparison: { enabled: false, minimumPopulation: 4, minimumContributors: 4, minimumObservedInteractions: 5 }, noDiagnosisBehavior: "FACTUAL_ONLY" } } as never })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    // A recusa nunca consultou dado; volta ao planejador com o código, o argumento e os valores permitidos.
    expect(tools.invoked.filter((entry) => entry.tool === "segment_indicator").map((entry) => entry.args.dimension)).toEqual(["SUBJECT"])
    const second = turnOf(fake, 1)
    expect(second.refused).toEqual([expect.objectContaining({ code: "ARGUMENT_INVALID", argument: "dimension", allowed: ["SUBJECT"] })])
    const evidence = second.evidence.join("\n")
    expect(evidence).toMatch(/F1 \[recusada — não respondeu nada\] \(segment_indicator/)
    expect(evidence).toMatch(/F2 \[falhou — não respondeu nada\] \(get_employee_history/)
    expect(evidence).toMatch(/F3 \[sem dados — não responde a pergunta\] \(validate_data_quality/)
    // A recusa corrigida executou; a investigação termina sem conclusão inventada.
    expect(investigation.tools!.ledger.map((entry) => [entry.ref, entry.tool, toolOutcomeOf(entry)])).toEqual([["F1", "segment_indicator", "REFUSED"], ["F2", "get_employee_history", "FAILED"], ["F3", "validate_data_quality", "NO_DATA"], ["F4", "segment_indicator", "OK"]])
    expect(investigation.conclusion).not.toBe("PATTERN_SUPPORTED")
  })
})

describe("orçamento insuficiente: a investigação para sem fingir conclusão e a redação continua com a sua reserva", () => {
  it("teto de 4 chamadas com reserva de 2 para a redação: o planejamento só usa 2; a pergunta aberta fica aberta (BUDGET), nunca respondida", async () => {
    const meter = new EngineMeter({ maxModelCalls: 4, maxInputTokens: 10_000_000, maxOutputTokens: 10_000_000, maxCostUsd: null, maxDurationMs: 600_000, transientRetries: 1, compositionReserve: { calls: 2, inputTokens: 30_000, outputTokens: 16_384 } })
    const fake = fakeEngineModel({
      planner: (payload, round) => {
        if (round === 1) return { calls: [{ tool: "detect_anomalies", args: {}, question: "WHERE" }] }
        return { calls: [{ tool: "analyze_calls", args: { interactions: payload.slices![0]!.interactions.slice(0, 3), question: "o que houve nas chamadas do dia" }, question: "CALLS:R1" }] }
      },
    })
    const tools = catalogRunner(discoveryTools)
    const { investigate, memory } = setup({ model: meteredModel(fake.model, meter), tools: tools.runner, subjects: "STABLE" })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    // O planejador vê quantas chamadas de IA ainda pode gastar (descontada a reserva da redação).
    expect(turnOf(fake, 0).limits.modelCallsLeft).toBe(2)
    // Gastou 2 (planejamento + planejamento); a análise das chamadas não coube — recusada SEM tocar o modelo.
    expect(fake.calls.map((call) => call.stage)).toEqual(["INVESTIGATION_PLANNING", "INVESTIGATION_PLANNING"])
    expect(meter.summary()).toMatchObject({ calls: 2, exhausted: "maxModelCalls" })
    expect(investigation.completeness).toMatchObject({ status: "INTERRUPTED_BY_BUDGET" })
    expect(investigation.conclusion).not.toBe("PATTERN_SUPPORTED")
    expect(investigation.evidence.filter((entry) => entry.sliceRef === "R1" && entry.analyzedCalls > 0)).toEqual([])
    // O leitor sabe o FATO (o recorte não foi examinado), nunca o funcionamento (orçamento, rodadas).
    expect(investigation.readerNotes).toEqual(["No recorte dia 14/08 o resultado ficou fora do seu padrão, mas as chamadas desse recorte não foram examinadas: este retorno não diz o que aconteceu nelas."])
    // A redação e a sua verificação continuam cabendo (a reserva não foi consumida pela investigação).
    expect(meter.remainingCallsFor("COMPOSITION")).toBe(2)
    expect(meter.fitsAll([{ stage: "COMPOSITION", inputChars: 20_000 }, { stage: "VERIFICATION", inputChars: 24_000 }])).toBe(true)
    expect(meter.fitsAll([{ stage: "COMPOSITION", inputChars: 20_000 }, { stage: "VERIFICATION", inputChars: 24_000 }, { stage: "COMPOSITION", inputChars: 20_000 }])).toBe(false)
  })

  it("o volume medido no dia (denominador) entra como fato de comparabilidade do recorte por dia", async () => {
    const daily = DAILY_WITH_PEAK.map((point) => ({ ...point, volume: point.date === PEAK_DAY ? 41 : 38 }))
    const fake = fakeEngineModel({ planner: () => ({ calls: [], stop: { reason: "SUFFICIENT", note: "Basta.", resolved: [], declined: [{ question: "CALLS:R1", why: "Só 3 de 41 atendimentos do dia foram gravados." }] } }) })
    const { investigate, memory } = setup({ model: fake.model, tools: catalogRunner(discoveryTools).runner, subjects: "STABLE", daily })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    const peak = investigation.slices!.find((slice) => slice.filters.some((filter) => filter.value === PEAK_DAY))!
    expect(peak.observation).toContain("Chamadas gravadas com transcrição nesse dia: 3; volume medido pelo indicador no dia: 41.")
    expect(turnOf(fake, 0).slices!.find((slice) => slice.ref === peak.ref)).toBeDefined()
  })
})

describe("visão dos resultados (`TOOL_RESULT_VIEW_V2`, puro)", () => {
  it("cabe → inteiro; não cabe → listas por item inteiro, JSON válido, partes omitidas declaradas com caminho navegável e tipo", () => {
    const small = { a: 1, list: [1, 2, 3] }
    expect(compactForModel(small, 1_000)).toEqual({ value: small, omitted: [], truncatedText: 0, complete: true })
    const big = { items: Array.from({ length: 100 }, (_, index) => ({ id: index, note: "x".repeat(400) })) }
    const view = compactForModel(big, 6_000)
    expect(view.complete).toBe(false)
    expect(JSON.stringify(view.value).length).toBeLessThanOrEqual(6_000)
    expect(view.omitted[0]).toMatchObject({ path: "items", kind: "ITEMS", total: 100 })
    const shown = (view.value as { items: { id: number; note: string }[] }).items
    expect(shown.map((item) => item.id)).toEqual(Array.from({ length: shown.length }, (_, index) => index))
    expect(shown[0]!.note.endsWith("…")).toBe(true)
    // Cada texto encurtado é declarado com o caminho exato para buscar o resto (antes: só um contador, sem caminho).
    expect(view.omitted).toContainEqual({ path: "items.0.note", kind: "CHARS", shown: 299, total: 400 })
  })
  it("orçamento da rodada repartido com piso (um resultado grande não cala os outros)", () => {
    expect(perResultBudget(1)).toBe(RESULTS_ROUND_BUDGET_CHARS)
    expect(perResultBudget(2)).toBe(RESULTS_ROUND_BUDGET_CHARS / 2)
    expect(perResultBudget(20)).toBe(RESULT_MIN_CHARS)
  })
  it("DEFEITO REPRODUZIDO: texto de 15 mil caracteres com a evidência no FINAL — antes só os primeiros 300 voltavam; agora as páginas o recuperam inteiro, sem lacuna", () => {
    const evidence = "EVIDÊNCIA-FINAL: o cliente disse que o cancelamento ficou pendente desde julho."
    const text = `${"Trecho de contexto da chamada, sem relação com a pergunta. ".repeat(260)}${evidence}`
    expect(text.length).toBeGreaterThan(15_000)
    const result = { summary: "resumo", transcript: text }
    // A visão compacta declara o texto encurtado com o caminho.
    expect(compactForModel(result, 2_000).omitted).toContainEqual({ path: "transcript", kind: "CHARS", shown: 299, total: text.length })
    const pages: string[] = []
    let offset = 0
    for (let guard = 0; guard < 10; guard++) {
      const page = detailOf(result, { path: "transcript", offset, limit: null })
      expect(page.kind).toBe("TEXT")
      expect(page.from).toBe(offset)
      expect((page.value as string).length).toBeLessThanOrEqual(DETAIL_MAX_CHARS)
      pages.push(page.value as string)
      if (page.next === null) {
        expect(page.status).toBe("COMPLETE")
        break
      }
      expect(page.status).toBe("PARTIAL")
      offset = page.next
    }
    expect(pages.join("")).toBe(text)
    expect(pages.at(-1)).toContain(evidence)
    expect(pages.length).toBeGreaterThan(2)
  })
  it("lista cujos itens relevantes estão além da primeira página e cujos itens não cabem todos: a continuação começa no primeiro item NÃO mostrado — nenhum pulado", () => {
    const items = Array.from({ length: 90 }, (_, index) => ({ index, note: index === 77 ? "ITEM RELEVANTE" : "n".repeat(index % 3 === 0 ? 900 : 60) }))
    const result = { pattern: "X", baseline: 410, items }
    const seen: number[] = []
    let offset = 0
    for (let guard = 0; guard < 60; guard++) {
      const page = detailOf(result, { path: "items", offset, limit: 40 })
      expect(JSON.stringify(page.value).length).toBeLessThanOrEqual(DETAIL_MAX_CHARS + 100)
      const shown = (page.value as { index: number }[]).map((item) => item.index)
      // Mostrado = exatamente [from, to): a página diz o que mostrou, mesmo quando a compactação cortou antes do limite pedido.
      expect(shown).toEqual(Array.from({ length: page.to - page.from }, (_, position) => page.from + position))
      seen.push(...shown)
      if (page.next === null) break
      expect(page.next).toBe(page.to)
      offset = page.next
    }
    expect(seen).toEqual(items.map((item) => item.index))
    expect(detailOf(result, { path: "items.77", offset: 0, limit: null }).value).toEqual({ index: 77, note: "ITEM RELEVANTE" })
  })
  it("item maior que a página: vem resumido, e o texto dele continua acessível pelo caminho absoluto declarado", () => {
    const long = "y".repeat(20_000)
    const page = detailOf({ items: [{ id: 1, note: long }] }, { path: "items", offset: 0, limit: 10 })
    expect(page).toMatchObject({ status: "PARTIAL", from: 0, to: 1, total: 1 })
    expect(page.omitted).toContainEqual({ path: "items.0.note", kind: "CHARS", shown: 299, total: 20_000 })
    expect(detailOf({ items: [{ id: 1, note: long }] }, { path: "items.0.note", offset: 6_000, limit: 6_000 })).toMatchObject({ status: "PARTIAL", from: 6_000, next: 12_000 })
  })
  it("estados distintos: campo inexistente, vazio, completo; caminho por chave/índice (com ou sem colchetes)", () => {
    const value = { buckets: Array.from({ length: 50 }, (_, index) => ({ key: `K${index}` })), total: { value: 3 }, empty: [], blank: "" }
    expect(detailOf(value, { path: "buckets", offset: 45, limit: 20 })).toMatchObject({ status: "COMPLETE", total: 50, from: 45, to: 50, next: null, value: [{ key: "K45" }, { key: "K46" }, { key: "K47" }, { key: "K48" }, { key: "K49" }] })
    expect(detailOf(value, { path: "buckets.3", offset: 0, limit: null })).toMatchObject({ status: "COMPLETE", kind: "VALUE", value: { key: "K3" } })
    expect(detailOf(value, { path: "buckets[3]", offset: 0, limit: null })).toMatchObject({ status: "COMPLETE", value: { key: "K3" } })
    expect(detailOf(value, { path: "nada", offset: 0, limit: null })).toMatchObject({ status: "NOT_FOUND", fields: ["buckets", "total", "empty", "blank"] })
    expect(detailOf(value, { path: "empty", offset: 0, limit: null })).toMatchObject({ status: "EMPTY", total: 0 })
    expect(detailOf(value, { path: "blank", offset: 0, limit: null })).toMatchObject({ status: "EMPTY", total: 0 })
  })
  it("estados das consultas: só OK responde", () => {
    const quality = (status: string) => ({ status })
    expect([toolOutcomeOf({ status: "REJECTED", quality: quality("SUFFICIENT") }), toolOutcomeOf({ status: "FAILED", quality: quality("SUFFICIENT") }), toolOutcomeOf({ status: "BUDGET", quality: quality("SUFFICIENT") }), toolOutcomeOf({ status: "OK", quality: quality("NO_DATA") }), toolOutcomeOf({ status: "OK", quality: quality("INSUFFICIENT_SAMPLE") }), toolOutcomeOf({ status: "OK", quality: quality("SUFFICIENT") })]).toEqual(["REFUSED", "FAILED", "NOT_RUN_BUDGET", "NO_DATA", "INSUFFICIENT", "OK"])
  })
})
