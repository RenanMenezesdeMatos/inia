import { describe, expect, it } from "vitest"
import {
  affectsWholeResult,
  buildStructuredOutputContract,
  buildStructuredOutputJsonSchema,
  buildStructuredOutputPreview,
  describeStructuredResult,
  detectLegacyDivergence,
  diffStructuredOutput,
  flattenStructuredOutput,
  fromLegacyOutputSchema,
  parseStructuredOutputDefinition,
  resolveEffectiveStructuredOutput,
  STRUCTURED_OUTPUT_MAX_DEPTH,
  suggestStructuredOutputKey,
  toLegacyOutputSchema,
  validateStructuredOutputDefinition,
  validateStructuredResult,
  type StructuredOutputDefinition,
} from "./structured-output-definition.js"
import type { OutputSchema } from "./output-schema-fields.js"

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
        {
          kind: "FIELD",
          key: "severidade",
          label: "Severidade",
          type: "ENUM",
          required: false,
          description: "Classifique a severidade considerando impacto e urgência.",
          options: [{ value: "BAIXA", label: "Baixa" }, { value: "MEDIA", label: "Média" }, { value: "ALTA", label: "Alta" }, { value: "CRITICA", label: "Crítica" }],
        },
        { kind: "FIELD", key: "requerAcompanhamento", label: "Requer acompanhamento", type: "BOOLEAN", required: false, description: "Informe Sim quando a interação exigir acompanhamento posterior." },
        { kind: "FIELD", key: "nota", label: "Nota", type: "NUMBER", required: false, minimum: 0, maximum: 10 },
      ],
    },
    { kind: "FIELD", key: "urgente", label: "Urgente", type: "BOOLEAN", required: false },
  ],
}

/** O exemplo REAL do Orquestrador "Atendimento multidomínio" (Parte AN). */
const LEGACY_MULTIDOMINIO: OutputSchema = [
  {
    key: "sintese",
    label: "Síntese",
    fields: [
      { key: "severidade", type: "STRING", label: "Severidade", enumValues: ["BAIXA", "MEDIA", "ALTA", "CRITICA"] },
      { key: "dominios", type: "STRING", label: "Domínios" },
      { key: "especialistasAcionados", type: "STRING", label: "Especialistas acionados" },
      { key: "requerAcompanhamento", type: "BOOLEAN", label: "Requer acompanhamento" },
    ],
  },
]
const LEGACY_MULTIDOMINIO_INSTRUCTIONS =
  'um JSON { "sintese": { "severidade": "BAIXA|MEDIA|ALTA|CRITICA", "dominios": "domínios identificados na interação separados por vírgula (ex.: faturamento, retenção)", "especialistasAcionados": "nomes dos especialistas acionados separados por vírgula", "requerAcompanhamento": true|false } }'

describe("validateStructuredOutputDefinition", () => {
  it("aceita campo na raiz, grupo e grupo aninhado", () => {
    const nested: StructuredOutputDefinition = {
      schemaVersion: 1,
      nodes: [
        { kind: "FIELD", key: "assunto", label: "Assunto", type: "STRING", required: false },
        { kind: "GROUP", key: "cliente", label: "Cliente", children: [{ kind: "GROUP", key: "contrato", label: "Contrato", children: [{ kind: "FIELD", key: "premium", label: "Premium", type: "BOOLEAN", required: false }] }] },
      ],
    }
    expect(validateStructuredOutputDefinition(nested)).toEqual([])
    expect(validateStructuredOutputDefinition(ANALISE)).toEqual([])
  })

  it("aceita os cinco tipos com required e optional", () => {
    const issues = validateStructuredOutputDefinition({
      schemaVersion: 1,
      nodes: [
        { kind: "FIELD", key: "a", label: "A", type: "STRING", required: true },
        { kind: "FIELD", key: "b", label: "B", type: "NUMBER", required: false },
        { kind: "FIELD", key: "c", label: "C", type: "BOOLEAN", required: true },
        { kind: "FIELD", key: "d", label: "D", type: "ENUM", required: false, options: [{ value: "X" }] },
        { kind: "FIELD", key: "e", label: "E", type: "ARRAY", required: false },
      ],
    })
    expect(issues).toEqual([])
  })

  it("recusa chave duplicada no mesmo objeto com mensagem humana", () => {
    const issues = validateStructuredOutputDefinition({
      schemaVersion: 1,
      nodes: [{ kind: "GROUP", key: "analise", label: "Análise", children: [{ kind: "FIELD", key: "assunto", label: "Assunto", type: "STRING", required: false }, { kind: "FIELD", key: "assunto", label: "Assunto 2", type: "STRING", required: false }] }],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('Já existe um campo com a chave "assunto" dentro de Análise')
    expect(issues[0]!.nodePath).toBe("analise.assunto")
  })

  it("permite a mesma chave em objetos diferentes", () => {
    const issues = validateStructuredOutputDefinition({
      schemaVersion: 1,
      nodes: [
        { kind: "GROUP", key: "cliente", label: "Cliente", children: [{ kind: "FIELD", key: "nome", label: "Nome", type: "STRING", required: false }] },
        { kind: "GROUP", key: "atendente", label: "Atendente", children: [{ kind: "FIELD", key: "nome", label: "Nome", type: "STRING", required: false }] },
      ],
    })
    expect(issues).toEqual([])
  })

  it("recusa enum sem opções, opção vazia e opção duplicada", () => {
    const empty = validateStructuredOutputDefinition({ schemaVersion: 1, nodes: [{ kind: "FIELD", key: "sev", label: "Severidade", type: "ENUM", required: false, options: [] }] })
    expect(empty[0]!.message).toContain("precisa ter ao menos uma opção")
    const duplicated = validateStructuredOutputDefinition({ schemaVersion: 1, nodes: [{ kind: "FIELD", key: "sev", label: "Severidade", type: "ENUM", required: false, options: [{ value: "ALTA" }, { value: "ALTA" }] }] })
    expect(duplicated[0]!.message).toContain('opção "ALTA" repetida')
  })

  it("recusa grupo vazio, definição vazia e profundidade acima do limite", () => {
    expect(validateStructuredOutputDefinition({ schemaVersion: 1, nodes: [{ kind: "GROUP", key: "g", label: "G", children: [] }] })[0]!.message).toContain("ao menos um campo")
    expect(validateStructuredOutputDefinition({ schemaVersion: 1, nodes: [] })[0]!.message).toContain("Adicione ao menos um campo")

    let node: StructuredOutputDefinition["nodes"][number] = { kind: "FIELD", key: "folha", label: "Folha", type: "STRING", required: false }
    for (let level = 0; level < STRUCTURED_OUTPUT_MAX_DEPTH; level += 1) node = { kind: "GROUP", key: `g${level}`, label: `G${level}`, children: [node] }
    const tooDeep = validateStructuredOutputDefinition({ schemaVersion: 1, nodes: [node] })
    expect(tooDeep.some((issue) => issue.message.includes(`${STRUCTURED_OUTPUT_MAX_DEPTH} níveis`))).toBe(true)
  })

  it("recusa chave técnica inválida e tipo inválido pelo schema", () => {
    expect(() => parseStructuredOutputDefinition({ schemaVersion: 1, nodes: [{ kind: "FIELD", key: "1abc", label: "X", type: "STRING", required: false }] })).toThrow(/inválido/)
    expect(() => parseStructuredOutputDefinition({ schemaVersion: 1, nodes: [{ kind: "FIELD", key: "abc", label: "X", type: "DATE", required: false }] })).toThrow(/inválido/)
    expect(validateStructuredOutputDefinition({ schemaVersion: 1, nodes: [{ kind: "FIELD", key: "com espaço", label: "X", type: "STRING", required: false }] })[0]!.message).toContain("só pode ter letras")
  })

  it("recusa min > max e min/max fora de Número", () => {
    expect(validateStructuredOutputDefinition({ schemaVersion: 1, nodes: [{ kind: "FIELD", key: "n", label: "Nota", type: "NUMBER", required: false, minimum: 10, maximum: 0 }] })[0]!.message).toContain("mínimo (10) não pode ser maior")
    expect(validateStructuredOutputDefinition({ schemaVersion: 1, nodes: [{ kind: "FIELD", key: "n", label: "Nota", type: "STRING", required: false, minimum: 1 }] })[0]!.message).toContain("só valem para campos numéricos")
  })
})

describe("geração determinística a partir de UMA definição", () => {
  it("flatten: paths técnicos e labels amigáveis, ENUM compara como texto com opções rotuladas", () => {
    const fields = flattenStructuredOutput(ANALISE)
    expect(fields.map((field) => [field.path, field.label])).toEqual([
      ["analise.assunto", "Análise › Assunto"],
      ["analise.severidade", "Análise › Severidade"],
      ["analise.requerAcompanhamento", "Análise › Requer acompanhamento"],
      ["analise.nota", "Análise › Nota"],
      ["urgente", "Urgente"],
    ])
    const severidade = fields[1]!
    expect(severidade.type).toBe("STRING")
    expect(severidade.fieldType).toBe("ENUM")
    expect(severidade.enumValues).toEqual(["BAIXA", "MEDIA", "ALTA", "CRITICA"])
    expect(severidade.enumOptions).toEqual([{ value: "BAIXA", label: "Baixa" }, { value: "MEDIA", label: "Média" }, { value: "ALTA", label: "Alta" }, { value: "CRITICA", label: "Crítica" }])
    expect(fields[0]!.required).toBe(true)
  })

  it("contrato do LLM pede exatamente os mesmos paths que o Builder oferece (nunca divergem)", () => {
    const contract = buildStructuredOutputContract(ANALISE)
    for (const field of flattenStructuredOutput(ANALISE)) expect(contract).toContain(`- ${field.path} (`)
    expect(contract).toContain('"severidade": "BAIXA|MEDIA|ALTA|CRITICA"')
    expect(contract).toContain('"requerAcompanhamento": true|false')
    expect(contract).toContain("Identifique o principal motivo do contato em uma frase curta.")
    expect(contract).toContain('Exemplo: "Cobrança em duplicidade"')
    expect(contract).toContain("número entre 0 e 10")
    expect(contract).toContain("obrigatório")
    expect(buildStructuredOutputContract(ANALISE)).toBe(contract)
  })

  it("prévia, JSON Schema e validador derivam da mesma definição", () => {
    expect(buildStructuredOutputPreview(ANALISE)).toEqual({ analise: { assunto: "Cobrança em duplicidade", severidade: "BAIXA", requerAcompanhamento: true, nota: 0 }, urgente: true })
    const schema = buildStructuredOutputJsonSchema(ANALISE) as { properties: Record<string, { properties: Record<string, unknown>; required?: string[] }>; required: string[] }
    expect(schema.required).toEqual(["analise"])
    expect(schema.properties.analise!.required).toEqual(["assunto"])
    expect(schema.properties.analise!.properties.severidade).toMatchObject({ type: "string", enum: ["BAIXA", "MEDIA", "ALTA", "CRITICA"] })
    expect(schema.properties.analise!.properties.nota).toMatchObject({ type: "number", minimum: 0, maximum: 10 })
    // A prévia é sempre um resultado válido pelo validador gerado.
    expect(validateStructuredResult(ANALISE, buildStructuredOutputPreview(ANALISE)).valid).toBe(true)
  })
})

describe("validateStructuredResult", () => {
  it("aceita um resultado completo e normaliza", () => {
    const result = validateStructuredResult(ANALISE, { analise: { assunto: "Cobrança", severidade: "alta", requerAcompanhamento: "true", nota: "8,5", extra: 1 }, urgente: false })
    expect(result).toEqual({ valid: true, value: { analise: { assunto: "Cobrança", severidade: "ALTA", requerAcompanhamento: true, nota: 8.5 }, urgente: false } })
  })

  it("recusa opção fora da lista", () => {
    const result = validateStructuredResult(ANALISE, { analise: { assunto: "x", severidade: "URGENTISSIMA" } })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.issues[0]).toEqual({ path: "analise.severidade", message: expect.stringContaining('"URGENTISSIMA", que não está entre as opções') })
  })

  it("recusa obrigatório ausente, tipo errado e faixa numérica", () => {
    const result = validateStructuredResult(ANALISE, { analise: { nota: 42, requerAcompanhamento: "talvez" } })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues.map((issue) => issue.path).sort()).toEqual(["analise.nota", "analise.requerAcompanhamento", "analise.assunto"].sort())
    }
  })

  it("aceita opcional ausente e recusa não-objeto", () => {
    expect(validateStructuredResult(ANALISE, { analise: { assunto: "ok" } })).toEqual({ valid: true, value: { analise: { assunto: "ok" } } })
    expect(validateStructuredResult(ANALISE, "texto").valid).toBe(false)
    expect(validateStructuredResult(ANALISE, { analise: "texto" }).valid).toBe(false)
  })

  it("describeStructuredResult mostra Sim/Não e rótulo da opção", () => {
    const rows = describeStructuredResult(ANALISE, { analise: { assunto: "Cobrança em duplicidade", severidade: "ALTA", requerAcompanhamento: true } })
    expect(rows).toEqual([
      { path: "analise.assunto", label: "Análise › Assunto", displayValue: "Cobrança em duplicidade" },
      { path: "analise.severidade", label: "Análise › Severidade", displayValue: "Alta" },
      { path: "analise.requerAcompanhamento", label: "Análise › Requer acompanhamento", displayValue: "Sim" },
      { path: "analise.nota", label: "Análise › Nota", displayValue: "—" },
      { path: "urgente", label: "Urgente", displayValue: "—" },
    ])
  })
})

describe("legado (migração/dual-read)", () => {
  it("converte Atendimento multidomínio preservando os paths exatamente", () => {
    const definition = fromLegacyOutputSchema(LEGACY_MULTIDOMINIO)
    expect(flattenStructuredOutput(definition).map((field) => field.path)).toEqual(["sintese.severidade", "sintese.dominios", "sintese.especialistasAcionados", "sintese.requerAcompanhamento"])
    expect(flattenStructuredOutput(definition)[0]).toMatchObject({ fieldType: "ENUM", type: "STRING", enumValues: ["BAIXA", "MEDIA", "ALTA", "CRITICA"], required: false })
    expect(validateStructuredOutputDefinition(definition)).toEqual([])
    // ida e volta: o formato legado gerado é idêntico ao original
    expect(toLegacyOutputSchema(definition)).toEqual(LEGACY_MULTIDOMINIO)
    // o contrato gerado pede exatamente os mesmos paths
    const contract = buildStructuredOutputContract(definition)
    expect(contract).toContain("- sintese.severidade (")
    expect(contract).toContain("- sintese.requerAcompanhamento (")
  })

  it("não acusa divergência quando texto e campos batem", () => {
    expect(detectLegacyDivergence(LEGACY_MULTIDOMINIO_INSTRUCTIONS, LEGACY_MULTIDOMINIO)).toBeNull()
  })

  it("acusa divergência (sintese.criticidade × sintese.severidade) sem corrigir nada", () => {
    const divergent = LEGACY_MULTIDOMINIO_INSTRUCTIONS.replace('"severidade"', '"criticidade"')
    const review = detectLegacyDivergence(divergent, LEGACY_MULTIDOMINIO)
    expect(review).toMatchObject({ reason: "KEY_MISMATCH", missingInInstructions: ["severidade"], unknownInInstructions: ["criticidade"] })
    const effective = resolveEffectiveStructuredOutput({ structured_output: null, output_schema: LEGACY_MULTIDOMINIO, output_instructions: divergent })
    expect(effective.source).toBe("LEGACY_SCHEMA")
    expect(effective.review?.reason).toBe("KEY_MISMATCH")
    // o modelo continua recebendo o texto legado intacto até a revisão
    expect(effective.llmInstructions).toBe(divergent)
    expect(effective.fields?.map((field) => field.path)).toContain("sintese.severidade")
  })

  it("texto sem chave reconhecível = não verificável (também revisão)", () => {
    expect(detectLegacyDivergence("um JSON com severidade e domínios", LEGACY_MULTIDOMINIO)?.reason).toBe("UNVERIFIABLE")
    expect(detectLegacyDivergence(null, LEGACY_MULTIDOMINIO)?.reason).toBe("UNVERIFIABLE")
  })

  it("dual-read: definição persistida manda; só texto legado continua texto; nada = NONE", () => {
    const withDefinition = resolveEffectiveStructuredOutput({ structured_output: ANALISE, output_schema: LEGACY_MULTIDOMINIO, output_instructions: "texto antigo" })
    expect(withDefinition.source).toBe("DEFINITION")
    expect(withDefinition.llmInstructions).toBe(buildStructuredOutputContract(ANALISE))
    expect(withDefinition.fields?.map((field) => field.path)).toContain("analise.assunto")
    const onlyText = resolveEffectiveStructuredOutput({ structured_output: null, output_schema: null, output_instructions: "um JSON { diagnostico: { severidade } }" })
    expect(onlyText).toMatchObject({ source: "LEGACY_INSTRUCTIONS", definition: null, llmInstructions: "um JSON { diagnostico: { severidade } }", fields: null })
    expect(resolveEffectiveStructuredOutput({ structured_output: null, output_schema: null, output_instructions: null }).source).toBe("NONE")
  })

  it("campo na raiz ou grupo aninhado não é representável no formato legado", () => {
    expect(toLegacyOutputSchema(ANALISE)).toBeNull()
  })
})

describe("diffStructuredOutput", () => {
  it("rótulo/descrição/obrigatório/campo novo são compatíveis", () => {
    const next: StructuredOutputDefinition = JSON.parse(JSON.stringify(ANALISE))
    const group = next.nodes[0]
    if (group?.kind === "GROUP") {
      group.label = "Análise principal"
      group.children.push({ kind: "FIELD", key: "novo", label: "Novo", type: "STRING", required: false })
      const assunto = group.children[0]
      if (assunto?.kind === "FIELD") assunto.required = false
    }
    expect(diffStructuredOutput(ANALISE, next)).toEqual([])
  })

  it("campo NOVO já obrigatório é REQUIRED_ADDED (respostas antigas não o trazem)", () => {
    const next: StructuredOutputDefinition = JSON.parse(JSON.stringify(ANALISE))
    const group = next.nodes[0]
    if (group?.kind === "GROUP") group.children.push({ kind: "FIELD", key: "novo", label: "Novo", type: "STRING", required: true })
    expect(diffStructuredOutput(ANALISE, next)).toEqual([{ kind: "REQUIRED_ADDED", path: "analise.novo" }])
  })

  it("renomear, apagar, mudar tipo e remover opção são breaking", () => {
    const next: StructuredOutputDefinition = JSON.parse(JSON.stringify(ANALISE))
    const group = next.nodes[0]
    if (group?.kind === "GROUP") {
      group.children = group.children.filter((child) => child.key !== "requerAcompanhamento")
      const assunto = group.children.find((child) => child.key === "assunto")
      if (assunto?.kind === "FIELD") assunto.key = "motivo"
      const nota = group.children.find((child) => child.key === "nota")
      if (nota?.kind === "FIELD") nota.type = "STRING"
      const severidade = group.children.find((child) => child.key === "severidade")
      if (severidade?.kind === "FIELD") severidade.options = severidade.options!.filter((option) => option.value !== "CRITICA")
    }
    expect(diffStructuredOutput(ANALISE, next)).toEqual([
      { kind: "REMOVED", path: "analise.assunto" },
      { kind: "ENUM_OPTION_REMOVED", path: "analise.severidade", values: ["CRITICA"] },
      { kind: "REMOVED", path: "analise.requerAcompanhamento" },
      { kind: "TYPE_CHANGED", path: "analise.nota", from: "NUMBER", to: "STRING" },
      // o campo renomeado era obrigatório: o path novo nasce obrigatório (respostas antigas não o trazem)
      { kind: "REQUIRED_ADDED", path: "analise.motivo" },
    ])
    expect(diffStructuredOutput(ANALISE, null).map((change) => change.path)).toContain("analise")
  })

  function withField(mutate: (field: Extract<StructuredOutputDefinition["nodes"][number], { kind: "FIELD" }>) => void, key: string): StructuredOutputDefinition {
    const next: StructuredOutputDefinition = JSON.parse(JSON.stringify(ANALISE))
    const group = next.nodes[0]
    if (group?.kind !== "GROUP") throw new Error("expected group")
    const field = group.children.find((child) => child.key === key)
    if (field?.kind !== "FIELD") throw new Error("expected field")
    mutate(field)
    return next
  }

  it("obrigatoriedade é direcional: opcional → obrigatório é breaking (resultado inteiro); obrigatório → opcional é compatível", () => {
    const stricter = withField((field) => (field.required = true), "severidade")
    const changes = diffStructuredOutput(ANALISE, stricter)
    expect(changes).toEqual([{ kind: "REQUIRED_ADDED", path: "analise.severidade" }])
    expect(changes.every(affectsWholeResult)).toBe(true)
    expect(diffStructuredOutput(stricter, ANALISE)).toEqual([])
    expect(diffStructuredOutput(ANALISE, withField((field) => (field.required = false), "assunto"))).toEqual([])
  })

  it("ENUM é direcional: adicionar opção e trocar só o rótulo são compatíveis; remover opção ou trocar o valor técnico é breaking", () => {
    expect(diffStructuredOutput(ANALISE, withField((field) => field.options!.push({ value: "URGENTE", label: "Urgente" }), "severidade"))).toEqual([])
    expect(diffStructuredOutput(ANALISE, withField((field) => (field.options![2]!.label = "Alta mesmo"), "severidade"))).toEqual([])
    expect(diffStructuredOutput(ANALISE, withField((field) => (field.options = field.options!.filter((option) => option.value !== "CRITICA")), "severidade"))).toEqual([
      { kind: "ENUM_OPTION_REMOVED", path: "analise.severidade", values: ["CRITICA"] },
    ])
    expect(diffStructuredOutput(ANALISE, withField((field) => (field.options![2]!.value = "ELEVADA"), "severidade"))).toEqual([{ kind: "ENUM_OPTION_REMOVED", path: "analise.severidade", values: ["ALTA"] }])
  })

  it("NUMBER é direcional: estreitar a faixa é breaking (resultado inteiro); relaxar/remover limite é compatível", () => {
    // ANALISE.nota = 0..10
    expect(diffStructuredOutput(ANALISE, withField((field) => (field.maximum = 5), "nota"))).toEqual([{ kind: "RANGE_NARROWED", path: "analise.nota", from: { minimum: 0, maximum: 10 }, to: { minimum: 0, maximum: 5 } }])
    expect(diffStructuredOutput(ANALISE, withField((field) => (field.minimum = 1), "nota"))).toEqual([{ kind: "RANGE_NARROWED", path: "analise.nota", from: { minimum: 0, maximum: 10 }, to: { minimum: 1, maximum: 10 } }])
    expect(diffStructuredOutput(ANALISE, withField((field) => ((field.minimum = -5), (field.maximum = 100)), "nota"))).toEqual([])
    expect(diffStructuredOutput(ANALISE, withField((field) => (delete field.maximum, delete field.minimum), "nota"))).toEqual([])
    // sem limite → com limite = estreitou
    const unbounded = withField((field) => (delete field.maximum, delete field.minimum), "nota")
    expect(diffStructuredOutput(unbounded, ANALISE)).toEqual([{ kind: "RANGE_NARROWED", path: "analise.nota", from: {}, to: { minimum: 0, maximum: 10 } }])
    expect(affectsWholeResult({ kind: "RANGE_NARROWED", path: "x", from: {}, to: {} })).toBe(true)
    expect(affectsWholeResult({ kind: "REMOVED", path: "x" })).toBe(false)
  })

  it("mudar só a descrição continua compatível (fica na auditoria normal, nunca bloqueia)", () => {
    expect(diffStructuredOutput(ANALISE, withField((field) => (field.description = "Outra instrução."), "assunto"))).toEqual([])
  })
})

describe("suggestStructuredOutputKey", () => {
  it("gera camelCase sem acentos", () => {
    expect(suggestStructuredOutputKey("Assunto")).toBe("assunto")
    expect(suggestStructuredOutputKey("Risco de cancelamento")).toBe("riscoDeCancelamento")
    expect(suggestStructuredOutputKey("Síntese")).toBe("sintese")
    expect(suggestStructuredOutputKey("Requer acompanhamento")).toBe("requerAcompanhamento")
    expect(suggestStructuredOutputKey("2ª via")).toBe("campo2Via")
    expect(suggestStructuredOutputKey("   ")).toBe("")
  })
})
