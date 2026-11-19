"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle } from "lucide-react"

import { ListPagination } from "@/components/admin/shared/list/list-pagination"
import { Badge } from "@/components/ui/badge"
import { InlineError } from "@/components/ui/states"
import { SectionLabel, SURFACE_CARD } from "@/components/ui/surface"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TABLE_FRAME } from "@/components/ui/table"
import { formatCivilDate } from "@/lib/format/date"
import { interventionHref } from "@/lib/interventions/intervention-href"
import { cn } from "@/lib/utils"
import { useTeamInterventionsQuery } from "@/queries/interventions/use-intervention-queries"
import type { FormatResult } from "@/schemas/interventions/intervention.schema"

/**
 * ACOMPANHAMENTOS DA ESTRUTURA — para quem lidera e para a gestão acima: o que está em andamento (com o próximo passo e o
 * atraso) e o RESUMÃO do que foi concluído, por formato e indicador: quantos, "deu resultado?" segundo quem conduziu, a medição
 * da INIA e os motivos mais citados. O alcance é decidido pelo servidor (o mesmo de abrir cada intervenção).
 *
 * Sem nada em andamento e sem nada concluído no período, o bloco não aparece (a aba Equipe continua como era). Consulta que FALHA
 * não é "não há nada": mostra o erro com nova tentativa.
 */
/** A lista em andamento vem limitada pelo servidor, que informa o total real (`activeTotal`) e se houve corte (`activeTruncated`). */
const PAGE_SIZE_DEFAULT = 20

const WORKED_LABEL = { YES: "deu resultado", PARTIAL: "em parte", NO: "não deu resultado" } as const

function ResultRow({ row }: { row: FormatResult }) {
  const notWorked = row.reasons.filter((reason) => reason.worked !== "YES").slice(0, 3)
  const worked = row.reasons.filter((reason) => reason.worked === "YES").slice(0, 2)
  return (
    <TableRow>
      <TableCell className="align-top">
        <p className="font-medium">{row.typeName}</p>
        <p className="text-xs text-muted-foreground">{row.indicatorName ?? "Assunto geral"}</p>
      </TableCell>
      <TableCell className="align-top tabular-nums">{row.completed}</TableCell>
      <TableCell className="align-top">
        <p className="tabular-nums">
          {row.worked.yes} sim · {row.worked.partial} em parte · {row.worked.no} não
        </p>
        {row.worked.unanswered > 0 ? <p className="text-xs text-muted-foreground">{row.worked.unanswered} sem essa resposta</p> : null}
      </TableCell>
      <TableCell className="align-top">
        <p className="tabular-nums">
          {row.measured.improved} melhorou · {row.measured.unchanged} igual · {row.measured.worsened} piorou
        </p>
        {row.measured.notComparable > 0 ? <p className="text-xs text-muted-foreground">{row.measured.notComparable} sem medição suficiente para comparar</p> : null}
      </TableCell>
      <TableCell className="align-top text-xs">
        {notWorked.length === 0 && worked.length === 0 ? <span className="text-muted-foreground">—</span> : null}
        {[...notWorked, ...worked].map((reason) => (
          <p key={`${reason.worked}:${reason.reason}`}>
            {reason.label} <span className="text-muted-foreground">({reason.count} · {WORKED_LABEL[reason.worked]})</span>
          </p>
        ))}
      </TableCell>
    </TableRow>
  )
}

export function TeamInterventions() {
  const query = useTeamInterventionsQuery()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT)
  const data = query.data
  if (query.isError) {
    return (
      <div className={cn(SURFACE_CARD, "space-y-2 p-5")} data-testid="team-interventions-error">
        <SectionLabel as="h3">Acompanhamentos em andamento</SectionLabel>
        <InlineError message="Não foi possível carregar os acompanhamentos da sua estrutura." onRetry={() => void query.refetch()} />
      </div>
    )
  }
  if (!data || (data.active.length === 0 && data.results.length === 0)) return null
  const overdue = data.active.filter((item) => item.overdue || item.nextStep?.overdue).length
  const truncated = data.activeTruncated
  const currentPage = Math.min(page, Math.max(1, Math.ceil(data.active.length / pageSize)))
  const visible = data.active.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  return (
    <div className="space-y-4" data-testid="team-interventions">
      <div className={cn(SURFACE_CARD, "space-y-3 p-5")}>
        <div>
          <SectionLabel as="h3">Acompanhamentos em andamento</SectionLabel>
          <p className="text-sm text-muted-foreground">
            {data.active.length === 0 ? "Nenhum acompanhamento em andamento na sua estrutura." : `${data.activeTotal} em andamento na sua estrutura${overdue > 0 ? ` · ${overdue} com prazo ou passo vencido${truncated ? " entre os listados" : ""}` : ""}.`}
          </p>
          {truncated ? (
            <p className="text-xs text-muted-foreground" role="status" data-testid="team-interventions-truncated">
              A lista mostra os {data.active.length} primeiros de {data.activeTotal} (atrasados antes).
            </p>
          ) : null}
        </div>
        {data.active.length > 0 ? (
          <div className={TABLE_FRAME}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead>Acompanhamento</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Próximo passo</TableHead>
                  <TableHead>Prazo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="align-top">
                      <p className="font-medium">{item.person.name}</p>
                      <p className="text-xs text-muted-foreground">Conduz: {item.responsible.name}</p>
                    </TableCell>
                    <TableCell className="align-top">
                      <Link href={interventionHref(item.caseId, item.id)} className="font-medium text-primary hover:underline">
                        {item.typeName}
                      </Link>
                      {item.indicatorName ? <p className="text-xs text-muted-foreground">{item.indicatorName}</p> : null}
                    </TableCell>
                    <TableCell className="align-top">
                      <p>{item.statusLabel}</p>
                      {item.progress.total > 0 ? <p className="text-xs text-muted-foreground tabular-nums">{item.progress.done} de {item.progress.total} passos registrados</p> : null}
                    </TableCell>
                    <TableCell className="align-top">
                      {item.nextStep ? (
                        <>
                          <p>{item.nextStep.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.nextStep.ownerName ?? "sem dono"}
                            {item.nextStep.dueAt ? ` · até ${formatCivilDate(item.nextStep.dueAt)}` : ""}
                            {item.nextStep.overdue ? " · vencido" : ""}
                          </p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top whitespace-nowrap">
                      {formatCivilDate(item.dueAt)}
                      {item.overdue ? (
                        <Badge variant="warning" className="ml-2">
                          <AlertTriangle className="size-3" /> Atrasado
                        </Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
        {data.active.length > 0 ? (
          <ListPagination page={currentPage} pageSize={pageSize} total={data.active.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} itemLabel={["acompanhamento", "acompanhamentos"]} />
        ) : null}
      </div>

      {data.results.length > 0 ? (
        <div className={cn(SURFACE_CARD, "space-y-3 p-5")} data-testid="team-intervention-results">
          <div>
            <SectionLabel as="h3">O que deu resultado</SectionLabel>
            <p className="text-sm text-muted-foreground">
              Acompanhamentos concluídos nos últimos {data.windowDays} dias, por formato e indicador. “Deu resultado?” é a avaliação de quem conduziu; a medição é a da INIA (antes × depois do início).
            </p>
          </div>
          <div className={TABLE_FRAME}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Formato</TableHead>
                  <TableHead>Concluídos</TableHead>
                  <TableHead>Deu resultado?</TableHead>
                  <TableHead>Medição da INIA</TableHead>
                  <TableHead>Motivos mais citados</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.results.map((row) => (
                  <ResultRow key={`${row.typeKey}:${row.indicatorName ?? ""}`} row={row} />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
