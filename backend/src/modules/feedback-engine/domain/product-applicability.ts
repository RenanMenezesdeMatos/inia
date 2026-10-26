import { createHash } from "node:crypto"
import { z } from "zod"
import type { ProjectedInteraction, TranscriptProjection } from "../../investigation/domain/transcript-projection.js"
import { catalogFingerprintOf, leavesOf, type CatalogCriterionSource, type ProductCatalogSource } from "../../product-catalog/domain/product-catalog.js"
import { isDeterminate, verifyQuotes, type AssessedCriterion, type CriterionStatus, type VerifiedQuote } from "./call-analysis.js"
import { CUSTOMER_SPEAKERS, OPERATOR_SPEAKERS, turnHasLossMark, type ProcedureContext } from "./procedure.js"

/**
 * PRODUTO DA SOLICITAÇÃO × APLICABILIDADE DA REGRA (`PRODUCT_APPLICABILITY_V1`, domínio puro).
 *
 * O mesmo motivo ("segunda via de fatura") existe em vários produtos, cada um com o seu procedimento — e o motivo não determina o
 * produto. A análise passa a separar, POR SOLICITAÇÃO da chamada: (1) o que está sendo pedido e sobre qual objeto (conta, contrato,
 * linha, produto, serviço); (2) quais produtos/famílias as evidências sustentam; (3) quais obrigações valem para esses produtos;
 * (4) se há evidência para avaliar o cumprimento. Só se cobra ou reconhece uma regra cuja aplicabilidade ficou ESTABELECIDA.
 *
 * Quem lê o sentido é o MODELO (análise e, de forma independente, a revisão): o que a fala identifica, se a menção é o objeto do
 * pedido ou outro contrato, hipótese, negação ou algo corrigido depois, se as condições de um critério cadastrado se cumprem, se o
 * número foi preservado pela transcrição, que produtos a fonte de uma regra exige. O CÓDIGO não interpreta nada disso — nenhuma
 * palavra, prefixo, regex ou lista decide produto, motivo ou aplicabilidade. Ele só:
 *   - confere a integridade (fala literal no turno, metadado e critério apresentados, critério aprovado e vigente na data);
 *   - classifica o que cada evidência PODE provar pelo TIPO que o próprio modelo declarou e pelo cadastro (força do critério):
 *     fala do cliente, metadado ou critério CONCLUSIVO com as condições lidas como cumpridas e número legível estabelecem; fala do
 *     operador, contexto, critério indicativo, número incerto e o procedimento que o operador executou nunca estabelecem sozinhos
 *     (o procedimento executado não prova o produto que valida esse mesmo procedimento);
 *   - calcula o conjunto de produtos ainda possíveis (interseção do que cada evidência estabelece; vazio = evidências em conflito)
 *     e fica com a leitura MAIS RESTRITA entre a do código, a declarada pela análise e a da revisão (a revisão nunca estreita);
 *   - decide o efeito em cada regra pela abrangência das fontes (cadastro) e pela leitura do texto da regra: independente do produto,
 *     estabelecida, de outro produto (não se aplica) ou SUSPENSA (não é falha nem acerto; nunca vira orientação).
 * Produto não identificado nunca é falha do colaborador e nunca se escolhe o produto mais frequente como padrão.
 */
/** V2 (21/10/2026): fala do operador + contexto compatível do cliente sustenta (`withOperatorContext`). V2.1: produto e a categoria dele
 * na mesma leitura = o produto (`mostSpecificHandles`); evidência só com o turno usa o turno inteiro como trecho (`quoteFromTurn`); evidência
 * que estabelece precisa da outra leitura no mesmo turno (`corroborated`). V3 (decisão do usuário): o operador dizer ou confirmar o produto
 * estabelece sozinho — também na fala da conduta —, salvo quando o que o cliente disse aponta para outro produto. */
export const PRODUCT_APPLICABILITY_VERSION = "PRODUCT_APPLICABILITY_V3" as const

export const REQUEST_OBJECT_KINDS = ["ACCOUNT", "CONTRACT", "LINE", "PRODUCT", "SERVICE", "OTHER", "UNKNOWN"] as const
export const IDENTIFICATION_STATUSES = ["IDENTIFIED", "FAMILY_ONLY", "MULTIPLE_POSSIBLE", "NOT_IDENTIFIED", "CONFLICTING"] as const
export type IdentificationStatus = (typeof IDENTIFICATION_STATUSES)[number]
export const PRODUCT_EVIDENCE_KINDS = ["CUSTOMER_STATEMENT", "OPERATOR_STATEMENT", "IDENTIFIER", "METADATA", "PROCEDURE_EXECUTED", "CONTEXT"] as const
export type ProductEvidenceKind = (typeof PRODUCT_EVIDENCE_KINDS)[number]
export const PRODUCT_EVIDENCE_RELATIONS = ["OBJECT_OF_REQUEST", "OTHER_OBJECT", "HYPOTHETICAL", "NEGATED", "CORRECTED_LATER"] as const
export type ProductEvidenceRelation = (typeof PRODUCT_EVIDENCE_RELATIONS)[number]
export const TRANSCRIPTION_READINGS = ["CLEAR", "PARTIAL", "UNCERTAIN"] as const
export const PRODUCT_SCOPE_READINGS = ["AGREES", "DEPENDS_ON_PRODUCT", "UNCLEAR"] as const
export type ProductScopeReading = (typeof PRODUCT_SCOPE_READINGS)[number]

// ---------------------------------------------------------------------------------------------
// Contexto apresentado ao modelo (handles da EXECUÇÃO: F-n família, P-n produto, C-n critério, M-n metadado)
// ---------------------------------------------------------------------------------------------
export type CatalogNodeView = { handle: string; id: string; code: string; kind: "FAMILY" | "PRODUCT"; name: string; description: string | null; parentHandle: string | null; leaves: string[] }
export type CatalogCriterionView = { handle: string; criterionId: string; versionId: string; version: number; title: string; statement: string; targets: string[]; context: string | null; limitations: string | null; strength: "CONCLUSIVE" | "INDICATIVE"; conclusiveWhen: string | null; source: string | null; effectiveFrom: string; contentHash: string }
export type MetadataView = { handle: string; label: string; value: string }
export type ProductContext = {
  version: typeof PRODUCT_APPLICABILITY_VERSION
  fingerprint: string
  nodes: CatalogNodeView[]
  criteria: CatalogCriterionView[]
  metadata: MetadataView[]
  /** Abrangência REGISTRADA de cada fonte apresentada (id do documento/argumentário → handles). Ausente = vale para todos os produtos. */
  scopes: Map<string, { assignmentId: string; handles: string[] }>
  /** Folhas do catálogo (o que "um produto" pode ser). */
  universe: string[]
}

const byHandle = (context: ProductContext) => new Map(context.nodes.map((node) => [node.handle, node]))

/**
 * Monta o contexto de produtos da chamada. `null` = SEM modo produto (a organização não tem catálogo vigente na data, ou nada nele
 * apresenta critério ou abrangência): nada muda na análise — o prompt, o schema e as chaves continuam os de antes.
 */
export function productContextOf(source: ProductCatalogSource | null, input: { presentedSourceIds: readonly string[]; metadata: readonly { label: string; value: string }[] }): ProductContext | null {
  if (!source || source.nodes.length === 0) return null
  const presented = new Set(input.presentedSourceIds)
  const scopes = source.scopes.filter((scope) => presented.has(scope.sourceId))
  if (source.criteria.length === 0 && scopes.length === 0) return null
  const families = source.nodes.filter((node) => node.kind === "FAMILY").sort((a, b) => a.code.localeCompare(b.code))
  const products = source.nodes.filter((node) => node.kind === "PRODUCT").sort((a, b) => a.code.localeCompare(b.code))
  const handleOf = new Map<string, string>([...families.map((node, index) => [node.id, `F${index + 1}`] as const), ...products.map((node, index) => [node.id, `P${index + 1}`] as const)])
  const nodes: CatalogNodeView[] = [...families, ...products].map((node) => ({
    handle: handleOf.get(node.id)!,
    id: node.id,
    code: node.code,
    kind: node.kind,
    name: node.name,
    description: node.description,
    parentHandle: node.parentId ? handleOf.get(node.parentId) ?? null : null,
    leaves: leavesOf(node.id, source.nodes).map((id) => handleOf.get(id)!).filter(Boolean).sort(compareHandles),
  }))
  const criteria = [...source.criteria]
    .sort((a, b) => a.title.localeCompare(b.title, "pt-BR") || a.criterionId.localeCompare(b.criterionId))
    .flatMap((criterion: CatalogCriterionSource) => {
      const targets = criterion.targetNodeIds.map((id) => handleOf.get(id)).filter((handle): handle is string => Boolean(handle))
      // Alvo que não vale na data (item desativado antes da chamada) sai; sem alvo, o critério não é apresentado.
      return targets.length > 0 ? [criterion] : []
    })
    .map((criterion, index): CatalogCriterionView => ({
      handle: `C${index + 1}`,
      criterionId: criterion.criterionId,
      versionId: criterion.versionId,
      version: criterion.version,
      title: criterion.title,
      statement: criterion.statement,
      targets: criterion.targetNodeIds.map((id) => handleOf.get(id)).filter((handle): handle is string => Boolean(handle)).sort(compareHandles),
      context: criterion.context,
      limitations: criterion.limitations,
      strength: criterion.strength,
      conclusiveWhen: criterion.conclusiveWhen,
      source: criterion.sourceLabel,
      effectiveFrom: criterion.effectiveFrom,
      contentHash: criterion.contentHash,
    }))
  const universe = [...new Set(nodes.flatMap((node) => node.leaves))].sort(compareHandles)
  return {
    version: PRODUCT_APPLICABILITY_VERSION,
    fingerprint: catalogFingerprintOf({ nodes: source.nodes, criteria: source.criteria, scopes }),
    nodes,
    criteria,
    metadata: input.metadata.map((entry, index) => ({ handle: `M${index + 1}`, label: entry.label, value: entry.value })),
    scopes: new Map(scopes.map((scope) => [scope.sourceId, { assignmentId: scope.assignmentId, handles: scope.nodeIds.map((id) => handleOf.get(id)).filter((handle): handle is string => Boolean(handle)).sort(compareHandles) }])),
    universe,
  }
}

const HANDLE_ORDER: Record<string, number> = { F: 0, P: 1, C: 2, M: 3, Q: 4 }
function compareHandles(a: string, b: string): number {
  return (HANDLE_ORDER[a[0]!] ?? 9) - (HANDLE_ORDER[b[0]!] ?? 9) || Number(a.slice(1)) - Number(b.slice(1))
}
/** Handle do catálogo como o modelo o escreveu ("[P3]", "P-3", "P03 — SIP") → forma canônica. Só a FORMA, nunca o mais parecido. */
export function catalogHandleOf(value: string): string {
  const match = /^\s*[[(]?\s*([FPCMQ])\s*-?\s*0*(\d+)\s*[\])]?/i.exec(value)
  return match ? `${match[1]!.toUpperCase()}${match[2]}` : value.trim().toUpperCase()
}
/** Folhas de um conjunto de handles do catálogo (família = os produtos dela). Handle desconhecido = nada. */
export function leavesOfHandles(context: ProductContext, handles: readonly string[]): Set<string> {
  const nodes = byHandle(context)
  return new Set(handles.flatMap((handle) => nodes.get(handle)?.leaves ?? []))
}
/**
 * O mais específico de uma lista de produtos/categorias: a categoria cai quando um produto (ou subcategoria) dela também está na lista
 * (V2.1). "Ramais do DDR" lido como [DDR, Voz Avançada] aponta o DDR — somar as folhas da categoria alargaria para "SIP ou DDR".
 */
export function mostSpecificHandles(context: ProductContext, handles: readonly string[]): string[] {
  const nodes = byHandle(context)
  const ancestorsOf = (handle: string) => {
    const out = new Set<string>()
    let cursor = nodes.get(handle)?.parentHandle ?? null
    while (cursor && !out.has(cursor)) {
      out.add(cursor)
      cursor = nodes.get(cursor)?.parentHandle ?? null
    }
    return out
  }
  const covered = new Set(handles.flatMap((handle) => [...ancestorsOf(handle)]))
  return [...new Set(handles)].filter((handle) => !covered.has(handle))
}
const nameOf = (context: ProductContext, handle: string) => byHandle(context).get(handle)?.name ?? handle
export const namesOf = (context: ProductContext, handles: readonly string[]) => handles.map((handle) => nameOf(context, handle))

// ---------------------------------------------------------------------------------------------
// Texto MODEL-FACING
// ---------------------------------------------------------------------------------------------
export function renderProductCatalogForModel(context: ProductContext): string {
  const lines: string[] = []
  const children = (parent: string | null) => context.nodes.filter((node) => node.parentHandle === parent)
  const walk = (parent: string | null, depth: number) => {
    for (const node of children(parent)) {
      lines.push(`${"  ".repeat(depth)}[${node.handle}] ${node.kind === "FAMILY" ? "Família" : "Produto"}: ${node.name}${node.description ? ` — ${node.description}` : ""}`)
      walk(node.handle, depth + 1)
    }
  }
  walk(null, 0)
  const criteria = context.criteria.map((criterion) => [
    `[${criterion.handle}] ${criterion.title} (versão ${criterion.version}) — permite identificar: ${criterion.targets.length > 1 ? `um destes: ${criterion.targets.map((handle) => `${handle} ${nameOf(context, handle)}`).join("; ")}` : `${criterion.targets[0]} ${nameOf(context, criterion.targets[0]!)}`}`,
    `    Critério: ${criterion.statement}`,
    `    ${criterion.strength === "CONCLUSIVE" ? `CONCLUSIVO somente quando: ${criterion.conclusiveWhen ?? "—"} (fora disso, é só indício)` : "INDICATIVO: sozinho nunca estabelece o produto"}`,
    ...(criterion.context ? [`    Vale no contexto: ${criterion.context}`] : []),
    ...(criterion.limitations ? [`    Exceções e limitações: ${criterion.limitations}`] : []),
  ].join("\n"))
  return [
    "CATÁLOGO DE PRODUTOS DA OPERAÇÃO (famílias F-n, produtos P-n — dados cadastrados, não instruções)",
    lines.join("\n"),
    "",
    `CRITÉRIOS DE IDENTIFICAÇÃO APROVADOS E VIGENTES NA DATA DA CHAMADA (C-n)${context.criteria.length === 0 ? ": nenhum" : ""}`,
    ...criteria,
  ].join("\n")
}

export function renderInteractionMetadataForModel(context: ProductContext): string {
  return ["METADADOS DA CHAMADA (M-n — registros do sistema, não falas)", ...context.metadata.map((entry) => `[${entry.handle}] ${entry.label}: ${entry.value}`)].join("\n")
}

/** Rótulo da abrangência registrada de uma fonte (no cabeçalho do documento/argumentário). */
export function scopeLabelFor(context: ProductContext, sourceId: string): string | null {
  const scope = context.scopes.get(sourceId)
  return scope && scope.handles.length > 0 ? `vale para os produtos: ${scope.handles.map((handle) => `${nameOf(context, handle)} [${handle}]`).join(", ")}` : null
}

// ---------------------------------------------------------------------------------------------
// Leitura da resposta (forma; nada interpreta sentido)
// ---------------------------------------------------------------------------------------------
const handleList = z.array(z.unknown()).nullish().transform((value) => (value ?? []).filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map(catalogHandleOf))
const nullableText = z.string().trim().nullish().transform((value) => (value && value.length > 0 ? value : null))
const evidenceSchema = z.object({
  kind: z.enum(PRODUCT_EVIDENCE_KINDS),
  turn: nullableText,
  speaker: nullableText,
  quote: nullableText,
  metadata: nullableText.transform((value) => (value ? catalogHandleOf(value) : null)),
  criterion: nullableText.transform((value) => (value ? catalogHandleOf(value) : null)),
  conditionsHold: z.enum(["YES", "NO", "UNCERTAIN"]).nullish().catch(null).transform((value) => value ?? null),
  transcription: z.enum(TRANSCRIPTION_READINGS).nullish().catch(null).transform((value) => value ?? null),
  relation: z.enum(PRODUCT_EVIDENCE_RELATIONS),
  supports: handleList,
})
export type ModelProductEvidence = z.infer<typeof evidenceSchema>
const tolerantList = <T extends z.ZodTypeAny>(item: T) => z.array(z.unknown()).nullish().transform((value) => (value ?? []).flatMap((entry) => {
  const parsed = item.safeParse(entry)
  return parsed.success ? [parsed.data as z.infer<T>] : []
}))
const identificationSchema = z.object({
  status: z.enum(IDENTIFICATION_STATUSES),
  targets: handleList,
  evidence: tolerantList(evidenceSchema),
  limitations: z.array(z.unknown()).nullish().transform((value) => (value ?? []).filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())),
})
export type ModelIdentification = z.infer<typeof identificationSchema>
const requestSchema = z.object({
  id: z.string().trim().min(1).transform(catalogHandleOf),
  summary: z.string().trim().min(1),
  object: z.object({ kind: z.enum(REQUEST_OBJECT_KINDS).catch("UNKNOWN"), description: nullableText }).nullish().transform((value) => value ?? { kind: "UNKNOWN" as const, description: null }),
  product: identificationSchema,
})
export type ModelRequest = z.infer<typeof requestSchema>
/** Leitura INDEPENDENTE da revisão para uma solicitação (mesmo formato da identificação). */
const requestReadingSchema = identificationSchema.extend({ id: z.string().trim().min(1).transform(catalogHandleOf) })
export type ModelRequestReading = z.infer<typeof requestReadingSchema>

/** Solicitações da análise: o envelope é tolerante por item (item malformado sai e fica registrado). */
export function parseModelRequests(raw: unknown): { requests: ModelRequest[]; violations: string[] } {
  if (raw === undefined || raw === null) return { requests: [], violations: [] }
  if (!Array.isArray(raw)) return { requests: [], violations: ["requests:NOT_A_LIST"] }
  const violations: string[] = []
  const requests = raw.flatMap((entry, index) => {
    const parsed = requestSchema.safeParse(entry)
    if (!parsed.success) {
      violations.push(`requests[${index}]:INVALID`)
      return []
    }
    return [parsed.data]
  })
  return { requests, violations }
}
export function parseRequestReadings(raw: unknown): { readings: ModelRequestReading[]; violations: string[] } {
  if (raw === undefined || raw === null) return { readings: [], violations: [] }
  if (!Array.isArray(raw)) return { readings: [], violations: ["requests:NOT_A_LIST"] }
  const violations: string[] = []
  const readings = raw.flatMap((entry, index) => {
    const parsed = requestReadingSchema.safeParse(entry)
    if (!parsed.success) {
      violations.push(`requests[${index}]:INVALID`)
      return []
    }
    return [parsed.data]
  })
  return { readings, violations }
}
/** Leitura da revisão sobre a abrangência de produto de UMA conclusão (claim). */
export type ClaimScopeReading = { reading: ProductScopeReading; targets: string[] }
export function parseClaimScopeReadings(raw: unknown): Map<string, ClaimScopeReading> {
  const out = new Map<string, ClaimScopeReading>()
  if (!Array.isArray(raw)) return out
  for (const entry of raw) {
    const parsed = z.object({ id: z.string().trim().min(1), productScopeReading: z.enum(PRODUCT_SCOPE_READINGS), productScopeTargets: handleList }).safeParse(entry)
    if (parsed.success) out.set(parsed.data.id.trim().toUpperCase(), { reading: parsed.data.productScopeReading, targets: parsed.data.productScopeTargets })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Identificação verificada
// ---------------------------------------------------------------------------------------------
export type EvidenceRole = "ESTABLISHING" | "INDICATIVE" | "NOT_ABOUT_REQUEST" | "REJECTED"
export type ProductEvidenceRecord = {
  reader: "ANALYSIS" | "REVIEW"
  kind: ProductEvidenceKind
  /** Fala da gravação (turno + falante + trecho, com números longos mascarados) ou metadado do sistema. Nunca confirmação no chat. */
  origin: "RECORDING" | "SYSTEM_METADATA"
  turn: string | null
  speaker: string | null
  quote: string | null
  /** V2.1: o modelo apontou só o turno — o trecho é o turno inteiro, tirado da gravação pelo código. */
  quoteFromTurn?: true
  metadata: { handle: string; label: string } | null
  criterion: { handle: string; criterionId: string; versionId: string; version: number; title: string; strength: "CONCLUSIVE" | "INDICATIVE" } | null
  conditionsHold: "YES" | "NO" | "UNCERTAIN" | null
  transcription: "CLEAR" | "PARTIAL" | "UNCERTAIN" | null
  relation: ProductEvidenceRelation
  /** O que ESTA evidência sustenta (handles) — para critério cadastrado, os alvos do cadastro, nunca os do modelo. */
  supports: string[]
  role: EvidenceRole
  reason: string | null
}
export type RequestIdentification = {
  ref: string
  /** Leituras do modelo (registro; nunca fato para o redator). */
  summary: string
  object: { kind: (typeof REQUEST_OBJECT_KINDS)[number]; description: string | null }
  declared: { status: IdentificationStatus; targets: string[] }
  review: { available: boolean; status: IdentificationStatus | null; targets: string[] } | null
  status: IdentificationStatus
  /** Produtos (folhas) ainda possíveis; null = nada estreitou (qualquer produto, inclusive um não cadastrado). */
  possible: string[] | null
  /** Produto ou família estabelecidos (IDENTIFIED / FAMILY_ONLY). */
  identified: string | null
  conflict: boolean
  evidence: ProductEvidenceRecord[]
  limitations: string[]
  reasons: string[]
}

/** Números longos (6+ dígitos, juntos ou com ponto/hífen/espaço) guardados só com os 4 primeiros: a evidência registrada não
 * duplica identificadores (a transcrição continua sendo a fonte). Formatação, não interpretação. */
export function maskIdentifiers(text: string): string {
  return text.replace(/\d(?:[\d.\-\s]*\d){5,}/gu, (run) => {
    let kept = 0
    return run.replace(/\d/g, (digit) => (kept++ < 4 ? digit : "•"))
  })
}

const speakerKey = (speaker: string | null) => (speaker ?? "").trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()

type VerifyEnv = { context: ProductContext; interactions: ReadonlyMap<string, ProjectedInteraction>; projection: TranscriptProjection; circularTurns: ReadonlySet<string> }

function evidenceRecordOf(unit: ModelProductEvidence, reader: ProductEvidenceRecord["reader"], env: VerifyEnv): ProductEvidenceRecord {
  const nodes = byHandle(env.context)
  const criterion = unit.criterion ? env.context.criteria.find((entry) => entry.handle === unit.criterion) ?? null : null
  const base: ProductEvidenceRecord = {
    reader,
    kind: unit.kind,
    origin: unit.kind === "METADATA" ? "SYSTEM_METADATA" : "RECORDING",
    turn: null,
    speaker: null,
    quote: null,
    metadata: null,
    criterion: criterion ? { handle: criterion.handle, criterionId: criterion.criterionId, versionId: criterion.versionId, version: criterion.version, title: criterion.title, strength: criterion.strength } : null,
    conditionsHold: unit.conditionsHold,
    transcription: unit.transcription,
    relation: unit.relation,
    supports: criterion ? [...criterion.targets] : mostSpecificHandles(env.context, unit.supports.filter((handle) => nodes.has(handle))),
    role: "INDICATIVE",
    reason: null,
  }
  const reject = (reason: string): ProductEvidenceRecord => ({ ...base, role: "REJECTED", reason })
  // Critério citado que não está entre os apresentados = não aprovado, fora da vigência ou inexistente: nunca conta.
  if (unit.criterion && !criterion) return reject("CRITERION_NOT_IN_FORCE")
  if (unit.kind === "METADATA") {
    const entry = unit.metadata ? env.context.metadata.find((item) => item.handle === unit.metadata) : undefined
    if (!entry) return reject("METADATA_NOT_PRESENTED")
    base.metadata = { handle: entry.handle, label: entry.label }
  } else {
    // V2.1: só o turno, sem o trecho → o trecho é o próprio turno (texto literal da gravação, tirado pelo código; o falante é o do
    // turno). A leitura continua sendo do modelo — o código só não perde uma evidência que aponta para um lugar verificável.
    const wholeTurn = !unit.quote && unit.turn ? env.projection.turns.find((entry) => entry.handle === unit.turn) : undefined
    const quote = unit.quote || wholeTurn?.text
    if (!quote || !unit.turn) return reject("NO_QUOTE")
    const verified = verifyQuotes([{ turn: unit.turn, speaker: wholeTurn ? wholeTurn.speaker : unit.speaker, quote }], env.interactions, env.projection).verified[0]
    if (!verified) return reject("QUOTE_NOT_VERIFIED")
    if (wholeTurn) base.quoteFromTurn = true
    base.turn = verified.turn
    base.speaker = verified.speaker
    base.quote = maskIdentifiers(verified.quote)
    // O TIPO declarado precisa caber em quem falou (estrutura): "fala do cliente" dita pelo operador é fala do operador.
    if (unit.kind === "CUSTOMER_STATEMENT" && !CUSTOMER_SPEAKERS.has(speakerKey(verified.speaker))) {
      base.kind = OPERATOR_SPEAKERS.has(speakerKey(verified.speaker)) ? "OPERATOR_STATEMENT" : "CONTEXT"
      base.reason = "SPEAKER_IS_NOT_CUSTOMER"
    }
    const turn = env.projection.turns.find((entry) => entry.handle === verified.turn)
    if (turn && turnHasLossMark(turn.text)) base.transcription = base.transcription === "UNCERTAIN" ? "UNCERTAIN" : "PARTIAL"
  }
  if (base.supports.length === 0) return { ...base, role: "INDICATIVE", reason: base.reason ?? "NO_TARGET" }
  if (unit.relation !== "OBJECT_OF_REQUEST") return { ...base, role: "NOT_ABOUT_REQUEST", reason: `RELATION_${unit.relation}` }
  if (base.kind === "PROCEDURE_EXECUTED") return { ...base, role: "INDICATIVE", reason: "PROCEDURE_IS_NOT_PROOF_OF_PRODUCT" }
  if (base.transcription === "PARTIAL" || base.transcription === "UNCERTAIN") return { ...base, role: "INDICATIVE", reason: "TRANSCRIPTION_NOT_RELIABLE" }
  let role: EvidenceRole
  let reason: string | null = base.reason
  if (criterion) {
    if (criterion.strength !== "CONCLUSIVE") [role, reason] = ["INDICATIVE", "CRITERION_IS_INDICATIVE"]
    else if (unit.conditionsHold !== "YES") [role, reason] = ["INDICATIVE", "CRITERION_CONDITIONS_NOT_ESTABLISHED"]
    else role = "ESTABLISHING"
  } else if (base.kind === "CUSTOMER_STATEMENT" || base.kind === "METADATA") role = "ESTABLISHING"
  else [role, reason] = ["INDICATIVE", reason ?? "NO_CONCLUSIVE_BASIS"]
  // Circularidade: a mesma fala do operador que é CONDUTA de uma regra dependente de produto não prova o produto dessa regra.
  if (role === "ESTABLISHING" && base.turn && OPERATOR_SPEAKERS.has(speakerKey(base.speaker)) && env.circularTurns.has(base.turn)) [role, reason] = ["INDICATIVE", "CIRCULAR_PROCEDURE_EVIDENCE"]
  return { ...base, role, reason }
}

/** Motivos de "só indica" que a fala do operador perde quando o contexto do cliente a acompanha (V2) ou, sem contexto do cliente, quando
 * ele disse o produto (V3). Os outros (transcrição incerta, procedimento executado, sem alvo) continuam valendo. */
const OPERATOR_UPGRADABLE_REASONS = new Set(["NO_CONCLUSIVE_BASIS", "SPEAKER_IS_NOT_CUSTOMER", "CRITERION_IS_INDICATIVE", "CRITERION_CONDITIONS_NOT_ESTABLISHED"])
const isCustomerSide = (entry: ProductEvidenceRecord) => entry.origin === "SYSTEM_METADATA" || CUSTOMER_SPEAKERS.has(speakerKey(entry.speaker))

/**
 * FALA DO OPERADOR + CONTEXTO DO CLIENTE (`PRODUCT_APPLICABILITY_V2`): a fala em que o operador diz ou confirma o produto do pedido
 * passa a SUSTENTAR quando o mesmo pedido tem contexto do cliente — fala dele, dado que ele informou ou registro do sistema, que sustente
 * ou só indique — e TODO esse contexto é compatível com o que o operador disse (aponta, entre outros, para o mesmo produto). É assim que
 * a operação sabe o produto: o operador nomeia, o cliente dá o contexto. Sozinha (o cliente não disse nada sobre o produto), a fala do
 * operador continua só indicando — as regras do produto ficam sem avaliação, nunca viram erro. Nunca vale a fala circular (a própria
 * conduta avaliada), com transcrição incerta, sobre outro objeto ou o procedimento executado.
 */
function withOperatorContext(context: ProductContext, evidence: readonly ProductEvidenceRecord[], env: Pick<VerifyEnv, "circularTurns">): ProductEvidenceRecord[] {
  const customer = evidence.filter((entry) => isCustomerSide(entry) && (entry.role === "ESTABLISHING" || entry.role === "INDICATIVE") && entry.supports.length > 0 && entry.kind !== "PROCEDURE_EXECUTED" && entry.reason !== "TRANSCRIPTION_NOT_RELIABLE")
  const customerLeaves = customer.map((entry) => leavesOfHandles(context, entry.supports))
  return evidence.map((entry) => {
    if (entry.role !== "INDICATIVE" || !OPERATOR_UPGRADABLE_REASONS.has(entry.reason ?? "NO_CONCLUSIVE_BASIS") || entry.supports.length === 0) return entry
    if (!entry.turn || !OPERATOR_SPEAKERS.has(speakerKey(entry.speaker))) return entry
    // V3: o operador DIZER o produto conta mesmo na fala da conduta ("vou enviar a segunda via do seu X…"); o resto do que ele
    // fala (número lido, contexto) continua não valendo na fala circular.
    const named = entry.kind === "OPERATOR_STATEMENT"
    if (!named && env.circularTurns.has(entry.turn)) return entry
    const said = leavesOfHandles(context, entry.supports)
    const compatible = customerLeaves.every((leaves) => [...said].some((leaf) => leaves.has(leaf)))
    if (!compatible) return entry
    if (customer.length > 0) return { ...entry, role: "ESTABLISHING", reason: "OPERATOR_WITH_CUSTOMER_CONTEXT" }
    // V3 (decisão do usuário, 21/10/2026): sem nada do cliente sobre o produto, o operador ter DITO o produto basta.
    return named ? { ...entry, role: "ESTABLISHING", reason: "OPERATOR_NAMED_PRODUCT" } : entry
  })
}

/**
 * V2.1 — corroboração: uma evidência que ESTABELECE só continua estabelecendo quando a outra leitura independente também estabelece, pelo
 * MESMO turno (ou o mesmo metadado), algo compatível (folhas em comum). Dois leitores apontando o mesmo lugar; cada um "achando" o produto
 * numa fala diferente só indica. Estrutural (turno e cadastro), nunca pelas palavras.
 */
function corroborated(context: ProductContext, own: readonly ProductEvidenceRecord[], other: readonly ProductEvidenceRecord[]): ProductEvidenceRecord[] {
  const placeOf = (entry: ProductEvidenceRecord) => entry.turn ?? entry.metadata?.handle ?? null
  const anchors = other.filter((entry) => entry.role === "ESTABLISHING" && placeOf(entry) !== null).map((entry) => ({ place: placeOf(entry), leaves: leavesOfHandles(context, entry.supports) }))
  return own.map((entry) => {
    if (entry.role !== "ESTABLISHING") return entry
    const leaves = leavesOfHandles(context, entry.supports)
    const agreed = anchors.some((anchor) => anchor.place === placeOf(entry) && [...leaves].some((leaf) => anchor.leaves.has(leaf)))
    return agreed ? entry : { ...entry, role: "INDICATIVE", reason: "NOT_CORROBORATED_BY_OTHER_READER" }
  })
}

type Possible = { possible: Set<string> | null; conflict: boolean }
/** O que as evidências ESTABELECEM: interseção dos conjuntos (vazia = conflito → a união fica possível). */
function possibleFromEvidence(context: ProductContext, evidence: readonly ProductEvidenceRecord[]): Possible {
  const establishing = evidence.filter((entry) => entry.role === "ESTABLISHING")
  if (establishing.length === 0) return { possible: null, conflict: false }
  let intersection: Set<string> | null = null
  const union = new Set<string>()
  for (const entry of establishing) {
    const leaves = leavesOfHandles(context, entry.supports)
    for (const leaf of leaves) union.add(leaf)
    const previous: Set<string> | null = intersection
    intersection = previous === null ? new Set(leaves) : new Set([...previous].filter((leaf: string) => leaves.has(leaf)))
  }
  return intersection !== null && intersection.size > 0 ? { possible: intersection, conflict: false } : { possible: union, conflict: true }
}
/** O que a leitura DECLAROU (status + alvos). Não identificado = nada estreitou. */
function possibleFromDeclared(context: ProductContext, declared: { status: IdentificationStatus; targets: readonly string[] }): Possible {
  if (declared.status === "NOT_IDENTIFIED") return { possible: null, conflict: false }
  const leaves = leavesOfHandles(context, declared.targets)
  if (leaves.size === 0) return { possible: null, conflict: declared.status === "CONFLICTING" }
  return { possible: leaves, conflict: declared.status === "CONFLICTING" }
}
/** A leitura MAIS RESTRITA de duas: mais produtos possíveis (null = qualquer um) e conflito se qualquer uma viu conflito. */
function widest(a: Possible, b: Possible): Possible {
  return { possible: a.possible === null || b.possible === null ? null : new Set([...a.possible, ...b.possible]), conflict: a.conflict || b.conflict }
}
function statusOf(context: ProductContext, possible: Possible): { status: IdentificationStatus; identified: string | null } {
  if (possible.conflict) return { status: "CONFLICTING", identified: null }
  if (possible.possible === null) return { status: "NOT_IDENTIFIED", identified: null }
  const leaves = [...possible.possible].sort(compareHandles)
  if (leaves.length === 1) return { status: leaves[0]!.startsWith("F") ? "FAMILY_ONLY" : "IDENTIFIED", identified: leaves[0]! }
  // A família MAIS PROFUNDA cujas folhas são exatamente as possíveis.
  const family = context.nodes.filter((node) => node.kind === "FAMILY" && node.leaves.length === leaves.length && node.leaves.every((leaf) => possible.possible!.has(leaf))).sort((a, b) => depthOf(context, b.handle) - depthOf(context, a.handle))[0]
  return family ? { status: "FAMILY_ONLY", identified: family.handle } : { status: "MULTIPLE_POSSIBLE", identified: null }
}
function depthOf(context: ProductContext, handle: string): number {
  const nodes = byHandle(context)
  let depth = 0
  let cursor = nodes.get(handle)?.parentHandle ?? null
  while (cursor && depth < 50) {
    depth += 1
    cursor = nodes.get(cursor)?.parentHandle ?? null
  }
  return depth
}

/**
 * IDENTIFICAÇÃO POR SOLICITAÇÃO. `review` ausente = passagem preliminar (só a análise); presente = a leitura independente da revisão
 * entra — solicitação sem leitura da revisão fica SEM identificação confirmada (nada estreita sem o segundo leitor).
 */
export function identifyRequests(input: { context: ProductContext; requests: readonly ModelRequest[]; review?: { readings: readonly ModelRequestReading[] } | null; interactions: ReadonlyMap<string, ProjectedInteraction>; projection: TranscriptProjection; circularTurns: ReadonlySet<string> }): RequestIdentification[] {
  const env: VerifyEnv = { context: input.context, interactions: input.interactions, projection: input.projection, circularTurns: input.circularTurns }
  // Sem solicitação declarada: uma solicitação implícita sem identificação (as regras que dependem de produto ficam suspensas).
  const requests: ModelRequest[] = input.requests.length > 0 ? [...input.requests] : [{ id: "Q1", summary: "Solicitação não descrita pela análise", object: { kind: "UNKNOWN", description: null }, product: { status: "NOT_IDENTIFIED", targets: [], evidence: [], limitations: [] } }]
  const seen = new Set<string>()
  return requests.flatMap((request) => {
    if (seen.has(request.id)) return []
    seen.add(request.id)
    const reasons: string[] = []
    const reading = input.review ? input.review.readings.find((entry) => entry.id === request.id) ?? null : null
    let evidence = withOperatorContext(input.context, request.product.evidence.map((unit) => evidenceRecordOf(unit, "ANALYSIS", env)), env)
    let reviewEvidence = reading ? withOperatorContext(input.context, reading.evidence.map((unit) => evidenceRecordOf(unit, "REVIEW", env)), env) : null
    const analysisAlone = possibleFromEvidence(input.context, evidence)
    if (reviewEvidence) [evidence, reviewEvidence] = [corroborated(input.context, evidence, reviewEvidence), corroborated(input.context, reviewEvidence, evidence)]
    if ([...evidence, ...(reviewEvidence ?? [])].some((entry) => entry.reason === "NOT_CORROBORATED_BY_OTHER_READER")) reasons.push("ESTABLISHING_EVIDENCE_NOT_CORROBORATED")
    const fromEvidence = possibleFromEvidence(input.context, evidence)
    const declaredTargets = mostSpecificHandles(input.context, request.product.targets.filter((handle) => byHandle(input.context).has(handle)))
    const declared = possibleFromDeclared(input.context, { status: request.product.status, targets: declaredTargets })
    // A análise declarou mais do que as evidências dela estabelecem (ou o contrário): vale a leitura MAIS RESTRITA das duas.
    if (analysisAlone.possible === null && declared.possible !== null) reasons.push("DECLARED_IDENTIFICATION_WITHOUT_ESTABLISHING_EVIDENCE")
    const analysisReading = widest(analysisAlone, declared)
    let result = widest(fromEvidence, declared)
    let reviewRecord: RequestIdentification["review"] = null
    if (input.review) {
      if (!reading || !reviewEvidence) {
        reasons.push("REVIEW_DID_NOT_READ_REQUEST")
        result = { possible: null, conflict: result.conflict }
        reviewRecord = { available: false, status: null, targets: [] }
      } else {
        evidence.push(...reviewEvidence)
        const reviewTargets = mostSpecificHandles(input.context, reading.targets.filter((handle) => byHandle(input.context).has(handle)))
        const reviewFromEvidence = possibleFromEvidence(input.context, reviewEvidence)
        const reviewDeclared = possibleFromDeclared(input.context, { status: reading.status, targets: reviewTargets })
        const reviewPossible = widest(reviewFromEvidence, reviewDeclared)
        const before = result
        result = widest(result, reviewPossible)
        if (analysisReading.possible !== null && result.possible === null) reasons.push("REVIEW_DID_NOT_CONFIRM_IDENTIFICATION")
        else if (before.possible !== null && result.possible !== null && result.possible.size > before.possible.size) reasons.push("REVIEW_WIDENED_POSSIBLE_PRODUCTS")
        if (!before.conflict && result.conflict) reasons.push("REVIEW_SAW_CONFLICT")
        reviewRecord = { available: true, status: reading.status, targets: reviewTargets }
      }
    }
    if (fromEvidence.conflict) reasons.push("ESTABLISHING_EVIDENCE_IN_CONFLICT")
    const { status, identified } = statusOf(input.context, result)
    return [{
      ref: request.id,
      summary: request.summary,
      object: request.object,
      declared: { status: request.product.status, targets: declaredTargets },
      review: reviewRecord,
      status,
      possible: result.possible ? [...result.possible].sort(compareHandles) : null,
      identified,
      conflict: result.conflict,
      evidence,
      limitations: [...new Set(request.product.limitations)].map(maskIdentifiers),
      reasons: [...new Set(reasons)],
    }]
  })
}

// ---------------------------------------------------------------------------------------------
// Abrangência de uma obrigação e efeito
// ---------------------------------------------------------------------------------------------
/** Abrangência de produto de uma regra: null = vale para qualquer produto; conjunto de folhas; "UNKNOWN" = não dá para dizer. */
export type RuleScope = Set<string> | null | "UNKNOWN"
export type ObligationProductReading = { request?: string | null; productScope?: string[] | null; commonAcrossSources?: boolean | null }

/**
 * Abrangência da obrigação: a REGISTRADA nas fontes (documento/argumentário com produtos cadastrados; sem cadastro = qualquer
 * produto) e, dentro dela, a que a análise LEU no texto da regra ("para SIP: …"). Fontes de produtos diferentes numa obrigação só
 * valem juntas quando a análise declarou que cada uma exige a MESMA conduta para o seu produto (obrigação comum: a união); senão a
 * interseção (procedimentos de produtos diferentes nunca se misturam numa cobrança). A leitura nunca alarga o cadastro.
 */
export function obligationScopeOf(context: ProductContext, procedure: Pick<ProcedureContext, "lines">, sources: readonly string[], reading: ObligationProductReading): { scope: RuleScope; basis: string[]; violations: string[] } {
  const violations: string[] = []
  const registered = sources.map((handle) => {
    const line = procedure.lines.get(handle)
    const scope = line ? context.scopes.get(line.documentId) : undefined
    return scope && scope.handles.length > 0 ? leavesOfHandles(context, scope.handles) : null
  })
  const scoped = registered.filter((scope): scope is Set<string> => scope !== null)
  // Regra de todos os produtos junto com a de um produto: a obrigação fica com a abrangência do produto (registro para auditoria — o
  // prompt pede para não juntar, porque a regra geral ficaria sem avaliação enquanto o produto não se estabelece).
  if (scoped.length > 0 && scoped.length < registered.length) violations.push("GENERAL_WITH_PRODUCT_SOURCES")
  let scope: RuleScope
  if (scoped.length === 0) scope = null
  else if (reading.commonAcrossSources && scoped.length === registered.length) scope = new Set(scoped.flatMap((entry) => [...entry]))
  else {
    scope = scoped.reduce((acc, entry) => new Set([...acc].filter((leaf) => entry.has(leaf))))
    if (scope.size === 0) {
      violations.push("MIXED_PRODUCT_SOURCES")
      scope = "UNKNOWN"
    }
  }
  const declared = (reading.productScope ?? []).filter((handle) => byHandle(context).has(handle))
  if ((reading.productScope ?? []).length > 0 && declared.length === 0) {
    violations.push("PRODUCT_SCOPE_UNKNOWN_HANDLES")
    return { scope: "UNKNOWN", basis: [], violations }
  }
  if (declared.length > 0 && scope !== "UNKNOWN") {
    const read = leavesOfHandles(context, declared)
    const narrowed: Set<string> = scope === null ? read : new Set([...read].filter((leaf) => scope instanceof Set && scope.has(leaf)))
    if (narrowed.size === 0) {
      violations.push("PRODUCT_SCOPE_OUTSIDE_SOURCE")
      return { scope: "UNKNOWN", basis: declared, violations }
    }
    scope = narrowed
  }
  return { scope, basis: declared, violations }
}

/** A leitura da revisão sobre a abrangência só ESTREITA (ou torna incerta) — nunca alarga. */
export function reviewedScopeOf(context: ProductContext, scope: RuleScope, reading: ClaimScopeReading | null): RuleScope {
  if (!reading || reading.reading === "AGREES") return scope
  if (reading.reading === "UNCLEAR" || scope === "UNKNOWN") return "UNKNOWN"
  const read = leavesOfHandles(context, reading.targets)
  if (read.size === 0) return "UNKNOWN"
  const narrowed = scope === null ? read : new Set([...read].filter((leaf) => scope.has(leaf)))
  return narrowed.size === 0 ? "UNKNOWN" : narrowed
}

export type ProductEffect = "INDEPENDENT" | "ESTABLISHED" | "OTHER_PRODUCT" | "SUSPENDED"
export type CriterionProductApplicability = { version: typeof PRODUCT_APPLICABILITY_VERSION; request: string | null; scope: string[] | "ALL" | "UNKNOWN"; effect: ProductEffect; reason: string | null }

export function effectOf(scope: RuleScope, identification: RequestIdentification | null): { effect: ProductEffect; reason: string | null } {
  if (scope === null) return { effect: "INDEPENDENT", reason: null }
  if (scope === "UNKNOWN") return { effect: "SUSPENDED", reason: "PRODUCT_SCOPE_UNCLEAR" }
  if (!identification) return { effect: "SUSPENDED", reason: "REQUEST_NOT_LINKED" }
  if (identification.possible === null) return { effect: "SUSPENDED", reason: identification.conflict ? "PRODUCT_EVIDENCE_CONFLICT" : "PRODUCT_NOT_IDENTIFIED" }
  const possible = identification.possible
  if (possible.every((leaf) => scope.has(leaf))) return { effect: "ESTABLISHED", reason: identification.conflict ? "RULE_COVERS_ALL_CONFLICTING_PRODUCTS" : null }
  if (identification.conflict) return { effect: "SUSPENDED", reason: "PRODUCT_EVIDENCE_CONFLICT" }
  if (!possible.some((leaf) => scope.has(leaf))) return { effect: "OTHER_PRODUCT", reason: "RULE_OF_ANOTHER_PRODUCT" }
  return { effect: "SUSPENDED", reason: identification.status === "FAMILY_ONLY" ? "ONLY_FAMILY_ESTABLISHED" : "SEVERAL_PRODUCTS_POSSIBLE" }
}

export const scopeRecordOf = (scope: RuleScope): CriterionProductApplicability["scope"] => (scope === null ? "ALL" : scope === "UNKNOWN" ? "UNKNOWN" : [...scope].sort(compareHandles))

/** A solicitação de uma obrigação: a citada pela análise; sem citação e com UMA solicitação, ela; senão nenhuma. */
export function requestOfObligation(identifications: readonly RequestIdentification[], ref: string | null | undefined): RequestIdentification | null {
  if (ref) return identifications.find((entry) => entry.ref === catalogHandleOf(ref)) ?? null
  return identifications.length === 1 ? identifications[0]! : null
}

/** Turnos do operador que são CONDUTA de obrigações que dependem de produto (para a regra de circularidade). */
export function circularTurnsOf(criteria: readonly Pick<AssessedCriterion, "evidence" | "evidenceRoles">[], dependent: (index: number) => boolean): Set<string> {
  const turns = new Set<string>()
  criteria.forEach((criterion, index) => {
    if (!dependent(index)) return
    criterion.evidence.forEach((quote: VerifiedQuote, position) => {
      if ((criterion.evidenceRoles?.[position] ?? null) === "CONDUCT" && OPERATOR_SPEAKERS.has(speakerKey(quote.speaker))) turns.add(quote.turn)
    })
  })
  return turns
}

// ---------------------------------------------------------------------------------------------
// Registro (memória) — fotografia do que foi usado
// ---------------------------------------------------------------------------------------------
export type RuleEffectRecord = { lineHandle: string; ruleKey: string; title: string; request: string | null; scope: CriterionProductApplicability["scope"]; effect: ProductEffect; reason: string | null; statusBefore: CriterionStatus; statusAfter: CriterionStatus }
export type ProductApplicabilityRecord = {
  version: typeof PRODUCT_APPLICABILITY_VERSION
  catalog: {
    fingerprint: string
    nodes: { handle: string; id: string; code: string; name: string; kind: "FAMILY" | "PRODUCT"; parentHandle: string | null }[]
    criteria: { handle: string; criterionId: string; versionId: string; version: number; title: string; strength: "CONCLUSIVE" | "INDICATIVE"; contentHash: string; effectiveFrom: string }[]
    scopes: { sourceId: string; assignmentId: string; handles: string[] }[]
  }
  requests: RequestIdentification[]
  effects: RuleEffectRecord[]
  counts: { independent: number; established: number; otherProduct: number; suspended: number }
  violations: string[]
}

export function catalogRecordOf(context: ProductContext): ProductApplicabilityRecord["catalog"] {
  return {
    fingerprint: context.fingerprint,
    nodes: context.nodes.map((node) => ({ handle: node.handle, id: node.id, code: node.code, name: node.name, kind: node.kind, parentHandle: node.parentHandle })),
    criteria: context.criteria.map((criterion) => ({ handle: criterion.handle, criterionId: criterion.criterionId, versionId: criterion.versionId, version: criterion.version, title: criterion.title, strength: criterion.strength, contentHash: criterion.contentHash, effectiveFrom: criterion.effectiveFrom })),
    scopes: [...context.scopes.entries()].map(([sourceId, scope]) => ({ sourceId, assignmentId: scope.assignmentId, handles: scope.handles })),
  }
}

/** Nome legível de uma identificação (liderança e redator): o que foi identificado, em palavras. */
export function identificationLabelOf(record: Pick<ProductApplicabilityRecord, "catalog">, identification: Pick<RequestIdentification, "status" | "identified" | "possible">): string {
  const name = (handle: string) => record.catalog.nodes.find((node) => node.handle === handle)?.name ?? handle
  switch (identification.status) {
    case "IDENTIFIED":
      return `Produto identificado: ${name(identification.identified!)}`
    case "FAMILY_ONLY":
      return `Família identificada: ${name(identification.identified!)} (produto ainda indefinido)`
    case "MULTIPLE_POSSIBLE":
      return `Mais de um produto possível: ${(identification.possible ?? []).map(name).join(", ")}`
    case "CONFLICTING":
      return `Evidências conflitantes entre: ${(identification.possible ?? []).map(name).join(", ")}`
    default:
      return "Produto não identificado pela gravação"
  }
}

export const isSuspendedByProduct = (criterion: Pick<AssessedCriterion, "productApplicability">) => criterion.productApplicability?.effect === "SUSPENDED"
export const wasDeterminate = (status: CriterionStatus) => isDeterminate(status)
export const shortHash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12)

// ---------------------------------------------------------------------------------------------
// Leitura para a LIDERANÇA (Diagnóstico) — linguagem simples, montada pelo sistema
// ---------------------------------------------------------------------------------------------
const EVIDENCE_KIND_LABEL: Record<ProductEvidenceKind, string> = { CUSTOMER_STATEMENT: "Fala do cliente", OPERATOR_STATEMENT: "Fala do operador", IDENTIFIER: "Número ou dado citado", METADATA: "Registro do sistema", PROCEDURE_EXECUTED: "Procedimento executado pelo operador", CONTEXT: "Indício da conversa" }
const ROLE_LABEL: Record<EvidenceRole, string> = { ESTABLISHING: "sustenta", INDICATIVE: "só indica", NOT_ABOUT_REQUEST: "não é sobre este pedido", REJECTED: "desconsiderada" }
const REASON_LABEL: Record<string, string> = {
  PROCEDURE_IS_NOT_PROOF_OF_PRODUCT: "o procedimento que o operador executou não prova o produto",
  TRANSCRIPTION_NOT_RELIABLE: "a transcrição não preservou o dado com segurança",
  CRITERION_IS_INDICATIVE: "o critério cadastrado é só indicativo",
  CRITERION_CONDITIONS_NOT_ESTABLISHED: "as condições do critério não se confirmaram na conversa",
  NO_CONCLUSIVE_BASIS: "sem critério conclusivo que a sustente",
  CIRCULAR_PROCEDURE_EVIDENCE: "é a mesma fala da conduta avaliada",
  SPEAKER_IS_NOT_CUSTOMER: "não foi dita pelo cliente",
  CRITERION_NOT_IN_FORCE: "o critério citado não estava aprovado e vigente na data",
  QUOTE_NOT_VERIFIED: "o trecho não existe na transcrição",
  METADATA_NOT_PRESENTED: "registro inexistente",
  NO_QUOTE: "sem trecho da conversa",
  NO_TARGET: "não aponta produto do cadastro",
  RELATION_OTHER_OBJECT: "fala de outro contrato, linha ou pedido",
  RELATION_HYPOTHETICAL: "é hipótese ou pergunta",
  RELATION_NEGATED: "foi negado na conversa",
  RELATION_CORRECTED_LATER: "foi corrigido depois na conversa",
  OPERATOR_WITH_CUSTOMER_CONTEXT: "dita pelo operador e compatível com o que o cliente informou",
  OPERATOR_NAMED_PRODUCT: "o operador disse o produto e nada do que o cliente disse aponta para outro",
  NOT_CORROBORATED_BY_OTHER_READER: "a outra leitura independente não apontou este trecho",
}
const EFFECT_REASON_LABEL: Record<string, string> = {
  PRODUCT_NOT_IDENTIFIED: "o produto não foi identificado",
  PRODUCT_EVIDENCE_CONFLICT: "as evidências apontam produtos diferentes",
  SEVERAL_PRODUCTS_POSSIBLE: "mais de um produto continua possível",
  ONLY_FAMILY_ESTABLISHED: "só a família foi identificada e a regra é de um produto dela",
  PRODUCT_SCOPE_UNCLEAR: "não foi possível dizer a que produtos a regra vale",
  REQUEST_NOT_LINKED: "a regra não ficou ligada a um pedido da chamada",
  RULE_OF_ANOTHER_PRODUCT: "a regra é de outro produto",
  RULE_COVERS_ALL_CONFLICTING_PRODUCTS: "a regra vale para todos os produtos possíveis",
}

/** `PATTERN_EXAMPLE_CONTEXT_V1`: nomes dos produtos (ou famílias) que a análise ESTABELECEU para as solicitações da chamada — o contexto de
 * cada fala de exemplo de um padrão do indicador. Hipótese não estabelecida nunca entra; sem registro de produto, nada. */
export function identifiedProductNamesOf(record: ProductApplicabilityRecord | null | undefined): string[] {
  if (!record) return []
  const names = record.requests.flatMap((request) => {
    const node = request.identified ? record.catalog.nodes.find((entry) => entry.handle === request.identified) : undefined
    return node && (request.status === "IDENTIFIED" || request.status === "FAMILY_ONLY") ? [node.name] : []
  })
  return [...new Set(names)]
}

/**
 * `PRODUCT_IN_FEEDBACK_V1` (22/10/2026, pedido do usuário: "tudo precisa considerar produtos e argumentários"): o que a análise da chamada
 * estabeleceu sobre o produto chega a todo lugar que mostra ou usa o feedback — o ponto leva o produto do pedido dele, a regra o "Vale para",
 * a fala de exemplo o produto da solicitação, a fala do argumentário a versão e o produto da chamada; colegas e boas práticas por produto.
 */
export const PRODUCT_IN_FEEDBACK_VERSION = "PRODUCT_IN_FEEDBACK_V1" as const

/** `PRODUCT_IN_FEEDBACK_V1`: o produto ESTABELECIDO de uma solicitação da chamada (nome do cadastro); hipótese ou solicitação desconhecida = null. */
export function requestProductOf(record: ProductApplicabilityRecord | null | undefined, requestRef: string | null | undefined): string | null {
  if (!record || !requestRef) return null
  const request = record.requests.find((entry) => entry.ref === requestRef)
  if (!request?.identified || (request.status !== "IDENTIFIED" && request.status !== "FAMILY_ONLY")) return null
  return record.catalog.nodes.find((node) => node.handle === request.identified)?.name ?? null
}

/** `PRODUCT_IN_FEEDBACK_V1`: os produtos a que uma regra vale ("Vale para"), pelos nomes do cadastro; regra geral ou abrangência incerta = nenhum. */
export function scopeNamesOf(record: ProductApplicabilityRecord | null | undefined, scope: CriterionProductApplicability["scope"] | null | undefined): string[] {
  if (!Array.isArray(scope) || scope.length === 0) return []
  return [...new Set(scope.map((handle) => record?.catalog.nodes.find((node) => node.handle === handle)?.name ?? handle))]
}

/**
 * `PRODUCT_IN_FEEDBACK_V1`: o "Vale para" de UMA regra (linha de uma fonte) dentro da avaliação. A avaliação junta linhas de várias fontes,
 * e a abrangência dela é a da obrigação: com uma fonte de produto, ela fica com a do produto (`obligationScopeOf`). Cada regra mostra a da
 * PRÓPRIA fonte:
 *  - fonte com produtos cadastrados → os produtos da avaliação que estão no cadastro dela;
 *  - fonte geral junto de fonte de produto → nenhum (a regra geral não vira "do produto");
 *  - nenhuma fonte cadastrada → a da avaliação (veio da leitura do texto da regra, ex.: exceção por produto dentro de uma base geral).
 */
export function ruleScopeNamesOf(record: ProductApplicabilityRecord | null | undefined, scope: CriterionProductApplicability["scope"] | null | undefined, ruleSourceId: string | null | undefined, criterionSourceIds: readonly (string | null | undefined)[]): string[] {
  if (!record || !Array.isArray(scope) || scope.length === 0) return scopeNamesOf(record, scope)
  const registered = new Map((record.catalog?.scopes ?? []).filter((entry) => (entry.handles ?? []).length > 0).map((entry) => [entry.sourceId, entry.handles]))
  if (![ruleSourceId, ...criterionSourceIds].some((id) => id && registered.has(id))) return scopeNamesOf(record, scope)
  const own = ruleSourceId ? registered.get(ruleSourceId) : undefined
  if (!own) return []
  // Folhas do cadastro da fonte (marcar a categoria vale para os produtos dela), dentro da abrangência da avaliação.
  const parentOf = new Map((record.catalog?.nodes ?? []).map((node) => [node.handle, node.parentHandle]))
  const within = (handle: string) => {
    for (let current: string | null | undefined = handle; current; current = parentOf.get(current)) if (own.includes(current)) return true
    return false
  }
  const kept = scope.filter(within)
  return scopeNamesOf(record, kept.length > 0 ? kept : scope)
}

/**
 * `PRODUCT_IN_FEEDBACK_V1`: de que produto é a fala de um argumentário — o "Vale para" da regra dela (o produto do ponto/da chamada quando
 * ele está nesse "Vale para"). Argumentário geral = fala de qualquer produto (nenhum), mesmo vindo de uma chamada de um produto.
 */
export function phrasingProductOf(appliesTo: readonly string[] | null | undefined, product: string | null | undefined): string | null {
  const scope = (appliesTo ?? []).filter((name) => name.trim().length > 0)
  if (scope.length === 0) return null
  return product && scope.some((name) => name.trim().toLowerCase() === product.trim().toLowerCase()) ? product : scope.join(", ")
}

/** O produto a que uma avaliação de critério se refere: o da solicitação dela; sem solicitação, o único produto estabelecido na chamada. */
export function criterionProductOf(record: ProductApplicabilityRecord | null | undefined, applicability: { request: string | null } | null | undefined): string | null {
  const fromRequest = requestProductOf(record, applicability?.request ?? null)
  if (fromRequest) return fromRequest
  const all = identifiedProductNamesOf(record)
  return all.length === 1 ? all[0]! : null
}

export function productIdentificationViewOf(record: ProductApplicabilityRecord) {
  const name = (handle: string) => record.catalog.nodes.find((node) => node.handle === handle)?.name ?? handle
  const scopeNames = (scope: CriterionProductApplicability["scope"]) => (scope === "ALL" ? [] : scope === "UNKNOWN" ? [] : scope.map(name))
  return {
    version: record.version,
    requests: record.requests.map((request) => ({
      ref: request.ref,
      summary: request.summary,
      object: request.object,
      status: request.status,
      label: identificationLabelOf(record, request),
      possible: (request.possible ?? []).map(name),
      reviewConfirmed: request.review ? request.review.available : null,
      evidence: request.evidence.map((entry) => ({
        reader: entry.reader,
        origin: entry.origin,
        kind: EVIDENCE_KIND_LABEL[entry.kind],
        turn: entry.turn,
        speaker: entry.speaker,
        quote: entry.quote,
        metadata: entry.metadata?.label ?? null,
        criterion: entry.criterion ? { title: entry.criterion.title, version: entry.criterion.version, conclusive: entry.criterion.strength === "CONCLUSIVE" } : null,
        points: entry.supports.map(name),
        role: entry.role,
        roleLabel: ROLE_LABEL[entry.role],
        reason: entry.reason ? REASON_LABEL[entry.reason] ?? null : null,
      })),
      limitations: request.limitations,
    })),
    rules: record.effects.map((effect) => ({ lineHandle: effect.lineHandle, title: effect.title, request: effect.request, products: scopeNames(effect.scope), effect: effect.effect, reason: effect.reason ? EFFECT_REASON_LABEL[effect.reason] ?? null : null })),
    counts: record.counts,
  }
}

/** O efeito do produto num ponto, para a liderança: nomes do cadastro gravado na análise e o motivo em palavras. */
export function criterionProductViewOf(record: ProductApplicabilityRecord | null, applicability: CriterionProductApplicability | null | undefined) {
  if (!applicability) return null
  const name = (handle: string) => record?.catalog.nodes.find((node) => node.handle === handle)?.name ?? handle
  const request = applicability.request ? record?.requests.find((entry) => entry.ref === applicability.request) ?? null : null
  return {
    effect: applicability.effect,
    request: applicability.request,
    requestLabel: request && record ? identificationLabelOf(record, request) : null,
    products: Array.isArray(applicability.scope) ? applicability.scope.map(name) : [],
    reason: applicability.reason ? EFFECT_REASON_LABEL[applicability.reason] ?? null : null,
  }
}
