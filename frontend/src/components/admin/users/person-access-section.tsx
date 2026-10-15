import { ShieldCheck } from "lucide-react"

import { AccountRolesEditor } from "@/components/admin/access/account-access-sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { useAccessAccountQuery } from "@/queries/access/use-access"

/**
 * "ADMINISTRA / ACESSOS": o que a pessoa administra na INIA — papéis com escopo (organização, Grupo, Subgrupo ou a estrutura
 * dela), sempre definidos aqui na INIA e nunca pela base do cliente. Independe do Grupo a que ela pertence: administrar
 * vários Grupos = uma atribuição do papel para cada Grupo. A edição é a mesma da aba Acessos (o backend valida delegação,
 * escopo e auto-concessão).
 */
export function PersonAccessSection({ accountId, canViewAccess, canAssignRoles }: { accountId: string | null; canViewAccess: boolean; canAssignRoles: boolean }) {
  return (
    <section aria-labelledby="person-access-title" className="space-y-3 rounded-md border p-3" data-testid="person-access">
      <div>
        <h3 id="person-access-title" className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
          Administra / acessos
        </h3>
        <p className="text-xs text-muted-foreground">
          O que esta pessoa administra na INIA: papéis com escopo, definidos só aqui (a base do cliente nunca concede acesso). Não depende do Grupo a que
          ela pertence — para administrar vários Grupos, atribua o papel uma vez para cada Grupo.
        </p>
      </div>
      {!accountId ? (
        <p className="text-sm text-muted-foreground">Sem conta de login. Habilite o acesso na aba Acessos para atribuir papéis.</p>
      ) : !canViewAccess ? (
        <p className="text-sm text-muted-foreground">Os papéis desta pessoa ficam na aba Acessos, que exige permissão para ver acessos.</p>
      ) : (
        <AccountRoles accountId={accountId} canAssignRoles={canAssignRoles} />
      )}
    </section>
  )
}

function AccountRoles({ accountId, canAssignRoles }: { accountId: string; canAssignRoles: boolean }) {
  const query = useAccessAccountQuery(accountId)
  if (query.isPending) return <Skeleton className="h-16 w-full" />
  if (query.isError) return <p className="text-sm text-destructive" role="alert">{(query.error as Error).message}</p>
  return <AccountRolesEditor account={query.data} canAssign={canAssignRoles} />
}
