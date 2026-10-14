import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { requireDataContract } from "../../src/modules/data-hub/domain/contract-registry.js"
import { normalizeDatabaseValue } from "../../src/modules/data-hub/domain/database/value-normalization.js"
import { mapRecord, suggestMapping, type SourceRecord } from "../../src/modules/data-hub/domain/mapping.js"
import { compareSegments, selectFocusSegments, topReferenceMembers } from "../../src/modules/feedback-engine/domain/indicator-investigation.js"
import { projectTranscript } from "../../src/modules/investigation/domain/transcript-projection.js"
import { transcriptStatusOf } from "../../src/modules/feedback-engine/domain/procedure.js"
import {
  callRows,
  CALLERS,
  closingRows,
  collaboratorPlacement,
  ENGINES,
  exampleTables,
  initSqlPath,
  PROTAGONIST,
  REASON_LABEL,
  REFERENCE_PEERS,
  renderSection,
  SECTION_START,
  SEPTEMBER_TMA,
  type ExampleTable,
} from "./first-feedback-examples.js"

const TIME_ZONE = "America/Sao_Paulo"

/** Linha como o conector de banco a entrega: data/hora sem fuso em ISO local, decimal como texto. */
function asDatabaseRecord(table: ExampleTable, row: Record<string, string | number | null>): SourceRecord {
  return Object.fromEntries(table.columns.map((column) => {
    const value = row[column.name] ?? null
    if (value === null) return [column.name, null]
    if (column.type.kind === "datetime") return [column.name, normalizeDatabaseValue(value, { category: "DATETIME" })]
    if (column.type.kind === "date") return [column.name, normalizeDatabaseValue(value, { category: "DATE" })]
    if (column.type.kind === "decimal") return [column.name, String(value)]
    return [column.name, value]
  }))
}

describe("dados de exemplo para o primeiro feedback (bancos externos de exemplo)", () => {
  it("os quatro init.sql têm exatamente o trecho gerado (rode scripts/data-hub/first-feedback-examples.ts)", () => {
    for (const engine of ENGINES) {
      const text = readFileSync(initSqlPath(engine), "utf8")
      expect(text.split(SECTION_START).length - 1, engine).toBe(1)
      expect(text.includes(`${renderSection(engine)}\n`), engine).toBe(true)
    }
  })

  it("o TMA oficial de setembro é a média, arredondada, das medições diárias do próprio init.sql", () => {
    const text = readFileSync(initSqlPath("SQLSERVER"), "utf8")
    const byPerson = new Map<string, number[]>()
    for (const match of text.matchAll(/\(\d+, '(EX-\d{4})', 'TMA', '2026-09-\d{2}', ([\d.]+),/g)) byPerson.set(match[1]!, [...(byPerson.get(match[1]!) ?? []), Number(match[2])])
    expect(byPerson.size).toBe(28)
    for (const [matricula, values] of byPerson) expect(SEPTEMBER_TMA[matricula], matricula).toBe(Math.round(values.reduce((sum, value) => sum + value, 0) / values.length))
  })

  it("cada tabela nova passa no contrato da Central com o mapeamento que a própria tela sugere", () => {
    for (const table of exampleTables()) {
      const contract = requireDataContract(table.contractKey)
      const records = table.rows.map((row) => asDatabaseRecord(table, row))
      const mapping = suggestMapping(contract, table.columns.map((column) => column.name), records.slice(0, 20))
      const mapped = new Set(mapping.fields.map((field) => field.target))
      for (const field of contract.fields.filter((candidate) => candidate.required)) expect(mapped.has(field.key), `${table.name}: ${field.key} sem coluna sugerida`).toBe(true)
      for (const record of records) expect(mapRecord(contract, mapping, record, { timeZone: TIME_ZONE }).errors, `${table.name}: ${JSON.stringify(record).slice(0, 120)}`).toEqual([])
    }
  })

  it("as colunas grupo e subgrupo de colaboradores são sugeridas para Grupo e Subgrupo no contrato Colaboradores", () => {
    const columns = ["matricula", "nome", "nivel", "cargo", "gestor_matricula", "situacao", "data_admissao", "atualizado_em", "grupo", "subgrupo"]
    const placement = collaboratorPlacement()[2]!
    const sample = { matricula: placement.matricula, nome: "Carla Pereira", nivel: "OPERATOR", cargo: "Analista de Atendimento", gestor_matricula: "EX-0001", situacao: "EM_PRODUCAO", data_admissao: "2024-02-18", atualizado_em: "2026-10-01T08:00:03", grupo: placement.grupo, subgrupo: placement.subgrupo }
    const mapping = suggestMapping(requireDataContract("EMPLOYEES"), columns, [sample])
    expect(mapping.fields.find((field) => field.target === "groupExternalCode")?.source).toBe("grupo")
    expect(mapping.fields.find((field) => field.target === "subgroupExternalCode")?.source).toBe("subgrupo")
  })

  it("chamadas: setembro com transcrição completa (Operador/Cliente), agosto só com duração; sem chamada sobreposta", () => {
    const calls = callRows()
    expect(calls).toHaveLength(CALLERS.length * 24)
    for (const call of calls) {
      expect(call.transcricao !== null, call.id_chamada).toBe(call.inicio.startsWith("2026-09"))
      if (call.transcricao === null) continue
      const projection = projectTranscript(call.transcricao)
      expect(transcriptStatusOf(projection), call.id_chamada).toBe("COMPLETE")
      expect(projection.turns.every((turn) => turn.speaker === "OPERADOR" || turn.speaker === "CLIENTE"), call.id_chamada).toBe(true)
      expect(call.transcricao, call.id_chamada).not.toMatch(/[{}]|\$\(/)
    }
    const days = new Set(calls.map((call) => `${call.matricula}|${call.inicio.slice(0, 10)}`))
    expect(days.size).toBe(calls.length)
  })

  it("a localização do diagnóstico aponta a piora de Contestação de valor da protagonista, e os colegas de referência são os previstos", () => {
    const calls = callRows()
    const average = (list: number[]) => list.reduce((sum, value) => sum + value, 0) / list.length
    const duration = (call: (typeof calls)[number]) => (Date.parse(call.fim.replace(" ", "T")) - Date.parse(call.inicio.replace(" ", "T"))) / 1000
    const sample = (matricula: string, month: string, reason: string) => {
      const list = calls.filter((call) => call.matricula === matricula && call.inicio.startsWith(month) && call.motivo === reason).map(duration)
      return { n: list.length, value: average(list) }
    }
    const inputs = Object.values(REASON_LABEL).map((label) => ({ key: label, label, current: sample(PROTAGONIST, "2026-09", label), previous: sample(PROTAGONIST, "2026-08", label) }))
    const comparison = compareSegments(inputs, "LOWER", "DURATION_SECONDS", 3)
    expect(comparison.overall.direction).toBe("WORSE")
    const closing = closingRows().filter((row) => row.matricula === PROTAGONIST)
    expect(closing.map((row) => [row.competencia, row.valor, row.quartil])).toEqual([["2026-08", 284, "Q1"], ["2026-09", 321, "Q4"]])
    expect(selectFocusSegments(comparison.segments, { withinTarget: false, movement: "WORSENED" }, comparison.overall.direction)).toEqual([{ key: "Contestação de valor", label: "Contestação de valor", reason: "DETERIORATED" }])

    const peers = CALLERS.map((caller) => caller.matricula).filter((matricula) => matricula !== PROTAGONIST)
    const reference = topReferenceMembers(peers.map((personId) => ({ personId, ...sample(personId, "2026-09", "Contestação de valor") })), "LOWER", 3, 4)
    expect(reference.population).toBe(11)
    expect(reference.members.every((member) => REFERENCE_PEERS.includes(member))).toBe(true)
  })

  it("Testar diagnóstico na medição diária de 18/09 da protagonista (7 dias × 28 anteriores) também aponta Contestação de valor", () => {
    const calls = callRows().filter((call) => call.matricula === PROTAGONIST)
    const lastCallDay = calls.filter((call) => call.inicio <= "2026-09-20 23:59:59").map((call) => call.inicio.slice(0, 10)).sort().at(-1)
    expect(lastCallDay).toBe("2026-09-18")
    const duration = (call: (typeof calls)[number]) => (Date.parse(call.fim.replace(" ", "T")) - Date.parse(call.inicio.replace(" ", "T"))) / 1000
    const sample = (from: string, to: string, reason: string) => {
      const list = calls.filter((call) => call.inicio.slice(0, 10) >= from && call.inicio.slice(0, 10) <= to && call.motivo === reason).map(duration)
      return list.length === 0 ? null : { n: list.length, value: list.reduce((sum, value) => sum + value, 0) / list.length }
    }
    const inputs = Object.values(REASON_LABEL).map((label) => ({ key: label, label, current: sample("2026-09-12", "2026-09-18", label), previous: sample("2026-08-15", "2026-09-11", label) }))
    const comparison = compareSegments(inputs, "LOWER", "DURATION_SECONDS", 3)
    expect(selectFocusSegments(comparison.segments, { withinTarget: false, movement: null }, comparison.overall.direction)).toEqual([{ key: "Contestação de valor", label: "Contestação de valor", reason: "DETERIORATED" }])
  })
})
