import { createHash } from "node:crypto"
import { normalizeForLiteralQuote } from "../../knowledge/domain/knowledge-match.js"

/**
 * IDENTIDADE DOS CRITÉRIOS ENTRE VERSÕES DA BASE (reconciliação de 05/10/2026) — sem aprovação humana, sem fila, sem chamada de modelo
 * e sem nenhuma leitura de sentido por palavra.
 *
 * O critério é a LINHA da base: o texto do item junto com a frase que abre a lista (`effectiveRuleText`), na sua seção. A chave da
 * linha só depende da formatação normalizada (marcador, espaço, caixa…), então:
 *   UNCHANGED   a linha existe igual na versão anterior → mesma identidade;
 *   FIRST_SEEN  qualquer outro texto → identidade própria.
 * Se duas redações pedem a MESMA conduta (sinônimo, digitação corrigida, seção renumerada, "deve" × "deverá") quem diz é a PRÁTICA
 * (`PRACTICE_IDENTITY_V1`, leitura do modelo ao organizar a base): o histórico, o Diagnóstico e a reincidência continuam pela
 * prática. A V3 decidia essa equivalência por listas de palavras (negação, "deve/pode", "se/quando", canais, prazos, terminações
 * de verbo) — erraria com sinônimo ("informar" × "comunicar") e não é leitura de sentido; saiu.
 * Os valores EQUIVALENT_PREVIOUS / MODIFIED / SOURCE_SPECIFIC continuam válidos só para linhas gravadas antes (histórico).
 */
export type IdentityBasis = "FIRST_SEEN" | "UNCHANGED" | "EQUIVALENT_PREVIOUS" | "MODIFIED" | "SOURCE_SPECIFIC"
export type ChangeReason = "ORDER" | "CONDITION" | "MODALITY" | "NEGATION" | "ACTOR" | "CHANNEL" | "DEADLINE" | "BOUND" | "OBJECT_OR_SCOPE" | "LIST_CONTEXT"
export type PersistedCriterion = { lineKey: string; criterionKey: string; heading: string | null; text: string; position: number }
export type CriterionIdentity = { lineKey: string; criterionKey: string; basis: IdentityBasis; previousCriterionKey: string | null; changeReasons?: ChangeReason[] }

export const criterionKeyOf = (lineKey: string) => `KC-${lineKey}`
/**
 * Identidade de uma PARTE de regra composta (`SEMANTIC_AUDITABILITY_V1`): mesma família da linha (KC base / AG argumentário), derivada
 * da identidade da linha + texto normalizado da parte. A parte "comunicar ao cliente" e a parte "executar no sistema" da mesma regra
 * são critérios diferentes na memória — o não observável de uma nunca contamina os números da outra.
 */
export function obligationCriterionKeyOf(parentCriterionKey: string, part: string): string {
  const family = parentCriterionKey.startsWith("AG-") ? "AG" : "KC"
  return `${family}-${createHash("sha256").update(`${parentCriterionKey}|${normalizeForLiteralQuote(part)}`).digest("hex").slice(0, 12)}`
}

/**
 * Texto EFETIVO da regra (o que a identidade e a comparação usam): a abertura da lista numa linha e o item na seguinte. O
 * separador é a quebra de linha — um item nunca tem quebra de linha, então a divisão é exata.
 */
export const effectiveRuleText = (line: { leadIn?: string | null; text: string }) => (line.leadIn && line.leadIn.trim().length > 0 ? `${line.leadIn.trim()}\n${line.text}` : line.text)
export function splitEffectiveRuleText(text: string): { leadIn: string | null; item: string } {
  const index = text.lastIndexOf("\n")
  return index < 0 ? { leadIn: null, item: text } : { leadIn: text.slice(0, index), item: text.slice(index + 1) }
}

/** Só formatação (caixa, acento, marcação, espaço) — para comparar títulos de seção da MESMA versão do documento. */
const fold = (text: string | null) => (text ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim()

/** Reconciliação com a versão anterior: linha igual (mesma chave) herda a identidade; o resto é identidade própria. */
export function reconcileCriteria(current: readonly { lineKey: string; heading: string | null; text: string }[], previous: readonly PersistedCriterion[] | null): CriterionIdentity[] {
  const byLine = new Map((previous ?? []).map((entry) => [entry.lineKey, entry]))
  return current.map((line) => {
    const same = byLine.get(line.lineKey)
    return same ? { lineKey: line.lineKey, criterionKey: same.criterionKey, basis: "UNCHANGED", previousCriterionKey: null } : { lineKey: line.lineKey, criterionKey: criterionKeyOf(line.lineKey), basis: "FIRST_SEEN", previousCriterionKey: null }
  })
}

/**
 * REVISÃO DA EXTRAÇÃO (mesma versão da base, lógica de extração nova): registra, com proveniência, qual identidade antiga
 * corresponde a cada linha nova — NUNCA une as identidades (a série antiga fica no histórico; agregações não as misturam).
 * Correspondência só pela posição da linha na MESMA versão do documento + mesma seção (o texto não mudou; a lógica mudou), com
 * reserva pelo item idêntico na seção. `SAME_TEXT` = o texto efetivo (abertura + item) é o mesmo depois de normalizar a formatação;
 * `TEXT_CHANGED` = a lógica nova recorta a regra de outro jeito (ex.: a frase que abre a lista passou a fazer parte dela). Se o
 * sentido mudou ou não, não é decidido aqui (a prática decide).
 */
export type ExtractionRevisionEntry = { lineKey: string; criterionKey: string; previousCriterionKey: string; relation: "SAME_TEXT" | "TEXT_CHANGED" }
export type ExtractionRevision = { from: string; to: string; correspondences: ExtractionRevisionEntry[]; unmatchedPrevious: string[]; unmatchedCurrent: string[] }
export function extractionRevisionOf(input: { from: string; to: string; previous: readonly PersistedCriterion[]; current: readonly { lineKey: string; heading: string | null; text: string; position: number }[]; identities: readonly CriterionIdentity[] }): ExtractionRevision {
  const keyOf = new Map(input.identities.map((identity) => [identity.lineKey, identity.criterionKey]))
  const claimed = new Set<string>()
  const correspondences: ExtractionRevisionEntry[] = []
  const unmatchedCurrent: string[] = []
  for (const line of input.current) {
    const sameSection = input.previous.filter((entry) => !claimed.has(entry.lineKey) && fold(entry.heading) === fold(line.heading))
    const byPosition = sameSection.find((entry) => entry.position === line.position)
    const item = fold(splitEffectiveRuleText(line.text).item)
    const byItem = sameSection.filter((entry) => fold(splitEffectiveRuleText(entry.text).item) === item)
    const match = byPosition ?? (byItem.length === 1 ? byItem[0] : undefined)
    if (!match) {
      unmatchedCurrent.push(line.lineKey)
      continue
    }
    claimed.add(match.lineKey)
    const sameText = normalizeForLiteralQuote(match.text) === normalizeForLiteralQuote(line.text)
    correspondences.push({ lineKey: line.lineKey, criterionKey: keyOf.get(line.lineKey) ?? criterionKeyOf(line.lineKey), previousCriterionKey: match.criterionKey, relation: sameText ? "SAME_TEXT" : "TEXT_CHANGED" })
  }
  return { from: input.from, to: input.to, correspondences, unmatchedPrevious: input.previous.filter((entry) => !claimed.has(entry.lineKey)).map((entry) => entry.criterionKey), unmatchedCurrent }
}
