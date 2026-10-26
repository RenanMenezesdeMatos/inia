import { createHash } from "node:crypto"
import { redactEvidentPii } from "../../investigation/domain/peer-privacy-projection.js"
import { argumentScriptSource, documentSource } from "../domain/obligation-sources.js"
import type { SyntheticCorpus } from "../domain/synthetic-corpus.js"
import type { CallCorpus } from "../application/ports.js"

/**
 * CORPUS SINTÉTICO — a mesma porta do corpus real, lida do dataset fictício. Nenhuma linha de `interactions`, `people` ou
 * `employee_indicator_performance` é tocada. O texto vai ao modelo com a MESMA máscara de PII da produção (o dataset tem CPF e
 * protocolo fictícios justamente para provar a máscara nas evidências).
 */
export function createSyntheticCallCorpus(corpus: SyntheticCorpus, input: { indicatorCode: string; datasetLabel: string }): CallCorpus {
  const operatorRefs = new Set(corpus.operators.map((operator) => operator.ref))
  return {
    origin: "SYNTHETIC",
    populationLabel: `${corpus.populationLabel} · ${input.datasetLabel} (sintético)`,
    async operators() {
      return corpus.operators.map((operator) => ({ ref: operator.ref, personId: null, name: operator.name }))
    },
    async quartiles(_indicatorDefinitionId, referencePeriods) {
      return corpus.results.filter((row) => row.indicatorCode === input.indicatorCode && referencePeriods.includes(row.referencePeriod) && operatorRefs.has(row.operatorRef)).map((row) => ({ operatorRef: row.operatorRef, referencePeriod: row.referencePeriod, quartile: row.quartile }))
    },
    async calls(refs, window, channel) {
      const wanted = new Set(refs)
      const start = new Date(`${window.start}T00:00:00Z`).getTime()
      const end = new Date(`${window.endExclusive}T00:00:00Z`).getTime()
      return corpus.calls
        .filter((call) => wanted.has(call.operatorRef) && (channel === null || call.channel === channel))
        .filter((call) => {
          const time = new Date(call.occurredAt).getTime()
          return time >= start && time < end
        })
        .map((call) => ({ ref: call.ref, interactionId: null, personId: null, operatorRef: call.operatorRef, reason: call.reason, subReason: call.subReason, channel: call.channel, occurredAt: new Date(call.occurredAt), durationSeconds: call.durationSeconds, hasTranscript: call.transcript.trim().length > 0 }))
    },
    async callSignals(callRefs, signal) {
      const wanted = new Set(callRefs)
      const out = new Map<string, { boolean: boolean | null; numeric: number | null }>()
      for (const call of corpus.calls) {
        const value = wanted.has(call.ref) ? call.signals?.[signal.flagName] : undefined
        if (value !== undefined) out.set(call.ref, { boolean: typeof value === "boolean" ? value : null, numeric: typeof value === "number" ? value : null })
      }
      return out
    },
    async transcripts(callRefs) {
      const wanted = new Set(callRefs)
      return new Map(corpus.calls.filter((call) => wanted.has(call.ref) && call.transcript.trim().length > 0).map((call) => {
        const content = redactEvidentPii(call.transcript).text
        return [call.ref, { content, checksum: createHash("sha256").update(content).digest("hex").slice(0, 16) }] as const
      }))
    },
    async obligationSources() {
      const sources = [
        ...corpus.obligations.documents.map((document, index) => documentSource(`D${index + 1}`, { sourceId: document.id, title: document.title, version: document.version, content: document.content })),
        ...corpus.obligations.argumentScripts.map((script, index) => argumentScriptSource(`G${index + 1}`, { sourceId: script.id, title: script.name, version: script.version, items: script.items })),
      ]
      return { sources: sources.filter((source) => source.lines.length > 0), omitted: [] }
    },
  }
}
