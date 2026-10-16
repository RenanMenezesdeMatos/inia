import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { WRITER_CONTRACT_KEYS } from "../application/writers/writer-registry.js"
import { contractOrder, DATA_CONTRACT_KEYS, DATA_CONTRACTS, findDataContract, PREVIOUS_DATA_CONTRACT_VERSIONS, requireDataContract } from "./contract-registry.js"
import { DATA_RECORD_ERROR_CODES, DATA_RUN_ERROR_CODES } from "./error-codes.js"
import { mapRecord } from "./mapping.js"
import { computeFreshness, expectedIntervalMinutes, nextSyncAt } from "./freshness.js"

const MODULE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..")

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : []
  })
}

describe("registro de contratos", () => {
  it("todo contrato tem writer e toda dependência aponta para contrato existente, declarado ANTES na ordem", () => {
    for (const contract of DATA_CONTRACTS) {
      expect(WRITER_CONTRACT_KEYS, `writer de ${contract.key}`).toContain(contract.key)
      for (const dependency of contract.dependencies) {
        expect(DATA_CONTRACT_KEYS, `${contract.key} depende de ${dependency}`).toContain(dependency)
        expect(contractOrder(dependency), `${dependency} precisa vir antes de ${contract.key}`).toBeLessThan(contractOrder(contract.key))
      }
    }
    expect(findDataContract("EMPLOYEES", 1)?.label).toBe("Colaboradores")
    expect(findDataContract("EMPLOYEES", 2)).toBeUndefined()
    expect(() => requireDataContract("NOPE")).toThrow(/não existe/)
  })

  it("versões anteriores continuam resolvíveis para feeds e cargas antigos; sem versão = a atual", () => {
    expect(findDataContract("EMPLOYEE_ABSENCES")?.version).toBe(2)
    expect(findDataContract("EMPLOYEE_ABSENCES", 2)?.fields.map((field) => field.key)).toContain("active")
    expect(findDataContract("EMPLOYEE_ABSENCES", 1)?.fields.map((field) => field.key)).toEqual(["externalEmployeeId", "type", "startDate", "endDate", "sourceUpdatedAt"])
    expect(findDataContract("EMPLOYEE_ABSENCES", 3)).toBeUndefined()
    // INTERACTIONS@2 acrescentou o submotivo (opcional); @1 continua exatamente como era para feeds antigos.
    expect(findDataContract("INTERACTIONS")?.version).toBe(2)
    expect(findDataContract("INTERACTIONS", 2)?.fields.find((field) => field.key === "subReason")).toMatchObject({ label: "Submotivo", type: "STRING", required: false, maxLength: 200 })
    expect(findDataContract("INTERACTIONS", 1)?.fields.map((field) => field.key)).toEqual(["externalInteractionId", "externalEmployeeId", "channel", "reason", "startedAt", "endedAt", "transcriptContent", "transcriptLanguage", "transcriptConfidence"])
    for (const previous of PREVIOUS_DATA_CONTRACT_VERSIONS) {
      const current = requireDataContract(previous.key)
      expect(previous.version, `${previous.key}@${previous.version} precisa ser anterior à atual`).toBeLessThan(current.version)
      expect(current.naturalKey, `${previous.key}: a identidade não muda entre versões`).toEqual(previous.naturalKey)
      // Evolução compatível: todo campo da versão anterior continua na atual com o mesmo tipo (feed antigo remapeado não perde nada).
      for (const field of previous.fields) expect(current.fields.find((entry) => entry.key === field.key)?.type, `${previous.key}.${field.key}`).toBe(field.type)
    }
  })

  it("os exemplos de cada contrato passam pelo próprio contrato (mapping identidade)", () => {
    for (const contract of [...DATA_CONTRACTS, ...PREVIOUS_DATA_CONTRACT_VERSIONS]) {
      const mapping = { fields: contract.fields.map((field) => ({ target: field.key, source: field.key, transforms: [] })) }
      for (const example of contract.examples) {
        const { errors } = mapRecord(contract, mapping, example, { timeZone: "America/Fortaleza" })
        expect(errors, `${contract.key}: ${JSON.stringify(errors)}`).toEqual([])
      }
    }
  })

  it("chave natural e campo identidade existem entre os campos", () => {
    for (const contract of DATA_CONTRACTS) {
      const keys = new Set(contract.fields.map((field) => field.key))
      for (const key of contract.naturalKey) if (key !== "source") expect(keys, `${contract.key}.${key}`).toContain(key)
      expect(contract.fields.filter((field) => field.identity).length, `${contract.key} precisa de exatamente um campo identidade`).toBe(1)
    }
  })

  it("a Central conhece COMPORTAMENTOS, nunca códigos de indicador: nenhum código real no código-fonte do módulo", () => {
    const forbidden = ["TMA", "FCR", "MONITORIA_QUALIDADE", "DIGITAL_RESOLUTION_RATE", "NPS", "TAXA_RETENCAO", "ADERENCIA", "BACKLOG"]
    for (const file of sourceFiles(MODULE_DIR)) {
      const source = readFileSync(file, "utf8")
      // Só o texto FORA de comentários, exemplos de contrato e strings de ajuda conta: extraímos
      // identificadores em posição de código (switch/if/Record) — qualquer `case "TMA"` ou `=== "FCR"` quebra.
      for (const code of forbidden) {
        expect(source, `${file} não pode decidir por código ${code}`).not.toMatch(new RegExp(`(case|===|!==|includes\\()\\s*["'\`]${code}["'\`]`))
      }
    }
  })
})

describe("fechamento oficial — versões", () => {
  it("OFFICIAL_INDICATOR_PERFORMANCE@2 acrescentou numerador e denominador (opcionais); @1 continua exatamente como era", () => {
    expect(findDataContract("OFFICIAL_INDICATOR_PERFORMANCE")?.version).toBe(2)
    expect(findDataContract("OFFICIAL_INDICATOR_PERFORMANCE", 2)?.fields.filter((field) => field.key === "numerator" || field.key === "denominator").map((field) => [field.key, field.type, field.required])).toEqual([["numerator", "DECIMAL", false], ["denominator", "DECIMAL", false]])
    expect(findDataContract("OFFICIAL_INDICATOR_PERFORMANCE", 1)?.fields.map((field) => field.key)).toEqual(["externalEmployeeId", "indicatorCode", "referencePeriod", "value", "targetValue", "achievementPercent", "weightPercent", "quartile", "subgroupExternalCode"])
    expect(findDataContract("OFFICIAL_INDICATOR_PERFORMANCE", 3)).toBeUndefined()
  })
})

describe("Wiki × registro (fonte única)", () => {
  const wikiFile = join(MODULE_DIR, "../../../../frontend/src/components/wiki/data-hub-catalog-data.ts")

  it("o catálogo da Wiki documenta exatamente os contratos do registro e só códigos de erro reais", () => {
    const wiki = readFileSync(wikiFile, "utf8")
    const documented = [...wiki.matchAll(/\{ key: "([A-Z_]+)", label:/g)].map((match) => match[1])
    expect(documented.sort()).toEqual([...DATA_CONTRACT_KEYS].sort())
    for (const contract of DATA_CONTRACTS) {
      for (const dependency of contract.dependencies) {
        const row = wiki.slice(wiki.indexOf(`key: "${contract.key}"`), wiki.indexOf("}", wiki.indexOf(`key: "${contract.key}"`)))
        expect(row, `${contract.key} depende de ${dependency}`).toContain(`"${dependency}"`)
      }
    }
    const knownCodes = new Set([...Object.keys(DATA_RUN_ERROR_CODES), ...Object.keys(DATA_RECORD_ERROR_CODES)])
    for (const match of wiki.matchAll(/\{ code: "(DATA_[A-Z_]+)"/g)) expect(knownCodes.has(match[1]!), `código ${match[1]} não existe`).toBe(true)
  })

  it("a Wiki mostra a versão ATUAL de cada contrato (`version` ausente = 1)", () => {
    const wiki = readFileSync(wikiFile, "utf8")
    for (const contract of DATA_CONTRACTS) {
      const start = wiki.indexOf(`{ key: "${contract.key}", label:`)
      const row = wiki.slice(start, wiki.indexOf("\n", start))
      const version = Number(/ version: (\d+),/.exec(row)?.[1] ?? 1)
      expect(version, `${contract.key}: Wiki @${version}, registro @${contract.version}`).toBe(contract.version)
    }
  })
})

describe("freshness × cadência", () => {
  it("freshness deriva da cadência esperada, nunca da conexão", () => {
    const now = new Date("2026-09-16T15:00:00Z")
    expect(computeFreshness(null, 60, now)).toBe("NEVER")
    expect(computeFreshness(new Date("2026-09-16T14:30:00Z"), 60, now)).toBe("FRESH")
    expect(computeFreshness(new Date("2026-09-16T11:00:00Z"), 60, now)).toBe("STALE")
    expect(computeFreshness(new Date("2026-09-01T11:00:00Z"), null, now)).toBe("FRESH")
  })

  it("próxima sincronização por intervalo e diária no fuso da organização", () => {
    const now = new Date("2026-09-16T15:00:00Z") // 12:00 em Fortaleza
    expect(expectedIntervalMinutes({ kind: "INTERVAL", minutes: 15 })).toBe(15)
    expect(nextSyncAt({ kind: "INTERVAL", minutes: 15 }, now, "America/Fortaleza")?.toISOString()).toBe("2026-09-16T15:15:00.000Z")
    expect(nextSyncAt({ kind: "DAILY", time: "13:00" }, now, "America/Fortaleza")?.toISOString()).toBe("2026-09-16T16:00:00.000Z")
    expect(nextSyncAt({ kind: "DAILY", time: "06:00" }, now, "America/Fortaleza")?.toISOString()).toBe("2026-09-17T09:00:00.000Z")
    expect(nextSyncAt({ kind: "MANUAL" }, now, "America/Fortaleza")).toBeNull()
  })
})
