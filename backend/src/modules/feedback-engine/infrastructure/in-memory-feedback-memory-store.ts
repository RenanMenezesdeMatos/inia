import { randomUUID } from "node:crypto"
import { indicatorPeriodKey } from "../domain/delivery-guards.js"
import { criterionKeyOf, obligationCriterionKeyOf, reconcileCriteria, type CriterionIdentity, type PersistedCriterion } from "../domain/criteria-identity.js"
import type { AnalysisRunRecord, CallSnapshot, FeedbackMemoryStore, FeedbackMessageStore, MessageRecord, StoredCallAssessment } from "../application/ports.js"
import type { VerifiedCallAnalysis } from "../domain/call-analysis.js"
import type { IndicatorInvestigation } from "../domain/indicator-investigation.js"
import type { MemoryCriterionRow, MemorySnapshot } from "../domain/memory-queries.js"
import { checkpointOf, isLegacyPendingOutcome, stageResponsesOf, type StageResponses } from "../domain/analysis-recovery.js"
import type { CatalogPractice, PracticeAssignment } from "../domain/practice-identity.js"
import type { CatalogTheme } from "../domain/practice-themes.js"

/** Prática na memória de teste: título da conduta e, depois de agrupada (`PRACTICE_THEMES_V1`), tema e nome curto. */
type InMemoryPractice = { title: string; createdAt: Date; shortTitle?: string; themeKey?: string; themedAt?: Date }

/**
 * Memória EM MEMÓRIA (QA Lab e testes): mesmo contrato da porta, mesmas regras de posse, reuso e supersessão — nada é gravado
 * no banco. O QA Lab simula a execução inteira (análise, mensagem, publicação) sem deixar rastro na memória real.
 */
type StoredAssessment = StoredCallAssessment & { procedureId: string | null; asOf: Date; logicVersion: string | null; titles: Record<string, string>; criteria: { key: string; anchorKey?: string; lineKey: string; status: string; current: boolean; asOf: Date; personId: string; occurredAt: Date; ruleConflict: boolean; interactionId: string }[] }

export function createInMemoryFeedbackMemoryStore(): FeedbackMemoryStore & FeedbackMessageStore & { markDelivered(organizationId: string, messageId: string, at: Date): Promise<void>; runs: Map<string, AnalysisRunRecord & { claimedUntil: Date | null }>; assessments: StoredAssessment[]; messages: Map<string, MessageRecord & { deliveredAt: Date | null; claimedUntil: Date | null }>; investigations: { id: string; runId: string; investigation: IndicatorInvestigation; current: boolean; asOf: Date; personId: string }[]; practices: Map<string, InMemoryPractice>; memberships: Map<string, PracticeAssignment & { at: Date }>; themes: Map<string, { title: string; createdAt: Date }> } {
  const runs = new Map<string, AnalysisRunRecord & { claimedUntil: Date | null }>()
  const assessments: StoredAssessment[] = []
  const investigations: { id: string; runId: string; investigation: IndicatorInvestigation; current: boolean; asOf: Date; personId: string }[] = []
  const criteria = new Map<string, PersistedCriterion[]>()
  const messages = new Map<string, MessageRecord & { deliveredAt: Date | null; claimedUntil: Date | null }>()
  // `PRACTICE_IDENTITY_V1`: práticas (ordem de criação) e a decisão de cada linha (practiceKey null = a linha não pede conduta).
  const practices = new Map<string, InMemoryPractice>()
  const memberships = new Map<string, PracticeAssignment & { at: Date }>()
  // `PRACTICE_THEMES_V1`: temas (ordem de criação); o tema e o nome curto de cada prática ficam na própria prática.
  const themes = new Map<string, { title: string; createdAt: Date }>()
  // A prática de uma obrigação: a da primeira das suas linhas (âncora, depois as de origem) que pede conduta.
  const practiceOfLines = (lineKeys: readonly string[]) => {
    const member = lineKeys.map((lineKey) => memberships.get(lineKey)).find((entry) => entry?.practiceKey)
    return member?.practiceKey ? { practiceKey: member.practiceKey, title: practices.get(member.practiceKey)?.title ?? null } : null
  }
  const byKey = (organizationId: string, key: string) => [...runs.values()].find((run) => run.organizationId === organizationId && run.analysisKey === key)

  return {
    runs,
    assessments,
    messages,
    investigations,
    practices,
    memberships,
    themes,
    async claimAnalysis(identity, now, leaseSeconds) {
      const existing = byKey(identity.organizationId, identity.analysisKey)
      if (existing) {
        if (existing.status === "COMPLETED") return { kind: "COMPLETED", run: existing }
        if (existing.status === "RUNNING" && existing.claimedUntil && existing.claimedUntil > now) return { kind: "IN_PROGRESS" }
        existing.status = "RUNNING"
        existing.claimedUntil = new Date(now.getTime() + leaseSeconds * 1000)
        existing.asOf = identity.asOf
        existing.trigger = identity.trigger
        return { kind: "CLAIMED", runId: existing.id }
      }
      const id = randomUUID()
      runs.set(id, { ...identity, id, status: "RUNNING", outcome: null, outcomeReasons: [], provenance: {}, result: null, metrics: {}, completedAt: null, claimedUntil: new Date(now.getTime() + leaseSeconds * 1000) })
      return { kind: "CLAIMED", runId: id }
    },
    async completeCallAnalysis(_organizationId, runId, data, now) {
      const run = runs.get(runId)!
      Object.assign(run, { status: "COMPLETED", outcome: data.analysis.outcome, outcomeReasons: data.analysis.outcomeReasons, result: data.analysis, provenance: data.provenance, metrics: data.metrics, completedAt: now, claimedUntil: null })
      const procedureId = data.analysis.scenario.procedureDocumentId
      const newer = assessments.some((entry) => entry.snapshot.interactionId === data.snapshot.interactionId && entry.procedureId === procedureId && entry.isCurrent && entry.asOf > run.asOf)
      const current = !newer
      if (current) for (const entry of assessments.filter((item) => item.snapshot.interactionId === data.snapshot.interactionId && item.procedureId === procedureId && item.isCurrent)) {
        entry.isCurrent = false
        entry.criteria.forEach((row) => (row.current = false))
      }
      const criterionKeys: Record<string, string> = {}
      const rows: StoredAssessment["criteria"] = []
      for (const criterion of data.analysis.criteria) {
        const parentKey = criterion.obligation ? data.identities.get(criterion.obligation.parentLineKey)?.criterionKey ?? criterion.argument?.criterionKey ?? criterionKeyOf(criterion.obligation.parentLineKey) : null
        const identity = criterion.identityKey ? { criterionKey: criterion.identityKey } : parentKey && criterion.obligation ? { criterionKey: obligationCriterionKeyOf(parentKey, criterion.obligation.part) } : data.identities.get(criterion.lineKey) ?? { criterionKey: criterion.argument?.criterionKey ?? criterionKeyOf(criterion.lineKey) }
        criterionKeys[criterion.lineKey] = identity.criterionKey
        let rowCurrent = current
        if (current) {
          const blocking = assessments.some((entry) => entry.criteria.some((row) => row.interactionId === data.snapshot.interactionId && row.key === identity.criterionKey && row.current && row.asOf > run.asOf))
          if (blocking) rowCurrent = false
          else assessments.forEach((entry) => entry.criteria.forEach((row) => { if (row.interactionId === data.snapshot.interactionId && row.key === identity.criterionKey) row.current = false }))
        }
        const anchor = criterion.argument ? undefined : data.identities.get(criterion.lineKey.split("#")[0]!)?.criterionKey
        rows.push({ key: identity.criterionKey, ...(anchor ? { anchorKey: anchor } : {}), lineKey: criterion.lineKey, status: criterion.status, current: rowCurrent, asOf: run.asOf, personId: data.snapshot.personId, occurredAt: data.snapshot.occurredAt, ruleConflict: criterion.ruleConflict, interactionId: data.snapshot.interactionId })
      }
      const id = randomUUID()
      const provenance = data.provenance as { documents?: { documentId: string; title: string }[]; argumentScripts?: { scriptId: string; name: string }[] }
      const titles = Object.fromEntries([...(provenance.documents ?? []).map((document) => [document.documentId, document.title]), ...(provenance.argumentScripts ?? []).map((script) => [script.scriptId, `Argumentário: ${script.name}`])])
      assessments.push({ id, analysisRunId: runId, isCurrent: current, snapshot: data.snapshot as CallSnapshot, analysis: data.analysis as VerifiedCallAnalysis, criterionKeys, procedureId, asOf: run.asOf, logicVersion: run.logicVersion, titles, criteria: rows })
      return { callAssessmentId: id, current }
    },
    async completeIndicatorInvestigation(_organizationId, runId, data, now) {
      const run = runs.get(runId)!
      Object.assign(run, { status: "COMPLETED", outcome: "USABLE", outcomeReasons: [data.investigation.conclusion], result: data.investigation, provenance: data.provenance, metrics: data.metrics, completedAt: now, claimedUntil: null })
      // Interrompida pelo orçamento: fica no histórico, mas a chave é liberada (a próxima execução investiga de novo).
      if (data.reusable === false) run.analysisKey = `${run.analysisKey}:INCOMPLETE:${run.id}`
      const official = data.investigation.official
      const sameScope = (entry: (typeof investigations)[number]) => entry.personId === run.personId && entry.investigation.official.indicatorId === official.indicatorId && entry.investigation.official.sourceKind === official.sourceKind && entry.investigation.official.periodStart === official.periodStart && entry.investigation.official.periodEnd === official.periodEnd
      // Mesma regra do banco: uma execução ANTIGA que termina depois nunca substitui a vigente mais nova.
      const current = !investigations.some((entry) => entry.current && sameScope(entry) && entry.asOf > run.asOf)
      if (current) investigations.filter((entry) => entry.current && sameScope(entry)).forEach((entry) => (entry.current = false))
      const id = randomUUID()
      investigations.push({ id, runId, investigation: data.investigation, current, asOf: run.asOf, personId: run.personId })
      return { investigationId: id, current }
    },
    async completeInsufficient(_organizationId, runId, outcome, now) {
      Object.assign(runs.get(runId)!, { status: "COMPLETED", outcome: "INSUFFICIENT_EVIDENCE", outcomeReasons: outcome.outcomeReasons, result: outcome.result, completedAt: now, claimedUntil: null })
    },
    async failAnalysis(_organizationId, runId, _error, now) {
      const run = runs.get(runId)
      if (run && run.status === "RUNNING") Object.assign(run, { status: "FAILED", completedAt: now, claimedUntil: null })
    },
    async suspendCallAnalysis(_organizationId, runId, data, now) {
      const run = runs.get(runId)
      if (run && run.status === "RUNNING") Object.assign(run, { status: "FAILED", result: { checkpoint: data.checkpoint }, provenance: data.provenance, metrics: data.metrics, completedAt: now, claimedUntil: null })
    },
    async findStageResponses(organizationId, query) {
      return [...runs.values()]
        .filter((run) => run.organizationId === organizationId && run.kind === "CALL_ANALYSIS" && run.interactionId === query.interactionId && ((run.provenance as { proposalKey?: string }).proposalKey === query.proposalKey || query.legacyAnalysisKeys.includes(run.analysisKey)))
        .map((run): StageResponses => ({ runId: run.id, status: run.status, ...stageResponsesOf(run.provenance), at: run.completedAt ?? run.asOf }))
        .filter((entry) => entry.analysis || entry.review)
        .sort((a, b) => b.at.getTime() - a.at.getTime())
    },
    async pendingReviewInteractions(organizationId, interactionIds) {
      const pending = new Set<string>()
      for (const run of runs.values()) {
        if (run.organizationId !== organizationId || run.kind !== "CALL_ANALYSIS" || !run.interactionId || !interactionIds.includes(run.interactionId)) continue
        const settled = assessments.some((entry) => entry.snapshot.interactionId === run.interactionId && entry.isCurrent && !isLegacyPendingOutcome(entry.analysis.outcomeReasons) && entry.asOf >= run.asOf)
        if (run.status === "FAILED" && checkpointOf(run.result) && !settled) pending.add(run.interactionId)
        if (run.status === "COMPLETED" && isLegacyPendingOutcome(run.outcomeReasons) && assessments.some((entry) => entry.analysisRunId === run.id && entry.isCurrent)) pending.add(run.interactionId)
      }
      return pending
    },
    async getRun(organizationId, runId) {
      const run = runs.get(runId)
      return run && run.organizationId === organizationId ? run : null
    },
    async getCallAssessmentByRun(_organizationId, runId) {
      const found = [...assessments].reverse().find((entry) => entry.analysisRunId === runId)
      return found ? { id: found.id, analysisRunId: found.analysisRunId, isCurrent: found.isCurrent, snapshot: found.snapshot, analysis: found.analysis, criterionKeys: found.criterionKeys } : null
    },
    async getIndicatorInvestigationByRun(_organizationId, runId) {
      const found = [...investigations].reverse().find((entry) => entry.runId === runId)
      return found ? { id: found.id, investigation: found.investigation } : null
    },
    async resolveCriteria(_organizationId, document, previous) {
      const key = `${document.documentId}@${document.version}`
      if (!criteria.has(key)) {
        const priorVersions = [...criteria.keys()].filter((entry) => entry.startsWith(`${document.documentId}@`)).map((entry) => Number(entry.split("@")[1])).filter((version) => version < document.version).sort((a, b) => b - a)
        let prior = priorVersions[0] !== undefined ? criteria.get(`${document.documentId}@${priorVersions[0]}`)! : null
        if (!prior) {
          const loaded = await previous()
          if (loaded) {
            const identities = reconcileCriteria(loaded.lines, null)
            prior = loaded.lines.map((line, index) => ({ lineKey: line.lineKey, criterionKey: identities[index]!.criterionKey, heading: line.heading, text: line.text, position: line.position }))
            criteria.set(`${document.documentId}@${loaded.version}`, prior)
          }
        }
        const identities = reconcileCriteria(document.lines, prior)
        criteria.set(key, document.lines.map((line, index) => ({ lineKey: line.lineKey, criterionKey: identities[index]!.criterionKey, heading: line.heading, text: line.text, position: line.position, basis: identities[index]!.basis, previous: identities[index]!.previousCriterionKey, reasons: identities[index]!.changeReasons ?? [] } as PersistedCriterion)))
      }
      return new Map(criteria.get(key)!.map((entry) => {
        const extra = entry as unknown as { basis?: CriterionIdentity["basis"]; previous?: string | null; reasons?: CriterionIdentity["changeReasons"] }
        return [entry.lineKey, { lineKey: entry.lineKey, criterionKey: entry.criterionKey, basis: extra.basis ?? "FIRST_SEEN", previousCriterionKey: extra.previous ?? null, ...(extra.reasons && extra.reasons.length > 0 ? { changeReasons: extra.reasons } : {}) }]
      }))
    },
    async loadCriteria(_organizationId, documentId, version) {
      return criteria.get(`${documentId}@${version}`) ?? null
    },
    async criterionHistory(_organizationId, personId, criterionKeys, input) {
      const rows = assessments.flatMap((entry) => entry.criteria).filter((row) => row.current && !row.ruleConflict && row.personId === personId && criterionKeys.includes(row.key) && row.interactionId !== input.excludeInteractionId && row.occurredAt >= input.since && row.occurredAt < input.until)
      return criterionKeys.flatMap((key) => {
        const own = rows.filter((row) => row.key === key)
        if (own.length === 0) return []
        const count = (statuses: string[]) => own.filter((row) => statuses.includes(row.status)).length
        return [{ criterionKey: key, assessed: count(["MET", "NOT_MET", "PARTIAL"]), met: count(["MET"]), notMet: count(["NOT_MET"]), partial: count(["PARTIAL"]), inconclusive: count(["NOT_OBSERVABLE", "NOT_ASSESSED"]), lastDates: [] }]
      })
    },
    async deliveredFindings(organizationId, personId, findingKeys) {
      return [...messages.values()].filter((message) => message.organizationId === organizationId && message.personId === personId && message.status === "PUBLISHABLE" && message.deliveredAt).flatMap((message) => message.findingKeys.filter((key) => findingKeys.includes(key)).map((findingKey) => ({ findingKey, messageId: message.id, deliveredAt: message.deliveredAt })))
    },
    async deliveredMonitoringOf(organizationId, interactionId, options) {
      const delivered = [...messages.values()]
        .filter((message) => message.id !== options?.excludeMessageId && message.organizationId === organizationId && message.domain === "MONITORING" && message.status === "PUBLISHABLE" && message.deliveredAt && message.analysisRunIds.some((runId) => runs.get(runId)?.interactionId === interactionId))
        .sort((a, b) => a.deliveredAt!.getTime() - b.deliveredAt!.getTime())[0]
      return delivered ? { source: "ENGINE_MESSAGE", id: delivered.id, deliveredAt: delivered.deliveredAt! } : null
    },
    async deliveredIndicatorPeriods(organizationId, personId, options) {
      const keys = new Set<string>()
      for (const message of messages.values()) {
        if (message.id === options?.excludeMessageId || message.organizationId !== organizationId || message.personId !== personId || message.domain !== "INDICATOR" || message.status !== "PUBLISHABLE" || !message.deliveredAt) continue
        for (const entry of investigations.filter((candidate) => message.analysisRunIds.includes(candidate.runId))) keys.add(indicatorPeriodKey(entry.investigation.official.code, entry.investigation.official.periodStart, entry.investigation.official.periodEnd))
      }
      return keys
    },
    async deliveredPractices(organizationId, personId, practiceKeys, before) {
      const latest = new Map<string, Date>()
      for (const message of messages.values()) {
        if (message.organizationId !== organizationId || message.personId !== personId || message.status !== "PUBLISHABLE" || !message.deliveredAt || message.deliveredAt >= before) continue
        for (const finding of message.brief?.developments ?? []) {
          if (!message.findingKeys.includes(finding.findingKey)) continue
          for (const stored of finding.practiceKeys ?? []) {
            // Chave antiga da linha-âncora (KC-<linha>) → a prática da linha, quando já organizada.
            const key = (stored.startsWith("KC-") ? memberships.get(stored.slice(3))?.practiceKey : null) ?? stored
            if (practiceKeys.includes(key) && (!latest.has(key) || latest.get(key)! < message.deliveredAt)) latest.set(key, message.deliveredAt)
          }
        }
      }
      return [...latest.entries()].map(([practiceKey, deliveredAt]) => ({ practiceKey, deliveredAt }))
    },
    async currentMemory(organizationId, query): Promise<MemorySnapshot> {
      const localDate = (at: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at)
      const selected = assessments.filter((entry) => entry.isCurrent && runs.get(entry.analysisRunId)?.organizationId === organizationId && (query.personIds.length === 0 || query.personIds.includes(entry.snapshot.personId)) && (!query.window || (entry.snapshot.occurredAt >= query.window.start && entry.snapshot.occurredAt < query.window.end)) && (!query.interactionIds || query.interactionIds.includes(entry.snapshot.interactionId)))
      const segmentOf = (entry: StoredAssessment) => entry.snapshot.subjectCanonical ?? (entry.snapshot.subjectRaw?.trim() || null)
      return {
        assessments: selected.map((entry) => ({ callAssessmentId: entry.id, analysisRunId: entry.analysisRunId, interactionId: entry.snapshot.interactionId, personId: entry.snapshot.personId, occurredAt: entry.snapshot.occurredAt, asOf: entry.asOf, segmentKey: segmentOf(entry), pathAssessment: entry.analysis.scenario.pathAssessment, outcome: entry.analysis.outcome, logicVersion: entry.logicVersion, rulePerspective: entry.analysis.scenario.rulePerspective ?? null })),
        criteria: selected.flatMap((entry) => entry.analysis.criteria.flatMap((criterion): MemoryCriterionRow[] => {
          const row = entry.criteria.find((item) => item.lineKey === criterion.lineKey)
          if (!row || !row.current || criterion.ruleConflict) return []
          return [{ callAssessmentId: entry.id, segmentKey: segmentOf(entry), interactionId: entry.snapshot.interactionId, personId: entry.snapshot.personId, criterionKey: row.key, anchorLineKey: row.lineKey.split("#")[0]!, ...(criterion.sources && criterion.sources.length > 0 ? { sourceLineKeys: criterion.sources.map((source) => source.lineKey) } : {}), ...(row.lineKey.includes("#") ? { obligationLineKey: row.lineKey } : {}), ...((practice) => (practice ? { practiceKey: practice.practiceKey, ...(practice.title ? { practiceTitle: practice.title } : {}) } : row.anchorKey ? { practiceKey: row.anchorKey } : {}))(practiceOfLines([row.lineKey.split("#")[0]!, ...(criterion.sources ?? []).map((source) => source.lineKey), ...(row.lineKey.includes("#") ? [row.lineKey] : [])])), documentId: criterion.documentId, documentTitle: entry.titles[criterion.documentId] ?? "Procedimento", heading: criterion.heading, text: criterion.text, status: criterion.status, localDate: localDate(entry.snapshot.occurredAt, entry.snapshot.timeZone), evidence: criterion.evidence, rationale: criterion.rationale, guidance: criterion.guidance, materiality: criterion.materiality, ...(criterion.argument ? { sourceKind: "ARGUMENT_SCRIPT" as const } : {}) }]
        })),
      }
    },
    async practiceMemberships(_organizationId, lineKeys) {
      return new Map(lineKeys.flatMap((lineKey) => {
        const member = memberships.get(lineKey)
        return member ? [[lineKey, { practiceKey: member.practiceKey, title: member.practiceKey ? practices.get(member.practiceKey)?.title ?? null : null }] as const] : []
      }))
    },
    async practiceCatalog(): Promise<CatalogPractice[]> {
      const members = [...memberships.values()].sort((a, b) => a.at.getTime() - b.at.getTime() || a.line.lineKey.localeCompare(b.line.lineKey))
      return [...practices.entries()]
        .sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime() || a[0].localeCompare(b[0]))
        .map(([practiceKey, practice]) => ({ practiceKey, title: practice.title, examples: members.filter((member) => member.practiceKey === practiceKey).slice(0, 2).map((member) => ({ sourceTitle: member.line.sourceTitle, heading: member.line.heading, text: member.line.text })) }))
    },
    async savePracticeAssignments(_organizationId, result, _provenance, now) {
      let members = 0
      const used = new Set<string>()
      for (const member of result.members) {
        if (memberships.has(member.line.lineKey)) continue
        memberships.set(member.line.lineKey, { ...member, at: now })
        members += 1
        if (member.practiceKey) used.add(member.practiceKey)
      }
      let created = 0
      for (const practice of result.practices) {
        if (practices.has(practice.practiceKey) || !used.has(practice.practiceKey)) continue
        practices.set(practice.practiceKey, { title: practice.title, createdAt: now })
        created += 1
      }
      return { members, practices: created }
    },
    async practicesWithoutTheme(_organizationId, practiceKeys) {
      const members = [...memberships.values()].sort((a, b) => a.at.getTime() - b.at.getTime() || a.line.lineKey.localeCompare(b.line.lineKey))
      return [...practices.entries()]
        .filter(([practiceKey, practice]) => !practice.themeKey && (practiceKeys === null || practiceKeys.includes(practiceKey)))
        .sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime() || a[0].localeCompare(b[0]))
        .map(([practiceKey, practice]) => ({ practiceKey, title: practice.title, examples: members.filter((member) => member.practiceKey === practiceKey).slice(0, 2).map((member) => ({ sourceTitle: member.line.sourceTitle, heading: member.line.heading, text: member.line.text })) }))
    },
    async practiceThemeCatalog(): Promise<CatalogTheme[]> {
      const themed = [...practices.entries()].filter(([, practice]) => practice.themeKey).sort((a, b) => a[1].themedAt!.getTime() - b[1].themedAt!.getTime() || a[0].localeCompare(b[0]))
      return [...themes.entries()]
        .sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime() || a[0].localeCompare(b[0]))
        .map(([themeKey, theme]) => ({ themeKey, title: theme.title, points: themed.filter(([, practice]) => practice.themeKey === themeKey).slice(0, 8).map(([, practice]) => practice.shortTitle!) }))
    },
    async savePracticeThemes(_organizationId, result, _provenance, now) {
      let themed = 0
      const used = new Set<string>()
      for (const assignment of result.assignments) {
        const practice = practices.get(assignment.practiceKey)
        if (!practice || practice.themeKey) continue
        practices.set(assignment.practiceKey, { ...practice, shortTitle: assignment.shortTitle, themeKey: assignment.themeKey, themedAt: now })
        themed += 1
        used.add(assignment.themeKey)
      }
      let created = 0
      for (const theme of result.themes) {
        if (themes.has(theme.themeKey) || !used.has(theme.themeKey)) continue
        themes.set(theme.themeKey, { title: theme.title, createdAt: now })
        created += 1
      }
      return { practices: themed, themes: created }
    },
    async findCompletedByReuseKey(organizationId, kind, key) {
      return [...runs.values()].filter((run) => run.organizationId === organizationId && run.kind === kind && run.status === "COMPLETED" && (run.analysisKey === key || ((run.provenance as { reuseKeys?: string[] }).reuseKeys ?? []).includes(key))).sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0] ?? null
    },
    async claimMessage(identity, now, leaseSeconds) {
      const existing = [...messages.values()].find((message) => message.organizationId === identity.organizationId && message.messageKey === identity.messageKey)
      if (existing) {
        // Abstenção gravada por uma revisão que NÃO aconteceu (falha técnica, versão anterior) não é decisão: a mensagem é refeita.
        if (existing.status === "PUBLISHABLE" || (existing.status === "ABSTAINED" && !isLegacyPendingOutcome((existing.abstainReason ?? "").split(/[:,]/)))) return { kind: "COMPLETED", record: existing }
        if (existing.status === "RUNNING" && existing.claimedUntil && existing.claimedUntil > now) return { kind: "IN_PROGRESS" }
        existing.status = "RUNNING"
        existing.claimedUntil = new Date(now.getTime() + leaseSeconds * 1000)
        return { kind: "CLAIMED", messageId: existing.id }
      }
      const id = randomUUID()
      messages.set(id, { ...identity, id, status: "RUNNING", analysisRunIds: [], abstainReason: null, findingKeys: [], brief: null, message: null, composition: null, suppressed: [], metrics: {}, completedAt: null, deliveredAt: null, claimedUntil: new Date(now.getTime() + leaseSeconds * 1000) })
      return { kind: "CLAIMED", messageId: id }
    },
    async completeMessage(_organizationId, messageId, data, now) {
      const message = messages.get(messageId)!
      Object.assign(message, { status: data.status, analysisRunIds: data.analysisRunIds, abstainReason: data.abstainReason, findingKeys: data.findingKeys, brief: data.brief, message: data.message, composition: data.composition, suppressed: data.suppressed, metrics: data.metrics, completedAt: now, claimedUntil: null })
      return message
    },
    async failMessage(_organizationId, messageId, _error, now) {
      const message = messages.get(messageId)
      if (message && message.status === "RUNNING") Object.assign(message, { status: "FAILED", completedAt: now, claimedUntil: null })
    },
    async getMessage(organizationId, messageId) {
      const message = messages.get(messageId)
      return message && message.organizationId === organizationId ? message : null
    },
    async markDelivered(_organizationId, messageId, at) {
      const message = messages.get(messageId)
      if (message && !message.deliveredAt) message.deliveredAt = at
    },
  }
}
