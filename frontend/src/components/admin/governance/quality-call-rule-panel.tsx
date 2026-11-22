"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useQualityCallRuleQuery, useUpdateQualityCallRuleMutation } from "@/queries/admin/use-governance-queries"

/**
 * Regra geral de chamada curta (`QUALITY_CALL_MIN_DURATION_V1`): chamada abaixo da duração mínima não serve para avaliar qualidade.
 * Vale para a organização inteira; quem não a administra inteira vê a regra com o campo e o Salvar desabilitados e o motivo (o
 * servidor diz quem pode, `canEdit`, e recusa a troca de qualquer forma).
 */
export function QualityCallRulePanel() {
  const rule = useQualityCallRuleQuery()
  const update = useUpdateQualityCallRuleMutation()
  const [draft, setDraft] = useState<string | null>(null)

  if (rule.isError) return <p className="text-sm text-muted-foreground">{rule.error.message}</p>
  if (!rule.data) return null
  const { limits } = rule.data
  const value = draft ?? String(rule.data.minimumQualityCallSeconds)
  const parsed = Number(value)
  const valid = value.trim() !== "" && Number.isInteger(parsed) && parsed >= limits.min && parsed <= limits.max
  const changed = valid && parsed !== rule.data.minimumQualityCallSeconds
  const { canEdit } = rule.data

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="space-y-1.5">
          <Label htmlFor="quality-call-minimum">Duração mínima para análise de qualidade (segundos)</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="quality-call-minimum"
              type="number"
              inputMode="numeric"
              min={limits.min}
              max={limits.max}
              className="w-32"
              value={value}
              onChange={(event) => setDraft(event.target.value)}
              aria-invalid={!valid}
              disabled={!canEdit}
              aria-describedby={canEdit ? undefined : "quality-call-minimum-locked"}
            />
            <Button
              disabled={!canEdit || !changed || update.isPending}
              onClick={() => update.mutate(parsed, { onSuccess: () => setDraft(null) })}
            >
              {update.isPending ? "Salvando…" : "Salvar"}
            </Button>
            {draft !== null && draft !== String(rule.data.minimumQualityCallSeconds) ? (
              <Button variant="ghost" onClick={() => setDraft(null)} disabled={update.isPending}>
                Desfazer
              </Button>
            ) : null}
          </div>
          {!canEdit ? (
            <p id="quality-call-minimum-locked" className="text-xs text-muted-foreground">
              Esta regra vale para a organização inteira: só quem administra a configuração em toda a organização pode alterá-la.
            </p>
          ) : null}
          {!valid ? <p className="text-xs text-destructive">Use um número inteiro de {limits.min} a {limits.max}.</p> : null}
          <p className="text-xs text-muted-foreground">{rule.data.description} Use 0 para desligar a regra.</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1 rounded-lg border bg-card p-4">
          <p className="text-sm font-medium">Onde a regra vale</p>
          <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
            <li>Monitoria aleatória dos Workflows: chamada curta nunca é sorteada.</li>
            <li>Levantamento de boas práticas: chamada curta não entra na comparação.</li>
          </ul>
        </div>
        <div className="space-y-1 rounded-lg border bg-card p-4">
          <p className="text-sm font-medium">Onde a regra não vale</p>
          <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
            <li>Gatilho por Flag de canal: o sinal da chamada é diagnóstico (uma desconexão curta é justamente o que importa).</li>
            <li>Investigação de indicador: as chamadas curtas fazem parte do resultado que está sendo explicado.</li>
          </ul>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">A duração é o fim menos o início da chamada. Chamada sem duração conhecida também fica fora enquanto a regra estiver ligada.</p>
    </div>
  )
}
