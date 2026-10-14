import { AnalyticsCache } from "../infrastructure/analytics-cache.js"
import { isUncommittedVersion } from "../infrastructure/analytics-versions.js"
import type { AnalyticsReadRepository } from "./analytics-read-repository.js"
import type { ViewerScope } from "./viewer-scope.js"

/**
 * Cache da CAMADA OFICIAL do analytics da liderança (fechamento mensal: atingimento, quartil, PRV — sempre os valores
 * persistidos, nunca recalculados). Guarda o que os builders DERIVAM do dataset oficial de uma estrutura (desempenho por
 * membro, consolidados, linhas de um indicador), para que paginar, ordenar ou buscar em `/team/members` e
 * `/indicators/:code/members` não recarregue as ~476 mil linhas de um diretor a cada clique.
 *
 * A chave tem tudo de que o resultado depende: versões STRUCTURE e OFFICIAL da organização (migrations 128 e 141, subidas por
 * trigger no commit), quem vê (pessoa, conta, cargo, escopo de acesso — o escopo é função disso + estrutura), o sujeito, a
 * competência e a parte pedida. Contagens de acompanhamento e de pendências NÃO entram aqui: mudam o tempo todo e são
 * lidas a cada request. O valor guardado é compartilhado: quem lê copia antes de ordenar.
 * Peso = membros da estrutura (orçamento de 60 mil membros por processo).
 */
const officialCache = new AnalyticsCache<unknown>(300, 10 * 60_000, 60_000)

export async function cachedOfficial<T>(repository: AnalyticsReadRepository, scope: ViewerScope, parts: unknown[], weight: number, compute: () => Promise<T>): Promise<T> {
  const versions = await repository.loadCacheVersions?.(scope.organizationId)
  // Sem cache, ou com escrita pendente nesta transação (analytics-versions.ts): calcula sem guardar.
  if (!versions || isUncommittedVersion(versions.STRUCTURE) || isUncommittedVersion(versions.OFFICIAL)) return compute()
  const key = JSON.stringify(["official", scope.organizationId, versions.STRUCTURE, versions.OFFICIAL, scope.viewer.id, scope.accountId, scope.role, scope.access, ...parts])
  return officialCache.getOrCompute(key, compute, undefined, Math.max(1, weight)) as Promise<T>
}

export function clearOfficialAnalyticsCache(): void {
  officialCache.clear()
}
