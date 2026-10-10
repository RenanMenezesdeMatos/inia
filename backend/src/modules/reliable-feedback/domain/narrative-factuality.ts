import { createHash } from "node:crypto"
import { z } from "zod"
import type { EmittedItem } from "./reliable-feedback-artifact.js"
import type { NarrativeBrief, NarrativeDraft } from "./supervisor-narrative.js"

/**
 * FEEDBACK EXPERIENCE V2.1 — FATUALIDADE SEMÂNTICA DA NARRATIVA (`NARRATIVE_FACTUALITY_V1`).
 *
 *   `writer_claim ⊆ supported_meaning` — a paráfrase pode perder detalhe (resumir, generalizar, reorganizar); nunca ganhar detalhe
 *   factual: objeto, ação, canal, etapa, resultado, quantidade, completude, certeza, execução de algo só declarado, causa.
 *
 * Substitui as listas de termos/radicais que conferiam especificidade: quem decide se uma frase acrescentou SIGNIFICADO é uma
 * verificação semântica curta, UMA chamada, sobre as frases do redator de composição × os fatos DOS PONTOS a que cada frase se
 * refere (S-n/A-n) — nunca a chamada inteira de novo: o Trusted Assessment continua sendo a fonte factual e a transcrição só entra
 * pelas falas já verificadas do próprio ponto. Número, citação, falante, vínculo S/A, privacidade, efeito garantido e causa
 * continuam determinísticos (supervisor-narrative.ts).
 *
 * Resultado por frase: SUPPORTED | GENERALIZATION (aceitas) | UNSUPPORTED_ADDITION | CONTRADICTION | UNCERTAIN (recusadas).
 * Reparo ÚNICO, dentro da mesma chamada: a frase recusada pode voltar como a reescrita do verificador que só RETIRA o acréscimo — e
 * só se ela couber no que já existia (frase original + fatos daquela frase); senão a frase sai. Sem segunda verificação, sem laço.
 * Se o que sobra não passa no vínculo (ex.: o ajuste principal sumiu), a narrativa inteira do SISTEMA assume; card recusado →
 * card do sistema; falha da verificação → nada do redator é entregue.
 */
export const NARRATIVE_FACTUALITY_VERSION = "NARRATIVE_FACTUALITY_V1" as const
export const NARRATIVE_FACTUALITY_PROMPT_VERSION = "NARRATIVE_FACTUALITY_PROMPT_V1" as const
export const NARRATIVE_FACTUALITY_STATUSES = ["SUPPORTED", "GENERALIZATION", "UNSUPPORTED_ADDITION", "CONTRADICTION", "UNCERTAIN"] as const
export type NarrativeFactualityStatus = (typeof NARRATIVE_FACTUALITY_STATUSES)[number]
const ACCEPTED: ReadonlySet<NarrativeFactualityStatus> = new Set(["SUPPORTED", "GENERALIZATION"])
export const isAcceptedFactuality = (status: NarrativeFactualityStatus) => ACCEPTED.has(status)

/** Afirmação do redator levada à verificação: frase (F-n, na ordem) ou o card. `textSha256` amarra o veredito ao texto exato. */
export type FactualityClaim = { id: string; kind: "SENTENCE" | "CARD"; text: string; stance: string; refs: string[]; textSha256: string }
export type FactualityVerdict = { id: string; textSha256: string; status: NarrativeFactualityStatus; unsupportedMeaning: string | null; reason: string
  /** Frase recusada reescrita pelo verificador só RETIRANDO/generalizando o acréscimo (mesma postura e refs); null = sem reescrita. */
  supportedRewrite?: string | null }
export type StoredFactuality = {
  version: typeof NARRATIVE_FACTUALITY_VERSION
  promptVersion: string
  /** VERIFIED = um veredito para cada afirmação; ERROR = a verificação falhou (nada do redator é entregue). */
  status: "VERIFIED" | "ERROR"
  verdicts: FactualityVerdict[]
  error: string | null
  provenance?: unknown
}

const sha = (text: string) => createHash("sha256").update(text.trim()).digest("hex").slice(0, 16)

export function factualityClaimsOf(draft: NarrativeDraft): FactualityClaim[] {
  const sentences = (draft.sentences ?? []).map((sentence, index): FactualityClaim => ({ id: `F${index + 1}`, kind: "SENTENCE", text: sentence.text, stance: sentence.stance, refs: sentence.refs, textSha256: sha(sentence.text) }))
  const card = draft.card.trim().length > 0 ? [{ id: "CARD", kind: "CARD" as const, text: draft.card.trim(), stance: "CARD", refs: draft.cardRefs ?? [], textSha256: sha(draft.card) }] : []
  return [...sentences, ...card]
}

const MOMENT: Record<string, string> = { INVESTIGATION: "investigação do caso", TREATMENT: "tratativa", CLOSING: "encerramento", OTHER: "outro momento" }
const EVIDENCE: Record<string, string> = { OBSERVED_IN_CALL: "visto nas falas do colaborador", VERIFIED_ABSENCE: "não aconteceu em nenhum momento da chamada", NOT_OBSERVED: "não apareceu na chamada analisada" }
const ruleOf = (items: readonly EmittedItem[], indexes: readonly number[]) => [...new Set(items.filter((item) => indexes.includes(item.index)).flatMap((item) => [item.knowledge?.operativeRule?.quote ?? "", item.knowledge?.quote ?? ""]).map((text) => text.trim()).filter((text) => text.length > 0))]
const quotesOf = (items: readonly EmittedItem[], indexes: readonly number[], fallback: readonly string[] = []) => {
  const lines = items.filter((item) => indexes.includes(item.index)).flatMap((item) => item.facts.filter((fact) => fact.role === "OPERADOR" || fact.role === "CLIENTE").map((fact) => `${fact.role === "OPERADOR" ? "Operador" : "Cliente"}: ${fact.text}${fact.truncated ? "…" : ""}`))
  return [...new Set([...fallback, ...lines])].slice(0, 6)
}

/**
 * Os FATOS de cada ponto, na linguagem do assessment (nada novo): o que o sistema decidiu, se foi ação ou só declaração, as falas
 * verificadas, a regra aplicada, a orientação oficial e o contexto declarado pelo especialista. É tudo o que sustenta uma frase.
 */
export function factualityPayloadOf(draft: NarrativeDraft, brief: NarrativeBrief, items: readonly EmittedItem[]) {
  return {
    call: { subject: brief.about.subject, customerNeed: brief.interaction?.customerNeed ?? null, situation: brief.interaction?.situation ?? null, path: brief.interaction?.path ?? null },
    points: [
      ...brief.positives.map((positive, index) => ({
        ref: `S${index + 1}`,
        kind: "ACERTO",
        moment: MOMENT[positive.phase],
        whatTheSystemConcluded: positive.clause,
        executionEvidence: positive.claim === "DECLARED"
          ? "DECLARAÇÃO: a prova deste acerto é o que o colaborador DISSE ao cliente sobre a ação (veja as falas). A frase pode dizer que ele disse/informou isso, e pode dizer como feito o que as próprias falas mostram acontecendo na conversa; uma ação fora da conversa (em sistema ou registro) que só foi dita não pode ser afirmada como executada, e o que ele disse que VAI fazer nunca vira feito."
          : "AÇÃO observada nas falas do colaborador",
        context: positive.context ?? [],
        verifiedQuotes: quotesOf(items, positive.itemIndexes, positive.quotes ?? []),
        rule: ruleOf(items, positive.itemIndexes),
      })),
      ...brief.gaps.map((gap, index) => ({
        ref: `A${index + 1}`,
        kind: "AJUSTE",
        moment: MOMENT[gap.phase],
        topic: gap.topic,
        whatTheSystemConcluded: gap.happened,
        missingPoints: gap.missingPoints,
        evidence: EVIDENCE[gap.evidence],
        context: gap.context ?? [],
        verifiedQuotes: quotesOf(items, gap.itemIndexes, gap.quotes ?? []),
        rule: ruleOf(items, gap.itemIndexes),
        officialGuidance: gap.guidance,
      })),
    ],
    claims: factualityClaimsOf(draft).map((claim) => ({ id: claim.id, type: claim.kind === "CARD" ? "CARD" : claim.stance, refs: claim.refs, text: claim.text })),
  }
}
export type FactualityPayload = ReturnType<typeof factualityPayloadOf>

export const NARRATIVE_FACTUALITY_SYSTEM_PROMPT_V1 = `Você confere se as frases de um feedback de supervisor dizem apenas o que os fatos de uma avaliação de atendimento sustentam.

Você NÃO reavalia a chamada e NÃO julga estilo, tom ou clareza. Os fatos já foram decididos e verificados; você só compara o SIGNIFICADO de cada frase com o significado dos fatos dos pontos a que ela se refere.

ENTRADA
- "call": contexto da chamada (assunto, necessidade do cliente, situação, caminho), declarado pelo especialista.
- "points": os pontos da avaliação. S… = acerto; A… = ajuste. Cada ponto traz: o que o sistema concluiu, as falas verificadas da chamada, a regra do procedimento, a orientação oficial (ajustes), o contexto e — nos acertos — se houve AÇÃO observada ou só DECLARAÇÃO.
- "claims": as frases a conferir, cada uma com "refs" (os pontos de que fala) e "type":
  CONTEXT (situa a chamada), STRENGTH (reconhece um acerto), ADJUSTMENT (descreve um ajuste), GUIDANCE (orienta o que fazer na próxima), CARD (resumo curto).

A PERGUNTA, PARA CADA FRASE
O significado da frase está CONTIDO no significado dos fatos (dos pontos das suas refs + o contexto da chamada)? Uma paráfrase pode PERDER detalhe; nunca GANHAR detalhe.
- Pode: resumir, trocar palavras, generalizar para uma categoria mais ampla, juntar pontos, reordenar, falar como supervisor, qualificar a conduta de acordo com a natureza do ponto (acerto dito como acerto, ajuste dito como ajuste).
- Não pode acrescentar um significado que os fatos não têm, por exemplo: um objeto ou documento diferente do que aparece; uma ação diferente ou a mais; um canal, sistema ou lugar; uma etapa; um resultado ou desfecho; uma quantidade ou um grau de completude maior do que os fatos mostram; uma certeza maior; uma propriedade do objeto que não foi falada; execução de algo que foi só declarado ou prometido; uma causa ligando dois fatos.
- Troca de um termo por outro que NÃO é um nome mais geral dele (é outra coisa, ou é mais específico) é acréscimo, mesmo parecendo um detalhe.

ORIENTAÇÕES (GUIDANCE e o CARD de ação) falam do futuro: recomendar o que a regra ou a orientação oficial do ponto pede, ou uma versão mais geral disso, é sustentado. Mas a orientação também não pode pressupor objeto, etapa, canal ou resultado que nem os fatos da chamada nem a regra trazem.

Frase sem refs: compare com todos os pontos e o contexto.

CLASSIFICAÇÃO (uma por frase, na ordem)
- SUPPORTED: diz o que os fatos dizem, com outras palavras.
- GENERALIZATION: diz algo mais geral que os fatos, sem acrescentar nada.
- UNSUPPORTED_ADDITION: acrescenta algum significado que os fatos não têm.
- CONTRADICTION: afirma o contrário dos fatos (ex.: ajuste dito como feito, acerto dito como falha, só declarado dito como executado).
- UNCERTAIN: não dá para saber se os fatos sustentam.

SAÍDA: só JSON, {"claims":[{"id","status","unsupportedMeaning","reason","supportedRewrite"}]}, um item por frase recebida, mesmos ids, mesma ordem.
- "unsupportedMeaning": o significado acrescentado ou contrariado, em poucas palavras (null quando SUPPORTED/GENERALIZATION).
- "reason": uma frase curta dizendo o que os fatos sustentam.
- "supportedRewrite": só em UNSUPPORTED_ADDITION e CONTRADICTION — a MESMA frase, com o mesmo tom e a mesma função, apenas RETIRANDO o significado acrescentado ou trocando-o pelo que os fatos sustentam (ação só dita vira "informou/disse que…"). Nada novo; sem explicar a correção. null quando não houver frase sustentada possível e nas demais classificações.`

export const NARRATIVE_FACTUALITY_SYSTEM_PROMPTS: Record<string, string> = { [NARRATIVE_FACTUALITY_PROMPT_VERSION]: NARRATIVE_FACTUALITY_SYSTEM_PROMPT_V1 }
export const NARRATIVE_FACTUALITY_INPUT_CONTRACT = "NARRATIVE_FACTUALITY_INPUT_V1" as const
export const renderFactualityUserTurn = (payload: FactualityPayload) => `${NARRATIVE_FACTUALITY_INPUT_CONTRACT}:\n${JSON.stringify(payload, null, 2)}`

/** Saída estruturada enviada ao provedor (mesmas chaves do parser). */
export const NARRATIVE_FACTUALITY_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    claims: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { id: { type: "STRING" }, status: { type: "STRING", enum: [...NARRATIVE_FACTUALITY_STATUSES] }, unsupportedMeaning: { type: "STRING", nullable: true }, reason: { type: "STRING" }, supportedRewrite: { type: "STRING", nullable: true } },
        required: ["id", "status", "reason"],
        propertyOrdering: ["id", "status", "unsupportedMeaning", "reason", "supportedRewrite"],
      },
    },
  },
  required: ["claims"],
} as const

const responseSchema = z.object({ claims: z.array(z.object({ id: z.string(), status: z.enum(NARRATIVE_FACTUALITY_STATUSES), unsupportedMeaning: z.string().nullable().optional(), reason: z.string(), supportedRewrite: z.string().nullable().optional() }).strict()) }).strict()

/** Parse ESTRITO: exatamente um veredito por afirmação enviada (id conhecido, sem repetição). Qualquer desvio = verificação falhou. */
export function parseFactualityResponse(text: string, claims: readonly FactualityClaim[]): { ok: true; verdicts: FactualityVerdict[] } | { ok: false; error: string; detail: string | null } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: "FACTUALITY_MALFORMED_JSON", detail: error instanceof Error ? error.message : null }
  }
  const parsed = responseSchema.safeParse(json)
  if (!parsed.success) return { ok: false, error: "FACTUALITY_SCHEMA_INVALID", detail: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") }
  const byId = new Map(claims.map((claim) => [claim.id, claim]))
  const seen = new Set<string>()
  const verdicts: FactualityVerdict[] = []
  for (const entry of parsed.data.claims) {
    const claim = byId.get(entry.id)
    if (!claim) return { ok: false, error: "FACTUALITY_UNKNOWN_CLAIM", detail: entry.id }
    if (seen.has(entry.id)) return { ok: false, error: "FACTUALITY_DUPLICATE_CLAIM", detail: entry.id }
    seen.add(entry.id)
    const rewrite = entry.status === "UNSUPPORTED_ADDITION" || entry.status === "CONTRADICTION" ? entry.supportedRewrite?.trim() || null : null
    verdicts.push({ id: entry.id, textSha256: claim.textSha256, status: entry.status, unsupportedMeaning: isAcceptedFactuality(entry.status) ? null : entry.unsupportedMeaning?.trim() || null, reason: entry.reason.trim().slice(0, 400), supportedRewrite: rewrite && rewrite !== claim.text.trim() ? rewrite.slice(0, 500) : null })
  }
  const missing = claims.filter((claim) => !seen.has(claim.id)).map((claim) => claim.id)
  if (missing.length > 0) return { ok: false, error: "FACTUALITY_MISSING_CLAIM", detail: missing.join(",") }
  return { ok: true, verdicts }
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
const stemsOf = (text: string) => new Set((fold(text).match(/\p{L}{4,}/gu) ?? []).map((word) => word.slice(0, 5)))
/** Os textos que sustentam uma frase: os pontos das refs (sem refs, todos) + o contexto da chamada — o que o verificador viu. */
export function factualityGroundingOf(payload: FactualityPayload, refs: readonly string[]): string {
  const points = refs.length === 0 ? payload.points : payload.points.filter((point) => refs.includes(point.ref))
  return JSON.stringify({ call: payload.call, points })
}
/**
 * A reescrita do verificador só vale se ficou DENTRO do que já existia: toda palavra de conteúdo dela está na frase original ou nos
 * fatos que o verificador recebeu para aquela frase (contenção genérica — nenhuma lista de palavras). Senão, a frase sai.
 */
export function rewriteContained(rewrite: string, original: string, grounding: string): boolean {
  const allowed = new Set([...stemsOf(original), ...stemsOf(grounding)])
  return [...stemsOf(rewrite)].every((stem) => allowed.has(stem))
}

/**
 * Aplica o veredito ao rascunho (geração e emissão, função única): frases aceitas ficam; recusada com reescrita contida no que já
 * existia é trocada pela reescrita (reparo único, dentro da MESMA verificação — sem segunda chamada nem laço); as outras saem. O card
 * segue a mesma regra. O veredito vale só para o MESMO texto (hash) — rascunho sem veredito completo e válido não entrega nada do redator.
 */
export function applyFactuality(draft: NarrativeDraft, factuality: StoredFactuality | null | undefined, groundingOf?: (refs: readonly string[]) => string): { draft: NarrativeDraft; rejected: FactualityVerdict[]; repaired: FactualityVerdict[]; cardRejected: boolean; unverified: boolean } {
  const claims = factualityClaimsOf(draft)
  const byId = new Map((factuality?.status === "VERIFIED" ? factuality.verdicts : []).map((verdict) => [verdict.id, verdict]))
  const verdictOf = (claim: FactualityClaim) => {
    const verdict = byId.get(claim.id)
    return verdict && verdict.textSha256 === claim.textSha256 ? verdict : null
  }
  if (!factuality || factuality.status !== "VERIFIED" || claims.some((claim) => verdictOf(claim) === null)) return { draft: { ...draft, paragraphs: [], sentences: [], card: "", cardRefs: [] }, rejected: [], repaired: [], cardRejected: draft.card.trim().length > 0, unverified: true }
  const repairOf = (claim: FactualityClaim): string | null => {
    const verdict = verdictOf(claim)!
    if (isAcceptedFactuality(verdict.status) || !verdict.supportedRewrite || !groundingOf) return null
    return rewriteContained(verdict.supportedRewrite, claim.text, groundingOf(claim.refs)) ? verdict.supportedRewrite : null
  }
  const repaired: FactualityVerdict[] = []
  const rejected: FactualityVerdict[] = []
  const sentences = (draft.sentences ?? []).flatMap((sentence, index) => {
    const claim = claims[index]!
    const verdict = verdictOf(claim)!
    if (isAcceptedFactuality(verdict.status)) return [sentence]
    const rewrite = repairOf(claim)
    if (rewrite) {
      repaired.push(verdict)
      return [{ ...sentence, text: rewrite }]
    }
    rejected.push(verdict)
    return []
  })
  const cardClaim = claims.find((claim) => claim.kind === "CARD")
  const cardVerdict = cardClaim ? verdictOf(cardClaim)! : null
  const cardRewrite = cardClaim ? repairOf(cardClaim) : null
  const cardRejected = cardVerdict !== null && !isAcceptedFactuality(cardVerdict.status) && !cardRewrite
  if (cardVerdict && cardRewrite) repaired.push(cardVerdict)
  if (cardVerdict && cardRejected) rejected.push(cardVerdict)
  const paragraphs = [...new Set(sentences.map((sentence) => sentence.paragraph))].map((number) => sentences.filter((sentence) => sentence.paragraph === number).map((sentence) => sentence.text).join(" "))
  return {
    draft: { ...draft, paragraphs, sentences, ...(cardRejected ? { card: "", cardRefs: [] } : cardRewrite ? { card: cardRewrite } : {}) },
    rejected,
    repaired,
    cardRejected,
    unverified: false,
  }
}
