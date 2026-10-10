import { randomUUID } from "node:crypto"
import type { GenerationRecord, GenerationRegistry, NewGeneration } from "../application/generate-interaction-feedback.js"
import type { InteractionFeedbackStatus } from "../../investigation/domain/interaction-feedback.js"

type Row = GenerationRecord & NewGeneration & { claimedUntil: Date | null; lastError: string | null }

/** Registro em memória com a MESMA semântica do Postgres (posse atômica, retomada de FAILED/lease vencida, seleção por matrícula). */
export function createInMemoryFeedbackGenerationRegistry(options: { completedRuns?: () => { generationId: string | null; runId: string; status: InteractionFeedbackStatus; writerInvoked: boolean; completed: boolean }[] } = {}) {
  const rows = new Map<string, Row>()
  const keyOf = (organizationId: string, generationKey: string) => `${organizationId}|${generationKey}`
  const snapshot = (row: Row): GenerationRecord => ({ id: row.id, organizationId: row.organizationId, generationKey: row.generationKey, interactionId: row.interactionId, status: row.status, runId: row.runId, outcome: structuredClone(row.outcome), attempts: row.attempts })
  const registry: GenerationRegistry = {
    async claim(input, now, leaseSeconds) {
      const key = keyOf(input.organizationId, input.generationKey)
      const existing = rows.get(key)
      const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000)
      if (!existing) {
        const row: Row = { ...structuredClone(input), id: randomUUID(), status: "PENDING", runId: null, outcome: null, attempts: 1, claimedUntil: leaseUntil, lastError: null }
        rows.set(key, row)
        return { kind: "OWNED", generation: snapshot(row) }
      }
      if (existing.status === "RESERVED" || existing.status === "FAILED" || (existing.status === "PENDING" && existing.claimedUntil !== null && existing.claimedUntil < now)) {
        Object.assign(existing, { status: "PENDING", claimedUntil: leaseUntil, attempts: existing.attempts + 1, lastError: null })
        return { kind: "OWNED", generation: snapshot(existing) }
      }
      return existing.status === "COMPLETED" ? { kind: "COMPLETED", generation: snapshot(existing) } : { kind: "IN_PROGRESS", generation: snapshot(existing) }
    },
    async findCompletedRun(_organizationId, generationId) {
      const run = (options.completedRuns?.() ?? []).find((entry) => entry.generationId === generationId && entry.completed)
      return run ? { runId: run.runId, status: run.status, writerInvoked: run.writerInvoked } : null
    },
    async complete(organizationId, generationId, runId, outcome) {
      const row = [...rows.values()].find((entry) => entry.id === generationId && entry.organizationId === organizationId && entry.status === "PENDING")
      if (row) Object.assign(row, { status: "COMPLETED", runId, outcome: structuredClone(outcome), claimedUntil: null })
    },
    async fail(organizationId, generationId, error) {
      const row = [...rows.values()].find((entry) => entry.id === generationId && entry.organizationId === organizationId && entry.status === "PENDING")
      if (row) Object.assign(row, { status: "FAILED", lastError: error, claimedUntil: null })
    },
    async listSelection(input) {
      return [...rows.values()]
        .filter((row) => row.organizationId === input.organizationId && row.intent.workflowId === input.workflowId && row.intent.nodeId === input.nodeId && row.intent.enrollmentId === input.enrollmentId)
        .sort((a, b) => (a.selection.rank ?? Number.MAX_SAFE_INTEGER) - (b.selection.rank ?? Number.MAX_SAFE_INTEGER))
        .map((row) => row.interactionId)
    },
    async selectedInteractionIds(input) {
      return [...rows.values()].filter((row) => row.organizationId === input.organizationId && row.intent.workflowId === input.workflowId && row.intent.nodeId === input.nodeId && row.status !== "FAILED").map((row) => row.interactionId)
    },
    async reserveSelection(list) {
      for (const input of list) {
        const key = keyOf(input.organizationId, input.generationKey)
        const existing = rows.get(key)
        if (!existing) rows.set(key, { ...structuredClone(input), id: randomUUID(), status: "RESERVED", runId: null, outcome: null, attempts: 0, claimedUntil: null, lastError: null })
        else if (existing.status === "FAILED") Object.assign(existing, { status: "RESERVED", intent: { ...existing.intent, enrollmentId: input.intent.enrollmentId, workflowVersionId: input.intent.workflowVersionId }, selection: structuredClone(input.selection) })
      }
    },
  }
  return { registry, rows }
}
