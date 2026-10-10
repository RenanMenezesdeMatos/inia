import { z } from "zod"
import { canonicalHandle, unwrapJsonFence } from "./call-analysis.js"

/**
 * RESPOSTA DA ANÁLISE ORIENTADA AO CASO (`OBLIGATIONS_V1`) — leitura ESTRITA do envelope e TOLERANTE por item: uma obrigação malformada
 * sai (registrada em `contractViolations`); as demais continuam. Nada aqui interpreta o sentido: só forma e identificadores.
 */
export const OBLIGATION_FINDINGS = ["MET", "NOT_MET", "PARTIAL", "NOT_VERIFIABLE", "NOT_APPLICABLE"] as const
export const EVIDENCE_ROLES = ["CONDUCT", "DECLARATION", "INTENTION", "CONDITION", "CUSTOMER"] as const
export type EvidenceRole = (typeof EVIDENCE_ROLES)[number]
export const ITEMS_MODES = ["ALL", "ANY", "SEQUENCE", "UNCLEAR", "NONE"] as const

const nullableText = z.string().trim().nullish().transform((value) => (value && value.length > 0 ? value : null))
const quoteSchema = z.object({ turn: z.string().trim().min(1), speaker: z.string().trim().nullish().transform((value) => value ?? null), quote: z.string().trim().min(1) })
const evidenceSchema = quoteSchema.extend({ role: z.enum(EVIDENCE_ROLES).nullish().catch(null).transform((value) => value ?? null) })
const tolerantList = <T extends z.ZodTypeAny>(item: T) => z.array(z.unknown()).nullish().transform((value) => (value ?? []).flatMap((entry) => {
  const parsed = item.safeParse(entry)
  return parsed.success ? [parsed.data as z.infer<T>] : []
}))
/**
 * Linha de origem como o modelo a escreveu → handle canônico (só a FORMA): "L12", "[L12]", "D2:L786" (documento + linha) → "L786".
 * Nunca procura a linha "mais parecida"; sem um L-n reconhecível, fica como veio (e a verificação a recusa como fonte desconhecida).
 */
export function sourceHandleOf(value: string): string {
  const matches = [...value.matchAll(/L\s*-?\s*0*(\d+)/g)]
  return matches.length > 0 ? `L${matches[matches.length - 1]![1]}` : canonicalHandle(value)
}
const handleList = z.array(z.unknown()).nullish().transform((value) => (value ?? []).filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => canonicalHandle(entry)))
const sourceList = z.array(z.unknown()).nullish().transform((value) => (value ?? []).filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => sourceHandleOf(entry)))

const obligationSchema = z.object({
  id: z.string().trim().min(1),
  sources: sourceList,
  action: z.string().trim().min(1),
  condition: nullableText,
  conditionHolds: z.enum(["YES", "NO", "UNCERTAIN", "NOT_CONDITIONAL"]).nullish().catch(null).transform((value) => value ?? null),
  conditionEvidence: tolerantList(quoteSchema),
  items: tolerantList(z.object({ text: z.string().trim().min(1), line: nullableText.transform((value) => (value ? sourceHandleOf(value) : null)), status: z.enum(["DONE", "NOT_DONE", "NOT_APPLICABLE", "NOT_VERIFIABLE"]) })),
  itemsMode: z.enum(ITEMS_MODES).nullish().catch(null).transform((value) => value ?? "NONE"),
  where: z.enum(["IN_CONVERSATION", "OUTSIDE_CONVERSATION"]),
  finding: z.enum(OBLIGATION_FINDINGS),
  evidence: tolerantList(evidenceSchema),
  opportunityTurn: nullableText,
  materiality: z.enum(["HIGH", "MEDIUM", "LOW"]).nullish().catch(null).transform((value) => value ?? "MEDIUM"),
  role: z.enum(["CENTRAL", "SUPPORTING", "ROUTINE"]).nullish().catch(null).transform((value) => value ?? null),
  rationale: nullableText,
  guidance: z.object({ moment: z.string().trim().min(1), action: z.string().trim().min(1) }).nullish().catch(null).transform((value) => value ?? null),
})
export type ModelObligation = z.infer<typeof obligationSchema>
export type ModelQuote = z.infer<typeof quoteSchema>

export type ModelObligationAnalysis = {
  contract: "OBLIGATIONS_V1"
  need: { summary: string; conditions: { text: string; evidence: ModelQuote[] }[] }
  sources: { primary: string | null; related: string[]; rationale: string | null }
  /** `SITUATION_SECTIONS_V1`: seções acionadas por uma SITUAÇÃO (título ou abertura descrevem a situação) que a análise leu, e se a
   * situação aconteceu nesta conversa, com a fala que mostra. Leitura semântica do modelo; o código só verifica a fala. */
  situations?: { section: string; happened: "YES" | "NO" | "UNCLEAR"; evidence: ModelQuote[] }[]
  argumentScripts: { script: string; applies: "APPLIES" | "DOES_NOT_APPLY" | "UNCERTAIN"; evidence: ModelQuote[]; rationale: string }[]
  obligations: ModelObligation[]
  notAssessed: { sources: string[]; action: string; reason: string }[]
  conduct: { pathTaken: string; assessment: "CORRECT" | "PARTIALLY_CORRECT" | "INCORRECT" | "UNDETERMINED"; rationale: string }
  sourceConflicts: { lines: string[]; description: string }[]
  limitations: string[]
  contractViolations: string[]
}

export function parseObligationAnalysisResponse(text: string): { ok: true; value: ModelObligationAnalysis } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(unwrapJsonFence(text))
  } catch {
    return { ok: false, error: "MALFORMED_JSON" }
  }
  if (!raw || typeof raw !== "object") return { ok: false, error: "NOT_AN_OBJECT" }
  const envelope = raw as Record<string, unknown>
  const need = z.object({ summary: z.string().trim().min(1), conditions: tolerantList(z.object({ text: z.string().trim().min(1), evidence: tolerantList(quoteSchema) })) }).safeParse(envelope.need)
  if (!need.success) return { ok: false, error: "NEED_INVALID" }
  const sources = z.object({ primary: nullableText, related: handleList, rationale: nullableText }).safeParse(envelope.sources)
  if (!sources.success) return { ok: false, error: "SOURCES_INVALID" }
  const conduct = z.object({ pathTaken: z.string().trim().default(""), assessment: z.enum(["CORRECT", "PARTIALLY_CORRECT", "INCORRECT", "UNDETERMINED"]), rationale: z.string().trim().default("") }).safeParse(envelope.conduct)
  if (!conduct.success) return { ok: false, error: "CONDUCT_INVALID" }
  if (!Array.isArray(envelope.obligations)) return { ok: false, error: "OBLIGATIONS_MISSING" }
  const violations: string[] = []
  const obligations = envelope.obligations.flatMap((entry, index) => {
    const parsed = obligationSchema.safeParse(entry)
    if (!parsed.success) {
      violations.push(`obligations[${index}]:INVALID`)
      return []
    }
    if (parsed.data.sources.length === 0) {
      violations.push(`obligations[${index}]:NO_SOURCES`)
      return []
    }
    return [parsed.data]
  })
  const scripts = tolerantList(z.object({ script: z.string().trim().min(1), applies: z.enum(["APPLIES", "DOES_NOT_APPLY", "UNCERTAIN"]), evidence: tolerantList(quoteSchema), rationale: z.string().trim().min(1) })).parse(envelope.argumentScripts)
  const notAssessed = tolerantList(z.object({ sources: sourceList, action: z.string().trim().min(1), reason: z.string().trim().min(1) })).parse(envelope.notAssessed)
  const situations = tolerantList(z.object({ section: z.string().trim().min(1), happened: z.enum(["YES", "NO", "UNCLEAR"]), evidence: tolerantList(quoteSchema) })).parse(envelope.situations)
  const sourceConflicts = tolerantList(z.object({ lines: sourceList, description: z.string().trim().min(1) })).parse(envelope.sourceConflicts)
  const limitations = Array.isArray(envelope.limitations) ? envelope.limitations.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim()) : []
  return {
    ok: true,
    value: {
      contract: "OBLIGATIONS_V1",
      need: need.data,
      sources: { primary: sources.data.primary ? canonicalHandle(sources.data.primary) : null, related: sources.data.related, rationale: sources.data.rationale },
      // A seção vem como o modelo a escreveu ("D1:S33", "S21 / S98 (…)", "34. Conta já paga"): a resolução para seções do contexto é
      // da verificação (`sectionsOfReference`), que conhece os handles e os títulos apresentados.
      situations: situations.map((situation) => ({ ...situation, section: situation.section.trim() })),
      argumentScripts: scripts.map((script) => ({ ...script, script: canonicalHandle(script.script) })),
      obligations,
      notAssessed,
      conduct: conduct.data,
      sourceConflicts,
      limitations,
      contractViolations: violations,
    },
  }
}
