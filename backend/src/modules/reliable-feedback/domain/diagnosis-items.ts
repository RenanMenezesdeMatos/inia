import { projectDisplayEvidence, type DisplayProjectionContext } from "../../investigation/domain/feedback-display-evidence.js"
import { buildKnowledgeMaterialHref } from "../../knowledge/domain/material-href.js"
import { peerFactText, type PeerPracticeResult } from "../../indicator-diagnosis/domain/peer-practice-evidence.js"
import { patternFactText, type ProcessPattern } from "../../indicator-diagnosis/domain/process-patterns.js"
import type { ReliableFact, ReliableItemDraft, ReliableKnowledgeRef } from "./reliable-feedback-item.js"
import { stepTitleOf } from "./process-items.js"

/**
 * V1.6.1 — ITENS DO FEEDBACK DE INDICADOR NASCIDOS DO DIAGNÓSTICO (domínio puro). O fato oficial do indicador continua sendo
 * o item do adaptador canônico; estes itens vêm SÓ de padrões de processo sustentados na amostra:
 *
 *   DEVELOPMENT → INDICATOR_DEVELOPMENT_PATTERN (ponto de desenvolvimento)
 *   STRENGTH    → INDICATOR_STRENGTH_PATTERN (ponto forte — reconhecimento do que foi observado, nunca elogio vazio)
 *
 * Fatos exibíveis: o motivo investigado (ANALISE), a contagem do padrão (ANALISE), até 2 falas verificadas do operador e, só
 * quando existe e passou pela privacidade, o agregado do grupo de referência (REFERENCIA). Regra da base = a melhor
 * verificada entre as chamadas (o link nasce do id real). Sem regra verificada o item existe, mas sem orientação e sempre com
 * QA (PROCESS_RULE_UNVERIFIED — o nome da etapa é do modelo). V1.7.1a: TODOS os padrões sustentados viram item (sem limite
 * editorial) — desenvolvimentos antes de fortes, regra VERIFIED primeiro; a ordem ordena, nunca esconde.
 */
export const DIAGNOSIS_ITEM_ORDER_VERSION = "DIAGNOSIS_ITEM_ORDER_V1" as const
const MAX_EVIDENCE_FACTS = 2

export const DIAGNOSIS_SAFE_MEANING = {
  development: "etapa do processo não identificada de forma recorrente na amostra de atendimentos analisados do motivo investigado; associação com o indicador não é causa",
  strength: "etapa do processo identificada de forma consistente na amostra de atendimentos analisados do motivo investigado; associação com o indicador não é causa",
} as const

function knowledgeRefOf(pattern: ProcessPattern): ReliableKnowledgeRef | null {
  const knowledge = pattern.knowledge
  if (!knowledge || knowledge.applicability === "NOT_VERIFIED" || !knowledge.documentId || !knowledge.quote) return null
  return { documentId: knowledge.documentId, documentTitle: knowledge.documentTitle, heading: knowledge.heading, version: knowledge.version, quote: knowledge.quote.trim(), applicability: knowledge.applicability, href: buildKnowledgeMaterialHref(knowledge.documentId) }
}

export function buildDiagnosisItems(input: {
  patterns: readonly ProcessPattern[]
  peers: ReadonlyMap<string, PeerPracticeResult>
  segmentLabel: string
  segmentText: string | null
  displayContextByHandle: ReadonlyMap<string, DisplayProjectionContext>
  startIndex: number
}): { items: ReliableItemDraft[]; excludedForMateriality: string[] } {
  const rank = (pattern: ProcessPattern) => (pattern.knowledge?.applicability === "VERIFIED" ? 0 : pattern.knowledge?.applicability === "LITERAL_ONLY" ? 1 : 2)
  const ordered = (classification: "DEVELOPMENT" | "STRENGTH") => input.patterns.map((pattern, order) => ({ pattern, order })).filter((entry) => entry.pattern.classification === classification).sort((a, b) => rank(a.pattern) - rank(b.pattern) || a.order - b.order).map((entry) => entry.pattern)
  const development = ordered("DEVELOPMENT")
  const strengths = ordered("STRENGTH")
  const selected = [...development, ...strengths]

  const items = selected.map((pattern, position): ReliableItemDraft => {
    const strength = pattern.classification === "STRENGTH"
    // Evidência: falas do operador das chamadas que SUSTENTAM a classificação (seguida para força, não seguida para desenvolvimento).
    const supporting = pattern.checkpoints.filter((entry) => entry.checkpoint.status === (strength ? "FOLLOWED" : "NOT_FOLLOWED"))
    const display = supporting.flatMap((entry) =>
      entry.checkpoint.transcriptEvidence
        .filter((unit) => unit.speaker === "OPERADOR")
        .slice(0, 1)
        .map((unit, factIndex) => ({ entry, unit, projected: projectDisplayEvidence({ turnRef: unit.turnRef, speaker: unit.speaker, quote: unit.quote }, { factIndex, evidenceType: "FINDING_EVIDENCE" }, input.displayContextByHandle.get(entry.handle) ?? {}) })),
    )
    const shown = display.filter((entry) => entry.projected.status === "DISPLAYED").slice(0, MAX_EVIDENCE_FACTS)
    const evidenceFacts: ReliableFact[] = shown.map((entry) => ({ role: "OPERADOR", text: entry.projected.status === "DISPLAYED" ? entry.projected.text : "", truncated: entry.projected.status === "DISPLAYED" ? entry.projected.truncated : false, masked: entry.projected.status === "DISPLAYED" ? entry.projected.wasRedacted : false }))
    const peer = input.peers.get(pattern.practiceKey)
    const facts: ReliableFact[] = [
      ...(input.segmentText ? [{ role: "ANALISE" as const, topic: "SEGMENT" as const, text: input.segmentText, truncated: false, masked: false }] : []),
      { role: "ANALISE", topic: "PATTERN", text: patternFactText(pattern, input.segmentLabel), truncated: false, masked: false },
      ...evidenceFacts,
      ...(peer?.status === "AVAILABLE" ? [{ role: "REFERENCIA" as const, topic: "PEER" as const, text: peerFactText(peer), truncated: false, masked: false }] : []),
    ]
    const knowledge = knowledgeRefOf(pattern)
    const grounding = knowledge ? pattern.grounding : "NO_GROUNDED_GUIDANCE"
    return {
      index: input.startIndex + position,
      claimRef: pattern.practiceKey,
      domain: "INDICATOR",
      section: strength ? "STRENGTH" : "OPPORTUNITY",
      kind: strength ? "INDICATOR_STRENGTH_PATTERN" : "INDICATOR_DEVELOPMENT_PATTERN",
      polarity: strength ? "POSITIVE" : "NEGATIVE",
      ownership: "AGENT",
      safeMeaning: strength ? DIAGNOSIS_SAFE_MEANING.strength : DIAGNOSIS_SAFE_MEANING.development,
      guidanceSource: strength ? "REINFORCEMENT" : "COACHING_SUGGESTION",
      grounding,
      knowledge,
      // V1.7.1b — nome exibível da etapa (linha literal da regra verificada): base do exemplo de condução do padrão.
      process: { title: pattern.processTitle, requirement: pattern.requirement, status: strength ? "FOLLOWED" : "NOT_FOLLOWED", checkpointRef: pattern.practiceKey, stepTitle: stepTitleOf(pattern.requirement, knowledge?.quote, knowledge?.heading) },
      facts,
      withheldFacts: display.length - shown.length,
      // Só a orientação declarada — e só quando fundamentada na base verificada.
      analysis: grounding !== "NO_GROUNDED_GUIDANCE" && pattern.guidanceText ? { observation: null, summary: null, recommendation: pattern.guidanceText } : null,
      analysisConflicts: [],
      // Padrão de conduta sem fala exibível do operador não pode ser comunicado (mesma regra da monitoria).
      structuralBlock: evidenceFacts.length === 0 ? "INSUFFICIENT_DISPLAY_EVIDENCE" : null,
      priority: { rank: input.startIndex + position + 1, policy: DIAGNOSIS_ITEM_ORDER_VERSION, basis: [strength ? "STRENGTH" : "DEVELOPMENT_FIRST", knowledge?.applicability === "VERIFIED" ? "RULE_VERIFIED" : knowledge ? "RULE_LITERAL_ONLY" : "RULE_NOT_VERIFIED"] },
      audit: { evidence: display.map((entry) => ({ turnRef: entry.projected.origin.turnRef, speaker: entry.unit.speaker, rawSha256: entry.projected.origin.rawSha256 })), rejectedUnits: supporting.flatMap((entry) => entry.checkpoint.rejectedUnits) },
    }
  })
  return { items, excludedForMateriality: [] }
}
