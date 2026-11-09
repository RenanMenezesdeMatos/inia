import { afterEach, describe, expect, it, vi } from "vitest"
import type { QueryTableCard } from "../../leadership-analytics/domain/view-models.js"
import { reportAnalysisSchema, reportDefinitionSchema, reportScheduleSchema, reportVisualizationSchema } from "../domain/report-definition.js"
import { createFakeRuntime, createMemoryReportStore, testStructure } from "../testing/memory-report-store.js"
import { analyzeDelivery, retryPendingAnalyses, type AnalysisWriter } from "./report-analysis.js"
import { executeReportRun, type ExecutorDeps } from "./report-executor.js"
import { ABANDONED_ANALYSIS_ERROR, ANALYSIS_CLAIM_SECONDS } from "./report-store.js"

/**
 * POSSE DA ANÁLISE por entrega: dois "processos" (duas rodadas da recuperação, a recuperação × a análise logo depois da execução,
 * dois cliques em "Tentar de novo") sobre o mesmo armazenamento — só quem reivindica chama a IA e só a posse vigente grava.
 */
const ORG = "00000000-0000-4000-8000-0000000000aa"
const START = Date.UTC(2026, 9, 16, 12, 30)

function card(label: string): QueryTableCard {
  return {
    type: "QUERY_TABLE", generatedAt: "2026-10-16T12:00:00.000Z", structure: { subject: { kind: "SUPERVISOR_TEAM", supervisorId: "x" }, label, description: null }, source: "OFFICIAL",
    title: `Pessoas — TMA (${label})`, scopeNote: "Competência oficial: 2026-09", period: "2026-09", indicatorCode: "TMA",
    columns: [{ key: "person", label: "Pessoa", numeric: false }, { key: "value", label: "Valor", numeric: true }],
    rows: [{ cells: { person: "Ana", value: "420 s" }, subject: null, personId: null }], totalRows: 1, highlights: [], methods: [], limitations: [],
  }
}

function gate() {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

/** A IA falsa registra a estrutura de cada chamada (o rótulo vai no JSON da análise). */
function recordingWriter(reply: (structure: string) => Promise<string>) {
  const calls: string[] = []
  const writer: AnalysisWriter = async (input) => {
    const structure = String((JSON.parse(input.user) as { estrutura: string }).estrutura)
    calls.push(structure)
    return reply(structure)
  }
  return { writer, calls }
}

const neverCalled: AnalysisWriter = async () => {
  throw new Error("Não devia chamar a IA.")
}

async function setup(options: { clock?: { at: number } } = {}) {
  const memory = createMemoryReportStore(options.clock ? { now: () => new Date(options.clock!.at) } : {})
  const sara = testStructure("sara", "Equipe da Sara", ["op1", "op2"])
  const fake = createFakeRuntime({ people: [{ accountId: "acc-sara", personId: "p-sara", name: "Sara", role: "SUPERVISOR", active: true, own: sara, reachable: {}, level: "SUPERVISOR" }], card: (label) => card(label) })
  const report = await memory.store.createReport(
    {
      organizationId: ORG, ownerAccountId: "acc-sara", ownerPersonId: "p-sara", name: "TMA da equipe", description: null, status: "ACTIVE", origin: "SCREEN", timeZone: "America/Sao_Paulo", nextRunAt: null, sourceProposalId: null,
      definition: reportDefinitionSchema.parse({ tool: "INDICATOR_QUERY", structure: { mode: "RECIPIENT" }, period: { mode: "LAST_CLOSED" }, indicators: ["TMA"] }),
      visualization: reportVisualizationSchema.parse({ type: "TABLE" }),
      schedule: reportScheduleSchema.parse({ frequency: "DAILY", times: ["08:00"] }),
      audience: { mode: "SELF" },
      analysis: reportAnalysisSchema.parse({ comparison: false }),
    },
    "acc-sara",
  )
  const run = (await memory.store.enqueueRun({ organizationId: ORG, reportId: report.id, scheduledFor: "2026-10-16T11:00:00.000Z", triggerKind: "SCHEDULE", configVersion: 1 }))!
  /** Entregas gravadas sem análise (como depois de uma execução que caiu antes de analisar). */
  const deliveries = async (count: number) => {
    for (let index = 1; index <= count; index += 1) {
      const label = `Equipe ${index}`
      await memory.store.insertDelivery({ organizationId: ORG, reportId: report.id, runId: run.id, configVersion: 1, scopeKey: `escopo-${index}`, kind: "DELIVERY", reason: null, structureLabel: label, periodKey: "2026-09", periodLabel: "Setembro de 2026", sources: [], dataset: card(label), visualization: null, comparison: null, fingerprint: `f${index}`, empty: false, analysisStatus: "PENDING" })
    }
  }
  /** Execução real do report com a análise logo depois de gravar a entrega. */
  const execute = (analyze: NonNullable<ExecutorDeps["analyze"]>) => executeReportRun({ store: memory.store, runtime: fake.runtime, now: () => new Date("2026-10-16T12:00:00Z"), analyze }, run)
  return { memory, report, deliveries, execute }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("análise da IA — posse por entrega", () => {
  it("duas rodadas da recuperação ao mesmo tempo (dois processos): cada entrega chama a IA uma única vez", async () => {
    const { memory, deliveries } = await setup()
    await deliveries(3)
    const ai = recordingWriter(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return "**Resumo** TMA estável."
    })
    const [first, second] = await Promise.all([retryPendingAnalyses(memory.store, ai.writer), retryPendingAnalyses(memory.store, ai.writer)])
    // As duas rodadas trabalharam juntas e dividiram as entregas, sem pegar a mesma.
    expect(first).toBeGreaterThan(0)
    expect(second).toBeGreaterThan(0)
    expect(first + second).toBe(3)
    expect([...ai.calls].sort()).toEqual(["Equipe 1", "Equipe 2", "Equipe 3"])
    expect(memory.deliveries.map((delivery) => [delivery.analysisStatus, delivery.analysisAttempts])).toEqual([["READY", 1], ["READY", 1], ["READY", 1]])
  })

  it("recuperação durante a análise inicial da execução: não chama a IA de novo para a entrega que já está em análise", async () => {
    const { memory, report, execute } = await setup()
    const release = gate()
    const ai = recordingWriter(async () => {
      await release.promise
      return "**Resumo** análise inicial."
    })
    const running = execute((delivery) => analyzeDelivery(memory.store, ai.writer, delivery, report))
    await vi.waitFor(() => expect(ai.calls).toHaveLength(1))
    // A entrega nasce PENDING sem `analysis_updated_at` — antes da posse, a recuperação a pegaria aqui.
    expect(await retryPendingAnalyses(memory.store, neverCalled)).toBe(0)
    release.open()
    expect((await running).status).toBe("COMPLETED")
    expect(ai.calls).toEqual(["Equipe da Sara"])
    expect(memory.deliveries).toHaveLength(1)
    expect(memory.deliveries[0]).toMatchObject({ analysisStatus: "READY", analysisText: "**Resumo** análise inicial.", analysisAttempts: 1 })
  })

  it("recuperação pega a entrega recém-gravada antes da análise inicial: a análise inicial não chama a IA", async () => {
    const { memory, report, execute } = await setup()
    const ai = recordingWriter(async () => "**Resumo** pela recuperação.")
    const result = await execute(async (delivery) => {
      // O worker de recuperação reivindica entre a gravação da entrega e a análise que a execução faz em seguida.
      expect(await retryPendingAnalyses(memory.store, ai.writer)).toBe(1)
      await analyzeDelivery(memory.store, ai.writer, delivery, report)
    })
    expect(result.status).toBe("COMPLETED")
    expect(ai.calls).toEqual(["Equipe da Sara"])
    expect(memory.deliveries[0]).toMatchObject({ analysisStatus: "READY", analysisText: "**Resumo** pela recuperação.", analysisAttempts: 1 })
  })

  it("posse vencida no meio da chamada: o resultado atrasado (falha) não cobre o do processo que assumiu (pronto)", async () => {
    const clock = { at: START }
    const { memory, report, deliveries } = await setup({ clock })
    await deliveries(1)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const release = gate()
    const slow = recordingWriter(async () => {
      await release.promise
      throw new Error("429")
    })
    const late = analyzeDelivery(memory.store, slow.writer, memory.deliveries[0]!, report)
    await vi.waitFor(() => expect(slow.calls).toHaveLength(1))
    // Dentro do prazo, ninguém assume.
    expect(await retryPendingAnalyses(memory.store, neverCalled)).toBe(0)
    clock.at += (ANALYSIS_CLAIM_SECONDS + 1) * 1000
    const fresh = recordingWriter(async () => "**Resumo** pela segunda tentativa.")
    expect(await retryPendingAnalyses(memory.store, fresh.writer)).toBe(1)
    release.open()
    await late
    expect(memory.deliveries[0]).toMatchObject({ analysisStatus: "READY", analysisText: "**Resumo** pela segunda tentativa.", analysisAttempts: 2 })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("report_analysis_superseded"))
  })

  it("'Tentar de novo' em dois cliques (ou por dois destinatários) ao mesmo tempo: uma chamada; durante ela, a entrega fica em análise", async () => {
    const { memory, report, deliveries } = await setup()
    await deliveries(1)
    await analyzeDelivery(memory.store, async () => {
      throw new Error("429")
    }, memory.deliveries[0]!, report)
    expect(memory.deliveries[0]).toMatchObject({ analysisStatus: "FAILED", analysisAttempts: 1 })
    const release = gate()
    const ai = recordingWriter(async () => {
      await release.promise
      return "**Resumo** depois do clique."
    })
    const failed = memory.deliveries[0]!
    const clicks = [analyzeDelivery(memory.store, ai.writer, failed, report, "MANUAL"), analyzeDelivery(memory.store, ai.writer, failed, report, "MANUAL")]
    await vi.waitFor(() => expect(ai.calls).toHaveLength(1))
    expect(memory.deliveries[0]!.analysisStatus).toBe("PENDING")
    // A recuperação automática também não entra (falha recente = espera; em análise = posse de outro).
    expect(await retryPendingAnalyses(memory.store, neverCalled)).toBe(0)
    release.open()
    await Promise.all(clicks)
    expect(ai.calls).toHaveLength(1)
    expect(memory.deliveries[0]).toMatchObject({ analysisStatus: "READY", analysisText: "**Resumo** depois do clique.", analysisAttempts: 2 })
  })

  it("'em análise' abandonada na última tentativa: a recuperação não chama a IA, fecha como falha e o 'Tentar de novo' volta a valer", async () => {
    const clock = { at: START }
    const { memory, report, deliveries } = await setup({ clock })
    await deliveries(1)
    const id = memory.deliveries[0]!.id
    // Três tentativas que caíram no meio (processo encerrado depois de reivindicar, sem gravar o resultado).
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(await memory.store.claimAnalysis(id, "AUTOMATIC")).not.toBeNull()
      clock.at += (ANALYSIS_CLAIM_SECONDS + 1) * 1000
    }
    expect(memory.deliveries[0]).toMatchObject({ analysisStatus: "PENDING", analysisAttempts: 3 })
    expect(await retryPendingAnalyses(memory.store, neverCalled)).toBe(0)
    expect(memory.deliveries[0]).toMatchObject({ analysisStatus: "FAILED", analysisError: ABANDONED_ANALYSIS_ERROR, analysisAttempts: 3 })
    await analyzeDelivery(memory.store, async () => "**Resumo** manual.", memory.deliveries[0]!, report, "MANUAL")
    expect(memory.deliveries[0]).toMatchObject({ analysisStatus: "READY", analysisText: "**Resumo** manual.", analysisAttempts: 4 })
  })

  it("a recuperação para antes da próxima reivindicação quando a rodada perde a trava (sinal abortado)", async () => {
    const { memory, deliveries } = await setup()
    await deliveries(2)
    const controller = new AbortController()
    const ai = recordingWriter(async () => {
      controller.abort()
      return "**Resumo** ok."
    })
    expect(await retryPendingAnalyses(memory.store, ai.writer, { signal: controller.signal })).toBe(1)
    expect(memory.deliveries.map((delivery) => delivery.analysisStatus)).toEqual(["READY", "PENDING"])
  })
})
