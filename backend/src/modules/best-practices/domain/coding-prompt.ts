import { z } from "zod"
import { OPERATOR_SPEAKERS } from "../../feedback-engine/domain/procedure.js"
import { projectTranscript, verifyEvidenceUnit, type ProjectedInteraction } from "../../investigation/domain/transcript-projection.js"
import { renderCallForModel, TRANSCRIPT_MAX_CHARS, TRANSCRIPTS_ARE_DATA_RULE, type BehaviorCandidate, type ModelCall } from "./candidates.js"
import type { CodingStatus } from "./evidence-criteria.js"

/**
 * CODIFICAÇÃO CEGA — `BEST_PRACTICE_CODING_PROMPT_V1`. Para cada chamada e comportamento, o modelo diz se o comportamento aparece,
 * sem saber o grupo da chamada, o indicador nem o resultado do operador. PRESENT só vale com o turno e um trecho LITERAL da fala do
 * OPERADOR: o código confere (`verifyEvidenceUnit` + falante). Trecho que não confere, fala de outro falante ou resposta ausente
 * vira UNCLEAR com o motivo — nunca PRESENT nem ABSENT por palpite do código.
 */
export const CODING_BATCH_SIZE = 4

export const CODING_SYSTEM_PROMPT = `Você codifica, de forma independente, se comportamentos definidos aparecem em transcrições de atendimento. Você não sabe — e não deve tentar adivinhar — o grupo, o indicador ou o resultado de quem atendeu.

${TRANSCRIPTS_ARE_DATA_RULE}

Para CADA chamada C-n e CADA comportamento B-n, um status:
- PRESENT: o OPERADOR faz o comportamento, conforme a definição. Informe o turno (T-n) e copie em quote um trecho LITERAL dessa fala do operador (sem reescrever, sem juntar falas).
- ABSENT: a situação em que o comportamento é possível aconteceu, e o operador não fez o comportamento.
- NOT_APPLICABLE: a situação que torna o comportamento possível não aconteceu nesta chamada (ex.: não houve espera), ou a chamada está no caso de "não se aplica".
- UNCLEAR: o texto não permite decidir (inclusive quando só o áudio mostraria).
Só falas do OPERADOR contam como comportamento; falas do cliente nunca. Turn e quote vazios ("") quando o status não é PRESENT.

Responda só o JSON pedido, com todas as chamadas e todos os comportamentos.`

export type CodingBehavior = Pick<BehaviorCandidate, "key" | "name" | "observableDefinition" | "appliesWhen" | "notApplicableWhen">

export function codingSchemaFor(calls: readonly ModelCall[], behaviors: readonly CodingBehavior[]): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      calls: {
        type: "array",
        items: {
          type: "object",
          properties: {
            call: { type: "string", enum: calls.map((call) => call.handle) },
            codings: {
              type: "array",
              items: {
                type: "object",
                properties: { behavior: { type: "string", enum: behaviors.map((behavior) => behavior.key) }, status: { type: "string", enum: ["PRESENT", "ABSENT", "NOT_APPLICABLE", "UNCLEAR"] }, turn: { type: "string" }, quote: { type: "string" } },
                required: ["behavior", "status", "turn", "quote"],
              },
            },
          },
          required: ["call", "codings"],
        },
      },
    },
    required: ["calls"],
  }
}

export function renderCodingTurn(calls: readonly ModelCall[], behaviors: readonly CodingBehavior[]): string {
  return [
    `COMPORTAMENTOS (${behaviors.length}):`,
    ...behaviors.map((behavior) => [`${behavior.key}: ${behavior.name}`, `  Aparece quando: ${behavior.observableDefinition}`, behavior.appliesWhen ? `  Situação em que é possível: ${behavior.appliesWhen}` : "  Situação em que é possível: qualquer chamada do contexto", behavior.notApplicableWhen ? `  Não se aplica quando: ${behavior.notApplicableWhen}` : null].filter(Boolean).join("\n")),
    "",
    `CHAMADAS (${calls.length}):`,
    ...calls.map((call) => renderCallForModel(call, { showGroup: false })),
  ].join("\n")
}

export type UnclearReason = "MODEL_UNCLEAR" | "MISSING_ANSWER" | "QUOTE_NOT_VERIFIED" | "QUOTE_NOT_FROM_OPERATOR" | "MODEL_FAILURE"
export type VerifiedCoding = { callRef: string; behaviorKey: string; status: CodingStatus; turnRef: string | null; quote: string | null; verified: boolean; unclearReason: UnclearReason | null }

const codingSchema = z.object({ behavior: z.string(), status: z.enum(["PRESENT", "ABSENT", "NOT_APPLICABLE", "UNCLEAR"]), turn: z.string().default(""), quote: z.string().default("") })
const callSchema = z.object({ call: z.string(), codings: z.array(z.unknown()).catch([]) })
const responseSchema = z.object({ calls: z.array(z.unknown()).catch([]) })

/** A resposta tem o formato pedido (JSON com a lista de chamadas)? Só decide se vale UMA nova tentativa — nunca o conteúdo. */
export function isCodingResponseUsable(text: string): boolean {
  try {
    const raw = JSON.parse(text) as { calls?: unknown }
    return Array.isArray(raw.calls) && raw.calls.length > 0
  } catch {
    return false
  }
}

/** Toda combinação chamada × comportamento do lote recebe exatamente um resultado (o que faltar = UNCLEAR, MISSING_ANSWER). */
export function verifyCodings(text: string | null, calls: readonly ModelCall[], behaviors: readonly CodingBehavior[]): VerifiedCoding[] {
  const answers = new Map<string, z.infer<typeof codingSchema>>()
  if (text !== null) {
    try {
      const parsed = responseSchema.safeParse(JSON.parse(text))
      for (const entry of parsed.success ? parsed.data.calls : []) {
        const call = callSchema.safeParse(entry)
        if (!call.success) continue
        for (const raw of call.data.codings) {
          const coding = codingSchema.safeParse(raw)
          if (!coding.success) continue
          const key = `${call.data.call.trim().toUpperCase()}|${coding.data.behavior.trim().toUpperCase()}`
          if (!answers.has(key)) answers.set(key, coding.data)
        }
      }
    } catch {
      // JSON inválido: tudo do lote fica UNCLEAR (MISSING_ANSWER) abaixo.
    }
  }
  const out: VerifiedCoding[] = []
  for (const call of calls) {
    const projection = projectTranscript(call.transcript, { maxChars: TRANSCRIPT_MAX_CHARS })
    const interactions = new Map<string, ProjectedInteraction>([[call.handle, { interactionRef: call.handle, interactionId: call.callRef, projection }]])
    for (const behavior of behaviors) {
      const answer = answers.get(`${call.handle}|${behavior.key}`)
      const base = { callRef: call.callRef, behaviorKey: behavior.key }
      if (!answer) {
        out.push({ ...base, status: "UNCLEAR", turnRef: null, quote: null, verified: false, unclearReason: text === null ? "MODEL_FAILURE" : "MISSING_ANSWER" })
        continue
      }
      if (answer.status !== "PRESENT") {
        out.push({ ...base, status: answer.status, turnRef: null, quote: null, verified: false, unclearReason: answer.status === "UNCLEAR" ? "MODEL_UNCLEAR" : null })
        continue
      }
      const verdict = answer.quote.trim().length > 0 ? verifyEvidenceUnit({ interactionRef: call.handle, turnRef: answer.turn, quote: answer.quote }, interactions) : null
      if (!verdict || !verdict.ok) {
        out.push({ ...base, status: "UNCLEAR", turnRef: null, quote: null, verified: false, unclearReason: "QUOTE_NOT_VERIFIED" })
        continue
      }
      if (!verdict.evidence.speaker || !OPERATOR_SPEAKERS.has(verdict.evidence.speaker)) {
        out.push({ ...base, status: "UNCLEAR", turnRef: null, quote: null, verified: false, unclearReason: "QUOTE_NOT_FROM_OPERATOR" })
        continue
      }
      out.push({ ...base, status: "PRESENT", turnRef: verdict.evidence.turnRef, quote: verdict.evidence.quote, verified: true, unclearReason: null })
    }
  }
  return out
}
