import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { competencyActivitySchema } from "../domain/competency.js"
import { interventionTypeDefinitionSchema, validateInterventionType, type InterventionTypeDefinition } from "../domain/intervention-type.js"
import { policyDefinitionSchema, validatePolicyDefinition } from "../domain/policy-definition.js"

/**
 * Os exemplos de negócio (tipos e políticas) vivem SÓ no seed de demonstração. Este teste garante que eles continuam válidos
 * pelas mesmas regras da tela: um tipo passa pela validação de publicação e a política em rascunho publicaria sem pendências
 * assim que os tipos estivessem publicados — nenhum exemplo depende de uma regra que o produto recusaria.
 */
const seedPath = join(dirname(fileURLToPath(import.meta.url)), "../../../../seeds/demo/003_intervention_examples.sql")

async function seedJsonBlocks(): Promise<unknown[]> {
  const sql = await readFile(seedPath, "utf8")
  return [...sql.matchAll(/\$j\$([\s\S]*?)\$j\$/g)].map((match) => JSON.parse(match[1]!))
}

async function seedTypes(): Promise<Map<string, InterventionTypeDefinition>> {
  const sql = await readFile(seedPath, "utf8")
  const entries = [...sql.matchAll(/\('de00a1e1-[0-9a-f-]+', '([A-Z_]+)', \$j\$([\s\S]*?)\$j\$\)/g)]
  return new Map(entries.map((match) => [match[1]!, interventionTypeDefinitionSchema.parse(JSON.parse(match[2]!))]))
}

describe("seed de demonstração — exemplos de políticas de acompanhamento", () => {
  it("todo bloco JSON do seed segue o contrato (tipo, política ou atividades de competência)", async () => {
    const blocks = await seedJsonBlocks()
    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) {
      if (Array.isArray(block)) block.forEach((activity) => competencyActivitySchema.parse(activity))
      else if ((block as { schemaVersion?: string }).schemaVersion === "INTERVENTION_TYPE_V1") interventionTypeDefinitionSchema.parse(block)
      else policyDefinitionSchema.parse(block)
    }
  })

  it("os tipos de exemplo publicam sem pendências (inclusive as regras fixas da avaliação de continuidade)", async () => {
    const types = await seedTypes()
    expect(types.size).toBe(8)
    const keys = new Set(types.keys())
    for (const [key, definition] of types) expect(validateInterventionType(definition, key, keys), key).toEqual([])
  })

  it("as políticas de exemplo publicariam sem pendências com os tipos publicados", async () => {
    const types = await seedTypes()
    const policies = (await seedJsonBlocks()).filter((block) => (block as { schemaVersion?: string }).schemaVersion === "INTERVENTION_POLICY_V1").map((block) => policyDefinitionSchema.parse(block))
    expect(policies).toHaveLength(2)
    const catalog = {
      types: new Map([...types].map(([key, definition]) => [key, { active: true, definition }])),
      allTypeKeys: new Set(types.keys()),
      competencyKeys: new Set(["GESTAO_DO_TEMPO_DE_ATENDIMENTO"]),
      indicators: new Map([["TMA", { active: true }]]),
      flags: new Map<string, { valueType: "BOOLEAN" | "NUMERIC"; active: boolean }>(),
    }
    for (const policy of policies) expect(validatePolicyDefinition(policy, catalog)).toEqual([])
  })
})
