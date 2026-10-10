import type { OrganizationalHierarchyReader, OrganizationalPerson } from "../application/organizational-recipient.js"

export type InMemoryPerson = Omit<OrganizationalPerson, "jobTitle" | "avatarUrl"> & { jobTitle?: string | null; avatarUrl?: string | null; teamId?: string | null; subteamId?: string | null; active?: boolean }

/**
 * Leitor de hierarquia em memória — mesma semântica do leitor Postgres (só pessoas ativas; cadeia
 * acima da mais próxima à mais distante; subárvore inteira; membros operadores por Grupo/
 * Subgrupo). Usado pelos testes do resolvedor de destinatário e pelo teste de catálogo, que
 * regenera a estrutura da massa demo em memória (nunca precisa de banco).
 */
export function inMemoryHierarchyReader(people: InMemoryPerson[]): OrganizationalHierarchyReader {
  const byId = new Map(people.map((person) => [person.id, person]))
  const isActive = (person: InMemoryPerson) => person.active !== false
  const strip = (person: InMemoryPerson): OrganizationalPerson => ({ id: person.id, name: person.name, role: person.role, reportsToId: person.reportsToId, jobTitle: person.jobTitle ?? null, avatarUrl: person.avatarUrl ?? null })

  return {
    async loadPerson(personId) {
      const person = byId.get(personId)
      return person && isActive(person) ? strip(person) : null
    },
    async loadAncestors(personId) {
      const chain: OrganizationalPerson[] = []
      const visited = new Set<string>([personId])
      let current = byId.get(personId)?.reportsToId ?? null
      while (current && !visited.has(current)) {
        visited.add(current)
        const person = byId.get(current)
        if (!person) break
        if (isActive(person)) chain.push(strip(person))
        current = person.reportsToId
      }
      return chain
    },
    async loadDescendants(personId) {
      const result: OrganizationalPerson[] = []
      const frontier = [personId]
      const visited = new Set<string>([personId])
      while (frontier.length > 0) {
        const parentId = frontier.shift()!
        for (const person of people) {
          if (person.reportsToId !== parentId || visited.has(person.id)) continue
          visited.add(person.id)
          if (isActive(person)) result.push(strip(person))
          frontier.push(person.id)
        }
      }
      return result
    },
    async countActiveOperators(personId, depth) {
      const descendants = await this.loadDescendants(personId)
      return descendants.filter((person) => person.role === "OPERATOR" && (depth === "ANY" || person.reportsToId === personId)).length
    },
    async loadGroupOperators(group) {
      return people
        .filter((person) => person.role === "OPERATOR" && isActive(person))
        .filter((person) => ("teamId" in group ? person.teamId === group.teamId : person.subteamId === group.subteamId))
        .map(strip)
    },
  }
}
