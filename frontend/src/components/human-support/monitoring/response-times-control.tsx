"use client"

import { useId, useState } from "react"
import { Timer } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toneSurface } from "@/components/ui/surface"
import { ApiError } from "@/lib/api/api-client"
import { cn } from "@/lib/utils"
import { useResponseTimesQuery, useSaveResponseTimesMutation } from "@/queries/human-support/use-human-support-admin"
import { ANJO_UNRESPONSIVE_LIMITS, RESPONSE_TIMES_LIMITS, type ResponseTimes, type ResponseTimesPanel } from "@/schemas/human-support/admin.schema"

/**
 * TEMPOS DE RESPOSTA (migrations 193 e 194; pedidos do responsável em 2026-11-16). Quanto tempo cada lado pode ficar sem responder:
 *  - operador sem responder ao Anjo → o Anjo fica livre e o pedido fica "Aguardando o operador"; escrever o põe no fim da fila;
 *  - sem voltar até o encerramento (contado do MESMO instante: a última mensagem do Anjo) → abandono do operador;
 *  - Anjo sem responder → ele perde o atendimento (abandono do Anjo) e o pedido volta à frente da fila (sem ninguém do Apoio em
 *    serviço, o pedido é encerrado).
 * ONDE VALE: o padrão da organização (só quem acompanha a organização muda) ou um Grupo (o Coordenador de Anjos muda só os do próprio
 * Grupo; Grupo sem tempos próprios usa o padrão). Cada campo diz a partir de quando conta. No padrão também ficam os dois tempos do
 * Anjo que não responde NINGUÉM (migration 195; do Anjo, não do Grupo): até a pausa "Desconexão" e nela até Indisponível. As mesmas regras do servidor
 * (`responseTimesProblem`); 409 = outra pessoa salvou antes: recarrega e avisa.
 */
type Field = keyof ResponseTimes
type UnresponsiveField = "pauseAfterMinutes" | "offlineAfterMinutes"
type Draft = Record<Field | UnresponsiveField, string>
type Unresponsive = ResponseTimesPanel["organization"]["anjoUnresponsive"]

const UNRESPONSIVE_FIELDS: { key: UnresponsiveField; label: string; from: string; then: string; max: number }[] = [
  {
    key: "pauseAfterMinutes",
    label: "Anjo sem responder ninguém",
    from: "Conta a partir do primeiro retorno que ele ficou devendo a um operador — ou do último sinal dele (mensagem em qualquer atendimento ou mudança de estado), se veio depois.",
    then: "Ao vencer, o sistema o põe em pausa “Desconexão”: para de receber pedidos.",
    max: ANJO_UNRESPONSIVE_LIMITS.pauseAfterMax,
  },
  {
    key: "offlineAfterMinutes",
    label: "Tempo na pausa Desconexão",
    from: "Conta a partir da entrada na pausa.",
    then: "Se ele não voltar (escolher um estado), fica Indisponível. O motivo aparece na Monitoria Online, na presença do Anjo e na área dele.",
    max: ANJO_UNRESPONSIVE_LIMITS.offlineAfterMax,
  },
]
const ORGANIZATION = "organization"

const FIELDS: { key: Field; label: string; from: string; then: string; max: number }[] = [
  {
    key: "operatorRequeueMinutes",
    label: "Operador sem responder",
    from: "Conta a partir da última mensagem do Anjo.",
    then: "Ao vencer, o Anjo fica livre e o pedido passa a “Aguardando o operador”. Se o operador escrever, o pedido vai para o fim da fila.",
    max: RESPONSE_TIMES_LIMITS.requeueMax,
  },
  {
    key: "operatorCloseMinutes",
    label: "Encerrar se o operador não voltar",
    from: "Também conta a partir da última mensagem do Anjo — não de quando o pedido passou a aguardar.",
    then: "Ao vencer, o pedido é encerrado como abandono do operador.",
    max: RESPONSE_TIMES_LIMITS.closeMax,
  },
  {
    key: "anjoRequeueMinutes",
    label: "Anjo sem responder",
    from: "Conta a partir da última mensagem do operador — ou do início do atendimento, se o Anjo ainda não escreveu.",
    then: "Ao vencer, o Anjo perde o atendimento (abandono do Anjo) e o pedido volta à frente da fila. Sem ninguém do Apoio em serviço, o pedido é encerrado.",
    max: RESPONSE_TIMES_LIMITS.requeueMax,
  },
]

export function responseTimesProblem(times: ResponseTimes): string | null {
  const values = [times.operatorRequeueMinutes, times.operatorCloseMinutes, times.anjoRequeueMinutes]
  if (!values.every((value) => Number.isInteger(value))) return "Use minutos inteiros."
  if ([times.operatorRequeueMinutes, times.anjoRequeueMinutes].some((value) => value < RESPONSE_TIMES_LIMITS.requeueMin || value > RESPONSE_TIMES_LIMITS.requeueMax)) return "Os tempos de volta à fila vão de 1 a 120 minutos."
  if (times.operatorCloseMinutes > RESPONSE_TIMES_LIMITS.closeMax) return "O encerramento vai até 240 minutos."
  if (times.operatorCloseMinutes <= times.operatorRequeueMinutes) return "O encerramento precisa ser depois da volta à fila do operador."
  return null
}

const toDraft = (times: ResponseTimes, unresponsive: Unresponsive): Draft => ({
  operatorRequeueMinutes: String(times.operatorRequeueMinutes),
  operatorCloseMinutes: String(times.operatorCloseMinutes),
  anjoRequeueMinutes: String(times.anjoRequeueMinutes),
  pauseAfterMinutes: String(unresponsive.pauseAfterMinutes),
  offlineAfterMinutes: String(unresponsive.offlineAfterMinutes),
})
function unresponsiveProblem(value: Unresponsive): string | null {
  if (![value.pauseAfterMinutes, value.offlineAfterMinutes].every(Number.isInteger)) return "Use minutos inteiros."
  if (value.pauseAfterMinutes < 1 || value.pauseAfterMinutes > ANJO_UNRESPONSIVE_LIMITS.pauseAfterMax) return "O Anjo sem responder ninguém vai de 1 a 240 minutos."
  if (value.offlineAfterMinutes < 1 || value.offlineAfterMinutes > ANJO_UNRESPONSIVE_LIMITS.offlineAfterMax) return "O tempo na pausa Desconexão vai de 1 a 120 minutos."
  return null
}
const short = (times: ResponseTimes) => `${times.operatorRequeueMinutes}/${times.operatorCloseMinutes}/${times.anjoRequeueMinutes} min`

type Target = { key: string; teamId: string | null; name: string; times: ResponseTimes; version: number; canEdit: boolean; custom: boolean }

/** Onde quem lê pode olhar: o padrão (quando pode mudá-lo) e os Grupos do alcance. */
function targetsOf(panel: ResponseTimesPanel): Target[] {
  const groups = panel.groups.map((group): Target => ({ key: group.teamId, teamId: group.teamId, name: group.teamName, times: group.times, version: group.version, canEdit: group.canEdit, custom: group.custom }))
  return panel.organization.canEdit ? [{ key: ORGANIZATION, teamId: null, name: "Padrão da organização", times: panel.organization.times, version: panel.organization.version, canEdit: true, custom: true }, ...groups] : groups
}

export function ResponseTimesControl() {
  const query = useResponseTimesQuery()
  const save = useSaveResponseTimesMutation()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [conflict, setConflict] = useState(false)
  const baseId = useId()

  const panel = query.data
  const targets = panel ? targetsOf(panel) : []
  const target = targets.find((item) => item.key === selected) ?? targets[0] ?? null
  const savedUnresponsive = panel?.organization.anjoUnresponsive ?? { pauseAfterMinutes: 20, offlineAfterMinutes: 10 }
  const isOrganization = target?.teamId === null
  const current = draft ?? (target ? toDraft(target.times, savedUnresponsive) : null)
  const parsed = current ? { operatorRequeueMinutes: Number(current.operatorRequeueMinutes), operatorCloseMinutes: Number(current.operatorCloseMinutes), anjoRequeueMinutes: Number(current.anjoRequeueMinutes) } : null
  const parsedUnresponsive = current ? { pauseAfterMinutes: Number(current.pauseAfterMinutes), offlineAfterMinutes: Number(current.offlineAfterMinutes) } : null
  const problem =
    parsed && draft
      ? Object.values(current!).some((value) => value.trim() === "")
        ? "Preencha todos os tempos."
        : (responseTimesProblem(parsed) ?? (isOrganization && parsedUnresponsive ? unresponsiveProblem(parsedUnresponsive) : null))
      : null
  const changed = Boolean(
    target && parsed && draft &&
      (parsed.operatorRequeueMinutes !== target.times.operatorRequeueMinutes || parsed.operatorCloseMinutes !== target.times.operatorCloseMinutes || parsed.anjoRequeueMinutes !== target.times.anjoRequeueMinutes ||
        (isOrganization && parsedUnresponsive && (parsedUnresponsive.pauseAfterMinutes !== savedUnresponsive.pauseAfterMinutes || parsedUnresponsive.offlineAfterMinutes !== savedUnresponsive.offlineAfterMinutes))),
  )
  const extra = parsed && !problem ? parsed.operatorCloseMinutes - parsed.operatorRequeueMinutes : null

  const reset = () => {
    setDraft(null)
    setConflict(false)
  }
  const send = (times: ResponseTimes | null, success: string) => {
    if (!target) return
    const input = target.teamId === null ? { teamId: null, times: times!, anjoUnresponsive: parsedUnresponsive ?? savedUnresponsive, version: target.version } : { teamId: target.teamId, times, version: target.version }
    save.mutate(input, {
      onSuccess: () => {
        reset()
        setOpen(false)
        toast.success(success)
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === "HUMAN_SUPPORT_CONCURRENT_CHANGE") {
          setDraft(null)
          setConflict(true)
          return
        }
        toast.error(error.message)
      },
    })
  }
  const submit = () => {
    if (!parsed || problem) return
    send(parsed, `Tempos salvos para ${target!.teamId === null ? "o padrão da organização" : `o Grupo ${target!.name}`}. Valem a partir de agora, também nos atendimentos em andamento.`)
  }

  // No botão, os tempos de onde a pessoa atua quando há um só lugar para ver.
  const single = targets.length === 1 ? targets[0]! : null

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="rounded-full">
          <Timer aria-hidden />
          Tempos de resposta
          {single ? <span className="text-muted-foreground tabular-nums">{short(single.times)}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={16} className="max-h-(--radix-popover-content-available-height) w-[26rem] max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">Tempos de resposta</p>
          <p className="text-xs text-muted-foreground">Quanto tempo cada lado pode ficar sem responder. Valem a partir de agora, também nos atendimentos em andamento.</p>
        </div>
        {conflict ? (
          <p role="alert" className={cn(toneSurface("warning"), "px-3 py-2 text-xs")}>
            Outra pessoa alterou os tempos enquanto você editava. Recarregamos os valores atuais.
          </p>
        ) : null}
        {query.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível ler os tempos. Tente de novo.
          </p>
        ) : !panel ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : !target || !current ? (
          <p className="text-sm text-muted-foreground">Nenhum Grupo no seu alcance.</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor={`${baseId}-target`} className="text-xs text-muted-foreground">
                Onde vale
              </Label>
              {targets.length > 1 ? (
                <Select
                  value={target.key}
                  onValueChange={(value) => {
                    setSelected(value)
                    reset()
                  }}
                  disabled={save.isPending}
                >
                  <SelectTrigger id={`${baseId}-target`} className="h-8 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {targets.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.teamId === null ? item.name : `Grupo ${item.name}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p id={`${baseId}-target`} className="text-sm font-medium">
                  {target.teamId === null ? target.name : `Grupo ${target.name}`}
                </p>
              )}
              {target.teamId !== null ? (
                <p className="text-xs text-muted-foreground" data-testid="response-times-source">
                  {target.custom ? "Este Grupo tem tempos próprios." : `Este Grupo usa o padrão da organização (${short(panel.organization.times)}).${target.canEdit ? " Ao salvar, ele passa a ter tempos próprios." : ""}`}
                  {target.canEdit ? null : " Só o Coordenador de Anjos do Grupo muda estes tempos."}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Vale para todo Grupo sem tempos próprios.</p>
              )}
            </div>
            {FIELDS.map((field) => (
              <div key={field.key} className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-start gap-x-3 gap-y-0.5">
                <Label htmlFor={`${baseId}-${field.key}`} className="text-sm">
                  {field.label}
                </Label>
                <div className="row-span-2 flex items-center gap-1.5">
                  <Input
                    id={`${baseId}-${field.key}`}
                    type="number"
                    inputMode="numeric"
                    min={RESPONSE_TIMES_LIMITS.requeueMin}
                    max={field.max}
                    step={1}
                    value={current[field.key]}
                    onChange={(event) => {
                      setConflict(false)
                      setDraft({ ...current, [field.key]: event.target.value })
                    }}
                    disabled={save.isPending || !target.canEdit}
                    className="h-8 w-16 text-right tabular-nums"
                  />
                  <span className="text-xs text-muted-foreground">min</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{field.from}</span> {field.then}
                  {field.key === "operatorCloseMinutes" && extra !== null ? ` Com estes valores, o operador tem mais ${extra} min depois de o Anjo ficar livre.` : null}
                </p>
              </div>
            ))}
            {isOrganization ? (
              <div className="space-y-3 border-t border-border pt-3" data-testid="anjo-unresponsive-fields">
                <p className="text-xs font-medium text-muted-foreground">Anjo que não responde ninguém — vale para todos os Anjos</p>
                {UNRESPONSIVE_FIELDS.map((field) => (
                  <div key={field.key} className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-start gap-x-3 gap-y-0.5">
                    <Label htmlFor={`${baseId}-${field.key}`} className="text-sm">
                      {field.label}
                    </Label>
                    <div className="row-span-2 flex items-center gap-1.5">
                      <Input
                        id={`${baseId}-${field.key}`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={field.max}
                        step={1}
                        value={current[field.key]}
                        onChange={(event) => {
                          setConflict(false)
                          setDraft({ ...current, [field.key]: event.target.value })
                        }}
                        disabled={save.isPending}
                        className="h-8 w-16 text-right tabular-nums"
                      />
                      <span className="text-xs text-muted-foreground">min</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{field.from}</span> {field.then}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="border-t border-border pt-3 text-xs text-muted-foreground" data-testid="anjo-unresponsive-note">
                Anjo que não responde ninguém por {savedUnresponsive.pauseAfterMinutes} min entra em pausa “Desconexão”; {savedUnresponsive.offlineAfterMinutes} min nela sem voltar, fica Indisponível. Vale para a organização inteira.
              </p>
            )}
            {problem ? (
              <p role="alert" className="text-xs text-destructive">
                {problem}
              </p>
            ) : null}
            {target.canEdit ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {target.teamId !== null && target.custom ? (
                  <Button type="button" variant="ghost" size="sm" className="mr-auto rounded-full" onClick={() => send(null, `O Grupo ${target.name} voltou a usar o padrão da organização.`)} disabled={save.isPending}>
                    Usar o padrão da organização
                  </Button>
                ) : null}
                <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setOpen(false)} disabled={save.isPending}>
                  Cancelar
                </Button>
                <Button type="button" size="sm" className="rounded-full" onClick={submit} disabled={!changed || Boolean(problem) || save.isPending}>
                  {save.isPending ? "Salvando…" : "Salvar"}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
