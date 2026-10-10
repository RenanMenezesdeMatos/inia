import { overlaySnapshots, practiceLineKeysOf } from "../domain/memory-queries.js"
import type { FeedbackMemoryStore, FeedbackMessageStore } from "../application/ports.js"
import type { createInMemoryFeedbackMemoryStore } from "./in-memory-feedback-memory-store.js"

/**
 * MEMÓRIA SOBREPOSTA (ensaio, QA Lab, "Testar diagnóstico"): lê a memória REAL (banco somente leitura) e grava na RAM.
 *   - reuso: uma análise/investigação CONCLUÍDA no banco com a mesma chave é reutilizada (nenhuma chamada de modelo);
 *   - leitura: a leitura da RAM substitui a do banco para a MESMA chamada; o resto do banco continua valendo — a investigação
 *     enxerga as análises que o próprio ensaio acabou de produzir (antes, elas ficavam na RAM e as consultas iam ao banco);
 *   - escrita: só na RAM. Mensagens, entrega e ciência nunca tocam o banco.
 */
type Overlay = ReturnType<typeof createInMemoryFeedbackMemoryStore>
export type OverlayStores = FeedbackMemoryStore & FeedbackMessageStore & { markDelivered(organizationId: string, messageId: string, at: Date): Promise<void>; overlay: Overlay }

export function createOverlayFeedbackMemoryStore(base: FeedbackMemoryStore & Pick<FeedbackMessageStore, "getMessage">, overlay: Overlay): OverlayStores {
  const practiceMemberships: FeedbackMemoryStore["practiceMemberships"] = async (organizationId, lineKeys) => {
    const fromOverlay = await overlay.practiceMemberships(organizationId, lineKeys)
    const missing = lineKeys.filter((lineKey) => !fromOverlay.has(lineKey))
    const fromBase = missing.length > 0 ? await base.practiceMemberships(organizationId, missing) : new Map()
    return new Map([...fromBase, ...fromOverlay])
  }
  return {
    overlay,
    async claimAnalysis(identity, now, leaseSeconds) {
      const reused = await base.findCompletedByReuseKey(identity.organizationId, identity.kind, identity.analysisKey)
      if (reused) return { kind: "COMPLETED", run: reused }
      return overlay.claimAnalysis(identity, now, leaseSeconds)
    },
    completeCallAnalysis: (...args) => overlay.completeCallAnalysis(...args),
    completeIndicatorInvestigation: (...args) => overlay.completeIndicatorInvestigation(...args),
    completeInsufficient: (...args) => overlay.completeInsufficient(...args),
    failAnalysis: (...args) => overlay.failAnalysis(...args),
    suspendCallAnalysis: (...args) => overlay.suspendCallAnalysis(...args),
    async findStageResponses(organizationId, query) {
      // Respostas já pagas no banco valem (somente leitura); as do ensaio vêm antes.
      return [...(await overlay.findStageResponses(organizationId, query)), ...(await base.findStageResponses(organizationId, query))]
    },
    async pendingReviewInteractions(organizationId, interactionIds) {
      // Pendente no banco e ainda não resolvido no ensaio; pendente no ensaio.
      const settledHere = new Set((await overlay.currentMemory(organizationId, { personIds: [], interactionIds })).assessments.map((assessment) => assessment.interactionId))
      const fromBase = [...(await base.pendingReviewInteractions(organizationId, interactionIds))].filter((id) => !settledHere.has(id))
      return new Set([...fromBase, ...(await overlay.pendingReviewInteractions(organizationId, interactionIds))])
    },
    async getRun(organizationId, runId) {
      return (await overlay.getRun(organizationId, runId)) ?? base.getRun(organizationId, runId)
    },
    async getCallAssessmentByRun(organizationId, runId) {
      return (await overlay.getCallAssessmentByRun(organizationId, runId)) ?? base.getCallAssessmentByRun(organizationId, runId)
    },
    async getIndicatorInvestigationByRun(organizationId, runId) {
      return (await overlay.getIndicatorInvestigationByRun(organizationId, runId)) ?? base.getIndicatorInvestigationByRun(organizationId, runId)
    },
    async resolveCriteria(organizationId, document, previous) {
      // Identidade já persistida no banco para esta versão: a mesma (séries comparáveis); senão, reconciliada na RAM.
      const persisted = await base.loadCriteria(organizationId, document.documentId, document.version)
      if (persisted && document.lines.every((line) => persisted.some((entry) => entry.lineKey === line.lineKey))) return new Map(persisted.map((entry) => [entry.lineKey, { lineKey: entry.lineKey, criterionKey: entry.criterionKey, basis: "UNCHANGED" as const, previousCriterionKey: null }]))
      return overlay.resolveCriteria(organizationId, document, previous)
    },
    async loadCriteria(organizationId, documentId, version) {
      return (await overlay.loadCriteria(organizationId, documentId, version)) ?? base.loadCriteria(organizationId, documentId, version)
    },
    async criterionHistory(organizationId, personId, criterionKeys, input) {
      const query = { personIds: [personId], window: { start: input.since, end: input.until } }
      const snapshot = overlaySnapshots(await base.currentMemory(organizationId, query), await overlay.currentMemory(organizationId, query))
      return criterionKeys.flatMap((criterionKey) => {
        const rows = snapshot.criteria.filter((row) => row.criterionKey === criterionKey && row.interactionId !== input.excludeInteractionId)
        if (rows.length === 0) return []
        const count = (statuses: string[]) => rows.filter((row) => statuses.includes(row.status)).length
        return [{ criterionKey, assessed: count(["MET", "NOT_MET", "PARTIAL"]), met: count(["MET"]), notMet: count(["NOT_MET"]), partial: count(["PARTIAL"]), inconclusive: count(["NOT_OBSERVABLE", "NOT_ASSESSED"]), lastDates: [...new Set(rows.map((row) => row.localDate))].sort().reverse().slice(0, 5) }]
      })
    },
    async deliveredMonitoringOf(organizationId, interactionId, options) {
      return (await base.deliveredMonitoringOf(organizationId, interactionId, options)) ?? (await overlay.deliveredMonitoringOf(organizationId, interactionId, options))
    },
    async deliveredIndicatorPeriods(organizationId, personId, options) {
      return new Set([...(await base.deliveredIndicatorPeriods(organizationId, personId, options)), ...(await overlay.deliveredIndicatorPeriods(organizationId, personId, options))])
    },
    async deliveredFindings(organizationId, personId, findingKeys) {
      return [...(await base.deliveredFindings(organizationId, personId, findingKeys)), ...(await overlay.deliveredFindings(organizationId, personId, findingKeys))]
    },
    async deliveredPractices(organizationId, personId, practiceKeys, before) {
      const all = [...(await base.deliveredPractices(organizationId, personId, practiceKeys, before)), ...(await overlay.deliveredPractices(organizationId, personId, practiceKeys, before))]
      const latest = new Map<string, Date>()
      for (const entry of all) if (!latest.has(entry.practiceKey) || latest.get(entry.practiceKey)! < entry.deliveredAt) latest.set(entry.practiceKey, entry.deliveredAt)
      return [...latest.entries()].map(([practiceKey, deliveredAt]) => ({ practiceKey, deliveredAt }))
    },
    async currentMemory(organizationId, query) {
      const snapshot = overlaySnapshots(await base.currentMemory(organizationId, query), await overlay.currentMemory(organizationId, query))
      // A prática que o ensaio organizou (RAM) vale também para as leituras do banco, e a do banco vale para as leituras da RAM.
      const lineKeys = [...new Set(snapshot.criteria.flatMap((row) => practiceLineKeysOf(row)))]
      if (lineKeys.length === 0) return snapshot
      const known = await practiceMemberships(organizationId, lineKeys)
      return {
        ...snapshot,
        criteria: snapshot.criteria.map((row) => {
          const practice = practiceLineKeysOf(row).map((lineKey) => known.get(lineKey)).find((entry) => entry?.practiceKey)
          if (!practice?.practiceKey) return row
          const next = { ...row, practiceKey: practice.practiceKey }
          delete next.practiceTitle
          return { ...next, ...(practice.title ? { practiceTitle: practice.title } : {}) }
        }),
      }
    },
    practiceMemberships,
    async practiceCatalog(organizationId) {
      const known = await base.practiceCatalog(organizationId)
      const keys = new Set(known.map((practice) => practice.practiceKey))
      return [...known, ...(await overlay.practiceCatalog(organizationId)).filter((practice) => !keys.has(practice.practiceKey))]
    },
    savePracticeAssignments: (...args) => overlay.savePracticeAssignments(...args),
    // Temas (`PRACTICE_THEMES_V1`): o ensaio agrupa só as práticas que ELE criou (as do banco são agrupadas pela produção); o catálogo
    // de temas é o do banco mais os que o ensaio criou.
    practicesWithoutTheme: (...args) => overlay.practicesWithoutTheme(...args),
    async practiceThemeCatalog(organizationId) {
      const known = await base.practiceThemeCatalog(organizationId)
      const keys = new Set(known.map((theme) => theme.themeKey))
      return [...known, ...(await overlay.practiceThemeCatalog(organizationId)).filter((theme) => !keys.has(theme.themeKey))]
    },
    savePracticeThemes: (...args) => overlay.savePracticeThemes(...args),
    async findCompletedByReuseKey(organizationId, kind, key) {
      return (await overlay.findCompletedByReuseKey(organizationId, kind, key)) ?? base.findCompletedByReuseKey(organizationId, kind, key)
    },
    claimMessage: (...args) => overlay.claimMessage(...args),
    completeMessage: (...args) => overlay.completeMessage(...args),
    failMessage: (...args) => overlay.failMessage(...args),
    getMessage: (...args) => overlay.getMessage(...args),
    markDelivered: (...args) => overlay.markDelivered(...args),
  }
}
