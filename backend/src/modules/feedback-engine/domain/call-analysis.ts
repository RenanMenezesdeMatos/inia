import { z } from "zod"
import { verifyEvidenceUnit, type ProjectedInteraction, type TranscriptProjection } from "../../investigation/domain/transcript-projection.js"
import { CALL_REVIEW_VERSION, decideConfirmation, decideExclusionChallenge, decidePathConfirmation, exclusionTargetsOf, reviewDiscoveriesOf, reviewTargetsOf, sameEvidenceAsSibling, type AssessedLine, type CallReview, type ClaimVerdict, type Confirmation, type ConfirmationDecision, type ConfirmationReason, type EvidenceReading, type ListReading, type ReviewClaim, type ReviewFocus, type ReviewIssue } from "./call-review.js"
import { createHash } from "node:crypto"
import { normalizeForLiteralQuote } from "../../knowledge/domain/knowledge-match.js"
import { closingSectionsOf, CUSTOMER_SPEAKERS, listContextOf, listOpeningsOf, OPERATOR_SPEAKERS, turnNumberOf, type ArgumentDocumentMeta, type ArgumentLineMeta, type ProcedureContext, type ProcedureLine, type RulePerspective, type TranscriptStatus } from "./procedure.js"
import { CALL_ANALYSIS_LOGIC_VERSION } from "./versions.js"

/**
 * ANÁLISE DE CHAMADA VERIFICADA (`CALL_ANALYSIS_LOGIC_V4`, domínio puro).
 *
 * O modelo PROPÕE o diagnóstico (cenário, caminho, disposição por critério, orientação). O sistema aceita só o que consegue
 * sustentar e, quando não consegue, restringe a conclusão — nunca acusa por falta de prova. Duas camadas diferentes:
 *   INTEGRIDADE (código): a fala existe, é daquele turno e daquele falante, intenção não é execução, omissão só com transcrição
 *     completa e oportunidade — o resultado é a PROPOSTA (`proposedStatus`);
 *   INTERPRETAÇÃO (revisão independente, call-review.ts): a proposta se sustenta com a transcrição INTEIRA e a regra COMPLETA
 *     (condição, exceção, alternativas × obrigações cumulativas, oportunidade real, ação observável × declarada × interna)? Só a
 *     proposta CONFIRMADA vira o status final; o resto fica registrado como hipótese não confirmada (`confirmation`), fora das
 *     contagens, do reconhecimento e das orientações.
 * Checagens de integridade:
 *   - citação: literal em UM turno, do falante declarado (verificador por turno da investigação);
 *   - conduta (MET/NOT_MET/PARTIAL por ação): precisa de fala verificada do OPERADOR; fala do cliente só contextualiza;
 *   - intenção ("vou verificar") nunca é execução; declaração ("já cancelei") prova só que foi dito;
 *   - omissão: transcrição completa + turno de oportunidade real + o operador falou depois dele;
 *   - não aplicável: exige a condição que faltou (justificativa);
 *   - critério em conflito entre fontes: fica na memória marcado, nunca vira acusação;
 *   - caminho incorreto/parcial: precisa de evidência (fala do operador ou critério do caminho não cumprido);
 *   - cobertura: todo item de lista das seções do caminho (e do encerramento, com transcrição completa) tem disposição —
 *     sem ela a análise é PARCIAL, nunca silenciosamente completa.
 * Rebaixar = "não foi possível observar" com o motivo; o que foi dito pelo modelo fica na auditoria (`declaredStatus`).
 */
export type CriterionStatus = "MET" | "NOT_MET" | "PARTIAL" | "NOT_OBSERVABLE" | "NOT_APPLICABLE" | "NOT_ASSESSED"
export type EvidenceKind = "CONDUCT_OBSERVED" | "DECLARED_ACTION" | "OMISSION" | "COMPLIANCE_BY_ABSENCE" | "CUSTOMER_CONTEXT" | "NONE"
export type Materiality = "HIGH" | "MEDIUM" | "LOW"
export type PathAssessment = "CORRECT" | "INCORRECT" | "PARTIALLY_CORRECT" | "UNDETERMINED" | "NO_PROCEDURE"
export type AnalysisOutcome = "USABLE" | "PARTIAL" | "INSUFFICIENT_EVIDENCE"
/** V5 — o que a linha pede: EXECUTAR uma ação interna (sistema), COMUNICAR algo ao cliente, PERGUNTAR/deixar explicar, uma PROIBIÇÃO. */
export const ITEM_NATURES = ["INTERNAL_ACTION", "COMMUNICATION", "INFORMATION_REQUEST", "PROHIBITION", "OTHER"] as const
export type ItemNature = (typeof ITEM_NATURES)[number]
/** V5 — papel no caso (LEITURA da análise; só ordena o que oferecer ao redator, nunca vira fato): ligado à necessidade do cliente ou à
 * decisão do caso (CENTRAL), etapa que sustenta o atendimento (SUPPORTING), etapa de qualquer chamada (ROUTINE). */
export const SCENARIO_ROLES = ["CENTRAL", "SUPPORTING", "ROUTINE"] as const
export type ScenarioRole = (typeof SCENARIO_ROLES)[number]
/** V7 (`SEMANTIC_AUDITABILITY_V1`) — a regra vale para esta conversa? (leitura SEMÂNTICA do modelo; nunca por palavra-chave). */
export const APPLICABILITIES = ["APPLIES", "DOES_NOT_APPLY", "UNCERTAIN"] as const
export type Applicability = (typeof APPLICABILITIES)[number]
/** V7 — onde o cumprimento acontece: na conversa (verificável pela transcrição) ou fora dela (execução em sistema/registro). */
export const OBSERVABILITIES = ["IN_CONVERSATION", "OUTSIDE_CONVERSATION"] as const
export type Observability = (typeof OBSERVABILITIES)[number]
/** O que a transcrição mostra sobre uma execução fora da conversa: declarada ("já fiz"), intenção ("vou fazer") ou nada. */
export type ExecutionClaim = "DECLARED" | "INTENDED" | "NONE"
/** V10 (`OBLIGATION_READING_V1`) — como a linha se liga à frase que abre a lista (leitura do modelo): a própria conduta, a SITUAÇÃO em
 * que a ação da abertura é exigida, o CONTEÚDO da ação da abertura, ou uma opção entre alternativas. */
export const LINE_ROLES = ["ACTION", "CONDITION_OF_ACTION", "CONTENT_OF_ACTION", "OPTION"] as const
export type LineRole = (typeof LINE_ROLES)[number]
/** Evidência disponível na análise (registros operacionais de sistemas ainda não são integrados — nada é presumido). */
export type EvidenceAvailability = { transcript: "COMPLETE" | "INCOMPLETE" | "UNAVAILABLE"; operationalRecords: "NOT_INTEGRATED" }
export const EVIDENCE_AVAILABILITY_NOW = { operationalRecords: "NOT_INTEGRATED" } as const

const nullableText = z.string().trim().nullish().transform((value) => (value && value.length > 0 ? value : null))
const evidenceUnitSchema = z.object({ turn: z.string().trim().min(1), speaker: z.string().trim().nullish(), quote: z.string().trim().min(1) })
const guidanceSchema = z.object({ moment: z.string().trim().min(1), condition: nullableText, action: z.string().trim().min(1), ruleLines: z.array(z.string().trim()).nullish().transform((value) => value ?? []) })
const obligationSchema = z.object({
  part: z.string().trim().min(1),
  requiredAction: nullableText,
  applicability: z.enum(APPLICABILITIES).nullish().catch(null),
  condition: nullableText,
  applicabilityEvidence: z.array(z.unknown()).nullish().transform((value) => value ?? []),
  observability: z.enum(OBSERVABILITIES).nullish().catch(null),
  evidenceNeeded: nullableText,
  status: z.enum(["MET", "NOT_MET", "PARTIAL", "NOT_OBSERVABLE", "NOT_APPLICABLE"]),
  evidenceKind: z.enum(["CONDUCT_OBSERVED", "DECLARED_ACTION", "OMISSION", "COMPLIANCE_BY_ABSENCE", "CUSTOMER_CONTEXT", "NONE"]).nullish(),
  declaredActionTense: z.enum(["COMPLETED", "INTENDED"]).nullish(),
  evidence: z.array(z.unknown()).nullish().transform((value) => value ?? []),
  opportunityTurn: nullableText,
  rationale: nullableText,
  itemNature: z.enum(ITEM_NATURES).nullish().catch(null),
  lineRole: z.enum(LINE_ROLES).nullish().catch(null),
})
const criterionSchema = z.object({
  line: z.string().trim().min(1),
  status: z.enum(["MET", "NOT_MET", "PARTIAL", "NOT_OBSERVABLE", "NOT_APPLICABLE", "NOT_A_REQUIREMENT"]),
  evidenceKind: z.enum(["CONDUCT_OBSERVED", "DECLARED_ACTION", "OMISSION", "COMPLIANCE_BY_ABSENCE", "CUSTOMER_CONTEXT", "NONE"]).nullish(),
  declaredActionTense: z.enum(["COMPLETED", "INTENDED"]).nullish(),
  evidence: z.array(z.unknown()).nullish().transform((value) => value ?? []),
  opportunityTurn: nullableText,
  rationale: nullableText,
  materiality: z.enum(["HIGH", "MEDIUM", "LOW"]).nullish(),
  guidance: z.unknown().nullish(),
  whyItMatters: nullableText,
  itemNature: z.enum(ITEM_NATURES).nullish().catch(null),
  scenarioRole: z.enum(SCENARIO_ROLES).nullish().catch(null),
  requiredAction: nullableText,
  applicability: z.enum(APPLICABILITIES).nullish().catch(null),
  condition: nullableText,
  applicabilityEvidence: z.array(z.unknown()).nullish().transform((value) => value ?? []),
  observability: z.enum(OBSERVABILITIES).nullish().catch(null),
  evidenceNeeded: nullableText,
  lineRole: z.enum(LINE_ROLES).nullish().catch(null),
  obligations: z.array(z.unknown()).nullish().transform((value) => value ?? []),
})
const scenarioSchema = z.object({
  customerNeed: z.string().trim().min(1),
  conditions: z.array(z.object({ text: z.string().trim().min(1), evidence: z.array(z.unknown()).nullish().transform((value) => value ?? []) })).nullish().transform((value) => value ?? []),
  procedure: nullableText,
  procedureRationale: nullableText,
  pathSections: z.array(z.string().trim()).nullish().transform((value) => value ?? []),
  correctPath: z.string().trim().default(""),
  pathTaken: z.string().trim().default(""),
  pathAssessment: z.enum(["CORRECT", "INCORRECT", "PARTIALLY_CORRECT", "UNDETERMINED"]),
  pathRationale: z.string().trim().default(""),
  pathEvidence: z.array(z.unknown()).nullish().transform((value) => value ?? []),
})

export type ModelEvidenceUnit = z.infer<typeof evidenceUnitSchema>
export type ModelObligation = Omit<z.infer<typeof obligationSchema>, "evidence" | "applicabilityEvidence"> & { evidence: ModelEvidenceUnit[]; applicabilityEvidence: ModelEvidenceUnit[] }
export type ModelCriterion = Omit<z.infer<typeof criterionSchema>, "evidence" | "guidance" | "applicabilityEvidence" | "obligations" | "requiredAction" | "applicability" | "condition" | "observability" | "evidenceNeeded" | "lineRole"> & {
  evidence: ModelEvidenceUnit[]
  guidance: z.infer<typeof guidanceSchema> | null
  /** REVIEW_REPAIR = linha avaliada pela revisão (a análise a deixou sem resposta). */
  origin?: "REVIEW_REPAIR"
  /** V7 — leitura semântica (ausente nas respostas V4: derivada do status/natureza na verificação). */
  requiredAction?: string | null | undefined
  applicability?: Applicability | null | undefined
  condition?: string | null | undefined
  applicabilityEvidence?: ModelEvidenceUnit[] | undefined
  observability?: Observability | null | undefined
  evidenceNeeded?: string | null | undefined
  obligations?: ModelObligation[] | undefined
  /** V10 — papel da linha na lista (ausente nas respostas anteriores ao contrato V7). */
  lineRole?: LineRole | null | undefined
}
export type ModelScriptAssessment = { script: string; applicability: Applicability; situation: string | null; evidence: ModelEvidenceUnit[]; rationale: string }
export type ModelCallAnalysis = {
  scenario: Omit<z.infer<typeof scenarioSchema>, "conditions" | "pathEvidence"> & { conditions: { text: string; evidence: ModelEvidenceUnit[] }[]; pathEvidence: ModelEvidenceUnit[] }
  criteria: ModelCriterion[]
  sectionDispositions: { section: string; status: "NOT_APPLICABLE" | "NOT_OBSERVABLE"; rationale: string }[]
  /** Várias linhas com a MESMA disposição sem evidência individual (não se aplica, não observável, não é exigência). */
  groupDispositions: { lines: string[]; status: "NOT_APPLICABLE" | "NOT_OBSERVABLE" | "NOT_A_REQUIREMENT"; rationale: string }[]
  sourceConflicts: { lines: string[]; description: string }[]
  limitations: string[]
  /** V7 — aplicabilidade de cada argumentário apresentado (G-n). */
  argumentScripts?: ModelScriptAssessment[]
  /** V7 — linha de argumentário com a mesma exigência de uma linha de procedimento (avaliada só lá). V8 (`DUPLICATE_BY_MEANING_V1`):
   * a equivalência é declarada por dimensão (condição, finalidade, escopo, modalidade) — texto igual não basta. */
  duplicates?: { line: string; sameAs: string; rationale: string | null; sameCondition?: boolean | null; samePurpose?: boolean | null; sameScope?: boolean | null; sameModality?: boolean | null }[]
  /** Itens do modelo descartados na leitura (formato) — auditoria, nunca silencioso. */
  contractViolations: string[]
}

const evidenceList = (raw: readonly unknown[], violations: string[], path: string): ModelEvidenceUnit[] =>
  raw.flatMap((entry, index) => {
    const parsed = evidenceUnitSchema.safeParse(entry)
    if (parsed.success) return [parsed.data]
    violations.push(`${path}[${index}]:EVIDENCE_INVALID`)
    return []
  })

/** Leitura ESTRITA do envelope e TOLERANTE por item: um critério malformado sai (registrado); os demais continuam. */
/** Uma resposta JSON cercada por UM bloco de código (```json … ```) é a mesma resposta — só o formato muda; nada além disso é tolerado. */
export function unwrapJsonFence(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed)
  return fenced ? fenced[1]!.trim() : trimmed
}

/** Identificador apresentado ao modelo (D-n, S-n, L-n, T-n) escrito com colchetes, hífen, zeros à esquerda ou texto depois
 * ("[D1]", "D-1", "T07", "L12 — texto") → forma canônica ("D1"). Só a FORMA: nunca procura o identificador mais parecido. */
export function canonicalHandle(value: string): string {
  const match = /^\s*[[(]?\s*([DGSLT])\s*-?\s*0*(\d+)\s*[\])]?/i.exec(value)
  return match ? `${match[1]!.toUpperCase()}${match[2]}` : value.trim().toUpperCase()
}
/** Referência de critério: linha ("L12") ou PARTE de uma regra composta ("L12.2" — só a forma; nunca o mais parecido). */
export function canonicalCriterionRef(value: string): string {
  const match = /^\s*[[(]?\s*L\s*-?\s*0*(\d+)(?:\s*\.\s*(\d+))?\s*[\])]?/i.exec(value)
  return match ? `L${match[1]}${match[2] ? `.${Number(match[2])}` : ""}` : canonicalHandle(value)
}

export function parseCallAnalysisResponse(text: string): { ok: true; value: ModelCallAnalysis } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(unwrapJsonFence(text))
  } catch {
    return { ok: false, error: "MALFORMED_JSON" }
  }
  if (!raw || typeof raw !== "object") return { ok: false, error: "NOT_AN_OBJECT" }
  const envelope = raw as { scenario?: unknown; criteria?: unknown; sectionDispositions?: unknown; groupDispositions?: unknown; sourceConflicts?: unknown; limitations?: unknown; argumentScripts?: unknown; duplicates?: unknown }
  const scenario = scenarioSchema.safeParse(envelope.scenario)
  if (!scenario.success) return { ok: false, error: `SCENARIO_INVALID:${scenario.error.issues.map((issue) => issue.path.join(".")).join(",")}` }
  if (!Array.isArray(envelope.criteria)) return { ok: false, error: "CRITERIA_MISSING" }
  const violations: string[] = []
  const criteria: ModelCriterion[] = envelope.criteria.flatMap((entry, index) => {
    const parsed = criterionSchema.safeParse(entry)
    if (!parsed.success) {
      violations.push(`criteria[${index}]:CRITERION_INVALID`)
      return []
    }
    const guidance = parsed.data.guidance ? guidanceSchema.safeParse(parsed.data.guidance) : null
    if (guidance && !guidance.success) violations.push(`criteria[${index}].guidance:GUIDANCE_INVALID`)
    const obligations: ModelObligation[] = parsed.data.obligations.flatMap((raw, position) => {
      const obligation = obligationSchema.safeParse(raw)
      if (!obligation.success) {
        violations.push(`criteria[${index}].obligations[${position}]:OBLIGATION_INVALID`)
        return []
      }
      return [{ ...obligation.data, evidence: evidenceList(obligation.data.evidence, violations, `criteria[${index}].obligations[${position}].evidence`), applicabilityEvidence: evidenceList(obligation.data.applicabilityEvidence, violations, `criteria[${index}].obligations[${position}].applicabilityEvidence`) }]
    })
    return [{ ...parsed.data, evidence: evidenceList(parsed.data.evidence, violations, `criteria[${index}].evidence`), guidance: guidance?.success ? guidance.data : null, applicabilityEvidence: evidenceList(parsed.data.applicabilityEvidence, violations, `criteria[${index}].applicabilityEvidence`), obligations }]
  })
  const sectionDispositions = Array.isArray(envelope.sectionDispositions)
    ? envelope.sectionDispositions.flatMap((entry) => {
        const parsed = z.object({ section: z.string().trim().min(1), status: z.enum(["NOT_APPLICABLE", "NOT_OBSERVABLE"]), rationale: z.string().trim().min(1) }).safeParse(entry)
        return parsed.success ? [parsed.data] : []
      })
    : []
  const groupDispositions = Array.isArray(envelope.groupDispositions)
    ? envelope.groupDispositions.flatMap((entry) => {
        const parsed = z.object({ lines: z.array(z.string().trim()).min(1), status: z.enum(["NOT_APPLICABLE", "NOT_OBSERVABLE", "NOT_A_REQUIREMENT"]), rationale: z.string().trim().min(1) }).safeParse(entry)
        return parsed.success ? [parsed.data] : []
      })
    : []
  const sourceConflicts = Array.isArray(envelope.sourceConflicts)
    ? envelope.sourceConflicts.flatMap((entry) => {
        const parsed = z.object({ lines: z.array(z.string().trim()).min(1), description: z.string().trim().min(1) }).safeParse(entry)
        return parsed.success ? [parsed.data] : []
      })
    : []
  const limitations = Array.isArray(envelope.limitations) ? envelope.limitations.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim()) : []
  const argumentScripts: ModelScriptAssessment[] = Array.isArray(envelope.argumentScripts)
    ? envelope.argumentScripts.flatMap((entry, position) => {
        const parsed = z.object({ script: z.string().trim().min(1), applicability: z.enum(APPLICABILITIES), situation: nullableText, evidence: z.array(z.unknown()).nullish().transform((value) => value ?? []), rationale: z.string().trim().min(1) }).safeParse(entry)
        if (!parsed.success) {
          violations.push(`argumentScripts[${position}]:INVALID`)
          return []
        }
        return [{ ...parsed.data, evidence: evidenceList(parsed.data.evidence, violations, `argumentScripts[${position}].evidence`) }]
      })
    : []
  const duplicates = Array.isArray(envelope.duplicates)
    ? envelope.duplicates.flatMap((entry) => {
        const flag = z.boolean().nullish().catch(null).transform((value) => value ?? null)
        const parsed = z.object({ line: z.string().trim().min(1), sameAs: z.string().trim().min(1), rationale: nullableText, sameCondition: flag, samePurpose: flag, sameScope: flag, sameModality: flag }).safeParse(entry)
        return parsed.success ? [parsed.data] : []
      })
    : []
  const data = scenario.data
  return {
    ok: true,
    value: {
      scenario: { ...data, conditions: data.conditions.map((condition, index) => ({ text: condition.text, evidence: evidenceList(condition.evidence, violations, `scenario.conditions[${index}]`) })), pathEvidence: evidenceList(data.pathEvidence, violations, "scenario.pathEvidence") },
      criteria,
      sectionDispositions,
      groupDispositions,
      sourceConflicts,
      limitations,
      argumentScripts,
      duplicates,
      contractViolations: violations,
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Verificação
// ---------------------------------------------------------------------------------------------

export type VerifiedQuote = { turn: string; speaker: string | null; quote: string; timestamp: string | null }
export type RejectedQuote = { turn: string | null; quote: string; reason: string }
export type VerifiedGuidance = { moment: string; condition: string | null; action: string; ruleLines: { handle: string; text: string; heading: string | null }[] }

/** De onde veio a disposição: a análise, uma disposição de grupo, a revisão (linha que a análise deixou sem resposta) ou a lacuna de cobertura. */
export type CriterionOrigin = "ANALYSIS" | "GROUP" | "REVIEW_REPAIR" | "COVERAGE_GAP" | "REVIEW_CHALLENGE"
export type CriterionReviewRecord = { verdict: ClaimVerdict["verdict"]; issues: ReviewIssue[]; listReading: ListReading | null; conditionEvidence: VerifiedQuote[]; counterEvidence: VerifiedQuote[]; note: string | null; focus: ReviewFocus[]; /** V10 — o que a revisora leu na evidência e se a conclusão depende de execução fora da fala. */ evidenceReading?: EvidenceReading | null; outsideDependency?: boolean | null; /** V13 (`OBLIGATION_SPEECH_EXECUTION_V1`) — onde acontece o ato exigido, lido na fonte pela revisora, e as partes de uma obrigação mista. */ actPlace?: "IN_CONVERSATION" | "OUTSIDE_CONVERSATION" | "MIXED" | null; judgedPart?: string | null; outsidePart?: string | null }

export type AssessedCriterion = {
  lineHandle: string
  lineKey: string
  documentId: string
  documentHandle: string
  sectionHandle: string
  heading: string | null
  text: string
  /** Frase que abre a lista do item (parte da regra). */
  leadIn: string | null
  onPath: boolean
  origin: CriterionOrigin
  /** O que o modelo disse (auditoria). */
  declaredStatus: ModelCriterion["status"]
  /** Proposta DEPOIS das checagens de integridade (fala existe, falante, intenção ≠ execução, omissão com oportunidade). */
  proposedStatus: CriterionStatus
  /**
   * Status FINAL — o único que conta (memória, padrões, histórico, liderança, mensagem). Proposta determinada (cumpriu, não
   * cumpriu, parcial) só vira final CONFIRMADA; sem confirmação o final é "não observável" com o motivo em `downgrades`.
   */
  status: CriterionStatus
  confirmation: Confirmation
  confirmationReasons: ConfirmationReason[]
  review: CriterionReviewRecord | null
  evidenceKind: EvidenceKind
  declaredActionTense: "COMPLETED" | "INTENDED" | null
  evidence: VerifiedQuote[]
  rejectedEvidence: RejectedQuote[]
  opportunityTurn: string | null
  rationale: string | null
  materiality: Materiality
  guidance: VerifiedGuidance | null
  whyItMatters: string | null
  ruleConflict: boolean
  downgrades: string[]
  /** V5 — natureza do que a linha pede e papel no caso (leituras do modelo: análise ou, na contestação, revisora). */
  itemNature?: ItemNature | null
  scenarioRole?: ScenarioRole | null
  /** V7 — leitura SEMÂNTICA da exigência (modelo) e o que a evidência disponível sustenta (código). */
  requiredAction?: string | null
  applicability?: Applicability
  /** Condição/exceção da regra lida pela análise (null = vale sempre no caminho). Nunca deduzida do texto por palavra-chave. */
  condition?: string | null
  applicabilityEvidence?: VerifiedQuote[]
  observability?: Observability
  evidenceNeeded?: string | null
  /** Execução fora da conversa: o que a transcrição mostra (declarada, intenção, nada). Null = cumprimento na conversa. */
  executionClaim?: ExecutionClaim | null
  /** V10 — papel da linha na lista (leitura do modelo): ação, condição da ação da abertura, conteúdo da ação, opção. */
  lineRole?: LineRole | null
  /** Parte de uma regra COMPOSTA (`L12.1`…): o critério é a ação `part`; a regra literal inteira fica em `lineText`. */
  obligation?: { parentHandle: string; parentLineKey: string; index: number; of: number; part: string; lineText: string } | null
  /** Item de ARGUMENTÁRIO (não documento da base): campo, obrigatoriedade, grupo, condição e a situação que o aciona. */
  argument?: (ArgumentLineMeta & { trigger: string | null; notApplicableWhen: string | null; scopeLabel: string; scope: ArgumentDocumentMeta["scope"]; perspective?: RulePerspective }) | null
  /** V8 — a mesma exigência também está num argumentário (duplicidade por SENTIDO aceita): a avaliação é uma só, com as duas origens. */
  alsoRequiredBy?: { scriptId: string; scriptName: string; version: number; itemKey: string; lineHandle: string }[]
  /**
   * OBRIGAÇÃO COMPLETA (contrato `OBLIGATIONS_V1`): o critério é uma obrigação montada pela análise a partir de várias linhas da fonte
   * (`sources`, a primeira pede a conduta). `text` = linhas LITERAIS, em ordem; `titleText` = título literal (abertura + primeiro item).
   * `identityKey` = identidade da obrigação quando ela junta mais de uma linha (linha única = a identidade da própria linha).
   */
  contract?: "OBLIGATIONS_V1"
  obligationRef?: string | null
  sources?: { handle: string; lineKey: string; text: string; heading: string | null }[]
  items?: { text: string; line: string | null; status: "DONE" | "NOT_DONE" | "NOT_APPLICABLE" | "NOT_VERIFIABLE" }[]
  itemsMode?: "ALL" | "ANY" | "SEQUENCE" | "UNCLEAR" | "NONE"
  titleText?: string | null
  identityKey?: string | null
  /** Papel que a análise deu a cada trecho de `evidence` (mesma ordem): conduta, declaração, intenção, condição, fala do cliente. */
  evidenceRoles?: (string | null)[]
  /**
   * `CONDUCT_OCCURRENCE_V1` — a MESMA conduta (um ato, num mesmo momento da conversa) julgada por mais de uma regra: cada regra continua
   * avaliada e rastreável (cobertura por regra), mas a ocorrência é UMA (mensagem e contagem de ocorrências). Leitura da revisão
   * (`sameConductAs`), aceita só quando a estrutura confirma (mesmo momento ou mesma fala verificada). `SINGLE_RULE` = a revisão
   * podia ligar e não ligou: a conduta desta regra é uma ocorrência própria. Ausente/null = não determinável (leitura antiga, contrato
   * sem a ligação ou sem revisão) — nunca contar como ocorrência única nem como repetida. A chave inclui a chamada: nunca une chamadas.
   */
  occurrence?: { key: string; members: string[]; basis: "REVIEW_SAME_CONDUCT" | "SINGLE_RULE" } | null
  /** `LIST_COVERAGE_V2`: outros itens das listas que ESTA obrigação usa e que ninguém avaliou nesta chamada (nem a análise, nem a revisão).
   * Fato estrutural para a redação: um reconhecimento vale só para o que foi feito, nunca para a lista inteira. */
  notAssessedInSameList?: string[]
  /**
   * `OBLIGATION_SPEECH_EXECUTION_V1` — obrigação MISTA (parte na conversa + parte operacional) confirmada pela revisão: o status vale só
   * para `judgedPart` (o que acontece na conversa); `operationalPart` é a parte em sistema/registro, que a transcrição não comprova —
   * com o que a fala mostra sobre ela (declarada, anunciada, nada). Leituras da revisora; ausentes = obrigação de um só tipo.
   */
  judgedPart?: string | null
  operationalPart?: { text: string; executionClaim: ExecutionClaim } | null
  /**
   * `REVIEW_DIVERGENCE_V1` — a revisão leu esta MESMA obrigação (mesmas linhas) de outro modo que a análise. A divergência foi à
   * confirmação focal: a leitura da revisão confirmada substitui a da análise; refutada, fica a da análise; sem decisão, a obrigação
   * fica inconclusiva. Nenhuma das duas vence por ordem de execução.
   */
  /** Leitura da revisão que CONTESTA a da análise (mesma obrigação), à espera da confirmação focal — some depois da fusão. */
  contests?: { analysisHandle: string; analysisStatus: CriterionStatus; analysisReading: string | null } | null
  divergence?: { reviewHandle: string; analysisStatus: CriterionStatus; reviewStatus: CriterionStatus; reviewRationale: string | null; outcome: "REVIEW_READING_CONFIRMED" | "REVIEW_READING_REFUTED" | "UNRESOLVED"; reasons: string[] } | null
}

/** Aplicabilidade de um ARGUMENTÁRIO nesta chamada: leitura do modelo + integridade (situação sustentada por fala verificada). */
export type VerifiedScriptAssessment = { handle: string; scriptId: string; name: string; version: number; declaredApplicability: Applicability | null; applicability: Applicability; situation: string | null; evidence: VerifiedQuote[]; rationale: string | null; downgrade: string | null }

export type ReviewSummary = { version: typeof CALL_REVIEW_VERSION | "OBLIGATION_REVIEW_V1"; attempted: boolean; available: boolean; error: string | null; claims: number; confirmed: number; unconfirmed: number; refuted: number; linesAssessed: number; path: Confirmation | null; violations: string[]; /** V2 — descartes conferidos e o destino das contestações. */ exclusions?: { reviewed: number; challenged: number; ignored: number; reopened: number; reversedConfirmed: number; reversedUnconfirmed: number; /** V3 — enviados, respondidos e englobados por abertura de lista. */ sent?: number; answered?: number; aggregated?: number }; /** V3 — cobertura pedida à revisora. */ coverage?: { requested: number; answered: number; unanswered: number; withheld: number }; /** `CONDUCT_OCCURRENCE_V1` — ligações "mesma conduta" da revisão aceitas × recusadas pela estrutura. */ occurrenceLinks?: { accepted: number; rejected: number }; /** Achados encontrados só pela revisora e o destino de cada um (confirmação focal). */ discoveries?: { found: number; pending: number; confirmed: number; refuted: number; unconfirmed: number; notRun: number; notPrioritized: number; /** Obrigações que a revisão listou "de fora" mas que a análise já tinha (mesmas linhas): segunda leitura registrada. */ duplicatesOfAnalysis?: number; /** `REVIEW_DIVERGENCE_V1` — leituras diferentes da MESMA obrigação e o destino delas. */ divergences?: { found: number; reviewReadingConfirmed: number; reviewReadingRefuted: number; unresolved: number }; confirmation: { attempted: boolean; available: boolean; reason: string | null; error: string | null } | null } }

export type VerifiedCallAnalysis = {
  logicVersion: typeof CALL_ANALYSIS_LOGIC_VERSION
  transcriptStatus: TranscriptStatus
  scenario: {
    customerNeed: string
    conditions: { text: string; evidence: VerifiedQuote[] }[]
    procedureHandle: string | null
    procedureDocumentId: string | null
    procedureTitle: string | null
    procedureVersion: number | null
    /** Regra vigente na data da chamada × regra ATUAL usada para reavaliar (não havia versão vigente na data). */
    rulePerspective: RulePerspective | null
    procedureRationale: string | null
    pathSections: { handle: string; heading: string | null }[]
    correctPath: string
    pathTaken: string
    declaredPathAssessment: Exclude<PathAssessment, "NO_PROCEDURE">
    /** Caminho depois da sustentação estrutural (antes da revisão). */
    proposedPathAssessment: PathAssessment
    pathAssessment: PathAssessment
    pathConfirmation: Confirmation
    /** V10 — quantas etapas do caminho que se aplicam a conversa não permitiu verificar (CORRECT só com FULL). */
    pathCompleteness?: PathCompleteness
    pathRationale: string
    pathEvidence: VerifiedQuote[]
    /**
     * `PATH_VIGENTE_V1` — de onde vêm `pathTaken`/`pathRationale`: ANALYSIS = a leitura da análise continua valendo (todas as conclusões
     * em que ela se apoia foram confirmadas como propostas); FINAL_EVIDENCE = alguma conclusão mudou (refutada, não confirmada, fora da
     * conversa) ou a revisão achou algo novo — o texto vigente é montado pelo sistema a partir das conclusões FINAIS, e a leitura original
     * fica só em `analysisReading` (auditoria; nunca diagnóstico). Ausente = análises anteriores a esta regra.
     */
    pathRationaleSource?: "ANALYSIS" | "FINAL_EVIDENCE"
    analysisReading?: { assessment: string; pathTaken: string; rationale: string } | null
    /**
     * `CENTRAL_NEED_V1` — a pergunta relevante do caso respondida: a revisão diz se a necessidade central do cliente foi tratada NA
     * CONVERSA (orientação observável exigida pelas fontes × o que o cliente ouviu × o que a gravação não permite saber) e o código
     * cruza com as conclusões FINAIS das obrigações dessas linhas. `resolution` = o que o diagnóstico sustenta: falha confirmada,
     * tratada (confirmada ou só leitura da revisão), falta refutada, falta não confirmada ou não determinável. Ausente = anterior.
     */
    centralNeed?: {
      status: "ADDRESSED" | "PARTIALLY_ADDRESSED" | "NOT_ADDRESSED" | "NOT_DETERMINABLE"
      requiredGuidance: string
      sources: string[]
      /** As linhas literais de `sources` (as fontes podem não ser usadas por nenhuma obrigação). */
      sourceLines?: { handle: string; lineKey: string; documentId: string; text: string; heading: string | null }[]
      heard: VerifiedQuote[]
      unknown: string | null
      note: string | null
      linkedCriteria: string[]
      resolution: "GAP_CONFIRMED" | "ADDRESSED_CONFIRMED" | "ADDRESSED_REVIEW_ONLY" | "GAP_REFUTED" | "GAP_UNCONFIRMED" | "NOT_DETERMINABLE"
    } | null
  }
  criteria: AssessedCriterion[]
  notRequirements: string[]
  sectionDispositions: { section: string; heading: string | null; status: "NOT_APPLICABLE" | "NOT_OBSERVABLE"; rationale: string }[]
  coverage: { requiredLines: string[]; closingSections: string[]; missing: string[]; repairAttempted: boolean; status: "COMPLETE" | "PARTIAL"; /** `OBLIGATIONS_V1` — avaliado × não se aplica (com motivo) × não verificável pela evidência × não avaliado (limite/falha). */ byStatus?: { assessed: number; notApplicable: number; notVerifiable: number; notAssessed: number }; /** `CONDUCT_OCCURRENCE_V1` — desvios confirmados por REGRA × por OCORRÊNCIA (a mesma conduta julgada por duas regras conta uma vez). */ occurrences?: { adverseRules: number; adverseOccurrences: number; metRules: number; metOccurrences: number }; /** `LIST_COVERAGE_V2` — itens das listas usadas pelas obrigações que a análise não avaliou: encontrados × mostrados à revisão como contexto × apontados por ela como faltantes (que seguem como achados da revisão). */ listItems?: { found: number; shownToReview: number; raisedByReview: number }; /** `SITUATION_SECTIONS_V1` — seções acionadas por situação: declaradas × aconteceram (com fala verificada) × linhas sem avaliação × mostradas à revisão × apontadas por ela. */ situations?: { declared: number; happened: number; linesFound: number; shownToReview: number; raisedByReview: number } }
  sourceConflicts: { lines: string[]; description: string }[]
  limitations: string[]
  /** V7 — argumentários considerados (aplicabilidade verificada), duplicidades com a base, regras compostas e a evidência disponível. */
  argumentScripts?: VerifiedScriptAssessment[]
  /** Duplicidades entre argumentário e base. V8: só `ANALYSIS` (leitura semântica conferida — `accepted`); `EXACT_TEXT` existe só
   * em leituras V7 (texto igual descartava o item antes da análise). Recusada = as duas linhas continuam avaliadas. */
  duplicates?: { line: string; sameAs: string; origin: "EXACT_TEXT" | "ANALYSIS"; rationale: string | null; accepted?: boolean; equivalence?: { condition: boolean | null; purpose: boolean | null; scope: boolean | null; modality: boolean | null }; rejectedBecause?: string[]; sameText?: boolean }[]
  composites?: { lineHandle: string; lineKey: string; text: string; parts: string[] }[]
  evidenceAvailability?: EvidenceAvailability
  /** V7 — limites de COBERTURA (nunca erro nem acerto): execução fora da conversa, aplicabilidade incerta, declarações e intenções. */
  coverageLimits?: { outsideConversation: number; applicabilityUncertain: number; declaredExecutions: number; intendedExecutions: number }
  /** V5 — notas TÉCNICAS (revisão, cobertura, seleção do procedimento): auditoria, nunca exibidas ao colaborador. */
  auditNotes?: string[]
  checks: { procedureSelection: "CONSISTENT_WITH_SUBJECT" | "DIFFERENT_FROM_SUBJECT_EXPLAINED" | "DIFFERENT_FROM_SUBJECT_UNEXPLAINED" | "NO_SUBJECT_ANCHOR" | "NO_PROCEDURE"; evidenceRejected: number; downgraded: number; contractViolations: string[]; review: ReviewSummary }
  outcome: AnalysisOutcome
  outcomeReasons: string[]
}

export type PathCompleteness = { status: "FULL" | "LIMITED"; applicable: number; outsideConversation: number; notAssessed: number; unconfirmed: number; applicabilityUncertain: number; otherNotObservable: number }
/** Etapas do caminho (seções escolhidas pela análise) que se aplicam e o que a evidência permitiu concluir de cada uma. */
export function pathCompletenessOf(criteria: readonly Pick<AssessedCriterion, "onPath" | "ruleConflict" | "status" | "proposedStatus" | "applicability" | "observability" | "confirmation">[]): PathCompleteness {
  const applicable = criteria.filter((criterion) => criterion.onPath && !criterion.ruleConflict && criterion.status !== "NOT_APPLICABLE" && criterion.applicability !== "DOES_NOT_APPLY")
  const open = applicable.filter((criterion) => !(isDeterminate(criterion.status) && criterion.confirmation === "CONFIRMED"))
  const outsideConversation = open.filter((criterion) => criterion.observability === "OUTSIDE_CONVERSATION").length
  const notAssessed = open.filter((criterion) => criterion.observability !== "OUTSIDE_CONVERSATION" && criterion.status === "NOT_ASSESSED").length
  const unconfirmed = open.filter((criterion) => criterion.observability !== "OUTSIDE_CONVERSATION" && criterion.status !== "NOT_ASSESSED" && isDeterminate(criterion.proposedStatus)).length
  const applicabilityUncertain = open.filter((criterion) => criterion.observability !== "OUTSIDE_CONVERSATION" && criterion.status !== "NOT_ASSESSED" && !isDeterminate(criterion.proposedStatus) && criterion.applicability === "UNCERTAIN").length
  const otherNotObservable = open.length - outsideConversation - notAssessed - unconfirmed - applicabilityUncertain
  return { status: open.length > 0 ? "LIMITED" : "FULL", applicable: applicable.length, outsideConversation, notAssessed, unconfirmed, applicabilityUncertain, otherNotObservable }
}

/** A revisão desta análise: não tentada (análise preliminar), tentada e disponível, ou tentada e indisponível (falha/orçamento). */
/** `requested` (V3): o que foi PEDIDO à revisora — para registrar o que ficou sem resposta (nunca contado como revisado). */
export type ReviewInput = { attempted: boolean; review: CallReview | null; error: string | null; requested?: { linesToAssess: string[]; linesWithheld: number; exclusions: string[] }; /** V10 — as propostas EXATAMENTE como enviadas à revisora (foco, regra, lista). */ sentClaims?: SentReviewClaim[] }
/** Proposta como foi ENVIADA à revisora (o que a decisão pode exigir). */
export type SentReviewClaim = Pick<ReviewClaim, "id" | "status" | "focus" | "rule">
/**
 * CONFIRMAÇÃO FOCAL dos achados que só a revisão encontrou (`REVIEW_DISCOVERY_CONFIRMATION_V1`): uma leitura independente, só desses
 * achados, com a regra completa e a transcrição inteira. Ausente = não houve achado pendente (ou a execução não chegou lá);
 * `attempted` sem `review` = não rodou (orçamento/falha) — o achado fica inconclusivo com o motivo, nunca descartado nem aceito.
 */
export type ConfirmationInput = { attempted: boolean; review: CallReview | null; error: string | null; reason: "BUDGET" | "TECHNICAL" | "CONTRACT" | null; sentClaims: SentReviewClaim[] }

export type VerificationInput = {
  model: ModelCallAnalysis
  context: ProcedureContext
  projection: TranscriptProjection
  transcriptStatus: TranscriptStatus
  interactionId: string
  /** Documentos que o ASSUNTO registrado da chamada ancora (título do documento contém o assunto). */
  subjectAnchoredDocumentIds: readonly string[]
  repairAttempted: boolean
  /** Ausente = passagem PRELIMINAR (só integridade — base dos alvos da revisão); nada é confirmado. */
  review?: ReviewInput
  /** Confirmação focal dos achados descobertos pela revisão (quando houve achado pendente). */
  confirmation?: ConfirmationInput
}

const speakerOf = (speaker: string | null) => (speaker ?? "").trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()

export function verifyQuotes(units: readonly ModelEvidenceUnit[], interactions: ReadonlyMap<string, ProjectedInteraction>, projection: TranscriptProjection): { verified: VerifiedQuote[]; rejected: RejectedQuote[] } {
  const verified: VerifiedQuote[] = []
  const rejected: RejectedQuote[] = []
  for (const unit of units) {
    const verdict = verifyEvidenceUnit({ interactionRef: "I1", turnRef: canonicalHandle(unit.turn), speaker: unit.speaker ?? null, quote: unit.quote }, interactions)
    if (!verdict.ok) {
      rejected.push({ turn: unit.turn, quote: unit.quote, reason: verdict.reason })
      continue
    }
    const turn = projection.turns.find((entry) => entry.handle === verdict.evidence.turnRef)
    if (!verified.some((entry) => entry.turn === verdict.evidence.turnRef && entry.quote === verdict.evidence.quote)) verified.push({ turn: verdict.evidence.turnRef, speaker: verdict.evidence.speaker, quote: verdict.evidence.quote, timestamp: turn?.audit.timestamp ?? null })
  }
  return { verified, rejected }
}

const isOperator = (quote: VerifiedQuote) => OPERATOR_SPEAKERS.has(speakerOf(quote.speaker))
const isCustomer = (quote: VerifiedQuote) => CUSTOMER_SPEAKERS.has(speakerOf(quote.speaker))
const DETERMINATE = new Set<CriterionStatus>(["MET", "NOT_MET", "PARTIAL"])
export const isDeterminate = (status: CriterionStatus) => DETERMINATE.has(status)

/** Seções EM JOGO neste atendimento: as do caminho, as de encerramento e as que têm alguma etapa decidida (cumprida/não/parcial). */
export function sectionsInPlayOf(input: { pathSections: readonly { handle: string }[]; closing: readonly { handle: string }[]; criteria: readonly Pick<AssessedCriterion, "sectionHandle" | "proposedStatus">[] }): Set<string> {
  return new Set([...input.pathSections.map((section) => section.handle), ...input.closing.map((section) => section.handle), ...input.criteria.filter((criterion) => DETERMINATE.has(criterion.proposedStatus)).map((criterion) => criterion.sectionHandle)])
}

export function verifyCallAnalysis(input: VerificationInput): VerifiedCallAnalysis {
  const { model, context, projection, transcriptStatus } = input
  const interactions = new Map<string, ProjectedInteraction>([["I1", { interactionRef: "I1", interactionId: input.interactionId, projection }]])
  const limitations = [...model.limitations]
  // Notas técnicas (revisão, cobertura, seleção do procedimento): ficam na auditoria — nunca nos detalhes do colaborador.
  const auditNotes: string[] = []
  let evidenceRejected = 0
  let downgraded = 0

  // Procedimento e caminho: só handles apresentados.
  const procedureDocument = model.scenario.procedure ? context.documents.find((document) => document.handle === canonicalHandle(model.scenario.procedure!)) ?? null : null
  if (model.scenario.procedure && !procedureDocument) auditNotes.push("O procedimento indicado pela análise não estava entre os documentos apresentados.")
  const pathSections = [...new Set(model.scenario.pathSections.map((handle) => canonicalHandle(handle)))].flatMap((handle) => {
    const section = context.sections.get(handle)
    return section ? [section] : []
  })
  const conflictLines = new Set(model.sourceConflicts.flatMap((conflict) => conflict.lines.map((line) => canonicalHandle(line))))
  const pathSectionHandles = new Set(pathSections.map((section) => section.handle))

  const notRequirements: string[] = []
  const assessed = new Map<string, AssessedCriterion>()
  const scripts = verifyScriptAssessments(model, context, interactions, projection)
  const scriptApplicability = new Map(scripts.map((script) => [script.scriptId, script.applicability]))
  const argumentOf = (line: ProcedureLine): NonNullable<AssessedCriterion["argument"]> | null => {
    if (!line.argument) return null
    const meta = context.documents.find((document) => document.handle === line.documentHandle)?.argument
    return { ...line.argument, trigger: meta?.trigger ?? null, notApplicableWhen: meta?.notApplicableWhen ?? null, scopeLabel: meta?.scopeLabel ?? "", scope: meta?.scope ?? { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, teamName: null, subteamName: null }, perspective: meta?.perspective ?? "RULE_IN_FORCE_AT_CALL" }
  }
  const baseOf = (line: ProcedureLine) => ({ lineHandle: line.handle, lineKey: line.lineKey, documentId: line.documentId, documentHandle: line.documentHandle, sectionHandle: line.sectionHandle, heading: line.heading, text: line.text, leadIn: line.leadIn, onPath: pathSectionHandles.has(line.sectionHandle), argument: argumentOf(line), obligation: null })
  // DUPLICIDADE POR SENTIDO (`DUPLICATE_BY_MEANING_V1`): texto igual nunca elimina uma exigência. Só vale a leitura semântica que
  // declara a MESMA obrigação em todas as dimensões (condição, finalidade, escopo, modalidade) com o porquê, e o código confere a
  // integridade: as duas linhas existem, vêm de fontes diferentes (argumentário × base) e a da base recebeu disposição nesta análise
  // (senão a avaliação se perderia). Aceita = avaliada uma vez só, na linha da base, com as duas origens registradas; recusada (ou na
  // dúvida) = as duas continuam avaliadas, cada uma na sua situação.
  const dispositioned = dispositionedLinesOf(model, context)
  const sameTextPairs = new Set((context.sameText ?? []).map((entry) => `${entry.lineHandle}>${entry.sameAsHandle}`))
  const duplicates: NonNullable<VerifiedCallAnalysis["duplicates"]> = []
  const duplicateLines = new Set<string>()
  const alsoRequiredBy = new Map<string, { scriptId: string; scriptName: string; version: number; itemKey: string; lineHandle: string }[]>()
  for (const entry of model.duplicates ?? []) {
    const line = context.lines.get(canonicalHandle(entry.line))
    const same = context.lines.get(canonicalHandle(entry.sameAs))
    if (!line?.argument || !same || same.argument) {
      model.contractViolations.push(`duplicates:${canonicalHandle(entry.line)}:NOT_ARGUMENT_TO_KNOWLEDGE`)
      continue
    }
    const { equivalence, rejectedBecause: reasons } = duplicateCheckOf(entry, same.handle, dispositioned)
    const rejectedBecause = [...reasons, ...(duplicateLines.has(line.handle) ? ["ALREADY_DUPLICATED"] : [])]
    const accepted = rejectedBecause.length === 0
    duplicates.push({ line: line.handle, sameAs: same.handle, origin: "ANALYSIS", rationale: entry.rationale, accepted, equivalence, ...(accepted ? {} : { rejectedBecause }), sameText: sameTextPairs.has(`${line.handle}>${same.handle}`) })
    if (!accepted) {
      auditNotes.push(`Duplicidade declarada entre [${line.handle}] (argumentário) e [${same.handle}] (base) não aceita (${rejectedBecause.join(", ")}): as duas continuam avaliadas.`)
      continue
    }
    duplicateLines.add(line.handle)
    alsoRequiredBy.set(same.handle, [...(alsoRequiredBy.get(same.handle) ?? []), { scriptId: line.argument.scriptId, scriptName: line.argument.scriptName, version: line.argument.version, itemKey: line.argument.itemKey, lineHandle: line.handle }])
  }
  // Turnos que a análise citou como CONDIÇÕES do cenário (falas conferidas): base da regra "condição ≠ conduta" (`CONDITION_TURNS_V1`).
  const scenarioConditionTurns = new Set(model.scenario.conditions.flatMap((condition) => verifyQuotes(condition.evidence, interactions, projection).verified.map((quote) => quote.turn)))
  // Partes de regras COMPOSTAS (L12.1…): linhas sintéticas (mesma fonte, texto = a parte) para revisão e contestação.
  const syntheticLines = new Map<string, ProcedureLine>()
  const composites: NonNullable<VerifiedCallAnalysis["composites"]> = []
  const decomposed = new Set<string>()
  for (const criterion of model.criteria) {
    const handle = canonicalHandle(criterion.line)
    const line = context.lines.get(handle)
    if (!line) {
      model.contractViolations.push(`criteria:${handle}:UNKNOWN_LINE`)
      continue
    }
    if (assessed.has(handle) || decomposed.has(handle) || notRequirements.includes(handle) || duplicateLines.has(handle)) continue
    if (criterion.status === "NOT_A_REQUIREMENT") {
      notRequirements.push(handle)
      continue
    }
    // Orientação "pode" do argumentário: opcional — não fazer nunca é falha (a obrigatoriedade é do cadastro, não da leitura).
    if (line.argument?.field === "GUIDANCE" && line.argument.modality === "MAY" && (criterion.status === "NOT_MET" || criterion.status === "PARTIAL")) {
      notRequirements.push(handle)
      auditNotes.push(`[${handle}] é orientação opcional ("pode") do argumentário: não ter sido feita não conta como desvio.`)
      continue
    }
    // Regra composta: cada parte LITERAL da linha vira um critério próprio (a integridade confere que a parte está na regra).
    const parts = (criterion.obligations ?? []).filter((obligation) => {
      const literal = normalizeForLiteralQuote(obligation.part).length >= 6 && normalizeForLiteralQuote(line.text).includes(normalizeForLiteralQuote(obligation.part))
      if (!literal) model.contractViolations.push(`criteria:${handle}:OBLIGATION_PART_NOT_IN_RULE`)
      return literal
    })
    if (parts.length >= 2) {
      decomposed.add(handle)
      composites.push({ lineHandle: handle, lineKey: line.lineKey, text: line.text, parts: parts.map((part) => part.part) })
      const adverseParts = parts.filter((part) => part.status === "NOT_MET" || part.status === "PARTIAL").length
      const metParts = parts.filter((part) => part.status === "MET").length
      parts.forEach((part, index) => {
        const ref = `${handle}.${index + 1}`
        const partKey = `${line.lineKey}#${createHash("sha256").update(normalizeForLiteralQuote(part.part)).digest("hex").slice(0, 8)}`
        const synthetic: ProcedureLine = { ...line, handle: ref, lineKey: partKey, text: part.part }
        syntheticLines.set(ref, synthetic)
        const unit = assessUnit({ line, unit: { ...part, itemNature: part.itemNature ?? criterion.itemNature ?? null, lineRole: part.lineRole ?? criterion.lineRole ?? null }, scriptApplicability, interactions, projection, transcriptStatus, conditionTurns: scenarioConditionTurns })
        evidenceRejected += unit.rejected
        if (unit.status !== part.status) downgraded += 1
        assessed.set(ref, {
          ...baseOf(line),
          lineHandle: ref,
          lineKey: partKey,
          text: part.part,
          obligation: { parentHandle: handle, parentLineKey: line.lineKey, index: index + 1, of: parts.length, part: part.part, lineText: line.text },
          origin: criterion.origin ?? "ANALYSIS",
          declaredStatus: part.status,
          proposedStatus: unit.status,
          status: unit.status,
          confirmation: "NOT_A_CLAIM",
          confirmationReasons: [],
          review: null,
          evidenceKind: unit.evidenceKind,
          declaredActionTense: part.declaredActionTense ?? null,
          evidence: unit.evidence,
          rejectedEvidence: unit.rejectedEvidence,
          opportunityTurn: unit.opportunityTurn,
          rationale: part.rationale,
          materiality: criterion.materiality ?? "MEDIUM",
          // A orientação/"por que importa" da linha só acompanham a parte quando ela é a ÚNICA parte daquele tipo (nunca adivinhada).
          guidance: (unit.status === "NOT_MET" || unit.status === "PARTIAL") && adverseParts === 1 ? guidanceOf(criterion, line, context) : null,
          whyItMatters: unit.status === "MET" && metParts === 1 ? criterion.whyItMatters : null,
          ruleConflict: conflictLines.has(handle),
          downgrades: unit.downgrades,
          itemNature: part.itemNature ?? criterion.itemNature ?? null,
          scenarioRole: criterion.scenarioRole ?? null,
          requiredAction: part.requiredAction,
          applicability: unit.applicability,
          condition: part.condition ?? criterion.condition ?? null,
          applicabilityEvidence: unit.applicabilityEvidence,
          observability: unit.observability,
          evidenceNeeded: part.evidenceNeeded,
          executionClaim: unit.executionClaim,
          lineRole: part.lineRole ?? criterion.lineRole ?? null,
        })
      })
      continue
    }
    const unit = assessUnit({ line, unit: { ...criterion, applicabilityEvidence: criterion.applicabilityEvidence ?? [] }, scriptApplicability, interactions, projection, transcriptStatus, conditionTurns: scenarioConditionTurns })
    evidenceRejected += unit.rejected
    if (unit.status !== criterion.status) downgraded += 1
    assessed.set(handle, {
      ...baseOf(line),
      origin: criterion.origin ?? "ANALYSIS",
      declaredStatus: criterion.status,
      proposedStatus: unit.status,
      status: unit.status,
      confirmation: "NOT_A_CLAIM",
      confirmationReasons: [],
      review: null,
      evidenceKind: unit.evidenceKind,
      declaredActionTense: criterion.declaredActionTense ?? null,
      evidence: unit.evidence,
      rejectedEvidence: unit.rejectedEvidence,
      opportunityTurn: unit.opportunityTurn,
      rationale: criterion.rationale,
      materiality: criterion.materiality ?? "MEDIUM",
      guidance: unit.status === "NOT_MET" || unit.status === "PARTIAL" ? guidanceOf(criterion, line, context) : null,
      whyItMatters: unit.status === "MET" ? criterion.whyItMatters : null,
      ruleConflict: conflictLines.has(handle),
      downgrades: unit.downgrades,
      itemNature: criterion.itemNature ?? null,
      scenarioRole: criterion.scenarioRole ?? null,
      requiredAction: criterion.requiredAction ?? null,
      applicability: unit.applicability,
      condition: criterion.condition ?? null,
      applicabilityEvidence: unit.applicabilityEvidence,
      observability: unit.observability,
      evidenceNeeded: criterion.evidenceNeeded ?? null,
      executionClaim: unit.executionClaim,
      lineRole: criterion.lineRole ?? null,
    })
  }
  const lineOfRef = (ref: string) => context.lines.get(ref) ?? syntheticLines.get(ref)

  // Disposições AGRUPADAS: linhas sem evidência individual (não se aplica / não observável) viram registro com o motivo do grupo;
  // "não é exigência" sai da cobertura. Uma linha já avaliada individualmente nunca é sobrescrita pelo grupo.
  for (const group of model.groupDispositions) {
    for (const reference of group.lines) {
      const handle = canonicalHandle(reference)
      const line = context.lines.get(handle)
      if (!line || assessed.has(handle) || decomposed.has(handle) || duplicateLines.has(handle) || notRequirements.includes(handle)) continue
      if (group.status === "NOT_A_REQUIREMENT") {
        notRequirements.push(handle)
        continue
      }
      assessed.set(handle, { ...baseOf(line), origin: "GROUP", declaredStatus: group.status, proposedStatus: group.status, status: group.status, confirmation: "NOT_A_CLAIM", confirmationReasons: [], review: null, evidenceKind: "NONE", declaredActionTense: null, evidence: [], rejectedEvidence: [], opportunityTurn: null, rationale: group.rationale, materiality: "LOW", guidance: null, whyItMatters: null, ruleConflict: conflictLines.has(handle), downgrades: [] })
    }
  }

  // Duplicidade por sentido aceita: a avaliação única (na linha da base) leva as duas origens.
  for (const [handle, sources] of alsoRequiredBy) {
    const criterion = assessed.get(handle)
    if (criterion) criterion.alsoRequiredBy = sources
  }

  // Disposições de seção inteira (só seções apresentadas).
  const sectionDispositions = model.sectionDispositions.flatMap((entry) => {
    const section = context.sections.get(canonicalHandle(entry.section))
    return section ? [{ section: section.handle, heading: section.heading, status: entry.status, rationale: entry.rationale }] : []
  })
  const sectionCovered = new Set(sectionDispositions.map((entry) => entry.section))

  // Cobertura: itens de lista do caminho + (transcrição completa) as seções de encerramento do procedimento.
  const closing = procedureDocument && transcriptStatus === "COMPLETE" ? closingSectionsOf(context, procedureDocument.handle) : []
  // O caminho é a escolha (semântica) da análise: as seções dele são cobradas qualquer que seja o título; as de encerramento entram
  // pela pista do título só como PEDIDO de cobertura (nunca como conclusão). Argumentário que se aplica: os itens avaliáveis dele.
  const requiredSections = new Map([...pathSections, ...closing].map((section) => [section.handle, section]))
  const requiredLines: ProcedureLine[] = [
    ...[...requiredSections.values()].flatMap((section) => section.lines.filter((line) => line.kind === "LIST_ITEM")),
    ...requiredScriptLinesOf(context, scriptApplicability).filter((line) => !requiredSections.has(line.sectionHandle)),
  ]
  const missing = requiredLines.filter((line) => !assessed.has(line.handle) && !decomposed.has(line.handle) && !duplicateLines.has(line.handle) && !notRequirements.includes(line.handle) && !sectionCovered.has(line.sectionHandle)).map((line) => line.handle)
  for (const handle of missing) {
    const line = context.lines.get(handle)!
    assessed.set(handle, { ...baseOf(line), origin: "COVERAGE_GAP", declaredStatus: "NOT_OBSERVABLE", proposedStatus: "NOT_ASSESSED", status: "NOT_ASSESSED", confirmation: "NOT_A_CLAIM", confirmationReasons: [], review: null, evidenceKind: "NONE", declaredActionTense: null, evidence: [], rejectedEvidence: [], opportunityTurn: null, rationale: null, materiality: "MEDIUM", guidance: null, whyItMatters: null, ruleConflict: false, downgrades: ["NOT_ASSESSED_BY_ANALYSIS"] })
  }
  if (missing.length > 0) auditNotes.push(`${missing.length} item(ns) do caminho do procedimento ficaram sem avaliação — a análise é parcial.`)

  // Caminho PROPOSTO: afirmação precisa de sustentação estrutural (fala do operador ou etapa do caminho proposta como desvio).
  const criteriaList = [...assessed.values()]
  const pathVerified = verifyQuotes(model.scenario.pathEvidence, interactions, projection)
  evidenceRejected += pathVerified.rejected.length
  let proposedPath: PathAssessment = procedureDocument ? model.scenario.pathAssessment : "NO_PROCEDURE"
  const onPathProposed = (statuses: CriterionStatus[]) => criteriaList.some((criterion) => criterion.onPath && !criterion.ruleConflict && statuses.includes(criterion.proposedStatus))
  if ((proposedPath === "INCORRECT" || proposedPath === "PARTIALLY_CORRECT") && !(pathVerified.verified.some(isOperator) || onPathProposed(["NOT_MET", "PARTIAL"]))) {
    proposedPath = "UNDETERMINED"
    auditNotes.push("A análise indicou desvio de caminho, mas nenhuma evidência verificada sustenta essa conclusão.")
  } else if (proposedPath === "CORRECT" && !onPathProposed(["MET"])) {
    proposedPath = "UNDETERMINED"
  }

  const conditions = model.scenario.conditions.map((condition) => {
    const quotes = verifyQuotes(condition.evidence, interactions, projection)
    evidenceRejected += quotes.rejected.length
    return { text: condition.text, evidence: quotes.verified }
  })

  // CONFIRMAÇÃO (interpretação): cada proposta determinada passa pela revisão; o código decide. Sem revisão, nada é confirmado.
  const lists = listContextOf(context)
  const reviewInput = input.review ?? null
  const review = reviewInput?.review ?? null
  const openings = listOpeningsOf(context)
  // FOCO COMO ENVIADO (`REVIEW_FOCUS_AS_SENT_V1`, defeito da rodada real de 02/10): a revisão decide sobre o pedido que RECEBEU. As
  // linhas que ela mesma avaliou na mesma resposta (REVIEW_REPAIR) não existiam como proposta quando o pedido foi montado — recalcular
  // o foco com elas criava um "item com irmão cumprido" que a revisora nunca viu e derrubava confirmações explícitas (proibição
  // violada confirmada com a fala virava "leitura da lista incerta"). Só a MESMA FALA provando um item irmão (avaliado pela revisão)
  // continua barrando o desvio — proteção da alternativa cumprida (C07, "estorno").
  // V10 (`REVIEW_FOCUS_AS_SENT_V2`): quando o pedido ENVIADO está registrado (`sentClaims`), a decisão usa exatamente aqueles alvos —
  // foco, regra e lista como a revisora os viu; sem o registro (execuções anteriores), os alvos são recompostos do que a análise propôs.
  const asSent = criteriaList.map((criterion) => (criterion.origin === "REVIEW_REPAIR" ? { ...criterion, proposedStatus: "NOT_ASSESSED" as CriterionStatus } : criterion))
  const sentClaims: SentReviewClaim[] = reviewInput?.sentClaims ?? reviewTargetsOf({ criteria: asSent, lists, projection, path: null, missing: [], openings }).claims
  const targetOf = new Map(sentClaims.map((claim) => [canonicalCriterionRef(claim.id), claim]))
  // COERÊNCIA da própria resposta (não é requisito novo): a revisora avaliou um item irmão (linha sem disposição da análise) como
  // cumprido com a MESMA fala que ela confirma como prova deste desvio — as duas respostas só se sustentam juntas numa lista cumulativa.
  const sameEvidenceAfterReview = sameEvidenceAsSibling(criteriaList, lists)
  const reviewContract = review?.contract ?? "LEGACY"
  let confirmedCount = 0
  let unconfirmedCount = 0
  let refutedCount = 0
  // ACHADOS DA REVISÃO (`REVIEW_DISCOVERY_CONFIRMATION_V1`): um desvio que só a revisora encontrou não é descartado por isso (antes:
  // `SINGLE_PASS_REPAIR`, sempre — a rodada V9 perdeu assim o protocolo não informado antes da transferência) nem aceito só porque ela
  // o afirmou: íntegro e aplicável, ele vai a uma CONFIRMAÇÃO FOCAL; sem ela (orçamento/falha), fica inconclusivo com o motivo.
  const discoveries = new Set(reviewDiscoveriesOf(criteriaList).map((criterion) => criterion.lineHandle))
  const confirmationInput = input.confirmation ?? null
  const confirmationTargets = new Map((confirmationInput?.sentClaims ?? []).map((claim) => [canonicalCriterionRef(claim.id), claim]))
  const discoverySummary = { found: discoveries.size, pending: 0, confirmed: 0, refuted: 0, unconfirmed: 0, notRun: 0, notPrioritized: 0 }
  for (const criterion of criteriaList) {
    if (!isDeterminate(criterion.proposedStatus) || criterion.ruleConflict) continue
    const fromReview = criterion.origin === "REVIEW_REPAIR"
    const target = fromReview ? confirmationTargets.get(criterion.lineHandle) : targetOf.get(criterion.lineHandle)
    const verdict = fromReview ? confirmationInput?.review?.claims.get(criterion.lineHandle) ?? null : review?.claims.get(criterion.lineHandle) ?? null
    const conditionEvidence = verdict ? verifyQuotes(verdict.conditionEvidence, interactions, projection).verified : []
    const counterEvidence = verdict ? verifyQuotes(verdict.counterEvidence, interactions, projection).verified : []
    const reviewDecision = (claimTarget: SentReviewClaim | undefined, available: boolean, contract: typeof reviewContract): ConfirmationDecision => decideConfirmation({ claim: { ...(claimTarget ?? { status: criterion.proposedStatus as "MET", focus: [], rule: { section: criterion.heading, leadIn: criterion.leadIn, text: criterion.text, conditional: false, sameList: [] } }), evidenceKind: criterion.evidenceKind }, verdict, reviewAvailable: available, verifiedConditionEvidence: conditionEvidence, verifiedCounterEvidence: counterEvidence, contract })
    let decision: ConfirmationDecision
    if (!reviewInput) decision = { confirmation: "UNCONFIRMED", reasons: ["REVIEW_UNAVAILABLE"] }
    else if (!fromReview) decision = reviewDecision(target, Boolean(review), reviewContract)
    else if (!discoveries.has(criterion.lineHandle)) {
      decision = { confirmation: "UNCONFIRMED", reasons: ["REVIEW_DISCOVERY_NOT_PRIORITIZED"] }
      discoverySummary.notPrioritized += 1
    } else if (confirmationInput?.review && target) {
      decision = reviewDecision(target, true, confirmationInput.review.contract ?? "V7")
      if (decision.confirmation === "CONFIRMED") discoverySummary.confirmed += 1
      else if (decision.confirmation === "REFUTED") discoverySummary.refuted += 1
      else discoverySummary.unconfirmed += 1
    } else if (confirmationInput?.attempted) {
      decision = { confirmation: "UNCONFIRMED", reasons: ["CONFIRMATION_NOT_RUN"] }
      discoverySummary.notRun += 1
    } else {
      decision = { confirmation: "UNCONFIRMED", reasons: ["PENDING_CONFIRMATION"] }
      discoverySummary.pending += 1
    }
    const adverse = criterion.proposedStatus === "NOT_MET" || criterion.proposedStatus === "PARTIAL"
    if (decision.confirmation === "CONFIRMED" && adverse && sameEvidenceAfterReview.has(criterion.lineKey) && !target?.focus.includes("SAME_EVIDENCE_AS_SIBLING") && (target?.rule.declaredReading ?? verdict?.listReading) !== "CUMULATIVE") decision = { confirmation: "UNCONFIRMED", reasons: ["REVIEW_SELF_INCONSISTENT"] }
    criterion.confirmation = decision.confirmation
    criterion.confirmationReasons = decision.reasons
    criterion.review = verdict ? { verdict: verdict.verdict, issues: verdict.issues, listReading: verdict.listReading, conditionEvidence, counterEvidence, note: verdict.note, focus: target?.focus ?? [], evidenceReading: verdict.evidenceReading ?? null, outsideDependency: verdict.outsideDependency ?? null } : target ? { verdict: "UNCERTAIN", issues: [], listReading: null, conditionEvidence: [], counterEvidence: [], note: null, focus: target.focus } : null
    // A revisora leu que a conclusão depende de execução fora da fala (ou que a prova é uma declaração sobre ela): a leitura semântica
    // volta a "fora da conversa" e a fala do operador fica registrada como declaração/intenção — nunca como conduta (política única).
    if (decision.reasons.includes("EXECUTION_OUTSIDE_CONVERSATION") || decision.reasons.includes("DECLARATION_IS_NOT_EXECUTION")) {
      const operatorSpoke = criterion.evidence.some(isOperator)
      criterion.observability = "OUTSIDE_CONVERSATION"
      criterion.executionClaim = criterion.declaredActionTense === "INTENDED" ? "INTENDED" : operatorSpoke && (criterion.proposedStatus === "MET" || criterion.proposedStatus === "PARTIAL" || criterion.evidenceKind === "DECLARED_ACTION") ? "DECLARED" : "NONE"
      if (criterion.executionClaim !== "NONE") criterion.evidenceKind = "DECLARED_ACTION"
      criterion.opportunityTurn = null
    }
    if (decision.confirmation === "CONFIRMED") {
      confirmedCount += 1
      continue
    }
    if (decision.confirmation === "REFUTED") refutedCount += 1
    else unconfirmedCount += 1
    criterion.status = "NOT_OBSERVABLE"
    criterion.guidance = null
    criterion.whyItMatters = null
    criterion.downgrades = [...criterion.downgrades, `${decision.confirmation}:${decision.reasons.join("+")}`]
  }

  // DESCARTES contestados pela revisão (V2): mesma seleção que foi à revisora; o código decide (`decideExclusionChallenge`).
  const exclusionSummary = { reviewed: 0, challenged: 0, ignored: 0, reopened: 0, reversedConfirmed: 0, reversedUnconfirmed: 0, sent: 0, answered: 0, aggregated: 0 }
  if (review) {
    // Mesma seleção que foi à revisora: só o que a ANÁLISE disse (linhas avaliadas pela própria revisão não entram).
    const analysisCriteria = criteriaList.filter((criterion) => criterion.origin !== "REVIEW_REPAIR")
    const inPlay = sectionsInPlayOf({ pathSections, closing: procedureDocument && transcriptStatus === "COMPLETE" ? closingSectionsOf(context, procedureDocument.handle) : [], criteria: analysisCriteria })
    const notRequirementLines = notRequirements.flatMap((handle) => {
      const line = context.lines.get(handle)
      return line ? [line] : []
    })
    const targets = exclusionTargetsOf({ criteria: analysisCriteria, notRequirementLines, lists, inPlaySections: inPlay, openings })
    // Enviado ≠ respondido: o que a revisora não respondeu fica registrado como tal (omitir um descarte = mantido; nunca "revisado").
    exclusionSummary.sent = targets.length
    exclusionSummary.answered = targets.filter((target) => review.exclusions?.has(target.id)).length
    exclusionSummary.reviewed = exclusionSummary.answered
    exclusionSummary.aggregated = targets.filter((target) => target.excludedAs === "AGGREGATED").length
    const analystConditionTurns = new Set(conditions.flatMap((condition) => condition.evidence.map((quote) => quote.turn)))
    for (const target of targets) {
      const verdict = review.exclusions?.get(target.id) ?? null
      if (!verdict || verdict.verdict !== "CHALLENGED") continue
      exclusionSummary.challenged += 1
      const conditionQuotes = verifyQuotes(verdict.conditionEvidence, interactions, projection)
      const evidenceQuotes = verifyQuotes(verdict.evidence, interactions, projection)
      evidenceRejected += conditionQuotes.rejected.length + evidenceQuotes.rejected.length
      const opportunity = verdict.opportunityTurn ? canonicalHandle(verdict.opportunityTurn) : null
      const opportunityIndex = turnNumberOf(opportunity)
      const omissionValid = transcriptStatus === "COMPLETE" && Boolean(opportunity && projection.turns.some((turn) => turn.handle === opportunity)) && projection.turns.some((turn) => turnNumberOf(turn.handle) >= opportunityIndex && OPERATOR_SPEAKERS.has(speakerOf(turn.speaker)))
      const decision = decideExclusionChallenge({ target, verdict, verifiedConditionEvidence: conditionQuotes.verified, verifiedEvidence: evidenceQuotes.verified, analystConditionTurns, omissionValid })
      if (decision.outcome === "UPHELD" || decision.outcome === "IGNORED") {
        if (decision.outcome === "IGNORED") exclusionSummary.ignored += 1
        continue
      }
      if (decision.outcome === "REOPENED") exclusionSummary.reopened += 1
      else if (decision.outcome === "REVERSED_CONFIRMED") exclusionSummary.reversedConfirmed += 1
      else exclusionSummary.reversedUnconfirmed += 1
      const line = lineOfRef(target.id)
      if (!line) continue
      const operatorEvidence = evidenceQuotes.verified.some(isOperator)
      const status = decision.status ?? "NOT_OBSERVABLE"
      // Execução fora da conversa (leitura da revisora, ou da análise sem natureza da revisora): a fala do operador é DECLARAÇÃO
      // (ou intenção), nunca conduta observada; sem fala dele, nada foi dito sobre a execução.
      const outside = decision.observability === "OUTSIDE_CONVERSATION"
      const executionClaim: ExecutionClaim | null = outside ? (verdict.issues.includes("INTENT_ONLY") ? "INTENDED" : verdict.issues.includes("DECLARED_NOT_OBSERVED") || (operatorEvidence && (verdict.proposedStatus === "MET" || verdict.proposedStatus === "PARTIAL")) ? "DECLARED" : "NONE") : null
      const reviewRecord = { verdict: "REFUTED" as const, issues: verdict.issues, listReading: verdict.listReading, conditionEvidence: conditionQuotes.verified, counterEvidence: [], note: verdict.note, focus: [] }
      const updated: AssessedCriterion = {
        ...baseOf(line),
        origin: "REVIEW_CHALLENGE",
        declaredStatus: target.excludedAs === "AGGREGATED" ? (target.aggregateStatus as AssessedCriterion["declaredStatus"]) : target.excludedAs,
        proposedStatus: verdict.proposedStatus ?? "NOT_OBSERVABLE",
        status,
        confirmation: decision.confirmation,
        confirmationReasons: decision.reasons,
        review: reviewRecord,
        evidenceKind: outside ? (executionClaim === "DECLARED" || executionClaim === "INTENDED" ? "DECLARED_ACTION" : "NONE") : status === "NOT_MET" && !operatorEvidence ? "OMISSION" : operatorEvidence ? "CONDUCT_OBSERVED" : "NONE",
        declaredActionTense: executionClaim === "INTENDED" ? "INTENDED" : executionClaim === "DECLARED" ? "COMPLETED" : null,
        evidence: [...evidenceQuotes.verified, ...conditionQuotes.verified.filter((quote) => !evidenceQuotes.verified.some((other) => other.turn === quote.turn && other.quote === quote.quote))],
        rejectedEvidence: [...conditionQuotes.rejected, ...evidenceQuotes.rejected],
        opportunityTurn: !outside && status === "NOT_MET" && !operatorEvidence ? opportunity : null,
        rationale: verdict.note,
        materiality: verdict.scenarioRole === "CENTRAL" ? "HIGH" : "MEDIUM",
        guidance: null,
        whyItMatters: null,
        ruleConflict: false,
        downgrades: decision.outcome === "REVERSED_CONFIRMED" ? [] : [`EXCLUSION_${decision.outcome}:${decision.reasons.join("+")}`],
        itemNature: verdict.itemNature,
        scenarioRole: verdict.scenarioRole ?? assessed.get(target.id)?.scenarioRole ?? null,
        obligation: assessed.get(target.id)?.obligation ?? null,
        requiredAction: assessed.get(target.id)?.requiredAction ?? null,
        applicability: decision.outcome === "REVERSED_CONFIRMED" ? "APPLIES" : assessed.get(target.id)?.applicability ?? "UNCERTAIN",
        condition: assessed.get(target.id)?.condition ?? null,
        applicabilityEvidence: conditionQuotes.verified,
        // Onde o cumprimento acontece, depois da revisão (`reviewedObservabilityOf`): a revisora pode corrigir a leitura semântica,
        // nunca manter "ação interna" e tratá-la como comprovada pela transcrição.
        observability: decision.observability,
        evidenceNeeded: assessed.get(target.id)?.evidenceNeeded ?? null,
        executionClaim,
      }
      const existing = assessed.get(target.id)
      if (existing) Object.assign(existing, updated)
      else {
        assessed.set(target.id, updated)
        criteriaList.push(updated)
        const index = notRequirements.indexOf(target.id)
        if (index >= 0) notRequirements.splice(index, 1)
      }
      if (decision.outcome === "REVERSED_CONFIRMED") confirmedCount += 1
    }
  }

  // V3: lista dada como CUMPRIDA pela abertura, com um item dela confirmado como não cumprido/parcial — a conclusão agregada cai.
  for (const criterion of criteriaList) {
    const items = openings.get(criterion.lineKey)
    if (!items || criterion.status !== "MET" || criterion.confirmation !== "CONFIRMED") continue
    const keys = new Set(items.map((item) => item.lineKey))
    if (!criteriaList.some((other) => keys.has(other.lineKey) && other.confirmation === "CONFIRMED" && (other.status === "NOT_MET" || other.status === "PARTIAL"))) continue
    criterion.confirmation = "UNCONFIRMED"
    criterion.confirmationReasons = ["AGGREGATE_CONTRADICTED_BY_ITEM"]
    criterion.status = "NOT_OBSERVABLE"
    criterion.downgrades = [...criterion.downgrades, "UNCONFIRMED:AGGREGATE_CONTRADICTED_BY_ITEM"]
    confirmedCount -= 1
    unconfirmedCount += 1
  }
  // POLÍTICA DE EVIDÊNCIA ÚNICA (V8, `EVIDENCE_POLICY_UNIFIED_V1`): vale para TODA conclusão, venha da análise, da revisão de uma
  // proposta, da contestação de um descarte, da avaliação de linha pela revisão ou do ajuste de lista. Execução fora da conversa
  // (registros operacionais não integrados) nunca fica cumprida, descumprida nem parcial — nem confirmada; declaração e intenção
  // continuam registradas como tal (`executionClaim`). Defesa final: o caminho que chegou aqui com um status determinado é corrigido.
  for (const criterion of criteriaList) {
    if (criterion.observability !== "OUTSIDE_CONVERSATION") continue
    const wasDeterminate = isDeterminate(criterion.status)
    if (!wasDeterminate && criterion.confirmation !== "CONFIRMED") continue
    if (criterion.confirmation === "CONFIRMED") {
      confirmedCount -= 1
      unconfirmedCount += 1
    }
    const operatorSpoke = criterion.evidence.some(isOperator)
    // Fala do operador oferecida como prova de uma execução fora da conversa = declaração (ou intenção), qualquer que seja o rótulo.
    const claim: ExecutionClaim = criterion.executionClaim && criterion.executionClaim !== "NONE" ? criterion.executionClaim : criterion.declaredActionTense === "INTENDED" && operatorSpoke ? "INTENDED" : operatorSpoke && (criterion.evidenceKind === "DECLARED_ACTION" || criterion.proposedStatus === "MET" || criterion.proposedStatus === "PARTIAL") ? "DECLARED" : criterion.executionClaim ?? "NONE"
    Object.assign(criterion, {
      status: "NOT_OBSERVABLE" as CriterionStatus,
      confirmation: criterion.confirmation === "CONFIRMED" || wasDeterminate ? ("UNCONFIRMED" as Confirmation) : criterion.confirmation,
      confirmationReasons: [...criterion.confirmationReasons.filter((reason) => reason !== "EXCLUSION_REVERSED"), "EXECUTION_OUTSIDE_CONVERSATION" as ConfirmationReason],
      executionClaim: claim,
      evidenceKind: claim === "NONE" ? (criterion.evidenceKind === "CUSTOMER_CONTEXT" ? "CUSTOMER_CONTEXT" : "NONE") : "DECLARED_ACTION",
      opportunityTurn: null,
      guidance: null,
      whyItMatters: null,
      downgrades: criterion.downgrades.includes("EXECUTION_NOT_VERIFIABLE_BY_TRANSCRIPT") ? criterion.downgrades : [...criterion.downgrades, "EXECUTION_NOT_VERIFIABLE_BY_TRANSCRIPT"],
    })
  }
  // Cobertura pedida × respondida (V3): linha pedida e não respondida continua sem avaliação — registrado, nunca "avaliada".
  const requestedLines = reviewInput?.requested?.linesToAssess ?? []
  const answeredLines = review ? requestedLines.filter((handle) => review.lines.some((line) => canonicalHandle(line.id) === canonicalHandle(handle))).length : 0
  const coverageSummary = { requested: requestedLines.length, answered: answeredLines, unanswered: requestedLines.length - answeredLines, withheld: reviewInput?.requested?.linesWithheld ?? 0 }
  if (review && coverageSummary.unanswered > 0) auditNotes.push(`${coverageSummary.unanswered} de ${coverageSummary.requested} linha(s) pedidas à revisão ficaram sem resposta — continuam sem avaliação.`)
  if (coverageSummary.withheld > 0) auditNotes.push(`${coverageSummary.withheld} linha(s) do caminho não foram pedidas à revisão (teto por chamada) — continuam sem avaliação.`)
  if (review && exclusionSummary.aggregated > 0) auditNotes.push(`${exclusionSummary.aggregated} item(ns) foram avaliados pela análise só através da frase que abre a lista; a revisão os conferiu como alvos próprios.`)

  // Caminho FINAL: só com confirmação da revisão (caminho inadequado é a acusação mais ampla da mensagem).
  const pathConfirmation: Confirmation = proposedPath === "UNDETERMINED" || proposedPath === "NO_PROCEDURE" ? "NOT_A_CLAIM" : decidePathConfirmation(review?.path ?? null, Boolean(reviewInput && review)).confirmation
  let pathAssessment: PathAssessment = pathConfirmation === "CONFIRMED" || pathConfirmation === "NOT_A_CLAIM" ? proposedPath : "UNDETERMINED"
  const finalOnPath = (statuses: CriterionStatus[]) => criteriaList.some((criterion) => criterion.onPath && !criterion.ruleConflict && statuses.includes(criterion.status))
  if ((pathAssessment === "INCORRECT" || pathAssessment === "PARTIALLY_CORRECT") && !(pathVerified.verified.some(isOperator) || finalOnPath(["NOT_MET", "PARTIAL"]))) pathAssessment = "UNDETERMINED"
  else if (pathAssessment === "CORRECT" && !finalOnPath(["MET"])) pathAssessment = "UNDETERMINED"
  // COMPLETUDE DO CAMINHO (`PATH_COMPLETENESS_V1`): "caminho correto" afirma que TODAS as etapas que se aplicam foram seguidas. Com
  // etapa do caminho fora da conversa, não avaliada, não confirmada ou de aplicabilidade incerta, a conversa só mostra a parte
  // observável — o caminho fica não determinado (a conduta observável continua reconhecível etapa por etapa).
  const pathCompleteness = pathCompletenessOf(criteriaList)
  if (pathAssessment === "CORRECT" && pathCompleteness.status === "LIMITED") {
    pathAssessment = "UNDETERMINED"
    auditNotes.push(`O caminho observável na conversa é compatível com o indicado, mas ${pathCompleteness.outsideConversation + pathCompleteness.notAssessed + pathCompleteness.unconfirmed + pathCompleteness.applicabilityUncertain + pathCompleteness.otherNotObservable} etapa(s) do caminho não puderam ser verificadas — não se afirma que todas foram seguidas.`)
  }
  if (reviewInput && pathConfirmation !== "CONFIRMED" && pathConfirmation !== "NOT_A_CLAIM") auditNotes.push("A avaliação do caminho seguido não foi confirmada pela revisão — fica como não determinada.")

  // Procedimento escolhido × assunto registrado (checagem de correção diagnóstica, não bloqueio).
  const anchored = new Set(input.subjectAnchoredDocumentIds)
  const procedureSelection: VerifiedCallAnalysis["checks"]["procedureSelection"] = !procedureDocument
    ? "NO_PROCEDURE"
    : anchored.size === 0
      ? "NO_SUBJECT_ANCHOR"
      : anchored.has(procedureDocument.documentId)
        ? "CONSISTENT_WITH_SUBJECT"
        : model.scenario.procedureRationale
          ? "DIFFERENT_FROM_SUBJECT_EXPLAINED"
          : "DIFFERENT_FROM_SUBJECT_UNEXPLAINED"
  if (procedureSelection === "DIFFERENT_FROM_SUBJECT_UNEXPLAINED") auditNotes.push("O procedimento escolhido difere do indicado pelo assunto registrado da chamada, sem justificativa da análise.")
  if (!procedureDocument && anchored.size > 0) auditNotes.push("O assunto registrado aponta um procedimento da base, mas a análise não o considerou aplicável.")
  if (reviewInput && !review) auditNotes.push("As conclusões da análise não puderam ser revisadas nesta execução: ficam registradas como hipóteses não confirmadas.")
  if (unconfirmedCount + refutedCount > 0 && review) auditNotes.push(`${unconfirmedCount + refutedCount} conclusão(ões) da análise não foram confirmadas pela revisão e ficam fora do diagnóstico.`)
  if (discoverySummary.found > 0) auditNotes.push(`${discoverySummary.found} desvio(s) encontrado(s) só pela revisão: ${discoverySummary.confirmed} confirmado(s) na confirmação focal, ${discoverySummary.refuted} refutado(s), ${discoverySummary.unconfirmed} incerto(s), ${discoverySummary.notRun + discoverySummary.pending} sem confirmação (inconclusivo).`)

  const findings = criteriaList.filter((criterion) => isDeterminate(criterion.status) && !criterion.ruleConflict)
  const proposedFindings = criteriaList.filter((criterion) => isDeterminate(criterion.proposedStatus) && !criterion.ruleConflict)
  const outcomeReasons: string[] = []
  let outcome: AnalysisOutcome
  if (transcriptStatus === "UNAVAILABLE") {
    outcome = "INSUFFICIENT_EVIDENCE"
    outcomeReasons.push("TRANSCRIPT_UNAVAILABLE")
  } else if (!procedureDocument && !scripts.some((script) => script.applicability === "APPLIES")) {
    outcome = "INSUFFICIENT_EVIDENCE"
    outcomeReasons.push("NO_APPLICABLE_PROCEDURE")
  } else if (findings.length === 0) {
    outcome = "INSUFFICIENT_EVIDENCE"
    outcomeReasons.push(proposedFindings.length === 0 ? "NO_VERIFIED_FINDING" : reviewInput && !review ? "REVIEW_UNAVAILABLE" : "NO_CONFIRMED_FINDING")
  } else {
    if (missing.length > 0) outcomeReasons.push("COVERAGE_PARTIAL")
    if (procedureSelection === "DIFFERENT_FROM_SUBJECT_UNEXPLAINED") outcomeReasons.push("PROCEDURE_SELECTION_UNEXPLAINED")
    if (transcriptStatus === "INCOMPLETE") outcomeReasons.push("TRANSCRIPT_INCOMPLETE")
    if (unconfirmedCount + refutedCount > 0) outcomeReasons.push("SOME_CONCLUSIONS_UNCONFIRMED")
    outcome = outcomeReasons.length > 0 ? "PARTIAL" : "USABLE"
  }

  return {
    logicVersion: CALL_ANALYSIS_LOGIC_VERSION,
    transcriptStatus,
    scenario: {
      customerNeed: model.scenario.customerNeed,
      conditions,
      procedureHandle: procedureDocument?.handle ?? null,
      procedureDocumentId: procedureDocument?.documentId ?? null,
      procedureTitle: procedureDocument?.title ?? null,
      procedureVersion: procedureDocument?.version ?? null,
      rulePerspective: procedureDocument?.perspective ?? null,
      procedureRationale: model.scenario.procedureRationale,
      pathSections: pathSections.map((section) => ({ handle: section.handle, heading: section.heading })),
      correctPath: model.scenario.correctPath,
      pathTaken: model.scenario.pathTaken,
      declaredPathAssessment: model.scenario.pathAssessment,
      proposedPathAssessment: proposedPath,
      pathAssessment,
      pathConfirmation,
      pathCompleteness,
      pathRationale: model.scenario.pathRationale,
      pathEvidence: pathVerified.verified,
    },
    criteria: criteriaList,
    notRequirements,
    sectionDispositions,
    coverage: { requiredLines: requiredLines.map((line) => line.handle), closingSections: closing.map((section) => section.handle), missing, repairAttempted: input.repairAttempted, status: missing.length === 0 ? "COMPLETE" : "PARTIAL" },
    sourceConflicts: model.sourceConflicts,
    limitations: [...new Set(limitations)],
    argumentScripts: scripts,
    duplicates,
    composites,
    evidenceAvailability: { transcript: transcriptStatus, ...EVIDENCE_AVAILABILITY_NOW },
    coverageLimits: {
      outsideConversation: criteriaList.filter((criterion) => criterion.observability === "OUTSIDE_CONVERSATION" && criterion.status === "NOT_OBSERVABLE").length,
      applicabilityUncertain: criteriaList.filter((criterion) => criterion.applicability === "UNCERTAIN" && criterion.status === "NOT_OBSERVABLE").length,
      declaredExecutions: criteriaList.filter((criterion) => criterion.executionClaim === "DECLARED").length,
      intendedExecutions: criteriaList.filter((criterion) => criterion.executionClaim === "INTENDED").length,
    },
    auditNotes: [...new Set(auditNotes)],
    checks: {
      procedureSelection,
      evidenceRejected,
      downgraded,
      contractViolations: [...model.contractViolations],
      review: { version: CALL_REVIEW_VERSION, attempted: Boolean(reviewInput?.attempted), available: Boolean(review), error: reviewInput?.error ?? null, claims: confirmedCount + unconfirmedCount + refutedCount, confirmed: confirmedCount, unconfirmed: unconfirmedCount, refuted: refutedCount, linesAssessed: criteriaList.filter((criterion) => criterion.origin === "REVIEW_REPAIR").length, path: pathConfirmation, violations: review?.violations ?? [], exclusions: exclusionSummary, coverage: coverageSummary, discoveries: { ...discoverySummary, confirmation: confirmationInput ? { attempted: confirmationInput.attempted, available: Boolean(confirmationInput.review), reason: confirmationInput.reason, error: confirmationInput.error } : null } },
    },
    outcome,
    outcomeReasons,
  }
}

/**
 * Linhas obrigatórias sem disposição na resposta do modelo (a revisão dá disposição a elas): itens de lista das seções do caminho
 * (escolha da análise, qualquer título) e do encerramento, e os itens avaliáveis dos argumentários que se aplicam (situação
 * sustentada por fala verificada — mesma regra da verificação).
 */
/** Linhas que receberam disposição da análise (critério, grupo ou seção inteira). */
function dispositionedLinesOf(model: ModelCallAnalysis, context: Pick<ProcedureContext, "sections">): Set<string> {
  return new Set([
    ...model.criteria.map((criterion) => canonicalHandle(criterion.line)),
    ...model.groupDispositions.flatMap((group) => group.lines.map((reference) => canonicalHandle(reference))),
    ...model.sectionDispositions.flatMap((entry) => context.sections.get(canonicalHandle(entry.section))?.lines.map((line) => line.handle) ?? []),
  ])
}
/**
 * Checagem de uma duplicidade DECLARADA (`DUPLICATE_BY_MEANING_V1`): a leitura precisa afirmar a mesma obrigação em todas as
 * dimensões e dizer por quê; a linha da base precisa ter sido avaliada. Só integridade — o sentido é da leitura.
 */
function duplicateCheckOf(entry: NonNullable<ModelCallAnalysis["duplicates"]>[number], sameAsHandle: string, dispositioned: ReadonlySet<string>) {
  const equivalence = { condition: entry.sameCondition ?? null, purpose: entry.samePurpose ?? null, scope: entry.sameScope ?? null, modality: entry.sameModality ?? null }
  const rejectedBecause = [
    ...Object.entries(equivalence).filter(([, value]) => value !== true).map(([dimension]) => `NOT_DECLARED_SAME_${dimension.toUpperCase()}`),
    ...(entry.rationale ? [] : ["NO_RATIONALE"]),
    ...(dispositioned.has(sameAsHandle) ? [] : ["KNOWLEDGE_LINE_NOT_ASSESSED"]),
  ]
  return { equivalence, rejectedBecause }
}

export function missingCoverageOf(model: ModelCallAnalysis, context: ProcedureContext, transcriptStatus: TranscriptStatus, projection?: TranscriptProjection, interactionId = "I1"): ProcedureLine[] {
  const procedure = model.scenario.procedure ? context.documents.find((document) => document.handle === canonicalHandle(model.scenario.procedure!)) ?? null : null
  const sections = procedure
    ? [...new Set(model.scenario.pathSections.map((handle) => canonicalHandle(handle)))].flatMap((handle) => {
        const section = context.sections.get(handle)
        return section ? [section] : []
      })
    : []
  const closing = procedure && transcriptStatus === "COMPLETE" ? closingSectionsOf(context, procedure.handle) : []
  const covered = new Set(model.sectionDispositions.map((entry) => canonicalHandle(entry.section)))
  const assessedLines = dispositionedLinesOf(model, context)
  // Só a duplicidade que passaria na verificação tira a linha do argumentário da cobertura (a recusada continua devendo disposição).
  const acceptedDuplicates = (model.duplicates ?? []).filter((entry) => {
    const line = context.lines.get(canonicalHandle(entry.line))
    const same = context.lines.get(canonicalHandle(entry.sameAs))
    return Boolean(line?.argument && same && !same.argument && duplicateCheckOf(entry, same.handle, assessedLines).rejectedBecause.length === 0)
  }).map((entry) => canonicalHandle(entry.line))
  const dispositioned = new Set([...assessedLines, ...acceptedDuplicates])
  const seen = new Set<string>()
  const fromPath = [...sections, ...closing].filter((section) => !covered.has(section.handle)).flatMap((section) => section.lines.filter((line) => line.kind === "LIST_ITEM" && !dispositioned.has(line.handle) && !seen.has(line.handle) && seen.add(line.handle)))
  if (!projection) return fromPath
  const interactions = new Map<string, ProjectedInteraction>([["I1", { interactionRef: "I1", interactionId, projection }]])
  const applicability = new Map(verifyScriptAssessments(model, context, interactions, projection).map((script) => [script.scriptId, script.applicability]))
  const fromScripts = requiredScriptLinesOf(context, applicability).filter((line) => !covered.has(line.sectionHandle) && !dispositioned.has(line.handle) && !seen.has(line.handle) && seen.add(line.handle))
  return [...fromPath, ...fromScripts]
}

/** Itens avaliáveis dos argumentários que SE APLICAM: orientação "deve", pontos obrigatórios e condutas a evitar ("pode" nunca é cobrado). */
export function requiredScriptLinesOf(context: Pick<ProcedureContext, "lines">, applicability: ReadonlyMap<string, Applicability>): ProcedureLine[] {
  return [...context.lines.values()].filter((line) => line.argument && applicability.get(line.argument.scriptId) === "APPLIES" && !(line.argument.field === "GUIDANCE" && line.argument.modality === "MAY"))
}

/**
 * APLICABILIDADE DE CADA ARGUMENTÁRIO (leitura do modelo + integridade): "se aplica" precisa de fala VERIFICADA mostrando a situação
 * (sem ela = incerto — a afirmação não se sustenta); "não se aplica" precisa do motivo; sem leitura = incerto. O código nunca decide
 * se a situação aconteceu (isso é semântico): só exige que a afirmação venha com a prova que ela mesma diz ter.
 */
export function verifyScriptAssessments(model: Pick<ModelCallAnalysis, "argumentScripts">, context: Pick<ProcedureContext, "documents">, interactions: ReadonlyMap<string, ProjectedInteraction>, projection: TranscriptProjection): VerifiedScriptAssessment[] {
  return context.documents.filter((document) => document.kind === "ARGUMENT_SCRIPT").map((document) => {
    const entry = (model.argumentScripts ?? []).find((candidate) => canonicalHandle(candidate.script) === document.handle) ?? null
    const quotes = entry ? verifyQuotes(entry.evidence, interactions, projection).verified : []
    let applicability: Applicability = entry?.applicability ?? "UNCERTAIN"
    let downgrade: string | null = entry ? null : "SCRIPT_NOT_ASSESSED"
    if (applicability === "APPLIES" && quotes.length === 0) {
      applicability = "UNCERTAIN"
      downgrade = "SCRIPT_APPLIES_WITHOUT_VERIFIED_EVIDENCE"
    }
    return { handle: document.handle, scriptId: document.documentId, name: document.title, version: document.version, declaredApplicability: entry?.applicability ?? null, applicability, situation: entry?.situation ?? null, evidence: quotes, rationale: entry?.rationale ?? null, downgrade }
  })
}

type UnitInput = {
  status: ModelCriterion["status"] | ModelObligation["status"]
  evidenceKind?: EvidenceKind | null | undefined
  declaredActionTense?: "COMPLETED" | "INTENDED" | null | undefined
  evidence: ModelEvidenceUnit[]
  opportunityTurn: string | null
  rationale: string | null
  itemNature?: ItemNature | null | undefined
  applicability?: Applicability | null | undefined
  applicabilityEvidence?: ModelEvidenceUnit[] | undefined
  observability?: Observability | null | undefined
  lineRole?: LineRole | null | undefined
}

/**
 * O que a EVIDÊNCIA DISPONÍVEL sustenta sobre UMA exigência (linha ou parte de regra composta) — `SEMANTIC_AUDITABILITY_V1`.
 * A leitura do que a regra exige, se ela vale e onde o cumprimento acontece é SEMÂNTICA (modelo); o código só aplica a consequência
 * lógica dessas leituras e as checagens objetivas de integridade (citação existe, turno/falante, oportunidade, transcrição completa):
 *   - aplicabilidade incerta nunca vira "não cumpriu" nem "não se aplica" (= não observável);
 *   - "não se aplica" exige a leitura de inaplicabilidade e o motivo; regra que não se aplica não gera acerto nem desvio;
 *   - cumprimento FORA da conversa (execução em sistema/registro) não é verificável pela transcrição — registros operacionais não
 *     estão integrados —: nunca vira cumprido nem descumprido; a fala só registra a DECLARAÇÃO ou a INTENÇÃO;
 *   - na conversa: intenção não é execução; conduta precisa de fala verificada do operador; omissão exige transcrição completa,
 *     oportunidade real e o operador falando depois dela.
 * Nenhuma regra aqui olha o verbo, uma palavra-chave ou o nome de um sistema.
 */
export function assessUnit(input: { line: ProcedureLine; unit: UnitInput; scriptApplicability: ReadonlyMap<string, Applicability>; interactions: ReadonlyMap<string, ProjectedInteraction>; projection: TranscriptProjection; transcriptStatus: TranscriptStatus; /** Turnos que a análise citou como CONDIÇÕES do cenário. */ conditionTurns?: ReadonlySet<string> }) {
  const { unit, projection, transcriptStatus } = input
  const quotes = verifyQuotes(unit.evidence, input.interactions, projection)
  const applicabilityQuotes = verifyQuotes(unit.applicabilityEvidence ?? [], input.interactions, projection)
  const operatorQuotes = quotes.verified.filter(isOperator)
  const evidenceKind: EvidenceKind = unit.evidenceKind ?? (unit.opportunityTurn && operatorQuotes.length === 0 ? "OMISSION" : operatorQuotes.length > 0 ? "CONDUCT_OBSERVED" : "NONE")
  const tense = unit.declaredActionTense ?? null
  // Leituras ausentes (respostas anteriores ao contrato V5) derivam do que o próprio modelo disse — nunca do texto da regra.
  let applicability: Applicability = unit.applicability ?? (unit.status === "NOT_APPLICABLE" ? "DOES_NOT_APPLY" : "APPLIES")
  // V10 (`OBLIGATION_READING_V1`): leituras do PRÓPRIO modelo que se contradizem ficam com a mais restrita. Uma ação INTERNA acontece
  // fora da conversa por definição — se a análise também disse "na conversa", a conclusão não pode se apoiar na transcrição (rodada
  // real V8: "Abrir análise quando: Existir cobrança após cancelamento não concluído" lido como INTERNAL_ACTION e, ao mesmo tempo,
  // IN_CONVERSATION, com "Registrei a contestação…" como conduta observada). Nada aqui olha verbo ou palavra: só as leituras.
  const readingConflict = unit.itemNature === "INTERNAL_ACTION" && unit.observability === "IN_CONVERSATION"
  const observability: Observability = readingConflict ? "OUTSIDE_CONVERSATION" : unit.observability ?? (unit.itemNature === "INTERNAL_ACTION" ? "OUTSIDE_CONVERSATION" : "IN_CONVERSATION")
  // Argumentário: a situação dele precisa estar estabelecida nesta conversa (leitura do modelo, conferida por fala verificada).
  const scriptState = input.line.argument ? input.scriptApplicability.get(input.line.argument.scriptId) ?? "UNCERTAIN" : null
  if (scriptState === "DOES_NOT_APPLY") applicability = "DOES_NOT_APPLY"
  else if (scriptState === "UNCERTAIN" && applicability === "APPLIES") applicability = "UNCERTAIN"
  const downgrades: string[] = []
  let status = unit.status as CriterionStatus
  if (status === "NOT_APPLICABLE") {
    if (applicability !== "DOES_NOT_APPLY") downgrades.push(applicability === "UNCERTAIN" ? "APPLICABILITY_UNCERTAIN" : "NOT_APPLICABLE_CONTRADICTS_APPLICABILITY")
    else if (!unit.rationale && scriptState !== "DOES_NOT_APPLY") downgrades.push("NOT_APPLICABLE_WITHOUT_CONDITION")
  } else if (applicability === "DOES_NOT_APPLY") {
    // A regra não vale aqui: nada a concluir sobre a conduta (nem acerto, nem desvio).
    if (isDeterminate(status)) downgrades.push(scriptState === "DOES_NOT_APPLY" ? "SCRIPT_DOES_NOT_APPLY" : "APPLICABILITY_CONTRADICTS_STATUS")
  } else if (applicability === "UNCERTAIN" && (status === "NOT_MET" || status === "PARTIAL")) {
    downgrades.push(scriptState === "UNCERTAIN" ? "SCRIPT_SITUATION_NOT_ESTABLISHED" : "APPLICABILITY_UNCERTAIN")
  }
  let executionClaim: ExecutionClaim | null = null
  if (observability === "OUTSIDE_CONVERSATION") {
    // A fala oferecida como PROVA de uma execução fora da conversa só pode ser uma declaração (ou uma intenção) sobre ela — nunca a
    // própria execução —, qualquer que seja o rótulo que a leitura deu à evidência.
    executionClaim = tense === "INTENDED" && (evidenceKind === "DECLARED_ACTION" || operatorQuotes.length > 0) ? "INTENDED" : operatorQuotes.length > 0 && (evidenceKind === "DECLARED_ACTION" || status === "MET" || status === "PARTIAL") ? "DECLARED" : "NONE"
    if (isDeterminate(status) && downgrades.length === 0) downgrades.push(...(readingConflict ? ["READINGS_CONFLICT_INTERNAL_ACTION_IN_CONVERSATION"] : []), "EXECUTION_NOT_VERIFIABLE_BY_TRANSCRIPT")
  } else if (downgrades.length === 0) {
    const applicabilityTurns = new Set(applicabilityQuotes.verified.map((quote) => quote.turn))
    if (status === "MET") {
      if (evidenceKind === "DECLARED_ACTION" && tense === "INTENDED") downgrades.push("INTENT_IS_NOT_EXECUTION")
      // Dizer que fez não é fazer: na conversa, o acerto é a própria fala da conduta (a declaração só prova o que foi dito).
      else if (evidenceKind === "DECLARED_ACTION") downgrades.push("DECLARATION_IS_NOT_CONDUCT")
      // A linha é a SITUAÇÃO que exige a ação da abertura e a fala citada é a mesma que mostra essa situação (na aplicabilidade do
      // item ou nas condições do cenário que a própria análise registrou): condição ≠ conduta.
      else if (unit.lineRole === "CONDITION_OF_ACTION" && quotes.verified.length > 0 && quotes.verified.every((quote) => applicabilityTurns.has(quote.turn) || (input.conditionTurns?.has(quote.turn) ?? false))) downgrades.push("CONDITION_IS_NOT_CONDUCT")
      else if (evidenceKind === "COMPLIANCE_BY_ABSENCE") { if (transcriptStatus !== "COMPLETE") downgrades.push("ABSENCE_ON_INCOMPLETE_TRANSCRIPT") }
      else if (operatorQuotes.length === 0) downgrades.push(quotes.verified.some(isCustomer) ? "CUSTOMER_SPEECH_DOES_NOT_PROVE_CONDUCT" : "NO_VERIFIED_OPERATOR_EVIDENCE")
    } else if (status === "NOT_MET") {
      if (evidenceKind === "OMISSION" || operatorQuotes.length === 0) {
        const opportunity = unit.opportunityTurn ? canonicalHandle(unit.opportunityTurn) : null
        const opportunityIndex = turnNumberOf(opportunity)
        const opportunityTurn = opportunity ? projection.turns.find((turn) => turn.handle === opportunity) : undefined
        const operatorSpokeAfter = Number.isFinite(opportunityIndex) && projection.turns.some((turn) => turnNumberOf(turn.handle) >= opportunityIndex && OPERATOR_SPEAKERS.has(speakerOf(turn.speaker)))
        if (transcriptStatus !== "COMPLETE") downgrades.push("OMISSION_ON_INCOMPLETE_TRANSCRIPT")
        else if (!opportunityTurn) downgrades.push("OMISSION_WITHOUT_OPPORTUNITY")
        else if (!operatorSpokeAfter) downgrades.push("OMISSION_WITHOUT_OPERATOR_TURN_AFTER_OPPORTUNITY")
      }
    } else if (status === "PARTIAL") {
      if (operatorQuotes.length === 0) downgrades.push("NO_VERIFIED_OPERATOR_EVIDENCE")
    }
  }
  if (downgrades.length > 0) status = applicability === "DOES_NOT_APPLY" && (unit.rationale || scriptState === "DOES_NOT_APPLY") ? "NOT_APPLICABLE" : "NOT_OBSERVABLE"
  return {
    status,
    applicability,
    observability,
    executionClaim,
    evidenceKind,
    evidence: quotes.verified,
    rejectedEvidence: quotes.rejected,
    applicabilityEvidence: applicabilityQuotes.verified,
    rejected: quotes.rejected.length + applicabilityQuotes.rejected.length,
    opportunityTurn: unit.opportunityTurn ? canonicalHandle(unit.opportunityTurn) : null,
    downgrades,
  }
}

function guidanceOf(criterion: ModelCriterion, line: ProcedureLine, context: ProcedureContext): VerifiedGuidance | null {
  if (!criterion.guidance) return null
  const lines = [...new Set(criterion.guidance.ruleLines.map((ref) => canonicalHandle(ref)))].flatMap((ref) => {
    const ruleLine = context.lines.get(ref)
    return ruleLine ? [{ handle: ruleLine.handle, text: ruleLine.text, heading: ruleLine.heading }] : []
  })
  return { moment: criterion.guidance.moment, condition: criterion.guidance.condition, action: criterion.guidance.action, ruleLines: lines.length > 0 ? lines : [{ handle: line.handle, text: line.text, heading: line.heading }] }
}

/** Junta a resposta do reparo: só as linhas pedidas, sem sobrescrever o que a primeira resposta já disse. */
export function mergeCoverageRepair(model: ModelCallAnalysis, repair: ModelCallAnalysis, requested: readonly string[]): ModelCallAnalysis {
  const wanted = new Set(requested.map((handle) => handle.toUpperCase()))
  const existing = new Set(model.criteria.map((criterion) => canonicalHandle(criterion.line)))
  const added = repair.criteria.filter((criterion) => wanted.has(canonicalHandle(criterion.line)) && !existing.has(canonicalHandle(criterion.line)))
  const groups = repair.groupDispositions.map((group) => ({ ...group, lines: group.lines.filter((line) => wanted.has(canonicalHandle(line)) && !existing.has(canonicalHandle(line))) })).filter((group) => group.lines.length > 0)
  return { ...model, criteria: [...model.criteria, ...added], groupDispositions: [...model.groupDispositions, ...groups], contractViolations: [...model.contractViolations, ...repair.contractViolations.map((violation) => `repair:${violation}`)] }
}

/**
 * Linhas que a análise deixou sem resposta, avaliadas pela REVISÃO (mesma chamada): entram com origem REVIEW_REPAIR — passam pelas
 * mesmas checagens de integridade, mas uma disposição determinada nunca é confirmada (ninguém a revisou).
 */
export function mergeReviewedLines(model: ModelCallAnalysis, lines: readonly AssessedLine[], requested: readonly string[]): ModelCallAnalysis {
  const wanted = new Set(requested.map((handle) => canonicalHandle(handle)))
  const existing = new Set(model.criteria.map((criterion) => canonicalHandle(criterion.line)))
  const added: ModelCriterion[] = lines
    .filter((line) => wanted.has(line.id) && !existing.has(line.id))
    .map((line) => ({ line: line.id, status: line.status, evidenceKind: line.evidenceKind, declaredActionTense: null, evidence: line.evidence.map((quote) => ({ turn: quote.turn, speaker: quote.speaker, quote: quote.quote })), opportunityTurn: line.opportunityTurn, rationale: line.rationale, materiality: line.materiality ?? "LOW", guidance: null, whyItMatters: null, origin: "REVIEW_REPAIR", applicability: line.applicability ?? null, observability: line.observability ?? null }))
  return { ...model, criteria: [...model.criteria, ...added] }
}
