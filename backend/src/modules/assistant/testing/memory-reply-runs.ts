import { createLocalReplyCancellations, replyInProgress, replyRunKeyOf, type ReplyRunRegistry, type ReplyRunStart } from "../application/assistant-reply-runs.js"

/** Registro de respostas em andamento em memória (testes): mesmas regras, sem batimento. */
export function createMemoryReplyRunRegistry(): ReplyRunRegistry & { runs: Map<string, ReplyRunStart & { label: string | null; startedAt: Date }> } {
  const local = createLocalReplyCancellations()
  const runs = new Map<string, ReplyRunStart & { label: string | null; startedAt: Date }>()
  return {
    runs,
    async start(input) {
      if (runs.has(replyRunKeyOf(input))) throw replyInProgress()
      const controller = local.open(input)
      const run = { ...input, label: null as string | null, startedAt: new Date() }
      runs.set(replyRunKeyOf(input), run)
      return {
        signal: controller.signal,
        stage: (label) => void (run.label = label),
        async finish() {
          local.close(input, controller)
          if (runs.get(replyRunKeyOf(input)) === run) runs.delete(replyRunKeyOf(input))
        },
      }
    },
    async inFlight(input) {
      return [...runs.values()].filter((run) => run.organizationId === input.organizationId && run.ownerPersonId === input.ownerPersonId).length
    },
    async requestCancel(key) {
      return local.cancel(key)
    },
    async pending(input) {
      const found = [...runs.values()]
        .filter((run) => run.organizationId === input.organizationId && run.ownerPersonId === input.ownerPersonId && run.conversationId === input.conversationId)
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0]
      return found ? { questionInteractionId: found.questionInteractionId, clientMessageId: found.clientMessageId, label: found.label, startedAt: found.startedAt.toISOString() } : null
    },
  }
}
