"use client"

import { useId, useState } from "react"
import { RotateCcw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime } from "@/lib/format/date"
import { usePolicyEvaluationsQuery, useReevaluateMutation } from "@/queries/admin/use-intervention-policy-queries"
import { OUTCOME_LABELS, type EvaluationListItem } from "@/schemas/admin/intervention-policy.schema"

import { errorMessage } from "../shared/helpers"
import { EVALUATION_ORIGIN_LABELS } from "../shared/labels"

/**
 * Avaliações de uma política (auditoria). O nome só aparece para quem já enxerga a pessoa; "Reavaliar" cria uma avaliação
 * NOVA ligada à original (mesma versão e mesmo instante de referência, fatos lidos de novo) e não abre intervenção nenhuma.
 */
export function PolicyEvaluationsPanel({ policyId }: { policyId: string }) {
  const evaluationsQuery = usePolicyEvaluationsQuery(policyId)
  if (evaluationsQuery.isPending) return <Skeleton className="h-32 w-full" />
  if (evaluationsQuery.isError) return <p className="text-sm text-destructive">{errorMessage(evaluationsQuery.error, "Não foi possível carregar as avaliações.")}</p>
  const evaluations = evaluationsQuery.data
  if (evaluations.length === 0) return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nenhuma avaliação desta política ainda.</p>
  return (
    <div className={TABLE_FRAME}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Quando</TableHead>
            <TableHead>Colaborador</TableHead>
            <TableHead>Resultado</TableHead>
            <TableHead>Versão</TableHead>
            <TableHead>Origem</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {evaluations.map((evaluation) => (
            <TableRow key={evaluation.id} data-testid={`evaluation-${evaluation.id}`}>
              <TableCell className="text-sm">{formatDateTime(evaluation.evaluatedAt)}</TableCell>
              <TableCell className="text-sm">{evaluation.person ? evaluation.person.name : <span className="text-muted-foreground">Colaborador fora do seu escopo</span>}</TableCell>
              <TableCell>
                <Badge variant="outline">{OUTCOME_LABELS[evaluation.outcome]}</Badge>
              </TableCell>
              <TableCell className="text-sm">{evaluation.policyVersion ? `v${evaluation.policyVersion}` : "—"}</TableCell>
              <TableCell className="text-sm">
                {EVALUATION_ORIGIN_LABELS[evaluation.origin] ?? "Outra origem"}
                {evaluation.supersedesEvaluationId ? <span className="block text-xs text-muted-foreground">Reavalia uma avaliação anterior</span> : null}
              </TableCell>
              <TableCell className="text-right">
                <ReevaluatePopover evaluation={evaluation} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ReevaluatePopover({ evaluation }: { evaluation: EvaluationListItem }) {
  const reevaluate = useReevaluateMutation()
  const reasonId = useId()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const valid = reason.trim().length >= 5
  if (!evaluation.person) return <span className="text-xs text-muted-foreground">Fora do seu escopo</span>
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reevaluate.reset()
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost">
          <RotateCcw /> Reavaliar
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Reavaliar</PopoverTitle>
          <PopoverDescription>Cria uma avaliação NOVA ligada a esta, com a mesma versão e o mesmo instante de referência, lendo os fatos de novo. A original fica preservada como fundamento histórico e nenhuma intervenção é aberta ou alterada.</PopoverDescription>
        </PopoverHeader>
        <div className="space-y-1">
          <Label htmlFor={reasonId} className="text-xs">
            Motivo *
          </Label>
          <Textarea id={reasonId} rows={3} maxLength={1000} value={reason} placeholder="Ex.: dados do fechamento corrigidos pela fonte" onChange={(event) => setReason(event.target.value)} />
          <p className="text-xs text-muted-foreground">Pelo menos 5 caracteres.</p>
        </div>
        {reevaluate.isError ? <p className="text-xs text-destructive">{errorMessage(reevaluate.error)}</p> : null}
        <Button
          size="sm"
          disabled={!valid || reevaluate.isPending}
          onClick={async () => {
            try {
              await reevaluate.mutateAsync({ evaluationId: evaluation.id, reason: reason.trim() })
              setReason("")
              setOpen(false)
            } catch {
              // mensagem do backend acima
            }
          }}
        >
          {reevaluate.isPending ? "Reavaliando..." : "Registrar reavaliação"}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
