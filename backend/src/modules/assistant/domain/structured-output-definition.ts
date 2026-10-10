import { z } from "zod"
import type { FlatOutputSchemaField, OutputSchema } from "./output-schema-fields.js"

/**
 * Resultado estruturado do Orquestrador — FONTE ÚNICA DA VERDADE (2026-09-17).
 *
 * Antes existiam duas configurações manuais da mesma coisa: `output_instructions` (texto que
 * instruía o LLM) e `output_schema` (metadado lido pelo Workflow Builder). Podiam divergir sem
 * ninguém perceber (o LLM passava a produzir `sintese.criticidade` enquanto o Builder oferecia
 * `sintese.severidade`). Agora o admin descreve UMA vez, visualmente, "quais informações quero
 * que este Orquestrador produza" e TUDO abaixo é DERIVADO por função pura e determinística:
 *
 *   1. contrato/instrução para o LLM ............ buildStructuredOutputContract
 *   2. validação do JSON devolvido ............... validateStructuredResult
 *   3. catálogo de campos do Workflow Builder .... flattenStructuredOutput (paths + labels)
 *   4. JSON Schema (visão técnica) ............... buildStructuredOutputJsonSchema
 *   5. prévia do resultado ....................... buildStructuredOutputPreview
 *
 * A definição é tipada, validável, versionada (`schemaVersion`) e independente de UI e de
 * provedor de LLM (o contrato é texto; nada aqui depende do Gemini).
 *
 * Tipos suportados na V1: STRING, NUMBER, BOOLEAN, ENUM (escolha entre opções conhecidas),
 * ARRAY (lista de textos — já existia no formato legado e continua aceito) e GROUP (só
 * organização/nesting, sem valor próprio). Listas de objetos, oneOf/anyOf, schema condicional
 * e expressões não existem por decisão de escopo.
 */

export const STRUCTURED_OUTPUT_SCHEMA_VERSION = 1 as const

/** Chave técnica = identificador JSON simples. Os paths legados são camelCase
 * (`requerAcompanhamento`, `especialistasAcionados`) e continuam válidos — a regra nunca os
 * rejeita nem os renomeia. */
export const STRUCTURED_OUTPUT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Profundidade máxima de nesting (segmentos do path): `a.b.c.d` = 4. Limite de segurança
 * para UX/runtime, validado no backend e espelhado no frontend. */
export const STRUCTURED_OUTPUT_MAX_DEPTH = 4
/** Limite total de nós (grupos + campos) por definição. */
export const STRUCTURED_OUTPUT_MAX_NODES = 120
/** Limite de opções de uma Lista de opções. */
export const STRUCTURED_OUTPUT_MAX_ENUM_OPTIONS = 50

export const structuredOutputFieldTypeSchema = z.enum(["STRING", "NUMBER", "BOOLEAN", "ENUM", "ARRAY"])
export type StructuredOutputFieldType = z.infer<typeof structuredOutputFieldTypeSchema>

const keySchema = z.string().trim().min(1).max(60).regex(STRUCTURED_OUTPUT_KEY_PATTERN)
const labelSchema = z.string().trim().min(1).max(120)
const descriptionSchema = z.string().trim().max(1000)

export const structuredOutputEnumOptionSchema = z.object({
  value: z.string().trim().min(1).max(80),
  label: labelSchema.optional(),
})

export const structuredOutputFieldSchema = z.object({
  kind: z.literal("FIELD"),
  key: keySchema,
  label: labelSchema,
  type: structuredOutputFieldTypeSchema,
  required: z.boolean().default(false),
  /** "O que a IA deve identificar?" — vai literalmente para o contrato enviado ao modelo. */
  description: descriptionSchema.optional(),
  /** Só STRING: exemplo esperado (instrução + prévia; nunca valor fixo). */
  example: z.string().trim().max(200).optional(),
  /** Só NUMBER: faixa opcional. */
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
  /** Só ENUM: opções permitidas (valor técnico + rótulo amigável opcional). */
  options: z.array(structuredOutputEnumOptionSchema).max(STRUCTURED_OUTPUT_MAX_ENUM_OPTIONS).optional(),
})
export type StructuredOutputField = z.infer<typeof structuredOutputFieldSchema>

export type StructuredOutputGroup = {
  kind: "GROUP"
  key: string
  label: string
  description?: string | undefined
  children: StructuredOutputNode[]
}
export type StructuredOutputNode = StructuredOutputField | StructuredOutputGroup

export const structuredOutputNodeSchema: z.ZodType<StructuredOutputNode> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    structuredOutputFieldSchema,
    z.object({
      kind: z.literal("GROUP"),
      key: keySchema,
      label: labelSchema,
      description: descriptionSchema.optional(),
      children: z.array(structuredOutputNodeSchema),
    }),
  ]),
) as z.ZodType<StructuredOutputNode>

export const structuredOutputDefinitionSchema = z.object({
  schemaVersion: z.literal(STRUCTURED_OUTPUT_SCHEMA_VERSION),
  nodes: z.array(structuredOutputNodeSchema),
})
export type StructuredOutputDefinition = z.infer<typeof structuredOutputDefinitionSchema>

export type StructuredOutputIssue = {
  /** Path técnico do nó com problema ("" = raiz). */
  nodePath: string
  message: string
}

function joinPath(parentPath: string, key: string): string {
  return parentPath ? `${parentPath}.${key}` : key
}

function describeContainer(parentLabel: string | null): string {
  return parentLabel ? `dentro de ${parentLabel}` : "na raiz do resultado"
}

/**
 * Regras semânticas que o schema Zod não expressa — mensagens em linguagem humana (nunca
 * "duplicate key at nodes[0].children[2]"). Retorna TODOS os problemas encontrados; lista vazia
 * = definição válida.
 */
export function validateStructuredOutputDefinition(definition: StructuredOutputDefinition): StructuredOutputIssue[] {
  const issues: StructuredOutputIssue[] = []
  let nodeCount = 0

  function visit(nodes: StructuredOutputNode[], parentPath: string, parentLabel: string | null, depth: number): void {
    const seenKeys = new Map<string, string>()
    for (const node of nodes) {
      nodeCount += 1
      const path = joinPath(parentPath, node.key)
      const label = node.label.trim()
      if (!label) issues.push({ nodePath: path, message: `Informe o nome exibido do item "${node.key}" ${describeContainer(parentLabel)}.` })
      if (!STRUCTURED_OUTPUT_KEY_PATTERN.test(node.key)) {
        issues.push({ nodePath: path, message: `A chave técnica "${node.key}" de "${label || node.key}" só pode ter letras, números e "_" e precisa começar com letra.` })
      }
      const duplicate = seenKeys.get(node.key)
      if (duplicate) {
        issues.push({ nodePath: path, message: `Já existe um ${node.kind === "GROUP" ? "grupo ou campo" : "campo"} com a chave "${node.key}" ${describeContainer(parentLabel)} (usada por "${duplicate}").` })
      } else {
        seenKeys.set(node.key, label || node.key)
      }
      if (depth > STRUCTURED_OUTPUT_MAX_DEPTH) {
        issues.push({ nodePath: path, message: `"${label || node.key}" está além do limite de ${STRUCTURED_OUTPUT_MAX_DEPTH} níveis de aninhamento.` })
      }

      if (node.kind === "GROUP") {
        if (node.children.length === 0) issues.push({ nodePath: path, message: `O grupo "${label || node.key}" precisa ter ao menos um campo.` })
        visit(node.children, path, label || node.key, depth + 1)
        continue
      }

      if (node.type === "ENUM") {
        const options = node.options ?? []
        if (options.length === 0) issues.push({ nodePath: path, message: `A lista de opções "${label || node.key}" precisa ter ao menos uma opção.` })
        const seenValues = new Set<string>()
        for (const option of options) {
          if (!option.value.trim()) issues.push({ nodePath: path, message: `"${label || node.key}" tem uma opção sem valor.` })
          if (seenValues.has(option.value)) issues.push({ nodePath: path, message: `"${label || node.key}" tem a opção "${option.value}" repetida.` })
          seenValues.add(option.value)
        }
      } else if (node.options && node.options.length > 0) {
        issues.push({ nodePath: path, message: `"${label || node.key}" não é uma lista de opções — remova as opções ou troque o tipo.` })
      }
      if (node.type === "NUMBER" && node.minimum !== undefined && node.maximum !== undefined && node.minimum > node.maximum) {
        issues.push({ nodePath: path, message: `Em "${label || node.key}", o mínimo (${node.minimum}) não pode ser maior que o máximo (${node.maximum}).` })
      }
      if (node.type !== "NUMBER" && (node.minimum !== undefined || node.maximum !== undefined)) {
        issues.push({ nodePath: path, message: `"${label || node.key}" não é um número — mínimo/máximo só valem para campos numéricos.` })
      }
      if (node.type !== "STRING" && node.example !== undefined && node.example !== "") {
        issues.push({ nodePath: path, message: `"${label || node.key}" não é um texto — o exemplo esperado só vale para campos de texto.` })
      }
    }
  }

  visit(definition.nodes, "", null, 1)
  if (definition.nodes.length === 0) issues.push({ nodePath: "", message: "Adicione ao menos um campo ou desative o resultado estruturado." })
  if (nodeCount > STRUCTURED_OUTPUT_MAX_NODES) issues.push({ nodePath: "", message: `O resultado estruturado tem ${nodeCount} itens — o máximo é ${STRUCTURED_OUTPUT_MAX_NODES}.` })
  return issues
}

/** Interpreta a entrada crua (API/banco) como definição válida — forma (Zod) + regras
 * semânticas. Lança `Error` com a primeira mensagem humana; quem chama converte em DomainError. */
export class StructuredOutputDefinitionError extends Error {
  constructor(
    message: string,
    readonly issues: StructuredOutputIssue[],
  ) {
    super(message)
    this.name = "StructuredOutputDefinitionError"
  }
}

export function parseStructuredOutputDefinition(input: unknown): StructuredOutputDefinition {
  const parsed = structuredOutputDefinitionSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first?.path.filter((segment) => typeof segment === "string").join(" › ")
    throw new StructuredOutputDefinitionError(`O resultado estruturado tem um item inválido${where ? ` (${where})` : ""}: ${first?.message ?? "formato inválido"}.`, [
      { nodePath: "", message: first?.message ?? "formato inválido" },
    ])
  }
  const issues = validateStructuredOutputDefinition(parsed.data)
  if (issues.length > 0) throw new StructuredOutputDefinitionError(issues[0]!.message, issues)
  return parsed.data
}

/* ------------------------------------------------------------------------------------------ */
/* Derivados: catálogo de campos (Workflow Builder), prévia, JSON Schema, contrato para o LLM   */
/* ------------------------------------------------------------------------------------------ */

/** Tipo usado pelos comparadores do Builder (COMPARATORS_BY_FIELD_TYPE): ENUM compara como
 * texto com valores fixos. */
export function comparatorTypeFor(type: StructuredOutputFieldType): FlatOutputSchemaField["type"] {
  return type === "ENUM" ? "STRING" : type
}

/**
 * Achata a definição em campos folha — o MESMO formato (`FlatOutputSchemaField`) que o Workflow
 * Builder e a validação de publish já consumiam do formato legado, agora com `fieldType`,
 * `required` e `enumOptions` (rótulos das opções). `path` é exatamente o segmento depois de
 * "structuredResult." no sourcePath real; `label` é "Grupo › Subgrupo › Campo".
 */
export function flattenStructuredOutput(definition: StructuredOutputDefinition): FlatOutputSchemaField[] {
  const fields: FlatOutputSchemaField[] = []
  function visit(nodes: StructuredOutputNode[], parentPath: string, parentLabels: string[]): void {
    for (const node of nodes) {
      const path = joinPath(parentPath, node.key)
      const labels = [...parentLabels, node.label]
      if (node.kind === "GROUP") {
        visit(node.children, path, labels)
        continue
      }
      const enumValues = node.type === "ENUM" ? (node.options ?? []).map((option) => option.value) : undefined
      fields.push({
        path,
        label: labels.join(" › "),
        type: comparatorTypeFor(node.type),
        fieldType: node.type,
        required: node.required,
        ...(enumValues !== undefined ? { enumValues, enumOptions: (node.options ?? []).map((option) => ({ value: option.value, label: option.label ?? option.value })) } : {}),
        ...(node.description !== undefined && node.description !== "" ? { description: node.description } : {}),
      })
    }
  }
  visit(definition.nodes, "", [])
  return fields
}

export function findStructuredOutputField(fields: FlatOutputSchemaField[] | null | undefined, path: string): FlatOutputSchemaField | undefined {
  return fields?.find((field) => field.path === path)
}

function previewValueFor(field: StructuredOutputField): unknown {
  switch (field.type) {
    case "STRING":
      return field.example?.trim() ? field.example.trim() : "texto"
    case "NUMBER":
      return field.minimum ?? 0
    case "BOOLEAN":
      return true
    case "ENUM":
      return field.options?.[0]?.value ?? ""
    case "ARRAY":
      return ["texto"]
  }
}

/** Prévia read-only do formato: os valores são ilustrativos (a IA preenche em execução). */
export function buildStructuredOutputPreview(definition: StructuredOutputDefinition): Record<string, unknown> {
  function build(nodes: StructuredOutputNode[]): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const node of nodes) result[node.key] = node.kind === "GROUP" ? build(node.children) : previewValueFor(node)
    return result
  }
  return build(definition.nodes)
}

type JsonSchemaObject = { type: "object"; properties: Record<string, unknown>; required?: string[]; description?: string }

/** JSON Schema (draft 2020-12, subconjunto) derivado da definição — visão técnica e base para
 * um futuro uso nativo de Structured Outputs do provedor. Não é a validação de runtime (que é
 * `validateStructuredResult`, sem dependência de biblioteca) — os dois derivam da mesma fonte. */
export function buildStructuredOutputJsonSchema(definition: StructuredOutputDefinition): Record<string, unknown> {
  function objectFor(nodes: StructuredOutputNode[], description?: string): JsonSchemaObject {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const node of nodes) {
      if (node.kind === "GROUP") {
        properties[node.key] = objectFor(node.children, node.description)
        required.push(node.key)
        continue
      }
      const base: Record<string, unknown> = { title: node.label }
      if (node.description) base.description = node.description
      switch (node.type) {
        case "STRING":
          properties[node.key] = { ...base, type: "string", ...(node.example ? { examples: [node.example] } : {}) }
          break
        case "NUMBER":
          properties[node.key] = { ...base, type: "number", ...(node.minimum !== undefined ? { minimum: node.minimum } : {}), ...(node.maximum !== undefined ? { maximum: node.maximum } : {}) }
          break
        case "BOOLEAN":
          properties[node.key] = { ...base, type: "boolean" }
          break
        case "ENUM":
          properties[node.key] = { ...base, type: "string", enum: (node.options ?? []).map((option) => option.value) }
          break
        case "ARRAY":
          properties[node.key] = { ...base, type: "array", items: { type: "string" } }
          break
      }
      if (node.required) required.push(node.key)
    }
    const schema: JsonSchemaObject = { type: "object", properties }
    if (required.length > 0) schema.required = required
    if (description) schema.description = description
    return schema
  }
  return { $schema: "https://json-schema.org/draft/2020-12/schema", ...objectFor(definition.nodes) }
}

function contractSkeletonValue(field: StructuredOutputField): string {
  switch (field.type) {
    case "STRING":
      return '"texto"'
    case "NUMBER":
      return "número"
    case "BOOLEAN":
      return "true|false"
    case "ENUM":
      return `"${(field.options ?? []).map((option) => option.value).join("|")}"`
    case "ARRAY":
      return '["texto", ...]'
  }
}

function contractSkeleton(nodes: StructuredOutputNode[], indent: string): string {
  const lines = nodes.map((node) => {
    if (node.kind === "GROUP") return `${indent}  "${node.key}": ${contractSkeleton(node.children, `${indent}  `)}`
    return `${indent}  "${node.key}": ${contractSkeletonValue(node)}`
  })
  return `{\n${lines.join(",\n")}\n${indent}}`
}

function contractTypeSentence(field: StructuredOutputField): string {
  switch (field.type) {
    case "STRING":
      return "texto"
    case "NUMBER": {
      const range =
        field.minimum !== undefined && field.maximum !== undefined
          ? ` entre ${field.minimum} e ${field.maximum}`
          : field.minimum !== undefined
            ? ` a partir de ${field.minimum}`
            : field.maximum !== undefined
              ? ` até ${field.maximum}`
              : ""
      return `número${range}`
    }
    case "BOOLEAN":
      return "true ou false"
    case "ENUM":
      return `exatamente uma das opções: ${(field.options ?? []).map((option) => (option.label && option.label !== option.value ? `${option.value} (${option.label})` : option.value)).join(", ")}`
    case "ARRAY":
      return "lista de textos (array JSON de strings)"
  }
}

/**
 * Contrato enviado ao modelo — DERIVADO da definição, nunca editado à mão. Encaixa na frase que
 * `withStructuredOutputInstructions` já monta ("...um JSON válido representando: <contrato>"),
 * então começa em minúscula e termina com as regras por campo. Determinístico: a mesma
 * definição gera sempre o mesmo texto (testado).
 */
export function buildStructuredOutputContract(definition: StructuredOutputDefinition): string {
  const rules: string[] = []
  function visit(nodes: StructuredOutputNode[], parentPath: string): void {
    for (const node of nodes) {
      const path = joinPath(parentPath, node.key)
      if (node.kind === "GROUP") {
        rules.push(`- ${path} (${node.label}): objeto${node.description ? ` — ${node.description}` : ""}`)
        visit(node.children, path)
        continue
      }
      const parts = [`- ${path} (${node.label}): ${contractTypeSentence(node)}`, node.required ? "obrigatório" : "opcional (omita ou use null se não houver informação)"]
      if (node.description) parts.push(node.description)
      if (node.type === "STRING" && node.example?.trim()) parts.push(`Exemplo: "${node.example.trim()}"`)
      rules.push(parts.join("; "))
    }
  }
  visit(definition.nodes, "")
  return [
    `um objeto JSON exatamente com esta estrutura (mesmas chaves, sem chaves extras):`,
    contractSkeleton(definition.nodes, ""),
    `Regras por campo:`,
    ...rules,
    `Use apenas os valores permitidos em cada campo; nunca invente opções fora da lista. Campos obrigatórios precisam estar presentes.`,
  ].join("\n")
}

/* ------------------------------------------------------------------------------------------ */
/* Validação do resultado devolvido pela IA                                                     */
/* ------------------------------------------------------------------------------------------ */

export type StructuredResultIssue = { path: string; message: string }
export type StructuredResultValidation =
  | { valid: true; value: Record<string, unknown> }
  | { valid: false; issues: StructuredResultIssue[] }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalizeField(field: StructuredOutputField, raw: unknown, path: string, issues: StructuredResultIssue[]): unknown {
  switch (field.type) {
    case "STRING": {
      if (typeof raw === "string") return raw
      if (typeof raw === "number" || typeof raw === "boolean") return String(raw)
      issues.push({ path, message: `"${field.label}" deveria ser um texto, mas veio ${describeRaw(raw)}.` })
      return undefined
    }
    case "NUMBER": {
      const parsed = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" && !Number.isNaN(Number(raw.replace(",", "."))) ? Number(raw.replace(",", ".")) : Number.NaN
      if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
        issues.push({ path, message: `"${field.label}" deveria ser um número, mas veio ${describeRaw(raw)}.` })
        return undefined
      }
      if (field.minimum !== undefined && parsed < field.minimum) issues.push({ path, message: `"${field.label}" veio ${parsed}, abaixo do mínimo ${field.minimum}.` })
      if (field.maximum !== undefined && parsed > field.maximum) issues.push({ path, message: `"${field.label}" veio ${parsed}, acima do máximo ${field.maximum}.` })
      return parsed
    }
    case "BOOLEAN": {
      if (typeof raw === "boolean") return raw
      if (typeof raw === "string" && ["true", "false", "sim", "não", "nao"].includes(raw.trim().toLowerCase())) return ["true", "sim"].includes(raw.trim().toLowerCase())
      issues.push({ path, message: `"${field.label}" deveria ser Sim/Não (true/false), mas veio ${describeRaw(raw)}.` })
      return undefined
    }
    case "ENUM": {
      const options = field.options ?? []
      if (typeof raw !== "string") {
        issues.push({ path, message: `"${field.label}" deveria ser uma das opções (${options.map((option) => option.value).join(", ")}), mas veio ${describeRaw(raw)}.` })
        return undefined
      }
      const exact = options.find((option) => option.value === raw)
      if (exact) return exact.value
      const relaxed = options.find((option) => option.value.toLowerCase() === raw.trim().toLowerCase())
      if (relaxed) return relaxed.value
      issues.push({ path, message: `"${field.label}" veio "${raw}", que não está entre as opções permitidas (${options.map((option) => option.value).join(", ")}).` })
      return undefined
    }
    case "ARRAY": {
      if (!Array.isArray(raw)) {
        issues.push({ path, message: `"${field.label}" deveria ser uma lista, mas veio ${describeRaw(raw)}.` })
        return undefined
      }
      return raw.map((item) => (typeof item === "string" ? item : typeof item === "number" || typeof item === "boolean" ? String(item) : JSON.stringify(item)))
    }
  }
}

function describeRaw(raw: unknown): string {
  if (raw === null || raw === undefined) return "vazio"
  if (Array.isArray(raw)) return "uma lista"
  if (typeof raw === "object") return "um objeto"
  return `"${String(raw)}"`
}

/**
 * Valida (e normaliza) o JSON devolvido pela IA contra a definição: tipo, obrigatoriedade,
 * opções permitidas e estrutura. Chaves desconhecidas são ignoradas (nunca invalidam); campo
 * opcional ausente/null é omitido. Qualquer problema torna o resultado INVÁLIDO como um todo —
 * um Condition nunca recebe um campo inválido como se fosse válido.
 */
export function validateStructuredResult(definition: StructuredOutputDefinition, raw: unknown): StructuredResultValidation {
  const issues: StructuredResultIssue[] = []
  if (!isPlainObject(raw)) return { valid: false, issues: [{ path: "", message: "O resultado estruturado precisa ser um objeto JSON." }] }

  function visit(nodes: StructuredOutputNode[], source: Record<string, unknown>, parentPath: string): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const node of nodes) {
      const path = joinPath(parentPath, node.key)
      const value = source[node.key]
      if (node.kind === "GROUP") {
        if (value === undefined || value === null) {
          const hasRequiredDescendant = flattenStructuredOutput({ schemaVersion: 1, nodes: node.children }).some((field) => field.required)
          if (hasRequiredDescendant) issues.push({ path, message: `O grupo "${node.label}" não veio no resultado, mas tem campos obrigatórios.` })
          else result[node.key] = {}
          continue
        }
        if (!isPlainObject(value)) {
          issues.push({ path, message: `"${node.label}" deveria ser um grupo (objeto), mas veio ${describeRaw(value)}.` })
          continue
        }
        result[node.key] = visit(node.children, value, path)
        continue
      }
      if (value === undefined || value === null || (typeof value === "string" && value.trim() === "" && node.type !== "STRING")) {
        if (node.required) issues.push({ path, message: `O campo obrigatório "${node.label}" não veio no resultado.` })
        continue
      }
      const normalized = normalizeField(node, value, path, issues)
      if (normalized !== undefined) result[node.key] = normalized
    }
    return result
  }

  const value = visit(definition.nodes, raw, "")
  return issues.length > 0 ? { valid: false, issues } : { valid: true, value }
}

/** Linhas legíveis ("Análise › Severidade: Alta") — usadas pelo QA Lab. Sim/Não para
 * booleanos, rótulo da opção para ENUM, lista separada por vírgula para ARRAY. */
export function describeStructuredResult(definition: StructuredOutputDefinition, value: Record<string, unknown>): { path: string; label: string; displayValue: string }[] {
  const rows: { path: string; label: string; displayValue: string }[] = []
  function resolve(path: string): unknown {
    let current: unknown = value
    for (const segment of path.split(".")) {
      if (!isPlainObject(current)) return undefined
      current = current[segment]
    }
    return current
  }
  for (const field of flattenStructuredOutput(definition)) {
    const raw = resolve(field.path)
    let displayValue: string
    if (raw === undefined || raw === null) displayValue = "—"
    else if (typeof raw === "boolean") displayValue = raw ? "Sim" : "Não"
    else if (Array.isArray(raw)) displayValue = raw.length === 0 ? "(nenhum)" : raw.map(String).join(", ")
    else if (field.fieldType === "ENUM") displayValue = field.enumOptions?.find((option) => option.value === raw)?.label ?? String(raw)
    else displayValue = String(raw)
    rows.push({ path: field.path, label: field.label, displayValue })
  }
  return rows
}

/* ------------------------------------------------------------------------------------------ */
/* Legado: output_schema (grupos › campos) + output_instructions (texto livre)                  */
/* ------------------------------------------------------------------------------------------ */

/** Formato legado → definição. Paths preservados EXATAMENTE (grupo.campo); STRING com
 * `enumValues` vira ENUM; `required` nasce false (o legado nunca declarou obrigatoriedade —
 * marcar como obrigatório mudaria a validação silenciosamente). */
export function fromLegacyOutputSchema(schema: OutputSchema): StructuredOutputDefinition {
  return {
    schemaVersion: STRUCTURED_OUTPUT_SCHEMA_VERSION,
    nodes: schema.map((group) => ({
      kind: "GROUP",
      key: group.key,
      label: group.label,
      children: group.fields.map((field) => {
        const isEnum = field.type === "STRING" && field.enumValues !== undefined && field.enumValues.length > 0
        return {
          kind: "FIELD",
          key: field.key,
          label: field.label,
          type: isEnum ? "ENUM" : field.type,
          required: false,
          ...(field.description !== undefined && field.description !== "" ? { description: field.description } : {}),
          ...(isEnum ? { options: field.enumValues!.map((value) => ({ value })) } : {}),
        }
      }),
    })),
  }
}

/** Definição → formato legado (dual-write). Só é representável quando a definição é
 * exatamente "grupos na raiz, cada um só com campos" (o único formato que o legado conhece);
 * campo na raiz ou grupo aninhado → null (os leitores do produto já leem a definição). */
export function toLegacyOutputSchema(definition: StructuredOutputDefinition): OutputSchema | null {
  const groups: OutputSchema = []
  for (const node of definition.nodes) {
    if (node.kind !== "GROUP" || node.children.length === 0) return null
    const fields: OutputSchema[number]["fields"] = []
    for (const child of node.children) {
      if (child.kind !== "FIELD") return null
      fields.push({
        key: child.key,
        label: child.label,
        type: comparatorTypeFor(child.type),
        ...(child.type === "ENUM" ? { enumValues: (child.options ?? []).map((option) => option.value) } : {}),
        ...(child.description ? { description: child.description } : {}),
      })
    }
    groups.push({ key: node.key, label: node.label, fields })
  }
  return groups
}

export type StructuredOutputReview = {
  reason: "KEY_MISMATCH" | "UNVERIFIABLE"
  /** Chaves cadastradas nos campos (Builder) que o texto enviado à IA não pedia. */
  missingInInstructions: string[]
  /** Chaves pedidas à IA no texto antigo que os campos cadastrados não conhecem. */
  unknownInInstructions: string[]
  message: string
}

const LEGACY_REVIEW_MESSAGE = "Esta configuração antiga possui diferenças entre o formato solicitado à IA e os campos cadastrados. Revise o resultado estruturado."

function extractInstructionKeys(text: string): Set<string> {
  const keys = new Set<string>()
  for (const match of text.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g)) keys.add(match[1]!)
  for (const match of text.matchAll(/(?:^|[{,\s])([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) keys.add(match[1]!)
  return keys
}

/**
 * Configuração legada: compara as chaves pedidas à IA no texto livre com as chaves cadastradas
 * no metadado. Divergência NUNCA é corrigida em silêncio — vira revisão pendente exibida ao
 * admin; texto sem nenhuma chave reconhecível = "não foi possível conferir" (também revisão).
 */
export function detectLegacyDivergence(outputInstructions: string | null, schema: OutputSchema): StructuredOutputReview | null {
  const schemaKeys = new Set<string>()
  for (const group of schema) {
    schemaKeys.add(group.key)
    for (const field of group.fields) schemaKeys.add(field.key)
  }
  const instructionKeys = outputInstructions ? extractInstructionKeys(outputInstructions) : new Set<string>()
  if (instructionKeys.size === 0) {
    return { reason: "UNVERIFIABLE", missingInInstructions: [...schemaKeys], unknownInInstructions: [], message: LEGACY_REVIEW_MESSAGE }
  }
  const missingInInstructions = [...schemaKeys].filter((key) => !instructionKeys.has(key))
  const unknownInInstructions = [...instructionKeys].filter((key) => !schemaKeys.has(key))
  if (missingInInstructions.length === 0 && unknownInInstructions.length === 0) return null
  return { reason: "KEY_MISMATCH", missingInInstructions, unknownInInstructions, message: LEGACY_REVIEW_MESSAGE }
}

export type StructuredOutputSource = "DEFINITION" | "LEGACY_SCHEMA" | "LEGACY_INSTRUCTIONS" | "NONE"

export type EffectiveStructuredOutput = {
  /** Definição efetiva: persistida (DEFINITION) ou reconstruída do metadado legado (LEGACY_SCHEMA). */
  definition: StructuredOutputDefinition | null
  source: StructuredOutputSource
  /** Só para legado convertido com divergência/impossibilidade de conferência. */
  review: StructuredOutputReview | null
  /** Texto que vai para o modelo: contrato gerado (DEFINITION) ou o texto legado intacto. */
  llmInstructions: string | null
  /** Catálogo de campos (Builder/validação) — null quando não há nada estruturado. */
  fields: FlatOutputSchemaField[] | null
}

export type StructuredOutputRow = {
  structured_output?: unknown
  output_schema?: unknown
  output_instructions?: string | null
}

function safeLegacySchema(raw: unknown): OutputSchema | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const parsed = z
    .array(z.object({ key: z.string().min(1), label: z.string().min(1), fields: z.array(z.object({ key: z.string().min(1), label: z.string().min(1), type: z.enum(["STRING", "NUMBER", "BOOLEAN", "ARRAY"]), enumValues: z.array(z.string()).optional(), description: z.string().optional() })).min(1) }))
    .safeParse(raw)
  return parsed.success ? parsed.data : null
}

/**
 * DUAL-READ (transição): a definição nova, quando presente, manda em tudo (contrato + validação
 * + Builder). Sem ela, o legado continua valendo EXATAMENTE como antes — texto livre para o
 * modelo, metadado para o Builder, sem validação de runtime — até o admin revisar e salvar pela
 * nova tela (que grava a definição e passa a gerar os campos legados automaticamente).
 */
export function resolveEffectiveStructuredOutput(row: StructuredOutputRow): EffectiveStructuredOutput {
  if (row.structured_output !== null && row.structured_output !== undefined) {
    const parsed = structuredOutputDefinitionSchema.safeParse(row.structured_output)
    if (parsed.success) {
      return { definition: parsed.data, source: "DEFINITION", review: null, llmInstructions: buildStructuredOutputContract(parsed.data), fields: flattenStructuredOutput(parsed.data) }
    }
  }
  const legacySchema = safeLegacySchema(row.output_schema)
  const instructions = row.output_instructions?.trim() ? row.output_instructions : null
  if (legacySchema) {
    const definition = fromLegacyOutputSchema(legacySchema)
    return { definition, source: "LEGACY_SCHEMA", review: detectLegacyDivergence(instructions, legacySchema), llmInstructions: instructions, fields: flattenStructuredOutput(definition) }
  }
  if (instructions) return { definition: null, source: "LEGACY_INSTRUCTIONS", review: null, llmInstructions: instructions, fields: null }
  return { definition: null, source: "NONE", review: null, llmInstructions: null, fields: null }
}

/* ------------------------------------------------------------------------------------------ */
/* Diff entre definições (mudanças compatíveis × potencialmente breaking)                      */
/* ------------------------------------------------------------------------------------------ */

export type StructuredOutputBreakingChange =
  | { kind: "REMOVED"; path: string }
  | { kind: "TYPE_CHANGED"; path: string; from: StructuredOutputFieldType | "GROUP"; to: StructuredOutputFieldType | "GROUP" }
  | { kind: "ENUM_OPTION_REMOVED"; path: string; values: string[] }
  /** Opcional → obrigatório: um resultado que antes era válido sem este campo passa a ser
   * INVÁLIDO por inteiro (`structuredResult = null`) — afeta TODO consumidor do resultado desse
   * orquestrador, não só quem lê este path (ver `affectsWholeResult`). */
  | { kind: "REQUIRED_ADDED"; path: string }
  /** Faixa numérica mais estreita (mínimo maior, máximo menor ou limite novo): valores que antes
   * passavam viram resultado inválido por inteiro — mesmo alcance de REQUIRED_ADDED. */
  | { kind: "RANGE_NARROWED"; path: string; from: { minimum?: number; maximum?: number }; to: { minimum?: number; maximum?: number } }

/** Mudanças que invalidam o resultado INTEIRO (não só o path alterado): qualquer referência a
 * `structuredResult` desse orquestrador é impactada, porque a validação é tudo-ou-nada. */
export function affectsWholeResult(change: StructuredOutputBreakingChange): boolean {
  return change.kind === "REQUIRED_ADDED" || change.kind === "RANGE_NARROWED"
}

function indexNodes(definition: StructuredOutputDefinition): Map<string, StructuredOutputNode> {
  const map = new Map<string, StructuredOutputNode>()
  function visit(nodes: StructuredOutputNode[], parentPath: string): void {
    for (const node of nodes) {
      const path = joinPath(parentPath, node.key)
      map.set(path, node)
      if (node.kind === "GROUP") visit(node.children, path)
    }
  }
  visit(definition.nodes, "")
  return map
}

/**
 * Análise DIRECIONAL de compatibilidade:
 * - renomear/mover/apagar = REMOVED do path antigo; mudar tipo = TYPE_CHANGED;
 * - ENUM: tirar opção ou trocar o VALOR técnico = ENUM_OPTION_REMOVED (o valor antigo some);
 *   adicionar opção ou mudar só o rótulo (mesmo value) = compatível;
 * - obrigatoriedade: opcional → obrigatório = REQUIRED_ADDED (também um campo NOVO já obrigatório:
 *   respostas antigas não o trazem); obrigatório → opcional = compatível;
 * - NUMBER: estreitar a faixa (mínimo maior, máximo menor, limite novo) = RANGE_NARROWED;
 *   relaxar/remover limite = compatível;
 * - rótulo, descrição, campo novo = compatíveis (não aparecem; ficam só na auditoria normal).
 * `next = null` = desligar o resultado estruturado (tudo removido).
 */
export function diffStructuredOutput(previous: StructuredOutputDefinition | null, next: StructuredOutputDefinition | null): StructuredOutputBreakingChange[] {
  if (!previous) return []
  const before = indexNodes(previous)
  const after = next ? indexNodes(next) : new Map<string, StructuredOutputNode>()
  const changes: StructuredOutputBreakingChange[] = []
  for (const [path, node] of before) {
    const candidate = after.get(path)
    if (!candidate) {
      changes.push({ kind: "REMOVED", path })
      continue
    }
    const fromType = node.kind === "GROUP" ? "GROUP" : node.type
    const toType = candidate.kind === "GROUP" ? "GROUP" : candidate.type
    if (fromType !== toType) {
      changes.push({ kind: "TYPE_CHANGED", path, from: fromType, to: toType })
      continue
    }
    if (node.kind !== "FIELD" || candidate.kind !== "FIELD") continue
    if (node.type === "ENUM") {
      const nextValues = new Set((candidate.options ?? []).map((option) => option.value))
      const removed = (node.options ?? []).map((option) => option.value).filter((value) => !nextValues.has(value))
      if (removed.length > 0) changes.push({ kind: "ENUM_OPTION_REMOVED", path, values: removed })
    }
    if (!node.required && candidate.required) changes.push({ kind: "REQUIRED_ADDED", path })
    if (node.type === "NUMBER" && isNarrowerRange(node, candidate)) {
      changes.push({
        kind: "RANGE_NARROWED",
        path,
        from: { ...(node.minimum !== undefined ? { minimum: node.minimum } : {}), ...(node.maximum !== undefined ? { maximum: node.maximum } : {}) },
        to: { ...(candidate.minimum !== undefined ? { minimum: candidate.minimum } : {}), ...(candidate.maximum !== undefined ? { maximum: candidate.maximum } : {}) },
      })
    }
  }
  // Campo NOVO já obrigatório: um resultado que antes era válido não o traz — mesma quebra de
  // opcional → obrigatório. Campo novo opcional continua compatível.
  for (const [path, node] of after) {
    if (!before.has(path) && node.kind === "FIELD" && node.required) changes.push({ kind: "REQUIRED_ADDED", path })
  }
  return changes
}

/** O domínio aceito ficou menor? Limite novo onde não havia, mínimo maior ou máximo menor. */
function isNarrowerRange(previous: StructuredOutputField, next: StructuredOutputField): boolean {
  const minNarrower = next.minimum !== undefined && (previous.minimum === undefined || next.minimum > previous.minimum)
  const maxNarrower = next.maximum !== undefined && (previous.maximum === undefined || next.maximum < previous.maximum)
  return minNarrower || maxNarrower
}

/** Sugestão de chave técnica a partir do nome exibido — camelCase sem acentos (padrão já usado
 * pelos paths legados: "Requer acompanhamento" → requerAcompanhamento). Nunca reescreve uma
 * chave que o admin editou à mão (isso é decisão da UI). */
export function suggestStructuredOutputKey(label: string): string {
  const words = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return ""
  const camel = words.map((word, index) => (index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())).join("")
  return /^[0-9]/.test(camel) ? `campo${camel.charAt(0).toUpperCase()}${camel.slice(1)}` : camel
}
