/**
 * VÍNCULOS DE ALCANCE POR GRUPO (multi-grupo, migration 223) — o mesmo conteúdo (base de conhecimento, comunicado, alinhamento
 * operacional, argumentário) vale para vários Grupos num cadastro só. Cada vínculo é um Grupo inteiro (`subteamId` nulo) ou UM Subgrupo
 * daquele Grupo. O backend é a autoridade (Grupo-pai real, duplicata, Subgrupo junto do próprio Grupo inteiro, escopo de quem salva);
 * aqui ficam o valor do seletor, a conversão de/para a API e o resumo do alcance mostrado antes de salvar ou publicar.
 */
export type ScopeLink = { teamId: string; subteamId: string | null }

/** Grupo/Subgrupo como o seletor os oferece (cada tela adapta a resposta da própria API para isto). */
export type ScopeSubteamOption = { id: string; name: string; operatingUniverse?: string | null }
export type ScopeTeamOption = {
  id: string
  name: string
  operatingUniverse?: string | null
  /** O Grupo INTEIRO pode ser escolhido (ex.: está no escopo de quem edita e no universo); senão só Subgrupos dele. */
  selectable?: boolean
  subteams: ScopeSubteamOption[]
}

/** Uma linha do seletor: o Grupo e, se o recorte é por Subgrupo, quais (vazio = Grupo inteiro). */
export type ScopeGroupChoice = { teamId: string; subteamIds: string[]; mode: "WHOLE" | "SUBTEAMS" }
/** Valor do seletor: o escopo global do conteúdo (todos os Grupos, o universo inteiro, a organização) OU os Grupos escolhidos. */
export type ScopeLinksValue = { global: boolean; groups: ScopeGroupChoice[] }

export const EMPTY_SCOPE_VALUE: ScopeLinksValue = { global: false, groups: [] }

/** Vínculos da API → valor do seletor (agrupados por Grupo, na ordem em que aparecem). */
export function scopeValueFromLinks(links: readonly { teamId: string; subteamId: string | null }[], global = false): ScopeLinksValue {
  const groups: ScopeGroupChoice[] = []
  for (const link of links) {
    let group = groups.find((entry) => entry.teamId === link.teamId)
    if (!group) {
      group = { teamId: link.teamId, subteamIds: [], mode: link.subteamId ? "SUBTEAMS" : "WHOLE" }
      groups.push(group)
    }
    if (link.subteamId) {
      group.mode = group.subteamIds.length || group.mode === "SUBTEAMS" ? "SUBTEAMS" : group.mode
      if (!group.subteamIds.includes(link.subteamId)) group.subteamIds.push(link.subteamId)
    }
  }
  return { global, groups }
}

/** Valor do seletor → vínculos para a API (Grupo inteiro = um vínculo sem Subgrupo; recorte = um por Subgrupo marcado). */
export function linksFromScopeValue(value: ScopeLinksValue): ScopeLink[] {
  if (value.global) return []
  return value.groups.flatMap((group): ScopeLink[] => (group.mode === "WHOLE" ? [{ teamId: group.teamId, subteamId: null }] : group.subteamIds.map((subteamId) => ({ teamId: group.teamId, subteamId }))))
}

/** O que falta para salvar (null = completo). Grupo com recorte por Subgrupo precisa de ao menos um Subgrupo marcado. */
export function scopeValueIssue(value: ScopeLinksValue): string | null {
  if (value.global) return null
  if (value.groups.length === 0) return "Escolha ao menos um Grupo."
  const incomplete = value.groups.find((group) => group.mode === "SUBTEAMS" && group.subteamIds.length === 0)
  return incomplete ? "Marque ao menos um Subgrupo em cada Grupo com recorte por Subgrupo (ou escolha o Grupo inteiro)." : null
}

/** Chave estável do alcance (para saber se mudou). */
export const scopeValueKey = (value: ScopeLinksValue) =>
  value.global ? "GLOBAL" : linksFromScopeValue(value).map((link) => `${link.teamId}:${link.subteamId ?? "*"}`).sort().join("|")

/**
 * Resumo do alcance em linguagem simples (mostrado antes de salvar/publicar): "Grupo A (inteiro) · Grupo B: só B1, B3". `globalLabel` é
 * o nome do escopo global daquele conteúdo ("Todos os grupos", "Todo o universo B2C", "Toda a organização").
 */
export function scopeReachSummary(value: ScopeLinksValue, teams: readonly ScopeTeamOption[], globalLabel: string): string {
  if (value.global) return globalLabel
  if (value.groups.length === 0) return "Nenhum Grupo escolhido"
  return value.groups
    .map((group) => {
      const team = teams.find((candidate) => candidate.id === group.teamId)
      const teamName = team?.name ?? "Grupo não encontrado"
      if (group.mode === "WHOLE") return `${teamName} (Grupo inteiro)`
      const names = group.subteamIds.map((id) => team?.subteams.find((subteam) => subteam.id === id)?.name ?? "Subgrupo não encontrado")
      return names.length ? `${teamName}: só ${names.join(", ")}` : `${teamName}: nenhum Subgrupo marcado`
    })
    .join(" · ")
}

/** Texto de vínculos já salvos (listas e detalhes), com os nomes que a API devolve. */
export function linksLabel(links: readonly { teamId: string; teamName?: string | null; subteamId: string | null; subteamName?: string | null }[]): string {
  if (links.length === 0) return "Nenhum Grupo"
  const value = scopeValueFromLinks(links)
  return value.groups
    .map((group) => {
      const teamName = links.find((link) => link.teamId === group.teamId)?.teamName ?? "Grupo"
      if (group.mode === "WHOLE") return teamName
      const names = group.subteamIds.map((id) => links.find((link) => link.subteamId === id)?.subteamName ?? "Subgrupo")
      return `${teamName} › ${names.join(", ")}`
    })
    .join(" · ")
}

/** Alcance da Base de Conhecimento na API (`orgScopes`): ALL_TEAMS sozinho, ou um TEAM/SUBTEAM por vínculo. */
export type OrgScopeEntry = { scopeType: "ALL_TEAMS" | "TEAM" | "SUBTEAM"; teamId?: string; subteamId?: string }

export function orgScopesFromValue(value: ScopeLinksValue): OrgScopeEntry[] {
  if (value.global) return [{ scopeType: "ALL_TEAMS" }]
  return linksFromScopeValue(value).map((link) => (link.subteamId ? { scopeType: "SUBTEAM", teamId: link.teamId, subteamId: link.subteamId } : { scopeType: "TEAM", teamId: link.teamId }))
}

/** `orgScopes` salvos (todos, nunca só o primeiro) → valor do seletor. Subgrupo antigo sem Grupo procura o pai nos Grupos conhecidos. */
export function scopeValueFromOrgScopes(orgScopes: readonly { scopeType: string; teamId?: string | null; subteamId?: string | null }[], teams: readonly ScopeTeamOption[] = []): ScopeLinksValue {
  if (orgScopes.some((scope) => scope.scopeType === "ALL_TEAMS")) return { global: true, groups: [] }
  const links = orgScopes.flatMap((scope) => {
    const teamId = scope.teamId ?? teams.find((team) => team.subteams.some((subteam) => subteam.id === scope.subteamId))?.id ?? null
    if (!teamId) return []
    return [{ teamId, subteamId: scope.scopeType === "SUBTEAM" ? (scope.subteamId ?? null) : null }]
  })
  return scopeValueFromLinks(links)
}

/**
 * Trocar o universo do conteúdo: some o Grupo que não tem mais nada no universo novo; Subgrupos fora dele saem do recorte; Grupo inteiro
 * que deixou de caber, mas tem Subgrupo do universo, passa a "só alguns Subgrupos" (a pessoa marca quais). Sem universo = nada muda.
 */
export function scopeValueAfterUniverseChange(value: ScopeLinksValue, teams: readonly ScopeTeamOption[] | undefined, fits: (unitUniverse: string | null | undefined) => boolean): ScopeLinksValue {
  if (!teams || value.global) return value
  const groups = value.groups.flatMap((group): ScopeGroupChoice[] => {
    const team = teams.find((candidate) => candidate.id === group.teamId)
    if (!team) return [group]
    const subteamsFitting = team.subteams.filter((subteam) => fits(subteam.operatingUniverse ?? team.operatingUniverse))
    const teamFits = team.selectable !== false && fits(team.operatingUniverse)
    if (!teamFits && subteamsFitting.length === 0) return []
    if (group.mode === "WHOLE") return [teamFits ? group : { teamId: group.teamId, mode: "SUBTEAMS", subteamIds: [] }]
    return [{ ...group, subteamIds: group.subteamIds.filter((id) => subteamsFitting.some((subteam) => subteam.id === id)) }]
  })
  return { ...value, groups }
}

/**
 * Alcance de Agente/Orquestrador/Workflow/Indicador/Produto (249/250): `ALL_TEAMS` ("Todos os Grupos e Subgrupos" do universo do
 * registro, inclusive os criados depois) ou `GROUPS` com `scopeLinks`. Formato antigo (TEAM/SUBTEAM + ids) ainda chega de rascunhos e
 * snapshots: vira um vínculo com o mesmo alcance.
 */
export type ResourceScopePayload = { scopeType: "ALL_TEAMS" | "GROUPS"; scopeLinks: ScopeLink[] }
export type ResourceScopeLike = { scopeType?: string | null; teamId?: string | null; subteamId?: string | null; scopeLinks?: readonly { teamId: string; subteamId: string | null }[] | null }

export function scopeValueFromResource(resource: ResourceScopeLike | null | undefined, parentOf?: (subteamId: string) => string | null | undefined): ScopeLinksValue {
  if (!resource || resource.scopeType === "ALL_TEAMS") return { global: true, groups: [] }
  if (resource.scopeType === "TEAM") return scopeValueFromLinks(resource.teamId ? [{ teamId: resource.teamId, subteamId: null }] : [])
  if (resource.scopeType === "SUBTEAM") {
    const teamId = resource.teamId ?? (resource.subteamId ? parentOf?.(resource.subteamId) : null) ?? null
    return scopeValueFromLinks(teamId && resource.subteamId ? [{ teamId, subteamId: resource.subteamId }] : [])
  }
  return scopeValueFromLinks(resource.scopeLinks ?? [])
}

export function resourceScopePayloadOf(value: ScopeLinksValue): ResourceScopePayload {
  return value.global ? { scopeType: "ALL_TEAMS", scopeLinks: [] } : { scopeType: "GROUPS", scopeLinks: linksFromScopeValue(value) }
}

/** Texto curto do alcance de um recurso (listas e cartões). */
export function resourceScopeLabel(resource: { scopeType: string; scopeLinks?: readonly { teamId: string; teamName?: string | null; subteamId: string | null; subteamName?: string | null }[] | null; teamName?: string | null; subteamName?: string | null }, allLabel = "Todos os Grupos"): string {
  if (resource.scopeType === "ALL_TEAMS") return allLabel
  if (resource.scopeType === "TEAM") return resource.teamName ?? "Grupo"
  if (resource.scopeType === "SUBTEAM") return resource.subteamName ?? "Subgrupo"
  return linksLabel(resource.scopeLinks ?? [])
}
