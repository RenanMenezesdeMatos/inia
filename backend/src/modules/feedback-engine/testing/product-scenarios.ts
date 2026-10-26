import { projectTranscript } from "../../investigation/domain/transcript-projection.js"
import type { ProductCatalogSource } from "../../product-catalog/domain/product-catalog.js"
import { isDeterminate } from "../domain/call-analysis.js"
import type { ModelObligation, ModelObligationAnalysis } from "../domain/obligation-analysis.js"
import { obligationClaimWithScopeOf, type ObligationClaim, type ObligationReview } from "../domain/obligation-review.js"
import { verifyObligationAnalysis } from "../domain/obligation-verification.js"
import { productContextOf, scopeLabelFor, type ModelProductEvidence, type ModelRequest, type ModelRequestReading, type ProductContext } from "../domain/product-applicability.js"
import { buildProcedureContext, type SourceDocument } from "../domain/procedure.js"
import type { ClaimVerdict } from "../domain/call-review.js"

/**
 * CENÁRIOS DE PRODUTO (`PRODUCT_APPLICABILITY_V1`) — EXEMPLOS FICTÍCIOS DE TESTE. Os produtos, famílias, prefixos de conta e
 * procedimentos abaixo ilustram o problema ("segunda via" em produtos diferentes); NÃO são regras reais da operação e nunca vão para
 * o cadastro sem validação do negócio. O código do motor não conhece nenhum deles (prova estrutural em `product-applicability.test.ts`).
 */
export const NODE = {
  BASICOS: "00000000-0000-4000-8000-0000000b0001",
  AVANCADOS: "00000000-0000-4000-8000-0000000b0002",
  BANDA_LARGA: "00000000-0000-4000-8000-0000000b0011",
  LINHA_ANALOGICA: "00000000-0000-4000-8000-0000000b0012",
  SIP: "00000000-0000-4000-8000-0000000b0021",
  DDR: "00000000-0000-4000-8000-0000000b0022",
} as const
export const DOC = {
  GERAL: "00000000-0000-4000-8000-0000000d0001",
  SIP: "00000000-0000-4000-8000-0000000d0002",
  DDR: "00000000-0000-4000-8000-0000000d0003",
  BANDA_LARGA: "00000000-0000-4000-8000-0000000d0004",
  BASICOS: "00000000-0000-4000-8000-0000000d0005",
} as const

const doc = (documentId: string, title: string, content: string): SourceDocument => ({ documentId, title, version: 1, content, contentHash: `h-${documentId.slice(-4)}`, perspective: "RULE_IN_FORCE_AT_CALL", selection: "INCLUDED_ALL", relevance: 0 })
export const DOCUMENTS: SourceDocument[] = [
  doc(DOC.GERAL, "Regras gerais de atendimento (exemplo fictício)", "# Regras gerais de atendimento\n\n## Encerramento\n\n- Informar o número do protocolo antes de encerrar."),
  doc(DOC.SIP, "Segunda via — SIP (exemplo fictício)", "# Segunda via — SIP\n\n## Procedimento\n\n- Informar que a segunda via é enviada ao e-mail do gestor do contrato."),
  doc(DOC.DDR, "Segunda via — DDR (exemplo fictício)", "# Segunda via — DDR\n\n## Procedimento\n\n- Informar que a segunda via fica no portal empresarial em até 2 dias úteis."),
  doc(DOC.BANDA_LARGA, "Segunda via — banda larga (exemplo fictício)", "# Segunda via — banda larga\n\n## Procedimento\n\n- Orientar a emissão da segunda via pelo aplicativo."),
  doc(DOC.BASICOS, "Segunda via — produtos básicos (exemplo fictício)", "# Segunda via — produtos básicos\n\n## Procedimento\n\n- Confirmar o mês de referência da fatura."),
]

const criterion = (id: string, title: string, statement: string, targets: string[], strength: "CONCLUSIVE" | "INDICATIVE", conclusiveWhen: string | null) => ({ criterionId: id, versionId: `${id}-v1`, version: 1, title, statement, targetNodeIds: targets, context: "Conta informada pelo cliente para o próprio pedido.", limitations: "Exemplo fictício de teste.", strength, conclusiveWhen, sourceLabel: "Comunicado de teste", effectiveFrom: "2026-10-01T00:00:00.000Z", approvedAt: "2026-10-01T00:00:00.000Z", contentHash: `c-${id.slice(-2)}` })
export const CATALOG: ProductCatalogSource = {
  nodes: [
    { id: NODE.BASICOS, code: "BASICOS", kind: "FAMILY", name: "Produtos básicos", description: null, parentId: null },
    { id: NODE.AVANCADOS, code: "AVANCADOS", kind: "FAMILY", name: "Produtos avançados", description: null, parentId: null },
    { id: NODE.BANDA_LARGA, code: "BANDA_LARGA", kind: "PRODUCT", name: "Banda larga", description: null, parentId: NODE.BASICOS },
    { id: NODE.LINHA_ANALOGICA, code: "LINHA_ANALOGICA", kind: "PRODUCT", name: "Linha analógica", description: null, parentId: NODE.BASICOS },
    { id: NODE.SIP, code: "SIP", kind: "PRODUCT", name: "SIP", description: null, parentId: NODE.AVANCADOS },
    { id: NODE.DDR, code: "DDR", kind: "PRODUCT", name: "DDR", description: null, parentId: NODE.AVANCADOS },
  ],
  criteria: [
    criterion("00000000-0000-4000-8000-0000000c0001", "Conta iniciada em 6999", "Conta iniciada em 6999 identifica SIP.", [NODE.SIP], "CONCLUSIVE", "o cliente diz o número completo da conta do próprio pedido"),
    criterion("00000000-0000-4000-8000-0000000c0002", "Conta iniciada em 899", "Conta iniciada em 899 identifica a família de produtos básicos.", [NODE.BASICOS], "CONCLUSIVE", "o cliente diz o número completo da conta do próprio pedido"),
    criterion("00000000-0000-4000-8000-0000000c0003", "Número com 11 dígitos", "Número de conta com 11 dígitos é de banda larga ou de DDR.", [NODE.BANDA_LARGA, NODE.DDR], "CONCLUSIVE", "o número completo foi dito e é a conta do pedido"),
    criterion("00000000-0000-4000-8000-0000000c0004", "Tronco chave", "A referência a um tronco chave pode indicar produtos avançados, dependendo do contexto.", [NODE.AVANCADOS], "INDICATIVE", null),
  ],
  scopes: [
    { assignmentId: "a-sip", sourceKind: "KNOWLEDGE_DOCUMENT", sourceId: DOC.SIP, nodeIds: [NODE.SIP], effectiveFrom: "2026-10-01T00:00:00.000Z" },
    { assignmentId: "a-ddr", sourceKind: "KNOWLEDGE_DOCUMENT", sourceId: DOC.DDR, nodeIds: [NODE.DDR], effectiveFrom: "2026-10-01T00:00:00.000Z" },
    { assignmentId: "a-bl", sourceKind: "KNOWLEDGE_DOCUMENT", sourceId: DOC.BANDA_LARGA, nodeIds: [NODE.BANDA_LARGA], effectiveFrom: "2026-10-01T00:00:00.000Z" },
    { assignmentId: "a-bas", sourceKind: "KNOWLEDGE_DOCUMENT", sourceId: DOC.BASICOS, nodeIds: [NODE.BASICOS], effectiveFrom: "2026-10-01T00:00:00.000Z" },
  ],
}

/** Um mundo de teste: base apresentada (com a abrangência no cabeçalho), catálogo com handles e a transcrição. */
export function productWorld(transcript: string, options: { metadata?: { label: string; value: string }[]; catalog?: ProductCatalogSource } = {}) {
  const context = buildProcedureContext(DOCUMENTS)
  const products = productContextOf(options.catalog ?? CATALOG, { presentedSourceIds: context.documents.map((document) => document.documentId), metadata: options.metadata ?? [{ label: "Assunto registrado", value: "Segunda via de fatura" }] }) as ProductContext
  for (const document of context.documents) document.productScopeLabel = scopeLabelFor(products, document.documentId)
  const projection = projectTranscript(transcript)
  const line = (documentId: string) => [...context.lines.values()].find((entry) => entry.documentId === documentId)!.handle
  const node = (code: keyof typeof NODE) => products.nodes.find((entry) => entry.code === code)!.handle
  const crit = (title: string) => products.criteria.find((entry) => entry.title === title)!.handle
  return { context, products, projection, line, node, crit }
}
export type ProductWorld = ReturnType<typeof productWorld>

export const evidence = (overrides: Partial<ModelProductEvidence> & Pick<ModelProductEvidence, "kind" | "relation">): ModelProductEvidence => ({ turn: null, speaker: null, quote: null, metadata: null, criterion: null, conditionsHold: null, transcription: null, supports: [], ...overrides })
export const request = (id: string, status: ModelRequest["product"]["status"], targets: string[], items: ModelProductEvidence[], extra: Partial<ModelRequest> = {}): ModelRequest => ({ id, summary: "Segunda via da fatura", object: { kind: "ACCOUNT", description: "conta do pedido" }, product: { status, targets, evidence: items, limitations: [] }, ...extra })
export const reading = (id: string, status: ModelRequest["product"]["status"], targets: string[], items: ModelProductEvidence[]): ModelRequestReading => ({ id, status, targets, evidence: items, limitations: [] })

export const obligation = (overrides: Partial<ModelObligation> & Pick<ModelObligation, "id" | "sources" | "action" | "finding">): ModelObligation => ({ condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", evidence: [], opportunityTurn: null, materiality: "HIGH", role: "CENTRAL", rationale: "Leitura de teste.", guidance: null, ...overrides })
export const analysis = (obligations: ModelObligation[], requests: ModelRequest[]): ModelObligationAnalysis => ({ contract: "OBLIGATIONS_V1", need: { summary: "Segunda via da fatura", conditions: [] }, sources: { primary: "D1", related: [], rationale: "Regras da segunda via." }, argumentScripts: [], obligations, notAssessed: [], conduct: { pathTaken: "Atendeu o pedido.", assessment: "UNDETERMINED", rationale: "" }, sourceConflicts: [], limitations: [], contractViolations: [], requests })

/** A revisora confirma as conclusões que recebeu (leitura "razoável" da evidência) e dá a sua leitura de produto. */
export function confirmingReview(claims: readonly ObligationClaim[], requests: ModelRequestReading[], scope: Record<string, { reading: "AGREES" | "DEPENDS_ON_PRODUCT" | "UNCLEAR"; targets?: string[] }> = {}): ObligationReview {
  const verdicts = new Map<string, ClaimVerdict>(claims.map((claim) => [claim.id, { id: claim.id, verdict: "CONFIRMED", issues: [], listReading: null, evidenceReading: claim.status === "MET" ? "ACTION_IN_CALL" : "ABSENCE_IN_CALL", outsideDependency: false, actPlace: "IN_CONVERSATION", conditionEvidence: [], counterEvidence: [], note: null } as ClaimVerdict]))
  const scopeReadings = new Map(claims.map((claim) => [claim.id, { reading: scope[claim.id]?.reading ?? "AGREES", targets: scope[claim.id]?.targets ?? [] }] as const))
  return { claims: verdicts, lines: [], missed: [], path: null, violations: [], contract: "V7", requests, scopeReadings }
}

/** Passagem preliminar → conclusões enviadas à revisão (as suspensas por produto não vão) → revisão → verificação final. */
export function verifyWithReview(world: ProductWorld, model: ModelObligationAnalysis, reviewOf: (claims: ObligationClaim[]) => ObligationReview, transcriptStatus: "COMPLETE" | "INCOMPLETE" = "COMPLETE") {
  const base = { model, context: world.context, projection: world.projection, transcriptStatus, interactionId: "i-prod", subjectAnchoredDocumentIds: [], products: world.products }
  const preliminary = verifyObligationAnalysis(base)
  const sentClaims = preliminary.criteria.filter((criterion) => criterion.origin === "ANALYSIS" && isDeterminate(criterion.proposedStatus) && !criterion.ruleConflict && criterion.productApplicability?.effect !== "SUSPENDED" && criterion.productApplicability?.effect !== "OTHER_PRODUCT").map((criterion) => obligationClaimWithScopeOf(criterion, world.products))
  const review = reviewOf(sentClaims)
  return { preliminary, sentClaims, result: verifyObligationAnalysis({ ...base, review: { attempted: true, review, error: null, sentClaims, requested: { linesToAssess: [] }, actPlaceRequired: true } }) }
}
