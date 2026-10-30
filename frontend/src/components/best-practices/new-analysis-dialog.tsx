"use client"

import { useId, useState } from "react"
import { Play } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCreateAnalysisMutation } from "@/queries/best-practices/use-best-practices"
import type { BestPracticesMeta, CreateAnalysisInput, DataOrigin } from "@/schemas/best-practices/best-practices.schema"

const periodLabel = (period: string) => `${period.slice(5, 7)}/${period.slice(0, 4)}`
/** Valor do Select para "comparar o Grupo inteiro" (sem Subgrupo). */
const WHOLE_TEAM = "__GRUPO__"
const firstSubteamChoice = (team: BestPracticesMeta["manageableTeams"][number] | undefined) => (!team || team.wholeTeam ? WHOLE_TEAM : team.subteams[0]?.id ?? WHOLE_TEAM)

/**
 * Pedido de análise (quem administra a configuração do Grupo ou do Subgrupo). Real = interações do Grupo — ou só de um Subgrupo dele,
 * comparando os melhores do subgrupo com os demais do subgrupo — com transcrição e o quartil oficial do indicador nas competências escolhidas; sintético = o dataset de teste, com o modelo simulado (zero IA) ou o real. A análise roda
 * em segundo plano; o relatório explica cada descarte.
 */
export function NewAnalysisDialog({ meta }: { meta: BestPracticesMeta }) {
  const [open, setOpen] = useState(false)
  const create = useCreateAnalysisMutation()
  const [origin, setOrigin] = useState<DataOrigin>(meta.manageableTeams.length > 0 ? "REAL" : "SYNTHETIC")
  const [teamId, setTeamId] = useState<string | undefined>(meta.manageableTeams[0]?.id)
  const [subteamChoice, setSubteamChoice] = useState<string>(firstSubteamChoice(meta.manageableTeams[0]))
  const [datasetId, setDatasetId] = useState<string | undefined>(meta.datasets[0]?.id)
  const [outcomeSource, setOutcomeSource] = useState<"INDICATOR" | "CALL_SIGNAL">("INDICATOR")
  const [indicatorId, setIndicatorId] = useState<string | undefined>()
  const [signalId, setSignalId] = useState<string | undefined>(meta.signals[0]?.id)
  const [periods, setPeriods] = useState<string[]>(meta.manageableTeams.length > 0 ? meta.periods.slice(0, 1) : (meta.datasets[0]?.periods ?? []).slice(0, 1))
  const [level, setLevel] = useState<CreateAnalysisInput["contextLevel"]>("SUB_REASON")
  const [comparison, setComparison] = useState(meta.comparisonModes[0]?.mode ?? "TOP_QUARTILE_VS_REST")
  const [modelMode, setModelMode] = useState<CreateAnalysisInput["modelMode"]>("SIMULATED_ANSWER_KEY")
  const fieldId = useId()
  const synthetic = origin === "SYNTHETIC"
  const dataset = meta.datasets.find((item) => item.id === datasetId)
  const team = meta.manageableTeams.find((item) => item.id === teamId)
  const chooseTeam = (next: string) => {
    setTeamId(next)
    setSubteamChoice(firstSubteamChoice(meta.manageableTeams.find((item) => item.id === next)))
  }
  const chooseOrigin = (next: DataOrigin) => {
    setOrigin(next)
    setPeriods(next === "SYNTHETIC" ? (dataset?.periods ?? []).slice(0, 1) : meta.periods.slice(0, 1))
  }
  const subteamId = subteamChoice === WHOLE_TEAM ? null : subteamChoice
  const bySignal = outcomeSource === "CALL_SIGNAL"
  const signal = meta.signals.find((item) => item.id === signalId)
  const ready = (bySignal ? Boolean(signalId) : Boolean(indicatorId)) && periods.length > 0 && (synthetic ? Boolean(datasetId) : Boolean(teamId) && (subteamId !== null || Boolean(team?.wholeTeam)))

  const submit = () => {
    if (!ready) return
    create.mutate(
      { origin, outcomeSource, ...(bySignal ? { channelFlagId: signalId ?? null } : { indicatorDefinitionId: indicatorId ?? null }), referencePeriods: periods, contextLevel: level, comparison, modelMode: synthetic ? modelMode : "REAL", ...(synthetic ? { syntheticDatasetId: datasetId ?? null } : { teamId: teamId ?? null, subteamId }) },
      { onSuccess: () => setOpen(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Play /> Nova análise</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova análise de boas práticas</DialogTitle>
          <DialogDescription>Compara as chamadas dos operadores com melhores resultados com as do grupo de referência, no mesmo contexto. Os números são calculados pelo sistema; a IA só levanta hipóteses, codifica as chamadas sem saber o grupo e confere as obrigações.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {meta.capabilities.canRunSynthetic ? (
            <div className="space-y-1">
              <Label id={`${fieldId}-origin`}>Dados</Label>
              <RadioGroup aria-labelledby={`${fieldId}-origin`} value={origin} onValueChange={(value) => chooseOrigin(value as DataOrigin)} className="flex gap-4">
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="REAL" disabled={meta.manageableTeams.length === 0} /> Reais</label>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="SYNTHETIC" disabled={meta.datasets.length === 0} /> Sintéticos (teste)</label>
              </RadioGroup>
            </div>
          ) : null}
          {synthetic ? (
            <div className="space-y-1">
              <Label>Dataset sintético</Label>
              <Select value={datasetId ?? ""} onValueChange={setDatasetId}><SelectTrigger aria-label="Dataset sintético"><SelectValue placeholder="Escolha" /></SelectTrigger><SelectContent>{meta.datasets.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select>
              {dataset ? <p className="text-xs text-muted-foreground">{dataset.calls} chamadas fictícias de {dataset.operators} operadores. Valida o mecanismo; não prova nada sobre o mundo real.</p> : null}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Grupo (operação)</Label>
                <Select value={teamId ?? ""} onValueChange={chooseTeam}><SelectTrigger aria-label="Grupo"><SelectValue placeholder="Escolha" /></SelectTrigger><SelectContent>{meta.manageableTeams.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-1">
                <Label>Subgrupo</Label>
                <Select value={subteamChoice} onValueChange={setSubteamChoice} disabled={!team || (team.wholeTeam && team.subteams.length === 0)}>
                  <SelectTrigger aria-label="Subgrupo"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {team?.wholeTeam ? <SelectItem value={WHOLE_TEAM}>Todo o Grupo</SelectItem> : null}
                    {(team?.subteams ?? []).map((subteam) => <SelectItem key={subteam.id} value={subteam.id}>{subteam.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">Com um Subgrupo, compara os melhores do subgrupo com os demais do subgrupo (mesmo quartil oficial). O feedback usa primeiro a prática do subgrupo da pessoa e, sem ela, a do Grupo.</p>
            </div>
          )}
          <div className="space-y-1">
            <Label id={`${fieldId}-outcome`}>Medir por</Label>
            <RadioGroup aria-labelledby={`${fieldId}-outcome`} value={outcomeSource} onValueChange={(value) => setOutcomeSource(value as "INDICATOR" | "CALL_SIGNAL")} className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="INDICATOR" /> Indicador (operadores do 1º quartil)</label>
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="CALL_SIGNAL" disabled={meta.signals.length === 0} /> Sinal da chamada (chamadas boas × ruins)</label>
            </RadioGroup>
            {meta.signals.length === 0 ? <p className="text-xs text-muted-foreground">Para medir pelo sinal, cadastre no sinal da chamada o que é chamada boa e ruim.</p> : null}
          </div>
          {bySignal ? (
            <div className="space-y-1">
              <Label>Sinal da chamada</Label>
              <Select value={signalId ?? ""} onValueChange={setSignalId}><SelectTrigger aria-label="Sinal da chamada"><SelectValue placeholder="Escolha o sinal" /></SelectTrigger><SelectContent>{meta.signals.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
              {signal ? <p className="text-xs text-muted-foreground">Compara chamadas com {signal.good} (boas) e com {signal.bad} (ruins), no mesmo assunto. Chamada sem o sinal ou no meio fica fora.</p> : null}
            </div>
          ) : (
            <div className="space-y-1">
              <Label>Indicador</Label>
              <Select value={indicatorId ?? ""} onValueChange={setIndicatorId}><SelectTrigger aria-label="Indicador"><SelectValue placeholder="Escolha o indicador" /></SelectTrigger><SelectContent>{meta.indicators.map((indicator) => <SelectItem key={indicator.id} value={indicator.id}>{indicator.name}</SelectItem>)}</SelectContent></Select>
            </div>
          )}
          <div className="space-y-1">
            <Label>{bySignal ? "Competências (meses das chamadas)" : "Competências oficiais (quartil do fechamento)"}</Label>
            <div className="flex flex-wrap gap-3">
              {(synthetic ? dataset?.periods ?? [] : meta.periods.slice(0, 6)).map((period) => (
                <label key={period} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={periods.includes(period)} onCheckedChange={(checked) => setPeriods((current) => (checked ? [...new Set([...current, period])] : current.filter((item) => item !== period)))} />
                  {periodLabel(period)}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Contexto</Label>
              <Select value={level} onValueChange={(value) => setLevel(value as CreateAnalysisInput["contextLevel"])}><SelectTrigger aria-label="Nível de contexto"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SUB_REASON">Motivo › submotivo</SelectItem><SelectItem value="REASON">Só o motivo</SelectItem></SelectContent></Select>
            </div>
            {bySignal ? null : (
              <div className="space-y-1">
                <Label>Comparação</Label>
                <Select value={comparison} onValueChange={setComparison}><SelectTrigger aria-label="Comparação"><SelectValue /></SelectTrigger><SelectContent>{meta.comparisonModes.map((mode) => <SelectItem key={mode.mode} value={mode.mode}>{mode.reference}</SelectItem>)}</SelectContent></Select>
              </div>
            )}
          </div>
          {synthetic ? (
            <div className="space-y-1">
              <Label id={`${fieldId}-model`}>Modelo</Label>
              <RadioGroup aria-labelledby={`${fieldId}-model`} value={modelMode} onValueChange={(value) => setModelMode(value as CreateAnalysisInput["modelMode"])} className="space-y-1">
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="SIMULATED_ANSWER_KEY" disabled={!dataset?.hasAnswerKey} /> Simulado pelo gabarito (zero IA, sem custo)</label>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="REAL" /> IA real (custo registrado no uso de IA)</label>
              </RadioGroup>
            </div>
          ) : <p className="text-xs text-muted-foreground">Usa IA (Use Case “Base de boas práticas”): até 80 chamadas ao modelo por análise, com o custo registrado.</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button disabled={!ready || create.isPending} onClick={submit}>Pedir análise</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
