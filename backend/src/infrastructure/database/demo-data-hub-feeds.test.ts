import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { findDataContract } from "../../modules/data-hub/domain/contract-registry.js"
import { feedMappingSchema, mapRecord, validateMapping } from "../../modules/data-hub/domain/mapping.js"
import { feedConnectorConfigSchema } from "../../modules/data-hub/domain/source-config.js"

/**
 * Os feeds da Central que o seed de demonstração cria (seeds/demo/002_data_hub.sql) precisam ser válidos para o
 * contrato @ versão que declaram — um feed demo quebrado só apareceria na tela, na primeira carga.
 */
const seed = join(dirname(fileURLToPath(import.meta.url)), "../../../seeds/demo/002_data_hub.sql")
const FEED = /'([A-Z_]+)', (\d+),\s*'(\{[^']*\})'::jsonb,\s*'(\{[^']*\})'::jsonb/g

describe("feeds demo da Central de Dados", () => {
  it("cada feed do seed tem conector e mapeamento válidos para o contrato e a versão declarados", async () => {
    const feeds = [...(await readFile(seed, "utf8")).matchAll(FEED)].map((match) => ({ contract: match[1]!, version: Number(match[2]), connector: JSON.parse(match[3]!), mapping: feedMappingSchema.parse(JSON.parse(match[4]!)) }))
    expect(new Set(feeds.map((feed) => feed.contract))).toEqual(new Set(["EMPLOYEES", "INDICATOR_MEASUREMENTS", "INTERACTIONS", "OFFICIAL_INDICATOR_PERFORMANCE"]))
    expect(feeds.find((feed) => feed.contract === "OFFICIAL_INDICATOR_PERFORMANCE")?.version).toBe(2)
    for (const feed of feeds) {
      const contract = findDataContract(feed.contract, feed.version)
      expect(contract, `${feed.contract}@${feed.version}`).toBeDefined()
      expect(feedConnectorConfigSchema.safeParse(feed.connector).success, `${feed.contract}: conector`).toBe(true)
      expect(validateMapping(contract!, feed.mapping), `${feed.contract}@${feed.version}`).toEqual([])
    }
  })

  it("o feed de fechamento (@2) lê a planilha mensal com numerador e denominador em formato brasileiro", async () => {
    const match = [...(await readFile(seed, "utf8")).matchAll(FEED)].find((entry) => entry[1] === "OFFICIAL_INDICATOR_PERFORMANCE")!
    const contract = findDataContract("OFFICIAL_INDICATOR_PERFORMANCE", 2)!
    const mapped = mapRecord(contract, feedMappingSchema.parse(JSON.parse(match[4]!)), { matricula: " OP-10234 ", indicador: "tma", competencia: "08/2026", valor: "468", numerador: "380016", denominador: "812", meta: "480", atingimento: "102,5", peso: "25", quartil: "q2" }, { timeZone: "America/Fortaleza" })
    expect(mapped.errors).toEqual([])
    expect(mapped.record).toMatchObject({ externalEmployeeId: "OP-10234", indicatorCode: "TMA", referencePeriod: "2026-08", value: 468, numerator: 380016, denominator: 812, targetValue: 480, achievementPercent: 102.5, weightPercent: 25, quartile: "Q2" })
  })
})
