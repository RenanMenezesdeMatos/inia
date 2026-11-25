"use client"

import { ScopedMultiCombobox } from "@/components/admin/shared/scoped-multi-combobox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { PLATFORM_LEVELS, type ReportAudience, type ReportOptions } from "@/schemas/reports/reports.schema"
import { REPORT_AUDIENCE_SOURCE } from "@/services/reports/reports-service"
import { LEVEL_LABELS } from "../report-labels"
import { ChipToggleGroup, Field } from "./form-controls"

type Distribution = Extract<ReportAudience, { mode: "DISTRIBUTION" }>
const EMPTY: Distribution = { mode: "DISTRIBUTION", everyone: false, levels: [], jobTitles: [], teamIds: [], subteamIds: [], personIds: [] }

/**
 * Para quem: líder comum → só para si (sem escolha). Papel Report → público no escopo da atribuição (todos, níveis, cargos,
 * Grupos, Subgrupos, pessoas — combinados sem duplicar). Cada pessoa recebe só os dados que o escopo DELA alcança.
 */
export function AudienceFields({ audience, onChange, catalog, canCreateForSelf }: { audience: ReportAudience; onChange: (audience: ReportAudience) => void; catalog: ReportOptions; canCreateForSelf: boolean }) {
  const distribution = audience.mode === "DISTRIBUTION" ? audience : null

  if (!catalog.audience) return <p className="text-sm text-muted-foreground">Este report é para você: ele chega no seu Acompanhamento, com os dados da sua estrutura atual.</p>
  const set = (patch: Partial<Distribution>) => onChange({ ...(distribution ?? EMPTY), ...patch })
  const groups = catalog.audience
  return (
    <div className="space-y-4">
      <RadioGroup value={audience.mode} onValueChange={(mode) => onChange(mode === "SELF" ? { mode: "SELF" } : (distribution ?? { ...EMPTY, levels: ["SUPERVISOR"] }))} className="gap-1.5">
        {canCreateForSelf ? <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="SELF" />Só para mim</label> : null}
        <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="DISTRIBUTION" />Distribuir para outras pessoas{groups.scope.organizationWide ? "" : " (no seu escopo)"}</label>
      </RadioGroup>
      {distribution ? (
        <div className="grid gap-4 rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Cada destinatário recebe a versão do SEU escopo (ex.: “a estrutura de quem recebe” vira a equipe de cada um). Quem não tiver acesso à estrutura do report fica de fora e aparece no histórico da execução.</p>
          <label className="flex items-center gap-2 text-sm"><Switch checked={distribution.everyone} onCheckedChange={(everyone) => set({ everyone })} />Todos os usuários elegíveis{groups.scope.organizationWide ? "" : " do seu escopo"}</label>
          <Field label="Níveis hierárquicos">
            <ChipToggleGroup ariaLabel="Níveis" options={PLATFORM_LEVELS.map((value) => ({ value, label: LEVEL_LABELS[value]! }))} selected={distribution.levels} onChange={(levels) => set({ levels: levels as Distribution["levels"] })} />
          </Field>
          <Field label="Cargos">
            <ChipToggleGroup ariaLabel="Cargos" options={groups.jobTitles.map((value) => ({ value, label: value }))} selected={distribution.jobTitles} onChange={(jobTitles) => set({ jobTitles })} empty="Nenhum cargo cadastrado no escopo." />
          </Field>
          <Field label="Grupos">
            <ScopedMultiCombobox kind="TEAM" source={REPORT_AUDIENCE_SOURCE} value={distribution.teamIds} onChange={(teamIds) => set({ teamIds })} />
          </Field>
          <Field label="Subgrupos">
            <ScopedMultiCombobox kind="SUBTEAM" source={REPORT_AUDIENCE_SOURCE} value={distribution.subteamIds} onChange={(subteamIds) => set({ subteamIds })} />
          </Field>
          <Field label="Pessoas específicas">
            <ScopedMultiCombobox kind="PERSON" source={REPORT_AUDIENCE_SOURCE} value={distribution.personIds} onChange={(personIds) => set({ personIds })} />
          </Field>
        </div>
      ) : null}
    </div>
  )
}
