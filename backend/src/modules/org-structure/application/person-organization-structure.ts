import type { AuthTokenPayload, PlatformRole } from "../../auth/infrastructure/jwt.js"
import type { AnalyticsReadRepository, PersonNode } from "../../performance-analytics/application/analytics-read-repository.js"
import { accessDenied, activeDirectReportsOf, canFocusStructure, canOpenEmployeeProfile, canViewManagementMetrics, loadViewerScope, structureSubjectInScope, type StructureAccess } from "../../performance-analytics/application/viewer-scope.js"
import { HIERARCHY_ROLES, ROLE_LABELS } from "../../performance-analytics/domain/hierarchy-levels.js"
import type { EmploymentStatusFreshness } from "../../people/application/employment-status-freshness.js"
import { findBrazilianCapital } from "../../people/domain/brazilian-capitals.js"
import type { OrganizationalHierarchyReader, OrganizationalPerson } from "../../workflows/application/organizational-recipient.js"
import type { ManagementMetrics } from "../domain/management-metrics.js"
import type { ManagementMetricsLoader } from "./load-management-metrics.js"

/**
 * Aba "Estrutura" do perfil ("Minha estrutura" para o próprio colaborador) e a NAVEGAÇÃO
 * PROGRESSIVA: pessoa focal → cadeia de liderança acima → subordinados diretos → nova pessoa focal.
 * Nunca a árvore inteira: a resposta traz a pessoa, a cadeia ACIMA dela, seus subordinados
 * DIRETOS e uma contagem — e cada nó carrega o que o viewer pode fazer com ele.
 *
 * Nada aqui é uma segunda árvore organizacional. As fontes são exatamente as que o resto da
 * plataforma já usa:
 *  - Permissão (viewer-scope.ts): TODO MUNDO navega a estrutura de todo mundo dentro da
 *    organização — qualquer pessoa ATIVA é focável; a subárvore de `loadViewerScope` continua
 *    sendo a fonte dos dados quando a focal está nela (zero leitura extra), e fora dela a focal e
 *    os subordinados diretos vêm de leituras pontuais FILTRADAS PELA ORGANIZAÇÃO do token.
 *    Inativo, inexistente ou de outra organização → 403 de domínio, sem distinguir os casos. O
 *    que continua restrito: a ficha (`canViewProfile`, só operadores ativos da subárvore) e as
 *    MÉTRICAS GERENCIAIS de cada líder (`managementMetrics`, só cargos de gestão ou `structure.metrics.view`
 *    no escopo do líder — nunca o Operador nem o nível legado "ADMIN"; definições em `domain/management-metrics.ts`).
 *  - Cadeia acima: `OrganizationalHierarchyReader.loadAncestors` (o leitor do resolvedor de
 *    destinatários de Workflow) — uma CTE recursiva com caminho percorrido, ou seja, um ciclo em
 *    `reports_to_id` termina a consulta em vez de travar. Só pessoas ativas contam.
 *  - Subordinados diretos e `hasReports`: da subárvore já carregada pelo escopo (zero consultas
 *    extras, nunca uma por pessoa).
 *  - Integrantes: `countActiveOperators` — contagem no banco pela regra do Workflow Engine/
 *    Analytics (Equipe de Supervisor = operadores ativos que reportam DIRETAMENTE a ele; qualquer
 *    outra estrutura = operadores ativos em qualquer profundidade), sem carregar a subárvore.
 *  - Origem: metadata dos feeds do contrato ORGANIZATIONAL_STRUCTURE da Central de Dados quando
 *    existem; sem feed configurado, nada é mostrado (nunca uma origem inventada).
 *
 * Tudo determinístico, sem LLM, sem N+1: número FIXO de consultas por request (viewer, subárvore
 * do viewer, cadeia acima do viewer, cadeia acima da focal, contagem da estrutura imediata,
 * e-mails em lote, feeds de estrutura, métricas gerenciais de TODOS os líderes do payload em um
 * único lote; focal ANCESTRAL soma três leituras pontuais — a pessoa, os subordinados diretos
 * dela e a contagem de subordinados desses em lote — nunca a subárvore).
 */
export type StructurePersonCapabilities = {
  /** A ficha (`/supervisor/operators/:id`) abre para o viewer — só operadores ativos da subárvore. */
  canViewProfile: boolean
  /** O viewer pode tornar esta pessoa a focal da estrutura — hoje, toda pessoa ativa da organização. */
  canViewStructure: boolean
  /** Existe ao menos um subordinado direto ativo, de qualquer cargo (Supervisor com equipe,
   * Coordenador com Supervisores…) — nunca "só operadores", senão a navegação entre gestores
   * pararia. Verdadeiro para quem está acima do viewer (lidera a cadeia dele). */
  hasReports: boolean
}

export type StructurePerson = {
  personId: string
  name: string
  role: string
  roleLabel: string
  jobTitle: string | null
  avatarUrl: string | null
  /** E-mail corporativo da conta (nunca contato pessoal); null sem conta. */
  email: string | null
  /** Grupo/Subgrupo: `null` = não informado no cadastro; AUSENTE = não faz parte do que o viewer
   * enxerga (ancestrais acima da subárvore dele) — a UI não mostra a linha em vez de dizer "não informado". */
  group?: { id: string; name: string } | null
  subgroup?: { id: string; name: string } | null
  /** Capital operacional (jurisdição de feriados) — mesma regra de ausência de Grupo/Subgrupo. */
  operationalCapital?: { code: string; name: string; stateCode: string; label: string } | null
  /** Subordinados diretos ativos (qualquer cargo) — conhecido só para quem está na subárvore do viewer; null acima dela. */
  directReportCount: number | null
  capabilities: StructurePersonCapabilities
  /** Métricas gerenciais da estrutura desta pessoa (focal e subordinados diretos que lideram):
   * `null` = o viewer não pode ver (Operador) ou a pessoa não lidera ninguém; AUSENTE = node que
   * nunca expande (gestor acima, cadeia). Decidido pelo backend — a aba "Dados da estrutura" só
   * existe quando isto chega preenchido. */
  managementMetrics?: ManagementMetrics | null
}

export type StructureChainEntry = StructurePerson & {
  /** 1 = gestor imediato; cresce em direção ao topo. Ordem determinística: gestor imediato → topo. */
  level: number
}

export type DirectManagerStatus =
  /** `reports_to_id` aponta para uma pessoa ativa — é a primeira da cadeia. */
  | "PRESENT"
  /** Sem `reports_to_id`: topo da cadeia ou cadastro incompleto — nunca inventamos um gestor. */
  | "NOT_INFORMED"
  /** `reports_to_id` aponta para alguém inativo: a cadeia exibida começa no próximo nível ativo. */
  | "INACTIVE"

/** O que a contagem de integrantes significa — a UI mostra o rótulo real, nunca "integrantes". */
export type MemberCountKind = "DIRECT_OPERATORS" | "OPERATORS_BELOW"

export const MEMBER_COUNT_LABELS: Record<MemberCountKind, string> = {
  DIRECT_OPERATORS: "Operadores da equipe",
  OPERATORS_BELOW: "Operadores na estrutura",
}

export type PersonOrganizationStructure = {
  subject: StructurePerson & {
    /** O sujeito é quem está logado ("Você está aqui") ou alguém aberto por um gestor. */
    isViewer: boolean
  }
  /** Trilha REAL do drill-down: do viewer (ou do topo autorizado) até a pessoa focal, só com
   * pessoas cuja estrutura o viewer pode abrir — reconstruída da ancestralidade, nunca do state. */
  breadcrumb: Array<{ personId: string; name: string; roleLabel: string; isViewer: boolean }>
  organizationalContext: {
    group: { id: string; name: string } | null
    subgroup: { id: string; name: string } | null
    directManagerStatus: DirectManagerStatus
    /** Estrutura imediata = a estrutura do gestor imediato (Equipe de Supervisor ou Estrutura de …). */
    team: {
      label: string
      leader: StructureChainEntry
      memberCount: number
      memberCountKind: MemberCountKind
      memberCountLabel: string
    } | null
  }
  managementChain: StructureChainEntry[]
  /** Subordinados diretos ativos da pessoa focal (qualquer cargo), gestores primeiro. */
  directReports: StructurePerson[]
  /**
   * CAMINHO ORGANIZACIONAL DO VIEWER: a cadeia real e ativa de `reports_to_id` acima de quem está
   * logado, do topo até ele (`[diretor, …, gestor imediato, viewer]`), nunca inferida por cargo —
   * pode pular níveis e ter qualquer profundidade. É só METADATA (ids e rótulos, nunca a árvore):
   * o organograma usa para apontar continuamente "este caminho leva até você" — quando a focal está
   * neste caminho, o elemento seguinte a ela é o ramo destacado com a edge animada permanente. Para quem
   * não tem gestor (topo, ou pessoa fora da hierarquia) é só ele mesmo.
   */
  viewerOrganizationPath: Array<{ personId: string; name: string; roleLabel: string }>
  sourceMetadata: { sourceName: string; feedName: string; lastUpdatedAt: string | null; freshness: EmploymentStatusFreshness["state"] } | null
}

export type PersonOrganizationStructureDeps = {
  analytics: AnalyticsReadRepository
  hierarchy: OrganizationalHierarchyReader
  /** E-mail corporativo (conta de acesso) por pessoa, em LOTE — uma consulta por request. */
  corporateEmails: (personIds: string[]) => Promise<Map<string, string>>
  /** Freshness dos feeds ORGANIZATIONAL_STRUCTURE — injetada pra testar sem banco. */
  structureFreshness: (organizationId: string) => Promise<EmploymentStatusFreshness>
  /** Métricas gerenciais de N líderes em LOTE (número fixo de consultas) — só chamada para quem pode ver. */
  managementMetrics: ManagementMetricsLoader
  now?: () => Date
}

function roleLabelOf(role: string): string {
  return ROLE_LABELS[role as PlatformRole] ?? role
}

/** Rótulo da estrutura imediata — o mesmo vocabulário das sete âncoras (Equipe de Supervisor × Estrutura de …). */
export function describeImmediateStructure(leader: Pick<OrganizationalPerson, "name" | "role">): string {
  return leader.role === "SUPERVISOR" ? `Equipe de ${leader.name}` : `Estrutura de ${leader.name}`
}

/** Como contar a população da estrutura de um gestor — regra idêntica a `directOperatorsOf`/`operatorsBelow` (viewer-scope.ts). */
export function memberCountKindOf(leader: Pick<OrganizationalPerson, "role">): MemberCountKind {
  return leader.role === "SUPERVISOR" ? "DIRECT_OPERATORS" : "OPERATORS_BELOW"
}

export function describeStructureSource(freshness: EmploymentStatusFreshness): PersonOrganizationStructure["sourceMetadata"] {
  if (!freshness.configured) return null
  const considered = freshness.feeds.find((feed) => freshness.consideredFeedIds.includes(feed.feedId)) ?? freshness.feeds[0]
  if (!considered) return null
  return { sourceName: considered.sourceName, feedName: considered.feedName, lastUpdatedAt: freshness.lastSuccessAt, freshness: freshness.state }
}

/**
 * Capabilities de QUALQUER nó da resposta, decididas pelas mesmas funções que autorizam o request.
 * `knownDirectReports` = subordinados diretos ativos já contados para quem está fora da subárvore
 * (os subordinados de uma focal ancestral); `null` = desconhecido → só ancestrais chegam aqui, e
 * eles lideram alguém ativo por definição (o próprio sujeito/viewer).
 */
export function structureCapabilitiesOf(access: StructureAccess, personId: string, knownDirectReports: number | null = null): StructurePersonCapabilities {
  const inScope = structureSubjectInScope(access.scope, personId)
  return {
    canViewProfile: canOpenEmployeeProfile(access.scope, personId),
    canViewStructure: canFocusStructure(),
    hasReports: inScope ? activeDirectReportsOf(access.scope, personId).length > 0 : knownDirectReports === null ? true : knownDirectReports > 0,
  }
}

function describeCapital(code: string | null): NonNullable<StructurePerson["operationalCapital"]> | null {
  const capital = findBrazilianCapital(code)
  return capital ? { code: capital.code, name: capital.name, stateCode: capital.stateCode, label: `${capital.name} / ${capital.stateCode}` } : null
}

function fromNode(access: StructureAccess, node: PersonNode, emails: Map<string, string>, knownDirectReports: number | null = null): StructurePerson {
  const inScope = structureSubjectInScope(access.scope, node.id) !== null
  return {
    personId: node.id,
    name: node.name,
    role: node.role,
    roleLabel: roleLabelOf(node.role),
    jobTitle: node.jobTitle,
    avatarUrl: node.avatarUrl,
    email: emails.get(node.id) ?? null,
    group: node.teamId && node.teamName ? { id: node.teamId, name: node.teamName } : null,
    subgroup: node.subteamId && node.subteamName ? { id: node.subteamId, name: node.subteamName } : null,
    operationalCapital: describeCapital(node.operationalCapitalCode),
    directReportCount: inScope ? activeDirectReportsOf(access.scope, node.id).length : knownDirectReports,
    capabilities: structureCapabilitiesOf(access, node.id, knownDirectReports),
  }
}

function fromAncestor(access: StructureAccess, person: OrganizationalPerson, level: number, emails: Map<string, string>): StructureChainEntry {
  // Ancestral dentro da subárvore (drill-down) tem Grupo/Subgrupo no escopo; acima do viewer o
  // Grupo/Subgrupo dele fica AUSENTE (não é dado do escopo do viewer — e não é "não informado").
  const node = structureSubjectInScope(access.scope, person.id)
  const base: StructurePerson = node
    ? fromNode(access, node, emails)
    : {
        personId: person.id,
        name: person.name,
        role: person.role,
        roleLabel: roleLabelOf(person.role),
        jobTitle: person.jobTitle,
        avatarUrl: person.avatarUrl,
        email: emails.get(person.id) ?? null,
        directReportCount: null,
        capabilities: structureCapabilitiesOf(access, person.id),
      }
  return { ...base, level }
}

const ROLE_ORDER: readonly string[] = [...HIERARCHY_ROLES, "OPERATOR"]

/** Gestores primeiro (na ordem real da cadeia), depois operadores, depois os demais; nome dentro de cada grupo. */
export function sortDirectReports<T extends { role: string; name: string }>(reports: T[]): T[] {
  const rank = (role: string) => {
    const index = ROLE_ORDER.indexOf(role)
    return index === -1 ? ROLE_ORDER.length : index
  }
  return [...reports].sort((a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name, "pt-BR"))
}

/**
 * Trilha viewer → … → sujeito a partir da ancestralidade REAL (cadeias já carregadas, com
 * proteção anticiclo): descendo, os níveis entre o viewer e o sujeito; subindo (sujeito é um
 * ancestral do viewer), "Minha estrutura › gestor › … › sujeito" — cada nível é clicável e
 * autorizado. Quem não tem gestor (ex.: fora da hierarquia) não é ancestral de ninguém: a trilha começa no topo da cadeia.
 */
export function buildStructureBreadcrumb(access: StructureAccess, subject: PersonNode, ancestors: OrganizationalPerson[], viewerAncestors: OrganizationalPerson[]): PersonOrganizationStructure["breadcrumb"] {
  const { scope } = access
  const entry = (person: Pick<OrganizationalPerson, "id" | "name" | "role">) => ({ personId: person.id, name: person.name, roleLabel: roleLabelOf(person.role), isViewer: person.id === scope.viewer.id })
  if (subject.id === scope.viewer.id) return [entry(scope.viewer)]
  const subjectAbove = viewerAncestors.findIndex((person) => person.id === subject.id)
  if (subjectAbove >= 0) return [entry(scope.viewer), ...viewerAncestors.slice(0, subjectAbove).map(entry), entry(subject)]
  const viewerIndex = ancestors.findIndex((person) => person.id === scope.viewer.id)
  // Fora da própria cadeia (outra Coordenação/Gerência, ou quem está fora da hierarquia): a trilha é a ancestralidade real do sujeito, do topo até ele — todos focáveis.
  const path = viewerIndex >= 0 ? ancestors.slice(0, viewerIndex + 1) : ancestors.filter(() => canFocusStructure())
  return [...path.reverse().map(entry), entry(subject)]
}

export async function buildPersonOrganizationStructure(deps: PersonOrganizationStructureDeps, user: AuthTokenPayload, personId: string): Promise<PersonOrganizationStructure> {
  // V1.5.8: a navegação do organograma é aberta a todos (decisão de produto) e não depende de papel nem de nível hierárquico.
  // O escopo carregado é o de Indicadores (`indicators.view`) porque é ele que autoriza a FICHA (`canViewProfile`); quem recebe
  // os DADOS DE GESTÃO de cada líder é decidido à parte por `structure.metrics.view` (ou pela regra operacional de quem lidera).
  const [scope, metricsAccess] = await Promise.all([loadViewerScope(deps.analytics, user), deps.analytics.loadAccessVisibility(user.organizationId, user.sub, "structure.metrics.view")])
  // Ancestrais reais e ATIVOS do viewer (loadAncestors só devolve ativos; CTE anticiclo) — a base da navegação ascendente.
  const viewerAncestors = await deps.hierarchy.loadAncestors(scope.viewer.id)
  const access: StructureAccess = { scope, ancestorIds: new Set(viewerAncestors.map((person) => person.id)) }

  // Qualquer pessoa ATIVA da organização é focável; inativa, inexistente ou de outra organização
  // (a leitura é filtrada pela organização do token) → STRUCTURE_ACCESS_DENIED (403).
  const inScope = structureSubjectInScope(scope, personId)
  const outsideFocal = inScope ? null : await deps.analytics.loadPerson(scope.organizationId, personId)
  const subject = inScope ?? (outsideFocal?.active ? outsideFocal : null)
  if (!subject) throw accessDenied()

  // Subordinados diretos ativos: da subárvore já carregada, ou — focal fora dela — uma leitura
  // pontual dos filhos diretos + a contagem de subordinados deles em lote (nunca a subárvore).
  const reportNodes = inScope ? activeDirectReportsOf(scope, subject.id) : (await deps.analytics.loadDirectReports(scope.organizationId, subject.id)).filter((node) => node.active)
  const reportCounts = inScope ? new Map<string, number>() : await deps.analytics.countActiveDirectReports(scope.organizationId, reportNodes.map((node) => node.id))
  const directReports = sortDirectReports(reportNodes)
  const knownCount = (node: PersonNode) => (inScope ? null : (reportCounts.get(node.id) ?? 0))

  const ancestors = subject.id === scope.viewer.id ? viewerAncestors : await deps.hierarchy.loadAncestors(subject.id)
  const leader = ancestors[0] ?? null
  const emailIds = [subject.id, ...ancestors.map((person) => person.id), ...directReports.map((node) => node.id)]

  // Líderes que podem expandir no organograma (focal + subordinados diretos com equipe): as
  // métricas gerenciais deles vêm em UM lote — só para quem ocupa cargo de gestão ou tem
  // `structure.metrics.view` com escopo que alcança o líder (o Operador nunca recebe; sem ninguém autorizado a consulta nem é feita).
  const leaders = [...(directReports.length > 0 ? [subject] : []), ...directReports.filter((node) => structureCapabilitiesOf(access, node.id, knownCount(node)).hasReports)].filter((node) => canViewManagementMetrics({ role: scope.role, access: metricsAccess }, node))
  const [memberCount, emails, freshness, metrics] = await Promise.all([
    leader ? deps.hierarchy.countActiveOperators(leader.id, memberCountKindOf(leader) === "DIRECT_OPERATORS" ? "DIRECT" : "ANY") : Promise.resolve(0),
    deps.corporateEmails(emailIds),
    deps.structureFreshness(scope.organizationId),
    leaders.length > 0 ? deps.managementMetrics(scope.organizationId, leaders.map((node) => ({ id: node.id, role: node.role, teamId: node.teamId })), (deps.now ?? (() => new Date()))()) : Promise.resolve(new Map<string, ManagementMetrics>()),
  ])
  const withMetrics = (person: StructurePerson): StructurePerson => ({ ...person, managementMetrics: metrics.get(person.personId) ?? null })

  const managementChain = ancestors.map((person, index) => fromAncestor(access, person, index + 1, emails))
  const directManagerStatus: DirectManagerStatus = subject.reportsToId === null ? "NOT_INFORMED" : leader?.id === subject.reportsToId ? "PRESENT" : "INACTIVE"
  const memberCountKind = leader ? memberCountKindOf(leader) : null

  return {
    subject: { ...withMetrics(fromNode(access, subject, emails, inScope ? null : directReports.length)), isViewer: subject.id === scope.viewer.id },
    breadcrumb: buildStructureBreadcrumb(access, subject, ancestors, viewerAncestors),
    organizationalContext: {
      group: subject.teamId && subject.teamName ? { id: subject.teamId, name: subject.teamName } : null,
      subgroup: subject.subteamId && subject.subteamName ? { id: subject.subteamId, name: subject.subteamName } : null,
      directManagerStatus,
      team: leader && memberCountKind ? { label: describeImmediateStructure(leader), leader: managementChain[0]!, memberCount, memberCountKind, memberCountLabel: MEMBER_COUNT_LABELS[memberCountKind] } : null,
    },
    managementChain,
    directReports: directReports.map((node) => withMetrics(fromNode(access, node, emails, knownCount(node)))),
    viewerOrganizationPath: [...[...viewerAncestors].reverse(), scope.viewer].map((person) => ({ personId: person.id, name: person.name, roleLabel: roleLabelOf(person.role) })),
    sourceMetadata: describeStructureSource(freshness),
  }
}
