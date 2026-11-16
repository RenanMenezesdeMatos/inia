"use client"

import { useState } from "react"
import { ArrowRightLeft, ListStart } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useTransferAttendanceMutation, useTransferCandidatesQuery } from "@/queries/human-support/use-human-support-admin"
import { PRESENCE_STATUS_LABELS } from "@/schemas/human-support/catalogs.schema"
import { TRANSFER_REASON_MAX, TRANSFER_REASON_MIN, type TransferCandidates } from "@/schemas/human-support/monitoring.schema"

const QUEUE = "queue"

/**
 * TRANSFERIR ATENDIMENTO (Coordenador de Anjos no alcance dele e Administrador geral; migration 190). Para um Anjo que pode receber
 * AGORA — Disponível, com a área aberta, sem pausa programada e com vaga, do Grupo/Subgrupo do pedido; os outros aparecem desabilitados
 * com o motivo — ou de volta à FRENTE da fila (outro Anjo continua; o atual nunca o recebe de volta). O motivo é obrigatório e fica só
 * para a coordenação: o operador vê apenas que outro Anjo assumiu. A conversa, o protocolo e as mensagens continuam os mesmos.
 */
export function TransferDialog({ requestId, protocol }: { requestId: string; protocol: string }) {
  const [open, setOpen] = useState(false)
  const candidates = useTransferCandidatesQuery(requestId, open)
  const transfer = useTransferAttendanceMutation(requestId)
  const [choice, setChoice] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const data = candidates.data
  const firstEligible = data?.candidates.find((candidate) => candidate.canReceive)?.personId ?? null
  // Sem escolha da pessoa: o primeiro Anjo que pode receber (a lista vem do mais livre); sem nenhum, a fila.
  const selected = choice ?? (data ? (firstEligible ?? QUEUE) : null)
  const selectedCandidate = data?.candidates.find((candidate) => candidate.personId === selected) ?? null
  const trimmed = reason.trim()
  const reasonOk = trimmed.length >= TRANSFER_REASON_MIN && trimmed.length <= TRANSFER_REASON_MAX
  const canSubmit = Boolean(selected) && (selected === QUEUE || Boolean(selectedCandidate?.canReceive)) && reasonOk && !transfer.isPending

  const reset = () => {
    setChoice(null)
    setReason("")
    transfer.reset()
  }
  const submit = () => {
    if (!canSubmit || !selected) return
    transfer.mutate(
      { toAnjoPersonId: selected === QUEUE ? null : selected, reason: trimmed },
      {
        onSuccess: () => {
          toast.success(selected === QUEUE ? `Atendimento ${protocol} devolvido à frente da fila.` : `Atendimento ${protocol} transferido para ${selectedCandidate?.name ?? "o Anjo"}.`)
          setOpen(false)
          reset()
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="rounded-full">
          <ArrowRightLeft aria-hidden />
          Transferir atendimento
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Transferir o atendimento {protocol}</DialogTitle>
          <DialogDescription>
            {data?.currentAnjoName ? `Hoje com ${data.currentAnjoName}. ` : ""}O operador continua na mesma conversa e vê que outro Anjo assumiu. O motivo fica só para a coordenação.
          </DialogDescription>
        </DialogHeader>

        {candidates.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">Carregando os Anjos…</p>
        ) : candidates.isError ? (
          <p className="text-sm text-destructive" role="alert">Não foi possível carregar os Anjos. Feche e tente de novo.</p>
        ) : data ? (
          <CandidateList data={data} selected={selected} onSelect={setChoice} noneEligible={firstEligible === null} />
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor={`transfer-reason-${requestId}`}>Motivo da transferência</Label>
          <Textarea
            id={`transfer-reason-${requestId}`}
            value={reason}
            maxLength={TRANSFER_REASON_MAX}
            rows={2}
            placeholder="Ex.: o Anjo precisou sair para uma reunião."
            aria-describedby={`transfer-reason-hint-${requestId}`}
            onChange={(event) => setReason(event.target.value)}
          />
          <p id={`transfer-reason-hint-${requestId}`} className="flex justify-between text-xs text-muted-foreground">
            <span>Obrigatório. O operador não vê o motivo.</span>
            <span className="tabular-nums">
              {trimmed.length}/{TRANSFER_REASON_MAX}
            </span>
          </p>
        </div>

        {transfer.error ? (
          <p role="alert" className="text-sm text-destructive">
            {transfer.error instanceof Error && transfer.error.message ? transfer.error.message : "Não foi possível transferir. Tente de novo."}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={submit}>
            {transfer.isPending ? "Transferindo…" : selected === QUEUE ? "Devolver à fila" : "Transferir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CandidateList({ data, selected, onSelect, noneEligible }: { data: TransferCandidates; selected: string | null; onSelect: (value: string) => void; noneEligible: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium" id="transfer-target-label">
        Para quem
      </p>
      {noneEligible ? <p className="text-xs text-muted-foreground">Nenhum Anjo deste Grupo/Subgrupo pode receber agora. Você pode devolver o atendimento à frente da fila.</p> : null}
      <RadioGroup value={selected ?? ""} onValueChange={onSelect} aria-labelledby="transfer-target-label" className="max-h-64 gap-1.5 overflow-y-auto">
        {data.candidates.map((candidate) => (
          <label
            key={candidate.personId}
            htmlFor={`transfer-${candidate.personId}`}
            className={cn("flex items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm", candidate.canReceive ? "cursor-pointer hover:bg-muted/60" : "cursor-not-allowed bg-muted/30", selected === candidate.personId && "border-primary bg-primary/5")}
          >
            <RadioGroupItem id={`transfer-${candidate.personId}`} value={candidate.personId} disabled={!candidate.canReceive} />
            <span className="min-w-0 flex-1">
              <span className={cn("block truncate font-medium", !candidate.canReceive && "text-muted-foreground")}>{candidate.name}</span>
              <span className="block text-xs text-muted-foreground">
                {candidate.reason ?? `${PRESENCE_STATUS_LABELS[candidate.status]} · ${candidate.used} de ${candidate.capacity} atendimentos`}
              </span>
            </span>
          </label>
        ))}
        <label htmlFor="transfer-queue" className={cn("flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border px-3 py-2 text-sm hover:bg-muted/60", selected === QUEUE && "border-primary bg-primary/5")}>
          <RadioGroupItem id="transfer-queue" value={QUEUE} />
          <ListStart className="size-4 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Devolver à frente da fila</span>
            <span className="block text-xs text-muted-foreground">O próximo Anjo que puder receber continua a conversa (nunca o atual).</span>
          </span>
        </label>
      </RadioGroup>
    </div>
  )
}
