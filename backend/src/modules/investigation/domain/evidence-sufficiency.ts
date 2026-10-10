import { extractMarkerPayload, type MarkerParseStatus } from "../../../shared/application/prompting/structured-markers.js"
import { z } from "zod"
import { isBehavioralEvidence, type LedgerEntry } from "./evidence-ledger.js"
import { bestRepresentativeness, REPRESENTATIVE_MIN_SAMPLE, type RepresentativenessAssessment } from "./evidence-representativeness.js"
import { scopeAllowedBy } from "./evidence-gating.js"
import type { InvestigationObjective } from "./investigation-objective.js"
import { TOOL_KEYS, type ToolKey } from "./tool-catalog.js"
import type { ClaimScope } from "./tool-trace.js"
import { detectTemporalLanguage, temporalFactsOf, TEMPORAL_RELATIONS } from "./temporal-semantics.js"

/**
 * EVIDENCE SUFFICIENCY CONTROLLER (V1.3.1 — §6–27). Não é mecanismo de economia: é o runtime
 * decidindo, por regras, se a investigação PODE parar. O modelo propõe (STOP/CONTINUE) com uma
 * declaração compacta e validável (nunca chain-of-thought); o backend deriva as NECESSIDADES DE
 * EVIDÊNCIA do objetivo + evidência encontrada e só aceita STOP quando:
 *  1. o objetivo está respondido; 2. o escopo exigido está sustentado; 3. não há pergunta MATERIAL
 *  aberta; 4. nem hipótese material não testada; 5. nem contradição relevante sem contextualização;
 *  6. que alguma Tool disponível pudesse resolver; 7. e as limitações estão registradas.
 * Qualquer falha com caminho válido → STOP REJEITADO (continua). Sem caminho → INSUFFICIENT_DATA
 * (os dados não existem) ou NO_MORE_SUPPORTED_PATHS (nenhuma Tool autorizada resolve).
 * "Usou X Tools → pare" / "já tem texto → pare" NÃO existem aqui.
 */
export const STOP_REASONS = ["ANSWER_SUFFICIENT", "INSUFFICIENT_DATA", "NO_MORE_SUPPORTED_PATHS", "MAX_PLANNING_ROUNDS", "INVESTIGATION_TOOL_BUDGET", "TOKEN_WARNING_STOP", "SAFETY_STOP"] as const
export type StopReason = (typeof STOP_REASONS)[number]

export const STOP_REASON_LABELS: Record<StopReason, string> = {
  ANSWER_SUFFICIENT: "Evidência suficiente para o objetivo",
  INSUFFICIENT_DATA: "Dados insuficientes (o que faltava não existe/não tem cobertura)",
  NO_MORE_SUPPORTED_PATHS: "Sem caminho: nenhuma ferramenta autorizada resolve a lacuna",
  MAX_PLANNING_ROUNDS: "Limite de rodadas de planejamento",
  INVESTIGATION_TOOL_BUDGET: "Orçamento de ferramentas esgotado",
  TOKEN_WARNING_STOP: "Limiar de tokens atingido",
  SAFETY_STOP: "Parada de segurança (tempo limite)",
}

/** Status de suficiência da investigação — o que a síntese e o QA Lab leem. */
export type SufficiencyStatus = "SUFFICIENT" | "INSUFFICIENT_DATA" | "NO_PATH" | "LIMITED"

export type EvidenceNeedStatus = "OPEN" | "SATISFIED" | "BLOCKED" | "NOT_NEEDED"
export type EvidenceNeed = {
  id: string
  question: string
  requiredForClaimScope: ClaimScope | null
  status: EvidenceNeedStatus
  evidenceRefs: string[]
  candidateTools: ToolKey[]
  material: boolean
  /** Por que está BLOCKED (dados não existem × nenhuma Tool autorizada). */
  blockedBy?: "NO_DATA" | "NO_TOOL" | undefined
  /** Origem: derivada pelo runtime do objetivo ou declarada pelo modelo. */
  source: "RUNTIME" | "MODEL"
}

export type HypothesisStatus = "SUPPORTED" | "REFUTED" | "OPEN" | "BLOCKED_BY_DATA"
export type MaterialHypothesis = { hypothesis: string; status: HypothesisStatus; material: boolean; evidenceRefs: string[]; candidateTools: ToolKey[] }

const toolKeySchema = z.string().trim().transform((value) => value.toLowerCase()).pipe(z.enum(TOOL_KEYS))
const refsSchema = z.array(z.string().trim()).default([])
const claimScopeSchema = z.enum(["INTERACTION_SPECIFIC", "PERIOD_PATTERN", "EMPLOYEE_PATTERN", "POPULATION_PATTERN"])
/** V1.3.4: relação temporal DECLARADA (metadata) — uma afirmação de mudança/posição no período precisa dizer que é temporal e em quais blocos se apoia. */
const temporalRelationSchema = z.enum(TEMPORAL_RELATIONS).optional()
const bucketsSchema = z.array(z.string().trim()).optional()

/** BEFORE-STOP DECLARATION (§7): estado investigativo estruturado que o modelo devolve junto das notas — nunca raciocínio. */
export const stopDeclarationSchema = z.object({
  proposedAction: z.enum(["STOP", "CONTINUE"]).default("STOP"),
  supportedClaims: z.array(z.object({ text: z.string().trim().min(1), scope: claimScopeSchema.optional(), evidenceRefs: refsSchema, temporalRelation: temporalRelationSchema, evidenceBuckets: bucketsSchema })).default([]),
  unresolvedQuestions: z.array(z.object({ question: z.string().trim().min(1), material: z.boolean().default(false), candidateTools: z.array(toolKeySchema.catch("synthesize_evidence")).default([]) })).default([]),
  hypotheses: z.array(z.object({ hypothesis: z.string().trim().min(1), status: z.enum(["SUPPORTED", "REFUTED", "OPEN", "BLOCKED_BY_DATA"]).default("OPEN"), material: z.boolean().default(false), evidenceRefs: refsSchema, candidateTools: z.array(toolKeySchema.catch("synthesize_evidence")).default([]), temporalRelation: temporalRelationSchema })).default([]),
  contradictoryEvidence: z.array(z.object({ description: z.string().trim().min(1), refs: refsSchema, status: z.enum(["OPEN", "CONTEXTUALIZED"]).default("OPEN"), candidateTools: z.array(toolKeySchema.catch("synthesize_evidence")).default([]) })).default([]),
  dataLimitations: z.array(z.string().trim().min(1)).default([]),
  additionalEvidenceCouldChangeConclusion: z.boolean().default(false),
  additionalEvidenceCouldIncreaseRequiredScope: z.boolean().default(false),
  proposedStopReason: z.enum(["ANSWER_SUFFICIENT", "INSUFFICIENT_DATA", "NO_MORE_SUPPORTED_PATHS"]).optional(),
})
export type StopDeclaration = z.infer<typeof stopDeclarationSchema>

export const STATE_MARKER = "INVESTIGATION_STATE_JSON:"

/** Extrai a declaração do texto do modelo (linha própria `INVESTIGATION_STATE_JSON: {…}`). Nunca lança. */
export function extractStopDeclaration(rawText: string): { notes: string; declaration: StopDeclaration | null; present: boolean; markerStatus: MarkerParseStatus } {
  // V1.3.2: framing por scanner balanceado — duplicado/malformado = sem declaração (fail-closed: avaliado só pelas necessidades do runtime).
  const extraction = extractMarkerPayload(rawText, STATE_MARKER)
  if (extraction.status === "MARKER_NOT_FOUND") return { notes: rawText.trim(), declaration: null, present: false, markerStatus: extraction.status }
  if (extraction.status !== "VALID") return { notes: extraction.text, declaration: null, present: false, markerStatus: extraction.status }
  const parsed = stopDeclarationSchema.safeParse(extraction.payload)
  return parsed.success ? { notes: extraction.text, declaration: parsed.data, present: true, markerStatus: "VALID" } : { notes: extraction.text, declaration: null, present: false, markerStatus: "MARKER_PAYLOAD_INVALID" }
}

/** Instruções (estáticas) do contrato de parada — entram no planejamento e nas notas. */
export function renderStopContract(): string {
  return [
    "ESTADO DA INVESTIGAÇÃO (obrigatório ao PARAR): quando decidir não chamar mais ferramentas, escreva as NOTAS e termine com UMA linha própria começando exatamente com \"" + STATE_MARKER + "\" seguida de um JSON válido (objeto, sem markdown, sem texto depois):",
    '{"proposedAction":"STOP","supportedClaims":[{"text":"afirmação sustentada","scope":"INTERACTION_SPECIFIC|PERIOD_PATTERN|EMPLOYEE_PATTERN|POPULATION_PATTERN","evidenceRefs":["F-n"],"temporalRelation":"NONE|EARLIER_VS_LATER|TREND|CHANGE|STABILITY|TEMPORAL_CONCENTRATION|POSITION (só quando a afirmação compara momentos ou posiciona no período)","evidenceBuckets":["B-n dos blocos que sustentam a relação"]}],"unresolvedQuestions":[{"question":"pergunta ainda aberta","material":true,"candidateTools":["nome_da_ferramenta"]}],"hypotheses":[{"hypothesis":"…","status":"SUPPORTED|REFUTED|OPEN|BLOCKED_BY_DATA","material":true,"evidenceRefs":["F-n"],"candidateTools":[]}],"contradictoryEvidence":[{"description":"…","refs":["F-n"],"status":"OPEN|CONTEXTUALIZED"}],"dataLimitations":["…"],"additionalEvidenceCouldChangeConclusion":false,"additionalEvidenceCouldIncreaseRequiredScope":false,"proposedStopReason":"ANSWER_SUFFICIENT|INSUFFICIENT_DATA|NO_MORE_SUPPORTED_PATHS"}',
    "TEMPO: ter dados de vários blocos (B1, B2, B3) é COBERTURA; afirmar que algo mudou, aumentou, passou a acontecer, ficou estável ou aconteceu \"no início/fim do período\" é RELAÇÃO temporal — exige comparação validada entre blocos (declare temporalRelation e evidenceBuckets; a posição de cada interação no período é a calculada pela aplicação, nunca a ordem em que aparece). \"Nenhuma diferença sustentada\" é resultado válido.",
    "MATERIAL = a resposta poderia mudar a conclusão, a recomendação, o escopo permitido, invalidar uma hipótese, revelar que o problema é estrutural e não individual, ou que a evidência não é representativa. Curiosidades sem impacto NÃO são materiais. Uma hipótese OPEN e material com ferramenta capaz de testá-la significa que a investigação NÃO terminou — prefira chamar a ferramenta a declarar STOP. Evidência conflitante relevante deve ser resolvida, contextualizada ou declarada como incerteza. A aplicação valida a declaração: um STOP com lacuna material e caminho disponível é recusado e a investigação continua.",
  ].join("\n")
}

export type SufficiencyContext = {
  objective: InvestigationObjective
  ledger: LedgerEntry[]
  assessments: RepresentativenessAssessment[]
  /** Interações registradas do colaborador no período — null = desconhecido. */
  interactionsInPeriod: number | null
  /** Transcrição em foco já está no input (feedback de chamada). */
  transcriptInFocus: boolean
  knowledgeAvailable: boolean
  /** V1.3.2: intenção do período (janela longa → evolução é pergunta legítima) — ausente = padrão/curta. */
  periodIntent?: import("./interaction-analysis.js").PeriodIntent | undefined
  /** V1.3.2: flag/sinal que trouxe a interação em foco (Workflow por gatilho) — null quando não há. */
  signalFlag?: string | null | undefined
  /** V1.3.4: blocos da janela (1 = janela curta). Comparação temporal só faz sentido com ≥ 2. */
  temporalBuckets?: number | undefined
  /** Tools que PODEM ser chamadas na próxima rodada (capacidades efetivas ∩ pruning). */
  availableTools: ToolKey[]
  roundsRemaining: number
  budgetRemaining: number
}

/** Máximo de perguntas/hipóteses MATERIAIS abertas declaradas pelo modelo que bloqueiam o STOP de uma vez (§40 — sem explosão especulativa). */
export const MATERIAL_HYPOTHESIS_BUDGET = 4

const has = (ledger: LedgerEntry[], tool: string) => ledger.filter((entry) => entry.tool === tool && entry.qualityStatus !== "NO_DATA" && entry.qualityStatus !== "NOT_SUPPORTED")
const refsOf = (entries: LedgerEntry[]) => entries.map((entry) => entry.ref)

/**
 * NECESSIDADES DE EVIDÊNCIA derivadas do objetivo + evidência encontrada (nunca um checklist por
 * indicador): cada necessidade sabe o que a satisfaz, quais Tools poderiam resolvê-la e se é material.
 */
export function deriveEvidenceNeeds(context: SufficiencyContext, declaration: StopDeclaration | null): EvidenceNeed[] {
  const { objective, ledger } = context
  const needs: EvidenceNeed[] = []
  const indicatorObjective = ["EXPLAIN_INDICATOR_DEVIATION", "DESCRIBE_PERFORMANCE", "COMPARE_WITH_POPULATION", "IDENTIFY_EMPLOYEE_PATTERN"].includes(objective.kind) && ledger.some((entry) => entry.capability === "INDICATOR_ANALYSIS" || entry.tool === "get_indicator_snapshot")
  if (indicatorObjective) {
    const snapshot = has(ledger, "get_indicator_snapshot")
    needs.push({ id: "E_INDICATOR_STATE", question: "Qual é o valor do indicador no período, frente à meta?", requiredForClaimScope: null, status: snapshot.length > 0 ? "SATISFIED" : "OPEN", evidenceRefs: refsOf(snapshot), candidateTools: ["get_indicator_snapshot"], material: true, source: "RUNTIME" })
    const comparison = [...has(ledger, "compare_periods"), ...has(ledger, "compare_population"), ...has(ledger, "get_employee_history")]
    needs.push({ id: "E_COMPARISON", question: "Como o resultado se compara — período anterior, população de referência ou histórico?", requiredForClaimScope: null, status: comparison.length > 0 ? "SATISFIED" : "OPEN", evidenceRefs: refsOf(comparison), candidateTools: ["compare_periods", "compare_population", "get_employee_history"], material: objective.kind !== "DESCRIBE_PERFORMANCE", source: "RUNTIME" })
  }
  if (objective.kind === "COMPARE_WITH_POPULATION" || objective.requiredScope === "POPULATION_PATTERN") {
    const population = [...has(ledger, "compare_population"), ...has(ledger, "analyze_peer_patterns")]
    needs.push({ id: "E_POPULATION", question: "Há evidência agregada dos pares (nunca individual) para sustentar a comparação?", requiredForClaimScope: "POPULATION_PATTERN", status: population.length > 0 ? "SATISFIED" : "OPEN", evidenceRefs: refsOf(population), candidateTools: ["compare_population", "find_comparable_interactions", "analyze_peer_patterns"], material: true, source: "RUNTIME" })
  }
  if (objective.causal || objective.kind === "FEEDBACK_SINGLE_INTERACTION" || objective.kind === "PROCESS_AUDIT") {
    const behavioral = ledger.filter((entry) => isBehavioralEvidence(entry) && entry.tool !== "find_interactions")
    const satisfied = context.transcriptInFocus || behavioral.length > 0
    const noInteractions = context.interactionsInPeriod === 0 && !context.transcriptInFocus
    needs.push({
      id: "E_BEHAVIORAL_EVIDENCE",
      question: objective.causal ? "Há evidência de interação/transcrição que sustente (ou descarte) uma causa comportamental?" : "A interação em foco foi lida com evidência literal?",
      requiredForClaimScope: "INTERACTION_SPECIFIC",
      status: satisfied ? "SATISFIED" : noInteractions ? "BLOCKED" : "OPEN",
      ...(satisfied ? {} : noInteractions ? { blockedBy: "NO_DATA" as const } : {}),
      evidenceRefs: context.transcriptInFocus ? ["TRANSCRICAO", ...refsOf(behavioral)] : refsOf(behavioral),
      candidateTools: ["find_interactions", "get_interaction_context", "analyze_interactions", "get_interaction_flags"],
      material: true,
      source: "RUNTIME",
    })
  }
  if (objective.requiredScope === "EMPLOYEE_PATTERN" || objective.requiredScope === "PERIOD_PATTERN") {
    const own = context.assessments.filter((item) => item.tool !== "analyze_peer_patterns" && item.tool !== "find_comparable_interactions")
    const level = bestRepresentativeness(own)
    const analyzed = own.reduce((max, item) => Math.max(max, item.analyzedCount ?? item.analyzed), 0)
    const universeExhausted = context.interactionsInPeriod !== null && (context.interactionsInPeriod < REPRESENTATIVE_MIN_SAMPLE || analyzed >= context.interactionsInPeriod)
    const status: EvidenceNeedStatus = level === "REPRESENTATIVE" ? "SATISFIED" : universeExhausted ? "BLOCKED" : "OPEN"
    needs.push({ id: "E_REPRESENTATIVENESS", question: `A amostra de interações analisada é representativa para afirmar um ${objective.requiredScope === "EMPLOYEE_PATTERN" ? "padrão do colaborador" : "padrão no período"}?`, requiredForClaimScope: objective.requiredScope, status, ...(status === "BLOCKED" ? { blockedBy: "NO_DATA" as const } : {}), evidenceRefs: refsOf(ledger.filter((entry) => own.some((item) => item.ref === entry.ref))), candidateTools: ["find_interactions", "analyze_interactions", "get_interaction_flags"], material: true, source: "RUNTIME" })
  }
  // V1.3.2 — cobertura TEMPORAL (genérica): objetivo de padrão/causa numa janela longa não termina sem evidência
  // que atravesse o período (histórico/evolução, ou interações analisadas em mais de um bloco da janela).
  if (context.periodIntent === "PERIOD_EVOLUTION" && (objective.kind === "IDENTIFY_EMPLOYEE_PATTERN" || objective.causal)) {
    const temporal = [...has(ledger, "get_employee_history"), ...has(ledger, "compare_periods"), ...has(ledger, "detect_anomalies")]
    const spread = ledger.filter((entry) => (entry.tool === "analyze_interactions" || entry.tool === "get_interaction_flags") && (entry.signals?.temporalCoverage?.bucketsCovered ?? 0) >= 2)
    const satisfied = temporal.length > 0 || spread.length > 0
    const candidates = (["get_employee_history", "compare_periods", "detect_anomalies", "get_interaction_flags", "find_interactions", "analyze_interactions"] as ToolKey[]).filter((tool) => context.availableTools.includes(tool) || ledger.some((entry) => entry.tool === tool))
    const noPath = candidates.length === 0
    const noInteractions = context.interactionsInPeriod === 0
    needs.push({ id: "E_TEMPORAL_COVERAGE", question: "A evidência atravessa o período (evolução ou interações de mais de um momento da janela), ou só o fim dele?", requiredForClaimScope: objective.requiredScope, status: satisfied ? "SATISFIED" : noInteractions || noPath ? "BLOCKED" : "OPEN", ...(satisfied ? {} : noInteractions ? { blockedBy: "NO_DATA" as const } : noPath ? { blockedBy: "NO_TOOL" as const } : {}), evidenceRefs: refsOf([...temporal, ...spread]), candidateTools: candidates, material: true, source: "RUNTIME" })
  }
  // V1.3.4 — COMPARAÇÃO temporal (genérica) ≠ cobertura: nasce quando a conclusão envolve evolução/mudança (padrão ou causa
  // numa janela longa) ou quando o modelo declara hipótese/afirmação temporal — nunca só porque a conversa menciona o passado.
  const temporalObjective = context.periodIntent === "PERIOD_EVOLUTION" && (objective.kind === "IDENTIFY_EMPLOYEE_PATTERN" || objective.causal)
  const temporalDeclared = objective.kind !== "FEEDBACK_SINGLE_INTERACTION" && objective.kind !== "PROCESS_AUDIT" && ((declaration?.hypotheses ?? []).some((item) => item.material && ((item.temporalRelation && item.temporalRelation !== "NONE") || detectTemporalLanguage(item.hypothesis).length > 0)) || (declaration?.supportedClaims ?? []).some((item) => (item.temporalRelation && item.temporalRelation !== "NONE") || detectTemporalLanguage(item.text).length > 0))
  if (temporalObjective || temporalDeclared) {
    const facts = temporalFactsOf(ledger)
    // Padrão do colaborador é pergunta COMPORTAMENTAL: só comparação de transcrições satisfaz; causa de indicador aceita também a tendência do número.
    const behavioralOnly = objective.kind === "IDENTIFY_EMPLOYEE_PATTERN"
    const satisfying = facts.filter((fact) => (behavioralOnly ? fact.behavioral : true))
    // Sem contagem de blocos informada, PERIOD_EVOLUTION implica janela com mais de um bloco.
    const buckets = context.temporalBuckets ?? (context.periodIntent === "PERIOD_EVOLUTION" ? 2 : 1)
    const candidates = (["analyze_interactions", "find_interactions", "get_interaction_flags", ...(behavioralOnly ? [] : (["get_employee_history", "compare_periods", "detect_anomalies"] as ToolKey[]))] as ToolKey[]).filter((tool) => context.availableTools.includes(tool) || ledger.some((entry) => entry.tool === tool))
    const noData = buckets < 2 || context.interactionsInPeriod === 0 || (context.interactionsInPeriod !== null && context.interactionsInPeriod < 2)
    const status: EvidenceNeedStatus = satisfying.length > 0 ? "SATISFIED" : noData ? "BLOCKED" : candidates.length === 0 ? "BLOCKED" : "OPEN"
    needs.push({ id: "E_TEMPORAL_COMPARISON", question: "Os momentos da janela foram COMPARADOS entre si (não só cobertos) para sustentar ou rejeitar uma relação temporal — mudança, tendência, estabilidade, posição no período?", requiredForClaimScope: objective.requiredScope, status, ...(status === "BLOCKED" ? { blockedBy: (noData ? "NO_DATA" : "NO_TOOL") as "NO_DATA" | "NO_TOOL" } : {}), evidenceRefs: satisfying.map((fact) => fact.ref), candidateTools: candidates, material: true, source: "RUNTIME" })
  }
  // V1.3.2 — contexto do SINAL (genérico): a interação em foco veio por um sinal/flag; antes de concluir sobre ela,
  // o sinal precisa de contexto além da própria transcrição (eventos da interação, outras interações do colaborador no recorte).
  if (context.signalFlag && context.transcriptInFocus && objective.kind === "FEEDBACK_SINGLE_INTERACTION") {
    const contextual = ledger.filter((entry) => !entry.preflight && ["get_interaction_flags", "find_interactions", "find_comparable_interactions", "analyze_interactions", "get_employee_history"].includes(entry.tool) && entry.qualityStatus !== "NOT_SUPPORTED")
    const candidates = (["get_interaction_flags", "find_interactions", "find_comparable_interactions"] as ToolKey[]).filter((tool) => context.availableTools.includes(tool))
    needs.push({ id: "E_SIGNAL_CONTEXT", question: `O sinal "${context.signalFlag}" que trouxe esta interação foi contextualizado além da própria transcrição (eventos registrados; outras interações do colaborador no recorte — é pontual ou se repete)?`, requiredForClaimScope: null, status: contextual.length > 0 ? "SATISFIED" : candidates.length > 0 ? "OPEN" : "BLOCKED", ...(contextual.length === 0 && candidates.length === 0 ? { blockedBy: "NO_TOOL" as const } : {}), evidenceRefs: refsOf(contextual), candidateTools: candidates, material: true, source: "RUNTIME" })
  }
  if ((objective.kind === "FEEDBACK_SINGLE_INTERACTION" || objective.kind === "PROCESS_AUDIT") && context.availableTools.includes("query_knowledge")) {
    const knowledge = has(ledger, "query_knowledge")
    needs.push({ id: "E_PROCEDURE", question: "Qual procedimento oficial se aplica ao que foi observado?", requiredForClaimScope: null, status: context.knowledgeAvailable || knowledge.length > 0 ? "SATISFIED" : "OPEN", evidenceRefs: refsOf(knowledge), candidateTools: ["query_knowledge"], material: true, source: "RUNTIME" })
  }
  // Declaradas pelo modelo: perguntas abertas e hipóteses OPEN materiais viram necessidades rastreáveis —
  // com ORÇAMENTO (V1.3.2 — §40): só as primeiras MATERIAL_HYPOTHESIS_BUDGET materiais bloqueiam o STOP; o excedente fica registrado como imaterial.
  let materialBudget = MATERIAL_HYPOTHESIS_BUDGET
  const withinBudget = (material: boolean) => {
    if (!material) return false
    if (materialBudget <= 0) return false
    materialBudget -= 1
    return true
  }
  for (const [index, question] of (declaration?.unresolvedQuestions ?? []).entries()) {
    needs.push({ id: `Q${index + 1}`, question: question.question, requiredForClaimScope: null, status: "OPEN", evidenceRefs: [], candidateTools: question.candidateTools.filter((tool) => tool !== "synthesize_evidence"), material: withinBudget(question.material), source: "MODEL" })
  }
  for (const [index, hypothesis] of (declaration?.hypotheses ?? []).entries()) {
    if (hypothesis.status !== "OPEN") continue
    needs.push({ id: `H${index + 1}`, question: hypothesis.hypothesis, requiredForClaimScope: null, status: "OPEN", evidenceRefs: hypothesis.evidenceRefs, candidateTools: hypothesis.candidateTools.filter((tool) => tool !== "synthesize_evidence"), material: withinBudget(hypothesis.material), source: "MODEL" })
  }
  return needs
}

export type StopEvaluation = {
  stopProposed: boolean
  accepted: boolean
  /** Motivo aceito (quando `accepted`) — null quando rejeitado (a investigação continua). */
  reason: StopReason | null
  status: SufficiencyStatus | null
  /** Por que o STOP foi recusado (uma linha por lacuna com caminho) — vai para o modelo na próxima rodada e para o QA Lab. */
  rejections: { needId: string; reason: string; candidateTools: ToolKey[] }[]
  needs: EvidenceNeed[]
  hypotheses: MaterialHypothesis[]
  contradictoryEvidence: { description: string; refs: string[]; status: "OPEN" | "CONTEXTUALIZED" }[]
  limitations: string[]
}

/** Regra central (§8): avalia a proposta de STOP contra as necessidades derivadas e o escopo exigido. */
export function evaluateStop(declaration: StopDeclaration | null, context: SufficiencyContext): StopEvaluation {
  const needs = deriveEvidenceNeeds(context, declaration)
  const available = new Set(context.availableTools)
  const canContinue = context.roundsRemaining > 0 && context.budgetRemaining > 0
  const rejections: StopEvaluation["rejections"] = []
  const limitations: string[] = [...(declaration?.dataLimitations ?? [])]
  // 3/4/6: lacuna MATERIAL aberta com Tool disponível → recusa; sem Tool → BLOCKED (NO_TOOL).
  for (const need of needs) {
    if (need.status !== "OPEN" || !need.material) continue
    const tools = need.candidateTools.filter((tool) => available.has(tool))
    if (tools.length > 0) rejections.push({ needId: need.id, reason: `${need.question} — ainda sem evidência; ${tools.join("/")} pode responder`, candidateTools: tools })
    else {
      need.status = "BLOCKED"
      need.blockedBy = "NO_TOOL"
    }
  }
  // 5: contradição relevante sem contextualização.
  const contradictions = (declaration?.contradictoryEvidence ?? []).map((item) => ({ description: item.description, refs: item.refs, status: item.status }))
  for (const [index, item] of (declaration?.contradictoryEvidence ?? []).entries()) {
    if (item.status !== "OPEN") continue
    const tools = (item.candidateTools.length > 0 ? item.candidateTools : (["analyze_interactions", "segment_indicator", "find_interactions"] as ToolKey[])).filter((tool) => available.has(tool))
    if (tools.length > 0) rejections.push({ needId: `C${index + 1}`, reason: `evidência conflitante sem resolução: ${item.description} — ${tools.join("/")} pode contextualizar`, candidateTools: tools })
    else limitations.push(`evidência conflitante não resolvida: ${item.description} — a conclusão permanece incerta neste ponto`)
  }
  // 2: escopo das afirmações sustentadas × representatividade (evidência verdadeira ≠ generalização).
  for (const claim of declaration?.supportedClaims ?? []) {
    const scope = claim.scope ?? "INTERACTION_SPECIFIC"
    const referenced = context.assessments.filter((item) => claim.evidenceRefs.some((ref) => ref.toUpperCase() === item.ref))
    if (scope === "INTERACTION_SPECIFIC" && (referenced.length > 0 || claim.evidenceRefs.some((ref) => ref.toUpperCase() === "TRANSCRICAO"))) continue
    const allowed = scopeAllowedBy(scope, referenced)
    if (allowed.ok) continue
    const tools = (["find_interactions", "analyze_interactions", "get_interaction_flags", "analyze_peer_patterns"] as ToolKey[]).filter((tool) => available.has(tool))
    const exhausted = context.interactionsInPeriod !== null && context.interactionsInPeriod < REPRESENTATIVE_MIN_SAMPLE
    if (tools.length > 0 && !exhausted) rejections.push({ needId: "E_CLAIM_SCOPE", reason: `"${claim.text}" declara escopo ${scope}, mas ${allowed.reason}`, candidateTools: tools })
    else limitations.push(`"${claim.text}" só se sustenta como "nas interações analisadas" (${allowed.reason})`)
  }
  const hypotheses: MaterialHypothesis[] = (declaration?.hypotheses ?? []).map((item) => ({ hypothesis: item.hypothesis, status: item.status, material: item.material, evidenceRefs: item.evidenceRefs, candidateTools: item.candidateTools.filter((tool) => tool !== "synthesize_evidence") }))
  const stopProposed = !declaration || declaration.proposedAction === "STOP"
  if (rejections.length > 0 && canContinue) return { stopProposed, accepted: false, reason: null, status: null, rejections, needs, hypotheses, contradictoryEvidence: contradictions, limitations }
  // Sem caminho (ou sem rodadas/orçamento): o motivo diz a verdade sobre POR QUE parou.
  const blockedNoData = needs.filter((need) => need.material && need.status === "BLOCKED" && need.blockedBy === "NO_DATA")
  const blockedNoTool = needs.filter((need) => need.material && need.status === "BLOCKED" && need.blockedBy === "NO_TOOL")
  for (const need of blockedNoData) limitations.push(`${need.question} — os dados necessários não existem/não têm cobertura`)
  for (const need of blockedNoTool) limitations.push(`${need.question} — nenhuma ferramenta autorizada nesta execução resolve isso`)
  if (rejections.length > 0) {
    // Lacuna material com caminho, mas sem rodada/orçamento: limite, nunca suficiência.
    for (const rejection of rejections) limitations.push(`não investigado por limite: ${rejection.reason}`)
    const reason: StopReason = context.roundsRemaining <= 0 ? "MAX_PLANNING_ROUNDS" : "INVESTIGATION_TOOL_BUDGET"
    return { stopProposed, accepted: true, reason, status: "LIMITED", rejections, needs, hypotheses, contradictoryEvidence: contradictions, limitations }
  }
  if (blockedNoData.length > 0) return { stopProposed, accepted: true, reason: "INSUFFICIENT_DATA", status: "INSUFFICIENT_DATA", rejections, needs, hypotheses, contradictoryEvidence: contradictions, limitations }
  if (blockedNoTool.length > 0) return { stopProposed, accepted: true, reason: "NO_MORE_SUPPORTED_PATHS", status: "NO_PATH", rejections, needs, hypotheses, contradictoryEvidence: contradictions, limitations }
  return { stopProposed, accepted: true, reason: "ANSWER_SUFFICIENT", status: "SUFFICIENT", rejections, needs, hypotheses, contradictoryEvidence: contradictions, limitations }
}

/** Bloco enviado ao modelo quando o STOP é recusado (próxima rodada). */
export function renderStopRejection(evaluation: StopEvaluation): string {
  return [
    "STOP RECUSADO pela aplicação — a investigação NÃO terminou. Lacunas materiais com caminho disponível:",
    ...evaluation.rejections.map((item) => `- [${item.needId}] ${item.reason}.`),
    "Chame agora as ferramentas indicadas (várias de uma vez quando independentes). Se, após consultá-las, os dados não existirem, declare a lacuna como BLOCKED_BY_DATA/dataLimitations e proponha STOP com proposedStopReason INSUFFICIENT_DATA — nunca invente a resposta.",
  ].join("\n")
}
