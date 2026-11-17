/**
 * VÍNCULOS DE ALCANCE POR GRUPO (17/11/2026) — um mesmo conteúdo (base de conhecimento, comunicado, alinhamento operacional,
 * argumentário) atende VÁRIOS Grupos com um único cadastro. Cada vínculo aponta para exatamente um Grupo e, quando o conteúdo tem
 * recorte por Subgrupo, para UM Subgrupo daquele Grupo:
 *
 *   { teamId: A, subteamId: null }  → o Grupo A inteiro (todos os Subgrupos dele — o mesmo significado que a INIA já dava a TEAM);
 *   { teamId: B, subteamId: B1 }    → só o Subgrupo B1 do Grupo B.
 *
 * Quem está em A (qualquer Subgrupo) ou em B1 é alcançado; quem está em B2 ou num terceiro Grupo não é. O escopo "global" de cada
 * conteúdo (todos os Grupos, o universo inteiro, a organização) NÃO é um vínculo: continua sendo um atributo do próprio conteúdo, com a
 * regra que ele já tinha. Ausência de vínculo nunca vira acesso global.
 *
 * Multi-grupo, por si só, não concede nada além do Grupo/Subgrupo: universo de atuação, produto, permissões e as demais regras de cada
 * conteúdo continuam sendo aplicadas por cima (AND), pelos mesmos pontos de antes.
 *
 * Este arquivo é puro (sem banco). O Grupo-pai REAL de cada Subgrupo é resolvido no servidor (`normalizeScopeLinks`, auth) antes de
 * chegar aqui: nunca se confia no `teamId` enviado pelo navegador para um Subgrupo.
 */
export type ScopeLink = { teamId: string; subteamId: string | null }

/** Posição da pessoa na estrutura (o cadastro atual, como as regras de cada conteúdo já usavam). */
export type ScopePosition = { teamId: string | null; subteamId: string | null }

export type ScopeLinkProblem =
  | { code: "DUPLICATE"; link: ScopeLink }
  /** Grupo inteiro e um Subgrupo dele no mesmo conteúdo: o Subgrupo não acrescenta nada e esconderia a intenção. */
  | { code: "REDUNDANT_SUBTEAM"; link: ScopeLink }

export const linkKey = (link: ScopeLink) => `${link.teamId}:${link.subteamId ?? "*"}`

/** Ordem estável (Grupo, depois Grupo inteiro antes dos Subgrupos) — a mesma em hash, auditoria e resposta da API. */
export function sortLinks(links: readonly ScopeLink[]): ScopeLink[] {
  return [...links].sort((a, b) => (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : (a.subteamId ?? "") < (b.subteamId ?? "") ? -1 : (a.subteamId ?? "") > (b.subteamId ?? "") ? 1 : 0))
}

/** Problemas de um conjunto de vínculos (duplicado; Subgrupo de um Grupo que já está inteiro). Vazio = válido. */
export function scopeLinkProblems(links: readonly ScopeLink[]): ScopeLinkProblem[] {
  const problems: ScopeLinkProblem[] = []
  const seen = new Set<string>()
  const wholeTeams = new Set(links.filter((link) => link.subteamId === null).map((link) => link.teamId))
  for (const link of links) {
    const key = linkKey(link)
    if (seen.has(key)) problems.push({ code: "DUPLICATE", link })
    else if (link.subteamId !== null && wholeTeams.has(link.teamId)) problems.push({ code: "REDUNDANT_SUBTEAM", link })
    seen.add(key)
  }
  return problems
}

/** O vínculo alcança a pessoa? Grupo inteiro = qualquer pessoa do Grupo; Subgrupo = só quem está nele. */
export function linkReaches(link: ScopeLink, position: ScopePosition): boolean {
  if (link.subteamId !== null) return position.subteamId !== null && position.subteamId === link.subteamId
  return position.teamId !== null && position.teamId === link.teamId
}

export const linksReach = (links: readonly ScopeLink[], position: ScopePosition) => links.some((link) => linkReaches(link, position))

/**
 * Especificidade do vínculo QUE ALCANÇA a pessoa (2 = Subgrupo, 1 = Grupo inteiro; null = nenhum alcança). Com vários vínculos, a
 * precedência entre conteúdos (ex.: alinhamentos do mesmo ponto) é decidida por ESTE valor — o recorte que vale para aquela pessoa —
 * e nunca pelo "tipo" do conteúdo, que deixou de ser único.
 */
export function reachingSpecificity(links: readonly ScopeLink[], position: ScopePosition): 1 | 2 | null {
  if (links.some((link) => link.subteamId !== null && linkReaches(link, position))) return 2
  if (links.some((link) => link.subteamId === null && linkReaches(link, position))) return 1
  return null
}

/** Dois conjuntos de vínculos alcançam alguém em comum? (Grupo inteiro cruza com os Subgrupos dele.) */
export function linksOverlap(a: readonly ScopeLink[], b: readonly ScopeLink[]): boolean {
  return a.some((left) => b.some((right) => left.teamId === right.teamId && (left.subteamId === null || right.subteamId === null || left.subteamId === right.subteamId)))
}

/**
 * Vínculos IDÊNTICOS entre dois conjuntos: é onde dois conteúdos do mesmo ponto teriam o MESMO recorte para as mesmas pessoas (nenhum
 * dos dois mais específico). Grupo inteiro × Subgrupo do mesmo Grupo não é idêntico: no Subgrupo o recorte dele é mais específico.
 */
export function sharedLinks(a: readonly ScopeLink[], b: readonly ScopeLink[]): ScopeLink[] {
  const keys = new Set(b.map(linkKey))
  return a.filter((link) => keys.has(linkKey(link)))
}

/** Grupos alcançados (para filtro, contagem por Grupo e o Grupo exibido): cada um uma vez. */
export const teamIdsOf = (links: readonly ScopeLink[]) => [...new Set(links.map((link) => link.teamId))]
