"use client"

import { useMemo, useState } from "react"
import { Activity, BookText, CalendarRange, Gauge, ListChecks, Pencil, Plus, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react"

import { useAutoOpenFromQuery } from "@/hooks/use-auto-open-from-query"
import { useAdminListState } from "@/hooks/use-admin-list-state"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/surface"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

import { AdminListView } from "@/components/admin/shared/list/admin-list-view"
import { EntityCard, EntityCardIcon, EntityCardTag } from "@/components/admin/shared/list/entity-card"
import {
  ListBooleanFilter,
  ListMultiSelectFilter,
  ListOrgScopeFilter,
  ListSearchInput,
  ListToolbar,
  optionsFromLabels,
} from "@/components/admin/shared/list/list-filters"
import { ListCardGrid } from "@/components/admin/shared/list/list-states"
import { ListViewToggle } from "@/components/admin/shared/list/list-view-toggle"
import { OrgScopeSelect, type OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import { IndicatorCorrectionPanel } from "@/components/admin/indicators/indicator-correction-panel"
import { IndicatorDefinitionForm } from "@/components/admin/indicators/indicator-definition-form"
import { DiagnosticStrategyStatusBadge, IndicatorDiagnosticStrategyTab } from "@/components/admin/indicators/indicator-diagnostic-strategy-tab"
import { STRATEGY_STATUS_LABELS } from "@/schemas/admin/indicator-diagnostic-strategy.schema"
import { formatIndicatorValue } from "@/lib/analytics/format"
import { describeIndicatorCapability, MEASUREMENT_COMPONENT_LABELS, OPERATIONAL_GRANULARITY_LABELS } from "@/schemas/admin/indicator-definition.schema"
import { useTeamsQuery } from "@/queries/admin/use-org-structure-queries"
import type { IndicatorListParams } from "@/services/admin/indicator-rule-service"
import {
  useCreateIndicatorDefinitionMutation,
  useDeleteIndicatorDefinitionMutation,
  useDeleteIndicatorRuleMutation,
  useIndicatorCatalogQuery,
  useIndicatorDependenciesQuery,
  useIndicatorsWithRulesPageQuery,
  useSaveIndicatorGlossaryMutation,
  useSaveIndicatorRuleMutation,
  useSetIndicatorDefinitionActiveMutation,
  useSetIndicatorRuleActiveMutation,
  useUpdateIndicatorDefinitionMutation,
} from "@/queries/admin/use-indicator-rule-queries"
import {
  CALCULATION_PERIOD_LABELS,
  DESIRED_DIRECTION_LABELS,
  type CalculationPeriod,
  type DesiredDirection,
  type IndicatorWithRules,
} from "@/schemas/admin/indicator-rule.schema"
import { RESTORE_NOTE } from "@/lib/admin/logical-delete"

type CalculationRule = IndicatorWithRules["calculationRules"][number]
type IndicatorTab = "definition" | "rules" | "diagnosis" | "glossary"

function scopeLabel(rule: { scopeType: string; teamName: string | null; subteamName: string | null }) {
  if (rule.scopeType === "ALL_TEAMS") return "Todos os grupos"
  return rule.subteamName ?? rule.teamName ?? "—"
}

function DeleteRuleButton({ rule }: { rule: CalculationRule }) {
  const deleteMutation = useDeleteIndicatorRuleMutation()
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Excluir regra" disabled={deleteMutation.isPending}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir esta regra de cálculo?</AlertDialogTitle>
          <AlertDialogDescription>
            {scopeLabel(rule)} — a regra sai da lista. {RESTORE_NOTE}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={async () => {
              try {
                await deleteMutation.mutateAsync(rule.id)
                setOpen(false)
              } catch {
                // error is surfaced via the toast from useAdminMutation
              }
            }}
          >
            {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function EditIndicatorDialog({ indicator, open, onOpenChange }: { indicator: IndicatorWithRules; open: boolean; onOpenChange: (open: boolean) => void }) {
  const updateMutation = useUpdateIndicatorDefinitionMutation()
  const catalogQuery = useIndicatorCatalogQuery()
  const dependenciesQuery = useIndicatorDependenciesQuery(open ? indicator.id : null)
  const [correcting, setCorrecting] = useState(false)

  function handleOpenChange(next: boolean) {
    if (next) updateMutation.reset()
    else setCorrecting(false)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{correcting ? `Corrigir ${indicator.name}` : `Editar ${indicator.name}`}</DialogTitle>
          <DialogDescription>
            {correcting
              ? "Corrija um cadastro errado sem perder o histórico. A prévia mostra o impacto antes de salvar."
              : "Nome, glossário e valores padrão podem mudar sempre. Com histórico, o código fica bloqueado e unidade, direção e estratégia mudam pela correção, com prévia do impacto."}
          </DialogDescription>
        </DialogHeader>
        {catalogQuery.data && dependenciesQuery.data ? (
          correcting ? (
            <IndicatorCorrectionPanel catalog={catalogQuery.data} indicator={indicator} onCancel={() => setCorrecting(false)} onApplied={() => handleOpenChange(false)} />
          ) : (
            // key: reabrir sempre parte do registro mais recente
            <IndicatorDefinitionForm
              key={`${indicator.id}-${open}`}
              catalog={catalogQuery.data}
              initial={indicator}
              dependencies={dependenciesQuery.data}
              pending={updateMutation.isPending}
              error={updateMutation.isError ? (updateMutation.error as Error).message : null}
              submitLabel="Salvar"
              onCancel={() => handleOpenChange(false)}
              onRequestCorrection={() => setCorrecting(true)}
              onSubmit={async (value) => {
                await updateMutation.mutateAsync({ id: indicator.id, ...value })
                handleOpenChange(false)
              }}
            />
          )
        ) : catalogQuery.isError || dependenciesQuery.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar o catálogo de comportamentos do indicador.</p>
        ) : (
          <Skeleton className="h-64 w-full" />
        )}
      </DialogContent>
    </Dialog>
  )
}

function DeleteIndicatorButton({ indicator }: { indicator: IndicatorWithRules }) {
  const deleteDefinitionMutation = useDeleteIndicatorDefinitionMutation()
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) deleteDefinitionMutation.reset()
      }}
    >
      <AlertDialogTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Excluir indicador" disabled={deleteDefinitionMutation.isPending}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir {indicator.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Medições, metas e fechamentos saem dos painéis e ficam guardados com ele, e a carga passa a recusar este código. {RESTORE_NOTE} Se algum Workflow ou política de acompanhamento usa este
            indicador, ou há execução em andamento, a exclusão é barrada.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deleteDefinitionMutation.isError ? <p className="text-sm text-destructive">{(deleteDefinitionMutation.error as Error).message}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={deleteDefinitionMutation.isPending}
            onClick={async () => {
              try {
                await deleteDefinitionMutation.mutateAsync(indicator.id)
                setOpen(false)
              } catch {
                // error is surfaced via deleteDefinitionMutation.isError above
              }
            }}
          >
            {deleteDefinitionMutation.isPending ? "Excluindo..." : "Excluir"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// Ações comuns às duas visualizações: ativar/desativar, editar definição e excluir.
function IndicatorActions({ indicator }: { indicator: IndicatorWithRules }) {
  const setDefinitionActiveMutation = useSetIndicatorDefinitionActiveMutation()
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  return (
    <>
      <Switch
        checked={indicator.active}
        disabled={setDefinitionActiveMutation.isPending}
        aria-label={indicator.active ? "Desativar indicador" : "Ativar indicador"}
        onCheckedChange={(checked) => setDefinitionActiveMutation.mutate({ id: indicator.id, active: checked })}
      />
      <Button size="icon" variant="ghost" aria-label="Editar indicador" onClick={() => setEditDialogOpen(true)}>
        <Pencil className="h-4 w-4" />
      </Button>
      <EditIndicatorDialog indicator={indicator} open={editDialogOpen} onOpenChange={setEditDialogOpen} />
      <DeleteIndicatorButton indicator={indicator} />
    </>
  )
}

// Capacidade em um badge compacto (lista e cards) — detalhes técnicos ficam em "Definição"/Editar.
function CapabilityBadge({ indicator }: { indicator: IndicatorWithRules }) {
  const capability = describeIndicatorCapability(indicator)
  return (
    <Badge variant={capability.tone === "operational" ? "secondary" : "outline"} className="whitespace-nowrap">
      {capability.label}
    </Badge>
  )
}

function DefinitionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[180px_1fr]">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

// Como o indicador se comporta, lido da metadata do catálogo — o mesmo que Workflow, QA Lab e
// Analytics usam. Nenhum texto aqui depende do código do indicador.
function IndicatorDefinitionSummary({ indicator }: { indicator: IndicatorWithRules }) {
  const catalogQuery = useIndicatorCatalogQuery()
  const strategy = catalogQuery.data?.strategies.find((item) => item.value === indicator.operationalAggregation)
  const unitLabel = catalogQuery.data?.units.find((item) => item.value === indicator.unit)?.label ?? indicator.unit
  return (
    <dl className="space-y-3">
      <DefinitionRow label="Definição">{indicator.glossaryDescription ?? <span className="text-muted-foreground">Sem descrição de glossário — preencha na aba Glossário.</span>}</DefinitionRow>
      <DefinitionRow label="Unidade">
        {unitLabel} <span className="text-muted-foreground">· ex.: {formatIndicatorValue(indicator.unit === "SECONDS" ? 480 : indicator.unit === "PERCENT" ? 87.5 : indicator.unit === "STARS" ? 4.6 : 35, indicator.unit)}</span>
      </DefinitionRow>
      <DefinitionRow label="Direção">{DESIRED_DIRECTION_LABELS[indicator.desiredDirection as DesiredDirection] ?? indicator.desiredDirection}</DefinitionRow>
      <DefinitionRow label="Medição operacional">
        {indicator.dailySupported ? (
          <span>
            Ativada — {OPERATIONAL_GRANULARITY_LABELS.DAILY.toLowerCase()}.
          </span>
        ) : (
          <span className="text-muted-foreground">Não habilitada — só períodos mensais e fechamentos.</span>
        )}
      </DefinitionRow>
      {indicator.dailySupported ? (
        <>
          <DefinitionRow label="Cálculo no período">
            <span className="font-medium">{indicator.calculation?.label ?? strategy?.label ?? indicator.operationalAggregation}</span>
            {indicator.calculation ? <span className="block text-muted-foreground">{indicator.calculation.description}</span> : null}
            {strategy ? (
              <span className="block text-xs text-muted-foreground">
                Estratégia: {strategy.label} · cada medição informa {strategy.requiredComponents.map((component) => MEASUREMENT_COMPONENT_LABELS[component]).join(" + ")}.
              </span>
            ) : null}
          </DefinitionRow>
          <DefinitionRow label="Amostra mínima">{indicator.minimumSampleSize !== null ? `${indicator.minimumSampleSize} medições` : <span className="text-muted-foreground">Sem padrão — definida em cada Workflow.</span>}</DefinitionRow>
          <DefinitionRow label="Cobertura mínima">{indicator.minimumCoverage !== null ? `${Math.round(indicator.minimumCoverage * 100)}% dos dias elegíveis` : <span className="text-muted-foreground">Sem padrão — definida em cada Workflow.</span>}</DefinitionRow>
          <DefinitionRow label="Evidência de produção">
            {indicator.provesWorkActivity ? <span data-testid="indicator-proves-work-activity">Comprova atividade operacional: medição diária deste indicador prova que houve trabalho no dia.</span> : <span className="text-muted-foreground">Não comprova presença — uma medição sozinha não prova que o colaborador trabalhou.</span>}
            <span className="block" data-testid="indicator-absence-policy-label">Falta injustificada: {indicator.unjustifiedAbsencePolicy === "ZERO_CONTRIBUTION" ? "contribuição zero (0 lógico no cálculo, nunca medição)" : "sem amostra"}{indicator.availabilityPolicy ? ` · Disponibilidade própria: D-${indicator.availabilityPolicy.lagDays} até ${indicator.availabilityPolicy.availableByLocalTime}` : ""}</span>
          </DefinitionRow>
        </>
      ) : null}
      <DefinitionRow label="Fechamento oficial">
        {indicator.officialClosureSupported ? "Pode receber fechamento oficial mensal (competência): valor, meta, atingimento, quartil e peso chegam prontos." : <span className="text-muted-foreground">Não recebe fechamento oficial.</span>}
      </DefinitionRow>
      <DefinitionRow label="Regras por Grupo/Subgrupo">
        {indicator.calculationRules.length === 0 ? <span className="text-muted-foreground">Nenhuma — usa o padrão geral.</span> : `${indicator.calculationRules.length} regra(s) — ver aba Regras de cálculo.`}
      </DefinitionRow>
    </dl>
  )
}

// Regras de cálculo por grupo e glossário do indicador — o mesmo conteúdo que antes ficava
// aberto dentro de cada card, agora num painel lateral acessível pela lista e pelos cards.
export function IndicatorManager({ indicator }: { indicator: IndicatorWithRules }) {
  const teamsQuery = useTeamsQuery()
  const saveRuleMutation = useSaveIndicatorRuleMutation()
  const setRuleActiveMutation = useSetIndicatorRuleActiveMutation()
  const saveGlossaryMutation = useSaveIndicatorGlossaryMutation()

  const [tab, setTab] = useState<IndicatorTab>("definition")
  const [editingRule, setEditingRule] = useState<CalculationRule | null>(null)
  // "Nova regra" é AÇÃO dentro da aba de regras (V1.6.2), não uma aba: o formulário aparece no lugar da tabela.
  const [ruleFormOpen, setRuleFormOpen] = useState(false)
  const [orgScope, setOrgScope] = useState<OrgScopeValue>({ scopeType: "ALL_TEAMS" })
  const [calculationPeriod, setCalculationPeriod] = useState<CalculationPeriod>("MONTHLY")
  const [calculationMethod, setCalculationMethod] = useState("")
  const [attainmentRule, setAttainmentRule] = useState("")

  const [description, setDescription] = useState(indicator.glossaryDescription ?? "")
  const [interpretation, setInterpretation] = useState(indicator.interpretation ?? "")
  const [goodPractices, setGoodPractices] = useState(indicator.goodPractices ?? "")
  const [feedbackGuidance, setFeedbackGuidance] = useState(indicator.feedbackGuidance ?? "")

  function openCreateRuleForm() {
    setEditingRule(null)
    setOrgScope({ scopeType: "ALL_TEAMS" })
    setCalculationPeriod("MONTHLY")
    setCalculationMethod("")
    setAttainmentRule("")
    saveRuleMutation.reset()
    setRuleFormOpen(true)
  }

  function openEditRuleForm(rule: CalculationRule) {
    setEditingRule(rule)
    setOrgScope({
      scopeType: rule.scopeType as OrgScopeValue["scopeType"],
      teamId: rule.teamId ?? undefined,
      subteamId: rule.subteamId ?? undefined,
    })
    setCalculationPeriod(rule.calculationPeriod)
    setCalculationMethod(rule.calculationMethod)
    setAttainmentRule(rule.attainmentRule ?? "")
    saveRuleMutation.reset()
    setRuleFormOpen(true)
  }

  async function handleSaveRule() {
    await saveRuleMutation.mutateAsync({
      indicatorDefinitionId: indicator.id,
      orgScope,
      calculationPeriod,
      calculationMethod,
      attainmentRule: attainmentRule || undefined,
    })
    setRuleFormOpen(false)
    setEditingRule(null)
  }

  async function handleSaveGlossary() {
    await saveGlossaryMutation.mutateAsync({
      indicatorDefinitionId: indicator.id,
      description,
      interpretation,
      goodPractices,
      feedbackGuidance,
    })
  }

  const canSubmitGlossary = [description, interpretation, goodPractices, feedbackGuidance].every((value) => value.trim().length > 4)

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as IndicatorTab)}>
      <div className="flex items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="definition">Definição</TabsTrigger>
          <TabsTrigger value="rules">Regras de cálculo</TabsTrigger>
          <TabsTrigger value="diagnosis">Diagnóstico com IA</TabsTrigger>
          <TabsTrigger value="glossary">Glossário</TabsTrigger>
        </TabsList>
        {tab === "rules" && !ruleFormOpen ? (
          <Button size="sm" onClick={openCreateRuleForm}>
            <Plus /> Nova regra
          </Button>
        ) : null}
      </div>

      <TabsContent value="definition" className="mt-4">
        <IndicatorDefinitionSummary indicator={indicator} />
      </TabsContent>

      <TabsContent value="rules" className="mt-4">
        {ruleFormOpen ? null : indicator.calculationRules.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma regra de cálculo específica — usa o padrão geral do indicador.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Grupo</TableHead>
                <TableHead>Periodicidade</TableHead>
                <TableHead>Como é calculado</TableHead>
                <TableHead>Regra de atingimento</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {indicator.calculationRules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell className="font-medium">{scopeLabel(rule)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{CALCULATION_PERIOD_LABELS[rule.calculationPeriod]}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{rule.calculationMethod}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{rule.attainmentRule ?? "—"}</TableCell>
                  <TableCell className="flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant={rule.active ? "secondary" : "outline"}
                      disabled={setRuleActiveMutation.isPending}
                      onClick={() => setRuleActiveMutation.mutate({ ruleId: rule.id, active: !rule.active })}
                    >
                      {rule.active ? "Ativa" : "Inativa"}
                    </Button>
                    <Button size="icon" variant="ghost" aria-label="Editar regra" onClick={() => openEditRuleForm(rule)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <DeleteRuleButton rule={rule} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {ruleFormOpen ? (
          <div className="max-w-xl space-y-4">
            <h3 className="text-sm font-semibold">{editingRule ? "Editar regra" : "Nova regra"}</h3>
            {teamsQuery.data ? <OrgScopeSelect teams={teamsQuery.data} value={orgScope} onChange={setOrgScope} /> : <Skeleton className="h-10 w-full" />}

            <div className="space-y-1.5">
              <Label htmlFor={`calculation-period-${indicator.id}`}>Periodicidade de apuração</Label>
              <Select value={calculationPeriod} onValueChange={(value) => setCalculationPeriod(value as CalculationPeriod)}>
                <SelectTrigger id={`calculation-period-${indicator.id}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CALCULATION_PERIOD_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`calculation-method-${indicator.id}`}>Como o indicador é calculado neste grupo</Label>
              <Textarea id={`calculation-method-${indicator.id}`} value={calculationMethod} onChange={(event) => setCalculationMethod(event.target.value)} rows={3} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`attainment-rule-${indicator.id}`}>Regra de atingimento (opcional)</Label>
              <Textarea id={`attainment-rule-${indicator.id}`} value={attainmentRule} onChange={(event) => setAttainmentRule(event.target.value)} rows={2} />
            </div>

            {saveRuleMutation.isError ? <p className="text-sm text-destructive">{(saveRuleMutation.error as Error).message}</p> : null}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setRuleFormOpen(false); setEditingRule(null) }}>
                Cancelar
              </Button>
              <Button disabled={calculationMethod.trim().length < 5 || saveRuleMutation.isPending} onClick={handleSaveRule}>
                {saveRuleMutation.isPending ? "Salvando..." : "Salvar regra"}
              </Button>
            </div>
          </div>
        ) : null}
      </TabsContent>

      <TabsContent value="diagnosis" className="mt-4">
        <IndicatorDiagnosticStrategyTab indicatorId={indicator.id} />
      </TabsContent>

      <TabsContent value="glossary" className="mt-4 max-w-xl space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={`glossary-description-${indicator.id}`}>Descrição</Label>
          <Textarea id={`glossary-description-${indicator.id}`} value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`glossary-interpretation-${indicator.id}`}>Como interpretar</Label>
          <Textarea id={`glossary-interpretation-${indicator.id}`} value={interpretation} onChange={(event) => setInterpretation(event.target.value)} rows={2} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`glossary-good-practices-${indicator.id}`}>Boas práticas associadas</Label>
          <Textarea id={`glossary-good-practices-${indicator.id}`} value={goodPractices} onChange={(event) => setGoodPractices(event.target.value)} rows={2} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`glossary-feedback-guidance-${indicator.id}`}>Orientação para o feedback</Label>
          <Textarea id={`glossary-feedback-guidance-${indicator.id}`} value={feedbackGuidance} onChange={(event) => setFeedbackGuidance(event.target.value)} rows={2} />
        </div>
        {saveGlossaryMutation.isError ? <p className="text-sm text-destructive">{(saveGlossaryMutation.error as Error).message}</p> : null}
        <div className="flex justify-end">
          <Button disabled={!canSubmitGlossary || saveGlossaryMutation.isPending} onClick={handleSaveGlossary}>
            {saveGlossaryMutation.isPending ? "Salvando..." : "Salvar glossário"}
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  )
}

function IndicatorManagerSheet({ indicator, onOpenChange }: { indicator: IndicatorWithRules | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={indicator !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:sm:max-w-2xl">
        {indicator ? (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle>{indicator.name}</SheetTitle>
                <Badge variant="outline">{indicator.code}</Badge>
                {!indicator.active ? <Badge variant="outline">Inativo</Badge> : null}
              </div>
              <SheetDescription>{indicator.glossaryDescription ?? "Sem descrição de glossário cadastrada."}</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-4">
              {/* key força o formulário do glossário a recarregar quando outro indicador é aberto */}
              <IndicatorManager key={indicator.id} indicator={indicator} />
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function IndicatorCard({ indicator, onManage }: { indicator: IndicatorWithRules; onManage: (indicator: IndicatorWithRules) => void }) {
  const rules = indicator.calculationRules.length
  return (
    <EntityCard
      muted={!indicator.active}
      icon={<EntityCardIcon icon={Gauge} className="bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300" />}
      kicker={
        <>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{indicator.code}</span>
          <span aria-hidden>·</span>
          <span>{indicator.unit}</span>
          <span aria-hidden>·</span>
          <span>{DESIRED_DIRECTION_LABELS[indicator.desiredDirection as DesiredDirection] ?? indicator.desiredDirection}</span>
        </>
      }
      title={indicator.name}
      onOpen={() => onManage(indicator)}
      actions={<IndicatorActions indicator={indicator} />}
      description={indicator.glossaryDescription}
      descriptionFallback="Sem descrição de glossário cadastrada."
      tags={
        <>
          <EntityCardTag icon={Activity}>{describeIndicatorCapability(indicator).label}</EntityCardTag>
          <EntityCardTag icon={ListChecks}>
            {rules} {rules === 1 ? "regra de cálculo" : "regras de cálculo"}
          </EntityCardTag>
          <EntityCardTag icon={BookText}>{indicator.glossaryDescription ? "Glossário preenchido" : "Sem glossário"}</EntityCardTag>
          <EntityCardTag icon={Sparkles}>Diagnóstico IA: {STRATEGY_STATUS_LABELS[indicator.diagnosticStrategyStatus ?? "NOT_CONFIGURED"]}{indicator.diagnosticStrategyStatus === "PUBLISHED" && indicator.diagnosticStrategyDraftPending ? " · rascunho pendente" : ""}</EntityCardTag>
        </>
      }
      footerStart={
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onManage(indicator)}>
          <SlidersHorizontal /> Configurar
        </Button>
      }
      footerEnd={<Badge variant={indicator.active ? "secondary" : "outline"}>{indicator.active ? "Ativo" : "Inativo"}</Badge>}
    />
  )
}


function IndicatorsTable({ indicators, onManage }: { indicators: IndicatorWithRules[]; onManage: (indicator: IndicatorWithRules) => void }) {
  return (
    <div className={TABLE_FRAME}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Indicador</TableHead>
            <TableHead>Unidade</TableHead>
            <TableHead>Direção</TableHead>
            <TableHead>Operacional</TableHead>
            <TableHead>Regras</TableHead>
            <TableHead>Glossário</TableHead>
            <TableHead>Diagnóstico IA</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {indicators.map((indicator) => (
            <TableRow key={indicator.id} className={indicator.active ? undefined : "opacity-60"}>
              <TableCell>
                <button type="button" className="text-left font-medium hover:underline" onClick={() => onManage(indicator)}>
                  {indicator.name}
                </button>
                <p className="text-xs text-muted-foreground">{indicator.code}</p>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{indicator.unit}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{DESIRED_DIRECTION_LABELS[indicator.desiredDirection as DesiredDirection] ?? indicator.desiredDirection}</TableCell>
              <TableCell>
                <CapabilityBadge indicator={indicator} />
              </TableCell>
              <TableCell>
                <Badge variant="outline">{indicator.calculationRules.length}</Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{indicator.glossaryDescription ? "Preenchido" : "—"}</TableCell>
              <TableCell>
                <DiagnosticStrategyStatusBadge status={indicator.diagnosticStrategyStatus ?? "NOT_CONFIGURED"} draftPending={indicator.diagnosticStrategyDraftPending} />
              </TableCell>
              <TableCell>
                <Badge variant={indicator.active ? "secondary" : "outline"}>{indicator.active ? "Ativo" : "Inativo"}</Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => onManage(indicator)}>
                    <SlidersHorizontal data-icon="inline-start" /> Configurar
                  </Button>
                  <IndicatorActions indicator={indicator} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

type IndicatorFilters = Omit<IndicatorListParams, "page" | "pageSize" | "search"> & { search: string }

const DEFAULT_FILTERS: IndicatorFilters = { search: "", desiredDirection: [], calculationPeriod: [] }
const DIRECTION_OPTIONS = optionsFromLabels(DESIRED_DIRECTION_LABELS)
const PERIOD_OPTIONS = optionsFromLabels(CALCULATION_PERIOD_LABELS)

function NewIndicatorForm({ onDone }: { onDone: () => void }) {
  const createMutation = useCreateIndicatorDefinitionMutation()
  const catalogQuery = useIndicatorCatalogQuery()
  if (catalogQuery.isError) return <p className="text-sm text-destructive">Não foi possível carregar o catálogo de comportamentos do indicador.</p>
  if (!catalogQuery.data) return <Skeleton className="h-64 w-full max-w-2xl" />
  return (
    <IndicatorDefinitionForm
      catalog={catalogQuery.data}
      pending={createMutation.isPending}
      error={createMutation.isError ? (createMutation.error as Error).message : null}
      submitLabel="Salvar indicador"
      onCancel={onDone}
      onSubmit={async (value) => {
        await createMutation.mutateAsync(value)
        createMutation.reset()
        onDone()
      }}
    />
  )
}

export function IndicatorsPage() {
  const teamsQuery = useTeamsQuery()
  const [autoOpen, setAutoOpen] = useAutoOpenFromQuery("new")
  const [tab, setTab] = useState<"list" | "form">("list")
  const [managingId, setManagingId] = useState<string | null>(null)

  const list = useAdminListState({ storageKey: "indicators", defaultFilters: DEFAULT_FILTERS })
  const pageQuery = useIndicatorsWithRulesPageQuery(list.params)

  // O painel lê sempre o registro mais recente da página — depois de salvar uma regra ou o
  // glossário, a lista é invalidada e o painel acompanha sem precisar reabrir.
  const managingIndicator = useMemo(
    () => pageQuery.data?.items.find((indicator) => indicator.id === managingId) ?? null,
    [pageQuery.data, managingId],
  )

  // `?new` na URL abre o formulário (ajuste na renderização, sem render extra) e consome o pedido: cada nova navegação
  // com `?new` abre de novo.
  if (autoOpen) {
    setAutoOpen(false)
    setTab("form")
  }

  function openCreateForm() {
    setTab("form")
  }

  return (
    <section className="space-y-4">
      <PageHeader
        icon={Gauge}
        title="Indicadores"
        description="Catálogo de indicadores: como cada um se comporta (unidade, direção, medição operacional, fechamento oficial), glossário e regras por grupo/subgrupo."
        actions={
          tab === "list" ? (
            <Button onClick={openCreateForm}>
              <Plus /> Novo indicador
            </Button>
          ) : null
        }
      />
      <Card>
        <CardContent>
          <Tabs value={tab} onValueChange={(value) => setTab(value as "list" | "form")}>
            <TabsList>
              <TabsTrigger value="list">Lista</TabsTrigger>
              <TabsTrigger value="form">Novo indicador</TabsTrigger>
            </TabsList>

            <TabsContent value="list" className="mt-4 space-y-4">
              <ListToolbar
                search={
                  <ListSearchInput
                    value={list.filters.search}
                    onChange={(value) => list.setFilter("search", value)}
                    placeholder="Buscar por código, nome ou unidade"
                    ariaLabel="Buscar indicador"
                    pending={list.isSearchPending}
                  />
                }
                viewToggle={<ListViewToggle value={list.view} onChange={list.setView} />}
                hasActiveFilters={list.hasActiveFilters}
                onClearFilters={list.resetFilters}
              >
                <ListMultiSelectFilter label="Direção" values={list.filters.desiredDirection} onChange={(values) => list.setFilter("desiredDirection", values)} options={DIRECTION_OPTIONS} />
                <ListBooleanFilter value={list.filters.active} onChange={(value) => list.setFilter("active", value)} allLabel="Qualquer status" trueLabel="Ativos" falseLabel="Inativos" ariaLabel="Filtrar por status" />
                <ListBooleanFilter value={list.filters.hasGlossary} onChange={(value) => list.setFilter("hasGlossary", value)} allLabel="Com ou sem glossário" trueLabel="Com glossário" falseLabel="Sem glossário" ariaLabel="Filtrar por glossário" />
                <ListBooleanFilter value={list.filters.dailySupported} onChange={(value) => list.setFilter("dailySupported", value)} allLabel="Qualquer medição" trueLabel="Com medição diária" falseLabel="Só fechamento oficial" ariaLabel="Filtrar por medição operacional" />
                <ListMultiSelectFilter label="Periodicidade das regras" values={list.filters.calculationPeriod} onChange={(values) => list.setFilter("calculationPeriod", values)} options={PERIOD_OPTIONS} />
                <ListOrgScopeFilter
                  teams={teamsQuery.data}
                  globalLabel="Com regra para todos os grupos"
                  value={{ scopeType: list.filters.scopeType, teamId: list.filters.teamId, subteamId: list.filters.subteamId }}
                  onChange={(scope) => list.patchFilters({ scopeType: scope.scopeType, teamId: scope.teamId, subteamId: scope.subteamId })}
                />
              </ListToolbar>

              <AdminListView
                state={list}
                query={pageQuery}
                errorMessage="Não foi possível carregar os indicadores."
                empty={{
                  icon: CalendarRange,
                  title: "Nenhum indicador cadastrado ainda",
                  description: "Cadastre os indicadores da operação para configurar regras de cálculo e glossário.",
                  action: (
                    <Button onClick={openCreateForm}>
                      <Plus /> Novo indicador
                    </Button>
                  ),
                }}
                noResultsTitle="Nenhum indicador corresponde à busca ou aos filtros"
                itemLabel={["indicador", "indicadores"]}
                renderList={(indicators) => <IndicatorsTable indicators={indicators} onManage={(indicator) => setManagingId(indicator.id)} />}
                renderCards={(indicators) => (
                  <ListCardGrid>
                    {indicators.map((indicator) => (
                      <IndicatorCard key={indicator.id} indicator={indicator} onManage={(entry) => setManagingId(entry.id)} />
                    ))}
                  </ListCardGrid>
                )}
              />
            </TabsContent>

            <TabsContent value="form" className="mt-4">
              <NewIndicatorForm onDone={() => setTab("list")} />
            </TabsContent>
          </Tabs>
        </CardContent>

        <IndicatorManagerSheet indicator={managingIndicator} onOpenChange={(open) => (open ? undefined : setManagingId(null))} />
      </Card>
    </section>
  )
}
