import { extractMarkerPayload, type MarkerParseStatus } from "../../../shared/application/prompting/structured-markers.js"
import { z } from "zod"
import type { KnowledgeTrace } from "../../knowledge/application/retrieve-knowledge.js"

/**
 * Material de apoio recomendado — CAPACIDADE COMUM de resposta da runtime (Agent direto,
 * Orquestrador em chat/voz/Workflow, Feedback), nunca uma implementação por superfície.
 *
 * Modelo mental (três coisas que não se misturam):
 *   CANDIDATO      = material encontrado pelo retrieval (`SupportMaterialCandidate`, derivado do
 *                    `KnowledgeTrace` — vários trechos do mesmo documento viram UM candidato);
 *   RECOMENDAÇÃO   = material que a IA decidiu ser realmente útil PARA AQUELA RESPOSTA
 *                    (`SupportMaterialRecommendation`, 0–3, sempre escolhida entre os candidatos);
 *   APRESENTAÇÃO   = a superfície que mostra (chat, avatar, Acompanhamento/Feedback, revisão).
 * `knowledgeTrace` continua existindo e é outra coisa: o que foi CONSULTADO; `supportMaterials` é
 * o subconjunto que deve ser RECOMENDADO.
 *
 * Quem recomenda: o Agent só quando é o RESPONDENTE FINAL (Workflow "Chamar agente", teste
 * manual) e está habilitado (`agents.recommend_support_materials`); como especialista de um
 * Orquestrador ele apenas fornece candidatos — a seleção final é do Orquestrador
 * (`assistant_orchestrators.recommend_support_materials`), sobre a união deduplicada dos candidatos
 * de TODOS os especialistas acionados. Workflow só transporta; o Output decide se aquela entrega
 * apresenta (`includeSupportMaterials`). Chat e Avatar recebem a resposta do Orquestrador direto —
 * não dependem de Workflow.
 *
 * Separação de responsabilidades aplicada por código (não só pedida no prompt):
 *   - a IA decide RELEVÂNCIA e escreve o MOTIVO;
 *   - a aplicação decide IDENTIDADE (o material real), TÍTULO, LINK, ACESSO e PERSISTÊNCIA.
 * Qualquer id fora dos candidatos, duplicado, sem motivo ou com motivo genérico é descartado
 * individualmente — nunca derruba a resposta. URL, título ou qualquer outro campo que o modelo
 * invente são ignorados: o contrato aceita apenas `materialId` + `reason`.
 *
 * Material de apoio ≠ evidência (fundamento da conclusão) e abrir o material ≠ ciência do Feedback.
 */

/** Limite de recomendações por RESPOSTA (Feedback, chat, voz, Workflow): apoio relevante, nunca a
 * Base inteira. `MAX_SUPPORT_MATERIALS_PER_FEEDBACK` é o nome original (mantido). */
export const MAX_SUPPORT_MATERIALS_PER_RESPONSE = 3
export const MAX_SUPPORT_MATERIALS_PER_FEEDBACK = MAX_SUPPORT_MATERIALS_PER_RESPONSE

/** Motivo curto e específico, dirigido ao colaborador. */
export const SUPPORT_MATERIAL_REASON_MIN_LENGTH = 20
export const SUPPORT_MATERIAL_REASON_MAX_LENGTH = 280

export type SupportMaterialCandidate = { materialId: string; title: string }

export type SupportMaterialRecommendation = {
  materialId: string
  /** Título do material REAL (do candidato, nunca do modelo) — metadata interna para revisão humana
   * e QA Lab; toda leitura final (chat, Acompanhamento) resolve o título de novo a partir do banco. */
  title: string
  reason: string
}

/** O que qualquer resultado de IA (Agent direto, Orquestrador) pode carregar ao lado de
 * texto/estruturado/knowledgeTrace — `supportMaterials` é metadata semântica da RESPOSTA, nunca
 * um campo do Structured Output. */
export type SupportMaterialsOutcome = {
  supportMaterials?: SupportMaterialRecommendation[]
  supportMaterialsRejected?: SupportMaterialRejection[]
}

export type SupportMaterialRejectionCode =
  | "MALFORMED"
  | "MATERIAL_NOT_IN_CANDIDATES"
  | "REASON_MISSING"
  | "REASON_TOO_SHORT"
  | "REASON_GENERIC"
  | "DUPLICATE"
  | "LIMIT_EXCEEDED"

export type SupportMaterialRejection = { materialId: string | null; code: SupportMaterialRejectionCode }

export type SupportMaterialSelection = {
  accepted: SupportMaterialRecommendation[]
  rejected: SupportMaterialRejection[]
}

/** Só o que o modelo pode produzir: id + motivo. Campos extras (url, title, href…) são removidos. */
const recommendationItemSchema = z.object({
  materialId: z.string().trim().min(1),
  reason: z.string().trim().max(SUPPORT_MATERIAL_REASON_MAX_LENGTH).optional(),
})

/** Motivos que não dizem nada ao colaborador — a instrução pede especificidade e o código confere. */
const GENERIC_REASON_PATTERNS = [/^leia (este|esse|o) material/i, /^(este|esse|o) (material|documento) é relevante\.?$/i, /^para saber mais\.?$/i, /^consulte (este|esse|o) material\.?$/i]

/**
 * Candidatos de uma execução = documentos DISTINTOS entre os trechos recuperados, na ordem em que o
 * retrieval os entregou (relevância). Modo NONE/NO_MATCH → nenhum candidato → a IA não recebe a
 * seção de materiais e o Feedback sai sem recomendação, exatamente como antes.
 */
export function buildSupportMaterialCandidates(trace: Pick<KnowledgeTrace, "mode" | "retrieved">): SupportMaterialCandidate[] {
  if (trace.mode !== "FULL" && trace.mode !== "RETRIEVAL") return []
  const seen = new Set<string>()
  const candidates: SupportMaterialCandidate[] = []
  for (const excerpt of trace.retrieved) {
    if (seen.has(excerpt.documentId)) continue
    seen.add(excerpt.documentId)
    candidates.push({ materialId: excerpt.documentId, title: excerpt.documentTitle })
  }
  return candidates
}

/**
 * Valida o que o modelo devolveu contra os candidatos desta execução. Pura e tolerante: entrada
 * ausente/não-array = zero recomendações (resultado válido); item inválido = rejeitado com código,
 * os demais seguem. Limite e deduplicação por `materialId` (o título nunca identifica — dois
 * materiais podem ter o mesmo título).
 */
export function selectSupportMaterialRecommendations(raw: unknown, candidates: SupportMaterialCandidate[]): SupportMaterialSelection {
  const accepted: SupportMaterialRecommendation[] = []
  const rejected: SupportMaterialRejection[] = []
  if (raw === undefined || raw === null) return { accepted, rejected }
  if (!Array.isArray(raw)) return { accepted, rejected: [{ materialId: null, code: "MALFORMED" }] }

  const byId = new Map(candidates.map((candidate) => [candidate.materialId, candidate]))
  const chosen = new Set<string>()

  for (const item of raw) {
    const parsed = recommendationItemSchema.safeParse(item)
    if (!parsed.success) {
      rejected.push({ materialId: readMaterialId(item), code: "MALFORMED" })
      continue
    }
    // V1.2: o modelo referencia pelo HANDLE (M1, M2… = posição entre os candidatos desta execução);
    // um materialId real ainda é aceito por compatibilidade — nunca um id que não seja candidato.
    const materialId = resolveSupportMaterialHandle(parsed.data.materialId, candidates) ?? parsed.data.materialId
    const candidate = byId.get(materialId)
    if (!candidate) {
      rejected.push({ materialId, code: "MATERIAL_NOT_IN_CANDIDATES" })
      continue
    }
    if (chosen.has(materialId)) {
      rejected.push({ materialId, code: "DUPLICATE" })
      continue
    }
    const reason = parsed.data.reason ?? ""
    if (reason.length === 0) {
      rejected.push({ materialId, code: "REASON_MISSING" })
      continue
    }
    if (reason.length < SUPPORT_MATERIAL_REASON_MIN_LENGTH) {
      rejected.push({ materialId, code: "REASON_TOO_SHORT" })
      continue
    }
    if (GENERIC_REASON_PATTERNS.some((pattern) => pattern.test(reason))) {
      rejected.push({ materialId, code: "REASON_GENERIC" })
      continue
    }
    if (accepted.length >= MAX_SUPPORT_MATERIALS_PER_FEEDBACK) {
      rejected.push({ materialId, code: "LIMIT_EXCEEDED" })
      continue
    }
    chosen.add(materialId)
    accepted.push({ materialId, title: candidate.title, reason })
  }

  return { accepted, rejected }
}

/** Handle de um candidato (M1 = primeiro candidato desta execução). Só a aplicação sabe a identidade real. */
export function supportMaterialHandle(index: number): string {
  return `M${index + 1}`
}

export function resolveSupportMaterialHandle(value: string, candidates: SupportMaterialCandidate[]): string | null {
  const match = /^M(\d{1,3})$/i.exec(value.trim())
  if (!match) return null
  return candidates[Number(match[1]) - 1]?.materialId ?? null
}

function readMaterialId(item: unknown): string | null {
  if (item && typeof item === "object" && typeof (item as { materialId?: unknown }).materialId === "string") return (item as { materialId: string }).materialId
  return null
}

/**
 * Seção do prompt com os candidatos e as regras. Entra SÓ quando há candidatos; nunca contém URL
 * (a IA não precisa dela) e identifica cada material por id + título exato.
 */
export function buildSupportMaterialsPromptSection(candidates: SupportMaterialCandidate[]): string {
  if (candidates.length === 0) return ""
  const list = candidates.map((candidate, index) => `- ${supportMaterialHandle(index)} — Título: "${candidate.title}"`).join("\n")
  return [
    "MATERIAIS DE APOIO",
    "Alguns dos trechos de conhecimento fornecidos pertencem a materiais de apoio disponíveis na INIA. Os materiais desta execução são:",
    list,
    "Ao elaborar o feedback, avalie se algum desses materiais pode realmente ajudar o colaborador a desenvolver o ponto discutido.",
    "Quando houver um material pertinente:",
    "- recomende somente materiais listados acima, nesta execução;",
    "- referencie o material exclusivamente pela referência informada (M1, M2…), no campo materialId;",
    "- explique brevemente, em uma frase específica, por que esse material é útil para este ponto (nunca 'leia este material para saber mais');",
    "- não invente materiais, não invente referências, não invente URLs nem links — a INIA resolve o link a partir da referência;",
    "- não recomende material apenas para preencher a resposta;",
    `- recomende no máximo ${MAX_SUPPORT_MATERIALS_PER_FEEDBACK}, do mais relevante para o menos relevante.`,
    "Se nenhum material for realmente relevante, devolva \"supportMaterials\": [] — zero recomendações é um resultado válido.",
  ].join("\n")
}

/** Campo adicional do JSON estruturado — anexado às instruções de saída quando há candidatos. */
export function buildSupportMaterialsOutputField(candidates: SupportMaterialCandidate[]): string {
  if (candidates.length === 0) return ""
  return `Inclua também no MESMO JSON o campo "supportMaterials": uma lista (pode ser vazia) de objetos { "materialId": "a referência (M1, M2…) listada em MATERIAIS DE APOIO", "reason": "uma frase específica (${SUPPORT_MATERIAL_REASON_MIN_LENGTH}–${SUPPORT_MATERIAL_REASON_MAX_LENGTH} caracteres) explicando por que este material ajuda o colaborador neste ponto" }. Nunca inclua url, link ou título — só materialId e reason.`
}

/** União deduplicada por `materialId` (o título nunca identifica), preservando a ordem de chegada —
 * é assim que o Orquestrador agrega os candidatos de TODOS os especialistas acionados
 * (A,B + B,C + D → A,B,C,D). */
export function mergeSupportMaterialCandidates(lists: SupportMaterialCandidate[][]): SupportMaterialCandidate[] {
  const seen = new Set<string>()
  const merged: SupportMaterialCandidate[] = []
  for (const list of lists) {
    for (const candidate of list) {
      if (seen.has(candidate.materialId)) continue
      seen.add(candidate.materialId)
      merged.push(candidate)
    }
  }
  return merged
}

/**
 * Marcador para respostas em TEXTO LIVRE (Orquestrador no chat/voz/Workflow, especialista no
 * caminho de voz): a IA termina a resposta com uma linha própria
 * `SUPPORT_MATERIALS_JSON: [{ "materialId": "...", "reason": "..." }]` — irmão do marcador do
 * resultado estruturado (run-orchestrated-reply.ts), extraído ANTES dele e independente dele.
 * `supportMaterials` nunca vira campo do Structured Output.
 */
export const SUPPORT_MATERIALS_MARKER = "SUPPORT_MATERIALS_JSON:"

/** Seção de prompt para respostas em texto livre — mesmas regras da versão estruturada, com o
 * formato de saída em linha própria ao final. Só entra quando há candidatos e a recomendação está
 * habilitada; nunca contém URL. */
export function buildSupportMaterialsFreeTextPromptSection(candidates: SupportMaterialCandidate[]): string {
  if (candidates.length === 0) return ""
  const list = candidates.map((candidate, index) => `- ${supportMaterialHandle(index)} — Título: "${candidate.title}"`).join("\n")
  return [
    "MATERIAIS DE APOIO DISPONÍVEIS",
    `Você pode recomendar até ${MAX_SUPPORT_MATERIALS_PER_FEEDBACK} dos materiais abaixo quando eles ajudarem diretamente o usuário no assunto desta resposta.`,
    "Regras:",
    "- selecione apenas pelas referências fornecidas abaixo (M1, M2…), no campo materialId; não invente referência, material, URL nem link — a INIA resolve o link;",
    `- explique em uma frase curta e específica (${SUPPORT_MATERIAL_REASON_MIN_LENGTH}–${SUPPORT_MATERIAL_REASON_MAX_LENGTH} caracteres) por que o material é útil para esta resposta;`,
    "- não recomende material apenas para preencher a resposta; recomendar não é obrigatório — zero recomendações é válido;",
    "- não cole a referência no texto da resposta: o material é apresentado ao usuário pela tela, ao lado da resposta.",
    "Materiais:",
    list,
    `Ao terminar a resposta normal, adicione UMA linha própria começando exatamente com "${SUPPORT_MATERIALS_MARKER}" seguida de um JSON válido (lista, sem markdown, sem texto depois) com os objetos { "materialId": "M1", "reason": "..." } escolhidos — ou uma lista vazia [] quando nenhum material for realmente útil.`,
  ].join("\n")
}

/**
 * Separa o texto mostrado ao usuário do JSON do marcador. Best-effort e tolerante: sem marcador →
 * `raw: undefined` (zero recomendações); JSON inválido → `raw: undefined` também (o texto continua
 * intacto, e a seleção registra MALFORMED via `selectSupportMaterialRecommendations(null…)` = nada).
 * Nunca lança.
 */
export function extractSupportMaterialsMarker(rawText: string): { text: string; raw: unknown; markerStatus: MarkerParseStatus } {
  // V1.3.2: framing por scanner balanceado — extrai SÓ o payload deste marcador; o que vier antes/depois
  // (inclusive EVIDENCE_JSON/STRUCTURED_RESULT_JSON) continua no texto para os outros parsers.
  const extraction = extractMarkerPayload(rawText, SUPPORT_MATERIALS_MARKER)
  if (extraction.status === "MARKER_NOT_FOUND") return { text: rawText, raw: undefined, markerStatus: extraction.status }
  if (extraction.status !== "VALID") return { text: extraction.text, raw: "malformed", markerStatus: extraction.status }
  return { text: extraction.text, raw: extraction.payload, markerStatus: "VALID" }
}

/** Leitura uniforme das recomendações a partir de QUALQUER resultado transportado pelo Workflow
 * (resultado de Agent, resposta de Orquestrador, síntese) — só o que tem a forma de recomendação
 * validada (id + título + motivo); nunca lança. */
export function readSupportMaterials(value: unknown): SupportMaterialRecommendation[] {
  if (!value || typeof value !== "object") return []
  const list = (value as { supportMaterials?: unknown }).supportMaterials
  if (!Array.isArray(list)) return []
  return list.filter(
    (item): item is SupportMaterialRecommendation =>
      !!item && typeof item === "object" && typeof (item as { materialId?: unknown }).materialId === "string" && typeof (item as { title?: unknown }).title === "string" && typeof (item as { reason?: unknown }).reason === "string",
  )
}
