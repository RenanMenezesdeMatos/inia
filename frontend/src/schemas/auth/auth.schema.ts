import { z } from "zod"

export const platformRoleSchema = z.enum([
  "OPERATOR",
  "ADMIN",
  "COORDINATOR",
  "SUPERVISOR",
  "MANAGER",
  "SENIOR_MANAGER",
  "DIRECTOR",
])
export type PlatformRole = z.infer<typeof platformRoleSchema>

/**
 * NÍVEL HIERÁRQUICO da pessoa (`people.role`) — dado ORGANIZACIONAL, nunca acesso (V1.5.7). Acesso vem de PAPÉIS atribuídos
 * à conta (`access` abaixo). "ADMIN" é legado: pessoa fora da hierarquia operacional; não concede nada.
 */
export const ROLE_LABELS: Record<PlatformRole, string> = {
  OPERATOR: "Operador",
  ADMIN: "Fora da hierarquia",
  COORDINATOR: "Coordenador",
  SUPERVISOR: "Supervisor",
  MANAGER: "Gerente",
  SENIOR_MANAGER: "Gerente Sênior",
  DIRECTOR: "Diretor",
}

export const loginInputSchema = z.object({
  email: z.string().trim().email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe sua senha."),
})
export type LoginInput = z.infer<typeof loginInputSchema>

const identityFields = {
  avatarUrl: z.string().nullable(),
  jobTitle: z.string().nullable(),
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
}

const capability = z.boolean().default(false)
export const accessCapabilitiesSchema = z.object({
  canAccessAdministration: capability,
  canManageUsers: capability,
  canViewUsers: capability,
  canViewRoles: capability,
  canAssignRoles: capability,
  canManagePeople: capability,
  canManageAgents: capability,
  canManageKnowledge: capability,
  canManageWorkflows: capability,
  canManageConfiguration: capability,
  canManageDataHub: capability,
  canViewAi: capability,
  canUseQaLab: capability,
  canReviewFeedback: capability,
  // V1.5.8: visões ampliadas por permission + scope (o recorte de quem aparece é sempre do backend).
  canViewIndicators: capability,
  canViewStructureMetrics: capability,
  canManageCalendar: capability,
  // Conversas com a INIA (somente leitura) — fora de canAccessAdministration: abre só esta área da Administração.
  canViewAssistantConversations: capability,
  // Contestações de feedback (revisão humana): abre só essa área da Administração para quem só tem o papel de revisor.
  canReviewFeedbackContestations: capability,
  // Pedido do titular (LGPD): exportar todos os dados ligados a uma pessoa (só com escopo de organização).
  canExportSubjectData: capability,
  // Diagnóstico: quem LIDERA alguém (subárvore real) OU tem `indicators.view` — mesma regra da API (o recorte é do backend).
  canViewDiagnostics: capability,
  // Reports recorrentes: quem lidera/tem acesso de consulta (para si) ou tem o papel Report (distribuir). O recorte é do backend.
  canUseReports: capability,
  canDistributeReports: capability,
  // Cenário da INIA (fundo atrás do avatar) — só o Administrador geral, na organização inteira.
  canManageIniaScenes: capability,
  // Monitoria de usabilidade — fora de canAccessAdministration (como as conversas): quem só tem a monitoria vê só ela.
  canViewUsability: capability,
  canViewUsabilityPeople: capability,
  canExportUsability: capability,
  canViewUsabilityComments: capability,
  canManageUsability: capability,
  // Políticas de acompanhamento (configurar) × intervenções (agir sobre colaboradores) — sempre separadas.
  canAccessInterventionPolicies: capability,
  canEditInterventionPolicies: capability,
  canSimulateInterventionPolicies: capability,
  canPublishInterventionPolicies: capability,
  canAuditInterventionPolicies: capability,
  canViewInterventions: capability,
  canExecuteInterventions: capability,
  canApproveInterventions: capability,
  canDecideSensitiveInterventions: capability,
})
export type AccessCapabilities = z.infer<typeof accessCapabilitiesSchema>
/** Capabilities vazias (deny by default) — quando a sessão ainda não foi lida. */
export const NO_ACCESS_CAPABILITIES: AccessCapabilities = accessCapabilitiesSchema.parse({})

/**
 * V1.5.8 — links de UI que dependem de ACESSO (nunca do nível hierárquico): "Gerenciar" (cadastro de pessoas) e "Origem do
 * dado" (lineage da Central de Dados). O backend revalida no recurso.
 */
export const profileLinksFor = (capabilities: AccessCapabilities) => ({
  manageHref: capabilities.canManagePeople || capabilities.canViewUsers ? "/admin/users" : null,
  canSeeLineage: capabilities.canManageDataHub,
})
export const accessSchema = z.object({
  permissions: z.array(z.string()),
  capabilities: accessCapabilitiesSchema,
  roles: z.array(z.object({ roleCode: z.string(), roleName: z.string(), scopeType: z.string() })),
})

export const featuresSchema = z.object({
  interactionFeedbackQa: z.boolean().default(false),
  // Monitoria de usabilidade: coleta de uso (navegador) e painel ligam separados no ambiente.
  usageCollection: z.boolean().default(false),
  usabilityPanel: z.boolean().default(false),
})
export type Features = z.infer<typeof featuresSchema>

export const currentUserSchema = z.object({
  sub: z.string(),
  personId: z.string(),
  organizationId: z.string(),
  role: platformRoleSchema,
  /** Nome CADASTRAL (fornecido pelo cliente). Para mostrar a pessoa use `displayName`/`addressName` — nunca derive aqui. */
  name: z.string(),
  email: z.string(),
  ...identityFields,
  // Apresentação resolvida pelo backend (preferência da pessoa × cadastro), lida AO VIVO a cada /auth/me.
  preferredName: z.string().nullable().default(null),
  displayName: z.string().optional(),
  addressName: z.string().nullable().optional(),
  avatarSource: z.enum(["CUSTOM", "CORPORATE", "NONE"]).optional(),
  // Acesso calculado AO VIVO pelo backend a partir dos papéis da conta (V1.5.7). A UI só esconde/mostra — o backend autoriza.
  access: accessSchema.default(() => ({ permissions: [], capabilities: accessCapabilitiesSchema.parse({}), roles: [] })),
  // Primeiro acesso: entrou com senha temporária e ainda não criou a própria. Enquanto true, a sessão não tem acesso a nada
  // (o backend devolve permissões vazias e bloqueia as APIs) — a UI só leva à tela de criar a senha.
  passwordChangeRequired: z.boolean().default(false),
  temporaryPasswordExpiresAt: z.string().nullable().default(null),
  // Sessão parada além disso é encerrada pelo servidor; a tela avisa antes. 0 = sem encerramento por inatividade.
  sessionIdleTimeoutMinutes: z.number().int().min(0).default(0),
  // Módulos LIGADOS neste ambiente (não é permissão). Módulo desligado ≠ sem permissão: a UI esconde o módulo, nunca diz
  // "sem permissão" por causa de uma flag (V1.5.8a).
  features: featuresSchema.default(() => featuresSchema.parse({})),
})
export type CurrentUser = z.infer<typeof currentUserSchema>

/** Nome de identificação da sessão (cabeçalho, menu): o escolhido pela pessoa; senão o cadastral. */
export const sessionDisplayName = (user: Pick<CurrentUser, "name" | "displayName">) => user.displayName ?? user.name

export const loggedInUserSchema = z.object({
  id: z.string(),
  personId: z.string(),
  name: z.string(),
  role: platformRoleSchema,
  email: z.string(),
  ...identityFields,
  passwordChangeRequired: z.boolean().default(false),
})
export type LoggedInUser = z.infer<typeof loggedInUserSchema>
