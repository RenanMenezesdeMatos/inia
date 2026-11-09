import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createIndicatorDefinition, deleteIndicatorDefinition, updateIndicatorDefinition } from "./indicator-definition-service.js"

const ORG = "00000000-0000-4000-8000-000000000001"

type Row = { id: string; code: string; name: string; unit: string; desiredDirection: string; dailySupported: boolean; operationalAggregation: string; minimumSampleSize: number | null; minimumCoverage: number | null; officialClosureSupported: boolean; active: boolean }

const TMA: Row = { id: "ind-tma", code: "TMA", name: "Tempo Médio de Atendimento", unit: "SECONDS", desiredDirection: "LOWER", dailySupported: true, operationalAggregation: "WEIGHTED_AVERAGE", minimumSampleSize: null, minimumCoverage: null, officialClosureSupported: true, active: true }

/** Fake do catálogo: uma definição, contagens de histórico configuráveis, Workflows que referenciam o código. */
function fakeDb(row: Row, history: { measurements?: number; goals?: number; closures?: number; workflows?: string[] } = {}) {
  const writes: { sql: string; params: unknown[] }[] = []
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("from indicator_definitions where id = $1")) return { rows: params[0] === row.id ? [row] : [], rowCount: 1 }
    if (sql.includes("(select count(*) from indicator_measurements")) {
      return { rows: [{ measurements: String(history.measurements ?? 0), goals: String(history.goals ?? 0), official_closures: String(history.closures ?? 0) }], rowCount: 1 }
    }
    if (sql.includes("jsonb_path_exists")) return { rows: (history.workflows ?? []).map((name, index) => ({ id: `wf-${index}`, name })), rowCount: 0 }
    if (sql.trim().startsWith("insert into indicator_definitions") || sql.trim().startsWith("update indicator_definitions")) {
      writes.push({ sql, params })
      return { rows: [{ ...row, code: params[0] as string, name: params[1], unit: params[2], desiredDirection: params[3], dailySupported: params[4], operationalAggregation: params[5], minimumSampleSize: params[6], minimumCoverage: params[7], officialClosureSupported: params[8], active: params[9] }].map((r) => (sql.trim().startsWith("insert") ? { ...r, code: params[1] as string, name: params[2], unit: params[3], desiredDirection: params[4], dailySupported: params[5], operationalAggregation: params[6], minimumSampleSize: params[7], minimumCoverage: params[8], officialClosureSupported: params[9], active: params[10] } : r)), rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  })
  const client = { query, release: vi.fn() }
  return { db: { query, connect: async () => client } as unknown as Database, writes, client }
}

describe("serviço de definição de indicador — mesmo contrato do produto (rota admin e provas arquiteturais)", () => {
  it("cria um indicador novo pelo contrato genérico: código normalizado, metadata operacional persistida — nenhum código do catálogo aparece no serviço", async () => {
    const { db, writes } = fakeDb(TMA)
    const created = await createIndicatorDefinition(db, ORG, { code: "test_dynamic_rate", name: "Taxa Dinâmica de Teste", unit: "PERCENT", desiredDirection: "HIGHER", dailySupported: true, operationalAggregation: "RATE" })
    expect(created.code).toBe("TEST_DYNAMIC_RATE")
    expect(writes[0]!.params.slice(1, 11)).toEqual(["TEST_DYNAMIC_RATE", "Taxa Dinâmica de Teste", "PERCENT", "HIGHER", true, "RATE", null, null, true, true])
  })

  it("rejeita configuração semanticamente inválida antes de tocar o banco (RATE em SECONDS)", async () => {
    const { db, writes } = fakeDb(TMA)
    await expect(createIndicatorDefinition(db, ORG, { code: "X_RATE", name: "Taxa X", unit: "SECONDS", desiredDirection: "LOWER", dailySupported: true, operationalAggregation: "RATE" })).rejects.toMatchObject({ code: "INDICATOR_INVALID_CONFIGURATION" })
    expect(writes).toHaveLength(0)
  })

  it("alterações SEGURAS (nome, amostra/cobertura padrão, status) passam mesmo com histórico", async () => {
    const { db, writes } = fakeDb(TMA, { measurements: 217_031, goals: 19, closures: 10_261, workflows: ["Modelo · 01"] })
    const { definition } = await updateIndicatorDefinition(db, ORG, TMA.id, { name: "TMA (voz)", minimumSampleSize: 20, minimumCoverage: 0.6, active: false })
    expect(definition).toMatchObject({ name: "TMA (voz)", minimumSampleSize: 20, minimumCoverage: 0.6, active: false, unit: "SECONDS" })
    expect(writes).toHaveLength(1)
  })

  it("alteração SEMÂNTICA com histórico é bloqueada com o motivo (unidade, direção, estratégia, código)", async () => {
    const { db, writes } = fakeDb(TMA, { measurements: 12, workflows: ["Modelo · 01", "Modelo · 02"] })
    for (const patch of [{ unit: "COUNT" }, { desiredDirection: "HIGHER" }, { operationalAggregation: "LATEST" }, { code: "TMA_V2" }]) {
      await expect(updateIndicatorDefinition(db, ORG, TMA.id, patch)).rejects.toMatchObject({ code: "INDICATOR_SEMANTIC_LOCKED", statusCode: 409 })
    }
    await expect(updateIndicatorDefinition(db, ORG, TMA.id, { unit: "COUNT" })).rejects.toThrow(/12 medições; 2 Workflow\(s\): Modelo · 01, Modelo · 02/)
    expect(writes).toHaveLength(0)
  })

  it("a mensagem aponta o caminho certo: correção controlada para unidade, direção e estratégia; indicador novo para código e medição operacional", async () => {
    const { db } = fakeDb(TMA, { measurements: 12 })
    for (const patch of [{ unit: "COUNT" }, { desiredDirection: "HIGHER" }, { operationalAggregation: "LATEST" }]) {
      await expect(updateIndicatorDefinition(db, ORG, TMA.id, patch)).rejects.toThrow(/Use "Corrigir unidade, direção ou cálculo"/)
    }
    await expect(updateIndicatorDefinition(db, ORG, TMA.id, { code: "TMA_V2" })).rejects.toThrow(/crie um novo indicador/)
    await expect(updateIndicatorDefinition(db, ORG, TMA.id, { dailySupported: false })).rejects.toThrow(/crie um novo indicador/)
    await expect(updateIndicatorDefinition(db, ORG, TMA.id, { code: "TMA_V2", unit: "COUNT" })).rejects.toThrow(/crie um novo indicador/)
  })

  it("desligar a medição operacional com histórico também é bloqueado; ligar é sempre seguro", async () => {
    const locked = fakeDb(TMA, { measurements: 1 })
    await expect(updateIndicatorDefinition(locked.db, ORG, TMA.id, { dailySupported: false })).rejects.toMatchObject({ code: "INDICATOR_SEMANTIC_LOCKED" })
    const notOperational = fakeDb({ ...TMA, dailySupported: false, operationalAggregation: "AVERAGE" }, { measurements: 500 })
    const { definition } = await updateIndicatorDefinition(notOperational.db, ORG, TMA.id, { dailySupported: true })
    expect(definition.dailySupported).toBe(true)
  })

  it("sem histórico, a mudança semântica é livre (o catálogo ainda não foi usado)", async () => {
    const { db } = fakeDb(TMA)
    const { definition } = await updateIndicatorDefinition(db, ORG, TMA.id, { operationalAggregation: "LATEST", unit: "COUNT", desiredDirection: "HIGHER" })
    expect(definition).toMatchObject({ operationalAggregation: "LATEST", unit: "COUNT", desiredDirection: "HIGHER" })
  })

  it("exclusão: histórico não barra, porque nada é apagado; o que barra é o uso de agora", async () => {
    const withHistory = fakeDb(TMA, { goals: 3 })
    await expect(deleteIndicatorDefinition(withHistory.db, ORG, TMA.id)).resolves.toMatchObject({ hasHistory: true, goals: 3 })
    const cited = fakeDb(TMA, { workflows: ["Modelo · 01"] })
    await expect(deleteIndicatorDefinition(cited.db, ORG, TMA.id)).rejects.toMatchObject({ code: "INDICATOR_HAS_DEPENDENTS", statusCode: 409 })
    const clean = fakeDb(TMA)
    await expect(deleteIndicatorDefinition(clean.db, ORG, TMA.id)).resolves.toMatchObject({ hasHistory: false })
    expect(clean.client.query).toHaveBeenCalledWith("commit")
    await expect(deleteIndicatorDefinition(clean.db, ORG, "missing")).resolves.toBeNull()
  })
})
