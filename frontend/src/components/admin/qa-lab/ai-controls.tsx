"use client"

import { AlertTriangle } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AI_POLICY_LABELS, type AiPolicy } from "@/schemas/admin/qa-lab.schema"

export type AiControlsValue = { aiPolicy: AiPolicy; maxAiCalls: number | null }

/**
 * "Orçamento de IA" (Parte 38-40): IA real x parar antes da IA, limite opcional de REQUESTS ao
 * modelo e o aviso de consumo — compartilhado pelos três modos do QA Lab. Vocabulário: "request
 * de IA" = uma requisição ao modelo; "interação/chamada" = uma ligação da operação. Um QA Run
 * usa UMA interação, mas pode fazer 0, 1 ou várias requests (um Orchestrator faz várias).
 */
export function AiControls({ value, onChange, idPrefix, note }: { value: AiControlsValue; onChange: (next: AiControlsValue) => void; idPrefix: string; note?: string | undefined }) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Orçamento de IA</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-ai-policy`}>Uso de IA</Label>
          <Select value={value.aiPolicy} onValueChange={(aiPolicy) => onChange({ ...value, aiPolicy: aiPolicy as AiPolicy })}>
            <SelectTrigger id={`${idPrefix}-ai-policy`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(AI_POLICY_LABELS) as AiPolicy[]).map((policy) => (
                <SelectItem key={policy} value={policy}>
                  {AI_POLICY_LABELS[policy]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-max-calls`}>Limite de requests ao modelo (opcional)</Label>
          <Input
            id={`${idPrefix}-max-calls`}
            type="number"
            min={1}
            max={50}
            placeholder="Sem limite"
            value={value.maxAiCalls ?? ""}
            disabled={value.aiPolicy === "STOP_BEFORE_AI"}
            onChange={(event) => onChange({ ...value, maxAiCalls: event.target.value ? Number(event.target.value) : null })}
          />
          <p className="text-xs text-muted-foreground">Define quantas requisições a modelos de IA podem ocorrer neste QA Run. Não limita a quantidade de interações da operação.</p>
        </div>
      </div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {value.aiPolicy === "REAL" ? (
        <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Esta simulação realizará requests reais ao modelo e consumirá tokens.
          {value.maxAiCalls ? ` Ao atingir ${value.maxAiCalls} request(s), a execução pausa antes da próxima.` : ""}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          A execução para no primeiro ponto que precisaria chamar o modelo — Conditions, contexto e efeitos anteriores são testados sem consumir tokens.
        </p>
      )}
    </div>
  )
}
