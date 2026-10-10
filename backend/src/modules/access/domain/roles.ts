import type { AccessScopeType } from "./access-scope.js"
import type { Permission } from "./permissions.js"

/**
 * PAPÉIS DE SISTEMA (V1.5.7) — pacotes de permissões, nunca cargos. O conjunto é mínimo e fica em código por enquanto; a
 * resolução passa por `RoleCatalog` (porta), então papéis configurados pelo tenant podem entrar depois sem trocar a
 * autorização (a atribuição guarda só o código do papel).
 *
 * `delegates` = papéis que um titular DESTE papel pode atribuir a outros (sempre dentro do escopo dele): ninguém concede
 * mais autoridade do que está autorizado a delegar. `allowedScopes` = escopos em que o papel pode ser atribuído.
 */
export type RoleDefinition = { code: string; name: string; description: string; permissions: readonly Permission[]; allowedScopes: readonly AccessScopeType[]; delegates: readonly string[]; system: true }

const ACCESS_ADMIN_PERMISSIONS: readonly Permission[] = ["access.users.view", "access.users.manage", "access.roles.view", "access.roles.assign"]

export const SYSTEM_ROLES: readonly RoleDefinition[] = [
  {
    code: "ADMINISTRADOR_GERAL",
    name: "Administrador geral",
    description: "Autoridade ampla no tenant: todas as permissões, sempre na organização inteira. Pode cadastrar outros administradores.",
    permissions: ["access.users.view", "access.users.manage", "access.roles.view", "access.roles.assign", "people.manage", "agents.manage", "knowledge.manage", "workflows.manage", "configuration.manage", "data_hub.manage", "ai.view", "ai.manage", "qa_lab.use", "feedback_quality_review.view", "feedback_quality_review.decide", "indicators.view", "structure.metrics.view", "calendar.manage", "assistant_conversations.view", "inia_experience.manage", "usability.view", "usability.users.view", "usability.export", "usability.comments.view", "usability.manage"],
    allowedScopes: ["ORGANIZATION"],
    delegates: ["ADMINISTRADOR_GERAL", "ADMINISTRADOR", "ADMINISTRADOR_DE_ACESSOS", "QA_DE_FEEDBACK", "LEITOR_DE_CONVERSAS_INIA", "ANALISTA_DE_USABILIDADE", "LEITOR_DE_USABILIDADE"],
    system: true,
  },
  {
    code: "ADMINISTRADOR",
    name: "Administrador",
    description: "Administra usuários, agentes, workflows e configurações e vê Indicadores, dados de gestão da Estrutura e o Calendário da equipe dentro do escopo atribuído. Não usa o QA Lab nem altera IA.",
    permissions: [...ACCESS_ADMIN_PERMISSIONS, "people.manage", "agents.manage", "knowledge.manage", "workflows.manage", "configuration.manage", "data_hub.manage", "ai.view", "indicators.view", "structure.metrics.view", "calendar.manage"],
    allowedScopes: ["ORGANIZATION", "GROUP", "SUBGROUP"],
    delegates: ["ADMINISTRADOR", "ADMINISTRADOR_DE_ACESSOS", "QA_DE_FEEDBACK", "LEITOR_DE_CONVERSAS_INIA", "ANALISTA_DE_USABILIDADE", "LEITOR_DE_USABILIDADE"],
    system: true,
  },
  {
    code: "ADMINISTRADOR_DE_ACESSOS",
    name: "Administrador de acessos",
    description: "Administra contas, papéis e concessões dentro do escopo — sem agentes, workflows, configurações ou QA.",
    permissions: ACCESS_ADMIN_PERMISSIONS,
    allowedScopes: ["ORGANIZATION", "GROUP", "SUBGROUP"],
    delegates: ["ADMINISTRADOR_DE_ACESSOS", "QA_DE_FEEDBACK", "LEITOR_DE_CONVERSAS_INIA", "ANALISTA_DE_USABILIDADE", "LEITOR_DE_USABILIDADE"],
    system: true,
  },
  {
    code: "QA_DE_FEEDBACK",
    name: "QA de feedback",
    description: "Avalia a qualidade dos feedbacks escritos pela INIA (QA Lab › Feedbacks) no escopo atribuído.",
    permissions: ["feedback_quality_review.view", "feedback_quality_review.decide"],
    allowedScopes: ["ORGANIZATION", "GROUP", "SUBGROUP", "MY_STRUCTURE"],
    delegates: [],
    system: true,
  },
  {
    // Gestores (Diretor, Gerente Sênior, Gerente, Coordenador, Supervisor) recebem este papel com escopo "Minha
    // estrutura" — leitura das conversas de quem está abaixo deles. Cargo não concede: a atribuição é explícita
    // (individual ou pela ação "Conceder aos gestores", ambas auditadas). Não abre nenhum outro módulo da Administração.
    code: "LEITOR_DE_CONVERSAS_INIA",
    name: "Leitor de conversas da INIA",
    description: "Lê, sem editar nem enviar mensagens, as conversas dos colaboradores com a INIA dentro do escopo (para gestores: a própria estrutura).",
    permissions: ["assistant_conversations.view"],
    allowedScopes: ["ORGANIZATION", "GROUP", "SUBGROUP", "MY_STRUCTURE"],
    delegates: [],
    system: true,
  },
  {
    // Monitoria de usabilidade com pessoas identificadas e exportação — concessão EXPLÍCITA (nenhum gestor recebe por cargo).
    // Comentários das avaliações negativas e configuração da coleta ficam fora (só o Administrador geral).
    code: "ANALISTA_DE_USABILIDADE",
    name: "Analista de usabilidade",
    description: "Vê a Monitoria de usabilidade com pessoas identificadas, detalhe individual e exportação CSV, dentro do escopo. Não lê conteúdo de conversas nem comentários de avaliação.",
    permissions: ["usability.view", "usability.users.view", "usability.export"],
    allowedScopes: ["ORGANIZATION", "GROUP", "SUBGROUP", "MY_STRUCTURE"],
    delegates: [],
    system: true,
  },
  {
    code: "LEITOR_DE_USABILIDADE",
    name: "Leitor de usabilidade (agregados)",
    description: "Vê só os números agregados da Monitoria de usabilidade no escopo — sem nomes, ids, detalhe individual nem exportação.",
    permissions: ["usability.view"],
    allowedScopes: ["ORGANIZATION", "GROUP", "SUBGROUP", "MY_STRUCTURE"],
    delegates: [],
    system: true,
  },
]

/** Porta de catálogo: hoje só os papéis de sistema; papéis do tenant entram aqui no futuro. */
export type RoleCatalog = { find(code: string): RoleDefinition | null; all(): readonly RoleDefinition[] }
export const systemRoleCatalog: RoleCatalog = { find: (code) => SYSTEM_ROLES.find((role) => role.code === code) ?? null, all: () => SYSTEM_ROLES }

/** Papel que protege o tenant de ficar sem ninguém capaz de administrar acessos. */
export const TENANT_ADMIN_ROLE = "ADMINISTRADOR_GERAL"
export const rolesWithPermission = (permission: Permission, catalog: RoleCatalog = systemRoleCatalog) => catalog.all().filter((role) => role.permissions.includes(permission)).map((role) => role.code)
