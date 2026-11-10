"use client"

import Link from "next/link"
import { useState } from "react"
import { ClipboardList, Plus } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ListBooleanFilter, ListSearchInput, ListToolbar } from "@/components/admin/shared/list/list-filters"
import { ListEmptyState, ListErrorState, ListNoResultsState, ListSkeleton } from "@/components/admin/shared/list/list-states"
import { formatDateTime } from "@/lib/format/date"
import { usePoliciesQuery } from "@/queries/admin/use-intervention-policy-queries"
import type { PolicyView } from "@/schemas/admin/intervention-policy.schema"

import { useInterventionCapabilities } from "../shared/use-intervention-capabilities"
import { PolicyCreateForm } from "./policy-create-form"

/** Lista das políticas que o viewer enxerga (o backend já filtra pelo escopo) + criação. */
export function PoliciesTab() {
  const { canEdit } = useInterventionCapabilities()
  const policiesQuery = usePoliciesQuery()
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState("")
  const [active, setActive] = useState<boolean | undefined>(undefined)
  const all = policiesQuery.data ?? []
  const term = search.trim().toLocaleLowerCase("pt-BR")
  const filtered = all.filter((policy) => (active === undefined || policy.active === active) && (!term || policy.name.toLocaleLowerCase("pt-BR").includes(term) || policy.key.toLocaleLowerCase("pt-BR").includes(term)))
  const newButton = (
    <Button onClick={() => setCreating(true)} disabled={!canEdit} title={canEdit ? undefined : "Criar políticas exige a permissão de edição."}>
      <Plus /> Nova política
    </Button>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">Quando recomendar ou abrir intervenções para um colaborador. Cada política tem regras com prioridade explícita, versões publicadas imutáveis e vigência.</p>
        {creating ? null : newButton}
      </div>
      {creating ? <PolicyCreateForm onCancel={() => setCreating(false)} /> : null}

      <ListToolbar
        search={<ListSearchInput value={search} onChange={setSearch} placeholder="Buscar por nome ou chave" ariaLabel="Buscar política" />}
        hasActiveFilters={search !== "" || active !== undefined}
        onClearFilters={() => {
          setSearch("")
          setActive(undefined)
        }}
      >
        <ListBooleanFilter value={active} onChange={setActive} allLabel="Todas" trueLabel="Ativas" falseLabel="Inativas" ariaLabel="Filtrar por status" />
      </ListToolbar>

      {policiesQuery.isPending ? (
        <ListSkeleton view="list" rows={4} />
      ) : policiesQuery.isError ? (
        <ListErrorState message="Não foi possível carregar as políticas." onRetry={() => void policiesQuery.refetch()} />
      ) : all.length === 0 ? (
        <ListEmptyState icon={ClipboardList} title="Nenhuma política de acompanhamento" description="Crie a primeira política para definir quando a INIA recomenda ou abre intervenções." action={creating ? undefined : newButton} />
      ) : filtered.length === 0 ? (
        <ListNoResultsState
          title="Nenhuma política corresponde à busca ou aos filtros"
          onClear={() => {
            setSearch("")
            setActive(undefined)
          }}
        />
      ) : (
        <PoliciesTable policies={filtered} />
      )}
    </div>
  )
}

function PoliciesTable({ policies }: { policies: PolicyView[] }) {
  return (
    <div className={TABLE_FRAME}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Política</TableHead>
            <TableHead>Escopo</TableHead>
            <TableHead>Em vigor</TableHead>
            <TableHead>Rascunho</TableHead>
            <TableHead>Avaliações (30 dias)</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {policies.map((policy) => (
            <TableRow key={policy.id} className={policy.active ? undefined : "opacity-60"} data-testid={`policy-row-${policy.key}`}>
              <TableCell>
                <Link href={`/admin/intervention-policies/${policy.id}`} className="font-medium underline-offset-2 hover:underline">
                  {policy.name}
                </Link>
                <p className="font-mono text-xs text-muted-foreground">{policy.key}</p>
              </TableCell>
              <TableCell className="text-sm">{policy.scopeLabel}</TableCell>
              <TableCell className="text-sm">
                {policy.inForce ? `v${policy.inForce.version}${policy.inForce.effectiveFrom ? ` desde ${formatDateTime(policy.inForce.effectiveFrom)}` : ""}` : <span className="text-muted-foreground">Nenhuma</span>}
                {policy.scheduled.length > 0 ? <span className="block text-xs text-muted-foreground">{policy.scheduled.length} versão(ões) agendada(s)</span> : null}
              </TableCell>
              <TableCell className="text-sm">{policy.draft ? `v${policy.draft.version}` : "—"}</TableCell>
              <TableCell className="text-sm">{policy.evaluations.last30Days}</TableCell>
              <TableCell>
                <Badge variant={policy.active ? "secondary" : "outline"}>{policy.active ? "Ativa" : "Inativa"}</Badge>
              </TableCell>
              <TableCell className="text-right">
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/admin/intervention-policies/${policy.id}`}>{policy.can.edit ? "Abrir e editar" : "Abrir"}</Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
