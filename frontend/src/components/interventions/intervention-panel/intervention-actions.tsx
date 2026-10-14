"use client"

import { useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useForwardTargetsQuery, useInterventionCommand } from "@/queries/interventions/use-intervention-queries"
import type { ContinuityDecision, InterventionDetail } from "@/schemas/interventions/intervention.schema"
import { acceptIntervention, approveIntervention, cancelIntervention, decideContinuity, forwardIntervention, returnIntervention } from "@/services/interventions/intervention-service"

const ROLE_LABELS: Record<string, string> = { COORDINATOR: "Coordenador", SUPERVISOR: "Supervisor", MANAGER: "Gerente", SENIOR_MANAGER: "Gerente sênior", DIRECTOR: "Diretor" }

/** Pequeno fluxo com justificativa, num Popover (nunca Sheet) — o botão só confirma com o texto mínimo. */
function ReasonPopover({ trigger, title, description, minLength, confirmLabel, pending, onConfirm, extra, ready = true, variant = "outline" }: { trigger: string; title: string; description?: string; minLength: number; confirmLabel: string; pending: boolean; onConfirm: (text: string) => void; extra?: ReactNode; ready?: boolean; variant?: "outline" | "default" | "destructive" }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant={variant}>
          {trigger}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2">
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        {extra}
        <Textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} aria-label={title} />
        {minLength > 0 ? (
          <p className="text-xs text-muted-foreground">
            {text.trim().length}/{minLength} caracteres mínimos
          </p>
        ) : null}
        <Button
          size="sm"
          className="w-full"
          disabled={!ready || text.trim().length < minLength || pending}
          onClick={() => {
            onConfirm(text.trim())
            setOpen(false)
            setText("")
          }}
        >
          {confirmLabel}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

export function InterventionActions({ detail }: { detail: InterventionDetail }) {
  const can = (action: string) => detail.availableActions.includes(action)
  const revision = detail.revision
  const accept = useInterventionCommand((justification?: string) => acceptIntervention(detail.id, { expectedRevision: revision, ...(justification ? { justification } : {}) }), "Intervenção aceita.")
  const approve = useInterventionCommand((note: string) => approveIntervention(detail.id, { expectedRevision: revision, note }), "Intervenção aprovada.")
  const giveBack = useInterventionCommand((reason: string) => returnIntervention(detail.id, { expectedRevision: revision, reason }), "Devolvida para ajuste.")
  const cancel = useInterventionCommand((reason: string) => cancelIntervention(detail.id, { expectedRevision: revision, reason }), "Intervenção cancelada.")
  const forward = useInterventionCommand(({ toPersonId, reason }: { toPersonId: string; reason: string }) => forwardIntervention(detail.id, { expectedRevision: revision, toPersonId, reason }), "Encaminhada.")
  const decide = useInterventionCommand(({ decision, justification }: { decision: ContinuityDecision; justification: string }) => decideContinuity(detail.id, { expectedRevision: revision, decision, justification }), "Decisão registrada.")
  const [forwardTo, setForwardTo] = useState<string>("")
  const [decision, setDecision] = useState<ContinuityDecision | "">("")
  const targets = useForwardTargetsQuery(detail.id, can("FORWARD"))

  if (detail.availableActions.filter((action) => ["ACCEPT", "APPROVE", "RETURN", "DECIDE_CONTINUITY", "CANCEL", "FORWARD"].includes(action)).length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {can("ACCEPT") ? (
        detail.sensitive ? (
          <ReasonPopover
            trigger="Enviar para decisão"
            title="Justificativa da solicitação"
            description="A decisão será de uma pessoa autorizada. Esta solicitação não decide nada sobre o colaborador."
            minLength={30}
            confirmLabel="Enviar para decisão"
            pending={accept.isPending}
            onConfirm={(text) => accept.mutate(text)}
            variant="default"
          />
        ) : (
          <Button size="sm" disabled={accept.isPending} onClick={() => accept.mutate(undefined)}>
            {detail.approvalRequired ? "Aceitar e enviar para aprovação" : "Aceitar e iniciar"}
          </Button>
        )
      ) : null}
      {can("APPROVE") ? <ReasonPopover trigger="Aprovar" title="Aprovar a intervenção" description="Opcional: um comentário para o responsável." minLength={0} confirmLabel="Aprovar" pending={approve.isPending} onConfirm={(text) => approve.mutate(text)} variant="default" /> : null}
      {can("RETURN") ? <ReasonPopover trigger="Devolver para ajuste" title="O que precisa mudar?" minLength={5} confirmLabel="Devolver" pending={giveBack.isPending} onConfirm={(text) => giveBack.mutate(text)} /> : null}
      {can("DECIDE_CONTINUITY") && detail.continuityDecisions ? (
        <ReasonPopover
          trigger="Registrar decisão"
          title="Decisão sobre a avaliação de continuidade"
          description="Decisão humana, registrada e auditada. Nenhuma opção altera a situação funcional nem executa desligamento pela INIA."
          minLength={30}
          ready={Boolean(decision)}
          confirmLabel="Registrar decisão"
          pending={decide.isPending}
          onConfirm={(justification) => decision && decide.mutate({ decision, justification })}
          variant="default"
          extra={
            <div className="space-y-1">
              <Label>Decisão</Label>
              <Select value={decision || undefined} onValueChange={(value) => setDecision(value as ContinuityDecision)}>
                <SelectTrigger className="w-full" aria-label="Decisão">
                  <SelectValue placeholder="Escolha" />
                </SelectTrigger>
                <SelectContent>
                  {detail.continuityDecisions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />
      ) : null}
      {can("FORWARD") ? (
        <ReasonPopover
          trigger="Encaminhar à liderança"
          title="Encaminhar a responsabilidade"
          description="Transfere a responsabilidade para alguém acima na cadeia do colaborador. Diferente de pedir uma decisão."
          minLength={5}
          ready={Boolean(forwardTo)}
          confirmLabel="Encaminhar"
          pending={forward.isPending}
          onConfirm={(reason) => forwardTo && forward.mutate({ toPersonId: forwardTo, reason })}
          extra={
            <Select value={forwardTo || undefined} onValueChange={setForwardTo}>
              <SelectTrigger className="w-full" aria-label="Para quem">
                <SelectValue placeholder={targets.isLoading ? "Carregando…" : "Para quem"} />
              </SelectTrigger>
              <SelectContent>
                {(targets.data ?? []).map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name} · {ROLE_LABELS[person.role] ?? person.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      ) : null}
      {can("CANCEL") ? <ReasonPopover trigger={detail.status === "PROPOSED" ? "Descartar" : "Cancelar"} title={detail.status === "PROPOSED" ? "Por que descartar esta recomendação?" : "Por que cancelar?"} minLength={5} confirmLabel="Confirmar" pending={cancel.isPending} onConfirm={(text) => cancel.mutate(text)} variant="destructive" /> : null}
    </div>
  )
}
