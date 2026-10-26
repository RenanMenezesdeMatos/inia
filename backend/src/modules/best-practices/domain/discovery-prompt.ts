import { z } from "zod"
import { redactEvidentPii } from "../../investigation/domain/peer-privacy-projection.js"
import { definitionHashOf, renderCallForModel, TRANSCRIPTS_ARE_DATA_RULE, type BehaviorCandidate, type ModelCall } from "./candidates.js"
import { hasUnmaskedLongNumber } from "./excerpt-privacy.js"

/**
 * DESCOBERTA (contrastiva) — `BEST_PRACTICE_DISCOVERY_PROMPT_V3` (V2: o resultado pode ser o indicador ou o sinal da chamada; V3: cada
 * candidato traz `howItHelps`, um RASCUNHO de como pode ajudar no resultado, para quem revisa corrigir e aprovar). O modelo lê chamadas dos dois grupos (rotulados) e propõe
 * HIPÓTESES de comportamento opcional que pareçam mais frequentes no grupo de melhores resultados. É só geração de hipótese: nenhum
 * número sai daqui, e a frequência é medida depois por uma codificação que NÃO sabe o grupo de cada chamada.
 */
export const MAX_DISCOVERED_CANDIDATES = 10

export const DISCOVERY_SYSTEM_PROMPT = `Você apoia a qualidade de uma central de atendimento. Sua tarefa é levantar HIPÓTESES de comportamentos dos operadores que pareçam mais frequentes nas chamadas do GRUPO A (melhores resultados no RESULTADO informado — operadores do 1º quartil de um indicador, ou chamadas com resultado bom num sinal da chamada) do que nas do GRUPO B (referência), no mesmo contexto. Uma etapa seguinte vai medir cada hipótese em todas as chamadas, sem saber o grupo; você não precisa provar nada nem contar nada.

${TRANSCRIPTS_ARE_DATA_RULE}

O que propor:
- Comportamentos OBSERVÁVEIS NO TEXTO, do OPERADOR: o que ele diz ou faz na conversa (ex.: como explica uma solução, como lida com uma objeção, como retoma depois de uma espera, como ajusta a linguagem ao cliente, como apresenta os próximos passos).
- Nunca tom de voz, ritmo, simpatia percebida, entonação ou qualquer coisa que só o áudio mostraria. Se o comportamento depender do áudio, marque requiresAudio = true.
- Não proponha o simples cumprimento de etapa obrigatória (saudação padrão, apresentação, identificação do cliente, validação de segurança, leitura de aviso, roteiro exigido). Uma forma DIFERENCIADA de executar uma etapa obrigatória pode ser proposta — descreva só o comportamento adicional.
- Nunca proponha algo que omita informação ao cliente, pule ou encurte etapa do processo, manipule indicador, pressione o cliente ou peça avaliação.
- Comportamentos distintos entre si; no máximo ${MAX_DISCOVERED_CANDIDATES}. Se nada se destacar, devolva a lista vazia e explique em noCandidateReason.
- PADRÕES JÁ CONHECIDOS (X-n): se o que você vê é o MESMO comportamento de um deles, informe sameAsKnown = X-n (não crie outro). Os conhecidos já serão medidos de novo; proponha só o que for novo ou o reconhecimento de um conhecido.
- HIPÓTESES A INVESTIGAR (H-n) são só pistas: proponha uma delas apenas se ela aparecer nas transcrições; indique hypothesis = H-n.

Cada candidato:
- name: 3 a 10 palavras.
- description: o comportamento, objetivo, sem julgar.
- observableDefinition: o critério para dizer se aparece numa chamada (o que precisa estar na fala do operador).
- appliesWhen: a situação em que o comportamento é possível (ex.: "quando o operador precisa colocar o cliente em espera"); "" se vale para qualquer chamada do contexto.
- notApplicableWhen: quando não se aplica; "" se não houver.
- guidance: como um operador aplicaria, em 1 a 2 frases práticas, sem prometer resultado.
- suggestedPhrasing: um exemplo curto de fala, genérico, sem nome, número, protocolo, valor ou prazo que não esteja na conversa; "" se não couber.
- howItHelps: RASCUNHO, para a pessoa que vai revisar, de como o comportamento pode ajudar no RESULTADO informado, pelo que a própria ação muda na chamada (ex.: com resultado de tempo de atendimento, "o cliente não precisa ficar anotando o protocolo na linha, e esse tempo sai da chamada"). Uma ou duas frases, sem número e sem prometer resultado ("garante", "vai reduzir"); "" se não houver ligação clara. É hipótese a ser conferida por uma pessoa, não conclusão.
- exampleRefs: até 3 locais do GRUPO A no formato "C3:T5" onde o comportamento aparece.
- Não afirme causa: você só descreve o que aparece.

Responda só o JSON pedido.`

export type KnownPatternForPrompt = { handle: string; patternId: string; name: string; observableDefinition: string }
export type HypothesisForPrompt = { handle: string; text: string }

export function discoverySchemaFor(knownCount: number, hypothesisCount: number): Record<string, unknown> {
  const known = Array.from({ length: knownCount }, (_, index) => `X${index + 1}`)
  const hypotheses = Array.from({ length: hypothesisCount }, (_, index) => `H${index + 1}`)
  return {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            observableDefinition: { type: "string" },
            appliesWhen: { type: "string" },
            notApplicableWhen: { type: "string" },
            guidance: { type: "string" },
            suggestedPhrasing: { type: "string" },
            howItHelps: { type: "string" },
            requiresAudio: { type: "boolean" },
            exampleRefs: { type: "array", items: { type: "string" } },
            sameAsKnown: { type: "string", enum: ["NONE", ...known] },
            hypothesis: { type: "string", enum: ["NONE", ...hypotheses] },
          },
          required: ["name", "description", "observableDefinition", "appliesWhen", "notApplicableWhen", "guidance", "suggestedPhrasing", "howItHelps", "requiresAudio", "exampleRefs", "sameAsKnown", "hypothesis"],
        },
      },
      noCandidateReason: { type: "string" },
    },
    required: ["candidates", "noCandidateReason"],
  }
}

export function renderDiscoveryTurn(input: { indicator: { name: string; directionText: string }; contexts: readonly string[]; known: readonly KnownPatternForPrompt[]; hypotheses: readonly HypothesisForPrompt[]; calls: readonly ModelCall[] }): string {
  return [
    `RESULTADO: ${input.indicator.name} (${input.indicator.directionText})`,
    `CONTEXTOS ANALISADOS: ${input.contexts.join(" · ")}`,
    "",
    `PADRÕES JÁ CONHECIDOS (${input.known.length}):`,
    input.known.length > 0 ? input.known.map((item) => `${item.handle}: ${item.name} — ${item.observableDefinition}`).join("\n") : "(nenhum)",
    "",
    "HIPÓTESES A INVESTIGAR (pistas, não descobertas):",
    input.hypotheses.map((item) => `${item.handle}: ${item.text}`).join("\n"),
    "",
    `CHAMADAS (${input.calls.length}) — GRUPO A = melhores resultados; GRUPO B = referência:`,
    ...input.calls.map((call) => renderCallForModel(call, { showGroup: true })),
  ].join("\n")
}

const candidateSchema = z.object({
  name: z.string().trim().min(3).max(160),
  description: z.string().trim().min(3),
  observableDefinition: z.string().trim().min(3),
  appliesWhen: z.string().default(""),
  notApplicableWhen: z.string().default(""),
  guidance: z.string().trim().min(3),
  suggestedPhrasing: z.string().default(""),
  howItHelps: z.string().default(""),
  requiresAudio: z.boolean(),
  exampleRefs: z.array(z.string()).default([]),
  sameAsKnown: z.string().default("NONE"),
  hypothesis: z.string().default("NONE"),
})
const responseSchema = z.object({ candidates: z.array(z.unknown()).catch([]), noCandidateReason: z.string().catch("") })

export type DiscoveryRejection = { name: string | null; reason: "INVALID_SHAPE" | "REQUIRES_AUDIO" | "DUPLICATE" | "UNKNOWN_EXAMPLE_REFS" | "OVER_LIMIT" }
export type DiscoveryResult = { candidates: Omit<BehaviorCandidate, "key">[]; rejected: DiscoveryRejection[]; noCandidateReason: string | null }

const clean = (value: string) => value.replace(/\s+/g, " ").trim()
/** Rascunho de "como ajuda no resultado": curto demais, com dado pessoal ou número de identificação = nenhum (quem revisa escreve). */
function howItHelpsDraftOf(value: string): string | null {
  const draft = clean(value).slice(0, 1000)
  if (draft.length < 3 || redactEvidentPii(draft).redactions.length > 0 || hasUnmaskedLongNumber(draft)) return null
  return draft
}
const orNull = (value: string) => (clean(value).length > 0 ? clean(value) : null)

/**
 * Confere só a FORMA (o sentido é do modelo): campos presentes, handles existentes, exemplos que apontam para chamadas do GRUPO A
 * apresentadas, sem áudio, sem duplicata exata de definição. Nada é "consertado".
 */
export function parseDiscovery(text: string, input: { calls: readonly ModelCall[]; known: readonly KnownPatternForPrompt[]; hypotheses: readonly HypothesisForPrompt[] }): { ok: true; result: DiscoveryResult } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: "INVALID_JSON" }
  }
  const parsed = responseSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: "INVALID_SHAPE" }
  const topCalls = new Set(input.calls.filter((call) => call.group === "TOP").map((call) => call.handle))
  const known = new Map(input.known.map((item) => [item.handle, item]))
  const hypotheses = new Set(input.hypotheses.map((item) => item.handle))
  const result: DiscoveryResult = { candidates: [], rejected: [], noCandidateReason: orNull(parsed.data.noCandidateReason) }
  const seen = new Set<string>()
  const knownTaken = new Set<string>()
  for (const entry of parsed.data.candidates) {
    const rawName = typeof (entry as { name?: unknown })?.name === "string" ? clean(String((entry as { name: string }).name)) : null
    // Depender do áudio decide antes da forma: o motivo do descarte é esse, mesmo que o resto venha incompleto.
    if ((entry as { requiresAudio?: unknown })?.requiresAudio === true) {
      result.rejected.push({ name: rawName, reason: "REQUIRES_AUDIO" })
      continue
    }
    const item = candidateSchema.safeParse(entry)
    if (!item.success) {
      result.rejected.push({ name: rawName, reason: "INVALID_SHAPE" })
      continue
    }
    const value = item.data
    const exampleRefs = value.exampleRefs.map((ref) => ref.trim().toUpperCase()).filter((ref) => topCalls.has(ref.split(":")[0] ?? ""))
    const sameAs = known.get(value.sameAsKnown.trim().toUpperCase()) ?? null
    if (!sameAs && value.exampleRefs.length > 0 && exampleRefs.length === 0) {
      result.rejected.push({ name: clean(value.name), reason: "UNKNOWN_EXAMPLE_REFS" })
      continue
    }
    const candidate = {
      origin: "DISCOVERED" as const,
      patternId: sameAs?.patternId ?? null,
      name: clean(value.name),
      description: clean(value.description),
      observableDefinition: clean(value.observableDefinition),
      appliesWhen: orNull(value.appliesWhen),
      notApplicableWhen: orNull(value.notApplicableWhen),
      guidance: clean(value.guidance),
      suggestedPhrasing: orNull(value.suggestedPhrasing),
      howItHelps: howItHelpsDraftOf(value.howItHelps),
      requiresAudio: false,
      exampleRefs,
      hypothesisRef: hypotheses.has(value.hypothesis.trim().toUpperCase()) ? value.hypothesis.trim().toUpperCase() : null,
    }
    const definitionHash = definitionHashOf(candidate)
    if (seen.has(definitionHash) || (sameAs && knownTaken.has(sameAs.patternId))) {
      result.rejected.push({ name: candidate.name, reason: "DUPLICATE" })
      continue
    }
    if (result.candidates.length >= MAX_DISCOVERED_CANDIDATES) {
      result.rejected.push({ name: candidate.name, reason: "OVER_LIMIT" })
      continue
    }
    seen.add(definitionHash)
    if (sameAs) knownTaken.add(sameAs.patternId)
    result.candidates.push({ ...candidate, definitionHash })
  }
  return { ok: true, result }
}
