import type { AnalyticsContext } from "@/schemas/analytics/analytics.schema"

/*
 * Saída da ficha do colaborador (`/supervisor/operators/[operatorId]`), aberta ou indisponível. Sem "use client": a
 * ficha (cliente) e a página (Server Component, que monta o estado 403/404/erro) usam a MESMA regra, e a página passa
 * ao componente cliente só as strings que ela devolve.
 */

export type ProfileBackLink = { href: string; label: string }

/** Gestores têm a aba de pessoas; quem está fora da hierarquia (ex.: o Administrador geral do `setup`) não. Sem contexto
 * (falha ao carregar), tratado como antes. */
function exitsThroughPeopleTab(context: AnalyticsContext | null): boolean {
  return !context || context.capabilities.tabs.includes("PEOPLE")
}

/**
 * Quem tem a aba de pessoas volta para ela. Quem não tem cairia em Acompanhamentos com "sem estrutura vinculada"; volta ao
 * Organograma do próprio perfil — já na pessoa visitada, quando há uma, de onde navega pela empresa toda.
 */
export function backLinkFor(context: AnalyticsContext | null, personId?: string): ProfileBackLink {
  if (exitsThroughPeopleTab(context)) return { href: "/supervisor?tab=people", label: "Voltar para a equipe" }
  const params = new URLSearchParams({ tab: "structure" })
  if (personId) params.set("structurePersonId", personId)
  return { href: `/supervisor?${params.toString()}`, label: "Voltar para o organograma" }
}

/** Por que a ficha recusou (403). Quem está fora da hierarquia não tem estrutura: abre colaboradores pelo escopo do acesso. */
export function forbiddenDescriptionFor(context: AnalyticsContext | null): string {
  if (exitsThroughPeopleTab(context)) return "Você só pode abrir pessoas que fazem parte da sua estrutura."
  return "Você só pode abrir colaboradores ativos do seu escopo."
}
