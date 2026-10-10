/**
 * SIGLAS NA PERGUNTA (dados do Glossário geral, nunca lista no código). O operador escreve/fala "PJ", "TT", "ME"; a base
 * escreve "pessoa jurídica", "troca de titularidade", "mudança de endereço". A busca procura as duas formas: a sigla como
 * termo próprio e a definição do glossário acrescentada à consulta.
 *
 * Só conta a sigla escrita em MAIÚSCULAS e como palavra inteira: "ME" (Mudança de Endereço) nunca casa com o pronome "me",
 * nem "TT" com um pedaço de outra palavra.
 */
export type GlossaryAcronym = { acronym: string; definition: string }
export type AcronymExpansion = { acronym: string; definition: string }

/** Parte da definição usada na busca: a primeira oração, sem explicações longas. */
export function definitionForSearch(definition: string): string {
  return definition.split(/[.;:\n(]/)[0]!.trim().slice(0, 80)
}

export function expandAcronyms(query: string, glossary: readonly GlossaryAcronym[]): { searchQuery: string; expansions: AcronymExpansion[] } {
  const expansions: AcronymExpansion[] = []
  for (const entry of glossary) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9])${entry.acronym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`)
    if (pattern.test(query) && !expansions.some((expansion) => expansion.acronym === entry.acronym)) expansions.push({ acronym: entry.acronym, definition: definitionForSearch(entry.definition) })
  }
  if (expansions.length === 0) return { searchQuery: query, expansions }
  return { searchQuery: `${query} ${expansions.map((expansion) => expansion.definition).join(" ")}`, expansions }
}

/** Linha para o prompt do especialista: o que cada sigla da pergunta significa (a resposta usa o nome por extenso). */
export function renderAcronymContext(expansions: readonly AcronymExpansion[]): string {
  if (expansions.length === 0) return ""
  return `Siglas usadas na pergunta (Glossário da organização): ${expansions.map((expansion) => `${expansion.acronym} = ${expansion.definition}`).join("; ")}.`
}
