import { z } from "zod"
import { CAPABILITY_DEFINITIONS, effectiveCapabilities, type InterventionCapability } from "./capabilities.js"
import type { InterventionTypeDefinition } from "./intervention-type.js"
import type { PolicyDefinition } from "./policy-definition.js"
import { CONDITION_STATUS_TEXT, DECISION_STATUS_TEXT, OUTCOME_TEXT, type ConditionStatus, type EvaluationOutcome, type GroupTrace, type PlannedDecision, type RuleSelection, type RuleTrace } from "./policy-evaluation.js"

/**
 * RELATÓRIO DE INTELIGÊNCIA (`INTERVENTION_INTELLIGENCE_REPORT_V1`) — o fundamento de uma avaliação que levou a ações. A parte
 * ESTRUTURADA é montada só por código a partir do rastro da avaliação (fatos, fontes, critérios, decisões): é a fonte da
 * verdade e existe mesmo sem IA. A narrativa (opcional) é redigida pela IA a partir dela, sempre citando os marcadores (F, S,
 * D, A) e nunca podendo mudar resultado de regra, causa, fato ou evidência.
 */
export const INTELLIGENCE_REPORT_CONTRACT = "INTERVENTION_INTELLIGENCE_REPORT_V1"

export type ReportFact = { handle: string; kind: string; statement: string; status: ConditionStatus; ruleKey: string; values: Record<string, unknown> }
export type ReportSource = { handle: string; kind: string; ref: string; label: string; occurredAt: string | null }
export type ReportDiagnosis = { handle: string; ref: string; indicatorCode: string; period: string; patterns: { key: string; title: string }[]; competencies: string[] }
export type ReportPriorIntervention = { id: string; typeKey: string; typeName: string; status: string; openedAt: string; closedAt: string | null; operationalResult: string | null; learningResult: string | null }
export type ReportPerson = { personId: string; name: string }
export type ReportAction = {
  handle: string
  typeKey: string
  typeName: string
  capabilities: { key: InterventionCapability; label: string }[]
  status: PlannedDecision["status"]
  statusLabel: string
  ruleKey: string
  ruleName: string
  /** Por que ESTA ação: justificativa da regra + as condições atendidas que a sustentam. */
  justification: string
  supportingFacts: string[]
  responsible: ReportPerson | null
  approver: ReportPerson | null
  dueAt: string | null
  nextSteps: string[]
  resultCriteria: string[]
  interventionId: string | null
}

export type IntelligenceReport = {
  contract: typeof INTELLIGENCE_REPORT_CONTRACT
  asOf: string
  subject: { personId: string; personName: string; teamName: string | null; indicatorCode: string | null; indicatorName: string | null }
  situation: { summary: string; period: string | null }
  facts: ReportFact[]
  sources: ReportSource[]
  priorInterventions: ReportPriorIntervention[]
  diagnosis: ReportDiagnosis[]
  /** Separados dos fatos: o que ficou inconclusivo (e por quê) e o que falta para concluir. */
  uncertainties: { handle: string; statement: string; reasonCode: string | null }[]
  missingData: string[]
  policy: {
    id: string
    key: string
    name: string
    version: number
    versionId: string
    effectiveFrom: string
    matchStrategy: PolicyDefinition["matchStrategy"]
    outcome: EvaluationOutcome
    outcomeLabel: string
    blockedBy: string | null
    rules: { key: string; name: string; priority: number; status: ConditionStatus; statusLabel: string; conditions: { statement: string; status: ConditionStatus }[] }[]
  }
  actions: ReportAction[]
}

export type ReportInput = {
  asOf: Date
  subject: IntelligenceReport["subject"]
  policy: Omit<IntelligenceReport["policy"], "outcome" | "outcomeLabel" | "blockedBy" | "rules">
  definition: PolicyDefinition
  rules: readonly RuleTrace[]
  selection: RuleSelection
  decisions: readonly PlannedDecision[]
  outcome: EvaluationOutcome
  types: ReadonlyMap<string, { definition: InterventionTypeDefinition }>
  assignments: ReadonlyMap<string, { responsible: ReportPerson | null; approver: ReportPerson | null; dueAt: string | null }>
  interventionIds: ReadonlyMap<string, string | null>
  priorInterventions: readonly ReportPriorIntervention[]
  diagnoses: readonly { ref: string; indicatorCode: string; period: string; patterns: { key: string; title: string }[]; competencies?: string[] }[]
  /** Referências extras (gatilho, nós de análise do Workflow) — também consultáveis. */
  extraSources: readonly { kind: string; ref: string; label: string; occurredAt?: string | null }[]
}

function flattenConditions(trace: GroupTrace): { statement: string; status: ConditionStatus; kind: string; facts: Record<string, unknown>; reasonCode: string | null; references: { kind: string; ref: string; label: string; occurredAt?: string | null }[] }[] {
  return trace.items.flatMap((item) => (item.type === "GROUP" ? flattenConditions(item) : [{ statement: item.outcome.summary, status: item.outcome.status, kind: item.kind, facts: item.outcome.facts, reasonCode: item.outcome.reasonCode ?? null, references: item.outcome.references }]))
}

/** "2026-11-13" → "13/11/2026" (data civil, sem fuso). */
const civilDate = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-").reverse().join("/") : value)

function nextStepsOf(decision: PlannedDecision, definition: InterventionTypeDefinition | undefined, assignment: { responsible: ReportPerson | null; approver: ReportPerson | null; dueAt: string | null } | undefined): string[] {
  const sensitive = definition?.capabilities.includes("CONTINUITY_REVIEW") ?? false
  const due = assignment?.dueAt ? ` até ${civilDate(assignment.dueAt)}` : ""
  switch (decision.status) {
    case "RECOMMENDED":
      return [`${assignment?.responsible?.name ?? "O responsável"} decide se aceita a recomendação${due} (aceitar ou descartar com justificativa).`]
    case "PENDING_APPROVAL":
      return sensitive
        ? ["Solicitação registrada: aguarda a decisão de uma pessoa autorizada. A abertura não é uma decisão sobre o colaborador.", "Nenhuma situação funcional é alterada pela INIA."]
        : [`Aguarda a aprovação de ${assignment?.approver?.name ?? "quem aprova este tipo"}.`, `Depois de aprovada, ${assignment?.responsible?.name ?? "o responsável"} executa${due}.`]
    case "CREATED": {
      const steps = effectiveCapabilities(definition?.capabilities ?? []).map((capability): string | null => {
        switch (capability) {
          case "TASKS":
            return "Cumprir as tarefas nos prazos definidos."
          case "CHECKPOINTS":
            return "Registrar a leitura de cada checkpoint."
          case "TRAINING":
            return "Realizar as atividades do treinamento e a avaliação de aprendizagem."
          case "GUIDANCE":
            return "Registrar a orientação feita e as referências usadas."
          case "OBSERVATION":
            return "Observar no período definido, sem cobrança, e registrar o que foi observado."
          case "DATA_REVIEW":
            return "Verificar os dados faltantes ou inconsistentes antes de qualquer conclusão."
          case "LEADERSHIP_REVIEW":
            return "Analisar o caso e registrar o parecer."
          case "RECOGNITION":
            return "Registrar o reconhecimento feito."
          default:
            return null
        }
      })
      return [`${assignment?.responsible?.name ?? "O responsável"} executa${due}.`, ...steps.filter((step): step is string => Boolean(step))]
    }
    case "EXISTING":
      return [decision.updated ? "Já havia uma intervenção ativa igual: o novo sinal foi registrado nela, sem trocar as versões dela." : "Já havia uma intervenção ativa igual: nada muda."]
    case "SUPPRESSED":
      return ["Não reaberta: uma intervenção igual foi encerrada há pouco tempo (carência da regra)."]
    case "CONFLICT":
      return ["Nada foi aplicado: as ações são incompatíveis entre si ou com uma intervenção ativa — decisão humana necessária."]
  }
}

function resultCriteriaOf(definition: InterventionTypeDefinition | undefined): string[] {
  if (!definition) return []
  if (definition.capabilities.includes("CONTINUITY_REVIEW")) return ["Decisão registrada por uma pessoa autorizada, com justificativa."]
  const criteria: string[] = []
  if (definition.completion.requireAllTasksDone) criteria.push("Todas as tarefas concluídas (ou dispensadas com motivo).")
  if (definition.completion.requireLearningAssessment) criteria.push("Avaliação de aprendizagem registrada.")
  if (definition.completion.requireOperationalReading) criteria.push("Leitura da evolução do indicador registrada (concluir tarefas não comprova melhora).")
  if (definition.completion.requireOutcomeNote) criteria.push("Resultado da intervenção descrito pelo responsável.")
  return criteria
}

/** Monta a parte estruturada — pura, determinística (mesma entrada → mesmo relatório). */
export function buildIntelligenceReport(input: ReportInput): IntelligenceReport {
  const facts: ReportFact[] = []
  const sources: ReportSource[] = []
  const sourceHandle = new Map<string, string>()
  const addSource = (source: { kind: string; ref: string; label: string; occurredAt?: string | null }) => {
    const key = `${source.kind}:${source.ref}`
    if (sourceHandle.has(key)) return sourceHandle.get(key)!
    const handle = `S${sources.length + 1}`
    sources.push({ handle, kind: source.kind, ref: source.ref, label: source.label, occurredAt: source.occurredAt ?? null })
    sourceHandle.set(key, handle)
    return handle
  }
  const uncertainties: IntelligenceReport["uncertainties"] = []
  const ordered = [...input.rules].sort((a, b) => a.priority - b.priority)
  const factsByRule = new Map<string, string[]>()
  // A mesma condição pode aparecer em várias regras (ex.: o quartil oficial): vira UM fato/incerteza, citado por todas.
  const factHandle = new Map<string, string>()
  const uncertaintyStatements = new Set<string>()
  for (const rule of ordered) {
    const statements: string[] = []
    for (const condition of flattenConditions(rule.trace)) {
      for (const reference of condition.references) addSource(reference)
      if (condition.status === "INCONCLUSIVE") {
        if (!uncertaintyStatements.has(condition.statement)) uncertainties.push({ handle: `U${uncertainties.length + 1}`, statement: condition.statement, reasonCode: condition.reasonCode })
        uncertaintyStatements.add(condition.statement)
        continue
      }
      const key = `${condition.kind}|${condition.status}|${condition.statement}`
      let handle = factHandle.get(key)
      if (!handle) {
        handle = `F${facts.length + 1}`
        factHandle.set(key, handle)
        facts.push({ handle, kind: condition.kind, statement: condition.statement, status: condition.status, ruleKey: rule.key, values: condition.facts })
      }
      if (condition.status === "MET") statements.push(`${handle}: ${condition.statement}`)
    }
    factsByRule.set(rule.key, statements)
  }
  for (const source of input.extraSources) addSource(source)
  const diagnosis = input.diagnoses.map((item, index) => {
    addSource({ kind: "DIAGNOSIS", ref: item.ref, label: `Diagnóstico ${item.indicatorCode} (${item.period})` })
    return { handle: `D${index + 1}`, ref: item.ref, indicatorCode: item.indicatorCode, period: item.period, patterns: [...new Map(item.patterns.map((pattern) => [pattern.key, { key: pattern.key, title: pattern.title }])).values()], competencies: item.competencies ?? [] }
  })
  for (const prior of input.priorInterventions) addSource({ kind: "INTERVENTION", ref: prior.id, label: `${prior.typeName} (${prior.status})`, occurredAt: prior.openedAt })

  const missingData: string[] = uncertainties.map((item) => item.statement)
  if (diagnosis.length === 0) missingData.push("Não há diagnóstico sustentado no período: a causa não está estabelecida e o relatório não indica o que treinar.")

  const ruleOf = (key: string) => input.definition.rules.find((rule) => rule.key === key)
  const actions: ReportAction[] = input.decisions.map((decision, index) => {
    const type = input.types.get(decision.typeKey)?.definition
    const rule = ruleOf(decision.ruleKey)
    const assignment = input.assignments.get(decision.typeKey)
    const supportingFacts = decision.mode === "MATCHED" ? (factsByRule.get(decision.ruleKey) ?? []) : uncertainties.map((item) => `${item.handle}: ${item.statement}`)
    return {
      handle: `A${index + 1}`,
      typeKey: decision.typeKey,
      typeName: decision.typeName,
      capabilities: effectiveCapabilities(type?.capabilities ?? []).map((key) => ({ key, label: CAPABILITY_DEFINITIONS[key].label })),
      status: decision.status,
      statusLabel: DECISION_STATUS_TEXT[decision.status],
      ruleKey: decision.ruleKey,
      ruleName: rule?.name ?? decision.ruleKey,
      justification: [decision.mode === "INCONCLUSIVE" ? "Aberta porque a regra ficou INCONCLUSIVA (dados insuficientes), nunca como classificação do colaborador." : null, rule?.justification ?? null, decision.alsoRequestedBy.length > 0 ? `Também pedida pelas regras ${decision.alsoRequestedBy.join(", ")} (vale a configuração da regra de maior prioridade).` : null, decision.note]
        .filter((part): part is string => Boolean(part))
        .join(" "),
      supportingFacts,
      responsible: assignment?.responsible ?? null,
      approver: assignment?.approver ?? null,
      dueAt: assignment?.dueAt ?? null,
      nextSteps: nextStepsOf(decision, type, assignment),
      resultCriteria: resultCriteriaOf(type),
      interventionId: input.interventionIds.get(decision.typeKey) ?? decision.existingInterventionId ?? null,
    }
  })

  const matched = ordered.filter((rule) => rule.status === "MET")
  const period = facts.map((fact) => fact.values.window as { start?: string; end?: string } | undefined).find((window) => window?.start && window?.end)
  const summary = [
    `${input.subject.personName}${input.subject.indicatorName ? ` — ${input.subject.indicatorName}` : ""}: ${OUTCOME_TEXT[input.outcome].toLowerCase()} pela política "${input.policy.name}" v${input.policy.version}.`,
    matched.length > 0 ? `Regra(s) atendida(s): ${matched.map((rule) => rule.name).join("; ")}.` : null,
    uncertainties.length > 0 ? `${uncertainties.length} condição(ões) inconclusiva(s) por dados ausentes ou insuficientes — isso não é desempenho ruim.` : null,
    actions.length > 0 ? `Ações: ${actions.map((action) => `${action.typeName} (${action.statusLabel})`).join("; ")}.` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ")

  return {
    contract: INTELLIGENCE_REPORT_CONTRACT,
    asOf: input.asOf.toISOString(),
    subject: input.subject,
    situation: { summary, period: period?.start && period.end ? `${period.start.slice(0, 10)} a ${period.end.slice(0, 10)}` : null },
    facts,
    sources,
    priorInterventions: [...input.priorInterventions],
    diagnosis,
    uncertainties,
    missingData,
    policy: {
      ...input.policy,
      outcome: input.outcome,
      outcomeLabel: OUTCOME_TEXT[input.outcome],
      blockedBy: input.selection.blockedBy,
      rules: ordered.map((rule) => ({ key: rule.key, name: rule.name, priority: rule.priority, status: rule.status, statusLabel: CONDITION_STATUS_TEXT[rule.status], conditions: flattenConditions(rule.trace).map((condition) => ({ statement: condition.statement, status: condition.status })) })),
    },
    actions,
  }
}

// ---------------------------------------------------------------------------------------------
// NARRATIVA DA IA — contrato de saída e verificação por código
// ---------------------------------------------------------------------------------------------

export const REPORT_NARRATIVE_CONTRACT = "INTERVENTION_REPORT_NARRATIVE_V1"

const refsSchema = z.array(z.string().regex(/^[FSDUA]\d{1,3}$/)).min(1).max(12)
export const reportNarrativeSchema = z
  .object({
    situation: z.object({ text: z.string().trim().min(20).max(1200), refs: refsSchema }).strict(),
    analysis: z.array(z.object({ text: z.string().trim().min(20).max(1200), refs: refsSchema }).strict()).min(1).max(6),
    /** Hipóteses ficam SEPARADAS dos fatos e sempre dizem o que falta para confirmá-las. */
    hypotheses: z.array(z.object({ text: z.string().trim().min(10).max(800), refs: refsSchema, toConfirm: z.string().trim().min(5).max(400) }).strict()).max(4),
    leaderGuidance: z.array(z.object({ action: z.string().regex(/^A\d{1,3}$/), text: z.string().trim().min(10).max(800) }).strict()).max(10),
  })
  .strict()
export type ReportNarrative = z.infer<typeof reportNarrativeSchema>

/** Integridade por código: todo marcador citado existe no relatório e toda ação orientada é uma ação do relatório. */
export function narrativeIssues(narrative: ReportNarrative, report: IntelligenceReport): string[] {
  const handles = new Set([...report.facts.map((item) => item.handle), ...report.sources.map((item) => item.handle), ...report.diagnosis.map((item) => item.handle), ...report.uncertainties.map((item) => item.handle), ...report.actions.map((item) => item.handle)])
  const issues: string[] = []
  const check = (refs: readonly string[], where: string) => {
    for (const ref of refs) if (!handles.has(ref)) issues.push(`${where} cita ${ref}, que não existe no relatório.`)
  }
  check(narrative.situation.refs, "A síntese")
  narrative.analysis.forEach((item, index) => check(item.refs, `A análise ${index + 1}`))
  narrative.hypotheses.forEach((item, index) => check(item.refs, `A hipótese ${index + 1}`))
  const actionHandles = new Set(report.actions.map((item) => item.handle))
  narrative.leaderGuidance.forEach((item) => {
    if (!actionHandles.has(item.action)) issues.push(`A orientação cita a ação ${item.action}, que não existe.`)
  })
  // Hipótese não pode se apoiar só em fatos atendidos sem dizer o que falta: `toConfirm` é obrigatório no schema.
  return issues
}
