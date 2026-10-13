import Link from "next/link"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CharacterCounter, characterCountState } from "@/components/ui/character-counter"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { AGENT_TEXT_LIMITS } from "@/schemas/admin/agent.schema"

/**
 * LIMITES DE ATUAÇÃO do Agent: interruptor + "até onde este agente vai". Desligado, o campo fica bloqueado e o texto guardado
 * (volta ao religar). Ligado exige texto — o Salvar da página fica bloqueado sem ele (o backend também recusa).
 */
export function ActionLimitsCard({ enabled, text, onEnabledChange, onTextChange }: { enabled: boolean; text: string; onEnabledChange: (enabled: boolean) => void; onTextChange: (text: string) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Limites de atuação</CardTitle>
        <CardDescription>Até onde este agente vai? Ligado, ele recusa o que estiver fora.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <Label htmlFor="agent-action-limits-switch">Limitar a atuação deste agente</Label>
            <p className="text-sm text-muted-foreground">{enabled ? "Ligado: ele só atua dentro do que estiver escrito abaixo." : "Desligado: ele responde como sempre."}</p>
          </div>
          <Switch id="agent-action-limits-switch" checked={enabled} onCheckedChange={onEnabledChange} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-action-limits" className={cn(!enabled && "text-muted-foreground")}>
            Até onde este agente vai
          </Label>
          <Textarea
            id="agent-action-limits"
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            disabled={!enabled}
            rows={3}
            placeholder="Ex.: só assuntos de faturamento — fatura, cobrança, segunda via, contestação e negociação de débito."
            aria-describedby="agent-action-limits-count"
            aria-invalid={(enabled && (!text.trim() || characterCountState(text, AGENT_TEXT_LIMITS.actionLimits).over)) || undefined}
          />
          <CharacterCounter id="agent-action-limits-count" value={text} limits={AGENT_TEXT_LIMITS.actionLimits} />
          {enabled && !text.trim() ? <p className="text-xs text-destructive">Descreva até onde este agente vai ou desligue os limites.</p> : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Fora desses limites, o agente diz em uma frase que o assunto não é atendido ali e oferece ajuda com o que ele atende. Cumprimentos e
          perguntas sobre o que ele faz continuam respondidos. Os assuntos proibidos de{" "}
          <Link href="/admin/governance" className="underline underline-offset-2">
            Governança
          </Link>{" "}
          valem sempre, para todos os agentes.
        </p>
      </CardContent>
    </Card>
  )
}
