"use client"

import { useMemo, useState } from "react"
import { DisplayIconSelect } from "@/components/admin/shared/display-icon-select"
import { DISPLAY_ICONS, UNIT_DEFAULT_ICON, isDisplayIconKey, type DisplayIconKey } from "@/lib/display-icons"
import { Lock } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { IndicatorDefinitionInput } from "@/services/admin/indicator-rule-service"
import {
  INDICATOR_CODE_PATTERN,
  MEASUREMENT_COMPONENT_LABELS,
  OPERATIONAL_GRANULARITY_LABELS,
  normalizeIndicatorCode,
  type IndicatorCatalog,
  type IndicatorDependencies,
  type IndicatorUnit,
  type OperationalAggregationKind,
} from "@/schemas/admin/indicator-definition.schema"
import { DESIRED_DIRECTION_LABELS, type DesiredDirection, type IndicatorWithRules } from "@/schemas/admin/indicator-rule.schema"

/**
 * Formulário ÚNICO de definição de indicador (criar e editar) — dirigido pelo catálogo de
 * comportamentos do backend (unidades, estratégias e sua ajuda contextual). Seções: Informações
 * básicas → Comportamento → Medição operacional → Fechamento oficial. Na edição, os campos
 * SEMÂNTICOS (código, unidade, direção, estratégia, desligar medição operacional) ficam bloqueados
 * quando o indicador já tem histórico — a mesma regra que o backend aplica (INDICATOR_SEMANTIC_LOCKED).
 */
export type IndicatorDefinitionFormProps = {
  catalog: IndicatorCatalog
  initial?: IndicatorWithRules
  /** Só na edição: o que já depende do indicador (medições, metas, fechamentos, Workflows). */
  dependencies?: IndicatorDependencies | null
  pending: boolean
  error: string | null
  submitLabel: string
  onSubmit: (value: IndicatorDefinitionInput) => Promise<void> | void
  onCancel: () => void
}

function describeDependencies(dependencies: IndicatorDependencies): string {
  const parts: string[] = []
  if (dependencies.measurements > 0) parts.push(`${dependencies.measurements.toLocaleString("pt-BR")} medições`)
  if (dependencies.goals > 0) parts.push(`${dependencies.goals} metas`)
  if (dependencies.officialClosures > 0) parts.push(`${dependencies.officialClosures.toLocaleString("pt-BR")} fechamentos oficiais`)
  const workflowCount = dependencies.workflows.length + dependencies.workflowsOutOfScope
  if (workflowCount > 0) {
    const names = dependencies.workflows.length > 0 ? `${dependencies.workflows.map((workflow) => workflow.name).slice(0, 3).join(", ")}${dependencies.workflows.length > 3 ? "…" : ""}` : ""
    const others = dependencies.workflowsOutOfScope > 0 ? `${dependencies.workflowsOutOfScope} de outros Grupos` : ""
    parts.push(`${workflowCount} Workflow(s): ${[names, others].filter(Boolean).join(" + ")}`)
  }
  return parts.join(" · ")
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-md border p-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

function LockedHint({ locked }: { locked: boolean }) {
  if (!locked) return null
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Bloqueado: o indicador já tem histórico">
      <Lock className="h-3 w-3" aria-hidden /> bloqueado
    </span>
  )
}

export function IndicatorDefinitionForm({ catalog, initial, dependencies, pending, error, submitLabel, onSubmit, onCancel }: IndicatorDefinitionFormProps) {
  const [code, setCode] = useState(initial?.code ?? "")
  const [name, setName] = useState(initial?.name ?? "")
  const [unit, setUnit] = useState<IndicatorUnit | "">((initial?.unit as IndicatorUnit | undefined) ?? "")
  const [desiredDirection, setDesiredDirection] = useState<DesiredDirection>((initial?.desiredDirection as DesiredDirection | undefined) ?? "HIGHER")
  const [dailySupported, setDailySupported] = useState(initial?.dailySupported ?? true)
  const [operationalAggregation, setOperationalAggregation] = useState<OperationalAggregationKind>(initial?.operationalAggregation ?? "RATE")
  const [minimumSampleSize, setMinimumSampleSize] = useState(initial?.minimumSampleSize?.toString() ?? "")
  const [minimumCoveragePercent, setMinimumCoveragePercent] = useState(initial?.minimumCoverage !== null && initial?.minimumCoverage !== undefined ? String(Math.round(initial.minimumCoverage * 100)) : "")
  const [officialClosureSupported, setOfficialClosureSupported] = useState(initial?.officialClosureSupported ?? true)
  const [provesWorkActivity, setProvesWorkActivity] = useState(initial?.provesWorkActivity ?? false)
  const [unjustifiedAbsencePolicy, setUnjustifiedAbsencePolicy] = useState<"NO_SAMPLE" | "ZERO_CONTRIBUTION">(initial?.unjustifiedAbsencePolicy ?? "NO_SAMPLE")
  const [availabilityOverride, setAvailabilityOverride] = useState(Boolean(initial?.availabilityPolicy))
  const [availabilityLagDays, setAvailabilityLagDays] = useState(String(initial?.availabilityPolicy?.lagDays ?? 1))
  const [availabilityTime, setAvailabilityTime] = useState(initial?.availabilityPolicy?.availableByLocalTime ?? "11:00")
  const [iconKey, setIconKey] = useState<DisplayIconKey | null>(isDisplayIconKey(initial?.iconKey) ? initial.iconKey : null)

  const hasHistory = Boolean(dependencies?.hasHistory)
  const semanticLocked = Boolean(initial) && hasHistory
  const operationalSwitchLocked = semanticLocked && Boolean(initial?.dailySupported)
  const strategy = catalog.strategies.find((item) => item.value === operationalAggregation)
  const unitMeta = catalog.units.find((item) => item.value === unit)
  const unitDefaultIconKey: DisplayIconKey = (unit && UNIT_DEFAULT_ICON[unit]) || "chart-line"

  const problems = useMemo(() => {
    const list: string[] = []
    const normalized = normalizeIndicatorCode(code)
    if (code.trim().length > 0 && !INDICATOR_CODE_PATTERN.test(normalized)) list.push("Código: comece com letra e use só letras maiúsculas, números e underscore (ex.: DIGITAL_RESOLUTION_RATE).")
    if (unit && strategy?.allowedUnits && !strategy.allowedUnits.includes(unit)) {
      list.push(`A estratégia "${strategy.label}" só é válida para ${strategy.allowedUnits.map((item) => catalog.units.find((entry) => entry.value === item)?.label ?? item).join(", ")}.`)
    }
    if (!dailySupported && !officialClosureSupported) list.push("Um indicador precisa de ao menos uma capacidade: medição operacional ou fechamento oficial.")
    const sample = minimumSampleSize.trim() === "" ? null : Number(minimumSampleSize)
    if (sample !== null && (!Number.isInteger(sample) || sample < 1)) list.push("Amostra mínima precisa ser um número inteiro maior que zero.")
    const coverage = minimumCoveragePercent.trim() === "" ? null : Number(minimumCoveragePercent)
    if (coverage !== null && (Number.isNaN(coverage) || coverage < 1 || coverage > 100)) list.push("Cobertura mínima precisa estar entre 1% e 100%.")
    // Contribuição zero só faz sentido onde "0 num dia" é valor real da grandeza: soma/média de contagens.
    if (dailySupported && unjustifiedAbsencePolicy === "ZERO_CONTRIBUTION" && !((operationalAggregation === "SUM" || operationalAggregation === "AVERAGE") && (unit === "COUNT" || unit === "CASES" || unit === "CASES_PER_DAY"))) {
      list.push('"Contribuição zero" só é válida para soma ou média de contagens (Quantidade, Casos, Casos por dia) — para tempo, nota, taxa ou snapshot um zero seria um valor inventado. Use "Sem amostra".')
    }
    if (dailySupported && availabilityOverride) {
      const lag = Number(availabilityLagDays)
      if (!Number.isInteger(lag) || lag < 0 || lag > 14) list.push("Disponibilidade: D-N precisa ser um inteiro entre 0 e 14.")
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(availabilityTime)) list.push("Disponibilidade: informe o horário local no formato HH:MM.")
    }
    return list
  }, [code, unit, strategy, catalog.units, dailySupported, officialClosureSupported, minimumSampleSize, minimumCoveragePercent, unjustifiedAbsencePolicy, operationalAggregation, availabilityOverride, availabilityLagDays, availabilityTime])

  const selectedUnit: IndicatorUnit | null = unit === "" ? null : unit
  const canSubmit = code.trim().length > 1 && name.trim().length > 1 && selectedUnit !== null && problems.length === 0 && !pending

  async function handleSubmit() {
    if (!canSubmit || selectedUnit === null) return
    await onSubmit({
      code: normalizeIndicatorCode(code),
      name: name.trim(),
      unit: selectedUnit,
      desiredDirection,
      dailySupported,
      operationalAggregation,
      minimumSampleSize: dailySupported && minimumSampleSize.trim() !== "" ? Number(minimumSampleSize) : null,
      minimumCoverage: dailySupported && minimumCoveragePercent.trim() !== "" ? Number(minimumCoveragePercent) / 100 : null,
      officialClosureSupported,
      provesWorkActivity: dailySupported && provesWorkActivity,
      unjustifiedAbsencePolicy: dailySupported ? unjustifiedAbsencePolicy : "NO_SAMPLE",
      availabilityPolicy: dailySupported && availabilityOverride ? { lagDays: Number(availabilityLagDays), availableByLocalTime: availabilityTime } : null,
      iconKey,
    })
  }

  return (
    <div className="max-w-2xl space-y-4">
      {initial && dependencies?.hasHistory ? (
        <p className="rounded-md border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100">
          <strong>Este indicador já tem histórico</strong> ({describeDependencies(dependencies)}). Código, unidade, direção, estratégia de consolidação e desligar a medição operacional
          ficam bloqueados — mudar isso invalidaria o histórico e as configurações existentes. Para uma semântica diferente, crie um novo indicador e desative este.
        </p>
      ) : null}

      <Section title="Informações básicas" description="Identidade e apresentação. O código identifica o indicador em medições, metas e Workflows; a unidade decide como os valores são formatados.">
        <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
          <div className="space-y-1.5">
            <Label htmlFor="indicator-name">Nome</Label>
            <Input id="indicator-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Taxa de Resolução Digital" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="indicator-icon">Ícone</Label>
            <DisplayIconSelect
              id="indicator-icon"
              value={iconKey}
              onChange={setIconKey}
              defaultIcon={DISPLAY_ICONS[unitDefaultIconKey].icon}
              defaultLabel={`Padrão (${DISPLAY_ICONS[unitDefaultIconKey].label.toLowerCase()})`}
              ariaLabel="Ícone do indicador"
            />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">O ícone identifica o indicador nos feedbacks do Acompanhamento do colaborador. Sem escolha, vale o padrão pela unidade.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="indicator-code" className="flex items-center gap-2">
              Código <LockedHint locked={semanticLocked} />
            </Label>
            <Input id="indicator-code" value={code} disabled={semanticLocked} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Ex.: DIGITAL_RESOLUTION_RATE" />
            <p className="text-xs text-muted-foreground">Único, em maiúsculas, sem espaços. Não pode mudar depois que houver medições, metas ou Workflows.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-2">
              Unidade <LockedHint locked={semanticLocked} />
            </Label>
            <Select value={unit} disabled={semanticLocked} onValueChange={(value) => setUnit(value as IndicatorUnit)}>
              <SelectTrigger className="w-full" aria-label="Unidade">
                <SelectValue placeholder="Selecione a unidade" />
              </SelectTrigger>
              <SelectContent>
                {catalog.units.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {unitMeta ? <p className="text-xs text-muted-foreground">Formatação: {unitMeta.value === "PERCENT" ? "87,5%" : unitMeta.value === "SECONDS" ? "480 s" : unitMeta.value === "STARS" ? "4,6 ★" : unitMeta.suffix ? `35 ${unitMeta.suffix}` : "35"}.</p> : null}
          </div>
        </div>
      </Section>

      <Section title="Comportamento" description="A direção desejada decide o que é 'melhor' em rankings, quartis e comparações com a meta — nunca inferida do nome.">
        <div className="space-y-1.5">
          <Label className="flex items-center gap-2">
            Direção desejada <LockedHint locked={semanticLocked} />
          </Label>
          <Select value={desiredDirection} disabled={semanticLocked} onValueChange={(value) => setDesiredDirection(value as DesiredDirection)}>
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
          {desiredDirection === "TARGET" ? <p className="text-xs text-muted-foreground">Proximidade da meta: Melhores/Piores, Evolução/Queda e quartil operacional ficam indisponíveis para este indicador.</p> : null}
        </div>
      </Section>

      <Section title="Medição operacional" description="Medições diárias por colaborador (camada operacional). Habilita janelas como 'últimos 7 dias', ranking, quartil operacional e evidência de cálculo no QA Lab.">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="indicator-operational" className="flex items-center gap-2">
            Medição operacional ativada <LockedHint locked={operationalSwitchLocked} />
          </Label>
          <Switch id="indicator-operational" checked={dailySupported} disabled={operationalSwitchLocked} onCheckedChange={setDailySupported} />
        </div>
        {dailySupported ? (
          <div className="space-y-3 border-t pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Granularidade</Label>
                <Select value={catalog.granularities[0] ?? "DAILY"} disabled>
                  <SelectTrigger className="w-full" aria-label="Granularidade">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.granularities.map((granularity) => (
                      <SelectItem key={granularity} value={granularity}>
                        {OPERATIONAL_GRANULARITY_LABELS[granularity]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Hoje a ingestão e o motor suportam medição diária. Outras granularidades entram quando existirem de fato.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-2">
                  Como consolidar este indicador em um período? <LockedHint locked={semanticLocked} />
                </Label>
                <Select value={operationalAggregation} disabled={semanticLocked} onValueChange={(value) => setOperationalAggregation(value as OperationalAggregationKind)}>
                  <SelectTrigger className="w-full" aria-label="Estratégia de consolidação">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.strategies.map((item) => {
                      const incompatible = unit !== "" && item.allowedUnits !== null && !item.allowedUnits.includes(unit)
                      return (
                        <SelectItem key={item.value} value={item.value} disabled={incompatible}>
                          {item.label}
                          {incompatible ? " — só em percentual" : ""}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {strategy ? (
              <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                <strong className="text-foreground">{strategy.label}:</strong> {strategy.help} Cada medição precisa informar {strategy.requiredComponents.map((component) => MEASUREMENT_COMPONENT_LABELS[component]).join(" + ")}
                {strategy.optionalComponents.length > 0 ? ` (opcional: ${strategy.optionalComponents.map((component) => MEASUREMENT_COMPONENT_LABELS[component]).join(", ")})` : ""}.
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="indicator-minimum-sample">Amostra mínima (opcional)</Label>
                <Input id="indicator-minimum-sample" type="number" min={1} value={minimumSampleSize} onChange={(event) => setMinimumSampleSize(event.target.value)} placeholder="Ex.: 5" />
                <p className="text-xs text-muted-foreground">Amostra mínima para considerar o resultado válido. Pré-preenche Condition/Ranking ao escolher este indicador.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="indicator-minimum-coverage">Cobertura mínima (%) (opcional)</Label>
                <Input id="indicator-minimum-coverage" type="number" min={1} max={100} value={minimumCoveragePercent} onChange={(event) => setMinimumCoveragePercent(event.target.value)} placeholder="Ex.: 60" />
                <p className="text-xs text-muted-foreground">Percentual mínimo de dias elegíveis com medição válida. Pré-preenche Condition/Ranking ao escolher este indicador.</p>
              </div>
            </div>
            <div className="rounded-md border border-border/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="indicator-proves-work-activity">Comprova atividade operacional (evidência de produção)</Label>
                <Switch id="indicator-proves-work-activity" checked={provesWorkActivity} onCheckedChange={setProvesWorkActivity} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {provesWorkActivity
                  ? "Uma medição diária deste indicador (com volume/amostra > 0) prova que o colaborador trabalhou naquele dia: o dia vira elegível mesmo se a escala/exceção dizia folga, e a ausência de medição após o turno pode gerar a pendência \"Produção não identificada\" para o Supervisor. Use só em indicadores de volume/produção (ex.: atendimentos realizados)."
                  : "Desligado: uma medição deste indicador nunca prova presença por si (uma nota de qualidade ou um TMA atrasado não dizem que a pessoa trabalhou). Interações registradas continuam sendo evidência."}
              </p>
            </div>
            <div className="rounded-md border border-border/60 p-3">
              <Label htmlFor="indicator-absence-policy">Tratamento de falta injustificada</Label>
              <Select value={unjustifiedAbsencePolicy} onValueChange={(value) => setUnjustifiedAbsencePolicy(value as "NO_SAMPLE" | "ZERO_CONTRIBUTION")}>
                <SelectTrigger id="indicator-absence-policy" className="mt-1.5" data-testid="indicator-absence-policy"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NO_SAMPLE">Sem amostra</SelectItem>
                  <SelectItem value="ZERO_CONTRIBUTION">Contribuição zero</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                {unjustifiedAbsencePolicy === "ZERO_CONTRIBUTION"
                  ? "Contribuição zero não cria uma medição artificial. Ela afeta apenas o cálculo operacional quando uma falta injustificada foi confirmada pelo Supervisor: o dia entra como 0 produzido (Produção, volume). Válida só para soma/média de contagens."
                  : "Sem amostra: numa falta injustificada confirmada este indicador simplesmente não tem medição naquele dia (TMA, Qualidade, taxas) — nunca um zero falso. É o padrão seguro."}
              </p>
            </div>
            <div className="rounded-md border border-border/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="indicator-availability-override">Disponibilidade esperada própria (D-N até HH:MM)</Label>
                <Switch id="indicator-availability-override" checked={availabilityOverride} onCheckedChange={setAvailabilityOverride} data-testid="indicator-availability-override" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Normalmente o SLA de disponibilidade vem do feed de medições na Central de Dados. Ligue só se este indicador chega em prazo diferente do resto do mesmo feed (ex.: D-2). Freshness ≠ disponibilidade: a fonte pode ter sincronizado hoje e o dado de ontem só ser esperado às 11:00.</p>
              {availabilityOverride ? (
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="indicator-availability-lag">Chega em D-</Label>
                    <Input id="indicator-availability-lag" type="number" min={0} max={14} value={availabilityLagDays} onChange={(event) => setAvailabilityLagDays(event.target.value)} data-testid="indicator-availability-lag" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="indicator-availability-time">até (horário local)</Label>
                    <Input id="indicator-availability-time" type="time" value={availabilityTime} onChange={(event) => setAvailabilityTime(event.target.value)} data-testid="indicator-availability-time" />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Sem medição operacional, o indicador só participa de Workflows por períodos mensais/fechamentos e não entra em ranking nem quartil operacional.</p>
        )}
      </Section>

      <Section title="Fechamento oficial" description="Camada oficial: valor, meta, atingimento, quartil e peso por competência chegam prontos da fonte corporativa — a INIA nunca os calcula.">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="indicator-official">Pode receber fechamento oficial</Label>
          <Switch id="indicator-official" checked={officialClosureSupported} onCheckedChange={setOfficialClosureSupported} />
        </div>
        <p className="text-xs text-muted-foreground">
          {officialClosureSupported
            ? "Periodicidade oficial: mensal (competência). Habilita 'Atingimento do indicador', 'Quartil do indicador' e 'Últimos N fechamentos' nos Workflows e a área Indicadores do perfil."
            : "Sem fechamento oficial, o indicador não aparece em atingimento/quartil/PRV — só na camada operacional."}
        </p>
      </Section>

      {problems.length > 0 ? (
        <ul className="space-y-1 text-sm text-destructive">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
        <Button disabled={!canSubmit} onClick={handleSubmit}>
          {pending ? "Salvando..." : submitLabel}
        </Button>
      </div>
    </div>
  )
}
