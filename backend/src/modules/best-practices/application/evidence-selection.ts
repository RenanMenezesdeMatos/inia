import { hasUnmaskedLongNumber } from "../domain/excerpt-privacy.js"
import { projectPeerTranscript } from "../../investigation/domain/peer-privacy-projection.js"
import type { CodingRecord, CorpusCall, CorpusOperator, EvidenceRecord } from "./ports.js"

/**
 * EVIDÊNCIAS EXIBIDAS de um padrão: falas LITERAIS (já conferidas) de operadores do grupo de melhores resultados, no máximo
 * `perOperator` por operador e `total` no conjunto, em rodízio entre operadores (nenhum domina o que a tela mostra). Cada trecho sai
 * com nomes de operadores trocados por [OPERADOR] e CPF/telefone/e-mail/protocolo mascarados; trecho que ainda tiver identificador
 * numérico não é exibido. Quem atendeu vira "Operador A/B/C…" — estável dentro da versão, nunca o nome.
 */
export const EVIDENCE_PER_OPERATOR = 2
export const EVIDENCE_TOTAL = 6

export function maskExcerpt(quote: string, operator: CorpusOperator, operators: readonly CorpusOperator[]): string | null {
  const projection = projectPeerTranscript({
    sourceInteractionId: operator.ref,
    transcript: quote,
    peer: { personId: operator.ref, fullName: operator.name },
    knownOperators: operators.map((item) => ({ personId: item.ref, fullName: item.name })),
  })
  const text = projection.projected.replace(/\s+/g, " ").trim()
  if (text.length === 0 || hasUnmaskedLongNumber(text)) return null
  return text
}

const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
const labelOf = (index: number) => `Operador ${index < LABELS.length ? LABELS[index] : `${LABELS[index % LABELS.length]}${Math.floor(index / LABELS.length) + 1}`}`

export function selectEvidence(input: { codings: readonly CodingRecord[]; cellKeys: ReadonlySet<string>; calls: ReadonlyMap<string, CorpusCall>; operators: ReadonlyMap<string, CorpusOperator>; total?: number; perOperator?: number }): EvidenceRecord[] {
  const total = input.total ?? EVIDENCE_TOTAL
  const perOperator = input.perOperator ?? EVIDENCE_PER_OPERATOR
  const candidates = input.codings
    .filter((coding) => coding.group === "TOP" && coding.status === "PRESENT" && coding.quoteVerified && coding.quote && coding.turnRef && input.cellKeys.has(coding.cellKey))
    .sort((a, b) => a.operatorRef.localeCompare(b.operatorRef) || a.callRef.localeCompare(b.callRef))
  const byOperator = new Map<string, CodingRecord[]>()
  for (const coding of candidates) byOperator.set(coding.operatorRef, [...(byOperator.get(coding.operatorRef) ?? []), coding])
  const allOperators = [...input.operators.values()]
  const labels = new Map<string, string>()
  const out: EvidenceRecord[] = []
  for (let round = 0; round < perOperator && out.length < total; round += 1) {
    for (const [operatorRef, list] of byOperator) {
      if (out.length >= total) break
      const coding = list[round]
      const operator = input.operators.get(operatorRef)
      const call = coding ? input.calls.get(coding.callRef) : undefined
      if (!coding || !operator || !call) continue
      const excerpt = maskExcerpt(coding.quote!, operator, allOperators)
      if (!excerpt) continue
      if (!labels.has(operatorRef)) labels.set(operatorRef, labelOf(labels.size))
      out.push({ callRef: coding.callRef, interactionId: call.interactionId, personId: call.personId, operatorLabel: labels.get(operatorRef)!, group: "TOP", cellKey: coding.cellKey, reason: call.reason, subReason: call.subReason, occurredAt: call.occurredAt, turnRef: coding.turnRef!, excerpt })
    }
  }
  return out
}
