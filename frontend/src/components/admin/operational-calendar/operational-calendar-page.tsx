"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, CalendarDays, ExternalLink, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ListEmptyState, ListErrorState } from "@/components/admin/shared/list/list-states"
import { formatCivilDate } from "@/lib/format/date"
import { useCalendarSettingsQuery, useCapitalsQuery, useCreateHolidayMutation, useDeleteHolidayMutation, useHolidayCatalogCoverageQuery, useHolidayCatalogQuery, useHolidaysQuery, useUpdateCalendarSettingsMutation, useUpdateHolidayMutation } from "@/queries/admin/use-operational-calendar-queries"
import { CATALOG_SCOPE_LABELS, CATALOG_SCOPES, HOLIDAY_SCOPE_LABELS, HOLIDAY_SCOPES, VERIFICATION_LABELS, type CatalogScope, type HolidayScope } from "@/schemas/admin/operational-calendar.schema"
import { HOLIDAY_FALLBACK_POLICIES, HOLIDAY_FALLBACK_POLICY_LABELS, type HolidayFallbackPolicy } from "@/schemas/people/employment-status.schema"

const ALL = "__all__"

/**
 * Calendário operacional — três coisas que não se misturam:
 *  - CALENDÁRIO-BASE (read-only, controlado pelo sistema): feriados legais nacionais, estaduais e
 *    municipais das 27 capitais, com fonte/base legal — o admin não recadastra o Natal 27 vezes;
 *  - DATAS DA ORGANIZAÇÃO: overlay administrativo (datas próprias da operação);
 *  - POLÍTICA: feriado NUNCA é folga automática. Só afeta quem está no fallback seg–sex (sem escala
 *    explícita) e só com a política EXCLUDE; escala explícita sempre vence. Horizonte da escala:
 *    "até quando o calendário é conhecido" (≠ freshness) com limite de aviso.
 */
export function OperationalCalendarPage() {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <CalendarDays className="size-5" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Calendário operacional</h1>
          <p className="text-sm text-muted-foreground">
            Feriados legais por capital operacional (catálogo-base), datas próprias da organização e a política de feriado. Feriado não é folga automática: call center opera em feriado quando a escala diz que trabalha — a escala informada pela fonte sempre vence.
          </p>
        </div>
      </div>

      <SettingsCard />

      <Tabs defaultValue="base">
        <TabsList>
          <TabsTrigger value="base">Calendário-base</TabsTrigger>
          <TabsTrigger value="organization">Datas da organização</TabsTrigger>
        </TabsList>
        <TabsContent value="base" className="mt-4 space-y-4">
          <CatalogCoverageCard />
          <BaseCatalogCard />
        </TabsContent>
        <TabsContent value="organization" className="mt-4">
          <OrganizationHolidaysCard />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** Cobertura VERIFICADA do catálogo por ano + registro explícito de lacunas — o catálogo nunca é apresentado como completo. */
function CatalogCoverageCard() {
  const query = useHolidayCatalogCoverageQuery()
  const capitals = useCapitalsQuery()
  const capitalName = (code: string) => capitals.data?.capitals.find((entry) => entry.code === code)?.name ?? code
  if (query.isPending) return <Skeleton className="h-32 w-full" />
  if (query.isError || !query.data) return <ListErrorState message="Não foi possível carregar a cobertura do catálogo." onRetry={() => void query.refetch()} />
  const coverage = query.data
  return (
    <Card data-testid="holiday-catalog-coverage">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-300" aria-hidden /> Cobertura verificada e pendências
        </CardTitle>
        <CardDescription>
          O catálogo-base traz só o que foi verificado em fonte oficial, base de legislação ou fonte secundária citando a lei — o resto fica registrado como lacuna, nunca inventado. {coverage.pendingVerifications} pendência(s) de verificação · ponto facultativo nunca entra.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="grid gap-2 sm:grid-cols-3">
          {coverage.years.map((year) => (
            <li key={year.year} className="rounded-lg border border-border p-3 text-sm" data-testid="catalog-coverage-year">
              <p className="font-medium">{year.year}</p>
              <p className="text-muted-foreground">{year.national} nacionais · estadual em {year.capitalsWithStateHoliday}/27 capitais · municipal em {year.capitalsWithMunicipalHoliday}/27</p>
              <p className="text-xs text-muted-foreground">Verificação: {year.byVerification.OFFICIAL} oficial · {year.byVerification.LEGAL_DATABASE} base legal · {year.byVerification.SECONDARY} secundária{year.unverifiedRows > 0 ? ` · ${year.unverifiedRows} sem registro (rode db:seed:reference)` : ""}</p>
            </li>
          ))}
        </ul>
        {coverage.capitalsWithoutMunicipalHoliday.length > 0 ? (
          <p className="text-sm text-muted-foreground">Capitais sem feriado municipal no catálogo: {coverage.capitalsWithoutMunicipalHoliday.map(capitalName).join(", ")}.</p>
        ) : null}
        <details className="rounded-lg border border-border p-3" data-testid="catalog-gaps">
          <summary className="cursor-pointer text-sm font-medium">Pendências de verificação ({coverage.gaps.length} lacunas registradas)</summary>
          <ul className="mt-2 space-y-2 text-xs text-muted-foreground">
            {coverage.gaps.map((gap, index) => (
              <li key={index}>
                <span className="font-medium text-foreground">{gap.label}</span> · {gap.years.join(", ")} — {gap.reason}
              </li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  )
}

function SettingsCard() {
  const query = useCalendarSettingsQuery()
  const update = useUpdateCalendarSettingsMutation()
  const [warningDays, setWarningDays] = useState<string | null>(null)
  if (query.isLoading) return <Skeleton className="h-28 rounded-xl" />
  if (query.isError || !query.data) return <ListErrorState message="Não foi possível carregar a política do calendário." onRetry={() => query.refetch()} />
  const settings = query.data
  const horizon = settings.horizon
  const daysValue = warningDays ?? String(settings.scheduleHorizonWarningDays)
  return (
    <Card data-testid="calendar-settings">
      <CardHeader>
        <CardTitle>Política e horizonte</CardTitle>
        <CardDescription>Como o feriado entra no fallback seg–sex de quem não tem escala explícita, e quando avisar que o calendário de escalas está terminando.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 md:items-end xl:grid-cols-[1fr_220px_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="holiday-policy">Feriado no fallback seg–sex</Label>
          <Select value={settings.holidayFallbackPolicy} onValueChange={(value) => update.mutate({ holidayFallbackPolicy: value as HolidayFallbackPolicy })} disabled={update.isPending}>
            <SelectTrigger id="holiday-policy" className="w-full" aria-label="Política de feriado no fallback">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOLIDAY_FALLBACK_POLICIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {HOLIDAY_FALLBACK_POLICY_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Só vale para quem NÃO tem escala explícita. Com escala informada pela fonte, o feriado nunca muda o dia.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="horizon-warning-days">Avisar quando restarem ≤ dias</Label>
          <div className="flex gap-2">
            <Input id="horizon-warning-days" type="number" min={1} max={90} value={daysValue} onChange={(event) => setWarningDays(event.target.value)} />
            <Button type="button" variant="outline" size="sm" disabled={update.isPending || Number(daysValue) === settings.scheduleHorizonWarningDays || !(Number(daysValue) >= 1 && Number(daysValue) <= 90)} onClick={() => update.mutate({ scheduleHorizonWarningDays: Number(daysValue) })}>
              Salvar
            </Button>
          </div>
        </div>
        <div className="space-y-1 text-sm" data-testid="calendar-horizon" data-ending-soon={horizon.endingSoon}>
          <p className="text-xs text-muted-foreground">Horizonte da escala (≠ freshness da carga)</p>
          {horizon.configured && horizon.coverageUntil ? (
            <p>
              Calendário disponível: <span className="font-medium">{horizon.coverageFrom ? formatCivilDate(horizon.coverageFrom) : "—"} → {formatCivilDate(horizon.coverageUntil)}</span>
            </p>
          ) : (
            <p>Nenhum calendário de escala recebido ainda.</p>
          )}
          {horizon.endingSoon ? (
            <p className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" data-testid="calendar-horizon-warning">
              <AlertTriangle className="size-3" aria-hidden /> {horizon.daysRemaining !== null && horizon.daysRemaining <= 0 ? "O calendário já terminou" : horizon.daysRemaining === 1 ? "O calendário termina amanhã" : `O calendário termina em ${horizon.daysRemaining} dias`}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function BaseCatalogCard() {
  const capitals = useCapitalsQuery()
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState<string>(String(currentYear))
  const [capital, setCapital] = useState<string>(ALL)
  const [state, setState] = useState<string>(ALL)
  const [scope, setScope] = useState<string>(ALL)
  const filter = useMemo(() => ({ year: Number(year), capital: capital === ALL ? undefined : capital, state: state === ALL ? undefined : state, scope: scope === ALL ? undefined : (scope as CatalogScope) }), [year, capital, state, scope])
  const query = useHolidayCatalogQuery(filter)
  const capitalName = (code: string | null) => capitals.data?.capitals.find((entry) => entry.code === code)?.name ?? code ?? ""
  return (
    <Card data-testid="holiday-catalog">
      <CardHeader>
        <CardTitle>Calendário-base (controlado pelo sistema)</CardTitle>
        <CardDescription>
          Feriados legais com fonte verificável: nacionais valem para todos; estaduais valem pela UF derivada da capital operacional; municipais valem só na própria capital. Filtrar por capital mostra o que se aplica a ela. Pontos facultativos não entram.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="catalog-year">Ano</Label>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger id="catalog-year" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[currentYear - 1, currentYear, currentYear + 1, currentYear + 2].map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="catalog-capital">Capital</Label>
            <Select
              value={capital}
              onValueChange={(value) => {
                setCapital(value)
                if (value !== ALL) setState(ALL)
              }}
            >
              <SelectTrigger id="catalog-capital" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as capitais</SelectItem>
                {(capitals.data?.capitals ?? []).map((entry) => (
                  <SelectItem key={entry.code} value={entry.code}>
                    {entry.name} / {entry.stateCode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="catalog-state">UF</Label>
            <Select value={state} onValueChange={setState} disabled={capital !== ALL}>
              <SelectTrigger id="catalog-state" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as UFs</SelectItem>
                {(capitals.data?.states ?? []).map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {entry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="catalog-scope">Escopo</Label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger id="catalog-scope" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os escopos</SelectItem>
                {CATALOG_SCOPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {CATALOG_SCOPE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {query.isLoading ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : query.isError || !query.data ? (
          <ListErrorState message="Não foi possível carregar o calendário-base." onRetry={() => query.refetch()} />
        ) : query.data.length === 0 ? (
          <ListEmptyState icon={CalendarDays} title="Nenhum feriado no catálogo para este filtro" description="O catálogo-base cobre 2026–2028 com fontes oficiais; lacunas conhecidas ficam registradas na documentação, nunca inventadas." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Escopo</TableHead>
                  <TableHead>Aplica-se a</TableHead>
                  <TableHead>Fonte / base legal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((holiday) => (
                  <TableRow key={holiday.id} data-testid="catalog-row" data-scope={holiday.scope}>
                    <TableCell className="tabular-nums">{formatCivilDate(holiday.date)}</TableCell>
                    <TableCell>{holiday.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{CATALOG_SCOPE_LABELS[holiday.scope]}</TableCell>
                    <TableCell className="text-sm">{holiday.scope === "NATIONAL" ? "Brasil" : holiday.scope === "STATE" ? `UF ${holiday.stateCode}` : `${capitalName(holiday.capitalCode)}`}</TableCell>
                    <TableCell className="max-w-md text-xs text-muted-foreground">
                      <a href={holiday.sourceReference} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
                        {holiday.sourceName} <ExternalLink className="size-3" aria-hidden />
                      </a>
                      {holiday.legalReference ? <span className="block">{holiday.legalReference}</span> : null}
                      {holiday.verification ? <span className={`block ${holiday.verification === "SECONDARY" ? "text-amber-700 dark:text-amber-300" : ""}`}>{VERIFICATION_LABELS[holiday.verification]}</span> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function OrganizationHolidaysCard() {
  const query = useHolidaysQuery()
  const create = useCreateHolidayMutation()
  const update = useUpdateHolidayMutation()
  const remove = useDeleteHolidayMutation()
  const [date, setDate] = useState("")
  const [name, setName] = useState("")
  const [scope, setScope] = useState<HolidayScope>("ORGANIZATION")

  async function handleCreate() {
    await create.mutateAsync({ date, name: name.trim(), scope, active: true })
    setDate("")
    setName("")
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Nova data da organização</CardTitle>
          <CardDescription>Datas próprias da operação (recesso, evento). Não é preciso recadastrar feriados legais — eles já estão no calendário-base. Ativa por padrão.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-[160px_1fr_180px_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="holiday-date">Data</Label>
              <Input id="holiday-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="holiday-name">Nome</Label>
              <Input id="holiday-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Recesso da operação" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="holiday-scope">Escopo</Label>
              <Select value={scope} onValueChange={(value) => setScope(value as HolidayScope)}>
                <SelectTrigger id="holiday-scope" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOLIDAY_SCOPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {HOLIDAY_SCOPE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleCreate} disabled={!date || name.trim().length < 2 || create.isPending}>
              <Plus /> Cadastrar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Datas da organização</CardTitle>
          <CardDescription>Desativar mantém o registro sem efeito no cálculo. Valem para todos os colaboradores, só no fallback seg–sex e só com a política &quot;excluir feriados&quot;. Escala explícita sempre vence.</CardDescription>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <Skeleton className="h-32 rounded-xl" />
          ) : query.isError || !query.data ? (
            <ListErrorState message="Não foi possível carregar as datas da organização." onRetry={() => query.refetch()} />
          ) : query.data.length === 0 ? (
            <ListEmptyState icon={CalendarDays} title="Nenhuma data própria cadastrada" description="Feriados legais já vêm do calendário-base. Cadastre aqui só o que é específico da operação." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Escopo</TableHead>
                    <TableHead>Ativo</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.map((holiday) => (
                    <TableRow key={holiday.id} data-testid="holiday-row">
                      <TableCell className="tabular-nums">{formatCivilDate(holiday.date)}</TableCell>
                      <TableCell>{holiday.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{HOLIDAY_SCOPE_LABELS[holiday.scope]}</TableCell>
                      <TableCell>
                        <Switch checked={holiday.active} aria-label={`Feriado ${holiday.name} ativo`} onCheckedChange={(active) => update.mutate({ id: holiday.id, input: { active } })} />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" aria-label={`Remover ${holiday.name}`} onClick={() => remove.mutate(holiday.id)} disabled={remove.isPending}>
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
