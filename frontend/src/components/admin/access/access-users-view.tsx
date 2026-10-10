"use client"

import { useState } from "react"
import { KeyRound, RotateCcw, SearchX, ShieldCheck, UserCheck, UserX } from "lucide-react"
import { toast } from "sonner"

import { AnalyticsEmptyState, AnalyticsErrorState, TableSkeleton } from "@/components/analytics/analytics-states"
import { ListSearchInput, ListSelectFilter, ListToolbar, optionsFromLabels } from "@/components/admin/shared/list/list-filters"
import { ListPagination } from "@/components/admin/shared/list/list-pagination"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAdminListState } from "@/hooks/use-admin-list-state"
import { formatDateTime } from "@/lib/format/date"
import { useDisableUserAccessMutation, useEnableUserAccessMutation, useIdentifiedUsersQuery, useIssueTemporaryPasswordMutation } from "@/queries/access/use-access"
import { ACCESS_STATUS_LABELS, type AccessStatus, type IdentifiedUser, type IssuedTemporaryPassword } from "@/schemas/access/access.schema"

import { AccountAccessSheet } from "./account-access-sheet"
import { TemporaryPasswordDialog } from "./temporary-password-dialog"

const DEFAULT_FILTERS: { search: string; status: AccessStatus | undefined } = { search: "", status: undefined }
const STATUS_OPTIONS = optionsFromLabels(ACCESS_STATUS_LABELS)
type PendingAction = { kind: "enable" | "regenerate" | "disable"; user: IdentifiedUser } | null

/**
 * Acessos: as pessoas que a plataforma JÁ identifica (cadastro vindo da base do cliente) com a situação do acesso ao INIA.
 * Habilitar cria só a conta de login da pessoa (nunca um cadastro novo) e gera uma senha temporária, mostrada uma única vez;
 * no primeiro login ela é obrigada a criar a própria senha. A lista vem do backend restrita ao seu escopo; cada ação é
 * validada de novo no servidor (permissão, escopo e se você poderia conceder os papéis da pessoa).
 */
export function AccessUsersView({ canManageUsers, canAssignRoles }: { canManageUsers: boolean; canAssignRoles: boolean }) {
  const list = useAdminListState({ storageKey: "access-users", defaultFilters: DEFAULT_FILTERS, defaultPageSize: 20 })
  const query = useIdentifiedUsersQuery({ search: list.params.search || undefined, status: list.params.status, page: list.params.page, pageSize: list.params.pageSize })
  const [openAccountId, setOpenAccountId] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction>(null)
  const [issued, setIssued] = useState<IssuedTemporaryPassword | null>(null)
  const ttlHours = query.data?.temporaryPasswordTtlHours ?? null
  return (
    <section className="space-y-4">
      <ListToolbar
        search={<ListSearchInput value={list.filters.search} onChange={(value) => list.setFilter("search", value)} placeholder="Buscar por nome, e-mail ou matrícula" ariaLabel="Buscar pessoa" pending={list.isSearchPending} />}
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.resetFilters}
      >
        <ListSelectFilter value={list.filters.status} onChange={(value) => list.setFilter("status", value)} options={STATUS_OPTIONS} allLabel="Qualquer situação" ariaLabel="Filtrar por situação do acesso" />
      </ListToolbar>
      {query.isPending ? <TableSkeleton rows={5} /> : null}
      {query.isError ? <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data && query.data.items.length === 0 ? <AnalyticsEmptyState icon={list.hasActiveFilters ? SearchX : KeyRound} title={list.hasActiveFilters ? "Ninguém com esse filtro" : "Nenhuma pessoa no seu escopo"} /> : null}
      {query.data && query.data.items.length > 0 ? (
        <>
          <ul className="divide-y divide-border rounded-xl border" aria-label="Pessoas e acessos">
            {query.data.items.map((user) => (
              <UserRow key={user.personId} user={user} canManage={canManageUsers} onOpenRoles={user.account ? () => setOpenAccountId(user.account!.accountId) : null} onAction={(kind) => setPending({ kind, user })} />
            ))}
          </ul>
          <ListPagination page={list.page} pageSize={list.pageSize} total={query.data.total} onPageChange={list.setPage} onPageSizeChange={list.setPageSize} itemLabel={["pessoa", "pessoas"]} isFetching={query.isFetching} />
        </>
      ) : null}
      <AccountAccessSheet accountId={openAccountId} canAssign={canAssignRoles} onOpenChange={(open) => (!open ? setOpenAccountId(null) : undefined)} />
      {canManageUsers ? (
        <>
          <EnableAccessDialog user={pending?.kind === "enable" ? pending.user : null} ttlHours={ttlHours} onClose={() => setPending(null)} onIssued={(result) => { setPending(null); setIssued(result) }} />
          <RegeneratePasswordDialog user={pending?.kind === "regenerate" ? pending.user : null} onClose={() => setPending(null)} onIssued={(result) => { setPending(null); setIssued(result) }} />
          <DisableAccessDialog user={pending?.kind === "disable" ? pending.user : null} onClose={() => setPending(null)} />
          <TemporaryPasswordDialog issued={issued} onClose={() => setIssued(null)} />
        </>
      ) : null}
    </section>
  )
}

function AccessStatusBadge({ user }: { user: IdentifiedUser }) {
  if (user.accessStatus === "ACTIVE") return <Badge variant="secondary" className="gap-1"><UserCheck className="size-3" aria-hidden />{ACCESS_STATUS_LABELS.ACTIVE}</Badge>
  if (user.accessStatus === "PENDING_PASSWORD_CHANGE") {
    return <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-300"><KeyRound className="size-3" aria-hidden />{ACCESS_STATUS_LABELS.PENDING_PASSWORD_CHANGE}</Badge>
  }
  return <Badge variant="outline" className="gap-1 text-muted-foreground"><UserX className="size-3" aria-hidden />{ACCESS_STATUS_LABELS.DISABLED}</Badge>
}

/** Linha do tempo do acesso numa frase: o que a pessoa precisa fazer / quando a senha temporária vence. */
function accessHint(user: IdentifiedUser): { text: string; tone: "muted" | "warning" } | null {
  const account = user.account
  if (!account) return { text: "Sem conta de login", tone: "muted" }
  if (user.accessStatus === "PENDING_PASSWORD_CHANGE") {
    if (user.temporaryPasswordExpired) return { text: "Senha temporária expirada — gere uma nova", tone: "warning" }
    return account.temporaryPasswordExpiresAt ? { text: `Senha temporária válida até ${formatDateTime(account.temporaryPasswordExpiresAt)}`, tone: "muted" } : null
  }
  if (user.accessStatus === "DISABLED") return account.accessDisabledAt ? { text: `Desabilitado em ${formatDateTime(account.accessDisabledAt)}`, tone: "muted" } : null
  return account.lastLoginAt ? { text: `Último acesso em ${formatDateTime(account.lastLoginAt)}`, tone: "muted" } : { text: "Ainda não entrou", tone: "muted" }
}

function UserRow({ user, canManage, onOpenRoles, onAction }: { user: IdentifiedUser; canManage: boolean; onOpenRoles: (() => void) | null; onAction: (kind: "enable" | "regenerate" | "disable") => void }) {
  const where = [user.team?.name, user.subteam?.name].filter(Boolean).join(" › ")
  const hint = accessHint(user)
  const enabled = user.account?.active === true
  return (
    <li data-testid="access-user-row" className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{user.name}</span>
          {user.self ? <Badge variant="outline">Você</Badge> : null}
          {!user.personActive ? <Badge variant="outline" className="text-muted-foreground">Inativo no cadastro</Badge> : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {user.account?.email ?? "—"}
          {user.matricula ? ` · Matrícula ${user.matricula}` : ""}
        </p>
        <p className="text-xs text-muted-foreground">Cargo: {user.jobTitle ?? "—"}{where ? ` · ${where}` : ""}</p>
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <AccessStatusBadge user={user} />
          {hint ? <span className={hint.tone === "warning" ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>{hint.text}</span> : null}
        </div>
        {user.account && user.account.roles.length > 0 ? (
          <p className="flex flex-wrap gap-1" aria-label="Papéis de acesso">
            {user.account.roles.map((role) => <Badge key={role.code} variant="outline" className="font-normal">{role.name}</Badge>)}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        {onOpenRoles ? <Button size="sm" variant="ghost" onClick={onOpenRoles} aria-label={`Papéis de ${user.name}`}><ShieldCheck aria-hidden />Papéis</Button> : null}
        {canManage && !user.self && !enabled ? (
          <Button size="sm" variant="outline" onClick={() => onAction("enable")} disabled={!user.personActive} title={user.personActive ? undefined : "Reative a pessoa no cadastro antes de habilitar o acesso."}>
            <UserCheck aria-hidden />Habilitar acesso
          </Button>
        ) : null}
        {canManage && !user.self && enabled ? (
          <>
            <Button size="sm" variant="outline" onClick={() => onAction("regenerate")}><RotateCcw aria-hidden />Nova senha temporária</Button>
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onAction("disable")}><UserX aria-hidden />Desabilitar</Button>
          </>
        ) : null}
      </div>
    </li>
  )
}

function EnableAccessDialog({ user, ttlHours, onClose, onIssued }: { user: IdentifiedUser | null; ttlHours: number | null; onClose: () => void; onIssued: (result: IssuedTemporaryPassword) => void }) {
  return (
    <Dialog open={user !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>{user ? <EnableAccessForm key={user.personId} user={user} ttlHours={ttlHours} onClose={onClose} onIssued={onIssued} /> : null}</DialogContent>
    </Dialog>
  )
}

function EnableAccessForm({ user, ttlHours, onClose, onIssued }: { user: IdentifiedUser; ttlHours: number | null; onClose: () => void; onIssued: (result: IssuedTemporaryPassword) => void }) {
  const enable = useEnableUserAccessMutation()
  const needsEmail = user.account === null
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  function submit() {
    if (needsEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Informe um e-mail válido.")
      return
    }
    setError(null)
    enable.mutate({ personId: user.personId, ...(needsEmail ? { email: email.trim() } : {}) }, { onSuccess: (result) => { enable.reset(); onIssued(result) }, onError: (failure) => setError(failure.message) })
  }
  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); submit() }} aria-label="Habilitar acesso" className="space-y-4">
      <DialogHeader>
        <DialogTitle>Habilitar acesso de {user.name}</DialogTitle>
        <DialogDescription>
          Será gerada uma senha temporária{ttlHours ? `, válida por ${ttlHours} horas` : ""}. No primeiro acesso, a pessoa vai precisar criar a própria senha. Nenhum cadastro novo é criado e nenhum papel é concedido.
        </DialogDescription>
      </DialogHeader>
      {needsEmail ? (
        <div className="space-y-1.5">
          <Label htmlFor="enable-access-email">E-mail de login</Label>
          <Input id="enable-access-email" type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nome@empresa.com" autoFocus />
          <p className="text-xs text-muted-foreground">É o identificador que a pessoa vai usar para entrar na INIA.</p>
        </div>
      ) : (
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">Login: <span className="font-medium">{user.account!.email}</span></p>
      )}
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={enable.isPending}>{enable.isPending ? "Habilitando…" : "Habilitar e gerar senha"}</Button>
      </DialogFooter>
    </form>
  )
}

function RegeneratePasswordDialog({ user, onClose, onIssued }: { user: IdentifiedUser | null; onClose: () => void; onIssued: (result: IssuedTemporaryPassword) => void }) {
  const issue = useIssueTemporaryPasswordMutation()
  return (
    <AlertDialog open={user !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Gerar nova senha temporária para {user?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            A senha atual (inclusive uma temporária ainda não usada) deixa de funcionar agora, as sessões abertas dessa pessoa são encerradas e ela vai precisar criar uma nova senha no próximo login.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={issue.isPending}
            onClick={(event) => {
              event.preventDefault()
              if (!user?.account) return
              issue.mutate(user.account.accountId, { onSuccess: (result) => { issue.reset(); onIssued(result) }, onError: (failure) => { toast.error(failure.message); onClose() } })
            }}
          >
            {issue.isPending ? "Gerando…" : "Gerar nova senha"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DisableAccessDialog({ user, onClose }: { user: IdentifiedUser | null; onClose: () => void }) {
  const disable = useDisableUserAccessMutation()
  return (
    <AlertDialog open={user !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Desabilitar o acesso de {user?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            A pessoa sai de todas as sessões abertas e não consegue mais entrar. Os papéis ficam registrados. Para voltar, use “Habilitar acesso” — uma nova senha temporária será gerada.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={disable.isPending}
            onClick={(event) => {
              event.preventDefault()
              if (!user?.account) return
              disable.mutate(user.account.accountId, { onSuccess: () => { toast.success(`Acesso de ${user.name} desabilitado.`); onClose() }, onError: (failure) => { toast.error(failure.message); onClose() } })
            }}
          >
            {disable.isPending ? "Desabilitando…" : "Desabilitar acesso"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
