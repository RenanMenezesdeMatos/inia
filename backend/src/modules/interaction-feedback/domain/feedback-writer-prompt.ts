import { createHash } from "node:crypto"
import { z } from "zod"
import { EFFECT_CLAIM_MODE, FEEDBACK_WRITER_INPUT_CONTRACT, type FeedbackWriterInputV1 } from "../../investigation/domain/interaction-feedback-writer.js"
import { INTERNAL_REF_PATTERN } from "../../investigation/domain/interaction-feedback.js"

/**
 * V1.5.1 — PROMPT DE PRODUÇÃO DO FEEDBACK WRITER (congelado por versão + sha256).
 *
 * Prompt NOVO (não é o dos gates V1.4.9c/f): escrito a partir do contrato atual (FEEDBACK_WRITER_INPUT_V1, effectClaimMode
 * POTENTIAL_ONLY, constraints POTENTIAL_EFFECT_ONLY/REINFORCE_OBSERVED_ONLY) e sem exemplos tirados dos gates. O redator só
 * escreve os três textos de cada item; tudo o que é decisão (seção, dono, polaridade, escopo, readiness, revisão, entrega,
 * evidência, fonte da orientação) já vem decidido e nunca é devolvido por ele.
 *
 * Mudar QUALQUER byte do prompt, do schema de saída ou da configuração muda o fingerprint — o teste de freeze
 * (`feedback-writer-prompt[.vN].freeze.json`) falha até a versão ser incrementada e o freeze da nova versão gerado
 * (`npx tsx scripts/dev/freeze-feedback-writer-prompt.ts`). Assim cada feedback do piloto aponta para o Writer exato.
 */
/** V1 (V1.5.1) fica PRESERVADO byte a byte (e o seu freeze); o adapter usa a versão atual (V2, V1.5.3 — claim boundaries). */
export const FEEDBACK_WRITER_PROMPT_VERSIONS = ["FEEDBACK_WRITER_PROMPT_V1", "FEEDBACK_WRITER_PROMPT_V2"] as const
export type FeedbackWriterPromptVersion = (typeof FEEDBACK_WRITER_PROMPT_VERSIONS)[number]
export const FEEDBACK_WRITER_PROMPT_VERSION: FeedbackWriterPromptVersion = "FEEDBACK_WRITER_PROMPT_V2"
export const FEEDBACK_WRITER_OUTPUT_SCHEMA_VERSION = "FEEDBACK_WRITER_OUTPUT_V1" as const
export const FEEDBACK_WRITER_ADAPTER_VERSION = "GEMINI_FEEDBACK_WRITER_V1" as const

/** Configuração do piloto: modelo FIXO, sem roteamento, sem fallback de modelo, sem escalação, zero retry. */
export const FEEDBACK_WRITER_MODEL_CONFIG = {
  provider: "GEMINI",
  model: "gemini-3.1-flash-lite",
  responseMimeType: "application/json",
  timeoutMs: 30_000,
  retries: 0,
  modelFallback: false,
  escalation: false,
} as const

export const FEEDBACK_WRITER_SYSTEM_PROMPT_V1 = `Você escreve o texto de um feedback para um operador de atendimento sobre UMA única interação (uma conversa com um cliente).

A entrada já traz tudo decidido: quais itens existem, se cada um é ponto positivo (STRENGTH) ou ponto de desenvolvimento (OPPORTUNITY), o significado seguro de cada item, a fonte da orientação e a evidência exibível — trechos literais da conversa, com dados pessoais já mascarados (por exemplo [CPF], [TELEFONE], [PROTOCOLO]). Você não decide nem altera nada disso. Você só escreve três textos por item.

PARA CADA ITEM, escreva em português do Brasil, falando diretamente com o operador ("você"), em tom respeitoso, claro e sem jargão:
- observed: o que aconteceu nesta interação, fiel ao significado seguro e à evidência do item;
- whyItMatters: por que isso é relevante para o atendimento, como possibilidade de efeito;
- whatYouCanDo: o que o operador pode fazer em conversas parecidas.

ESCOPO
1. Fale somente desta interação. Nunca trate o item como padrão, hábito, tendência ou característica do operador; não use "costuma", "sempre", "frequentemente", "geralmente" nem "tende a".
2. Não diagnostique intenção, motivação, esforço ou estado emocional do operador.
3. Não afirme causa nem consequência que a evidência não mostra.

EFEITO — somente potencial
4. Benefício ou impacto para o cliente aparece só como possibilidade: "pode ajudar", "contribui para", "pode facilitar", "pode evitar".
5. Nunca afirme como ocorrido ou garantido um estado do cliente que a evidência não mostra: não use "garante que", "assegura que", "fez com que" ou "resultou em" para dizer que o cliente entendeu, recebeu, ficou satisfeito, ficou tranquilo ou teve o problema resolvido.

PONTO POSITIVO — reforce somente o que foi observado
6. Reforce exatamente o comportamento que aparece na evidência, com o mesmo alcance. Não o transforme em outro comportamento: resumir não é confirmar que o cliente entendeu; enviar ou informar não é o cliente ter recebido; informar não é o cliente ter ficado satisfeito; ser objetivo não é ter resolvido o problema.
7. Não acrescente elogios ou qualidades que o significado seguro e a evidência não sustentam.

PONTO DE DESENVOLVIMENTO
8. Descreva o ponto sem acusação e sem linguagem disciplinar (advertência, punição, penalidade, infração, falha grave).
9. Quando a fonte da orientação for COACHING_SUGGESTION, whatYouCanDo é uma sugestão prática ("você pode...", "uma alternativa é..."), nunca uma obrigação.
10. Não invente canal oficial, obrigação, política, procedimento, requisito, regra de segurança ou risco que o item não traga. Linguagem normativa ("deve", "é obrigatório", "é proibido") só quando o item trouxer uma regra da base, e somente sobre o texto dessa regra.

FATOS
11. Não escreva número, valor, prazo, data ou meta que não esteja na evidência ou na regra do item.
12. Não afirme que algo foi executado, registrado ou alterado em sistema além do que a evidência mostra literalmente.
13. Se citar a evidência entre aspas, copie o trecho exatamente como está; nunca reconstrua um dado mascarado.
14. Mantenha o sentido do item: ponto positivo continua positivo; ponto de desenvolvimento continua de desenvolvimento.

FORMA
15. Não mencione IA, INIA, sistema de análise, nem que algo foi "detectado" ou "identificado automaticamente".
16. Não mencione nomes de campos, códigos ou valores técnicos da entrada (itemRef, STRENGTH, OPPORTUNITY, COACHING_SUGGESTION e similares).
17. Cada texto tem de uma a três frases curtas.

SAÍDA
Responda SOMENTE com um objeto JSON, sem texto antes ou depois e sem markdown, neste formato:
{"items":[{"itemRef":"<itemRef do item>","observed":"...","whyItMatters":"...","whatYouCanDo":"..."}]}
- exatamente um objeto por item recebido, na mesma ordem da entrada;
- em itemRef, copie exatamente o itemRef do item;
- nenhum campo além de itemRef, observed, whyItMatters e whatYouCanDo; nenhum resumo geral.`

/**
 * V1.5.3 — PROMPT V2 (claim boundaries vistas no smoke de produção V1.5.2): NO_CAUSAL_UPGRADE (sequência ≠ causa),
 * DECLARED_ACTION_ONLY (ação dita ≠ ação executada; actionClaimMode vem da estrutura), efeito POTENTIAL_ONLY reforçado
 * (compreensão/alinhamento nunca confirmados sem o cliente) e REINFORCE_OBSERVED_ONLY. Regras gerais — nenhum texto do
 * smoke ou dos gates é usado como exemplo.
 */
export const FEEDBACK_WRITER_SYSTEM_PROMPT_V2 = `Você escreve o texto de um feedback para um operador de atendimento sobre UMA única interação (uma conversa com um cliente).

A entrada já traz tudo decidido: quais itens existem, se cada um é ponto positivo (STRENGTH) ou ponto de desenvolvimento (OPPORTUNITY), o significado seguro de cada item, a fonte da orientação, o modo de afirmação de ações (actionClaimMode) e a evidência exibível — trechos literais da conversa, com dados pessoais já mascarados (por exemplo [CPF], [TELEFONE], [PROTOCOLO]). Você não decide nem altera nada disso. Você só escreve três textos por item.

PARA CADA ITEM, escreva em português do Brasil, falando diretamente com o operador ("você"), em tom respeitoso, claro e sem jargão:
- observed: o que aconteceu nesta interação, fiel ao significado seguro e à evidência do item;
- whyItMatters: por que isso é relevante para o atendimento, como possibilidade de efeito;
- whatYouCanDo: o que o operador pode fazer em conversas parecidas.

ESCOPO
1. Fale somente desta interação. Nunca trate o item como padrão, hábito, tendência ou característica do operador; não use "costuma", "sempre", "frequentemente", "geralmente" nem "tende a".
2. Não diagnostique intenção, motivação, esforço ou estado emocional do operador.
3. Sequência não é causa. Quando o operador disse algo e, depois, o cliente reagiu, descreva as duas coisas lado a lado: o que foi dito e o que o cliente respondeu. Não escreva que uma coisa levou, fez, provocou, gerou, causou ou resultou na outra, a menos que a própria evidência diga isso explicitamente.

AÇÕES DO OPERADOR — somente como declaração
4. A análise é sobre o que foi dito na conversa; nenhum sistema foi verificado. Quando o item tiver actionClaimMode DECLARED_ONLY, toda ação que o operador diz ter feito (enviar, disparar, registrar, alterar, remover, aplicar, cancelar, bloquear e similares) é uma declaração dele: escreva que ele informou, declarou ou comunicou que fez a ação. Nunca escreva a ação como executada, realizada ou concluída.
5. Em ponto positivo com ação declarada, reforce o comportamento de conversa que a evidência mostra — comunicar, informar, explicar, resumir, orientar, declarar o encaminhamento —, não a execução da ação.

EFEITO — somente potencial
6. Benefício ou impacto para o cliente aparece só como possibilidade: "pode ajudar", "contribui para", "pode facilitar", "pode evitar".
7. Nunca afirme como ocorrido ou garantido um estado do cliente que a evidência não mostra: não use "garante que", "assegura que", "fez com que" ou "resultou em" para dizer que o cliente entendeu, recebeu, ficou satisfeito, ficou tranquilo ou teve o problema resolvido.
8. Não afirme que a compreensão, o entendimento ou o alinhamento do cliente foram confirmados, assegurados ou garantidos se a evidência não traz o próprio cliente confirmando. Prefira formulações como "pode ajudar a tornar as condições mais claras", "pode facilitar a compreensão" ou "ajuda a apresentar os principais pontos antes de prosseguir".

PONTO POSITIVO — reforce somente o que foi observado
9. Reforce exatamente o comportamento que aparece na evidência, com o mesmo alcance. Não o transforme em outro comportamento: resumir não é confirmar que o cliente entendeu; enviar ou informar não é o cliente ter recebido; informar não é o cliente ter ficado satisfeito; ser objetivo não é ter resolvido o problema.
10. Não acrescente elogios ou qualidades que o significado seguro e a evidência não sustentam.

PONTO DE DESENVOLVIMENTO
11. Descreva o ponto sem acusação e sem linguagem disciplinar (advertência, punição, penalidade, infração, falha grave).
12. Quando a fonte da orientação for COACHING_SUGGESTION, whatYouCanDo é uma sugestão prática ("você pode...", "uma alternativa é..."), nunca uma obrigação.
13. Não invente canal oficial, obrigação, política, procedimento, requisito, regra de segurança ou risco que o item não traga. Linguagem normativa ("deve", "é obrigatório", "é proibido") só quando o item trouxer uma regra da base, e somente sobre o texto dessa regra.

FATOS
14. Não escreva número, valor, prazo, data ou meta que não esteja na evidência ou na regra do item.
15. Não acrescente finalidade, consequência ou detalhe do caso que a evidência não traga.
16. Se citar a evidência entre aspas, copie o trecho exatamente como está; nunca reconstrua um dado mascarado.
17. Mantenha o sentido do item: ponto positivo continua positivo; ponto de desenvolvimento continua de desenvolvimento.

FORMA
18. Não mencione IA, INIA, sistema de análise, nem que algo foi "detectado" ou "identificado automaticamente".
19. Não mencione nomes de campos, códigos ou valores técnicos da entrada (itemRef, actionClaimMode, DECLARED_ONLY, STRENGTH, OPPORTUNITY, COACHING_SUGGESTION e similares).
20. Cada texto tem de uma a três frases curtas.

SAÍDA
Responda SOMENTE com um objeto JSON, sem texto antes ou depois e sem markdown, neste formato:
{"items":[{"itemRef":"<itemRef do item>","observed":"...","whyItMatters":"...","whatYouCanDo":"..."}]}
- exatamente um objeto por item recebido, na mesma ordem da entrada;
- em itemRef, copie exatamente o itemRef do item;
- nenhum campo além de itemRef, observed, whyItMatters e whatYouCanDo; nenhum resumo geral.`

export const FEEDBACK_WRITER_SYSTEM_PROMPTS: Record<FeedbackWriterPromptVersion, string> = { FEEDBACK_WRITER_PROMPT_V1: FEEDBACK_WRITER_SYSTEM_PROMPT_V1, FEEDBACK_WRITER_PROMPT_V2: FEEDBACK_WRITER_SYSTEM_PROMPT_V2 }
/** Prompt ATUAL do adapter. */
export const FEEDBACK_WRITER_SYSTEM_PROMPT = FEEDBACK_WRITER_SYSTEM_PROMPTS[FEEDBACK_WRITER_PROMPT_VERSION]

// ---------------------------------------------------------------------------------------------
// ENTRADA DO MODELO — projeção do FeedbackWriterInput V1 (lista BRANCA de campos)
// ---------------------------------------------------------------------------------------------

/**
 * O que o modelo vê: só campos da lista branca. `itemRef` = o `slot` genérico do WriterInput ("ITEM_n"); nenhum outro
 * identificador existe no payload. A privacidade NÃO é refeita aqui — a evidência já chega pela projeção de display
 * (redaction canônica + fail-closed); esta projeção só garante a FORMA (defesa estrutural).
 */
export type WriterModelItem = {
  itemRef: string
  section: "STRENGTH" | "OPPORTUNITY"
  kind: string
  polarity: string
  scope: "INTERACTION_SPECIFIC"
  safeMeaning: string
  guidanceSource: string
  guidanceMandatory: boolean
  knowledge: { documentTitle: string; ruleText: string | null } | null
  evidence: { speaker: string | null; text: string; truncated: boolean; masked: boolean }[]
  evidenceWithheldCount: number
  actionClaimMode: string
}
export type WriterModelPayload = {
  contract: typeof FEEDBACK_WRITER_INPUT_CONTRACT
  effectClaimMode: typeof EFFECT_CLAIM_MODE
  interactionLabel: string
  uncertainty: string
  constraints: { code: string; text: string }[]
  items: WriterModelItem[]
}

export function projectWriterInputForModel(input: FeedbackWriterInputV1): WriterModelPayload {
  return {
    contract: input.contract,
    effectClaimMode: input.effectClaimMode,
    interactionLabel: input.interactionLabel,
    uncertainty: input.uncertainty,
    constraints: input.constraints.map((constraint) => ({ code: constraint.code, text: constraint.text })),
    items: input.items.map((item) => ({
      itemRef: item.slot,
      section: item.section,
      kind: item.interpretation.kind,
      polarity: item.interpretation.polarity,
      scope: item.interpretation.scope,
      safeMeaning: item.interpretation.safeMeaning,
      guidanceSource: item.guidance.source,
      guidanceMandatory: item.guidance.mandatory,
      knowledge: item.guidance.knowledge ? { documentTitle: item.guidance.knowledge.documentTitle, ruleText: item.guidance.knowledge.ruleText } : null,
      evidence: item.evidence.map((entry) => ({ speaker: entry.speaker, text: entry.text, truncated: entry.truncated, masked: entry.wasRedacted })),
      evidenceWithheldCount: item.evidenceWithheld,
      actionClaimMode: item.actionClaimMode,
    })),
  }
}

const ITEM_REF = /^ITEM_\d+$/
const ALLOWED_KEYS: Record<string, readonly string[]> = {
  payload: ["contract", "effectClaimMode", "interactionLabel", "uncertainty", "constraints", "items"],
  constraint: ["code", "text"],
  item: ["itemRef", "section", "kind", "polarity", "scope", "safeMeaning", "guidanceSource", "guidanceMandatory", "knowledge", "evidence", "evidenceWithheldCount", "actionClaimMode"],
  knowledge: ["documentTitle", "ruleText"],
  evidence: ["speaker", "text", "truncated", "masked"],
}
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i
const LINK = /https?:\/\/|\bwww\./i

export class WriterPayloadViolation extends Error {
  constructor(readonly reason: string) {
    super(`FeedbackWriter payload recusado: ${reason}`)
    this.name = "WRITER_PAYLOAD_VIOLATION"
  }
}

/**
 * DEFESA ESTRUTURAL do payload (antes de qualquer rede): só chaves da lista branca, itemRef genérico, nenhum UUID, nenhum
 * link, nenhuma ref interna fora da evidência literal. Não é privacidade (essa já aconteceu na projeção de display) —
 * é a garantia de que raw/provenance/handles/links/dados de pares não têm por onde entrar.
 */
export function assertWriterPayloadSafe(payload: WriterModelPayload): void {
  const keysOk = (value: object, kind: string) => {
    const extra = Object.keys(value).filter((key) => !ALLOWED_KEYS[kind]!.includes(key))
    if (extra.length > 0) throw new WriterPayloadViolation(`campo não permitido em ${kind}: ${extra.join(", ")}`)
  }
  keysOk(payload, "payload")
  payload.constraints.forEach((constraint) => keysOk(constraint, "constraint"))
  const seen = new Set<string>()
  payload.items.forEach((item, index) => {
    keysOk(item, "item")
    if (!ITEM_REF.test(item.itemRef) || item.itemRef !== `ITEM_${index + 1}`) throw new WriterPayloadViolation(`itemRef inválido: ${item.itemRef}`)
    if (seen.has(item.itemRef)) throw new WriterPayloadViolation(`itemRef duplicado: ${item.itemRef}`)
    seen.add(item.itemRef)
    if (item.knowledge) keysOk(item.knowledge, "knowledge")
    item.evidence.forEach((entry) => keysOk(entry, "evidence"))
    for (const text of [item.safeMeaning, item.knowledge?.documentTitle ?? "", item.knowledge?.ruleText ?? ""]) if (INTERNAL_REF_PATTERN.test(text)) throw new WriterPayloadViolation("ref interna fora da evidência")
  })
  if (INTERNAL_REF_PATTERN.test(payload.interactionLabel)) throw new WriterPayloadViolation("ref interna no rótulo")
  const serialized = JSON.stringify(payload)
  if (UUID.test(serialized)) throw new WriterPayloadViolation("identificador técnico (UUID)")
  // Link da KB (rota canônica) nunca vai ao redator; fora da evidência literal, nenhum link.
  if (/\/materiais\//i.test(serialized)) throw new WriterPayloadViolation("link da base")
  const nonEvidence = JSON.stringify({ ...payload, items: payload.items.map((item) => ({ ...item, evidence: [] })) })
  if (LINK.test(nonEvidence)) throw new WriterPayloadViolation("link")
}

export function renderWriterUserTurn(payload: WriterModelPayload): string {
  return `${FEEDBACK_WRITER_INPUT_CONTRACT}:\n${JSON.stringify(payload, null, 2)}`
}

// ---------------------------------------------------------------------------------------------
// SAÍDA — schema estrito por item; identidade/ordem conferidas contra a entrada
// ---------------------------------------------------------------------------------------------

const wordingText = z.string().trim().min(1).max(600)
export const writerModelItemSchema = z.object({ itemRef: z.string(), observed: wordingText, whyItMatters: wordingText, whatYouCanDo: wordingText }).strict()
export const writerModelOutputSchema = z.object({ items: z.array(z.unknown()) }).strict()

export const WRITER_OUTPUT_ERRORS = ["WRITER_MALFORMED_JSON", "WRITER_SCHEMA_INVALID", "WRITER_MISSING_ITEM", "WRITER_EXTRA_ITEM", "WRITER_DUPLICATE_ITEM", "WRITER_ITEM_ORDER_MISMATCH"] as const
export type WriterOutputError = (typeof WRITER_OUTPUT_ERRORS)[number]

/** Saída do adapter para o pipeline: o formato que `resolveFeedbackWording` já consome (itemRef → slot). */
/** V1.7.1a — `suggestedResponse` só existe quando o schema do redator o declara (feedback confiável, monitoria V4). */
export type WriterPipelineOutput = { items: { slot: string; observed: string; whyItMatters: string; whatYouCanDo: string; suggestedResponse?: string }[]; presentation?: { introduction: string; closing: string } }
/** V1.7.1b — envelope do feedback confiável: `presentation` (abertura/fechamento) opcional, só quando o redator o declara. */
export type WriterPresentationSchema = z.ZodType<{ introduction: string; closing: string }>

/**
 * Parse ESTRITO da resposta: JSON puro (sem parser leniente, sem extrair de markdown); campo extra → SCHEMA_INVALID; item
 * ausente/extra/duplicado → erro próprio; ordem diferente da entrada → ORDER_MISMATCH. Qualquer erro invalida a resposta
 * INTEIRA — o pipeline decide o fallback. A validação de LINGUAGEM (efeito garantido, padrão, polaridade…) continua no
 * pipeline (`resolveFeedbackWording`), por item.
 */
/** Schema de UM item da resposta: por padrão o do Writer V2 (três textos obrigatórios); o feedback confiável V2 (V1.6.0)
 * injeta o dele (relevância e orientação opcionais, normalizadas para ""). Envelope, identidade e ordem são os mesmos. */
export type WriterItemSchema = z.ZodType<{ itemRef: string; observed: string; whyItMatters: string; whatYouCanDo: string; suggestedResponse?: string }>

/** V1.7.1d — caminhos das violações (sem conteúdo), para o diagnóstico da resposta rejeitada. */
function issuePaths(issues: readonly { path: readonly PropertyKey[]; code: string }[], prefix: string): string {
  return issues.slice(0, 10).map((issue) => `${[prefix, ...issue.path.map(String)].filter(Boolean).join(".") || "$"}:${issue.code}`).join("; ")
}

export function parseWriterResponse(text: string, expectedRefs: readonly string[], itemSchema: WriterItemSchema = writerModelItemSchema, presentationSchema: WriterPresentationSchema | null = null): { ok: true; output: WriterPipelineOutput } | { ok: false; error: WriterOutputError; detail: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: "WRITER_MALFORMED_JSON", detail: "resposta não é JSON" }
  }
  const envelope = (presentationSchema ? writerModelOutputSchema.extend({ presentation: z.unknown().optional() }) : writerModelOutputSchema).safeParse(parsed)
  if (!envelope.success) return { ok: false, error: "WRITER_SCHEMA_INVALID", detail: `envelope diferente de {items:[...]} (${issuePaths(envelope.error.issues, "")})` }
  const items: { itemRef: string; observed: string; whyItMatters: string; whatYouCanDo: string; suggestedResponse?: string }[] = []
  for (const entry of envelope.data.items) {
    const item = itemSchema.safeParse(entry)
    if (!item.success) return { ok: false, error: "WRITER_SCHEMA_INVALID", detail: `item fora do schema: ${item.error.issues.map((issue) => issue.code).join(",")} (${issuePaths(item.error.issues, `items.${envelope.data.items.indexOf(entry)}`)})` }
    items.push(item.data)
  }
  const refs = items.map((item) => item.itemRef)
  const duplicate = refs.find((ref, index) => refs.indexOf(ref) !== index)
  if (duplicate) return { ok: false, error: "WRITER_DUPLICATE_ITEM", detail: duplicate }
  const extra = refs.filter((ref) => !expectedRefs.includes(ref))
  if (extra.length > 0) return { ok: false, error: "WRITER_EXTRA_ITEM", detail: extra.join(",") }
  const missing = expectedRefs.filter((ref) => !refs.includes(ref))
  if (missing.length > 0) return { ok: false, error: "WRITER_MISSING_ITEM", detail: missing.join(",") }
  if (refs.some((ref, index) => ref !== expectedRefs[index])) return { ok: false, error: "WRITER_ITEM_ORDER_MISMATCH", detail: refs.join(",") }
  // Apresentação malformada NÃO invalida os itens: fica ausente (o sistema monta a abertura/fechamento).
  const presentation = presentationSchema ? presentationSchema.safeParse((envelope.data as { presentation?: unknown }).presentation) : null
  return { ok: true, output: { items: items.map((item) => ({ slot: item.itemRef, observed: item.observed, whyItMatters: item.whyItMatters, whatYouCanDo: item.whatYouCanDo, ...(typeof item.suggestedResponse === "string" ? { suggestedResponse: item.suggestedResponse } : {}) })), ...(presentation?.success ? { presentation: presentation.data } : {}) } }
}

// ---------------------------------------------------------------------------------------------
// FREEZE / FINGERPRINT
// ---------------------------------------------------------------------------------------------

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

/** Descrição canônica do schema de saída (entra no fingerprint). */
export const FEEDBACK_WRITER_OUTPUT_SCHEMA_DESCRIPTION = { version: FEEDBACK_WRITER_OUTPUT_SCHEMA_VERSION, envelope: { items: "array (strict)" }, item: { itemRef: "string = itemRef recebido", observed: "string 1..600", whyItMatters: "string 1..600", whatYouCanDo: "string 1..600" }, strict: true, identity: "mesmo conjunto e mesma ordem de itemRef da entrada" } as const

/** Arquivo de freeze por versão (V1 mantém o nome histórico da V1.5.1). */
export function feedbackWriterFreezeFile(version: FeedbackWriterPromptVersion): string {
  return version === "FEEDBACK_WRITER_PROMPT_V1" ? "feedback-writer-prompt.freeze.json" : `feedback-writer-prompt.${version.replace("FEEDBACK_WRITER_PROMPT_", "").toLowerCase()}.freeze.json`
}

export function feedbackWriterFingerprint(promptVersion: FeedbackWriterPromptVersion = FEEDBACK_WRITER_PROMPT_VERSION) {
  const promptSha256 = sha256(FEEDBACK_WRITER_SYSTEM_PROMPTS[promptVersion])
  const schemaSha256 = sha256(JSON.stringify(FEEDBACK_WRITER_OUTPUT_SCHEMA_DESCRIPTION))
  const configSha256 = sha256(JSON.stringify(FEEDBACK_WRITER_MODEL_CONFIG))
  return {
    adapterVersion: FEEDBACK_WRITER_ADAPTER_VERSION,
    promptVersion,
    promptSha256,
    schemaVersion: FEEDBACK_WRITER_OUTPUT_SCHEMA_VERSION,
    schemaSha256,
    contractVersion: FEEDBACK_WRITER_INPUT_CONTRACT,
    effectClaimMode: EFFECT_CLAIM_MODE,
    model: FEEDBACK_WRITER_MODEL_CONFIG.model,
    config: FEEDBACK_WRITER_MODEL_CONFIG,
    configSha256,
    writerSha256: sha256(`${promptSha256}|${schemaSha256}|${configSha256}|${FEEDBACK_WRITER_INPUT_CONTRACT}|${EFFECT_CLAIM_MODE}`),
  }
}
