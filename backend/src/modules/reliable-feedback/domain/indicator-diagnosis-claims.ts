import { QUOTED_SPAN } from "../../investigation/domain/interaction-feedback-writer.js"
import { numberReadings } from "./indicator-claims.js"

/**
 * V1.6.1 — FRONTEIRAS DE AFIRMAÇÃO DO DIAGNÓSTICO DE INDICADOR (determinísticas, sem LLM). Somam-se às do indicador (números
 * canônicos, comparação oficial, sem tendência, período). Aplicadas ao texto do redator e à edição humana do QA:
 *
 *   CAUSAL_CLAIM                 comportamento/etapa ligado ao RESULTADO do indicador por relação de causa ou de efeito
 *                                ("seu TMA está alto porque…", "isso explica o resultado", "para reduzir seu TMA",
 *                                "pode ajudar a melhorar o indicador"). Indicador + comportamento observado NÃO é causa.
 *                                Heurística por FRASE: menção ao resultado/indicador + marcador causal; trechos entre aspas
 *                                (citação literal) não contam.
 *   PEER_CLAIM_WITHOUT_EVIDENCE  "grupo de referência", "colegas", "melhores resultados"… num item sem evidência agregada de
 *                                pares — benchmark só existe calculado pelo sistema.
 *   UNSUPPORTED_SEGMENT_LABEL    motivo/atendimento chamado de "simples", "complexo", "difícil", "fácil": nenhum dado oficial
 *                                sustenta esse rótulo.
 * Números do diagnóstico (motivo, contagens, pares) só valem se estiverem nos fatos do PRÓPRIO item (`allowedNumbersFrom`).
 */
const SENTENCES = /[^.!?;\n]+/g
const RESULT_MENTION = /(?<!\p{L})(?:indicador|resultado|meta|tempo\s+m[ée]dio|tempo\s+de\s+atendimento|TMA)(?!\p{L})/iu
const CAUSAL_MARKER = /(?<!\p{L})(?:porque|por\s+causa|devido\s+(?:a|ao|à)|causou|causa(?:ndo|m|r)?|explica(?:m|r)?|contribu\p{L}*|impact\p{L}*|influenci\p{L}*|result(?:ou|a)\s+em|lev(?:ou|a|am)\s+a|faz(?:em)?\s+com\s+que|respons[áa]ve(?:l|is)|para\s+(?:reduzir|diminuir|aumentar|melhorar|baixar|elevar)|(?:ajuda(?:r|m)?|pode(?:m|r[áa])?)\s+(?:a\s+)?(?:reduzir|diminuir|aumentar|melhorar|baixar|elevar))(?!\p{L})/iu

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * INDICATOR DIAGNOSIS V2 — NO_CAUSAL_UPGRADE genérico: o nome do indicador (e os termos do sinal da população, ex.: a flag) contam
 * também no PLURAL ("as rechamadas aconteceram porque…"), e um verbo de EFEITO com o indicador como objeto é causa mesmo sem
 * "porque" ("isso provocou as rechamadas", "esse comportamento aumentou a rechamada", "fazer X reduzirá a rechamada", "evite
 * rechamadas"). Nenhum termo de indicador é fixo aqui — vêm do indicador/estratégia da execução.
 */
const EFFECT_VERB = String.raw`(?:aument|diminu|reduz|melhor|pior|elev|baix|caus|provoc|ger|evit|origin|motiv)\p{L}*`
const DETERMINERS = String.raw`(?:(?:a|o|as|os|sua|seu|suas|seus|essa|esse|essas|esses|mais|menos|de|da|do|das|dos|novas?|novos?)\s+){0,3}`

export function causalIndicatorClaims(text: string, indicator: { name: string; code: string }, extraTerms: readonly string[] = []): string[] {
  const names = [indicator.name, indicator.code, ...extraTerms].filter((value) => value.trim().length >= 2).map((value) => `${escape(value.trim())}(?:e?s)?`)
  const indicatorMention = names.length > 0 ? new RegExp(`(?<!\\p{L})(?:${names.join("|")})(?!\\p{L})`, "iu") : null
  const effectOnIndicator = names.length > 0 ? new RegExp(`(?<!\\p{L})${EFFECT_VERB}\\s+${DETERMINERS}(?:${names.join("|")})(?!\\p{L})`, "iu") : null
  return (text.replace(QUOTED_SPAN, " ").match(SENTENCES) ?? []).map((sentence) => sentence.trim()).filter((sentence) => ((RESULT_MENTION.test(sentence) || Boolean(indicatorMention?.test(sentence))) && CAUSAL_MARKER.test(sentence)) || Boolean(effectOnIndicator?.test(sentence)))
}

/** V2 — frases que a ESTRATÉGIA do indicador proíbe em qualquer texto gerado (comparação sem acento/caixa; aplicada por código). */
export function strategyProhibitedClaims(text: string, prohibited: readonly string[]): string[] {
  const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ")
  const folded = fold(text)
  return prohibited.filter((claim) => claim.trim().length >= 3 && folded.includes(fold(claim.trim())))
}

const PEER_MENTION = /(?<!\p{L})(?:grupo\s+de\s+refer[êe]ncia|colegas?|pares|outros\s+(?:operadores|colaboradores|atendentes)|melhores\s+resultados|quem\s+tem\s+(?:os\s+)?melhores|top\s+performers?)(?!\p{L})/iu
export function peerClaimsWithoutEvidence(text: string, hasPeerEvidence: boolean): string[] {
  if (hasPeerEvidence) return []
  const match = PEER_MENTION.exec(text.replace(QUOTED_SPAN, " "))
  return match ? [match[0]] : []
}

const SEGMENT_LABEL = /(?<!\p{L})(?:motivos?|atendimentos?|chamadas?|casos?|contatos?|assuntos?|demandas?)\s+(?:mais\s+|menos\s+|muito\s+)?(?:simples|complex[oa]s?|dif[íi]ceis|dif[íi]cil|f[áa]ceis|f[áa]cil|trabalhos[oa]s?)(?!\p{L})/iu
export function segmentLabelClaims(text: string): string[] {
  const match = SEGMENT_LABEL.exec(text.replace(QUOTED_SPAN, " "))
  return match ? [match[0]] : []
}

/** Números presentes nos textos verificados de um item (valor lido + token exato) — os únicos, além dos canônicos, permitidos. */
export function allowedNumbersFrom(texts: readonly string[]): (number | string)[] {
  return texts.flatMap((text) => (text.match(/\d+(?:[.,]\d+)*/g) ?? []).flatMap((raw) => [raw, ...numberReadings(raw)]))
}
