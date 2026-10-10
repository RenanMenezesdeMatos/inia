import { CALL_ALREADY_MONITORED, indicatorPeriodKey, PERIOD_ALREADY_DELIVERED, type DeliverySkip } from "../domain/delivery-guards.js"
import type { FeedbackMemoryStore, MessageRecord } from "./ports.js"

/**
 * REGRAS DE ENTREGA ÚNICA pela memória do motor (sem trava): usada antes de entregar por Chat/Avatar e na simulação do QA Lab. A
 * publicação no Acompanhamento confere de novo DENTRO da transação, com trava (`deliverySkipOfMessage`).
 */
export async function deliverySkipFromMemory(memory: FeedbackMemoryStore, message: Pick<MessageRecord, "organizationId" | "id" | "domain" | "personId" | "analysisRunIds">): Promise<DeliverySkip | null> {
  const exclude = { excludeMessageId: message.id }
  if (message.domain === "MONITORING") {
    for (const runId of message.analysisRunIds) {
      const interactionId = (await memory.getRun(message.organizationId, runId))?.interactionId
      if (!interactionId) continue
      const existing = await memory.deliveredMonitoringOf(message.organizationId, interactionId, exclude)
      if (existing) return { reason: CALL_ALREADY_MONITORED, interactionId, existing }
    }
    return null
  }
  const keys: string[] = []
  for (const runId of message.analysisRunIds) {
    const stored = await memory.getIndicatorInvestigationByRun(message.organizationId, runId)
    if (stored) keys.push(indicatorPeriodKey(stored.investigation.official.code, stored.investigation.official.periodStart, stored.investigation.official.periodEnd))
  }
  if (keys.length === 0) return null
  const delivered = await memory.deliveredIndicatorPeriods(message.organizationId, message.personId, exclude)
  const overlap = [...new Set(keys)].filter((key) => delivered.has(key))
  return overlap.length > 0 ? { reason: PERIOD_ALREADY_DELIVERED, periods: overlap } : null
}
