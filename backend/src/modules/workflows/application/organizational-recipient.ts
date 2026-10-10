import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { EscalationRole } from "../domain/escalation-role-schema.js"
import { structureAnchorPersonId, type StructureAnchor } from "../domain/structure-anchor-schema.js"

/**
 * Resolução DETERMINÍSTICA de um destinatário de gestão (Supervisor/Coordenador/Gerente/Gerente
 * Sênior/Diretor) a partir de uma ESTRUTURA — o caso do Output depois de "Consolidar resultados"
 * (ou em contexto de estrutura, sem fan-out), onde não existe "o operador atual" pra subir a
 * cadeia dele.
 *
 * Regra fundamental (rodada de hardening 2026-09-16, Parte A): NUNCA escolher "um membro
 * qualquer" da estrutura e subir a hierarquia dele. Antes desta rodada, um Workflow ancorado em
 * Grupo/Subgrupo usava o operador de menor UUID como sujeito técnico da matrícula e o Output
 * herdava a cadeia dele — um Grupo com 2 Gerentes entregava pra um deles por acaso da ordenação.
 *
 * Como resolve:
 * - Estrutura ancorada em PESSOA (Equipe de Supervisor, Estrutura de Coordenador/Gerente/Gerente
 *   Sênior/Diretor): se a própria âncora tem o cargo pedido, é ela; senão os candidatos são os
 *   ancestrais (cadeia `reports_to_id`, sempre linear → no máximo 1) e os descendentes com aquele
 *   cargo (um Output "Supervisor" numa Estrutura de Diretor tem 80 candidatos → ambíguo, nunca
 *   "nenhum" silencioso como era antes).
 * - GRUPO/SUBGRUPO (sem pessoa-âncora): candidatos = ancestrais, com o cargo pedido, de TODOS os
 *   operadores membros — a hierarquia real, não um responsável inventado (Grupo/Subgrupo não têm
 *   `owner_id`/`manager_id` hoje; se um dia tiverem, entra aqui como fonte adicional, não como
 *   substituto da hierarquia).
 * - Exatamente 1 candidato → resolvido. 0 → NOT_FOUND. 2+ → AMBIGUOUS. Nunca "o primeiro".
 *
 * A MESMA função é usada pela validação de publicação (dry-run detecta ambiguidade com a estrutura
 * configurada hoje), pelo runtime (a estrutura pode ter mudado depois da publicação — revalida
 * sempre, nunca confia só no snapshot) e pelo QA Lab (mesmo executor; o trace mostra o
 * destinatário resolvido ou o motivo de não resolver).
 */
export type OrganizationalPerson = {
  id: string
  name: string
  role: string
  reportsToId: string | null
  /** Apresentação (aba Estrutura do perfil): cargo e avatar — nunca entram na decisão de destinatário. */
  jobTitle: string | null
  avatarUrl: string | null
}

/** Leitura da hierarquia — port pequeno pra a regra acima ser testável em memória (testes
 * unitários e teste de catálogo sobre a estrutura demo regenerada) e executada em Postgres com
 * CTEs (uma ida ao banco por consulta, nunca N queries por membro). */
export type OrganizationalHierarchyReader = {
  loadPerson(personId: string): Promise<OrganizationalPerson | null>
  /** Cadeia de gestão ACIMA da pessoa (não inclui ela), da mais próxima à mais distante. */
  loadAncestors(personId: string): Promise<OrganizationalPerson[]>
  /** Toda a subárvore ABAIXO da pessoa (não inclui ela), qualquer profundidade. */
  loadDescendants(personId: string): Promise<OrganizationalPerson[]>
  /** Operadores membros de um Grupo/Subgrupo (`team_id`/`subteam_id`). */
  loadGroupOperators(group: { teamId: string } | { subteamId: string }): Promise<OrganizationalPerson[]>
  /** População de uma estrutura por CONTAGEM (nunca carrega a subárvore só pra contar): operadores
   * ativos que reportam diretamente à pessoa (`DIRECT`, Equipe de Supervisor) ou em qualquer
   * profundidade (`ANY`, demais estruturas) — a mesma semântica de `loadDescendants` filtrado. */
  countActiveOperators(personId: string, depth: "DIRECT" | "ANY"): Promise<number>
}

export type RecipientResolution =
  | { status: "RESOLVED"; person: OrganizationalPerson }
  | { status: "NOT_FOUND"; role: EscalationRole }
  | { status: "AMBIGUOUS"; role: EscalationRole; candidates: OrganizationalPerson[] }

export const ROLE_LABELS: Record<EscalationRole, string> = {
  COORDINATOR: "Coordenador",
  SUPERVISOR: "Supervisor",
  MANAGER: "Gerente",
  SENIOR_MANAGER: "Gerente Sênior",
  DIRECTOR: "Diretor",
}

function uniqueById(people: OrganizationalPerson[]): OrganizationalPerson[] {
  const byId = new Map<string, OrganizationalPerson>()
  for (const person of people) if (!byId.has(person.id)) byId.set(person.id, person)
  // Ordem estável por nome só pra mensagem/trace serem determinísticos — NUNCA pra "escolher o
  // primeiro" (com 2+ candidatos o resultado é AMBIGUOUS, não o primeiro da lista).
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id))
}

function decide(role: EscalationRole, candidates: OrganizationalPerson[]): RecipientResolution {
  const unique = uniqueById(candidates)
  if (unique.length === 1) return { status: "RESOLVED", person: unique[0]! }
  if (unique.length === 0) return { status: "NOT_FOUND", role }
  return { status: "AMBIGUOUS", role, candidates: unique }
}

export async function resolveStructureRecipient(reader: OrganizationalHierarchyReader, structure: StructureAnchor, role: EscalationRole): Promise<RecipientResolution> {
  const anchorId = structureAnchorPersonId(structure)
  if (anchorId) {
    const anchor = await reader.loadPerson(anchorId)
    if (!anchor) return { status: "NOT_FOUND", role }
    if (anchor.role === role) return { status: "RESOLVED", person: anchor }
    const ancestors = (await reader.loadAncestors(anchorId)).filter((person) => person.role === role)
    // Cadeia acima é linear: se achou, é único e inequívoco — não precisa olhar pra baixo.
    if (ancestors.length > 0) return decide(role, ancestors)
    const descendants = (await reader.loadDescendants(anchorId)).filter((person) => person.role === role)
    return decide(role, descendants)
  }

  if (structure.kind !== "TEAM" && structure.kind !== "SUBTEAM") return { status: "NOT_FOUND", role }
  const operators = await reader.loadGroupOperators(structure.kind === "TEAM" ? { teamId: structure.teamId } : { subteamId: structure.subteamId })
  const candidates: OrganizationalPerson[] = []
  const visitedChains = new Set<string>()
  for (const operator of operators) {
    // Ancestrais de um operador já visitado (mesmo gestor direto) são os mesmos — não repete.
    if (operator.reportsToId && visitedChains.has(operator.reportsToId)) continue
    if (operator.reportsToId) visitedChains.add(operator.reportsToId)
    for (const ancestor of await reader.loadAncestors(operator.id)) if (ancestor.role === role) candidates.push(ancestor)
  }
  return decide(role, candidates)
}

/** Mensagens de negócio — as mesmas no publish (DomainError 422), no runtime (falha do node,
 * nunca descarte silencioso) e no QA Lab (motivo visível no trace). */
export function describeUnresolvedRecipient(resolution: Exclude<RecipientResolution, { status: "RESOLVED" }>): string {
  const roleLabel = ROLE_LABELS[resolution.role]
  if (resolution.status === "NOT_FOUND") return `Não foi possível determinar um ${roleLabel} responsável por esta estrutura.`
  const names = resolution.candidates.map((person) => person.name).join(", ")
  return `Esta estrutura possui mais de um ${roleLabel} possível (${resolution.candidates.length}: ${names}). Escolha um destinatário compatível ou uma estrutura com responsável inequívoco.`
}

export function unresolvedRecipientCode(resolution: Exclude<RecipientResolution, { status: "RESOLVED" }>): "WORKFLOW_OUTPUT_RECIPIENT_NOT_FOUND" | "WORKFLOW_OUTPUT_RECIPIENT_AMBIGUOUS" {
  return resolution.status === "NOT_FOUND" ? "WORKFLOW_OUTPUT_RECIPIENT_NOT_FOUND" : "WORKFLOW_OUTPUT_RECIPIENT_AMBIGUOUS"
}

/** Resolve ou lança `DomainError` (422) com código/mensagem de negócio — atalho pra publish e runtime. */
export async function requireStructureRecipient(reader: OrganizationalHierarchyReader, structure: StructureAnchor, role: EscalationRole, nodeId?: string): Promise<OrganizationalPerson> {
  const resolution = await resolveStructureRecipient(reader, structure, role)
  if (resolution.status === "RESOLVED") return resolution.person
  throw new DomainError(describeUnresolvedRecipient(resolution), unresolvedRecipientCode(resolution), 422, nodeId ? { nodeId } : undefined)
}

// ---------------------------------------------------------------------------------------------
// Implementação Postgres
// ---------------------------------------------------------------------------------------------

type PersonRow = { id: string; name: string; role: string; reports_to_id: string | null; job_title: string | null; avatar_url: string | null }

function toPerson(row: PersonRow): OrganizationalPerson {
  return { id: row.id, name: row.name, role: row.role, reportsToId: row.reports_to_id, jobTitle: row.job_title, avatarUrl: row.avatar_url }
}

const PERSON_COLUMNS = "id, name, role, reports_to_id, job_title, avatar_url"

/** Leitor real sobre `people` — só pessoas ativas contam como destinatário/membro. Cada consulta
 * resolve a cadeia/subárvore inteira em UMA ida ao banco; a cadeia acima carrega o caminho
 * percorrido (`path`) e a subárvore usa `union` — defesa contra ciclo em `reports_to_id`. */
export function postgresHierarchyReader(db: Database): OrganizationalHierarchyReader {
  return {
    async loadPerson(personId) {
      const result = await db.query<PersonRow>(`select ${PERSON_COLUMNS} from people where id = $1 and active`, [personId])
      return result.rows[0] ? toPerson(result.rows[0]) : null
    },
    async loadAncestors(personId) {
      const result = await db.query<PersonRow & { depth: number }>(
        `with recursive chain as (
           select p.id, p.name, p.role, p.reports_to_id, p.job_title, p.avatar_url, p.active, 0 depth, array[p.id] path from people p where p.id = (select reports_to_id from people where id = $1)
           union all
           select p.id, p.name, p.role, p.reports_to_id, p.job_title, p.avatar_url, p.active, c.depth + 1, c.path || p.id from people p join chain c on p.id = c.reports_to_id where not (p.id = any(c.path))
         )
         select ${PERSON_COLUMNS}, depth from chain where active order by depth`,
        [personId],
      )
      return result.rows.map(toPerson)
    },
    async loadDescendants(personId) {
      const result = await db.query<PersonRow>(
        `with recursive subtree as (
           select p.id, p.name, p.role, p.reports_to_id, p.job_title, p.avatar_url, p.active from people p where p.reports_to_id = $1
           union
           select p.id, p.name, p.role, p.reports_to_id, p.job_title, p.avatar_url, p.active from people p join subtree s on p.reports_to_id = s.id
         )
         select ${PERSON_COLUMNS} from subtree where active order by name, id`,
        [personId],
      )
      return result.rows.map(toPerson)
    },
    async countActiveOperators(personId, depth) {
      const result =
        depth === "DIRECT"
          ? await db.query<{ count: number }>(`select count(*)::int count from people where reports_to_id = $1 and role = 'OPERATOR' and active`, [personId])
          : await db.query<{ count: number }>(
              `with recursive subtree as (
                 select p.id, p.role, p.active from people p where p.reports_to_id = $1
                 union
                 select p.id, p.role, p.active from people p join subtree s on p.reports_to_id = s.id
               )
               select count(*)::int count from subtree where role = 'OPERATOR' and active`,
              [personId],
            )
      return result.rows[0]?.count ?? 0
    },
    async loadGroupOperators(group) {
      const result =
        "teamId" in group
          ? await db.query<PersonRow>(`select ${PERSON_COLUMNS} from people where team_id = $1 and role = 'OPERATOR' and active order by id`, [group.teamId])
          : await db.query<PersonRow>(`select ${PERSON_COLUMNS} from people where subteam_id = $1 and role = 'OPERATOR' and active order by id`, [group.subteamId])
      return result.rows.map(toPerson)
    },
  }
}
