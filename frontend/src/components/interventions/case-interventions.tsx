"use client"

import { ListChecks, Lock } from "lucide-react"
import { usePathname, useSearchParams } from "next/navigation"

import { AnalyticsEmptyState, AnalyticsErrorState, TableSkeleton } from "@/components/analytics/analytics-states"
import { Badge } from "@/components/ui/badge"
import { ApiError } from "@/lib/api/api-client"
import { formatCivilDate, formatDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useCaseInterventionsQuery } from "@/queries/interventions/use-intervention-queries"

import { InterventionPanel } from "./intervention-panel"

/**
 * Intervenções de UM caso de supervisão: a lista (em andamento primeiro) e a selecionada aberta ao lado. A seleção vive na URL
 * (`?intervention=`), que é o destino do sino, da Pendências, do Acompanhamento e da ficha. Resolver uma pendência não fecha a
 * intervenção: ela continua aqui até a conclusão registrada.
 */
export function CaseInterventions({ caseId }: { caseId: string }) {
  const query = useCaseInterventionsQuery(caseId)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  if (query.isPending) return <TableSkeleton rows={3} />
  // Ver o caso (por Indicadores ou pela estrutura) não dá acesso às intervenções: elas pedem liderar o colaborador ou a
  // permissão de intervenções no escopo. Sem esse acesso o backend responde 404 — aqui isso é um estado, não um erro.
  if (query.isError && query.error instanceof ApiError && query.error.status === 404) {
    return <AnalyticsEmptyState icon={Lock} title="Intervenções não disponíveis para o seu acesso" description="As intervenções deste caso ficam com a liderança do colaborador e com quem tem a permissão de intervenções no escopo dele." />
  }
  if (query.isError) return <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} />
  const { interventions, reports } = query.data
  if (interventions.length === 0) return <AnalyticsEmptyState icon={ListChecks} title="Nenhuma intervenção neste caso" description="Quando uma política de acompanhamento (ou o líder) abrir uma intervenção para este caso, ela aparece aqui." />
  const ordered = [...interventions].sort((a, b) => Number(["PROPOSED", "AWAITING_APPROVAL", "IN_PROGRESS"].includes(b.status)) - Number(["PROPOSED", "AWAITING_APPROVAL", "IN_PROGRESS"].includes(a.status)))
  const selectedId = searchParams.get("intervention") ?? ordered[0]!.id
  const select = (id: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("intervention", id)
    // Só a seleção muda: `history.replaceState` é integrado ao App Router (useSearchParams acompanha) e NÃO refaz a
    // renderização do servidor — `router.replace` buscava o caso de novo no backend e a lista esperava por isso. A página do
    // caso não lê `?intervention=` no servidor.
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`)
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="space-y-3">
        <ul className="space-y-1">
          {ordered.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => select(item.id)} className={cn("w-full rounded-lg border px-3 py-2 text-left text-sm transition hover:bg-muted/60", item.id === selectedId && "border-primary/50 bg-primary/5")}>
                <span className="block font-medium">{item.sensitive ? "Avaliação de continuidade" : item.type.name}</span>
                <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  {item.statusLabel} · prazo {formatCivilDate(item.dueAt)}
                  {item.overdue ? <Badge variant="outline" className="border-amber-500/40 text-amber-700">atrasada</Badge> : null}
                </span>
                <span className="block text-xs text-muted-foreground">Responsável: {item.responsible.name}</span>
              </button>
            </li>
          ))}
        </ul>
        {reports.length > 0 ? (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Avaliações da política neste caso</p>
            {reports.map((report) => (
              <p key={report.id}>
                {formatDateTime(report.createdAt)} · {report.policyName}
                {report.policyVersion ? ` v${report.policyVersion}` : ""}
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <InterventionPanel key={selectedId} interventionId={selectedId} />
    </div>
  )
}
