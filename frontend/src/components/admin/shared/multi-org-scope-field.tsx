"use client"

import { useEffect, useId, useMemo, useState } from "react"
import { AlertTriangle, RotateCw, Users, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { unitFitsUniverse, type UniverseChoice } from "@/lib/operating-universe/hierarchy"
import { linksFromScopeValue, scopeValueFromLinks, scopeValueIssue, type ScopeLink, type ScopeLinksValue, type ScopeTeamOption } from "@/lib/scope-links/scope-links"
import { useScopeUnitsByIds } from "@/queries/scope-units/use-scope-units"
import type { ScopePickerPermission, ScopeUnitOption } from "@/schemas/scope-units/scope-units.schema"

import { ScopeUnitPicker } from "./scope-unit-picker"

type UnitInfo = { name: string; teamName: string | null; operatingUniverse: string | null; eligible: boolean | null }

/**
 * CAMPO DE ALCANCE (multi-grupo, 223; seletor pesquisável e modos explícitos em 23/11/2026) — o mesmo em Publicações, Alinhamentos,
 * Argumentários, Bases, Agentes, Orquestradores, Workflows, Indicadores e Produtos.
 *
 *  - "Todos" (`value.global`) é uma escolha explícita, com o alcance dito no rótulo (`globalLabel`/`globalDescription`) — vale para os
 *    Grupos e Subgrupos que entrarem depois. Nunca é uma seleção vazia nem "marcar tudo o que está carregado".
 *  - "Grupos e Subgrupos específicos": cada escolha é o Grupo INTEIRO ou UM Subgrupo (com o Grupo-pai junto, resolvido pelo servidor);
 *    escolher um Subgrupo nunca leva os irmãos. Subgrupo de um Grupo já escolhido inteiro fica indisponível ("já incluído").
 *  - As opções vêm do servidor: só Grupo/Subgrupo do universo (`universe`), no escopo de quem edita (`permission`) e com operador em
 *    produção. O que já está salvo e perdeu a elegibilidade continua marcado "Sem operadores em produção" — pode ser salvo ou removido.
 *  - Trocar o universo não apaga nada em silêncio: o que não cabe mais aparece marcado, com aviso e "Remover os que não cabem".
 *    Quem salva recebe a contagem por `onOutsideUniverseChange` e não deixa salvar enquanto houver (o servidor recusa com
 *    422 `SCOPE_UNIT_OUTSIDE_UNIVERSE`).
 */
export function MultiOrgScopeField({
  permission,
  value,
  onChange,
  allowGlobal = false,
  globalLabel = "Todos os Grupos e Subgrupos",
  globalDescription,
  universe,
  disabled = false,
  label = "Alcance",
  hint,
  onOutsideUniverseChange,
}: {
  permission: ScopePickerPermission
  value: ScopeLinksValue
  onChange: (value: ScopeLinksValue) => void
  allowGlobal?: boolean
  globalLabel?: string
  /** O que "Todos" alcança, em linguagem simples (padrão: inclui os criados depois). */
  globalDescription?: string
  universe?: UniverseChoice
  disabled?: boolean
  label?: string
  hint?: string
  /** Quantas escolhas estão fora do universo (0 com "Todos" ou fora do modo específico) — para quem salva bloquear o salvar. */
  onOutsideUniverseChange?: (count: number) => void
  /** Legado: as opções agora vêm do servidor (busca e paginação); ignorado. */
  teams?: readonly ScopeTeamOption[]
}) {
  const id = useId()
  const universes = useMemo(() => (universe ? (typeof universe === "string" ? [universe] : universe.filter((entry) => entry !== "PENDING")) : undefined), [universe])
  const links = useMemo(() => linksFromScopeValue({ ...value, global: false }), [value])
  const teamIds = useMemo(() => [...new Set(links.map((link) => link.teamId))], [links])
  const subteamIds = useMemo(() => links.flatMap((link) => (link.subteamId ? [link.subteamId] : [])), [links])
  // Nomes e elegibilidade do que está escolhido (inclusive o salvo que perdeu a elegibilidade). As opções marcadas agora entram em
  // `known` na hora, para o resumo não piscar "carregando" até a consulta por ids voltar.
  const teamInfo = useScopeUnitsByIds("TEAM", permission, teamIds)
  const subteamInfo = useScopeUnitsByIds("SUBTEAM", permission, subteamIds)
  const [known, setKnown] = useState<Record<string, UnitInfo>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const info = (kind: "TEAM" | "SUBTEAM", unitId: string): UnitInfo | null => {
    const found = (kind === "TEAM" ? teamInfo.data : subteamInfo.data)?.find((item) => item.id === unitId)
    if (found) return { name: found.name, teamName: found.teamName, operatingUniverse: found.operatingUniverse, eligible: found.eligible }
    return known[`${kind}:${unitId}`] ?? null
  }

  const wholeTeams = new Set(value.groups.filter((group) => group.mode === "WHOLE").map((group) => group.teamId))
  const selectedSubteams = new Set(subteamIds)
  const setLinks = (next: readonly ScopeLink[]) => onChange({ ...value, global: false, groups: scopeValueFromLinks(next).groups })

  function toggle(option: ScopeUnitOption) {
    setKnown((current) => ({ ...current, [`${option.kind}:${option.id}`]: { name: option.name, teamName: option.teamName, operatingUniverse: option.operatingUniverse, eligible: option.eligible } }))
    if (option.kind === "TEAM") {
      if (wholeTeams.has(option.id)) return setLinks(links.filter((link) => !(link.teamId === option.id && link.subteamId === null)))
      const replaced = links.filter((link) => link.teamId === option.id && link.subteamId !== null)
      setNotice(replaced.length ? `${option.name} agora vale inteiro: ${replaced.length === 1 ? "o Subgrupo escolhido dele saiu" : `os ${replaced.length} Subgrupos escolhidos dele saíram`} (já estão incluídos).` : null)
      return setLinks([...links.filter((link) => link.teamId !== option.id), { teamId: option.id, subteamId: null }])
    }
    setNotice(null)
    if (selectedSubteams.has(option.id)) return setLinks(links.filter((link) => link.subteamId !== option.id))
    return setLinks([...links, { teamId: option.teamId!, subteamId: option.id }])
  }

  const outside = links.filter((link) => {
    const unit = link.subteamId ? info("SUBTEAM", link.subteamId) : info("TEAM", link.teamId)
    return unit !== null && universes?.length ? !unitFitsUniverse(unit.operatingUniverse, universes) : false
  })
  const outsideCount = value.global ? 0 : outside.length
  useEffect(() => {
    onOutsideUniverseChange?.(outsideCount)
  }, [outsideCount, onOutsideUniverseChange])
  useEffect(() => () => onOutsideUniverseChange?.(0), [onOutsideUniverseChange])
  const issue = value.global ? null : scopeValueIssue(value)?.replace("Escolha ao menos um Grupo.", "Escolha ao menos um Grupo ou Subgrupo.") ?? null
  const loadingNames = teamInfo.isPending && teamIds.length > 0
  // Falha na consulta dos já escolhidos (rede, sessão, limite): avisa em vez de deixar só "fora do seu escopo ou removido" (run-10 QA-06).
  const namesFailed = (teamIds.length > 0 && teamInfo.isError) || (subteamIds.length > 0 && subteamInfo.isError)
  const describe = (link: ScopeLink) => {
    if (link.subteamId) {
      const unit = info("SUBTEAM", link.subteamId)
      return { text: unit ? `${unit.teamName ?? info("TEAM", link.teamId)?.name ?? "Grupo"} › ${unit.name}` : subteamInfo.isPending ? "Subgrupo…" : "Subgrupo fora do seu escopo ou removido", unit }
    }
    const unit = info("TEAM", link.teamId)
    // Fora do escopo de quem edita, a API não devolve nem o nome (run-10 SEA-03).
    return { text: unit ? `${unit.name} (Grupo inteiro)` : loadingNames ? "Grupo…" : "Grupo fora do seu escopo ou removido", unit }
  }
  const summary = value.global ? globalLabel : links.length === 0 ? "Nenhum Grupo ou Subgrupo escolhido" : links.map((link) => describe(link).text).join(" · ")

  return (
    <fieldset className="space-y-3" disabled={disabled} data-testid="multi-org-scope-field">
      <legend className="text-sm font-medium">{label}</legend>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}

      {allowGlobal ? (
        <RadioGroup value={value.global ? "GLOBAL" : "GROUPS"} onValueChange={(mode) => onChange({ ...value, global: mode === "GLOBAL" })} className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr))]" aria-label={`${label}: modo`}>
          <label htmlFor={`${id}-groups`} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-xl border border-border p-3 has-[[data-state=checked]]:border-primary">
            <RadioGroupItem value="GROUPS" id={`${id}-groups`} className="mt-0.5" />
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">Grupos e Subgrupos específicos</span>
              <span className="text-xs text-muted-foreground">Só os que você escolher; Subgrupo escolhido não leva os outros do mesmo Grupo.</span>
            </span>
          </label>
          <label htmlFor={`${id}-global`} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-xl border border-border p-3 has-[[data-state=checked]]:border-primary">
            <RadioGroupItem value="GLOBAL" id={`${id}-global`} className="mt-0.5" />
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{globalLabel}</span>
              <span className="text-xs text-muted-foreground">{globalDescription ?? "Inclui automaticamente os Grupos e Subgrupos que forem criados depois."}</span>
            </span>
          </label>
        </RadioGroup>
      ) : null}

      {!value.global ? (
        <div className="space-y-2">
          <ScopeUnitPicker
            permission={permission}
            universes={universes}
            isSelected={(option) => (option.kind === "TEAM" ? wholeTeams.has(option.id) : selectedSubteams.has(option.id))}
            disabledReason={(option) => (option.kind === "SUBTEAM" && option.teamId && wholeTeams.has(option.teamId) ? `Já incluído: ${option.teamName} está escolhido inteiro` : null)}
            onToggle={toggle}
            disabled={disabled}
          />
          {notice ? <p className="text-xs text-muted-foreground" role="status">{notice}</p> : null}
          {links.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Escolhidos">
              {links.map((link) => {
                const { text, unit } = describe(link)
                const ineligible = unit?.eligible === false
                const out = outside.includes(link)
                return (
                  <li key={`${link.teamId}:${link.subteamId ?? "*"}`}>
                    <Badge variant="secondary" className="gap-1 py-1 pr-1 font-normal">
                      <Users className="size-3" aria-hidden />
                      <span>{text}</span>
                      {ineligible ? <span className="rounded-full bg-amber-500/15 px-1.5 text-[11px] text-amber-800 dark:text-amber-200">Sem operadores em produção</span> : null}
                      {out ? <span className="rounded-full bg-amber-500/15 px-1.5 text-[11px] text-amber-800 dark:text-amber-200">Fora do universo</span> : null}
                      <button type="button" className="rounded-full p-0.5 hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Remover ${text}`} onClick={() => setLinks(links.filter((entry) => entry !== link))} disabled={disabled}>
                        <X className="size-3" aria-hidden />
                      </button>
                    </Badge>
                  </li>
                )
              })}
            </ul>
          ) : null}
          {namesFailed ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status">
              <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-300" aria-hidden />
              <span>Não foi possível conferir os nomes dos Grupos e Subgrupos escolhidos; as escolhas continuam salvas.</span>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => { if (teamInfo.isError) void teamInfo.refetch(); if (subteamInfo.isError) void subteamInfo.refetch() }}>
                <RotateCw className="size-3.5" aria-hidden />Tentar de novo
              </Button>
            </div>
          ) : null}
          {links.some((link) => describe(link).unit?.eligible === false) ? (
            <p className="text-xs text-muted-foreground">Itens “Sem operadores em produção” já estavam salvos e continuam valendo se você mantiver. Removidos, só voltam quando tiverem operador em produção.</p>
          ) : null}
          {outside.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-900 dark:text-amber-100" role="alert">
              <AlertTriangle className="size-4" aria-hidden />
              <span>{outside.length === 1 ? "1 escolha não pertence" : `${outside.length} escolhas não pertencem`} ao universo {universes?.join(", ")} e {outside.length === 1 ? "precisa sair" : "precisam sair"} antes de salvar.</span>
              <Button type="button" size="sm" variant="outline" onClick={() => setLinks(links.filter((link) => !outside.includes(link)))}>Remover os que não cabem</Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="text-sm" role="status" data-testid="scope-reach-summary">
        <span className="text-muted-foreground">Vale para: </span>
        <span className="font-medium">{summary}</span>
      </p>
      {issue ? <p className="text-xs text-amber-700 dark:text-amber-300">{issue}</p> : null}
    </fieldset>
  )
}

/** `Team` da estrutura (Grupos administráveis) → opção do seletor (legado: usado por quem ainda monta a lista de Grupos). */
export function scopeTeamOptionsOf(teams: readonly { id: string; name: string; operatingUniverse?: string | null; subteams?: readonly { id: string; name: string; operatingUniverse?: string | null }[]; selectable?: boolean }[]): ScopeTeamOption[] {
  return teams.map((team) => ({ id: team.id, name: team.name, operatingUniverse: team.operatingUniverse ?? null, selectable: team.selectable, subteams: (team.subteams ?? []).map((subteam) => ({ id: subteam.id, name: subteam.name, operatingUniverse: subteam.operatingUniverse ?? null })) }))
}
