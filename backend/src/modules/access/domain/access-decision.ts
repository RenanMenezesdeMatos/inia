import { scopeCovers, scopeReachesCollaborator, type AccessScope, type CollaboratorResource } from "./access-scope.js"
import type { Permission } from "./permissions.js"
import { systemRoleCatalog, type RoleCatalog } from "./roles.js"

/**
 * RESOLUÇÃO DE ACESSO (pura, determinística) — o ÚNICO lugar que interpreta papéis × permissões × escopo. Controllers nunca
 * olham papel/cargo: perguntam "esta conta pode <permissão> sobre <recurso>?". DENY BY DEFAULT: sem atribuição com a
 * permissão → nega; escopo que não alcança o recurso → nega; outra organização → a conta nem é carregada (nega).
 * Não existe bypass: o Administrador geral pode tudo porque o PAPEL dele contém todas as permissões na organização inteira.
 */
export type AccessAssignment = { id: string; roleCode: string; scope: AccessScope }
export type AccessContext = { organizationId: string; accountId: string; personId: string; assignments: readonly AccessAssignment[] }

const permissionsOf = (assignment: AccessAssignment, catalog: RoleCatalog): readonly Permission[] => catalog.find(assignment.roleCode)?.permissions ?? []

export function effectivePermissions(access: AccessContext, catalog: RoleCatalog = systemRoleCatalog): Permission[] {
  return [...new Set(access.assignments.flatMap((assignment) => permissionsOf(assignment, catalog)))].sort()
}

/** Escopos em que a conta tem a permissão (vazio = não tem). */
export function scopesWithPermission(access: AccessContext, permission: Permission, catalog: RoleCatalog = systemRoleCatalog): AccessScope[] {
  return access.assignments.filter((assignment) => permissionsOf(assignment, catalog).includes(permission)).map((assignment) => assignment.scope)
}

/** Tem a permissão em algum escopo (entrada numa tela; o recurso concreto é checado depois). */
export const canAnywhere = (access: AccessContext, permission: Permission, catalog: RoleCatalog = systemRoleCatalog) => scopesWithPermission(access, permission, catalog).length > 0
/** Tem a permissão na organização INTEIRA (recursos do tenant: QA Lab, configuração de IA…). */
export const canOrganizationWide = (access: AccessContext, permission: Permission, catalog: RoleCatalog = systemRoleCatalog) => scopesWithPermission(access, permission, catalog).some((scope) => scope.type === "ORGANIZATION")

/** Pode <permissão> sobre este colaborador? `inStructure` = o colaborador está abaixo da conta por reports_to (MY_STRUCTURE). */
export function canOnCollaborator(access: AccessContext, permission: Permission, collaborator: CollaboratorResource, inStructure: boolean, catalog: RoleCatalog = systemRoleCatalog): boolean {
  return scopesWithPermission(access, permission, catalog).some((scope) => scopeReachesCollaborator(scope, collaborator, inStructure))
}

// ---------------------------------------------------------------------------------------------
// DELEGAÇÃO — ninguém concede mais autoridade do que está autorizado a delegar
// ---------------------------------------------------------------------------------------------

export type DelegationDenial = "SELF_ASSIGNMENT" | "UNKNOWN_ROLE" | "SCOPE_NOT_ALLOWED_FOR_ROLE" | "NOT_AUTHORIZED_TO_ASSIGN" | "ROLE_NOT_DELEGABLE" | "SCOPE_EXCEEDS_GRANTOR" | "RECIPIENT_OUT_OF_SCOPE"
export type DelegationRequest = { roleCode: string; scope: AccessScope; recipientAccountId: string; recipient: CollaboratorResource }

/**
 * Uma atribuição (ou revogação) só passa se EXISTE uma atribuição do concedente que, ao mesmo tempo: tem `access.roles.assign`,
 * delega o papel pedido, cobre o escopo pedido e alcança a pessoa que recebe. Bloqueia escalada de papel (papel não delegável),
 * de permissão (o pacote vem do papel — não se escolhe permissão solta) e de escopo (escopo maior que o do concedente).
 * Auto-atribuição é sempre negada (inclusive para o Administrador geral: outra pessoa precisa conceder).
 */
export function checkDelegation(grantor: AccessContext, request: DelegationRequest, options: { allowSelf?: boolean } = {}, catalog: RoleCatalog = systemRoleCatalog): { ok: true } | { ok: false; reason: DelegationDenial } {
  if (!options.allowSelf && request.recipientAccountId === grantor.accountId) return { ok: false, reason: "SELF_ASSIGNMENT" }
  const role = catalog.find(request.roleCode)
  if (!role) return { ok: false, reason: "UNKNOWN_ROLE" }
  if (!role.allowedScopes.includes(request.scope.type)) return { ok: false, reason: "SCOPE_NOT_ALLOWED_FOR_ROLE" }
  const assigners = grantor.assignments.filter((assignment) => permissionsOf(assignment, catalog).includes("access.roles.assign"))
  if (assigners.length === 0) return { ok: false, reason: "NOT_AUTHORIZED_TO_ASSIGN" }
  const delegating = assigners.filter((assignment) => catalog.find(assignment.roleCode)?.delegates.includes(request.roleCode))
  if (delegating.length === 0) return { ok: false, reason: "ROLE_NOT_DELEGABLE" }
  const covering = delegating.filter((assignment) => scopeCovers(assignment.scope, request.scope))
  if (covering.length === 0) return { ok: false, reason: "SCOPE_EXCEEDS_GRANTOR" }
  if (!covering.some((assignment) => scopeReachesCollaborator(assignment.scope, request.recipient, false))) return { ok: false, reason: "RECIPIENT_OUT_OF_SCOPE" }
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------
// CAPABILITIES para o frontend — DERIVADAS das permissões (o frontend nunca decide por cargo)
// ---------------------------------------------------------------------------------------------

export function accessCapabilities(access: AccessContext, catalog: RoleCatalog = systemRoleCatalog) {
  const any = (permission: Permission) => canAnywhere(access, permission, catalog)
  const org = (permission: Permission) => canOrganizationWide(access, permission, catalog)
  return {
    canAccessAdministration: ["access.users.view", "access.roles.view", "people.manage", "agents.manage", "knowledge.manage", "workflows.manage", "configuration.manage", "data_hub.manage", "ai.view", "ai.manage", "qa_lab.use", "inia_experience.manage", "intervention_policies.edit", "intervention_policies.simulate", "intervention_policies.publish", "intervention_policies.audit"].some((permission) => any(permission as Permission)),
    canManageUsers: any("access.users.manage"),
    canViewUsers: any("access.users.view"),
    canViewRoles: any("access.roles.view"),
    canAssignRoles: any("access.roles.assign"),
    canManagePeople: any("people.manage"),
    canManageAgents: any("agents.manage"),
    canManageKnowledge: any("knowledge.manage"),
    canManageWorkflows: any("workflows.manage"),
    canManageConfiguration: any("configuration.manage"),
    // Central de Dados: dados e credenciais da organização inteira — só com escopo de organização (igual ao guard da rota).
    canManageDataHub: org("data_hub.manage"),
    canViewAi: any("ai.view"),
    canUseQaLab: org("qa_lab.use"),
    canReviewFeedback: any("feedback_quality_review.view"),
    // V1.5.8: visões ampliadas (o recorte concreto — quem aparece — é decidido pelo backend no recurso, pelo escopo).
    canViewIndicators: any("indicators.view"),
    canViewStructureMetrics: any("structure.metrics.view"),
    canManageCalendar: any("calendar.manage"),
    // Conversas com a INIA (somente leitura). Propositalmente FORA de `canAccessAdministration`: abre só esta área.
    canViewAssistantConversations: any("assistant_conversations.view"),
    // Cenário da INIA: recurso do tenant inteiro (como o QA Lab) — escopo de organização.
    canManageIniaScenes: org("inia_experience.manage"),
    // Monitoria de usabilidade — FORA de `canAccessAdministration` (como as conversas): quem só tem a monitoria vê só ela.
    canViewUsability: any("usability.view"),
    canViewUsabilityPeople: any("usability.users.view"),
    canExportUsability: any("usability.export"),
    canViewUsabilityComments: any("usability.comments.view"),
    canManageUsability: org("usability.manage"),
    // Políticas de acompanhamento (configuração) × intervenções (ação sobre colaboradores) — sempre separadas.
    // Entrada da área (menu): qualquer uma das quatro permissões de configuração.
    canAccessInterventionPolicies: ["intervention_policies.edit", "intervention_policies.simulate", "intervention_policies.publish", "intervention_policies.audit"].some((permission) => any(permission as Permission)),
    canEditInterventionPolicies: any("intervention_policies.edit"),
    canSimulateInterventionPolicies: any("intervention_policies.simulate"),
    canPublishInterventionPolicies: any("intervention_policies.publish"),
    canAuditInterventionPolicies: any("intervention_policies.audit"),
    canViewInterventions: any("interventions.view"),
    canExecuteInterventions: any("interventions.execute"),
    canApproveInterventions: any("interventions.approve"),
    canDecideSensitiveInterventions: any("interventions.sensitive_decide"),
  }
}

// ---------------------------------------------------------------------------------------------
// CUSTÓDIA DA CREDENCIAL — habilitar, gerar senha temporária e desabilitar acesso
// ---------------------------------------------------------------------------------------------

export type CredentialCustodyDenial = "SELF_CREDENTIAL" | "TARGET_MORE_PRIVILEGED"
export type CredentialTarget = { accountId: string | null; collaborator: CollaboratorResource; assignments: readonly { roleCode: string; scope: AccessScope }[] }

/**
 * Quem gera a senha temporária de alguém passa a CONHECER uma credencial daquela conta — então só pode fazer isso (e, pela
 * mesma régua, habilitar/desabilitar o acesso) se poderia conceder TODOS os papéis ativos dela, naquele escopo, àquela pessoa
 * (a mesma `checkDelegation`). Sem isso, um administrador de Grupo assumiria a conta de um Administrador geral do Grupo dele.
 * Nunca sobre o próprio acesso: outra pessoa autorizada precisa fazer isso (como na atribuição de papéis).
 */
export function checkCredentialCustody(actor: AccessContext, target: CredentialTarget, catalog: RoleCatalog = systemRoleCatalog): { ok: true } | { ok: false; reason: CredentialCustodyDenial } {
  if (target.collaborator.personId === actor.personId || (target.accountId !== null && target.accountId === actor.accountId)) return { ok: false, reason: "SELF_CREDENTIAL" }
  for (const assignment of target.assignments) {
    const verdict = checkDelegation(actor, { roleCode: assignment.roleCode, scope: assignment.scope, recipientAccountId: target.accountId ?? "", recipient: target.collaborator }, {}, catalog)
    if (!verdict.ok) return { ok: false, reason: "TARGET_MORE_PRIVILEGED" }
  }
  return { ok: true }
}
