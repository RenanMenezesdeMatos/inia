import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { FlowGraph } from "../domain/graph-schema.js"
import type { EmployeeRankingConfig, EmployeeSelectionCriterion } from "../domain/graph-schema.js"
import { resolveSelectionCandidates, runEmployeeRanking, runEmployeeSelection, type EmployeeCollectionOutput } from "./select-employees-executor.js"

vi.mock("./hierarchy-subjects.js", () => ({
  resolveStructureAnchorOperatorIds: vi.fn(async () => ["op-1", "op-2", "op-3"]),
}))
vi.mock("./workflow-eligibility.js", () => ({
  resolveEligibleOperatorIds: vi.fn(async () => ["op-1", "op-2"]),
}))

const AVG_CRITERION: EmployeeSelectionCriterion = {
  comparator: "GTE",
  thresholdNumeric: 80,
  historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "QUALIDADE", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 } },
}

/** DB fake: resolve o valor médio de cada candidato a partir do 1º id em `subjectIds` (params[1],
 * ver runHistoricalAggregation em condition-evaluator.ts) — nunca consulta "from interactions"
 * porque `select-employees-executor.ts` já passa `operatorId` resolvido, nunca precisa
 * re-resolver a partir de uma interação (mesma economia que a Condition individual já tem). */
function fakeAverageDb(valueByOperator: Record<string, number | null>): Database {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("group by m.subject_id")) {
        const ids = params?.[1] as string[]
        return {
          rows: ids.flatMap((id) => {
            const value = valueByOperator[id]
            return value === null || value === undefined ? [] : [{ subject_id: id, avg_value: String(value), min_value: String(value), max_value: String(value), sample_count: "1" }]
          }),
          rowCount: 0,
        }
      }
      if (sql.includes("from indicator_measurements")) {
        const operatorId = (params?.[1] as string[])[0]!
        const value = valueByOperator[operatorId]
        if (value === null || value === undefined) return { rows: [{ avg_value: null, min_value: null, max_value: null, sample_count: "0" }], rowCount: 1 }
        return { rows: [{ avg_value: String(value), min_value: String(value), max_value: String(value), sample_count: "1" }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
}

describe("runEmployeeSelection", () => {
  it("TRUE entra na coleção; FALSE e SEM DADOS ficam fora mas são contados separadamente (Parte 8/37 — exemplo: 4 TRUE, 3 FALSE, 3 SEM DADOS)", async () => {
    const candidateIds = ["op-1", "op-2", "op-3", "op-4", "op-5", "op-6", "op-7", "op-8", "op-9", "op-10"]
    const db = fakeAverageDb({
      "op-1": 90,
      "op-2": 85,
      "op-3": 81,
      "op-4": 95, // 4 TRUE
      "op-5": 50,
      "op-6": 60,
      "op-7": 70, // 3 FALSE
      "op-8": null,
      "op-9": null,
      "op-10": null, // 3 SEM DADOS
    })
    const result = await runEmployeeSelection(db, AVG_CRITERION, candidateIds, new Date(), { organizationId: "org-1" })
    expect(result.memberIds).toEqual(["op-1", "op-2", "op-3", "op-4"])
    expect(result.notMatchedCount).toBe(3)
    expect(result.noDataCount).toBe(3)
  })

  it("nunca oferece 'incluir sem dados' — SEM DADOS sempre fica fora da coleção, mesmo quando é a maioria", async () => {
    const db = fakeAverageDb({ "op-1": null, "op-2": null })
    const result = await runEmployeeSelection(db, AVG_CRITERION, ["op-1", "op-2"], new Date(), { organizationId: "org-1" })
    expect(result.memberIds).toEqual([])
    expect(result.noDataCount).toBe(2)
  })

  it("zero candidatos é um resultado legítimo — coleção vazia, sem erro", async () => {
    const db = fakeAverageDb({})
    const result = await runEmployeeSelection(db, AVG_CRITERION, [], new Date(), { organizationId: "org-1" })
    expect(result).toEqual({ memberIds: [], notMatchedCount: 0, noDataCount: 0 })
  })

  it("rejeita um critério sem historicalQuery/performanceQuery — nunca inventa uma avaliação", async () => {
    const db = fakeAverageDb({})
    await expect(runEmployeeSelection(db, { comparator: "GTE", thresholdNumeric: 1 }, ["op-1"], new Date(), { organizationId: "org-1" })).rejects.toThrow(
      "Critério de seleção sem consulta configurada",
    )
  })
})

/** DB fake pro ranking: além de `from indicator_measurements` (MEASUREMENT), também resolve
 * `employee_indicator_performance`/`employee_prv_performance` (Atingimento — via
 * aggregateAchievementHistory em resolve-employee-performance.ts, mesmo padrão de
 * avg/min/max/sample_count) e `desired_direction` (indicator_definitions — Melhores/Piores). */
function fakeRankingDb(options: { valueByOperator?: Record<string, number | null>; directionByCode?: Record<string, "HIGHER" | "LOWER" | "TARGET"> }): Database {
  const { valueByOperator = {}, directionByCode = {} } = options
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("desired_direction from indicator_definitions")) {
        const code = params?.[0] as string
        const direction = directionByCode[code]
        return direction ? { rows: [{ desired_direction: direction }], rowCount: 1 } : { rows: [], rowCount: 0 }
      }
      if (sql.includes("group by m.subject_id")) {
        const ids = params?.[1] as string[]
        return {
          rows: ids.flatMap((id) => {
            const value = valueByOperator[id]
            return value === null || value === undefined ? [] : [{ subject_id: id, avg_value: String(value), min_value: String(value), max_value: String(value), sample_count: "1" }]
          }),
          rowCount: 0,
        }
      }
      if (sql.includes("from indicator_measurements")) {
        const operatorId = (params?.[1] as string[])[0]!
        const value = valueByOperator[operatorId]
        if (value === null || value === undefined) return { rows: [{ avg_value: null, min_value: null, max_value: null, sample_count: "0" }], rowCount: 1 }
        return { rows: [{ avg_value: String(value), min_value: String(value), max_value: String(value), sample_count: "1" }], rowCount: 1 }
      }
      if (sql.includes("employee_indicator_performance") || sql.includes("employee_prv_performance")) {
        const operatorId = (params?.[0] as string[])[0]!
        const value = valueByOperator[operatorId]
        if (value === null || value === undefined) return { rows: [{ avg_value: null, min_value: null, max_value: null, sample_count: "0" }], rowCount: 1 }
        return { rows: [{ avg_value: String(value), min_value: String(value), max_value: String(value), sample_count: "1" }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
}

const QUALIDADE_RANKING: EmployeeRankingConfig = {
  source: "MEASUREMENT",
  indicatorCode: "QUALIDADE",
  aggregation: "AVERAGE",
  period: { kind: "ROLLING_DAYS", days: 90 },
  selection: "LOWEST",
  count: 3,
}

describe("runEmployeeRanking", () => {
  it("Parte 68 — 3 menores valores de Qualidade: Pedro 60, João 70, Lucas 75 (nunca ordem de inserção)", async () => {
    const db = fakeRankingDb({ valueByOperator: { joao: 70, maria: 80, pedro: 60, ana: 90, lucas: 75 } })
    const result = await runEmployeeRanking(db, "org-1", QUALIDADE_RANKING, ["joao", "maria", "pedro", "ana", "lucas"], new Date())
    expect(result.memberIds).toEqual(["pedro", "joao", "lucas"])
    // toMatchObject: além destes campos, cada membro carrega `evidence` (janela/método/amostra
    // da medição operacional) e o balde carrega `calculation` — metadata de QA, nunca a regra.
    expect(result.partitions).toMatchObject([
      {
        id: null,
        name: null,
        evaluatedCount: 5,
        rankedCount: 5,
        noDataCount: 0,
        selectedCount: 3,
        members: [
          { employeeId: "pedro", value: 60, position: 1 },
          { employeeId: "joao", value: 70, position: 2 },
          { employeeId: "lucas", value: 75, position: 3 },
        ],
      },
    ])
    expect(result.rankedCount).toBe(5)
    expect(result.noDataCount).toBe(0)
  })

  it("Parte 69 — 2 maiores valores: Ana 90, Maria 80 — HIGHEST nunca consulta direção (matemático, não de negócio)", async () => {
    const db = fakeRankingDb({ valueByOperator: { joao: 70, maria: 80, pedro: 60, ana: 90, lucas: 75 } })
    const result = await runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, selection: "HIGHEST", count: 2 }, ["joao", "maria", "pedro", "ana", "lucas"], new Date())
    expect(result.memberIds).toEqual(["ana", "maria"])
    expect(result.direction).toBeNull()
  })

  it("Parte 70 — Melhores/Piores NÃO são sinônimo de Maiores/Menores: indicador higher-is-better (3 piores -> 3 menores)", async () => {
    const db = fakeRankingDb({ valueByOperator: { joao: 70, maria: 80, pedro: 60, ana: 90, lucas: 75 }, directionByCode: { QUALIDADE: "HIGHER" } })
    const result = await runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, selection: "WORST" }, ["joao", "maria", "pedro", "ana", "lucas"], new Date())
    expect(result.memberIds).toEqual(["pedro", "joao", "lucas"]) // menores valores = piores, quando maior=melhor
    expect(result.direction).toBe("HIGHER")
  })

  it("Parte 70 — indicador lower-is-better: 3 piores -> 3 MAIORES valores (inverte, prova que 'pior' não é 'menor')", async () => {
    const db = fakeRankingDb({ valueByOperator: { joao: 70, maria: 80, pedro: 60, ana: 90, lucas: 75 }, directionByCode: { QUALIDADE: "LOWER" } })
    const result = await runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, selection: "WORST" }, ["joao", "maria", "pedro", "ana", "lucas"], new Date())
    expect(result.memberIds).toEqual(["ana", "maria", "lucas"]) // maiores valores = piores, quando menor=melhor
    expect(result.direction).toBe("LOWER")
  })

  it("Parte 70 — Melhores com indicador lower-is-better: 2 melhores -> 2 MENORES valores", async () => {
    const db = fakeRankingDb({ valueByOperator: { joao: 70, maria: 80, pedro: 60 }, directionByCode: { QUALIDADE: "LOWER" } })
    const result = await runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, selection: "BEST", count: 2 }, ["joao", "maria", "pedro"], new Date())
    expect(result.memberIds).toEqual(["pedro", "joao"])
  })

  it("Parte 71 — empate: N=2, três pessoas com valor 80 -> exatamente 2 selecionados, desempate por employeeId estável", async () => {
    const db = fakeRankingDb({ valueByOperator: { joao: 80, maria: 80, pedro: 80 } })
    const result = await runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, selection: "HIGHEST", count: 2 }, ["pedro", "joao", "maria"], new Date())
    expect(result.memberIds).toEqual(["joao", "maria"]) // ordem alfabética de employeeId, nunca a ordem de entrada
    expect(result.memberIds).toHaveLength(2)
  })

  it("Parte 72 — sem dados: 5 avaliados, 3 com valor e 2 sem dado, N=5 -> 3 selecionados, noDataCount=2 (nunca erro)", async () => {
    const db = fakeRankingDb({ valueByOperator: { a: 10, b: 20, c: 30, d: null, e: null } })
    const result = await runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, selection: "HIGHEST", count: 5 }, ["a", "b", "c", "d", "e"], new Date())
    expect(result.memberIds).toEqual(["c", "b", "a"])
    expect(result.rankedCount).toBe(3)
    expect(result.noDataCount).toBe(2)
  })

  it("Parte 22 — menos elegíveis do que N pedido: seleciona só os disponíveis, nunca erro nem completa artificialmente", async () => {
    const db = fakeRankingDb({ valueByOperator: { a: 10, b: null, c: null } })
    const result = await runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, selection: "HIGHEST", count: 5 }, ["a", "b", "c"], new Date())
    expect(result.memberIds).toEqual(["a"])
    expect(result.rankedCount).toBe(1)
    expect(result.noDataCount).toBe(2)
  })

  it("Parte 73 — zero candidatos com dados: coleção de ranking vazia, resultado legítimo, sem erro", async () => {
    const db = fakeRankingDb({ valueByOperator: { a: null, b: null } })
    const result = await runEmployeeRanking(db, "org-1", QUALIDADE_RANKING, ["a", "b"], new Date())
    expect(result.memberIds).toEqual([])
    expect(result.rankedCount).toBe(0)
    expect(result.noDataCount).toBe(2)
  })

  it("Parte 77 — aggregation é realmente usada: Média/Mínimo/Máximo do MESMO colaborador produzem rankings diferentes", async () => {
    const db: Database = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (!sql.includes("from indicator_measurements")) return { rows: [], rowCount: 0 }
        // op-1: média baixa mas máximo alto; op-2: o oposto — prova que MINIMUM/MAXIMUM não são só um alias de AVERAGE.
        const table: Record<string, { avg: number; min: number; max: number }> = {
          "op-1": { avg: 50, min: 10, max: 90 },
          "op-2": { avg: 60, min: 55, max: 65 },
        }
        const rowFor = (id: string) => ({ avg_value: String(table[id]!.avg), min_value: String(table[id]!.min), max_value: String(table[id]!.max), sample_count: "3" })
        if (sql.includes("group by m.subject_id")) return { rows: (params?.[1] as string[]).map((id) => ({ subject_id: id, ...rowFor(id) })), rowCount: 0 }
        return { rows: [rowFor((params?.[1] as string[])[0]!)], rowCount: 1 }
      }),
    } as unknown as Database
    const byAverage = await runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, selection: "HIGHEST", aggregation: "AVERAGE", count: 1 }, ["op-1", "op-2"], new Date())
    const byMinimum = await runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, selection: "HIGHEST", aggregation: "MINIMUM", count: 1 }, ["op-1", "op-2"], new Date())
    const byMaximum = await runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, selection: "HIGHEST", aggregation: "MAXIMUM", count: 1 }, ["op-1", "op-2"], new Date())
    expect(byAverage.memberIds).toEqual(["op-2"]) // 60 > 50
    expect(byMinimum.memberIds).toEqual(["op-2"]) // 55 > 10
    expect(byMaximum.memberIds).toEqual(["op-1"]) // 90 > 65
  })

  it("Parte 42/78 — PRV ranking sem indicatorCode é válido; Atingimento (PRV) usa direção HIGHER sempre, nunca consulta indicator_definitions", async () => {
    const db = fakeRankingDb({ valueByOperator: { a: 70, b: 90 } })
    const result = await runEmployeeRanking(db, "org-1", { source: "PRV_ACHIEVEMENT", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 90 }, selection: "WORST", count: 1 }, ["a", "b"], new Date())
    expect(result.memberIds).toEqual(["a"]) // menor atingimento = pior, atingimento sempre maior-é-melhor
    expect(result.direction).toBe("HIGHER")
    expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining("desired_direction"), expect.anything())
  })

  it("Melhores/Piores sem direção oficial (indicador TARGET) — nunca inventa, falha controlada em runtime", async () => {
    const db = fakeRankingDb({ valueByOperator: { a: 70 }, directionByCode: { QUALIDADE: "TARGET" } })
    await expect(runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, selection: "BEST" }, ["a"], new Date())).rejects.toThrow(
      /não está disponível para este indicador/,
    )
  })

  it("Melhores/Piores com indicador inexistente — nunca inventa direção, falha controlada", async () => {
    const db = fakeRankingDb({ valueByOperator: { a: 70 } })
    await expect(runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, selection: "WORST" }, ["a"], new Date())).rejects.toThrow(
      /não está disponível para este indicador/,
    )
  })

  it("defesa em runtime: rejeita configuração de ranking incompleta (aggregation/period/selection/count ausentes)", async () => {
    const db = fakeRankingDb({})
    await expect(runEmployeeRanking(db, "org-1", { source: "MEASUREMENT", indicatorCode: "X" }, ["a"], new Date())).rejects.toThrow(/agregação/)
    await expect(runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, period: undefined }, ["a"], new Date())).rejects.toThrow(/período/)
    await expect(runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, selection: undefined }, ["a"], new Date())).rejects.toThrow(/direção de seleção/)
    await expect(runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, count: undefined }, ["a"], new Date())).rejects.toThrow(/quantidade válida/)
  })
})

/** DB fake com partição: além do valor (via `fakeRankingDb`'s "from indicator_measurements"),
 * resolve `people left join teams/subteams` (resolvePartitionKeys) a partir de um mapa
 * employeeId -> {teamId,teamName}/{subteamId,subteamName}. */
function fakePartitionDb(options: {
  valueByOperator?: Record<string, number | null>
  directionByCode?: Record<string, "HIGHER" | "LOWER" | "TARGET">
  teamByOperator?: Record<string, { id: string; name: string } | null>
  subteamByOperator?: Record<string, { id: string; name: string } | null>
}): Database {
  const { valueByOperator = {}, directionByCode = {}, teamByOperator = {}, subteamByOperator = {} } = options
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("desired_direction from indicator_definitions")) {
        const code = params?.[0] as string
        const direction = directionByCode[code]
        return direction ? { rows: [{ desired_direction: direction }], rowCount: 1 } : { rows: [], rowCount: 0 }
      }
      if (sql.includes("p.team_id \"partitionId\"")) {
        const ids = (params?.[0] as string[]) ?? []
        return { rows: ids.map((id) => ({ id, partitionId: teamByOperator[id]?.id ?? null, partitionName: teamByOperator[id]?.name ?? null })), rowCount: ids.length }
      }
      if (sql.includes("p.subteam_id \"partitionId\"")) {
        const ids = (params?.[0] as string[]) ?? []
        return { rows: ids.map((id) => ({ id, partitionId: subteamByOperator[id]?.id ?? null, partitionName: subteamByOperator[id]?.name ?? null })), rowCount: ids.length }
      }
      if (sql.includes("group by m.subject_id")) {
        const ids = params?.[1] as string[]
        return {
          rows: ids.flatMap((id) => {
            const value = valueByOperator[id]
            return value === null || value === undefined ? [] : [{ subject_id: id, avg_value: String(value), min_value: String(value), max_value: String(value), sample_count: "1" }]
          }),
          rowCount: 0,
        }
      }
      if (sql.includes("from indicator_measurements")) {
        const operatorId = (params?.[1] as string[])[0]!
        const value = valueByOperator[operatorId]
        if (value === null || value === undefined) return { rows: [{ avg_value: null, min_value: null, max_value: null, sample_count: "0" }], rowCount: 1 }
        return { rows: [{ avg_value: String(value), min_value: String(value), max_value: String(value), sample_count: "1" }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
}

describe("runEmployeeRanking — partição por Grupo/Subgrupo (Parte 24-43 do pedido de Evolução/Grupo)", () => {
  it("Parte 78 — VALUE por Grupo: 2 menores por Grupo, ranking independente em cada um", async () => {
    const db = fakePartitionDb({
      valueByOperator: { joao: 70, maria: 80, ana: 90, pedro: 50, lucas: 60, carla: 95 },
      teamByOperator: {
        joao: { id: "team-a", name: "Grupo A" },
        maria: { id: "team-a", name: "Grupo A" },
        ana: { id: "team-a", name: "Grupo A" },
        pedro: { id: "team-b", name: "Grupo B" },
        lucas: { id: "team-b", name: "Grupo B" },
        carla: { id: "team-b", name: "Grupo B" },
      },
    })
    const result = await runEmployeeRanking(
      db,
      "org-1",
      { ...QUALIDADE_RANKING, selection: "LOWEST", count: 2, partitionBy: "TEAM" },
      ["joao", "maria", "ana", "pedro", "lucas", "carla"],
      new Date(),
    )
    expect(result.partitionBy).toBe("TEAM")
    expect(result.partitions).toHaveLength(2)
    expect(result.partitions[0]).toMatchObject({ id: "team-a", name: "Grupo A", members: [{ employeeId: "joao" }, { employeeId: "maria" }] })
    expect(result.partitions[1]).toMatchObject({ id: "team-b", name: "Grupo B", members: [{ employeeId: "pedro" }, { employeeId: "lucas" }] })
    expect(result.memberIds).toEqual(["joao", "maria", "pedro", "lucas"]) // até 2*2=4, nunca 2 no total (Parte 26)
  })

  it("Parte 25/75 — partitionBy ausente equivale a NONE: um balde só, mesmo resultado de antes desta evolução", async () => {
    const db = fakeRankingDb({ valueByOperator: { a: 10, b: 20 } })
    const result = await runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, selection: "HIGHEST", count: 5 }, ["a", "b"], new Date())
    expect(result.partitionBy).toBe("NONE")
    expect(result.partitions).toHaveLength(1)
    expect(result.partitions[0]!.id).toBeNull()
  })

  it("Parte 32 — membro sem Grupo vira o bucket explícito 'Sem grupo', nunca descartado silenciosamente", async () => {
    const db = fakePartitionDb({
      valueByOperator: { joao: 70, maria: 80 },
      teamByOperator: { joao: { id: "team-a", name: "Grupo A" }, maria: null },
    })
    const result = await runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, selection: "HIGHEST", count: 5, partitionBy: "TEAM" }, ["joao", "maria"], new Date())
    expect(result.partitions).toHaveLength(2)
    const semGrupo = result.partitions.find((p) => p.name === "Sem grupo")
    expect(semGrupo).toBeDefined()
    expect(semGrupo!.members.map((m) => m.employeeId)).toEqual(["maria"])
    expect(result.memberIds).toContain("maria") // nunca descartada
  })

  it("Parte 41/90 — menos elegíveis do que N numa partição: seleciona só os disponíveis daquele balde, sem afetar os outros", async () => {
    const db = fakePartitionDb({
      valueByOperator: { a1: 10, a2: 20, a3: 30, a4: 40, a5: 50, a6: 60, a7: 70, a8: 80, a9: 90, a10: 100, b1: 5 },
      teamByOperator: {
        a1: { id: "team-a", name: "Grupo A" }, a2: { id: "team-a", name: "Grupo A" }, a3: { id: "team-a", name: "Grupo A" },
        a4: { id: "team-a", name: "Grupo A" }, a5: { id: "team-a", name: "Grupo A" }, a6: { id: "team-a", name: "Grupo A" },
        a7: { id: "team-a", name: "Grupo A" }, a8: { id: "team-a", name: "Grupo A" }, a9: { id: "team-a", name: "Grupo A" }, a10: { id: "team-a", name: "Grupo A" },
        b1: { id: "team-b", name: "Grupo B" },
      },
    })
    const candidateIds = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10", "b1"]
    const result = await runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, selection: "HIGHEST", count: 3, partitionBy: "TEAM" }, candidateIds, new Date())
    const groupA = result.partitions.find((p) => p.name === "Grupo A")!
    const groupB = result.partitions.find((p) => p.name === "Grupo B")!
    expect(groupA.selectedCount).toBe(3)
    expect(groupB.selectedCount).toBe(1) // só 1 disponível, nunca erro
  })

  it("Parte 42/91 — partição sem nenhum dado: 0 selecionados naquele balde, não é erro, contado corretamente", async () => {
    const db = fakePartitionDb({
      valueByOperator: { joao: 70 },
      subteamByOperator: {
        joao: { id: "sub-a", name: "Subgrupo A" },
        maria: { id: "sub-c", name: "Subgrupo C" },
        pedro: { id: "sub-c", name: "Subgrupo C" },
      },
    })
    const result = await runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, selection: "HIGHEST", count: 2, partitionBy: "SUBTEAM" }, ["joao", "maria", "pedro"], new Date())
    const subC = result.partitions.find((p) => p.name === "Subgrupo C")!
    expect(subC.evaluatedCount).toBe(2)
    expect(subC.rankedCount).toBe(0)
    expect(subC.noDataCount).toBe(2)
    expect(subC.selectedCount).toBe(0)
  })

  it("Parte 43 — população vazia: coleção de ranking vazia, sem erro, mesmo com partição ligada", async () => {
    const db = fakePartitionDb({})
    const result = await runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, selection: "HIGHEST", partitionBy: "TEAM" }, [], new Date())
    expect(result.partitions).toEqual([])
    expect(result.memberIds).toEqual([])
  })

  it("Parte 94/40 — empate dentro de uma partição: corte estrito por balde, desempate estável por employeeId", async () => {
    const db = fakePartitionDb({
      valueByOperator: { joao: 80, maria: 80, pedro: 80 },
      teamByOperator: { joao: { id: "team-a", name: "Grupo A" }, maria: { id: "team-a", name: "Grupo A" }, pedro: { id: "team-a", name: "Grupo A" } },
    })
    const result = await runEmployeeRanking(db, "org-1", { ...QUALIDADE_RANKING, selection: "HIGHEST", count: 2, partitionBy: "TEAM" }, ["pedro", "joao", "maria"], new Date())
    expect(result.partitions[0]!.members.map((m) => m.employeeId)).toEqual(["joao", "maria"])
  })
})

/** DB fake pra CHANGE: `resolveHistoricalResult` com compareTo PREVIOUS_PERIOD chama
 * `runHistoricalAggregation` DUAS vezes por candidato (janela atual, depois anterior) — o fim da
 * janela atual é sempre `now` (ROLLING_DAYS), o da anterior é `now - days`, então dá pra
 * distinguir pelo params[3] (window.end) sem precisar rastrear ordem de chamada. */
function fakeChangeDb(options: {
  now: Date
  valuesByOperator: Record<string, { current: number | null; previous: number | null }>
  directionByCode?: Record<string, "HIGHER" | "LOWER" | "TARGET">
}): Database {
  const { now, valuesByOperator, directionByCode = {} } = options
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("desired_direction from indicator_definitions")) {
        const code = params?.[0] as string
        const direction = directionByCode[code]
        return direction ? { rows: [{ desired_direction: direction }], rowCount: 1 } : { rows: [], rowCount: 0 }
      }
      if (sql.includes("from indicator_measurements")) {
        const endIso = params?.[3] as string
        const isCurrent = endIso === now.toISOString()
        const valueOf = (operatorId: string) => {
          const entry = valuesByOperator[operatorId]
          return entry ? (isCurrent ? entry.current : entry.previous) : null
        }
        if (sql.includes("group by m.subject_id")) {
          const ids = params?.[1] as string[]
          return {
            rows: ids.flatMap((id) => {
              const value = valueOf(id)
              return value === null || value === undefined ? [] : [{ subject_id: id, avg_value: String(value), min_value: String(value), max_value: String(value), sample_count: "1" }]
            }),
            rowCount: 0,
          }
        }
        const value = valueOf((params?.[1] as string[])[0]!)
        if (value === null || value === undefined) return { rows: [{ avg_value: null, min_value: null, max_value: null, sample_count: "0" }], rowCount: 1 }
        return { rows: [{ avg_value: String(value), min_value: String(value), max_value: String(value), sample_count: "1" }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
}

const NOW = new Date("2026-01-31T00:00:00.000Z")
const CHANGE_RANKING: EmployeeRankingConfig = {
  source: "MEASUREMENT",
  indicatorCode: "QUALIDADE",
  aggregation: "AVERAGE",
  period: { kind: "ROLLING_DAYS", days: 30 },
  rankingBasis: "CHANGE",
  selection: "DECLINED",
  count: 2,
}

describe("runEmployeeRanking — ranking por Evolução/Queda (CHANGE, Parte 1-23 da evolução de Ranking)", () => {
  it("Parte 80 — indicador HIGHER: João 100->80 (queda 20%), Maria 80->88 (evolução 10%) — 'maiores quedas' -> só João", async () => {
    const db = fakeChangeDb({ now: NOW, valuesByOperator: { joao: { previous: 100, current: 80 }, maria: { previous: 80, current: 88 } }, directionByCode: { QUALIDADE: "HIGHER" } })
    const result = await runEmployeeRanking(db, "org-1", CHANGE_RANKING, ["joao", "maria"], NOW)
    expect(result.memberIds).toEqual(["joao"])
    expect(result.partitions[0]!.members).toMatchObject([{ employeeId: "joao", previousValue: 100, currentValue: 80, change: -20, performanceChange: -20, position: 1 }])
  })

  it("Parte 13 — 'maiores evoluções' no mesmo cenário HIGHER -> só Maria", async () => {
    const db = fakeChangeDb({ now: NOW, valuesByOperator: { joao: { previous: 100, current: 80 }, maria: { previous: 80, current: 88 } }, directionByCode: { QUALIDADE: "HIGHER" } })
    const result = await runEmployeeRanking(db, "org-1", { ...CHANGE_RANKING, selection: "IMPROVED" }, ["joao", "maria"], NOW)
    expect(result.memberIds).toEqual(["maria"])
    expect(result.partitions[0]!.members[0]).toMatchObject({ performanceChange: 10 })
  })

  it("Parte 81 — indicador LOWER: João 600->400 (matematicamente -33%, mas é EVOLUÇÃO — número caiu e menor é melhor); Maria 400->600 é QUEDA", async () => {
    const db = fakeChangeDb({ now: NOW, valuesByOperator: { joao: { previous: 600, current: 400 }, maria: { previous: 400, current: 600 } }, directionByCode: { TMA: "LOWER" } })
    const declines = await runEmployeeRanking(db, "org-1", { ...CHANGE_RANKING, indicatorCode: "TMA", selection: "DECLINED" }, ["joao", "maria"], NOW)
    expect(declines.memberIds).toEqual(["maria"])
    const improvements = await runEmployeeRanking(db, "org-1", { ...CHANGE_RANKING, indicatorCode: "TMA", selection: "IMPROVED" }, ["joao", "maria"], NOW)
    expect(improvements.memberIds).toEqual(["joao"])
    expect(improvements.partitions[0]!.members[0]).toMatchObject({ change: expect.closeTo(-33.33, 1), performanceChange: expect.closeTo(33.33, 1) })
  })

  it("Parte 82 — indicador TARGET: Evolução/Queda não está disponível, falha controlada em runtime (publish também bloqueia, ver workflow-router.test.ts)", async () => {
    const db = fakeChangeDb({ now: NOW, valuesByOperator: { joao: { previous: 100, current: 80 } }, directionByCode: { QUALIDADE: "TARGET" } })
    await expect(runEmployeeRanking(db, "org-1", CHANGE_RANKING, ["joao"], NOW)).rejects.toThrow(/Evolução.*Queda.*não está disponível/)
  })

  it("Parte 83 — todos pioraram, pedido 'maiores evoluções' -> Collection vazia, NUNCA seleciona 'quem piorou menos'", async () => {
    const db = fakeChangeDb({
      now: NOW,
      valuesByOperator: { joao: { previous: 100, current: 80 }, maria: { previous: 100, current: 90 }, pedro: { previous: 100, current: 95 } },
      directionByCode: { QUALIDADE: "HIGHER" },
    })
    const result = await runEmployeeRanking(db, "org-1", { ...CHANGE_RANKING, selection: "IMPROVED", count: 3 }, ["joao", "maria", "pedro"], NOW)
    expect(result.memberIds).toEqual([])
    expect(result.partitions[0]!.rankedCount).toBe(3) // tinham dado, só não entraram na seleção
  })

  it("Parte 84 — todos melhoraram, pedido 'maiores quedas' -> Collection vazia, NUNCA seleciona 'quem melhorou menos'", async () => {
    const db = fakeChangeDb({
      now: NOW,
      valuesByOperator: { joao: { previous: 80, current: 100 }, maria: { previous: 80, current: 90 } },
      directionByCode: { QUALIDADE: "HIGHER" },
    })
    const result = await runEmployeeRanking(db, "org-1", { ...CHANGE_RANKING, selection: "DECLINED", count: 3 }, ["joao", "maria"], NOW)
    expect(result.memberIds).toEqual([])
  })

  it("Parte 85 — variação exatamente 0%: não conta como evolução nem como queda", async () => {
    const db = fakeChangeDb({ now: NOW, valuesByOperator: { joao: { previous: 80, current: 80 } }, directionByCode: { QUALIDADE: "HIGHER" } })
    const improved = await runEmployeeRanking(db, "org-1", { ...CHANGE_RANKING, selection: "IMPROVED", count: 3 }, ["joao"], NOW)
    const declined = await runEmployeeRanking(db, "org-1", { ...CHANGE_RANKING, selection: "DECLINED", count: 3 }, ["joao"], NOW)
    expect(improved.memberIds).toEqual([])
    expect(declined.memberIds).toEqual([])
    expect(improved.partitions[0]!.rankedCount).toBe(1) // tem dado, só não é nem evolução nem queda
  })

  it("Parte 22/86 — período anterior = 0: SEM DADOS, mesma política da Condition (nunca divide por zero)", async () => {
    const db = fakeChangeDb({ now: NOW, valuesByOperator: { joao: { previous: 0, current: 50 } }, directionByCode: { QUALIDADE: "HIGHER" } })
    const result = await runEmployeeRanking(db, "org-1", { ...CHANGE_RANKING, selection: "IMPROVED", count: 3 }, ["joao"], NOW)
    expect(result.partitions[0]!.noDataCount).toBe(1)
    expect(result.partitions[0]!.rankedCount).toBe(0)
  })

  it("Parte 21/87 — valor atual ausente: SEM DADOS PARA EVOLUÇÃO, nunca entra no ranking", async () => {
    const db = fakeChangeDb({ now: NOW, valuesByOperator: { joao: { previous: 80, current: null } }, directionByCode: { QUALIDADE: "HIGHER" } })
    const result = await runEmployeeRanking(db, "org-1", { ...CHANGE_RANKING, selection: "DECLINED", count: 3 }, ["joao"], NOW)
    expect(result.partitions[0]!.noDataCount).toBe(1)
  })

  it("Parte 21/88 — valor anterior ausente: SEM DADOS PARA EVOLUÇÃO, nunca entra no ranking", async () => {
    const db = fakeChangeDb({ now: NOW, valuesByOperator: { joao: { previous: null, current: 80 } }, directionByCode: { QUALIDADE: "HIGHER" } })
    const result = await runEmployeeRanking(db, "org-1", { ...CHANGE_RANKING, selection: "DECLINED", count: 3 }, ["joao"], NOW)
    expect(result.partitions[0]!.noDataCount).toBe(1)
  })

  it("Parte 7 — CHANGE com período 'Últimos N fechamentos' (CLOSURES): rejeita em runtime, nunca finge suportar", async () => {
    const db = fakeChangeDb({ now: NOW, valuesByOperator: {} })
    await expect(
      runEmployeeRanking(db, "org-1", { ...CHANGE_RANKING, period: { kind: "CLOSURES", unit: "MONTH", count: 3 } }, ["joao"], NOW),
    ).rejects.toThrow(/Últimos N fechamentos/)
  })
})

describe("resolveSelectionCandidates", () => {
  const graph: FlowGraph = {
    nodes: [
      { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
      { id: "select-1", type: "select_employees", label: "Selecionar Q4", position: { x: 0, y: 0 }, config: {} },
      { id: "select-2", type: "select_employees", label: "Selecionar PRV baixo", position: { x: 0, y: 0 }, config: {} },
      { id: "end", type: "end", label: "Fim", position: { x: 0, y: 0 }, config: {} },
    ],
    edges: [
      { id: "e1", source: "trigger", sourceHandle: "always", target: "select-1" },
      { id: "e2", source: "select-1", sourceHandle: "always", target: "select-2" },
      { id: "e3", source: "select-2", sourceHandle: "always", target: "end" },
    ],
  }
  const structure = { kind: "TEAM", teamId: "team-1" } as never
  const population = { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, populationFilter: null }

  it("primeira seleção (sem coleção anterior): Estrutura ∩ Abrangência/Filtro populacional — nunca uma 4ª interpretação de população", async () => {
    const db = {} as Database
    const result = await resolveSelectionCandidates(db, graph, "select-1", "org-1", structure, population, null, {})
    // resolveStructureAnchorOperatorIds -> [op-1,op-2,op-3]; resolveEligibleOperatorIds -> [op-1,op-2] -> interseção [op-1,op-2]
    expect(result).toEqual({ candidateIds: ["op-1", "op-2"], sourceKind: "STRUCTURE", sourceNodeId: null })
  })

  it("refinamento (COLLECTION -> COLLECTION): lê só node_outputs da coleção anterior, NUNCA reconsulta estrutura/elegibilidade — prova que não reexpande", async () => {
    const { resolveStructureAnchorOperatorIds } = await import("./hierarchy-subjects.js")
    const { resolveEligibleOperatorIds } = await import("./workflow-eligibility.js")
    vi.mocked(resolveStructureAnchorOperatorIds).mockClear()
    vi.mocked(resolveEligibleOperatorIds).mockClear()

    const previousCollection: EmployeeCollectionOutput = {
      kind: "EMPLOYEE_COLLECTION",
      mode: "CONDITION",
      memberIds: ["op-1", "op-2"],
      evaluatedCount: 10,
      selectedCount: 2,
      notMatchedCount: 5,
      noDataCount: 3,
      sourceKind: "STRUCTURE",
      sourceNodeId: null,
      criterion: AVG_CRITERION,
      selectedAt: new Date().toISOString(),
    }
    const db = {} as Database
    const result = await resolveSelectionCandidates(db, graph, "select-2", "org-1", structure, population, null, { "select-1": previousCollection })
    expect(result).toEqual({ candidateIds: ["op-1", "op-2"], sourceKind: "EMPLOYEE_COLLECTION", sourceNodeId: "select-1" })
    expect(resolveStructureAnchorOperatorIds).not.toHaveBeenCalled()
    expect(resolveEligibleOperatorIds).not.toHaveBeenCalled()
  })

  it("coleção anterior vazia (0 selecionados) propaga candidatos vazios pro refinamento seguinte, sem erro", async () => {
    const emptyCollection: EmployeeCollectionOutput = {
      kind: "EMPLOYEE_COLLECTION",
      mode: "CONDITION",
      memberIds: [],
      evaluatedCount: 20,
      selectedCount: 0,
      notMatchedCount: 15,
      noDataCount: 5,
      sourceKind: "STRUCTURE",
      sourceNodeId: null,
      criterion: AVG_CRITERION,
      selectedAt: new Date().toISOString(),
    }
    const db = {} as Database
    const result = await resolveSelectionCandidates(db, graph, "select-2", "org-1", structure, population, null, { "select-1": emptyCollection })
    expect(result.candidateIds).toEqual([])
  })
})
