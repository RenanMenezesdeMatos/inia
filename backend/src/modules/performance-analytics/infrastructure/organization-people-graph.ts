import type { Database } from "../../../infrastructure/database/pool.js"
import type { PersonNode } from "../application/analytics-read-repository.js"
import { isUncommittedVersion, loadAnalyticsVersion } from "./analytics-versions.js"

/**
 * GRAFO DE PESSOAS DA ORGANIZAÇÃO em memória — a base do escopo de quem está logado (viewer-scope.ts), do organograma e
 * da Equipe, no lugar de refazer a árvore recursiva a cada request. Uma consulta carrega todas as pessoas da organização
 * (ativas ou não, a mesma projeção de `PersonNode`) em ORDEM DE NOME (collation do banco) com desempate por id; subárvore,
 * pessoas cobertas por uma visibilidade de acesso e subordinados diretos são derivados daqui, na mesma ordem.
 *
 * A chave do cache é a versão STRUCTURE da organização (migrations 128 e 141): lida ANTES das pessoas — um grafo nunca é guardado
 * sob uma versão mais nova do que os dados que ele tem. Objetos do grafo são compartilhados entre requests: quem os usa só
 * lê (listas devolvidas são cópias).
 */
export type OrganizationPeopleGraph = {
  organizationId: string
  version: string
  /** Todas as pessoas da organização, por nome e id. */
  people: readonly PersonNode[]
  byId: ReadonlyMap<string, PersonNode>
  /** Subordinados diretos (ativos ou não) por id do gestor, na ordem de `people`. */
  childrenOf: ReadonlyMap<string, readonly PersonNode[]>
}

export const PERSON_NODE_SELECT = `p.id, p.name, p.role, p.reports_to_id "reportsToId", p.team_id "teamId", t.name "teamName",
       p.subteam_id "subteamId", st.name "subteamName", p.avatar_url "avatarUrl", p.job_title "jobTitle", p.operational_capital_code "operationalCapitalCode", p.active`
export const PERSON_NODE_JOINS = `left join teams t on t.id = p.team_id left join subteams st on st.id = p.subteam_id`

async function loadGraph(db: Pick<Database, "query">, organizationId: string, version: string): Promise<OrganizationPeopleGraph> {
  const result = await db.query<PersonNode>(`select ${PERSON_NODE_SELECT} from people p ${PERSON_NODE_JOINS} where p.organization_id = $1 order by p.name, p.id`, [organizationId])
  const people = result.rows
  const byId = new Map(people.map((person) => [person.id, person]))
  const childrenOf = new Map<string, PersonNode[]>()
  for (const person of people) {
    if (!person.reportsToId) continue
    const siblings = childrenOf.get(person.reportsToId) ?? []
    siblings.push(person)
    childrenOf.set(person.reportsToId, siblings)
  }
  return { organizationId, version, people, byId, childrenOf }
}

/** Descendentes (ativos ou não) em qualquer profundidade, sem a própria pessoa — salvo se um CICLO a alcança, como a CTE
 * recursiva com `union` fazia. Termina com ciclo; ordem de `people`. */
export function descendantsOf(graph: OrganizationPeopleGraph, anchorId: string): PersonNode[] {
  const seen = new Set<string>()
  const stack = [...(graph.childrenOf.get(anchorId) ?? [])]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (seen.has(node.id)) continue
    seen.add(node.id)
    stack.push(...(graph.childrenOf.get(node.id) ?? []))
  }
  return graph.people.filter((person) => seen.has(person.id))
}

export class OrganizationPeopleGraphCache {
  private readonly entries = new Map<string, { version: string; graph: Promise<OrganizationPeopleGraph> }>()

  constructor(private readonly maxOrganizations = 8) {}

  async get(db: Pick<Database, "query">, organizationId: string): Promise<OrganizationPeopleGraph> {
    const version = await loadAnalyticsVersion(db, organizationId, "STRUCTURE")
    // Escrita pendente nesta transação: carrega sem guardar nem trocar o grafo dos outros (analytics-versions.ts).
    if (isUncommittedVersion(version)) return loadGraph(db, organizationId, version)
    const cached = this.entries.get(organizationId)
    if (cached && cached.version === version) {
      // LRU: a organização usada por último vai para o fim.
      this.entries.delete(organizationId)
      this.entries.set(organizationId, cached)
      return cached.graph
    }
    const graph = loadGraph(db, organizationId, version)
    this.entries.delete(organizationId)
    this.entries.set(organizationId, { version, graph })
    while (this.entries.size > this.maxOrganizations) this.entries.delete(this.entries.keys().next().value!)
    // Falha ao carregar não fica no cache: a próxima chamada tenta de novo.
    graph.catch(() => {
      if (this.entries.get(organizationId)?.graph === graph) this.entries.delete(organizationId)
    })
    return graph
  }

  clear(): void {
    this.entries.clear()
  }
}

/** Um cache por processo (API ou worker). */
export const organizationPeopleGraphCache = new OrganizationPeopleGraphCache()

/**
 * O grafo de UMA leitura em lote (ex.: os destinatários de uma execução de report): a versão é conferida na primeira leitura
 * de cada organização, pelo cache do processo, e o mesmo grafo serve o lote inteiro — um retrato só, sem uma consulta de
 * versão por pessoa. Vive só durante o lote; nunca substitui o cache do processo.
 */
export class PinnedPeopleGraphCache extends OrganizationPeopleGraphCache {
  private readonly pinned = new Map<string, Promise<OrganizationPeopleGraph>>()

  constructor(private readonly source: OrganizationPeopleGraphCache = organizationPeopleGraphCache) {
    super(1)
  }

  override get(db: Pick<Database, "query">, organizationId: string): Promise<OrganizationPeopleGraph> {
    const cached = this.pinned.get(organizationId)
    if (cached) return cached
    const graph = this.source.get(db, organizationId)
    this.pinned.set(organizationId, graph)
    graph.catch(() => {
      if (this.pinned.get(organizationId) === graph) this.pinned.delete(organizationId)
    })
    return graph
  }
}
