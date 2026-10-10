import type { EngineModelPort, EngineModelRequest } from "../application/ports.js"

/**
 * Modelo FALSO do motor (testes unitários e provas de banco): lê o prompt real (linhas [L-n], seções [S-n]) e responde pelo papel
 * de cada etapa — análise da chamada do procedimento de SEGUNDA VIA dos fixtures, REVISÃO independente, planejamento da
 * investigação, composição, verificação e coerência. Zero chamada real. Comprova CONTRATOS e EXECUÇÃO — nunca a qualidade de um
 * modelo real.
 */
export type ReviewPayload = { claims: { id: string; proposedStatus: string; evidenceKind: string; rule: { section: string | null; leadIn: string | null; text: string; conditional: boolean; sameList: { text: string; proposedStatus: string }[] }; evidence: { turn: string; speaker: string | null; quote: string }[]; opportunityTurn: string | null; attention: string[]; lookAt: string[] }[]; path?: { assessment: string }; linesToAssess?: { id: string; rule: { text: string } }[] }
export const reviewPayloadOf = (request: EngineModelRequest): ReviewPayload => JSON.parse(request.contents[0]!.text.split("PROPOSTAS DA ANÁLISE A REVISAR (JSON):")[1]!) as ReviewPayload
/** Revisão / confirmação do contrato `OBLIGATIONS_V1` (obrigações completas). */
export type ObligationReviewPayload = { need?: { summary: string }; claims: { id: string; proposedStatus: string; action: string | null; condition: string | null; items?: { text: string; status: string }[]; itemsMode?: string; /** Ausente desde o prompt V3 (a revisão não recebe o rótulo da análise). */ where?: string | null; sources: { line: string; section: string | null; text: string }[]; evidence: { turn: string; speaker: string | null; quote: string; role?: string | null }[]; opportunityTurn: string | null; analystReading?: string | null; contestedReading?: { conclusion: string; reading: string | null }; attention: string[] }[]; linesToAssess?: { id: string; rule: { text: string } }[]; listItemsInPlay?: unknown[]; notAssessed?: unknown[]; undetermined?: { id: string; action: string | null; analysisConclusion: string; setAsideBecause: string; sources: { line: string }[] }[]; path?: unknown }
const isObligationReview = (request: EngineModelRequest) => request.contents[0]!.text.includes("ANÁLISE A REVISAR (JSON):") && !request.contents[0]!.text.includes("PROPOSTAS DA ANÁLISE A REVISAR (JSON):")
const isObligationConfirmation = (request: EngineModelRequest) => request.contents[0]!.text.includes("CONCLUSÕES A CONFERIR (JSON):")
export const obligationReviewPayloadOf = (request: EngineModelRequest): ObligationReviewPayload => JSON.parse(request.contents[0]!.text.split(isObligationConfirmation(request) ? "CONCLUSÕES A CONFERIR (JSON):" : "ANÁLISE A REVISAR (JSON):")[1]!) as ObligationReviewPayload
/**
 * Rótulos que a ANÁLISE deu a uma obrigação (onde o ato acontece, papel de cada fala). Desde o prompt V3 a revisão NÃO os recebe — o
 * modelo falso os lê da análise que ele mesmo produziu (O-n) ou das obrigações de fora que a revisão apontou (R-n), para responder como
 * uma revisora "razoável" que leu a fonte do mesmo jeito.
 */
export type ObligationLabels = { where: string | null; evidence: { turn: string; quote: string; role: string | null }[] }
/** Leitura "razoável" da evidência de uma obrigação proposta (pelo papel dos trechos que a análise declarou). */
export const obligationEvidenceReadingOf = (claim: ObligationReviewPayload["claims"][number], labels: ObligationLabels | null = null) => {
  const roleOf = (quote: { turn: string; quote: string; role?: string | null }) => quote.role ?? labels?.evidence.find((entry) => entry.turn === quote.turn && entry.quote === quote.quote)?.role ?? null
  const conduct = claim.evidence.some((quote) => roleOf(quote) === "CONDUCT" && /OPERADOR/i.test(quote.speaker ?? ""))
  if (claim.proposedStatus === "MET") return claim.evidence.length === 0 ? "ABSENCE_IN_CALL" : conduct ? "ACTION_IN_CALL" : claim.evidence.some((quote) => roleOf(quote) === "DECLARATION" || roleOf(quote) === "INTENTION") ? "STATEMENT_ABOUT_ACTION" : "CONDITION_ONLY"
  if (claim.proposedStatus === "NOT_MET") return conduct ? "CONTRARY_ACTION_IN_CALL" : "ABSENCE_IN_CALL"
  return "ACTION_IN_CALL"
}
/** Rótulos do modelo falso que está respondendo agora (testes chamam `confirmAllObligations(payload)` dentro do callback). */
let activeLabelsOf: (id: string) => ObligationLabels | null = () => null
/** Revisão padrão das obrigações: confirma cada conclusão, lê partes como cumulativas, nada de fora, itens sem avaliação "não observável". */
export function confirmAllObligations(payload: ObligationReviewPayload, labelsOf: (id: string) => ObligationLabels | null = activeLabelsOf) {
  return {
    claims: payload.claims.map((claim) => {
      const labels = labelsOf(claim.id)
      const where = claim.where ?? labels?.where ?? "IN_CONVERSATION"
      return { id: claim.id, verdict: "CONFIRMED", issues: [], listReading: (claim.items ?? []).length > 1 ? (claim.itemsMode === "ANY" ? "ALTERNATIVES" : "CUMULATIVE") : null, actPlace: where, evidenceReading: obligationEvidenceReadingOf(claim, labels), outsideDependency: where === "OUTSIDE_CONVERSATION", conditionEvidence: claim.condition ? [{ turn: "T2", speaker: "CLIENTE", quote: "Preciso da segunda via da conta." }] : [] }
    }),
    linesToAssess: (payload.linesToAssess ?? []).map((line) => ({ id: line.id, status: "NOT_OBSERVABLE", rationale: "A conversa não mostra." })),
    missed: [],
    path: payload.path ? { verdict: "CONFIRMED", issues: [] } : null,
  }
}
export type PlannerPayload = { openQuestions: { id: string; status: string; reason: string; candidateTools: string[]; context?: string[] }[]; settledQuestions?: { id: string; status: string; reason: string }[]; slices?: { ref: string; label: string; reason: string; origin: string; universe: number; confirmedAnalyzed: number; pendingReview: number; interactions: string[] }[]; tools: { tool: string }[]; interactions?: { ref: string; analysis: string; slices: string[] }[]; evidence: string[]; limits: Record<string, number> }
/** Pedido de organização em práticas: práticas conhecidas (P-n) e regras a organizar (R-n). */
export type PracticePayload = { known: { ref: string; title: string; examples: string[] }[]; rules: { ref: string; source: string; listOpening?: string; rule: string }[] }
export function practicePayloadOf(request: EngineModelRequest): PracticePayload {
  const text = request.contents[0]!.text
  const knownPart = text.slice(text.indexOf(":\n") + 2, text.indexOf("\n\nREGRAS A ORGANIZAR"))
  const rulesPart = text.slice(text.indexOf(":\n", text.indexOf("REGRAS A ORGANIZAR")) + 2)
  return { known: knownPart.startsWith("(nenhuma") ? [] : JSON.parse(knownPart), rules: JSON.parse(rulesPart) }
}
/** Pedido de agrupamento em temas: temas conhecidos (T-n) e práticas a agrupar (P-n). */
export type ThemePayload = { known: { ref: string; theme: string; points: string[] }[]; practices: { ref: string; conduct: string; rules: string[] }[] }
export function themePayloadOf(request: EngineModelRequest): ThemePayload {
  const text = request.contents[0]!.text
  const knownPart = text.slice(text.indexOf(":\n") + 2, text.indexOf("\n\nPRÁTICAS A AGRUPAR"))
  const practicesPart = text.slice(text.indexOf(":\n", text.indexOf("PRÁTICAS A AGRUPAR")) + 2)
  return { known: knownPart.startsWith("(nenhum") ? [] : JSON.parse(knownPart), practices: JSON.parse(practicesPart) }
}
/** Padrão do modelo falso: tudo no primeiro tema conhecido (ou num tema novo "Pontos avaliados"); nome curto = começo da conduta. */
export const defaultThemes = (payload: ThemePayload) => ({
  assignments: payload.practices.map((practice) => ({ practice: practice.ref, theme: payload.known.length > 0 ? "T1" : "N1", shortTitle: practice.conduct.slice(0, 60).trim() })),
  newThemes: payload.known.length > 0 ? [] : [{ ref: "N1", title: "Pontos avaliados" }],
})
export const plannerPayloadOf = (request: EngineModelRequest) => JSON.parse(request.contents[0]!.text.split("INVESTIGAÇÃO (JSON):")[1]!) as PlannerPayload

/**
 * Leitura da evidência (contrato V7 da revisão) que uma revisora "razoável" daria à PROPOSTA como ela foi enviada: declaração vira
 * declaração, omissão vira ausência, conduta vira a própria ação. Testes que precisam de outra leitura a passam explicitamente.
 */
export const evidenceReadingFor = (claim: Pick<ReviewPayload["claims"][number], "proposedStatus" | "evidenceKind">) =>
  claim.evidenceKind === "DECLARED_ACTION" ? "STATEMENT_ABOUT_ACTION"
  : claim.proposedStatus === "MET" ? (claim.evidenceKind === "COMPLIANCE_BY_ABSENCE" ? "ABSENCE_IN_CALL" : "ACTION_IN_CALL")
  : claim.proposedStatus === "NOT_MET" ? (claim.evidenceKind === "OMISSION" ? "ABSENCE_IN_CALL" : "CONTRARY_ACTION_IN_CALL")
  : "ACTION_IN_CALL"

/** Revisão padrão: confirma tudo (itens de lista lidos como cumulativos; condição sustentada pela primeira fala do cliente). */
export function confirmAll(payload: ReviewPayload) {
  return {
    claims: payload.claims.map((claim) => ({ id: claim.id, verdict: "CONFIRMED", issues: [], listReading: claim.rule.sameList.length > 0 ? "CUMULATIVE" : null, evidenceReading: evidenceReadingFor(claim), outsideDependency: false, conditionEvidence: claim.rule.conditional ? [{ turn: "T2", speaker: "CLIENTE", quote: "Preciso da segunda via da conta." }] : [], counterEvidence: [] })),
    path: payload.path ? { verdict: "CONFIRMED", issues: [] } : null,
    linesToAssess: (payload.linesToAssess ?? []).map((line) => ({ id: line.id, status: "NOT_OBSERVABLE", rationale: "A conversa não mostra." })),
  }
}

/**
 * Planejador padrão do modelo falso (um analista "razoável" e previsível): para cada pergunta aberta, a primeira ferramenta
 * disponível que a responde — chamadas de um recorte pelas I-n DESSE recorte; nada aberto = para. Testes que precisam de outra
 * escolha passam `planner`.
 */
export function defaultPlan(payload: PlannerPayload) {
  const open = payload.openQuestions
  const tools = new Set(payload.tools.map((tool) => tool.tool))
  const calls: { tool: string; args: Record<string, unknown>; question: string }[] = []
  const callsQuestion = open.find((question) => question.id.startsWith("CALLS") || question.id.startsWith("RECOGNITION"))
  if (callsQuestion && tools.has("analyze_calls")) {
    const sliceRef = callsQuestion.id.split(":")[1]
    const refs = sliceRef ? (payload.slices ?? []).find((slice) => slice.ref === sliceRef)?.interactions ?? [] : (payload.interactions ?? []).map((entry) => entry.ref)
    if (refs.length > 0) calls.push({ tool: "analyze_calls", args: { interactions: refs.slice(0, 5), question: "o que se observa nas chamadas do recorte" }, question: callsQuestion.id })
  }
  if (open.some((question) => question.id === "CONTEXT") && tools.has("compare_population")) calls.push({ tool: "compare_population", args: { reference: "SUBGROUP" }, question: "CONTEXT" })
  if (open.some((question) => question.id === "WHERE") && tools.has("detect_anomalies")) calls.push({ tool: "detect_anomalies", args: {}, question: "WHERE" })
  if (open.some((question) => question.id === "DATA_QUALITY") && tools.has("validate_data_quality")) calls.push({ tool: "validate_data_quality", args: {}, question: "DATA_QUALITY" })
  return calls.length > 0 ? { calls } : { calls: [], stop: { reason: "SUFFICIENT", note: "Os fatos bastam." } }
}

export function fakeEngineModel(options: {
  analysis?: (handle: (text: string) => string) => unknown
  review?: (payload: ReviewPayload, request: EngineModelRequest) => unknown
  failReview?: boolean
  /** Confirmação focal dos achados da revisão (padrão: confirma tudo, com a leitura "razoável" da evidência). */
  confirmation?: (payload: ReviewPayload, request: EngineModelRequest) => unknown
  /** Contrato `OBLIGATIONS_V1`: revisão e confirmação focal por obrigação. */
  obligationReview?: (payload: ObligationReviewPayload, labelsOf: (id: string) => ObligationLabels | null) => unknown
  obligationConfirmation?: (payload: ObligationReviewPayload, labelsOf: (id: string) => ObligationLabels | null) => unknown
  failConfirmation?: boolean
  planner?: (payload: PlannerPayload, round: number) => unknown
  composition?: unknown | ((attempt: number) => unknown)
  failComposition?: boolean
  verification?: (claims: { id: string; stance: string; text: string }[], attempt: number) => unknown
  failVerification?: boolean
  coherence?: unknown
  /** Organização das regras em práticas (`PRACTICE_IDENTITY_V1`). Padrão: cada regra vira a sua própria prática (nada é juntado). */
  practices?: (payload: PracticePayload) => unknown
  /** Agrupamento das práticas em temas (`PRACTICE_THEMES_V1`). Padrão: `defaultThemes`. */
  themes?: (payload: ThemePayload) => unknown
} = {}) {
  const calls: EngineModelRequest[] = []
  let compositionAttempts = 0
  let verificationAttempts = 0
  let plannerRounds = 0
  // Rótulos da análise (O-n) e das obrigações de fora apontadas pela revisão (R-n) — ver `ObligationLabels`.
  let analysisObligations: { where?: string; evidence?: { turn: string; quote: string; role?: string | null }[] }[] = []
  let reviewMissed: { where?: string; evidence?: { turn: string; quote: string; role?: string | null }[] }[] = []
  const labelsOf = (id: string): ObligationLabels | null => {
    const match = /^([OR])(\d+)$/.exec(id)
    const entry = match ? (match[1] === "O" ? analysisObligations : reviewMissed)[Number(match[2]) - 1] : undefined
    return entry ? { where: entry.where ?? null, evidence: (entry.evidence ?? []).map((quote) => ({ turn: quote.turn, quote: quote.quote, role: quote.role ?? null })) } : null
  }
  /** Respostas customizadas escritas antes do prompt V3: a leitura de onde o ato acontece vem do rótulo da análise (padrão razoável). */
  const withActPlace = (body: unknown, payload: ObligationReviewPayload) => {
    for (const claim of ((body as { claims?: Record<string, unknown>[] } | null)?.claims ?? [])) {
      const labels = labelsOf(String(claim.id))
      const where = labels?.where ?? "IN_CONVERSATION"
      if (claim.actPlace === undefined) claim.actPlace = where
      const sent = payload.claims.find((entry) => entry.id === claim.id)
      if (claim.evidenceReading === undefined && sent) claim.evidenceReading = obligationEvidenceReadingOf(sent, labels)
      if (claim.outsideDependency === undefined) claim.outsideDependency = where === "OUTSIDE_CONVERSATION"
    }
    return body
  }
  const respond = (body: unknown) => ({ text: JSON.stringify(body), model: "fake", usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 }, durationMs: 5, costUsd: 0.0005, finishReason: "STOP" })
  const model: EngineModelPort = {
    async generate(request) {
      calls.push(request)
      const prompt = request.contents[0]!.text
      const handle = (text: string) => new RegExp(`\\[(L\\d+)\\] [^\\n]*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).exec(prompt)?.[1] ?? "L0"
      const section = (text: string) => new RegExp(`\\[(S\\d+)\\] [^\\n]*${text}`).exec(prompt)?.[1] ?? "S0"
      if (request.stage === "CALL_ANALYSIS") {
        const body = options.analysis?.(handle) ?? {
          scenario: { customerNeed: "Segunda via da fatura", conditions: [], procedure: "D1", pathSections: [section("Validação do titular"), section("Emissão"), section("Encerramento")], correctPath: "Validar nome e data de nascimento, confirmar o tipo, enviar e encerrar confirmando dúvidas.", pathTaken: "Validou só o nome, confirmou o tipo e enviou.", pathAssessment: "PARTIALLY_CORRECT", pathRationale: "Enviou sem confirmar a data de nascimento.", pathEvidence: [] },
          criteria: [
            { line: handle("Confirmar nome completo"), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Me confirma seu nome completo?" }], rationale: "Confirmou o nome completo.", materiality: "MEDIUM" },
            { line: handle("Confirmar data de nascimento"), status: "NOT_MET", evidenceKind: "OMISSION", evidence: [], opportunityTurn: "T4", rationale: "Enviou a segunda via sem confirmar a data de nascimento.", materiality: "HIGH", guidance: { moment: "Logo depois de confirmar o nome", action: "peça a data de nascimento antes de enviar qualquer dado da conta", ruleLines: [handle("Confirmar data de nascimento")] } },
            { line: handle("Confirmar se a solicitação"), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T5", speaker: "OPERADOR", quote: "A segunda via é da fatura ou do parcelamento?" }], rationale: "Confirmou o tipo antes de enviar.", materiality: "HIGH", whyItMatters: "É o que a etapa de emissão pede antes de enviar." },
            { line: handle("Enviar a segunda via"), status: "MET", evidenceKind: "DECLARED_ACTION", declaredActionTense: "INTENDED", evidence: [{ turn: "T7", speaker: "OPERADOR", quote: "Vou enviar por e-mail agora mesmo." }], rationale: "Disse que enviaria.", materiality: "MEDIUM" },
            { line: handle("Confirmar se o cliente tem mais alguma dúvida"), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T9", speaker: "OPERADOR", quote: "Posso ajudar em mais alguma coisa?" }], rationale: "Perguntou se havia algo mais.", materiality: "MEDIUM" },
          ],
          groupDispositions: [
            { lines: [handle("Informar o prazo de 2 dias"), handle("Não prometer envio imediato")], status: "NOT_APPLICABLE", rationale: "Envio por e-mail, não por correio." },
            { lines: [handle("recapitule o que foi feito"), handle("informe o protocolo")], status: "NOT_OBSERVABLE", rationale: "A conversa termina na resposta do cliente; não há como saber se o fechamento aconteceu." },
          ],
        }
        analysisObligations = Array.isArray((body as { obligations?: unknown }).obligations) ? (body as { obligations: typeof analysisObligations }).obligations : []
        return respond(body)
      }
      if (request.stage === "CALL_CONFIRMATION" && isObligationConfirmation(request)) {
        if (options.failConfirmation) throw Object.assign(new Error("indisponível"), { name: "AI_PROVIDER_DOWN" })
        const payload = obligationReviewPayloadOf(request)
        activeLabelsOf = labelsOf
        return respond(withActPlace(options.obligationConfirmation?.(payload, labelsOf) ?? { claims: confirmAllObligations(payload, labelsOf).claims }, payload))
      }
      if (request.stage === "CALL_REVIEW" && isObligationReview(request)) {
        if (options.failReview) throw Object.assign(new Error("indisponível"), { name: "AI_PROVIDER_DOWN" })
        const payload = obligationReviewPayloadOf(request)
        activeLabelsOf = labelsOf
        const body = withActPlace(options.obligationReview?.(payload, labelsOf) ?? confirmAllObligations(payload, labelsOf), payload)
        reviewMissed = Array.isArray((body as { missed?: unknown } | null)?.missed) ? (body as { missed: typeof reviewMissed }).missed : []
        return respond(body)
      }
      if (request.stage === "CALL_CONFIRMATION") {
        if (options.failConfirmation) throw Object.assign(new Error("indisponível"), { name: "AI_PROVIDER_DOWN" })
        const payload = reviewPayloadOf(request)
        const body = (options.confirmation?.(payload, request) ?? confirmAll(payload)) as { claims?: { id: string; evidenceReading?: unknown; outsideDependency?: unknown }[] } | null
        for (const claim of body?.claims ?? []) {
          const sent = payload.claims.find((entry) => entry.id === claim.id)
          if (sent && claim.evidenceReading === undefined) claim.evidenceReading = evidenceReadingFor(sent)
          if (claim.outsideDependency === undefined) claim.outsideDependency = false
        }
        return respond(body)
      }
      if (request.stage === "CALL_REVIEW") {
        if (options.failReview) throw Object.assign(new Error("indisponível"), { name: "AI_PROVIDER_DOWN" })
        const payload = reviewPayloadOf(request)
        // Respostas customizadas escritas antes do contrato V7 recebem a leitura "razoável" da evidência por omissão (o que cada teste
        // decide continua decidido por ele; quem quer testar a leitura a escreve explicitamente).
        const body = (options.review?.(payload, request) ?? confirmAll(payload)) as { claims?: { id: string; evidenceReading?: unknown; outsideDependency?: unknown }[] } | null
        for (const claim of body?.claims ?? []) {
          const sent = payload.claims.find((entry) => entry.id === claim.id)
          if (sent && claim.evidenceReading === undefined) claim.evidenceReading = evidenceReadingFor(sent)
          if (claim.outsideDependency === undefined) claim.outsideDependency = false
        }
        return respond(body)
      }
      if (request.stage === "PRACTICE_IDENTITY") {
        const payload = practicePayloadOf(request)
        return respond(options.practices ? options.practices(payload) : { assignments: payload.rules.map((rule, index) => ({ rule: rule.ref, practice: `N${index + 1}` })), newPractices: payload.rules.map((rule, index) => ({ ref: `N${index + 1}`, title: rule.rule.split("\n")[0] })) })
      }
      if (request.stage === "PRACTICE_THEMES") {
        const payload = themePayloadOf(request)
        return respond(options.themes ? options.themes(payload) : defaultThemes(payload))
      }
      if (request.stage === "INVESTIGATION_PLANNING") {
        plannerRounds += 1
        const payload = plannerPayloadOf(request)
        return respond(options.planner?.(payload, plannerRounds) ?? defaultPlan(payload))
      }
      if (request.stage === "COMPOSITION") {
        compositionAttempts += 1
        if (options.failComposition) throw Object.assign(new Error("contrato"), { name: "WRITER_CONTRACT" })
        const custom = typeof options.composition === "function" ? (options.composition as (attempt: number) => unknown)(compositionAttempts) : options.composition
        return respond(custom ?? { sentences: [
          { text: "Você confirmou se a segunda via era da fatura ou do parcelamento antes de enviar.", stance: "RECOGNITION", refs: ["S1"], paragraph: 1 },
          { text: "Mas enviou os dados sem confirmar a data de nascimento, que o procedimento pede junto com o nome.", stance: "ADJUSTMENT", refs: ["A1"], paragraph: 2 },
          { text: "Na próxima vez, logo depois de confirmar o nome, peça a data de nascimento antes de enviar qualquer dado da conta.", stance: "GUIDANCE", refs: ["A1"], paragraph: 2 },
        ], card: { text: "Confirme a data de nascimento antes de enviar a segunda via.", refs: ["A1"] } })
      }
      if (request.tag === "coherence") return respond(options.coherence ?? { coherent: true, problems: [] })
      verificationAttempts += 1
      if (options.failVerification) throw Object.assign(new Error("contrato"), { name: "VERIFIER_CONTRACT" })
      const claims = JSON.parse(prompt.split("ITENS A CONFERIR (JSON):")[1]!) as { id: string; stance: string; text: string }[]
      return respond(options.verification?.(claims, verificationAttempts) ?? { verdicts: claims.map((claim) => ({ id: claim.id, verdict: "SUPPORTED", specific: claim.stance === "GUIDANCE" || claim.stance === "RECOGNITION" || claim.stance === "ADJUSTMENT" || claim.stance === "EXAMPLE" ? true : null })) })
    },
  }
  return { model, calls }
}
