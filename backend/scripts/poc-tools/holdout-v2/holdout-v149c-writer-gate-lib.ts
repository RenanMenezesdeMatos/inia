/**
 * V1.4.9c — FEEDBACK WRITER GATE (lib). Testa SÓ a redação final do InteractionFeedback V1 sobre itens DEV já validados
 * estruturalmente. Zero H2, gabarito não usado, nada procedimental (bloqueado por política).
 *
 * O modelo recebe SOMENTE o FeedbackWriterInput V1 que `src/` já monta (sem alteração) e pode preencher SÓ
 * observed / whyItMatters / whatYouCanDo por slot. Validação e fallback = `resolveFeedbackWording` de `src/` (sem mudança).
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { FeedbackWriterInputV1, WriterItem } from "../../../src/modules/investigation/domain/interaction-feedback-writer.js"
import { buildFeedbackWriterInput } from "../../../src/modules/investigation/domain/interaction-feedback-writer.js"
import { composeInteractionFeedback, interactionDisplayLabel } from "../../../src/modules/investigation/domain/interaction-feedback.js"
import { replaySemantic } from "./holdout-v149-replay-lib.js"
import { replayProceduralLineage } from "./holdout-v149b-procedural-lineage-lib.js"
import { DEV_BASE } from "./holdout-v149b-writer-fixtures-lib.js"

export const WRITER_GATE_VERSION = "V1.4.9c-FEEDBACK_WRITER_GATE"
export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex")

/**
 * SELEÇÃO (curada pelo assistente sobre o pool DEV de itens entregáveis — 55 interações, 59 itens; nada procedimental,
 * neutro ou incerteza chega ao pool por construção). Cobertura: STRENGTH comportamental, FRICTION/CONTRADICTION/
 * UNRESOLVED_NEED com dono AGENT, evidência com redaction, evidência retida (inclusive item sem nenhum trecho).
 * Evitados: trechos repetidos entre repetições do mesmo transcript (ex.: "HLR" aparece em 3 itens → nenhum entra).
 * A razão da escolha NUNCA vai ao pacote humano.
 */
export const WRITER_GATE_SELECTION = [
  { rep: "dev-runs-rep1", runKey: "S3-2026-02-i1", interactionRef: "I7" },
  { rep: "dev-runs-rep3", runKey: "S5-Q-i1", interactionRef: "I5" },
  { rep: "dev-runs-rep2", runKey: "S6-2026-03-i1", interactionRef: "I4" },
  { rep: "dev-runs-rep1", runKey: "SI3-HV2-INT-OP-0007-012-i1", interactionRef: "I1" },
  { rep: "dev-runs-rep1", runKey: "S1-Q-i1", interactionRef: "I15" },
  { rep: "dev-runs-rep3", runKey: "S3-2026-02-i1", interactionRef: "I5" },
  { rep: "dev-runs-rep3", runKey: "S5-Q-i1", interactionRef: "I6" },
  { rep: "dev-runs-rep1", runKey: "S1-Q-i1", interactionRef: "I5" },
  { rep: "dev-runs-rep2", runKey: "S4-2026-02-i1", interactionRef: "I9" },
  { rep: "dev-runs-rep2", runKey: "S6-2026-03-i1", interactionRef: "I10" },
  { rep: "dev-runs-rep2", runKey: "S1-Q-i1", interactionRef: "I5" },
  { rep: "dev-runs-rep1", runKey: "S1-Q-i1", interactionRef: "I20" },
] as const

/**
 * Rótulo exibível: data local da interação + assunto SÓ quando o assunto gravado é texto natural. Assunto bruto em formato
 * de código (`segunda_via`) não é texto de tela — em produção vem o nome canônico do assunto, que o replay não tem.
 */
export function gateLabel(localDate: string, rawSubject: string): string {
  const subject = /[_]/.test(rawSubject) || !/\s/.test(rawSubject.trim()) ? null : rawSubject.trim()
  return interactionDisplayLabel({ localDate, subject })
}

export type GateRequest = { requestId: string; source: { rep: string; runKey: string; interactionRef: string }; writerInput: FeedbackWriterInputV1; itemSlots: string[]; systemPrompt: string; input: string; systemPromptSha256: string; inputSha256: string }

export function buildGateRequests(): GateRequest[] {
  return WRITER_GATE_SELECTION.map((spec, index) => {
    const dir = join(DEV_BASE, spec.rep)
    const replay = replaySemantic(dir, spec.runKey)
    const procedural = replayProceduralLineage(dir, spec.runKey, replay.frames, replay.proceduralItems)
    if (procedural && !procedural.statusesMatchRecorded) throw new Error(`lineage diverge: ${spec.rep}/${spec.runKey}`)
    const frame = replay.frames.find((item) => item.interactionRef === spec.interactionRef)
    if (!frame) throw new Error(`frame ausente: ${spec.rep}/${spec.runKey}/${spec.interactionRef}`)
    const prompts = readFileSync(join(dir, "prompts", `${spec.runKey}.jsonl`), "utf8")
    const header = prompts.match(new RegExp(`=== ${spec.interactionRef} · B\\d+ · (\\d{4}-\\d{2}-\\d{2}) · assunto: (.*?) ===`))
    if (!header) throw new Error(`cabeçalho ausente: ${spec.rep}/${spec.runKey}/${spec.interactionRef}`)
    const feedback = composeInteractionFeedback({ subject: { collaboratorRef: "gate" }, frame, interactionLabel: gateLabel(header[1]!, header[2]!), sourceRun: `${spec.rep}/${spec.runKey}`, proceduralLineage: procedural?.lineage ?? new Map() })
    const prepared = buildFeedbackWriterInput(feedback)
    if (!prepared.invoke) throw new Error(`não invocaria o redator: ${spec.rep}/${spec.runKey}/${spec.interactionRef}`)
    const input = renderWriterUserInput(prepared.input)
    return { requestId: `WG-${String(index + 1).padStart(2, "0")}`, source: spec, writerInput: prepared.input, itemSlots: prepared.input.items.map((item) => item.slot), systemPrompt: WRITER_SYSTEM_PROMPT, input, systemPromptSha256: sha256(WRITER_SYSTEM_PROMPT), inputSha256: sha256(input) }
  })
}

// ---------------------------------------------------------------------------------------------
// PROMPT CONGELADO (pt-BR). Exemplo com placeholder, nunca com um slot real (higiene V1.4.6.8).
// ---------------------------------------------------------------------------------------------

export const WRITER_SYSTEM_PROMPT = `Você redige o texto final de um feedback para um operador de atendimento, sobre UMA única interação.

A entrada é um JSON (FEEDBACK_WRITER_INPUT_V1) já decidido pela aplicação: para cada item, a seção (STRENGTH = ponto positivo; OPPORTUNITY = ponto de desenvolvimento), o significado seguro, a fonte da orientação e a evidência exibível (trechos literais da conversa, com dados pessoais já mascarados como [PROTOCOLO], [CPF], [TELEFONE]). Você NÃO decide nada disso: só escreve.

Para CADA item, escreva em português do Brasil, em linguagem natural, direta e respeitosa, falando com o operador ("você"):
- observed: o fato observado nesta interação, fiel ao significado seguro e à evidência;
- whyItMatters: por que isso importa para o atendimento ao cliente;
- whatYouCanDo: o que o operador pode fazer em situações parecidas (em STRENGTH, reforçar a prática; em OPPORTUNITY com COACHING_SUGGESTION, uma SUGESTÃO, nunca uma obrigação).

Regras obrigatórias:
1. Fale somente sobre esta interação. Nunca descreva como padrão, hábito, tendência ou característica do operador (não use "costuma", "sempre", "frequentemente", "tende a").
2. Não diagnostique intenção, motivação ou estado emocional do operador.
3. Não afirme causa ou consequência que a evidência não mostra.
4. Não cite política, procedimento, regra, norma ou manual; não use linguagem normativa ("deve", "é obrigatório", "é proibido").
5. Não escreva número, prazo, valor ou meta que não esteja literalmente na evidência do item.
6. Não afirme que algo foi executado ou registrado em sistema além do que a evidência mostra.
7. Não mencione identificadores, códigos, nomes de campos, seções ou valores técnicos do JSON (por exemplo STRENGTH, OPPORTUNITY, slot).
8. Não diga que uma IA, a INIA ou um sistema detectou, analisou ou identificou algo.
9. Não use linguagem disciplinar (advertência, punição, penalidade, infração, falha grave).
10. Se citar a evidência entre aspas, copie o texto exibível exatamente como está; nunca reconstrua dado mascarado.
11. Se o item não tiver evidência exibível, escreva a partir do significado seguro, sem inventar o que foi dito.
12. Mantenha o sentido do item: ponto positivo continua positivo; ponto de desenvolvimento continua ponto de desenvolvimento.

Responda SOMENTE com JSON, sem texto fora dele, exatamente neste formato, com um objeto por item recebido e nenhum campo além destes:
{"items":[{"slot":"<SLOT>","observed":"...","whyItMatters":"...","whatYouCanDo":"..."}]}
Use em "slot" exatamente o valor de "slot" de cada item recebido. Não inclua resumo geral nem qualquer outro campo.`

export function renderWriterUserInput(input: FeedbackWriterInputV1): string {
  return `FEEDBACK_WRITER_INPUT_V1:\n${JSON.stringify(input, null, 2)}`
}

// ---------------------------------------------------------------------------------------------
// PACOTE HUMANO CEGO
// ---------------------------------------------------------------------------------------------

export type BlindItem = { code: string; requestId: string; slot: string }

/** Códigos W-01..W-n numa ordem determinística que NÃO segue a seleção (hash da origem) — a categoria não se infere pela ordem. */
export function blindCodes(requests: GateRequest[]): BlindItem[] {
  const items = requests.flatMap((request) => request.itemSlots.map((slot) => ({ requestId: request.requestId, slot, order: sha256(`${WRITER_GATE_VERSION}|${request.source.rep}|${request.source.runKey}|${request.source.interactionRef}|${slot}`) })))
  return items.sort((a, b) => (a.order < b.order ? -1 : 1)).map((item, index) => ({ code: `W-${String(index + 1).padStart(2, "0")}`, requestId: item.requestId, slot: item.slot }))
}

const SECTION_LABEL: Record<WriterItem["section"], string> = { STRENGTH: "Ponto positivo", OPPORTUNITY: "Ponto de desenvolvimento (sugestão, não obrigação)" }

/** O que o revisor vê de UM item: fato exibível + contexto estrutural mínimo (+ o texto do redator, preenchido depois da execução). */
export function renderBlindFact(item: WriterItem, label: string): string {
  const evidence = item.evidence.length > 0 ? item.evidence.map((entry) => `  - ${entry.speaker === "OPERADOR" ? "Operador" : entry.speaker === "CLIENTE" ? "Cliente" : "Registro"}: “${entry.text}”${entry.truncated ? "…" : ""}`).join("\n") : "  - (nenhum trecho exibível)"
  const withheld = item.evidenceWithheld > 0 ? `\n  - (${item.evidenceWithheld} trecho(s) não exibido(s) por privacidade)` : ""
  return `Interação: ${label}\nTipo: ${SECTION_LABEL[item.section]}\nSignificado: ${item.interpretation.safeMeaning}\nEvidência exibível:\n${evidence}${withheld}`
}

export const RUBRIC = {
  FIDELITY: ["PASS", "FAIL"],
  ACTIONABILITY: ["PASS", "WEAK", "FAIL"],
  TONE: ["PASS", "FAIL"],
  OVERCLAIM: ["YES", "NO"],
  FINAL: ["DELIVERABLE", "NOT_DELIVERABLE"],
} as const
