"use client"

import { MultiOrgScopeField } from "@/components/admin/shared/multi-org-scope-field"

import { scopeValueAfterUniverseChange, scopeValueIssue } from "@/lib/scope-links/scope-links"

import { Building2, CalendarClock, Globe2, Info, Lock, Star, Tags, Users } from "lucide-react"

import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { DatePicker } from "@/components/ui/date-picker"
import { SettingsSection } from "@/components/ui/surface"
import { Skeleton } from "@/components/ui/skeleton"
import { useAudiencePreviewQuery } from "@/queries/communications/use-communications"
import { COMMUNICATION_MAX_SUMMARY, COMMUNICATION_TAGS, COMMUNICATION_UNIVERSES, type AudienceOptions, type EditorialForm } from "@/schemas/communications/communication.schema"

import { audienceDescription, civilPartsOf, instantOf, segmentPayloadOf, segmentTeamOptions } from "../publication-form"
import { SearchablePicker } from "./searchable-picker"

type Patch = (patch: Partial<EditorialForm>) => void
const ANY_UNIVERSE = "__any__"

/** Bloco da lateral: a peça do kit (`SettingsSection` em `components/ui/surface.tsx`), compartilhada com o editor da Base. */
export { SettingsSection }

/** Data (calendário do kit) + hora (nativa — o kit ainda não tem seletor de hora; exceção registrada no catálogo de UI). */
function DateTimeField({ id, label, value, onChange, disabled, defaultTime }: { id: string; label: string; value: string | null; onChange: (value: string | null) => void; disabled?: boolean; defaultTime: string }) {
  const parts = civilPartsOf(value)
  const today = civilPartsOf(new Date().toISOString()).date
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      <DatePicker id={id} value={parts.date} min={today} clearable disabled={disabled} aria-label={`${label}: data`} className="sm:w-40" onChange={(date) => onChange(date ? instantOf(date, parts.time || defaultTime) : null)} />
      <Input type="time" aria-label={`${label}: hora`} value={parts.time} disabled={disabled || !parts.date} className="w-28" onChange={(event) => onChange(instantOf(parts.date, event.target.value))} />
    </div>
  )
}

export function PublicationScheduleSettings({ form, patch, locked, publishedAtLabel }: { form: EditorialForm; patch: Patch; locked: boolean; publishedAtLabel: string | null }) {
  return (
    <SettingsSection title="Publicação e exibição" icon={CalendarClock}>
      <div className="space-y-2">
        <Label>Quando publicar</Label>
        {locked ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Lock className="size-3.5" aria-hidden />{publishedAtLabel}</p>
        ) : (
          <>
            <RadioGroup value={form.publishAt ? "schedule" : "now"} onValueChange={(value) => patch({ publishAt: value === "now" ? null : instantOf(civilPartsOf(new Date(Date.now() + 86_400_000).toISOString()).date, "08:00") })} className="gap-2">
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="now" />Agora, ao publicar</label>
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="schedule" />Agendar</label>
            </RadioGroup>
            {form.publishAt ? <DateTimeField id="publication-publish-at" label="Publicar em" value={form.publishAt} defaultTime="08:00" onChange={(value) => patch({ publishAt: value })} /> : null}
          </>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="publication-display-until">Exibir até</Label>
        <DateTimeField id="publication-display-until" label="Exibir até" value={form.displayUntil} defaultTime="23:59" onChange={(value) => patch({ displayUntil: value })} />
        <p className="text-xs text-muted-foreground">{form.displayUntil ? "Depois disso, sai do Acompanhamento e deixa de ser usada pela INIA no chat." : "Sem data: fica visível até você arquivar."}</p>
      </div>
    </SettingsSection>
  )
}

export function PublicationAudienceSettings({ form, patch, locked, options, optionsLoading }: { form: EditorialForm; patch: Patch; locked: boolean; options: AudienceOptions | undefined; optionsLoading: boolean }) {
  const allowed = options?.audiences ?? ["TEAM"]
  const segmentReady = form.audience !== "SEGMENT" || Boolean(form.segment.universe || (form.segment.scope.groups.length > 0 && !scopeValueIssue(form.segment.scope)))
  const preview = useAudiencePreviewQuery({ audience: form.audience, segment: form.audience === "SEGMENT" ? segmentPayloadOf(form.segment) : null }, !locked && segmentReady && Boolean(options))
  const teamOptions = segmentTeamOptions(options)

  return (
    <SettingsSection title="Público" icon={Users}>
      {locked ? (
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground"><Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />{audienceDescription(form, options)}. O público não muda depois da publicação.</p>
      ) : optionsLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <>
          <RadioGroup value={form.audience} onValueChange={(value) => patch({ audience: value as EditorialForm["audience"] })} className="gap-2" aria-label="Para quem">
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="TEAM" /><Users className="size-4 text-muted-foreground" aria-hidden />Minha equipe</label>
            {allowed.includes("ORGANIZATION") ? <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="ORGANIZATION" /><Building2 className="size-4 text-muted-foreground" aria-hidden />Toda a empresa</label> : null}
            {allowed.includes("SEGMENT") ? <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="SEGMENT" /><Globe2 className="size-4 text-muted-foreground" aria-hidden />Público específico</label> : null}
          </RadioGroup>
          {form.audience === "SEGMENT" ? (
            <div className="space-y-3 rounded-xl bg-muted/40 p-3">
              {options && options.universes.length > 0 ? (
                <div className="space-y-1.5">
                  <Label htmlFor="publication-universe">Universo de atuação</Label>
                  <Select value={form.segment.universe ?? ANY_UNIVERSE} onValueChange={(value) => {
                    const universe = value === ANY_UNIVERSE ? null : (value as (typeof COMMUNICATION_UNIVERSES)[number])
                    // Trocar o universo tira do recorte os Grupos/Subgrupos que não são dele (Grupo sem universo continua: pendente).
                    patch({ segment: { universe, scope: scopeValueAfterUniverseChange(form.segment.scope, teamOptions, (unit) => !universe || !unit || unit === universe) } })
                  }}>
                    <SelectTrigger id="publication-universe" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY_UNIVERSE}>Qualquer universo</SelectItem>
                      {options.universes.map((universe) => <SelectItem key={universe} value={universe}>{universe}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <MultiOrgScopeField
                teams={teamOptions.filter((team) => !form.segment.universe || !team.operatingUniverse || team.operatingUniverse === form.segment.universe || team.subteams.some((subteam) => subteam.operatingUniverse === form.segment.universe))}
                value={form.segment.scope}
                onChange={(scope) => patch({ segment: { ...form.segment, scope } })}
                label="Grupos"
                hint="Sem Grupo escolhido, vale para todo o universo. Para cada Grupo: o Grupo inteiro ou só alguns Subgrupos."
              />
              <p className="text-xs text-muted-foreground">Recebe quem está, no cadastro de hoje, no universo escolhido e em um dos Grupos (inteiro) ou Subgrupos marcados. Quem mudar de Grupo passa a ver ou deixa de ver.</p>
            </div>
          ) : null}
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {!segmentReady ? "Escolha o recorte do público." : preview.isError ? "Não foi possível estimar o público agora." : preview.data === undefined ? "Calculando o público…" : `${preview.data.toLocaleString("pt-BR")} ${preview.data === 1 ? "pessoa receberia" : "pessoas receberiam"} hoje.`}
          </p>
        </>
      )}
    </SettingsSection>
  )
}

export function PublicationOrganizationSettings({ form, patch, options }: { form: EditorialForm; patch: Patch; options: AudienceOptions | undefined }) {
  const productOptions = (options?.products ?? []).map((product) => ({ value: product.id, label: product.name, hint: product.familyName }))
  return (
    <SettingsSection title="Organização" icon={Tags}>
      <div className="space-y-2">
        <Label>Categoria</Label>
        <ToggleGroup type="multiple" value={form.tags} onValueChange={(values) => patch({ tags: values.filter((value): value is EditorialForm["tags"][number] => (COMMUNICATION_TAGS as readonly string[]).includes(value)) })} className="flex-wrap justify-start" aria-label="Categorias">
          <ToggleGroupItem value="Aviso">Aviso</ToggleGroupItem>
          <ToggleGroupItem value="Processos">Processos</ToggleGroupItem>
          <ToggleGroupItem value="Campanha">Campanha</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <label className="flex items-start justify-between gap-3 text-sm">
        <span className="space-y-0.5">
          <span className="flex items-center gap-1.5 font-medium"><Star className="size-3.5" aria-hidden />Destaque</span>
          <span className="block text-xs text-muted-foreground">Aparece com selo e vem primeiro quando a INIA consulta as publicações.</span>
        </span>
        <Switch checked={form.featured} onCheckedChange={(featured) => patch({ featured })} aria-label="Destaque" />
      </label>
      {productOptions.length > 0 ? (
        <div className="space-y-1.5">
          <Label htmlFor="publication-product">Produto relacionado</Label>
          <SearchablePicker id="publication-product" label="Produto relacionado" placeholder="Nenhum produto" options={productOptions} values={form.productNodeId ? [form.productNodeId] : []} onChange={(values) => patch({ productNodeId: values[0] ?? null })} />
          <p className="text-xs text-muted-foreground">Opcional. Ajuda a INIA a relacionar a publicação a perguntas sobre o produto.</p>
        </div>
      ) : null}
    </SettingsSection>
  )
}

export function PublicationSummarySettings({ form, patch }: { form: EditorialForm; patch: Patch }) {
  return (
    <SettingsSection title="Resumo" icon={Info}>
      <Textarea id="publication-summary" aria-label="Resumo" value={form.summary} maxLength={COMMUNICATION_MAX_SUMMARY} rows={3} placeholder="Uma ou duas frases sobre o que muda para quem lê." onChange={(event) => patch({ summary: event.target.value })} />
      <p className="text-right text-xs text-muted-foreground">{form.summary.length}/{COMMUNICATION_MAX_SUMMARY}</p>
    </SettingsSection>
  )
}
