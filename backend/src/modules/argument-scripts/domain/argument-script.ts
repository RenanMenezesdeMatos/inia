import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import { normalizeForLiteralQuote } from "../../knowledge/domain/knowledge-match.js"

/**
 * ARGUMENTÁRIO (`ARGUMENT_SCRIPT_CONTENT_V1`) — domínio puro. Evolução das "Regras de chamada": o cadastro deixa de ser uma frase
 * solta e passa a preservar o SIGNIFICADO de cada campo, para que o motor de feedback avalie cada coisa com a natureza certa:
 *
 *   condição/gatilho        SITUAÇÃO a reconhecer na conversa inteira (nunca busca de palavras; dívida atual ≠ dívida já paga ≠
 *                           contestação ≠ referência antiga; correção posterior conta)
 *   quando não se aplica    exceção explícita da situação
 *   orientação ao operador  o que DEVE (MUST) ou PODE (MAY) ser feito — a diferença é preservada; "pode" nunca vira obrigação.
 *                           `UNSPECIFIED` só existe no texto convertido do cadastro antigo e nunca vira critério.
 *   pontos obrigatórios     conteúdo a COMUNICAR quando a condição se aplica, em GRUPOS: ALL (todos exigidos) ou ANY (alternativas —
 *                           basta uma aplicável); cada item pode ter condição própria. Paráfrase equivalente cumpre.
 *   evitar                  condutas/promessas a evitar (avaliadas pela conduta observável e pelo contexto)
 *   argumentário sugerido   EXEMPLO de abordagem — nunca texto obrigatório, nunca comparado literalmente, nunca template
 *   referência p/ monitoria ajuda a reconhecer a evidência esperada — nunca uma segunda regra
 *
 * O argumentário COMPLEMENTA os procedimentos: não altera prazos, alçadas ou elegibilidade da base (conflito = registrado, sem
 * precedência inventada). Itens têm chave estável (`key`) gerada no servidor; a identidade do critério na memória inclui a chave, o
 * campo, o modo do grupo, a condição e o texto normalizado — mudou o sentido, mudou o critério (nunca une regras diferentes).
 */
export const ARGUMENT_SCRIPT_CONTENT_VERSION = 1 as const
export const ARGUMENT_CRITERIA_VERSION = "ARGUMENT_CRITERIA_V1" as const

export const GUIDANCE_MODALITIES = ["MUST", "MAY", "UNSPECIFIED"] as const
export type GuidanceModality = (typeof GUIDANCE_MODALITIES)[number]
export const POINT_GROUP_MODES = ["ALL", "ANY"] as const
export type PointGroupMode = (typeof POINT_GROUP_MODES)[number]

const MAX_TEXT = 1_200
const MAX_LONG_TEXT = 4_000
const MAX_ITEMS = 30
const text = (max = MAX_TEXT) => z.string().trim().min(1).max(max)
const optionalText = (max = MAX_TEXT) => z.string().trim().max(max).nullish().transform((value) => (value && value.length > 0 ? value : null))
const keySchema = z.string().trim().regex(/^[A-Za-z0-9-]{1,64}$/).nullish()

export const guidanceItemSchema = z.object({ key: keySchema, text: text(), modality: z.enum(GUIDANCE_MODALITIES) })
export const pointItemSchema = z.object({ key: keySchema, text: text(), condition: optionalText() })
export const pointGroupSchema = z.object({ key: keySchema, mode: z.enum(POINT_GROUP_MODES), items: z.array(pointItemSchema).min(1).max(MAX_ITEMS) })
export const avoidItemSchema = z.object({ key: keySchema, text: text() })

/** Entrada do formulário (chaves opcionais: item novo ganha chave no servidor; item editado mantém a sua). */
export const argumentScriptContentInputSchema = z.object({
  trigger: optionalText(),
  notApplicableWhen: optionalText(),
  operatorGuidance: z.array(guidanceItemSchema).max(MAX_ITEMS).default([]),
  requiredPoints: z.array(pointGroupSchema).max(10).default([]),
  avoid: z.array(avoidItemSchema).max(MAX_ITEMS).default([]),
  suggestedScript: optionalText(MAX_LONG_TEXT),
  monitoringReference: optionalText(MAX_LONG_TEXT),
  legacyExpectation: optionalText(MAX_LONG_TEXT),
})
export type ArgumentScriptContentInput = z.input<typeof argumentScriptContentInputSchema>

export type GuidanceItem = { key: string; text: string; modality: GuidanceModality }
export type PointItem = { key: string; text: string; condition: string | null }
export type PointGroup = { key: string; mode: PointGroupMode; items: PointItem[] }
export type AvoidItem = { key: string; text: string }
export type ArgumentScriptContent = {
  schemaVersion: typeof ARGUMENT_SCRIPT_CONTENT_VERSION
  trigger: string | null
  notApplicableWhen: string | null
  operatorGuidance: GuidanceItem[]
  requiredPoints: PointGroup[]
  avoid: AvoidItem[]
  suggestedScript: string | null
  monitoringReference: string | null
  /** Texto da antiga "Regra de chamada", preservado literalmente na conversão automática. */
  legacyExpectation?: string | null
}

const newKey = () => randomUUID().replace(/-/g, "").slice(0, 12)

/** Normaliza o conteúdo (chaves estáveis, nulos explícitos). Chave repetida dentro do conteúdo vira nova — nunca duas iguais. */
export function normalizeArgumentScriptContent(input: unknown): ArgumentScriptContent {
  const parsed = argumentScriptContentInputSchema.parse(input ?? {})
  const seen = new Set<string>()
  const keyOf = (key: string | null | undefined) => {
    const value = key && !seen.has(key) ? key : newKey()
    seen.add(value)
    return value
  }
  return {
    schemaVersion: ARGUMENT_SCRIPT_CONTENT_VERSION,
    trigger: parsed.trigger,
    notApplicableWhen: parsed.notApplicableWhen,
    operatorGuidance: parsed.operatorGuidance.map((item) => ({ key: keyOf(item.key), text: item.text, modality: item.modality })),
    requiredPoints: parsed.requiredPoints.map((group) => ({ key: keyOf(group.key), mode: group.mode, items: group.items.map((item) => ({ key: keyOf(item.key), text: item.text, condition: item.condition })) })),
    avoid: parsed.avoid.map((item) => ({ key: keyOf(item.key), text: item.text })),
    suggestedScript: parsed.suggestedScript,
    monitoringReference: parsed.monitoringReference,
    ...(parsed.legacyExpectation ? { legacyExpectation: parsed.legacyExpectation } : {}),
  }
}

/** Leitura tolerante do JSON persistido (versões antigas/convertidas): nunca lança — conteúdo ilegível vira vazio. */
export function readStoredContent(value: unknown): ArgumentScriptContent {
  try {
    const raw = (value ?? {}) as Record<string, unknown>
    return {
      schemaVersion: ARGUMENT_SCRIPT_CONTENT_VERSION,
      trigger: typeof raw.trigger === "string" && raw.trigger.trim() ? raw.trigger.trim() : null,
      notApplicableWhen: typeof raw.notApplicableWhen === "string" && raw.notApplicableWhen.trim() ? raw.notApplicableWhen.trim() : null,
      operatorGuidance: Array.isArray(raw.operatorGuidance) ? raw.operatorGuidance.flatMap((item) => { const parsed = guidanceItemSchema.safeParse(item); return parsed.success && parsed.data.key ? [{ key: parsed.data.key, text: parsed.data.text, modality: parsed.data.modality }] : [] }) : [],
      requiredPoints: Array.isArray(raw.requiredPoints) ? raw.requiredPoints.flatMap((group) => { const parsed = pointGroupSchema.safeParse(group); return parsed.success && parsed.data.key ? [{ key: parsed.data.key, mode: parsed.data.mode, items: parsed.data.items.flatMap((item) => (item.key ? [{ key: item.key, text: item.text, condition: item.condition }] : [])) }] : [] }) : [],
      avoid: Array.isArray(raw.avoid) ? raw.avoid.flatMap((item) => { const parsed = avoidItemSchema.safeParse(item); return parsed.success && parsed.data.key ? [{ key: parsed.data.key, text: parsed.data.text }] : [] }) : [],
      suggestedScript: typeof raw.suggestedScript === "string" && raw.suggestedScript.trim() ? raw.suggestedScript.trim() : null,
      monitoringReference: typeof raw.monitoringReference === "string" && raw.monitoringReference.trim() ? raw.monitoringReference.trim() : null,
      ...(typeof raw.legacyExpectation === "string" && raw.legacyExpectation.trim() ? { legacyExpectation: raw.legacyExpectation } : {}),
    }
  } catch {
    return { schemaVersion: ARGUMENT_SCRIPT_CONTENT_VERSION, trigger: null, notApplicableWhen: null, operatorGuidance: [], requiredPoints: [], avoid: [], suggestedScript: null, monitoringReference: null }
  }
}

/** Hash do CONTEÚDO (ordem das chaves fixa): identifica a versão na chave da análise e detecta rascunho sem mudança. */
export function contentHashOf(content: ArgumentScriptContent): string {
  return createHash("sha256").update(JSON.stringify(content, sortedReplacer)).digest("hex")
}
function sortedReplacer(_key: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
}

/** Itens que o motor pode AVALIAR (critérios): orientação MUST/MAY, pontos obrigatórios e condutas a evitar. */
export function evaluableItemCount(content: ArgumentScriptContent): number {
  return content.operatorGuidance.filter((item) => item.modality !== "UNSPECIFIED").length + content.requiredPoints.reduce((sum, group) => sum + group.items.length, 0) + content.avoid.length
}
/** Conteúdo que só tem o texto convertido do cadastro antigo (nenhum campo estruturado): nunca vira critério. */
export const isUnstructuredLegacy = (content: ArgumentScriptContent) => evaluableItemCount(content) === 0

export type PublishIssue = { field: string; code: string; message: string }
/**
 * Pronto para publicar? Um argumentário com algo a avaliar precisa da CONDIÇÃO/GATILHO (sem ela o motor não tem como saber quando
 * a exigência vale). Grupo de alternativas precisa de ao menos duas opções. Conteúdo só com o texto legado continua publicável
 * (é o estado convertido; não cria critério).
 */
export function publishIssuesOf(content: ArgumentScriptContent, input: { name: string; businessDomainId: string | null; conversion: "NATIVE" | "LEGACY_UNSTRUCTURED" }): PublishIssue[] {
  const issues: PublishIssue[] = []
  if (input.name.trim().length < 3) issues.push({ field: "name", code: "ARGUMENT_SCRIPT_NAME_REQUIRED", message: "Informe o nome do argumentário." })
  if (input.conversion === "NATIVE" && !input.businessDomainId) issues.push({ field: "businessDomainId", code: "ARGUMENT_SCRIPT_AREA_REQUIRED", message: "Informe a área responsável." })
  const evaluable = evaluableItemCount(content)
  if (evaluable === 0 && !content.legacyExpectation) issues.push({ field: "content", code: "ARGUMENT_SCRIPT_EMPTY", message: "Cadastre ao menos uma orientação, um ponto obrigatório ou uma conduta a evitar." })
  if (evaluable > 0 && !content.trigger) issues.push({ field: "trigger", code: "ARGUMENT_SCRIPT_TRIGGER_REQUIRED", message: "Informe a condição ou gatilho: sem ela não há como saber quando o argumentário vale." })
  content.requiredPoints.forEach((group, index) => {
    if (group.mode === "ANY" && group.items.length < 2) issues.push({ field: `requiredPoints.${index}`, code: "ARGUMENT_SCRIPT_ALTERNATIVES_NEED_TWO", message: "Um grupo de alternativas precisa de pelo menos duas opções." })
  })
  return issues
}

// ---------------------------------------------------------------------------------------------
// Identidade dos critérios (memória do motor)
// ---------------------------------------------------------------------------------------------
export type ArgumentItemField = "GUIDANCE" | "REQUIRED_POINT" | "AVOID"
/** Um item avaliável do argumentário (critério): grupo ANY vira UM item (as alternativas juntas são uma exigência só). */
export type ArgumentCriterionItem = {
  itemKey: string
  field: ArgumentItemField
  text: string
  modality: GuidanceModality | null
  groupMode: PointGroupMode | null
  /** Alternativas de um grupo ANY (texto de cada opção). */
  alternatives: string[] | null
  condition: string | null
}

export function criterionItemsOf(content: ArgumentScriptContent): ArgumentCriterionItem[] {
  const items: ArgumentCriterionItem[] = []
  for (const item of content.operatorGuidance) {
    if (item.modality === "UNSPECIFIED") continue
    items.push({ itemKey: item.key, field: "GUIDANCE", text: item.text, modality: item.modality, groupMode: null, alternatives: null, condition: null })
  }
  for (const group of content.requiredPoints) {
    if (group.mode === "ANY") {
      items.push({ itemKey: group.key, field: "REQUIRED_POINT", text: `Pelo menos uma destas alternativas: ${group.items.map((item, index) => `(${index + 1}) ${item.text}${item.condition ? ` [quando: ${item.condition}]` : ""}`).join("; ")}`, modality: null, groupMode: "ANY", alternatives: group.items.map((item) => item.text), condition: null })
      continue
    }
    for (const item of group.items) items.push({ itemKey: item.key, field: "REQUIRED_POINT", text: item.text, modality: null, groupMode: "ALL", alternatives: null, condition: item.condition })
  }
  for (const item of content.avoid) items.push({ itemKey: item.key, field: "AVOID", text: item.text, modality: null, groupMode: null, alternatives: null, condition: null })
  return items
}

/** Identidade estável do critério de argumentário: `AG-<12 hex>` de argumentário + chave + campo + modo + modalidade + condição + texto normalizado. */
export function argumentCriterionKeyOf(scriptId: string, item: Pick<ArgumentCriterionItem, "itemKey" | "field" | "text" | "modality" | "groupMode" | "condition">): string {
  const material = [ARGUMENT_CRITERIA_VERSION, scriptId, item.itemKey, item.field, item.groupMode ?? "", item.modality ?? "", item.condition ? normalizeForLiteralQuote(item.condition) : "", normalizeForLiteralQuote(item.text)].join("|")
  return `AG-${createHash("sha256").update(material).digest("hex").slice(0, 12)}`
}

export type ArgumentIdentityBasis = "FIRST_SEEN" | "UNCHANGED" | "MODIFIED"
/** Relação do item com a versão PUBLICADA anterior (mesma chave de item): igual, modificado (chave nova, anterior registrada) ou novo. */
export function argumentIdentityOf(scriptId: string, item: ArgumentCriterionItem, previous: ArgumentScriptContent | null): { criterionKey: string; basis: ArgumentIdentityBasis; previousCriterionKey: string | null } {
  const criterionKey = argumentCriterionKeyOf(scriptId, item)
  const before = previous ? criterionItemsOf(previous).find((entry) => entry.itemKey === item.itemKey) : undefined
  if (!before) return { criterionKey, basis: "FIRST_SEEN", previousCriterionKey: null }
  const previousKey = argumentCriterionKeyOf(scriptId, before)
  return previousKey === criterionKey ? { criterionKey, basis: "UNCHANGED", previousCriterionKey: null } : { criterionKey, basis: "MODIFIED", previousCriterionKey: previousKey }
}

// ---------------------------------------------------------------------------------------------
// Escopo e vigência
// ---------------------------------------------------------------------------------------------
export type ScriptScope = { scopeType: "ALL_TEAMS" | "TEAM" | "SUBTEAM"; teamId: string | null; subteamId: string | null }
/** O argumentário vale para um colaborador deste Grupo/Subgrupo? (todos → sim; Grupo → o Grupo e seus Subgrupos; Subgrupo → só ele) */
export function scopeAppliesTo(scope: ScriptScope, person: { teamId: string | null; subteamId: string | null }): boolean {
  if (scope.scopeType === "ALL_TEAMS") return true
  if (scope.scopeType === "TEAM") return scope.teamId !== null && scope.teamId === person.teamId
  return scope.subteamId !== null && scope.subteamId === person.subteamId
}
/** Especificidade (Subgrupo > Grupo > todos): só ORDENA a apresentação; nunca é precedência entre regras. */
export const scopeSpecificity = (scope: ScriptScope) => (scope.scopeType === "SUBTEAM" ? 0 : scope.scopeType === "TEAM" ? 1 : 2)

/** Vigência na data: início ≤ data < fim. Publicada depois da chamada nunca vale para ela. */
export function inForceAt(version: { effectiveFrom: Date | null; effectiveUntil: Date | null }, at: Date): boolean {
  if (!version.effectiveFrom) return false
  return version.effectiveFrom.getTime() <= at.getTime() && (!version.effectiveUntil || at.getTime() < version.effectiveUntil.getTime())
}

/** Tolerância do relógio ao publicar com início "agora" (o formulário manda a hora local; nunca retroativo além disto). */
export const PUBLISH_BACKDATE_TOLERANCE_MS = 5 * 60_000

export const FIELD_LABEL: Record<ArgumentItemField, string> = { GUIDANCE: "Orientação ao operador", REQUIRED_POINT: "Pontos obrigatórios na fala", AVOID: "Condutas ou promessas a evitar" }

// ---------------------------------------------------------------------------------------------
// Fonte para o motor de feedback
// ---------------------------------------------------------------------------------------------
/** Argumentário VIGENTE NA DATA DA CHAMADA, no escopo do colaborador — como o motor o recebe (análise, revisão e composição usam a
 * MESMA versão; ela entra na chave da análise). `identities` = identidade de cada item avaliável na memória. */
export type ArgumentScriptSource = {
  scriptId: string
  versionId: string
  version: number
  name: string
  areaName: string | null
  scope: ScriptScope & { teamName: string | null; subteamName: string | null }
  subjectName: string | null
  conversion: "NATIVE" | "LEGACY_UNSTRUCTURED"
  content: ArgumentScriptContent
  contentHash: string
  effectiveFrom: Date
  effectiveUntil: Date | null
  sourceDocumentId: string | null
  sourceDocumentTitle: string | null
  sourceReference: string | null
  /**
   * Regra vigente na data da chamada (padrão; o carregador do produto só devolve versões vigentes) × REAVALIAÇÃO pela regra atual
   * (avaliação isolada de uma chamada anterior à publicação — nunca finge vigência, nunca vira culpa histórica).
   */
  perspective?: "RULE_IN_FORCE_AT_CALL" | "CURRENT_RULE_REEVALUATION"
  identities: ReadonlyMap<string, { criterionKey: string; basis: ArgumentIdentityBasis; previousCriterionKey: string | null }>
}

export function argumentScriptSourceOf(input: Omit<ArgumentScriptSource, "identities">, previous: ArgumentScriptContent | null): ArgumentScriptSource {
  const identities = new Map(criterionItemsOf(input.content).map((item) => [item.itemKey, argumentIdentityOf(input.scriptId, item, previous)]))
  return { ...input, identities }
}
