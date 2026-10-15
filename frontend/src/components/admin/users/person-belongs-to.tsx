import type { ReactNode } from "react"
import { Network } from "lucide-react"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCivilDate } from "@/lib/format/date"
import type { SourceManager, UserDetail } from "@/schemas/admin/user-account.schema"

import { SourceManagedNotice } from "./source-managed-notice"

/**
 * "PERTENCE A": onde a pessoa está na estrutura da empresa — Grupo, Subgrupo, gestor direto, cargo. É dado organizacional
 * (normalmente vem da base do cliente pela Central de Dados) e não dá acesso a nada; o que ela ADMINISTRA fica em
 * "Administra / acessos". O Grupo só é escolhido aqui quando a base não manda nele.
 */
export function PersonBelongsTo({
  detail,
  detailFailed = false,
  teams,
  teamId,
  onTeamChange,
  teamManagedBy,
  identity = null,
}: {
  detail: UserDetail | undefined
  detailFailed?: boolean
  teams: { id: string; name: string }[]
  teamId: string
  onTeamChange: (teamId: string) => void
  teamManagedBy: SourceManager | null
  /** De onde vem o cadastro (base × feito à mão) e, se for o caso, "Vincular à pessoa da base". */
  identity?: ReactNode
}) {
  return (
    <section aria-labelledby="person-belongs-to-title" className="space-y-3 rounded-md border p-3" data-testid="person-belongs-to">
      <div>
        <h3 id="person-belongs-to-title" className="flex items-center gap-2 text-sm font-medium">
          <Network className="size-4 text-muted-foreground" aria-hidden />
          Pertence a
        </h3>
        <p className="text-xs text-muted-foreground">
          Onde a pessoa está na estrutura da empresa. Vem da base do cliente quando há integração e não dá acesso a nada — administrar um ou vários
          Grupos é feito em <strong className="font-medium text-foreground">Administra / acessos</strong>.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="user-team">Grupo</Label>
        <Select value={teamId} onValueChange={onTeamChange} disabled={teamManagedBy !== null}>
          <SelectTrigger id="user-team" className="w-full" aria-describedby={teamManagedBy ? "user-team-source" : undefined}>
            <SelectValue placeholder="Sem grupo" />
          </SelectTrigger>
          <SelectContent>
            {teams.map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {team.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SourceManagedNotice id="user-team-source" manager={teamManagedBy} />
      </div>
      {detail ? (
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <BelongsToItem label="Subgrupo" value={detail.subteam?.name ?? "—"} manager={detail.managedBy.subteamId} />
          <BelongsToItem label="Gestor direto" value={detail.manager?.name ?? "—"} manager={detail.managedBy.managerId} />
          <BelongsToItem label="Cargo" value={detail.jobTitle ?? "—"} manager={detail.managedBy.jobTitle} />
          <BelongsToItem label="Matrícula" value={detail.matricula ?? "—"} manager={null} />
          {detail.hiredAt ? <BelongsToItem label="Admissão" value={formatCivilDate(detail.hiredAt)} manager={detail.managedBy.hiredAt} /> : null}
        </dl>
      ) : detailFailed ? (
        <p className="text-xs text-destructive" role="alert">Não foi possível carregar Subgrupo, gestor e cargo.</p>
      ) : (
        <Skeleton className="h-12 w-full" />
      )}
      {identity}
    </section>
  )
}

function BelongsToItem({ label, value, manager }: { label: string; value: string; manager: SourceManager | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
      <SourceManagedNotice manager={manager} />
    </div>
  )
}
