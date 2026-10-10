import { z } from "zod"
import type { FlatOutputSchemaField } from "./output-schema-fields"

/**
 * Espelho de backend/src/modules/assistant/domain/structured-output-definition.ts — a FONTE
 * ÚNICA DA VERDADE do resultado estruturado do Orquestrador. O frontend usa este espelho só
 * para o construtor visual reagir em tempo real (árvore, prévia do JSON, campos do Workflow,
 * validação com mensagens humanas) sem request; o backend revalida e é a autoridade ao salvar.
 * O contrato enviado à IA NÃO é gerado aqui (só no backend, devolvido em `outputInstructions`).
 */

export const STRUCTURED_OUTPUT_SCHEMA_VERSION = 1 as const
export const STRUCTURED_OUTPUT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
export const STRUCTURED_OUTPUT_MAX_DEPTH = 4
export const STRUCTURED_OUTPUT_MAX_NODES = 120
export const STRUCTURED_OUTPUT_MAX_ENUM_OPTIONS = 50

export const structuredOutputFieldTypeSchema = z.enum(["STRING", "NUMBER", "BOOLEAN", "ENUM", "ARRAY"])
export type StructuredOutputFieldType = z.infer<typeof structuredOutputFieldTypeSchema>

/** Rótulos amigáveis — o usuário comum nunca vê STRING/BOOLEAN/ENUM. */
export const STRUCTURED_OUTPUT_FIELD_TYPE_LABELS: Record<StructuredOutputFieldType, string> = {
  STRING: "Texto",
  NUMBER: "Número",
  BOOLEAN: "Sim/Não",
  ENUM: "Lista de opções",
  ARRAY: "Lista de textos",
}

export const STRUCTURED_OUTPUT_FIELD_TYPE_HINTS: Record<StructuredOutputFieldType, string> = {
  STRING: 'Uma frase ou palavra. Ex.: "cobrança em duplicidade".',
  NUMBER: "Um valor numérico. Ex.: 8.5.",
  BOOLEAN: "Sim ou Não (true/false). Ex.: requer acompanhamento.",
  ENUM: "Uma escolha entre opções conhecidas. Ex.: BAIXA, MEDIA, ALTA, CRITICA.",
  ARRAY: 'Vários textos. Ex.: ["reparo", "troca de chip"].',
}

export const structuredOutputEnumOptionSchema = z.object({
  value: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120).optional(),
})
export type StructuredOutputEnumOption = z.infer<typeof structuredOutputEnumOptionSchema>

export const structuredOutputFieldSchema = z.object({
  kind: z.literal("FIELD"),
  key: z.string(),
  label: z.string(),
  type: structuredOutputFieldTypeSchema,
  required: z.boolean().default(false),
  description: z.string().optional(),
  example: z.string().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  options: z.array(structuredOutputEnumOptionSchema).optional(),
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
    z.object({ kind: z.literal("GROUP"), key: z.string(), label: z.string(), description: z.string().optional(), children: z.array(structuredOutputNodeSchema) }),
  ]),
) as z.ZodType<StructuredOutputNode>

export const structuredOutputDefinitionSchema = z.object({
  schemaVersion: z.literal(STRUCTURED_OUTPUT_SCHEMA_VERSION),
  nodes: z.array(structuredOutputNodeSchema),
})
export type StructuredOutputDefinition = z.infer<typeof structuredOutputDefinitionSchema>

export const structuredOutputReviewSchema = z.object({
  reason: z.enum(["KEY_MISMATCH", "UNVERIFIABLE"]),
  missingInInstructions: z.array(z.string()),
  unknownInInstructions: z.array(z.string()),
  message: z.string(),
})
export type StructuredOutputReview = z.infer<typeof structuredOutputReviewSchema>

export const structuredOutputSourceSchema = z.enum(["DEFINITION", "LEGACY_SCHEMA", "LEGACY_INSTRUCTIONS", "NONE"])
export type StructuredOutputSource = z.infer<typeof structuredOutputSourceSchema>

export const structuredOutputUsageSchema = z.object({
  workflowId: z.string(),
  workflowName: z.string(),
  published: z.boolean(),
  nodeId: z.string(),
  nodeLabel: z.string(),
  path: z.string(),
})
export type StructuredOutputUsage = z.infer<typeof structuredOutputUsageSchema>

export type StructuredOutputIssue = { nodePath: string; message: string }

export function joinStructuredPath(parentPath: string, key: string): string {
  return parentPath ? `${parentPath}.${key}` : key
}

function describeContainer(parentLabel: string | null): string {
  return parentLabel ? `dentro de ${parentLabel}` : "na raiz do resultado"
}

/** Mesmas regras (e mensagens) do backend — o construtor mostra o problema no item certo antes
 * de tentar salvar; o backend recusa a mesma coisa com 422 STRUCTURED_OUTPUT_INVALID. */
export function validateStructuredOutputDefinition(definition: StructuredOutputDefinition): StructuredOutputIssue[] {
  const issues: StructuredOutputIssue[] = []
  let nodeCount = 0

  function visit(nodes: StructuredOutputNode[], parentPath: string, parentLabel: string | null, depth: number): void {
    const seenKeys = new Map<string, string>()
    for (const node of nodes) {
      nodeCount += 1
      const path = joinStructuredPath(parentPath, node.key)
      const label = node.label.trim()
      if (!label) issues.push({ nodePath: path, message: `Informe o nome exibido do item ${describeContainer(parentLabel)}.` })
      if (!node.key.trim()) issues.push({ nodePath: path, message: `"${label || "(sem nome)"}" precisa de uma chave técnica.` })
      else if (!STRUCTURED_OUTPUT_KEY_PATTERN.test(node.key)) {
        issues.push({ nodePath: path, message: `A chave técnica "${node.key}" de "${label || node.key}" só pode ter letras, números e "_" e precisa começar com letra.` })
      }
      const duplicate = node.key ? seenKeys.get(node.key) : undefined
      if (duplicate) {
        issues.push({ nodePath: path, message: `Já existe um ${node.kind === "GROUP" ? "grupo ou campo" : "campo"} com a chave "${node.key}" ${describeContainer(parentLabel)} (usada por "${duplicate}").` })
      } else if (node.key) {
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
      }
      if (node.type === "NUMBER" && node.minimum !== undefined && node.maximum !== undefined && node.minimum > node.maximum) {
        issues.push({ nodePath: path, message: `Em "${label || node.key}", o mínimo (${node.minimum}) não pode ser maior que o máximo (${node.maximum}).` })
      }
    }
  }

  visit(definition.nodes, "", null, 1)
  if (definition.nodes.length === 0) issues.push({ nodePath: "", message: "Adicione ao menos um campo ou desative o resultado estruturado." })
  if (nodeCount > STRUCTURED_OUTPUT_MAX_NODES) issues.push({ nodePath: "", message: `O resultado estruturado tem ${nodeCount} itens — o máximo é ${STRUCTURED_OUTPUT_MAX_NODES}.` })
  return issues
}

export function comparatorTypeFor(type: StructuredOutputFieldType): FlatOutputSchemaField["type"] {
  return type === "ENUM" ? "STRING" : type
}

/** Mesmo achatamento do backend (`flattenStructuredOutput`) — path técnico + "Grupo › Campo". */
export function flattenStructuredOutput(definition: StructuredOutputDefinition): FlatOutputSchemaField[] {
  const fields: FlatOutputSchemaField[] = []
  function visit(nodes: StructuredOutputNode[], parentPath: string, parentLabels: string[]): void {
    for (const node of nodes) {
      const path = joinStructuredPath(parentPath, node.key)
      const labels = [...parentLabels, node.label]
      if (node.kind === "GROUP") {
        visit(node.children, path, labels)
        continue
      }
      fields.push({
        path,
        label: labels.join(" › "),
        type: comparatorTypeFor(node.type),
        fieldType: node.type,
        required: node.required,
        ...(node.type === "ENUM" ? { enumValues: (node.options ?? []).map((option) => option.value), enumOptions: (node.options ?? []).map((option) => ({ value: option.value, label: option.label ?? option.value })) } : {}),
        ...(node.description ? { description: node.description } : {}),
      })
    }
  }
  visit(definition.nodes, "", [])
  return fields
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

/** Prévia read-only — mesmos valores ilustrativos do backend. */
export function buildStructuredOutputPreview(definition: StructuredOutputDefinition): Record<string, unknown> {
  function build(nodes: StructuredOutputNode[]): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const node of nodes) result[node.key] = node.kind === "GROUP" ? build(node.children) : previewValueFor(node)
    return result
  }
  return build(definition.nodes)
}

/** JSON Schema derivado (visão técnica) — mesmo subconjunto do backend. */
export function buildStructuredOutputJsonSchema(definition: StructuredOutputDefinition): Record<string, unknown> {
  function objectFor(nodes: StructuredOutputNode[], description?: string): Record<string, unknown> {
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
    return { type: "object", properties, ...(required.length > 0 ? { required } : {}), ...(description ? { description } : {}) }
  }
  return { $schema: "https://json-schema.org/draft/2020-12/schema", ...objectFor(definition.nodes) }
}

/** Sugestão de chave técnica (camelCase sem acentos) — idêntica ao backend. */
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

/** Conta os campos folha de um nó (para a confirmação de exclusão de grupo). */
export function countStructuredFields(node: StructuredOutputNode): number {
  if (node.kind === "FIELD") return 1
  return node.children.reduce((total, child) => total + countStructuredFields(child), 0)
}

/** Resumo curto de um campo para a árvore: "Texto · obrigatório", "Lista · 4 opções". */
export function describeStructuredField(field: StructuredOutputField): string {
  const parts = [STRUCTURED_OUTPUT_FIELD_TYPE_LABELS[field.type]]
  if (field.type === "ENUM") parts[0] = `Lista · ${(field.options ?? []).length} ${(field.options ?? []).length === 1 ? "opção" : "opções"}`
  if (field.required) parts.push("obrigatório")
  return parts.join(" · ")
}
