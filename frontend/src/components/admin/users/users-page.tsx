"use client"

import { useEffect, useState } from "react"
import { KeyRound, LogIn, Pencil, Plus, UserRound, Users, UsersRound } from "lucide-react"

import { useAutoOpenFromQuery } from "@/hooks/use-auto-open-from-query"
import { useAdminListState } from "@/hooks/use-admin-list-state"
import { formatCivilDate, formatShortDateTime } from "@/lib/format/date"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { AdminListView } from "@/components/admin/shared/list/admin-list-view"
import { EntityCard, EntityCardIcon, EntityCardTag } from "@/components/admin/shared/list/entity-card"
import {
  ListBooleanFilter,
  ListDateRangeFilter,
  ListMultiSelectFilter,
  ListSearchInput,
  ListSelectFilter,
  ListToolbar,
  optionsFromLabels,
} from "@/components/admin/shared/list/list-filters"
import { ListCardGrid } from "@/components/admin/shared/list/list-states"
import { ListViewToggle } from "@/components/admin/shared/list/list-view-toggle"
import { useTeamsQuery } from "@/queries/admin/use-org-structure-queries"
import { useUpdateUserShiftMutation, useUserShiftQuery } from "@/queries/admin/use-user-shift-queries"
import { useApplyEmploymentStatusMutation, useEmploymentStatusQuery, useUpdateOperationalCapitalMutation } from "@/queries/admin/use-employment-status-queries"
import {
  useCreateUserAccountMutation,
  useUpdateUserActiveMutation,
  useUpdateUserDetailsMutation,
  useUpdateUserRoleMutation,
  useUserAccountsPageQuery,
} from "@/queries/admin/use-user-account-queries"
import type { UserListParams } from "@/services/admin/user-account-service"
import type { PlatformRole } from "@/schemas/auth/auth.schema"
import { EMPLOYMENT_STATUS_LABELS, ROLE_LABELS, employmentStatusLabel, type EmploymentStatus, type UserAccount } from "@/schemas/admin/user-account.schema"
import { LineageButton } from "@/components/admin/data-hub/lineage-sheet"
import { useCapitalsQuery } from "@/queries/admin/use-operational-calendar-queries"


/**
 * Jornada PREVISTA (horário de entrada + carga horária) — usada pelo Trigger "Por agenda"
 * relativo ao expediente. Deixa explícito que é uma previsão, não telemetria de login real (não
 * temos esse dado hoje — ver docs/workflow-engine-wiki.md).
 */
function ShiftSection({ userId }: { userId: string }) {
  const shiftQuery = useUserShiftQuery(userId)
  const updateMutation = useUpdateUserShiftMutation(userId)

  const [startTime, setStartTime] = useState("08:00")
  const [hours, setHours] = useState(8)

  // Turno carregado (ou recarregado): o formulário recomeça dele — ajuste na renderização, sem render extra.
  const [loadedShift, setLoadedShift] = useState<typeof shiftQuery.data>(undefined)
  if (loadedShift !== shiftQuery.data) {
    setLoadedShift(shiftQuery.data)
    if (shiftQuery.data) {
      setStartTime(shiftQuery.data.startTime.slice(0, 5))
      setHours(Math.round((shiftQuery.data.workMinutes / 60) * 100) / 100)
    }
  }

  async function handleSave() {
    await updateMutation.mutateAsync({ personId: userId, startTime, workMinutes: Math.round(hours * 60) })
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div>
        <p className="text-sm font-medium">Jornada prevista</p>
        <p className="text-xs text-muted-foreground">
          Horário de entrada e carga horária PREVISTOS — usados pelo Trigger &quot;Por agenda&quot; relativo ao expediente (ex.: &quot;15 min após o
          início&quot;, &quot;metade da jornada&quot;). Não é telemetria de login real.
        </p>
      </div>
      {shiftQuery.isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <>
          {!shiftQuery.data ? <p className="text-xs text-muted-foreground">Jornada não configurada.</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Horário de entrada</Label>
              <Input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Carga horária (horas)</Label>
              <Input type="number" min={0.5} max={24} step={0.5} value={hours} onChange={(event) => setHours(Math.max(0.5, Number(event.target.value) || 0.5))} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="button" size="sm" disabled={updateMutation.isPending} onClick={handleSave}>
              {updateMutation.isPending ? "Salvando..." : "Salvar jornada"}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Situação FUNCIONAL (as nove situações reais: EM PRODUÇÃO, TRANSFERIDO, FÉRIAS, INSS, PILOTO,
 * MATERNIDADE, PATERNIDADE, APOSENTADO, ATIVIDADE OFF) com HISTÓRICO por período — separada
 * de "conta ativa". A INIA é consumidora desse dado (vem da fonte de colaboradores; a Central de
 * Dados vai alimentar o mesmo serviço); o registro manual aqui existe pra corrigir/antecipar.
 * Sem data efetiva, vale a partir de hoje e fica marcada como "conhecida a partir desta carga" —
 * nunca retroage por suposição. Não é um sistema de férias: nada de solicitar, aprovar ou saldo.
 */
/**
 * CAPITAL OPERACIONAL — a capital brasileira cuja jurisdição de feriados vale para a pessoa (nunca
 * endereço, residência ou lotação). Catálogo fixo das 27 (reference data); a empresa normalmente
 * informa pela Central (EMPLOYEES.operationalCapitalCode) — aqui é registro/correção manual.
 */
function OperationalCapitalField({ userId, current }: { userId: string; current: { code: string; label: string } | null }) {
  const capitals = useCapitalsQuery()
  const mutation = useUpdateOperationalCapitalMutation(userId)
  const NONE = "__none__"
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-xs" data-testid="operational-capital-field">
      <span>
        Capital operacional: <span className="font-medium text-foreground" data-testid="operational-capital-current">{current?.label ?? "não informada"}</span>
      </span>
      <span className="text-muted-foreground">jurisdição de feriados (nacional + UF derivada + municipal) — não é endereço nem lotação</span>
      <Select value={current?.code ?? NONE} onValueChange={(value) => mutation.mutate(value === NONE ? null : value)} disabled={mutation.isPending || capitals.isLoading}>
        <SelectTrigger className="h-8 w-56" aria-label="Capital operacional">
          <SelectValue placeholder="Selecionar capital" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Não informada</SelectItem>
          {(capitals.data?.capitals ?? []).map((capital) => (
            <SelectItem key={capital.code} value={capital.code}>
              {capital.name} / {capital.stateCode}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function EmploymentStatusSection({ userId }: { userId: string }) {
  const statusQuery = useEmploymentStatusQuery(userId)
  const applyMutation = useApplyEmploymentStatusMutation(userId)
  const [status, setStatus] = useState<EmploymentStatus>("FERIAS")
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [effectiveTo, setEffectiveTo] = useState("")

  async function handleApply() {
    await applyMutation.mutateAsync({ personId: userId, status, effectiveFrom: effectiveFrom || undefined, effectiveTo: effectiveTo || null })
    setEffectiveFrom("")
    setEffectiveTo("")
  }

  return (
    <div className="space-y-3 rounded-md border p-3" data-testid="employment-status-section">
      <div>
        <p className="text-sm font-medium">Situação funcional</p>
        <p className="text-xs text-muted-foreground">
          Só EM PRODUÇÃO entra no cálculo operacional (cobertura, ranking, quartil, tendência); as demais situações retiram os dias do cálculo — nunca viram zero e nunca alteram o fechamento oficial.
          Diferente de &quot;conta ativa&quot; (transferido continua com conta por histórico). Atualizado pela fonte de colaboradores quando disponível.
        </p>
      </div>
      {statusQuery.isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : statusQuery.data ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm">
              Situação atual: <span className="font-medium" data-testid="employment-status-current">{statusQuery.data.current.label}</span>
            </p>
            {statusQuery.data.history[0] ? <LineageButton entityType="employee_status_periods" entityId={statusQuery.data.history[0].id} title="Origem da situação funcional" size="xs" /> : null}
          </div>
          {statusQuery.data.history.length > 0 ? (
            <ul className="space-y-1 text-xs text-muted-foreground" aria-label="Histórico de situação">
              {statusQuery.data.history.map((period) => (
                <li key={period.id}>
                  <span className="font-medium text-foreground">{period.label}</span> · {period.effectiveTo ? `${formatCivilDate(period.effectiveFrom)}–${formatCivilDate(period.effectiveTo)}` : `desde ${formatCivilDate(period.effectiveFrom)}`}
                  {period.effectiveFromInferred ? " · início conhecido a partir da carga" : ""} · origem: {period.source === "MANUAL" ? "registro manual" : period.source === "DEMO_SEED" ? "massa demo" : `fonte ${period.source}`}
                  {period.rawStatus && period.rawStatus !== period.status ? ` · texto da fonte: "${period.rawStatus}"` : ""}
                  {period.legacyStatus ? ` · código legado: ${period.legacyStatus}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Sem histórico registrado — em produção presumido.</p>
          )}
          {statusQuery.data.schedule ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-xs" data-testid="work-schedule-summary">
              <span>
                Escala: <span className="font-medium text-foreground">{statusQuery.data.schedule.scheduleTypeLabel ?? "não informada"}</span>
              </span>
              <span className="text-muted-foreground">{statusQuery.data.schedule.basisLabel}</span>
              {statusQuery.data.schedule.nextDayOff ? <span>Próxima folga: <span className="font-medium text-foreground">{formatCivilDate(statusQuery.data.schedule.nextDayOff)}</span></span> : null}
              {statusQuery.data.schedule.freshness.state === "STALE" ? <span className="text-amber-700 dark:text-amber-300">⚠ Fonte de escala atrasada</span> : null}
              {statusQuery.data.schedule.origin ? <span className="text-muted-foreground">Origem: {statusQuery.data.schedule.origin.sourceName} › {statusQuery.data.schedule.origin.feedName}</span> : null}
              {statusQuery.data.schedule.knownUntil ? <span>Calendário conhecido até: <span className="font-medium text-foreground">{formatCivilDate(statusQuery.data.schedule.knownUntil)}</span></span> : null}
              {statusQuery.data.schedule.todayException ? <span>Hoje: <span className="font-medium text-foreground">{statusQuery.data.schedule.todayException.label}</span></span> : null}
              {statusQuery.data.schedule.upcomingExceptions.length > 0 ? <span>Exceções: {statusQuery.data.schedule.upcomingExceptions.slice(0, 3).map((entry) => `${entry.label} em ${formatCivilDate(entry.date)}`).join(", ")}</span> : null}
              {statusQuery.data.schedule.todayScheduleId ? <LineageButton entityType="employee_schedule_days" entityId={statusQuery.data.schedule.todayScheduleId} title="Origem da escala de hoje" size="xs" label="Origem" /> : null}
              {statusQuery.data.schedule.todayException ? <LineageButton entityType="employee_schedule_exceptions" entityId={statusQuery.data.schedule.todayException.id} title="Origem da exceção de hoje" size="xs" label="Origem da exceção" /> : null}
            </div>
          ) : null}
          <OperationalCapitalField userId={userId} current={statusQuery.data.operationalCapital} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Nova situação</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as EmploymentStatus)}>
                <SelectTrigger className="w-full" aria-label="Nova situação">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(EMPLOYMENT_STATUS_LABELS) as EmploymentStatus[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {EMPLOYMENT_STATUS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Início (opcional)</Label>
              <Input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Fim (opcional)</Label>
              <Input type="date" value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="button" size="sm" disabled={applyMutation.isPending} onClick={handleApply}>
              {applyMutation.isPending ? "Registrando..." : "Registrar situação"}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}

function ActiveToggleButton({ user }: { user: UserAccount }) {
  const updateActiveMutation = useUpdateUserActiveMutation()
  return (
    <Button
      size="sm"
      variant={user.active ? "secondary" : "outline"}
      disabled={updateActiveMutation.isPending}
      aria-label={user.active ? "Desativar usuário" : "Ativar usuário"}
      onClick={() => updateActiveMutation.mutate({ personId: user.id, active: !user.active })}
    >
      {user.active ? "Ativo" : "Inativo"}
    </Button>
  )
}

function RoleSelect({ user }: { user: UserAccount }) {
  const updateRoleMutation = useUpdateUserRoleMutation()
  return (
    <Select value={user.role} onValueChange={(value) => updateRoleMutation.mutate({ personId: user.id, role: value as PlatformRole })}>
      <SelectTrigger className="w-44" aria-label={`Nível hierárquico de ${user.name}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(ROLE_LABELS).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function lastLoginLabel(user: UserAccount) {
  if (!user.accountId) return "Sem conta de acesso"
  return user.lastLoginAt ? `Último acesso ${formatShortDateTime(user.lastLoginAt, { withYear: true })}` : "Nunca acessou"
}

function UserCard({ user, onEdit }: { user: UserAccount; onEdit: (user: UserAccount) => void }) {
  return (
    <EntityCard
      muted={!user.active}
      icon={<EntityCardIcon icon={UserRound} className="bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-300" />}
      kicker={
        <>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{ROLE_LABELS[user.role]}</span>
          <span aria-hidden>·</span>
          <span>{user.teamName ?? "Sem grupo"}</span>
        </>
      }
      title={user.name}
      onOpen={() => onEdit(user)}
      actions={
        <Button size="icon" variant="ghost" aria-label="Editar usuário" onClick={() => onEdit(user)}>
          <Pencil className="h-4 w-4" />
        </Button>
      }
      description={user.email}
      descriptionFallback="Sem conta de acesso."
      tags={
        <>
          <EntityCardTag icon={UsersRound}>{user.teamName ?? "Sem grupo"}</EntityCardTag>
          <EntityCardTag icon={user.accountId ? LogIn : KeyRound}>{lastLoginLabel(user)}</EntityCardTag>
        </>
      }
      footerStart={
        // Acima do link esticado do card, senão o seletor de nível hierárquico não recebe o clique.
        <span className="relative z-10">
          <RoleSelect user={user} />
        </span>
      }
      footerEnd={<ActiveToggleButton user={user} />}
    />
  )
}

function UsersTable({ users, onEdit }: { users: UserAccount[]; onEdit: (user: UserAccount) => void }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Usuário</TableHead>
            <TableHead>Nível hierárquico</TableHead>
            <TableHead>Grupo</TableHead>
            <TableHead>Último acesso</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id} className={user.active ? undefined : "opacity-60"}>
              <TableCell>
                <p className="font-medium">{user.name}</p>
                <p className="text-xs text-muted-foreground">{user.email ?? "sem conta de acesso"}</p>
              </TableCell>
              <TableCell>
                <RoleSelect user={user} />
              </TableCell>
              <TableCell>{user.teamName ?? "—"}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {user.lastLoginAt ? formatShortDateTime(user.lastLoginAt, { withYear: true }) : user.accountId ? "Nunca acessou" : "—"}
              </TableCell>
              <TableCell className="text-sm">{user.employmentStatus ? employmentStatusLabel(user.employmentStatus) : "—"}</TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-2">
                  <ActiveToggleButton user={user} />
                  <Button size="icon" variant="ghost" aria-label="Editar usuário" onClick={() => onEdit(user)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

type UserFilters = Omit<UserListParams, "page" | "pageSize" | "search"> & { search: string }

const DEFAULT_FILTERS: UserFilters = { search: "", role: [], lastLoginAt: {} }
const ROLE_OPTIONS = optionsFromLabels(ROLE_LABELS)

export function UsersPage() {
  const teamsQuery = useTeamsQuery()
  const createMutation = useCreateUserAccountMutation()
  const updateDetailsMutation = useUpdateUserDetailsMutation()

  const list = useAdminListState({ storageKey: "users", defaultFilters: DEFAULT_FILTERS })
  const usersQuery = useUserAccountsPageQuery(list.params)
  const teamOptions = (teamsQuery.data ?? []).map((team) => ({ value: team.id, label: team.name }))

  const [autoOpen, setAutoOpen] = useAutoOpenFromQuery("new")
  const [tab, setTab] = useState<"list" | "form">("list")
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<PlatformRole>("OPERATOR")
  const [teamId, setTeamId] = useState<string>("")

  function openCreateForm() {
    setEditingUser(null)
    setName("")
    setEmail("")
    setPassword("")
    setRole("OPERATOR")
    setTeamId("")
    createMutation.reset()
    setTab("form")
  }

  // `?new` na URL abre o formulário de criação e consome o pedido: cada nova navegação com `?new` abre de novo. Fica no
  // efeito porque abrir o formulário também limpa a mutação de criação (efeito colateral, não cabe na renderização). Vem
  // depois de `openCreateForm`: o React Compiler deixa de analisar o componente quando um efeito chama uma função
  // declarada mais abaixo.
  useEffect(() => {
    if (!autoOpen) return
    setAutoOpen(false)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mesma abertura do botão "Novo usuário", pedida pela URL
    openCreateForm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen])

  function openEditForm(user: UserAccount) {
    setEditingUser(user)
    setName(user.name)
    setEmail(user.email ?? "")
    setPassword("")
    setRole(user.role)
    setTeamId(user.teamId ?? "")
    updateDetailsMutation.reset()
    setTab("form")
  }

  async function handleSubmit() {
    if (editingUser) {
      await updateDetailsMutation.mutateAsync({ personId: editingUser.id, name, email, role, teamId: teamId || undefined })
    } else {
      await createMutation.mutateAsync({ name, email, password, role, teamId: teamId || undefined })
    }
    setTab("list")
  }

  const mutation = editingUser ? updateDetailsMutation : createMutation
  const canSubmit = name.trim().length > 1 && email.includes("@") && (Boolean(editingUser) || password.length >= 6)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Usuários e perfis</CardTitle>
            <CardDescription>Perfis disponíveis: operador, supervisor, gerente, gerente sênior, diretor e administrador.</CardDescription>
          </div>
          {tab === "list" ? (
            <Button onClick={openCreateForm}>
              <Plus /> Novo usuário
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(value) => setTab(value as "list" | "form")}>
          <TabsList>
            <TabsTrigger value="list">Lista</TabsTrigger>
            <TabsTrigger value="form">{editingUser ? "Editar usuário" : "Novo usuário"}</TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="mt-4 space-y-4">
            <ListToolbar
              search={
                <ListSearchInput
                  value={list.filters.search}
                  onChange={(value) => list.setFilter("search", value)}
                  placeholder="Buscar por nome ou e-mail"
                  ariaLabel="Buscar usuário"
                  pending={list.isSearchPending}
                />
              }
              viewToggle={<ListViewToggle value={list.view} onChange={list.setView} />}
              hasActiveFilters={list.hasActiveFilters}
              onClearFilters={list.resetFilters}
            >
              <ListMultiSelectFilter label="Nível hierárquico" values={list.filters.role} onChange={(values) => list.setFilter("role", values)} options={ROLE_OPTIONS} />
              <ListSelectFilter value={list.filters.teamId} onChange={(value) => list.setFilter("teamId", value)} options={teamOptions} allLabel="Qualquer grupo" ariaLabel="Filtrar por grupo" />
              <ListBooleanFilter value={list.filters.active} onChange={(value) => list.setFilter("active", value)} allLabel="Qualquer status" trueLabel="Ativos" falseLabel="Inativos" ariaLabel="Filtrar por status" />
              <ListBooleanFilter value={list.filters.hasAccount} onChange={(value) => list.setFilter("hasAccount", value)} allLabel="Com ou sem conta" trueLabel="Com conta de acesso" falseLabel="Sem conta de acesso" ariaLabel="Filtrar por conta de acesso" />
              <ListDateRangeFilter label="Último acesso" value={list.filters.lastLoginAt} onChange={(value) => list.setFilter("lastLoginAt", value)} />
            </ListToolbar>

            <AdminListView
              state={list}
              query={usersQuery}
              errorMessage="Não foi possível carregar os usuários."
              empty={{
                icon: Users,
                title: "Nenhum usuário cadastrado ainda",
                description: "Cadastre operadores, supervisores e administradores para começar.",
                action: (
                  <Button onClick={openCreateForm}>
                    <Plus /> Novo usuário
                  </Button>
                ),
              }}
              noResultsTitle="Nenhum usuário corresponde à busca ou aos filtros"
              itemLabel={["usuário", "usuários"]}
              renderList={(users) => <UsersTable users={users} onEdit={openEditForm} />}
              renderCards={(users) => (
                <ListCardGrid>
                  {users.map((user) => (
                    <UserCard key={user.id} user={user} onEdit={openEditForm} />
                  ))}
                </ListCardGrid>
              )}
            />
          </TabsContent>

          <TabsContent value="form" className="mt-4 max-w-xl space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="user-name">Nome</Label>
              <Input id="user-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-email">E-mail</Label>
              <Input id="user-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            {editingUser ? null : (
              <div className="space-y-1.5">
                <Label htmlFor="user-password">Senha provisória</Label>
                <Input id="user-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Nível hierárquico</Label>
                <Select value={role} onValueChange={(value) => setRole(value as PlatformRole)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROLE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Grupo (opcional)</Label>
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Sem grupo" />
                  </SelectTrigger>
                  <SelectContent>
                    {teamsQuery.data?.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {mutation.isError ? <p className="text-sm text-destructive">{(mutation.error as Error).message}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setTab("list")}>
                Cancelar
              </Button>
              <Button disabled={!canSubmit || mutation.isPending} onClick={handleSubmit}>
                {mutation.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </div>

            {editingUser ? (
              <>
                <p className="rounded-md border p-3 text-xs text-muted-foreground">Nível hierárquico e cargo são dados organizacionais e não dão acesso ao INIA. Papéis de acesso (Administrador, QA de feedback…) ficam na aba <strong>Acessos</strong>.</p>
                <ShiftSection userId={editingUser.id} />
                <EmploymentStatusSection userId={editingUser.id} />
              </>
            ) : null}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
