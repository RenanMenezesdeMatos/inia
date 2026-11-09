"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ExternalLink, Info } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { formatCivilDate } from "@/lib/format/date"
import { useApplyIndicatorCorrectionMutation, useIndicatorCorrectionPreviewQuery } from "@/queries/admin/use-indicator-rule-queries"
import {
  INDICATOR_CORRECTION_REASON_MIN_LENGTH,
  normalizeIndicatorCode,
  type IndicatorCatalog,
  type IndicatorCorrectionFields,
  type IndicatorCorrectionImpact,
  type IndicatorCorrectionWorkflow,
  type IndicatorUnit,
  type OperationalAggregationKind,
} from "@/schemas/admin/indicator-definition.schema"
import { DESIRED_DIRECTION_LABELS, type DesiredDirection, type IndicatorWithRules } from "@/schemas/admin/indicator-rule.schema"

/**
 * Correção controlada de um indicador que já tem histórico: unidade, direção e estratégia. Nada é decidido aqui: a prévia vem do
 * servidor, pela mesma função que o salvamento usa de novo dentro da transação. A tela mostra o impacto, exige motivo e o código
 * digitado, e nunca libera o botão com bloqueio. Fica em linha no diálogo de edição, nunca num painel lateral.
 */
export type IndicatorCorrectionPanelProps = {
  catalog: IndicatorCatalog
  indicator: IndicatorWithRules
  onCancel: () => void
  onApplied: () => void
}

const number = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 4 })
const counted = (count: number, one: string, many: string) => `${number(count)} ${count === 1 ? one : many}`

const ISSUE_LABELS: Record<IndicatorCorrectionImpact["measurements"]["examples"][number]["issue"], string> = {
  MISSING_COMPONENTS: "sem numerador e denominador",
  INCOHERENT_VALUE: "valor não confere",
  OUT_OF_UNIT_RANGE: "valor fora da unidade",
}

function CheckRow({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={count > 0 ? "font-medium text-destructive" : "font-medium"}>{number(count)}</dd>
    </div>
  )
}

function WorkflowList({ title, workflows, outOfScope }: { title: string; workflows: IndicatorCorrectionWorkflow[]; outOfScope: number }) {
  if (workflows.length === 0 && outOfScope === 0) return null
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-semibold">{title}</h4>
      <ul className="space-y-1.5">
        {workflows.map((workflow) => (
          <li key={workflow.id} className="rounded-md border p-2 text-xs">
            <Link href={`/admin/workflows/${workflow.id}`} target="_blank" className="inline-flex items-center gap-1 font-medium hover:underline">
              {workflow.name} <ExternalLink className="h-3 w-3" aria-hidden />
            </Link>
            {workflow.inFlightEnrollments > 0 ? (
              <p className="mt-0.5 text-muted-foreground">{counted(workflow.inFlightEnrollments, "execução em andamento para", "execuções em andamento param")} com o motivo ao chegar neste passo.</p>
            ) : null}
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {workflow.uses.map((use) => (
                <li key={`${use.nodeLabel}-${use.message}`}>{use.message}</li>
              ))}
            </ul>
          </li>
        ))}
        {outOfScope > 0 ? <li className="text-xs text-muted-foreground">{counted(outOfScope, "Workflow de outro Grupo", "Workflows de outros Grupos")}: só quem administra aquele Grupo vê o nome.</li> : null}
      </ul>
    </div>
  )
}

function ImpactView({ impact }: { impact: IndicatorCorrectionImpact }) {
  const { history, measurements, workflows } = impact
  const requiresComponents = measurements.requiredComponents.includes("numerator")
  const hasWorkflowProblems = workflows.activePublished.length + workflows.pausedPublished.length + workflows.drafts.length + workflows.outOfScope.activePublished + workflows.outOfScope.pausedPublished + workflows.outOfScope.drafts > 0
  return (
    <div className="space-y-3" data-testid="indicator-correction-impact">
      <section className="space-y-1 rounded-md border p-3 text-sm">
        <h4 className="text-xs font-semibold">O que muda</h4>
        <ul className="space-y-0.5">
          {impact.changes.map((change) => (
            <li key={change.field}>
              <span className="text-muted-foreground">{change.label}:</span> {change.from} → <strong className="font-medium">{change.to}</strong>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          Cálculo no período: {impact.calculation.before.label} → <strong className="font-medium text-foreground">{impact.calculation.after.label}</strong>. {impact.calculation.after.description}
        </p>
      </section>

      <section className="space-y-1 rounded-md border p-3 text-sm">
        <h4 className="text-xs font-semibold">O que já existe</h4>
        <dl className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Medições</dt><dd className="font-medium">{number(history.measurements)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Metas</dt><dd className="font-medium">{number(history.goals)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Fechamentos oficiais</dt><dd className="font-medium">{number(history.officialClosures)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Workflows</dt><dd className="font-medium">{number(history.workflows)}</dd></div>
          {requiresComponents ? <CheckRow label="Medições sem numerador e denominador" count={measurements.missingComponents} /> : null}
          {requiresComponents ? <CheckRow label="Medições com valor que não confere" count={measurements.incoherentValues} /> : null}
          {measurements.outOfUnitRange > 0 ? <CheckRow label="Medições fora da faixa da unidade" count={measurements.outOfUnitRange} /> : null}
        </dl>
      </section>

      {impact.blockers.length > 0 ? (
        <section className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert" data-testid="indicator-correction-blockers">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Não dá para salvar assim
          </h4>
          <ul className="space-y-1.5">
            {impact.blockers.map((blocker) => (
              <li key={blocker.code}>{blocker.message}</li>
            ))}
          </ul>
          {measurements.examples.length > 0 ? (
            <div className="space-y-0.5 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Exemplos</p>
              <ul className="space-y-0.5">
                {measurements.examples.map((example) => (
                  <li key={`${example.issue}-${example.employeeLabel}-${example.date}`}>
                    {example.employeeLabel}, {formatCivilDate(example.date)}: valor {number(example.value)}
                    {example.numerator !== null && example.denominator !== null ? `, ${number(example.numerator)} ÷ ${number(example.denominator)}` : ""}
                    {example.expected !== null ? `, a conta dá ${number(example.expected)}` : ""} ({ISSUE_LABELS[example.issue]})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <WorkflowList title="Workflows ativos que precisam ser pausados antes" workflows={workflows.activePublished} outOfScope={workflows.outOfScope.activePublished} />
      <WorkflowList title="Workflows pausados: ativar é recusado até publicar ajustado" workflows={workflows.pausedPublished} outOfScope={workflows.outOfScope.pausedPublished} />
      <WorkflowList title="Rascunhos: publicar é recusado até ajustar" workflows={workflows.drafts} outOfScope={workflows.outOfScope.drafts} />
      {hasWorkflowProblems ? <p className="text-xs text-muted-foreground">A regra nova aceita: {impact.allowedAggregations.join(", ")}.</p> : null}

      {impact.notices.length > 0 ? (
        <section className="space-y-1 rounded-md bg-muted/50 p-3 text-xs" data-testid="indicator-correction-notices">
          <h4 className="flex items-center gap-1.5 font-semibold">
            <Info className="h-3.5 w-3.5" aria-hidden /> Também vale saber
          </h4>
          <ul className="space-y-1 text-muted-foreground">
            {impact.notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

export function IndicatorCorrectionPanel({ catalog, indicator, onCancel, onApplied }: IndicatorCorrectionPanelProps) {
  const currentUnit = indicator.unit as IndicatorUnit
  const currentDirection = indicator.desiredDirection as DesiredDirection
  const currentStrategy = indicator.operationalAggregation
  const [unit, setUnit] = useState<IndicatorUnit>(currentUnit)
  const [direction, setDirection] = useState<DesiredDirection>(currentDirection)
  const [strategy, setStrategy] = useState<OperationalAggregationKind>(currentStrategy)
  const [reason, setReason] = useState("")
  const [confirmation, setConfirmation] = useState("")

  const fields = useMemo<IndicatorCorrectionFields | null>(() => {
    const changed: IndicatorCorrectionFields = {}
    if (unit !== currentUnit) changed.unit = unit
    if (direction !== currentDirection) changed.desiredDirection = direction
    if (strategy !== currentStrategy) changed.operationalAggregation = strategy
    return Object.keys(changed).length > 0 ? changed : null
  }, [unit, direction, strategy, currentUnit, currentDirection, currentStrategy])

  const preview = useIndicatorCorrectionPreviewQuery(indicator.id, fields)
  const apply = useApplyIndicatorCorrectionMutation()
  const impact = fields ? preview.data : undefined
  const reasonOk = reason.trim().length >= INDICATOR_CORRECTION_REASON_MIN_LENGTH
  const confirmationOk = normalizeIndicatorCode(confirmation) === indicator.code
  const canSubmit = Boolean(impact?.canApply) && !preview.isFetching && reasonOk && confirmationOk && !apply.isPending

  async function handleApply() {
    if (!canSubmit || !fields) return
    try {
      await apply.mutateAsync({ id: indicator.id, fields, reason: reason.trim(), confirmation: confirmation.trim() })
      onApplied()
    } catch {
      // O motivo aparece abaixo; a prévia é lida de novo porque algo mudou desde que a pessoa a viu.
      void preview.refetch()
    }
  }

  return (
    <div className="space-y-4">
      <p className="rounded-md bg-muted/50 p-3 text-sm">
        O resultado de períodos passados e futuros passa a ser calculado pela regra nova, em todas as telas. Fechamentos oficiais e feedbacks já entregues ficam como estão. Nenhuma medição, meta ou fechamento é alterado. O código não muda: as cargas e os Workflows continuam citando <strong className="font-medium">{indicator.code}</strong>.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Unidade</Label>
          <Select value={unit} onValueChange={(value) => setUnit(value as IndicatorUnit)}>
            <SelectTrigger className="w-full" aria-label="Unidade">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {catalog.units.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Direção desejada</Label>
          <Select value={direction} onValueChange={(value) => setDirection(value as DesiredDirection)}>
            <SelectTrigger className="w-full" aria-label="Direção desejada">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DESIRED_DIRECTION_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Como consolidar no período</Label>
          <Select value={strategy} onValueChange={(value) => setStrategy(value as OperationalAggregationKind)}>
            <SelectTrigger className="w-full" aria-label="Como consolidar no período">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {catalog.strategies.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {fields === null ? <p className="text-sm text-muted-foreground">Escolha o que corrigir para ver o impacto.</p> : null}
      {fields !== null && preview.isError ? <p className="text-sm text-destructive" role="alert">{(preview.error as Error).message}</p> : null}
      {fields !== null && !preview.isError && !impact ? <Skeleton className="h-40 w-full" /> : null}
      {impact ? <ImpactView impact={impact} /> : null}

      {impact?.canApply ? (
        <section className="space-y-3 rounded-md border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="indicator-correction-reason">Motivo da correção</Label>
            <Textarea id="indicator-correction-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: cadastrado como Soma na implantação; o cálculo correto é tempo total ÷ atendimentos." />
            <p className="text-xs text-muted-foreground">Fica na auditoria, com o antes, o depois, o impacto e quem fez.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="indicator-correction-confirmation">
              Para confirmar, digite o código <strong className="font-semibold">{indicator.code}</strong>
            </Label>
            <Input id="indicator-correction-confirmation" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          </div>
        </section>
      ) : null}

      {apply.isError ? <p className="text-sm text-destructive" role="alert">{(apply.error as Error).message}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={apply.isPending}>
          Voltar
        </Button>
        <Button type="button" disabled={!canSubmit} onClick={handleApply}>
          {apply.isPending ? "Aplicando..." : "Aplicar correção"}
        </Button>
      </div>
    </div>
  )
}
