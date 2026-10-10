import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload, PlatformRole } from "../../auth/infrastructure/jwt.js"
import { structureAnchorGroupRef, structureAnchorPersonId } from "../../workflows/domain/structure-anchor-schema.js"
import { analyticsSubjectId, buildAnalyticsSubject, type AnalyticsSubject } from "../domain/analytics-subject.js"
import { isHierarchyRole, ROLE_LABELS, STRUCTURE_KIND_BY_ROLE } from "../domain/hierarchy-levels.js"
import type { BreadcrumbEntry, SubjectDescriptor } from "../domain/view-models.js"
import type { AnalyticsReadRepository, PersonNode } from "./analytics-read-repository.js"
import type { VisibilityFilter } from "../../access/application/access-repository.js"
import type { Permission } from "../../access/domain/permissions.js"

/**
 * Autoridade de escopo da área de analytics. O browser manda `subjectKind`/`subjectId`; NADA disso
 * é confiado: todo sujeito é resolvido contra o conjunto VISÍVEL de quem está logado, carregado UMA
 * vez por request. Fora dele → 403 de domínio, nunca um vazamento silencioso nem um 500.
 *
 * V1.5.8 — o conjunto visível é a UNIÃO de duas regras que nunca se confundem:
 *   1. OPERACIONAL: a subárvore real (`reports_to_id`) de quem lidera pessoas — regra de negócio, vale para todo mundo;
 *   2. ACESSO: onde a CONTA tem a permissão da superfície (`indicators.view`, `calendar.manage`,
 *      `structure.metrics.view`) pelas atribuições de papel — organização, Grupo ou Subgrupo.
 * O nível hierárquico (`people.role`, inclusive o legado "ADMIN") NUNCA amplia a visão: não existe bypass.
 */
/** Permissões que ampliam o conjunto visível de uma superfície de pessoas. */
export type ScopePermission = Extract<Permission, "indicators.view" | "calendar.manage" | "structure.metrics.view">

export type ViewerScope = {
  viewer: PersonNode
  /** NÍVEL HIERÁRQUICO do viewer — organizacional (sujeito padrão, agrupamentos); nunca autoriza nada. */
  role: PlatformRole
  organizationId: string
  /** Conta da sessão (`sub`) — dona das atribuições de papel. */
  accountId: string
  /** Onde a CONTA tem a permissão da superfície (vazio = só a visão operacional da própria estrutura). */
  access: VisibilityFilter
  /** Pessoas visíveis ao viewer (subárvore operacional ∪ escopo de acesso), por id. */
  nodes: Map<string, PersonNode>
  /** Filhos diretos por id de gestor — inclui os do próprio viewer. */
  children: Map<string, PersonNode[]>
}

export function accessDenied(): DomainError {
  return new DomainError("Você não tem acesso a esta estrutura.", "STRUCTURE_ACCESS_DENIED", 403)
}

export async function loadViewerScope(repository: AnalyticsReadRepository, user: AuthTokenPayload, permission: ScopePermission = "indicators.view"): Promise<ViewerScope> {
  const [viewer, access] = await Promise.all([repository.loadPerson(user.organizationId, user.personId), repository.loadAccessVisibility(user.organizationId, user.sub, permission)])
  if (!viewer) throw new DomainError("Colaborador não encontrado.", "PERSON_NOT_FOUND", 404)
  const [structure, granted] = await Promise.all([repository.loadDescendants(user.organizationId, viewer.id), repository.loadPeopleInVisibility(user.organizationId, access)])
  const nodes = new Map([...structure, ...granted].filter((node) => node.id !== viewer.id).map((node) => [node.id, node]))
  const children = new Map<string, PersonNode[]>()
  for (const node of nodes.values()) {
    if (!node.reportsToId) continue
    const siblings = children.get(node.reportsToId) ?? []
    siblings.push(node)
    children.set(node.reportsToId, siblings)
  }
  return { viewer, role: user.role, organizationId: user.organizationId, accountId: user.sub, access, nodes, children }
}

/** O escopo de ACESSO (não o operacional) alcança esta pessoa? Grupo cobre os Subgrupos dele. */
export function accessCovers(access: VisibilityFilter, person: Pick<PersonNode, "teamId" | "subteamId">): boolean {
  return access.organizationWide || (person.teamId !== null && access.teamIds.includes(person.teamId)) || (person.subteamId !== null && access.subteamIds.includes(person.subteamId))
}

/** Tem a permissão da superfície em algum escopo (entrada na aba; o recorte concreto é `accessCovers`). */
export function hasAccessGrant(access: VisibilityFilter): boolean {
  return access.organizationWide || access.teamIds.length > 0 || access.subteamIds.length > 0
}

function isActiveOperator(node: PersonNode): boolean {
  return node.active && node.role === "OPERATOR"
}

/** Operadores ativos abaixo de uma pessoa, em qualquer profundidade (em memória, sobre a subárvore já carregada). */
export function operatorsBelow(scope: ViewerScope, anchorId: string): PersonNode[] {
  const result: PersonNode[] = []
  const stack = [...(scope.children.get(anchorId) ?? [])]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const node = stack.pop()!
    if (visited.has(node.id)) continue
    visited.add(node.id)
    if (isActiveOperator(node)) result.push(node)
    stack.push(...(scope.children.get(node.id) ?? []))
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
}

/** Equipe direta de um Supervisor — mesma definição do Workflow Engine (`resolveDirectReportOperatorIds`). */
export function directOperatorsOf(scope: ViewerScope, supervisorId: string): PersonNode[] {
  return (scope.children.get(supervisorId) ?? []).filter(isActiveOperator).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
}

function personInScope(scope: ViewerScope, personId: string): PersonNode | null {
  if (personId === scope.viewer.id) return scope.viewer
  return scope.nodes.get(personId) ?? null
}

/**
 * Sujeito da visualização de ESTRUTURA (aba Minha estrutura / navegação progressiva): o próprio
 * viewer, ou qualquer pessoa ATIVA do conjunto visível — de qualquer cargo, porque a navegação
 * organizacional passa por Supervisores, Coordenadores e Gerentes. É a MESMA subárvore que autoriza Indicadores/Equipe; nada
 * aqui amplia escopo — só deixa de exigir que o sujeito seja operador. Capability e autorização
 * são a mesma função: o botão "Ver estrutura" no frontend só reflete o que esta regra decide.
 */
export function structureSubjectInScope(scope: ViewerScope, personId: string): PersonNode | null {
  const person = personInScope(scope, personId)
  return person && person.active ? person : null
}

/**
 * Política de NAVEGAÇÃO da Estrutura (2026-09-17, decisão de produto): TODO MUNDO navega a
 * estrutura de todo mundo DENTRO DA ORGANIZAÇÃO — qualquer pessoa ativa é focável (Operador →
 * Supervisor → Coordenador → Gerente, e também outras Coordenações/Gerências), como num
 * organograma corporativo aberto. O que continua restrito: a FICHA do colaborador
 * (`canOpenEmployeeProfile`, só operadores ativos visíveis ao viewer) e o resumo de situação
 * funcional da estrutura (`managementMetrics`, só cargos de gestão ou `structure.metrics.view`). Pessoa inativa,
 * inexistente ou de OUTRA organização recebe o mesmo 403 (as leituras da focal e dos
 * subordinados são filtradas pela organização do token). `ancestorIds` (cadeia real e ativa do
 * viewer) serve à trilha ao subir ("Minha estrutura › gestor › …"), não mais à autorização.
 */
export type StructureAccess = {
  scope: ViewerScope
  /** Ids dos ancestrais ATIVOS reais do viewer (cadeia acima, com proteção anticiclo). Vazio para quem não tem gestor. */
  ancestorIds: ReadonlySet<string>
}

/** Toda pessoa que chega à resposta (subárvore, ancestrais, subordinados de qualquer focal) é ativa e da organização → focável. */
export function canFocusStructure(): boolean {
  return true
}

/**
 * Quem recebe as MÉTRICAS GERENCIAIS da estrutura (população estrutural e situação atual, span de
 * controle, abrangência operacional, médias por camada, referência do Grupo — aba "Dados da
 * estrutura" do card de um líder). Duas regras, nunca misturadas (V1.5.8):
 *   - OPERACIONAL: quem ocupa cargo de gestão (Supervisor, Coordenador, Gerente, Gerente Sênior, Diretor) vê as métricas de
 *     QUALQUER líder que navegar na organização (decisão de produto 2026-09-17) — é regra de negócio de quem lidera pessoas;
 *   - ACESSO: fora da cadeia de gestão, só com `structure.metrics.view` e só de líderes que o ESCOPO da atribuição alcança
 *     (Administrador do Subgrupo Contas não vê os dados de gestão de Cobrança).
 * NUNCA o Operador e nunca pelo nível legado "ADMIN". Não concede a ficha (`canOpenEmployeeProfile` é independente).
 */
export function canViewManagementMetrics(scope: Pick<ViewerScope, "role" | "access">, leader?: Pick<PersonNode, "teamId" | "subteamId">): boolean {
  if (isHierarchyRole(scope.role)) return true
  return leader ? accessCovers(scope.access, leader) : hasAccessGrant(scope.access)
}

/** A ficha do colaborador (`/supervisor/operators/:id`) continua aceitando SÓ operadores ativos
 * VISÍVEIS (subárvore ∪ escopo de `indicators.view`) — a mesma regra de `resolveSubject(EMPLOYEE)`, sem o próprio viewer (que já está no
 * próprio perfil). Capability INDEPENDENTE de `structureSubjectInScope`: um Gerente pode navegar
 * a estrutura de um Supervisor sem poder abrir a ficha dele. */
export function canOpenEmployeeProfile(scope: ViewerScope, personId: string): boolean {
  if (personId === scope.viewer.id) return false
  const person = scope.nodes.get(personId)
  return person !== undefined && isActiveOperator(person)
}

/** Subordinados DIRETOS ativos (qualquer cargo) de alguém da subárvore — o que a navegação
 * progressiva mostra ao abrir a estrutura de uma pessoa. Fora da subárvore = vazio (nunca busca). */
export function activeDirectReportsOf(scope: ViewerScope, personId: string): PersonNode[] {
  return (scope.children.get(personId) ?? []).filter((node) => node.active)
}

/** O sujeito "natural" do papel de quem olha: o próprio colaborador, ou a própria estrutura. */
export function resolveDefaultSubject(scope: ViewerScope): SubjectDescriptor | null {
  if (scope.role === "OPERATOR") return describeSubject(scope, { kind: "EMPLOYEE", employeeId: scope.viewer.id })
  if (isHierarchyRole(scope.role)) return describeSubject(scope, buildAnalyticsSubject(STRUCTURE_KIND_BY_ROLE[scope.role], scope.viewer.id))
  return null
}

export type ResolvedSubject = {
  descriptor: SubjectDescriptor
  /** Membros (operadores ativos) analisados — 1 elemento pra EMPLOYEE. */
  members: PersonNode[]
  anchor: PersonNode | null
}

/**
 * Valida o sujeito contra o escopo e resolve seus membros. Regras:
 *  - EMPLOYEE: o próprio viewer, ou um operador ativo da subárvore.
 *  - Estrutura ancorada em pessoa: âncora = viewer ou alguém da subárvore.
 *  - Grupo/Subgrupo: só o recorte do grupo que está DENTRO da subárvore; vazio = sem acesso.
 */
export function resolveSubject(scope: ViewerScope, subject: AnalyticsSubject): ResolvedSubject {
  if (subject.kind === "EMPLOYEE") {
    const person = personInScope(scope, subject.employeeId)
    if (!person || (person.id !== scope.viewer.id && !isActiveOperator(person))) throw accessDenied()
    return { descriptor: describeSubject(scope, subject), members: [person], anchor: person }
  }

  const anchorId = structureAnchorPersonId(subject)
  if (anchorId) {
    const anchor = personInScope(scope, anchorId)
    if (!anchor) throw accessDenied()
    const members = subject.kind === "SUPERVISOR_TEAM" ? directOperatorsOf(scope, anchor.id) : operatorsBelow(scope, anchor.id)
    return { descriptor: describeSubject(scope, subject), members, anchor }
  }

  const group = structureAnchorGroupRef(subject)
  const scopedOperators = [...scope.nodes.values()].filter(isActiveOperator)
  const members = scopedOperators
    .filter((node) => (group?.teamId ? node.teamId === group.teamId : node.subteamId === group?.subteamId))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
  if (members.length === 0) throw accessDenied()
  return { descriptor: describeSubject(scope, subject), members, anchor: null }
}

export function describeSubject(scope: ViewerScope, subject: AnalyticsSubject): SubjectDescriptor {
  if (subject.kind === "EMPLOYEE") {
    const person = personInScope(scope, subject.employeeId)
    return { subject, label: person?.name ?? "Colaborador", description: person?.jobTitle ?? (person ? ROLE_LABELS[person.role as PlatformRole] ?? person.role : null) }
  }
  const anchorId = structureAnchorPersonId(subject)
  if (anchorId) {
    const person = personInScope(scope, anchorId)
    const role = person ? (ROLE_LABELS[person.role as PlatformRole] ?? person.role) : null
    return { subject, label: person?.name ?? "Estrutura", description: subject.kind === "SUPERVISOR_TEAM" ? `Equipe · ${role ?? "Supervisor"}` : `Estrutura · ${role ?? ""}`.trim() }
  }
  const group = structureAnchorGroupRef(subject)
  const sample = [...scope.nodes.values()].find((node) => (group?.teamId ? node.teamId === group.teamId : node.subteamId === group?.subteamId))
  const label = group?.teamId ? sample?.teamName : sample?.subteamName
  return { subject, label: label ?? (group?.teamId ? "Grupo" : "Subgrupo"), description: group?.teamId ? "Grupo" : `Subgrupo${sample?.teamName ? ` · ${sample.teamName}` : ""}` }
}

/** Trilha do sujeito padrão do viewer até o sujeito atual — sempre dentro do escopo. */
export function buildBreadcrumb(scope: ViewerScope, subject: AnalyticsSubject): BreadcrumbEntry[] {
  const root = resolveDefaultSubject(scope)
  const entries: BreadcrumbEntry[] = []
  if (root) entries.push(toEntry(root))
  const current = describeSubject(scope, subject)
  if (root && analyticsSubjectId(root.subject) === analyticsSubjectId(subject) && root.subject.kind === subject.kind) return entries

  const anchorId = subject.kind === "EMPLOYEE" ? subject.employeeId : structureAnchorPersonId(subject)
  if (anchorId) {
    // Ancestrais entre o viewer e a âncora, do mais alto pro mais baixo, cada um como estrutura.
    const chain: PersonNode[] = []
    let cursor = scope.nodes.get(anchorId)?.reportsToId ?? null
    while (cursor && cursor !== scope.viewer.id) {
      const node = scope.nodes.get(cursor)
      if (!node) break
      chain.unshift(node)
      cursor = node.reportsToId
    }
    for (const node of chain) {
      if (!isHierarchyRole(node.role)) continue
      entries.push(toEntry(describeSubject(scope, buildAnalyticsSubject(STRUCTURE_KIND_BY_ROLE[node.role], node.id))))
    }
  }
  entries.push(toEntry(current))
  return entries
}

function toEntry(descriptor: SubjectDescriptor): BreadcrumbEntry {
  return { kind: descriptor.subject.kind, id: analyticsSubjectId(descriptor.subject), label: descriptor.label }
}
