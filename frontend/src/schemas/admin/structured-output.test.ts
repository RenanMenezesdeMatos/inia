import { describe, expect, it } from "vitest"
import { COMPARATORS_BY_FIELD_TYPE } from "./workflow-graph.schema"
import {
  buildStructuredOutputJsonSchema,
  buildStructuredOutputPreview,
  describeStructuredField,
  flattenStructuredOutput,
  STRUCTURED_OUTPUT_MAX_DEPTH,
  suggestStructuredOutputKey,
  validateStructuredOutputDefinition,
  type StructuredOutputDefinition,
} from "./structured-output"

/** MESMA fixture do teste de domínio do backend (structured-output-definition.test.ts) — os
 * resultados abaixo precisam ser idênticos aos de lá: é o que garante que o path pedido à IA
 * (gerado no backend) e o path apresentado no Workflow Builder (este espelho) nunca divergem. */
const ANALISE: StructuredOutputDefinition = {
  schemaVersion: 1,
  nodes: [
    {
      kind: "GROUP",
      key: "analise",
      label: "Análise",
      description: "Informações resultantes da análise principal da interação.",
      children: [
        { kind: "FIELD", key: "assunto", label: "Assunto", type: "STRING", required: true, description: "Identifique o principal motivo do contato em uma frase curta.", example: "Cobrança em duplicidade" },
        { kind: "FIELD", key: "severidade", label: "Severidade", type: "ENUM", required: false, options: [{ value: "BAIXA", label: "Baixa" }, { value: "MEDIA", label: "Média" }, { value: "ALTA", label: "Alta" }, { value: "CRITICA", label: "Crítica" }] },
        { kind: "FIELD", key: "requerAcompanhamento", label: "Requer acompanhamento", type: "BOOLEAN", required: false },
        { kind: "FIELD", key: "nota", label: "Nota", type: "NUMBER", required: false, minimum: 0, maximum: 10 },
      ],
    },
    { kind: "FIELD", key: "urgente", label: "Urgente", type: "BOOLEAN", required: false },
  ],
}

describe("structured-output (espelho do backend)", () => {
  it("achata com os mesmos paths/labels do backend e oferece os operadores certos por tipo", () => {
    const fields = flattenStructuredOutput(ANALISE)
    expect(fields.map((field) => [field.path, field.label])).toEqual([
      ["analise.assunto", "Análise › Assunto"],
      ["analise.severidade", "Análise › Severidade"],
      ["analise.requerAcompanhamento", "Análise › Requer acompanhamento"],
      ["analise.nota", "Análise › Nota"],
      ["urgente", "Urgente"],
    ])
    // STRING: igual/diferente/contém/não contém…; NUMBER: comparação numérica; BOOLEAN: só igual (Sim/Não); ENUM: como texto com opções.
    expect(COMPARATORS_BY_FIELD_TYPE[fields[0]!.type]).toEqual(["EQUALS", "NOT_EQUALS", "CONTAINS", "NOT_CONTAINS", "STARTS_WITH", "ENDS_WITH", "IS_EMPTY", "NOT_EMPTY"])
    expect(COMPARATORS_BY_FIELD_TYPE[fields[3]!.type]).toEqual(["EQUALS", "NOT_EQUALS", "GT", "LT", "GTE", "LTE"])
    expect(COMPARATORS_BY_FIELD_TYPE[fields[2]!.type]).toEqual(["EQUALS"])
    expect(fields[1]).toMatchObject({ type: "STRING", fieldType: "ENUM", enumValues: ["BAIXA", "MEDIA", "ALTA", "CRITICA"], enumOptions: [{ value: "BAIXA", label: "Baixa" }, { value: "MEDIA", label: "Média" }, { value: "ALTA", label: "Alta" }, { value: "CRITICA", label: "Crítica" }] })
  })

  it("prévia e JSON Schema idênticos aos do backend", () => {
    expect(buildStructuredOutputPreview(ANALISE)).toEqual({ analise: { assunto: "Cobrança em duplicidade", severidade: "BAIXA", requerAcompanhamento: true, nota: 0 }, urgente: true })
    const schema = buildStructuredOutputJsonSchema(ANALISE) as { properties: Record<string, { properties: Record<string, unknown>; required?: string[] }>; required: string[] }
    expect(schema.required).toEqual(["analise"])
    expect(schema.properties.analise!.required).toEqual(["assunto"])
    expect(schema.properties.analise!.properties.severidade).toMatchObject({ type: "string", enum: ["BAIXA", "MEDIA", "ALTA", "CRITICA"] })
  })

  it("validação com as mesmas mensagens humanas do backend", () => {
    expect(validateStructuredOutputDefinition(ANALISE)).toEqual([])
    const duplicated = validateStructuredOutputDefinition({ schemaVersion: 1, nodes: [{ kind: "GROUP", key: "analise", label: "Análise", children: [{ kind: "FIELD", key: "assunto", label: "Assunto", type: "STRING", required: false }, { kind: "FIELD", key: "assunto", label: "Assunto 2", type: "STRING", required: false }] }] })
    expect(duplicated[0]!.message).toContain('Já existe um campo com a chave "assunto" dentro de Análise')
    expect(validateStructuredOutputDefinition({ schemaVersion: 1, nodes: [] })[0]!.message).toContain("Adicione ao menos um campo")
    expect(validateStructuredOutputDefinition({ schemaVersion: 1, nodes: [{ kind: "FIELD", key: "sev", label: "Severidade", type: "ENUM", required: false, options: [] }] })[0]!.message).toContain("ao menos uma opção")
    expect(validateStructuredOutputDefinition({ schemaVersion: 1, nodes: [{ kind: "FIELD", key: "1x", label: "X", type: "STRING", required: false }] })[0]!.message).toContain("só pode ter letras")
    let node: StructuredOutputDefinition["nodes"][number] = { kind: "FIELD", key: "folha", label: "Folha", type: "STRING", required: false }
    for (let level = 0; level < STRUCTURED_OUTPUT_MAX_DEPTH; level += 1) node = { kind: "GROUP", key: `g${level}`, label: `G${level}`, children: [node] }
    expect(validateStructuredOutputDefinition({ schemaVersion: 1, nodes: [node] }).some((issue) => issue.message.includes(`${STRUCTURED_OUTPUT_MAX_DEPTH} níveis`))).toBe(true)
  })

  it("sugestão de chave e resumo do campo", () => {
    expect(suggestStructuredOutputKey("Risco de cancelamento")).toBe("riscoDeCancelamento")
    expect(suggestStructuredOutputKey("Síntese")).toBe("sintese")
    expect(describeStructuredField({ kind: "FIELD", key: "a", label: "A", type: "STRING", required: true })).toBe("Texto · obrigatório")
    expect(describeStructuredField({ kind: "FIELD", key: "s", label: "S", type: "ENUM", required: false, options: [{ value: "A" }, { value: "B" }] })).toBe("Lista · 2 opções")
    expect(describeStructuredField({ kind: "FIELD", key: "b", label: "B", type: "BOOLEAN", required: false })).toBe("Sim/Não")
  })
})
