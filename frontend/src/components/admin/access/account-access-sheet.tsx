"use client"

import { useState } from "react"
import { Plus, ShieldCheck, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { useAccessAccountQuery, useAccessRolesQuery, useAssignRoleMutation, useRevokeRoleMutation, useScopeOptionsQuery } from "@/queries/access/use-access"
import { SCOPE_TYPE_LABELS, type AccessAccount, type AccountRole, type ScopeType } from "@/schemas/access/access.schema"
import { ROLE_LABELS, type PlatformRole } from "@/schemas/auth/auth.schema"

/**
 * Detalhe de uma CONTA de acesso (V1.5.7): o colaborador vinculado aparece como DADO INFORMATIVO (cargo, nível hierárquico,
 * grupo, subgrupo — nada disso dá acesso) e, separados, os PAPÉIS DE ACESSO com o escopo de cada um. Adicionar/revogar papel
 * só mostra o que o backend diz que você pode delegar; a validação (papel, permissão, escopo, auto-concessão) é do backend.
 */
export function AccountAccessSheet({ accountId, canAssign, onOpenChange }: { accountId: string | null; canAssign: boolean; onOpenChange: (open: boolean) => void }) {
  const query = useAccessAccountQuery(accountId)
  return (
    <Sheet open={accountId !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:sm:max-w-xl">
        {query.isPending && accountId ? <div className="space-y-3 p-6" aria-busy="true"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-32 w-full" /></div> : null}
        {query.isError ? <p className="p-6 text-sm text-destructive" role="alert">{(query.error as Error).message}</p> : null}
        {query.data ? <AccountBody account={query.data} canAssign={canAssign} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function AccountBody({ account, canAssign }: { account: AccessAccount; canAssign: boolean }) {
  const collaborator = account.collaborator
  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{collaborator.name}</SheetTitle>
        <SheetDescription>{account.email} · {account.active ? "Conta ativa" : "Conta inativa"}</SheetDescription>
      </SheetHeader>
      <div className="space-y-6 p-4">
        <section aria-label="Colaborador vinculado" className="space-y-2">
          <h3 className="text-sm font-semibold">Colaborador vinculado</h3>
          <p className="text-xs text-muted-foreground">Dados organizacionais (vêm da base do cliente). Não concedem acesso ao INIA.</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border p-3 text-sm">
            <Info label="Cargo" value={collaborator.jobTitle ?? "—"} />
            <Info label="Nível hierárquico" value={ROLE_LABELS[collaborator.level as PlatformRole] ?? collaborator.level} />
            <Info label="Grupo" value={collaborator.team?.name ?? "—"} />
            <Info label="Subgrupo" value={collaborator.subteam?.name ?? "—"} />
            {!collaborator.active ? <p className="col-span-2 text-xs text-amber-700 dark:text-amber-300">Colaborador inativo: os papéis ficam registrados, mas não se aplicam enquanto ele estiver inativo.</p> : null}
          </dl>
        </section>
        <section aria-label="Papéis de acesso" className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-muted-foreground" aria-hidden />Papéis de acesso</h3>
          {account.roles.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum papel — esta conta não tem acesso administrativo nem de QA.</p> : null}
          <ul className="space-y-2">
            {account.roles.map((role) => <RoleRow key={role.id} accountId={account.accountId} role={role} canAssign={canAssign} />)}
          </ul>
        </section>
        {canAssign ? <AddRoleForm accountId={account.accountId} /> : null}
      </div>
    </>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function RoleRow({ accountId, role, canAssign }: { accountId: string; role: AccountRole; canAssign: boolean }) {
  const revoke = useRevokeRoleMutation(accountId)
  const [confirming, setConfirming] = useState(false)
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
      <span>
        <span className="font-medium">{role.roleName}</span>
        <span className="block text-xs text-muted-foreground">Escopo: {role.scopeLabel}</span>
      </span>
      {canAssign ? (
        <Button size="icon" variant="ghost" aria-label={`Revogar ${role.roleName}`} disabled={revoke.isPending} onClick={() => setConfirming(true)}>
          <Trash2 className="size-4" />
        </Button>
      ) : null}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar {role.roleName}?</AlertDialogTitle>
            <AlertDialogDescription>A atribuição deixa de valer agora e fica no histórico (não é apagada).</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => revoke.mutate({ assignmentId: role.id }, { onSuccess: () => toast.success("Papel revogado."), onError: (error) => toast.error(error.message) })}>Revogar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}

function AddRoleForm({ accountId }: { accountId: string }) {
  const roles = useAccessRolesQuery()
  const options = useScopeOptionsQuery(true)
  const assign = useAssignRoleMutation(accountId)
  const [roleCode, setRoleCode] = useState<string>("")
  const [scopeType, setScopeType] = useState<ScopeType | "">("")
  const [targetId, setTargetId] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const assignable = (roles.data ?? []).filter((role) => role.assignableByYou)
  const role = assignable.find((entry) => entry.code === roleCode)
  // Só os escopos que o papel admite E que você alcança (organização/estrutura só para quem administra a organização inteira).
  const scopeTypes = (role?.allowedScopes ?? []).filter((type) => ((type === "ORGANIZATION" || type === "MY_STRUCTURE") ? options.data?.organizationWide === true : type === "GROUP" ? (options.data?.teams.length ?? 0) > 0 : (options.data?.subteams.length ?? 0) > 0))

  if (roles.isPending || options.isPending) return <Skeleton className="h-24 w-full" />
  if (assignable.length === 0) return <p className="text-xs text-muted-foreground">Você não pode conceder papéis a partir do seu acesso atual.</p>

  function submit() {
    if (!role || !scopeType) { setError("Escolha o papel e o escopo."); return }
    if ((scopeType === "GROUP" || scopeType === "SUBGROUP") && !targetId) { setError(`Escolha o ${scopeType === "GROUP" ? "Grupo" : "Subgrupo"}.`); return }
    setError(null)
    const scope = scopeType === "GROUP" ? { type: scopeType, teamId: targetId } : scopeType === "SUBGROUP" ? { type: scopeType, subteamId: targetId } : { type: scopeType }
    assign.mutate({ roleCode: role.code, scope }, { onSuccess: () => { toast.success(`${role.name} atribuído.`); setRoleCode(""); setScopeType(""); setTargetId("") }, onError: (failure) => setError(failure.message) })
  }

  return (
    <form className="space-y-3 rounded-xl border p-3" aria-label="Adicionar papel" onSubmit={(event) => { event.preventDefault(); submit() }}>
      <h3 className="text-sm font-semibold">Adicionar papel</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="access-role">Papel</Label>
          <Select value={roleCode} onValueChange={(value) => { setRoleCode(value); setScopeType(""); setTargetId("") }}>
            <SelectTrigger id="access-role" className="w-full" aria-label="Papel"><SelectValue placeholder="Escolha o papel" /></SelectTrigger>
            <SelectContent>{assignable.map((entry) => <SelectItem key={entry.code} value={entry.code}>{entry.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="access-scope">Escopo</Label>
          <Select value={scopeType} onValueChange={(value) => { setScopeType(value as ScopeType); setTargetId("") }} disabled={!role}>
            <SelectTrigger id="access-scope" className="w-full" aria-label="Escopo"><SelectValue placeholder="Escolha o escopo" /></SelectTrigger>
            <SelectContent>{scopeTypes.map((type) => <SelectItem key={type} value={type}>{SCOPE_TYPE_LABELS[type]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      {scopeType === "GROUP" || scopeType === "SUBGROUP" ? (
        <div className="space-y-1.5">
          <Label htmlFor="access-target">{scopeType === "GROUP" ? "Grupo" : "Subgrupo"}</Label>
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger id="access-target" className="w-full" aria-label={scopeType === "GROUP" ? "Grupo" : "Subgrupo"}><SelectValue placeholder="Escolha" /></SelectTrigger>
            <SelectContent>
              {scopeType === "GROUP" ? options.data?.teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>) : options.data?.subteams.map((subteam) => <SelectItem key={subteam.id} value={subteam.id}>{subteam.teamName} › {subteam.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {role ? <p className="text-xs text-muted-foreground">Permissões: {role.permissions.map((permission) => permission.label).join(" · ")}</p> : null}
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      <Button type="submit" size="sm" disabled={assign.isPending}><Plus aria-hidden />{assign.isPending ? "Atribuindo…" : "Atribuir papel"}</Button>
    </form>
  )
}
