import { z } from "zod"
import { FEEDBACK_WRITER_MODEL_CONFIG, sha256 } from "../../interaction-feedback/domain/feedback-writer-prompt.js"
import { INTERNAL_REF_PATTERN } from "../../investigation/domain/interaction-feedback.js"
import type { PrvNarrativeBrief, PrvNarrativeDraft } from "./prv-closing-views.js"

/**
 * INDICATOR DIAGNOSIS V1 — REDATOR DA INTERPRETAÇÃO E DA NARRATIVA DO FECHAMENTO (`PRV_INDICATOR_NARRATIVE`).
 *
 * O LLM INTERPRETA o que o SISTEMA já contou: recebe o resultado oficial, o mix e os padrões JÁ agregados (contagens,
 * denominadores e percentuais prontos), e devolve (1) a mensagem natural ao colaborador, (2) o card e (3) notas de interpretação
 * para o supervisor (o que é relevante, o que merece atenção, o que não pode ser concluído). Não conta, não calcula, não decide
 * padrão, não escolhe população, não atribui causa. Mesma rota fixa do redator do piloto (gemini-3.1-flash-lite, 30 s, zero
 * retry, JSON). Prompt versionado e congelado (`prv-indicator-narrative-prompt-v1.freeze.json`;
 * `npx tsx scripts/dev/freeze-prv-narrative-prompt.ts`). Tudo que volta é validado campo a campo; falha = texto do sistema.
 */
export const PRV_NARRATIVE_PROMPT_VERSION = "PRV_INDICATOR_NARRATIVE_PROMPT_V1" as const
export const PRV_NARRATIVE_INPUT_CONTRACT = "PRV_INDICATOR_NARRATIVE_INPUT_V1" as const
export const PRV_NARRATIVE_OUTPUT_SCHEMA_VERSION = "PRV_INDICATOR_NARRATIVE_OUTPUT_V1" as const
export const PRV_NARRATIVE_ADAPTER_VERSION = "GEMINI_PRV_INDICATOR_NARRATIVE_WRITER_V1" as const

export const PRV_NARRATIVE_SYSTEM_PROMPT = `Você é um supervisor experiente de uma operação de atendimento. Escreve, em português do Brasil, o feedback do FECHAMENTO MENSAL de indicadores de um colaborador e uma interpretação curta para o supervisor dele.

A entrada já traz tudo decidido e contado pelo sistema: o resultado OFICIAL de cada indicador ("officialResult", "target", "position", "quartile", "previousClosing"), a mudança de composição dos motivos de atendimento ("mix"), os comportamentos que se repetiram NAS CHAMADAS DO PRÓPRIO COLABORADOR ("toAdjust"), o que ele fez de forma consistente ("toMaintain") e o que NÃO pode ser concluído ("cannotConclude"). Você NÃO conta, NÃO calcula, NÃO decide padrão e NÃO acrescenta fato: você interpreta e escreve.

MENSAGEM AO COLABORADOR ("paragraphs", normalmente 2 a 4 parágrafos curtos)
- Fale diretamente com o colaborador ("você"), com naturalidade, respeito e objetividade. Nada de relatório estatístico.
- Diga o resultado oficial do ciclo de forma simples; depois o principal ponto a trabalhar (cada item de "toAdjust" precisa aparecer); em seguida o que fazer nas próximas chamadas desse tipo, a partir de "guidance" com suas palavras; por fim o que manter, quando houver.
- Sem "toAdjust": diga o resultado e o que manter, ou que não apareceu um ponto recorrente nas chamadas analisadas para uma orientação específica.
- "mix" é CONTEXTO: pode dizer que um motivo passou a representar uma parte maior dos atendimentos e, se "longerDuration" for verdadeiro, que esse motivo teve duração média registrada maior. NUNCA diga que o mix, um motivo ou um comportamento causou, provocou, explica ou foi responsável pelo resultado do indicador.

INTERPRETAÇÃO PARA O SUPERVISOR ("supervisorNotes", 1 a 4 frases)
- O que é mais relevante neste fechamento, o que merece atenção e o que não pode ser concluído. Pode citar os números da entrada exatamente como vieram. Coincidência no tempo não é causa: use "no mesmo período", "coincidiu com", "aparece com mais frequência".

CARD ("card"): 1 ou 2 frases curtas com o resultado do ciclo e o principal ponto (ou o que manter).

O QUE VOCÊ NUNCA FAZ
- Nunca use número que não esteja na entrada; nunca calcule diferença, soma, média ou percentual.
- Nunca afirme causa: "por causa de", "porque", "devido a", "causou", "provocou", "foi responsável", "explica", "levou a", "para reduzir o TMA", "vai melhorar o indicador".
- Nunca recomende pressa: "fale mais rápido", "encerre mais cedo", "reduza as explicações", "seja mais rápido", "diminua o tempo". Processo correto vem antes da eficiência.
- Nunca diga "sempre", "nunca", "costuma", "normalmente", "com frequência" sobre o colaborador; nunca chame algo de erro, falha, culpa ou descuido.
- Na mensagem ao colaborador, nunca fale de equipe, time, grupo, colegas ou outros operadores.
- Nunca use nome de pessoa, saudação ("Olá", "Oi") ou vocativo: o sistema acrescenta o nome.
- Nunca use termos internos (checkpoint, etapa, status, classificação, amostra, códigos) nem lacunas como [nome], <valor> ou reticências.

RESPOSTA: apenas um objeto JSON, sem texto antes ou depois:
{"paragraphs": ["…"], "card": "…", "supervisorNotes": ["…"]}`

export const PRV_NARRATIVE_OUTPUT_SCHEMA_DESCRIPTION = { paragraphs: "string[] (1–5)", card: "string (1–2 frases)", supervisorNotes: "string[] (1–4)" } as const
export const PRV_NARRATIVE_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: { paragraphs: { type: "ARRAY", items: { type: "STRING" } }, card: { type: "STRING" }, supervisorNotes: { type: "ARRAY", items: { type: "STRING" } } },
  required: ["paragraphs", "card", "supervisorNotes"],
  propertyOrdering: ["paragraphs", "card", "supervisorNotes"],
}
export const PRV_NARRATIVE_FREEZE_FILE = "prv-indicator-narrative-prompt-v1.freeze.json"

export function prvNarrativeFingerprint() {
  const promptSha256 = sha256(PRV_NARRATIVE_SYSTEM_PROMPT)
  const schemaSha256 = sha256(JSON.stringify(PRV_NARRATIVE_OUTPUT_SCHEMA_DESCRIPTION))
  const configSha256 = sha256(JSON.stringify(FEEDBACK_WRITER_MODEL_CONFIG))
  return {
    adapterVersion: PRV_NARRATIVE_ADAPTER_VERSION,
    promptVersion: PRV_NARRATIVE_PROMPT_VERSION,
    promptSha256,
    schemaVersion: PRV_NARRATIVE_OUTPUT_SCHEMA_VERSION,
    schemaSha256,
    contractVersion: PRV_NARRATIVE_INPUT_CONTRACT,
    effectClaimMode: "POTENTIAL_ONLY",
    model: FEEDBACK_WRITER_MODEL_CONFIG.model,
    config: FEEDBACK_WRITER_MODEL_CONFIG,
    configSha256,
    writerSha256: sha256(`${promptSha256}|${schemaSha256}|${configSha256}|${PRV_NARRATIVE_INPUT_CONTRACT}`),
  }
}

/** Payload do modelo: LISTA BRANCA do brief (sem ids, sem chave de itens, sem nome, sem fala bruta de colega). */
export function projectPrvBriefForModel(brief: PrvNarrativeBrief) {
  return {
    cycle: brief.cycle,
    indicators: brief.indicators.map((indicator) => ({
      indicator: indicator.name,
      officialResult: indicator.result,
      target: indicator.target,
      position: indicator.position,
      quartile: indicator.quartile,
      previousClosing: indicator.previous,
      mix: indicator.mix,
      investigatedMotive: indicator.motive,
      toAdjust: indicator.adjust.map((entry) => ({ topic: entry.topic, whatHappened: entry.happened, guidance: entry.guidance, concentration: entry.concentration })),
      toMaintain: indicator.maintain.map((entry) => ({ topic: entry.topic, whatHappened: entry.happened })),
      cannotConclude: indicator.cannotConclude,
    })),
    sameBehaviorAcrossIndicators: brief.sharedTopics,
  }
}

/** Defesa estrutural antes da rede: nada de id, ref interna ou link no payload. */
export function assertPrvPayloadSafe(payload: ReturnType<typeof projectPrvBriefForModel>): void {
  const text = JSON.stringify(payload)
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text)) throw new Error("PRV_NARRATIVE_PAYLOAD_VIOLATION: identificador no payload")
  if (/\/materiais\//.test(text)) throw new Error("PRV_NARRATIVE_PAYLOAD_VIOLATION: link no payload")
  if (INTERNAL_REF_PATTERN.test(text.replace(/"[^"]*"\s*:/g, ""))) throw new Error("PRV_NARRATIVE_PAYLOAD_VIOLATION: referência interna no payload")
}

export const renderPrvUserTurn = (payload: ReturnType<typeof projectPrvBriefForModel>) => `${PRV_NARRATIVE_INPUT_CONTRACT}:\n${JSON.stringify(payload, null, 2)}`

const outputSchema = z.object({ paragraphs: z.array(z.string()).min(1).max(8), card: z.string(), supervisorNotes: z.array(z.string()).max(6) }).strict()
export type PrvNarrativeParseResult = { ok: true; draft: PrvNarrativeDraft } | { ok: false; error: "PRV_NARRATIVE_MALFORMED_JSON" | "PRV_NARRATIVE_SCHEMA_INVALID"; detail: string | null }
/** Parse ESTRITO (JSON puro, sem reparo): qualquer desvio = sem rascunho (o texto do sistema assume). */
export function parsePrvNarrativeResponse(text: string): PrvNarrativeParseResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: "PRV_NARRATIVE_MALFORMED_JSON", detail: error instanceof Error ? error.message : null }
  }
  const parsed = outputSchema.safeParse(json)
  if (!parsed.success) return { ok: false, error: "PRV_NARRATIVE_SCHEMA_INVALID", detail: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") }
  return { ok: true, draft: { paragraphs: parsed.data.paragraphs, card: parsed.data.card, supervisorNotes: parsed.data.supervisorNotes } }
}
