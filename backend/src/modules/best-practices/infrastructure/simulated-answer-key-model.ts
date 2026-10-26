import { redactEvidentPii } from "../../investigation/domain/peer-privacy-projection.js"
import { projectTranscript, renderTranscriptForModel } from "../../investigation/domain/transcript-projection.js"
import { TRANSCRIPT_MAX_CHARS } from "../domain/candidates.js"
import type { SyntheticCorpus, SyntheticAnswerKey } from "../domain/synthetic-corpus.js"
import type { BestPracticeModelPort, BestPracticeModelRequest, BestPracticeModelResponse } from "../application/ports.js"

/**
 * MODELO SIMULADO (`SIMULATED_ANSWER_KEY`) — responde às três etapas a partir do GABARITO do dataset sintético, lendo o pedido
 * exatamente como o modelo real o receberia (handles C-n/B-n/K-n, transcrições renderizadas). Zero IA, zero custo: valida o
 * mecanismo (amostra, números, critérios, obrigação, gravação, revisão, recomendação), nunca a qualidade do modelo. Inclui de
 * propósito as respostas de um "modelo ingênuo" que o gabarito descreve (propor obrigação, obedecer à instrução injetada, propor algo
 * que exige áudio) para provar que o código barra. Só existe para dataset SINTÉTICO com gabarito; a rota recusa em produção.
 */
export const SIMULATED_MODEL_NAME = "SIMULATED_ANSWER_KEY"

const respond = (body: unknown): BestPracticeModelResponse => ({ text: JSON.stringify(body), model: SIMULATED_MODEL_NAME, inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 })
const norm = (text: string) => text.replace(/\s+/g, " ").trim()

export function createSimulatedAnswerKeyModel(corpus: SyntheticCorpus, answerKey: SyntheticAnswerKey): BestPracticeModelPort & { calls: BestPracticeModelRequest[] } {
  const behaviorByDefinition = new Map(answerKey.behaviors.map((behavior) => [norm(behavior.observableDefinition), behavior]))
  const callByRendered = new Map(corpus.calls.map((call) => [norm(renderTranscriptForModel(projectTranscript(redactEvidentPii(call.transcript).text, { maxChars: TRANSCRIPT_MAX_CHARS }))), call.ref]))
  const calls: BestPracticeModelRequest[] = []
  return {
    calls,
    async generate(request) {
      calls.push(request)
      const text = request.userText
      if (request.stage === "DISCOVERY") {
        const known = new Map<string, string>()
        for (const match of text.matchAll(/^(X\d+): .*? — (.*)$/gm)) known.set(norm(match[2]!), match[1]!)
        return respond({
          candidates: answerKey.behaviors.map((behavior) => ({ name: behavior.name, description: behavior.description, observableDefinition: behavior.observableDefinition, appliesWhen: behavior.appliesWhen, notApplicableWhen: behavior.notApplicableWhen, guidance: behavior.guidance, suggestedPhrasing: behavior.suggestedPhrasing, howItHelps: "", requiresAudio: behavior.requiresAudio, exampleRefs: [], sameAsKnown: known.get(norm(behavior.observableDefinition)) ?? "NONE", hypothesis: "NONE" })),
          noCandidateReason: "",
        })
      }
      if (request.stage === "CODING") {
        const behaviors = [...text.matchAll(/^(B\d+): .*\n {2}Aparece quando: (.*)$/gm)].map((match) => ({ handle: match[1]!, behavior: behaviorByDefinition.get(norm(match[2]!)) ?? null }))
        const blocks = [...text.matchAll(/<<<INICIO_TRANSCRICAO (C\d+)[^>]*>>>\n([\s\S]*?)\n<<<FIM_TRANSCRICAO \1>>>/g)].map((match) => ({ handle: match[1]!, body: match[2]! }))
        return respond({
          calls: blocks.map((block) => {
            const ref = callByRendered.get(norm(block.body))
            const truth = ref ? answerKey.calls[ref] : undefined
            const turns = block.body.split("\n")
            return {
              call: block.handle,
              codings: behaviors.map(({ handle, behavior }) => {
                if (!behavior || !truth) return { behavior: handle, status: "UNCLEAR", turn: "", quote: "" }
                const quote = truth.present[behavior.key]
                if (quote) {
                  const line = turns.find((item) => item.includes(quote))
                  return { behavior: handle, status: "PRESENT", turn: line ? (/^\[(T\d+)\]/.exec(line)?.[1] ?? "") : "", quote }
                }
                return { behavior: handle, status: truth.notApplicable.includes(behavior.key) ? "NOT_APPLICABLE" : "ABSENT", turn: "", quote: "" }
              }),
            }
          }),
        })
      }
      const readings = [...text.matchAll(/^(K\d+): .*\n {2}Definição: (.*)$/gm)].flatMap((match) => {
        const behavior = behaviorByDefinition.get(norm(match[2]!))
        return behavior ? [{ candidate: match[1]!, ...behavior.obligation }] : []
      })
      return respond({ readings })
    },
  }
}
