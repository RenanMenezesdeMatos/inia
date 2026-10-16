import { describe, expect, it } from "vitest"
import { accessCapabilities, canAnywhere, canOnCollaborator, canOrganizationWide, effectivePermissions, type AccessContext } from "../domain/access-decision.js"
import { scopeCovers } from "../domain/access-scope.js"
import { SYSTEM_ROLES } from "../domain/roles.js"
import { createInMemoryAccessRepository, createInMemoryAccountAccessRepository, type MemAssignment } from "../testing/in-memory-access-repository.js"
import { assignRole, assignRoleToLeaders, describeAccess, getAccount, listAccounts, listRoles, revokeRole, visibilityOf, wouldRemoveLastTenantAdmin } from "./access-service.js"
import { disableAccess, enableAccess, issueTemporaryPassword, listIdentifiedUsers, type AccountAccessDeps } from "./account-access-service.js"

const ORG = "00000000-0000-4000-8000-00000000a001"
const OTHER_ORG = "00000000-0000-4000-8000-00000000b001"
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const T_B2B = id(900), T_COB = id(901), S_CONTAS = id(910), S_PREMIUM = id(911), S_COB = id(912)
const person = (n: number, name: string, jobTitle: string, level: string, teamId: string | null, subteamId: string | null, organizationId = ORG) => ({ id: id(n), organizationId, name, jobTitle, level, active: true, teamId, subteamId })
const PEOPLE = {
  geral: person(1, "Admin Geral", "Administradora", "ADMIN", null, null),
  maria: person(2, "Maria", "Assistente", "OPERATOR", T_B2B, S_CONTAS),
  joao: person(3, "João", "Supervisor", "SUPERVISOR", T_B2B, S_CONTAS),
  carlos: person(4, "Carlos", "Supervisor", "SUPERVISOR", T_B2B, S_PREMIUM),
  ana: person(5, "Ana", "Coordenadora", "COORDINATOR", T_B2B, null),
  adminContas: person(6, "Admin Contas", "Analista", "OPERATOR", T_B2B, S_CONTAS),
  pedro: person(7, "Pedro", "Operador", "OPERATOR", T_COB, S_COB),
  novo: person(8, "Novo", "Assistente", "OPERATOR", T_B2B, S_CONTAS),
  externo: person(9, "Externo", "Supervisor", "SUPERVISOR", null, null, OTHER_ORG),
}
const ACCOUNT = (n: number) => id(100 + n)
const accountOf = (key: keyof typeof PEOPLE) => ({ id: ACCOUNT(PEOPLE[key].id.endsWith("8") ? 8 : Number(PEOPLE[key].id.slice(-1))), organizationId: PEOPLE[key].organizationId, personId: PEOPLE[key].id, email: `${key}@inia.local`, active: true })
const grant = (key: keyof typeof PEOPLE, roleCode: string, scope: MemAssignment["scope"]): MemAssignment => ({ id: `${key}-${roleCode}`, organizationId: PEOPLE[key].organizationId, accountId: accountOf(key).id, roleCode, scope, grantedByAccountId: null, grantedAt: new Date(0), revokedAt: null, revokedByAccountId: null, reason: null })
const NOW = () => new Date("2026-09-25T12:00:00Z")

function setup() {
  const memory = createInMemoryAccessRepository({
    people: Object.values(PEOPLE).map((entry) => ({ ...entry })),
    accounts: (["geral", "maria", "joao", "carlos", "ana", "adminContas", "pedro", "externo"] as const).map(accountOf),
    teams: [{ id: T_B2B, organizationId: ORG, name: "B2B" }, { id: T_COB, organizationId: ORG, name: "Cobrança" }],
    subteams: [{ id: S_CONTAS, teamId: T_B2B, name: "Contas" }, { id: S_PREMIUM, teamId: T_B2B, name: "Premium" }, { id: S_COB, teamId: T_COB, name: "Cobrança Geral" }],
    assignments: [
      grant("geral", "ADMINISTRADOR_GERAL", { type: "ORGANIZATION" }),
      grant("maria", "QA_DE_FEEDBACK", { type: "SUBGROUP", subteamId: S_CONTAS, teamId: T_B2B }),
      grant("carlos", "ADMINISTRADOR", { type: "GROUP", teamId: T_B2B }),
      grant("ana", "ADMINISTRADOR_DE_ACESSOS", { type: "ORGANIZATION" }),
      grant("adminContas", "ADMINISTRADOR", { type: "SUBGROUP", subteamId: S_CONTAS, teamId: T_B2B }),
    ],
  })
  const deps = { repository: memory.repository, now: NOW }
  const accountDeps: AccountAccessDeps = { ...deps, accounts: createInMemoryAccountAccessRepository(memory, { teams: [{ id: T_B2B, name: "B2B" }, { id: T_COB, name: "Cobrança" }], subteams: [{ id: S_CONTAS, name: "Contas" }, { id: S_PREMIUM, name: "Premium" }, { id: S_COB, name: "Cobrança Geral" }] }), hashPassword: async (plain) => `hash:${plain}`, generatePassword: (() => { let n = 0; return () => `Temp-${++n}-Aa` })(), temporaryPasswordTtlHours: 72 }
  const actor = (key: keyof typeof PEOPLE) => ({ organizationId: PEOPLE[key].organizationId, accountId: accountOf(key).id, personId: PEOPLE[key].id })
  const context = (key: keyof typeof PEOPLE) => memory.repository.loadContext(PEOPLE[key].organizationId, accountOf(key).id)
  return { memory, deps, accountDeps, actor, context }
}
const collaborator = (key: keyof typeof PEOPLE) => ({ personId: PEOPLE[key].id, teamId: PEOPLE[key].teamId, subteamId: PEOPLE[key].subteamId })

describe("V1.5.7 — papéis e permissões (domínio)", () => {
  it("papel = pacote de permissões; nenhum papel é bypass; escopo cobre/contém corretamente", () => {
    const byCode = Object.fromEntries(SYSTEM_ROLES.map((role) => [role.code, role]))
    expect(byCode.ADMINISTRADOR_DE_ACESSOS!.permissions).toEqual(["access.users.view", "access.users.manage", "access.roles.view", "access.roles.assign"])
    expect(byCode.QA_DE_FEEDBACK!.permissions).toEqual(["feedback_quality_review.view", "feedback_quality_review.decide"])
    expect(byCode.ADMINISTRADOR!.permissions).not.toContain("qa_lab.use")
    expect(byCode.ADMINISTRADOR!.permissions).not.toContain("ai.manage")
    expect(byCode.ADMINISTRADOR_GERAL!.allowedScopes).toEqual(["ORGANIZATION"])
    expect(scopeCovers({ type: "GROUP", teamId: T_B2B }, { type: "SUBGROUP", subteamId: S_CONTAS, teamId: T_B2B })).toBe(true)
    expect(scopeCovers({ type: "SUBGROUP", subteamId: S_CONTAS, teamId: T_B2B }, { type: "GROUP", teamId: T_B2B })).toBe(false)
    expect(scopeCovers({ type: "GROUP", teamId: T_B2B }, { type: "SUBGROUP", subteamId: S_COB, teamId: T_COB })).toBe(false)
    expect(scopeCovers({ type: "GROUP", teamId: T_B2B }, { type: "MY_STRUCTURE" })).toBe(false)
    expect(scopeCovers({ type: "ORGANIZATION" }, { type: "MY_STRUCTURE" })).toBe(true)
  })
  it("deny by default: sem atribuição, papel desconhecido ou nada no escopo → nega", () => {
    const empty = { organizationId: ORG, accountId: "a", personId: "p", assignments: [] }
    expect(effectivePermissions(empty)).toEqual([])
    expect(Object.values(accessCapabilities(empty)).every((value) => value === false)).toBe(true)
    const unknown = { ...empty, assignments: [{ id: "x", roleCode: "SUPER_ROOT", scope: { type: "ORGANIZATION" as const } }] }
    expect(effectivePermissions(unknown)).toEqual([])
    expect(canAnywhere(unknown, "access.users.manage")).toBe(false)
  })
})

describe("V1.5.7 — cenários de aceitação", () => {
  it("A — João (cargo Supervisor, sem papel): não administra, não acessa QA — cargo não concede nada", async () => {
    const s = setup()
    const joao = await s.context("joao")
    expect(effectivePermissions(joao)).toEqual([])
    expect(accessCapabilities(joao)).toMatchObject({ canAccessAdministration: false, canReviewFeedback: false, canManageUsers: false, canAssignRoles: false })
    await expect(listAccounts(s.deps, s.actor("joao"), { page: 1, pageSize: 20 })).rejects.toMatchObject({ statusCode: 403 })
    // D42 — supervisor sem papel tentando conceder acesso.
    await expect(assignRole(s.deps, s.actor("joao"), { accountId: accountOf("maria").id, roleCode: "QA_DE_FEEDBACK", scope: { type: "SUBGROUP", subteamId: S_CONTAS } })).rejects.toMatchObject({ code: "ACCESS_NOT_AUTHORIZED_TO_ASSIGN", statusCode: 403 })
  })
  it("B — Maria (cargo Assistente) com QA_DE_FEEDBACK em Contas: revisa Contas, nada fora; não administra usuários", async () => {
    const s = setup()
    const maria = await s.context("maria")
    expect(canOnCollaborator(maria, "feedback_quality_review.decide", collaborator("joao"), false)).toBe(true)
    expect(canOnCollaborator(maria, "feedback_quality_review.view", collaborator("pedro"), false)).toBe(false)
    expect(canOnCollaborator(maria, "feedback_quality_review.view", collaborator("carlos"), false)).toBe(false)
    expect(accessCapabilities(maria)).toMatchObject({ canReviewFeedback: true, canAccessAdministration: false, canManageUsers: false })
  })
  it("C — Carlos (cargo Supervisor) Administrador do Grupo B2B: administra só B2B", async () => {
    const s = setup()
    const carlos = await s.context("carlos")
    expect(canAnywhere(carlos, "agents.manage")).toBe(true)
    expect(canOrganizationWide(carlos, "agents.manage")).toBe(false)
    expect(canOrganizationWide(carlos, "qa_lab.use")).toBe(false)
    const visible = (await listAccounts(s.deps, s.actor("carlos"), { page: 1, pageSize: 50 })).items.map((item) => item.collaborator.name).sort()
    expect(visible).toEqual(["Admin Contas", "Ana", "Carlos", "João", "Maria"])
    await expect(getAccount(s.deps, s.actor("carlos"), accountOf("pedro").id)).rejects.toMatchObject({ statusCode: 404 })
    expect(await assignRole(s.deps, s.actor("carlos"), { accountId: accountOf("joao").id, roleCode: "QA_DE_FEEDBACK", scope: { type: "SUBGROUP", subteamId: S_CONTAS } })).toEqual({ id: expect.any(String) })
  })
  it("D — Ana (cargo Coordenadora) Administradora de acessos na organização: administra papéis permitidos; sem Workflow/Agents/QA", async () => {
    const s = setup()
    const ana = await s.context("ana")
    expect(accessCapabilities(ana)).toMatchObject({ canManageUsers: true, canAssignRoles: true, canManageAgents: false, canManageWorkflows: false, canReviewFeedback: false, canUseQaLab: false })
    expect(await assignRole(s.deps, s.actor("ana"), { accountId: accountOf("pedro").id, roleCode: "QA_DE_FEEDBACK", scope: { type: "GROUP", teamId: T_COB } })).toEqual({ id: expect.any(String) })
    // Não pode conceder o que dá mais autoridade do que ela está autorizada a delegar.
    await expect(assignRole(s.deps, s.actor("ana"), { accountId: accountOf("joao").id, roleCode: "ADMINISTRADOR", scope: { type: "SUBGROUP", subteamId: S_CONTAS } })).rejects.toMatchObject({ code: "ACCESS_ROLE_NOT_DELEGABLE" })
    expect((await listRoles(s.deps, s.actor("ana"))).filter((role) => role.assignableByYou).map((role) => role.code)).toEqual(["ADMINISTRADOR_DE_ACESSOS", "QA_DE_FEEDBACK", "LEITOR_DE_CONVERSAS_INIA", "ANALISTA_DE_USABILIDADE", "LEITOR_DE_USABILIDADE", "GESTOR_DE_POLITICAS_DE_ACOMPANHAMENTO", "ANALISTA_DE_ACOMPANHAMENTO", "REPORT"])
  })
  it("E — Administrador geral cria a conta de um colaborador e o torna Administrador escopado, sem mexer no cargo", async () => {
    const s = setup()
    const created = await enableAccess(s.accountDeps, s.actor("geral"), { personId: PEOPLE.novo.id, email: "novo@inia.local" })
    expect(await assignRole(s.deps, s.actor("geral"), { accountId: created.accountId, roleCode: "ADMINISTRADOR", scope: { type: "SUBGROUP", subteamId: S_CONTAS } })).toEqual({ id: expect.any(String) })
    const novo = s.memory.people.find((entry) => entry.id === PEOPLE.novo.id)!
    expect([novo.jobTitle, novo.level]).toEqual(["Assistente", "OPERATOR"])
    expect(accessCapabilities(await s.memory.repository.loadContext(ORG, created.accountId))).toMatchObject({ canManageAgents: true, canUseQaLab: false })
    await expect(enableAccess(s.accountDeps, s.actor("geral"), { personId: PEOPLE.novo.id, email: "outro@inia.local" })).rejects.toMatchObject({ code: "ACCESS_ALREADY_ENABLED" })
  })
  it("múltiplas atribuições somam permissões/escopos sem substituir uma à outra", async () => {
    const s = setup()
    await assignRole(s.deps, s.actor("geral"), { accountId: accountOf("maria").id, roleCode: "ADMINISTRADOR", scope: { type: "SUBGROUP", subteamId: S_CONTAS } })
    const maria = await s.context("maria")
    expect(maria.assignments.map((entry) => entry.roleCode).sort()).toEqual(["ADMINISTRADOR", "QA_DE_FEEDBACK"])
    expect(accessCapabilities(maria)).toMatchObject({ canReviewFeedback: true, canManageWorkflows: true })
  })
})

describe("V1.5.7 — delegação e escalada de privilégio (backend)", () => {
  it("Admin B2B não cria Admin da organização nem Administrador geral; não concede fora de B2B", async () => {
    const s = setup()
    await expect(assignRole(s.deps, s.actor("carlos"), { accountId: accountOf("joao").id, roleCode: "ADMINISTRADOR", scope: { type: "ORGANIZATION" } })).rejects.toMatchObject({ code: "ACCESS_SCOPE_EXCEEDS_GRANTOR" })
    await expect(assignRole(s.deps, s.actor("carlos"), { accountId: accountOf("joao").id, roleCode: "ADMINISTRADOR_GERAL", scope: { type: "ORGANIZATION" } })).rejects.toMatchObject({ code: "ACCESS_ROLE_NOT_DELEGABLE" })
    await expect(assignRole(s.deps, s.actor("carlos"), { accountId: accountOf("pedro").id, roleCode: "QA_DE_FEEDBACK", scope: { type: "SUBGROUP", subteamId: S_COB } })).rejects.toMatchObject({ code: "ACCESS_SCOPE_EXCEEDS_GRANTOR" })
  })
  it("Admin de Contas não concede QA de Cobrança nem dá papel a quem está fora de Contas", async () => {
    const s = setup()
    await expect(assignRole(s.deps, s.actor("adminContas"), { accountId: accountOf("maria").id, roleCode: "QA_DE_FEEDBACK", scope: { type: "GROUP", teamId: T_COB } })).rejects.toMatchObject({ code: "ACCESS_SCOPE_EXCEEDS_GRANTOR" })
    await expect(assignRole(s.deps, s.actor("adminContas"), { accountId: accountOf("pedro").id, roleCode: "QA_DE_FEEDBACK", scope: { type: "SUBGROUP", subteamId: S_CONTAS } })).rejects.toMatchObject({ code: "ACCESS_RECIPIENT_OUT_OF_SCOPE" })
    await expect(assignRole(s.deps, s.actor("adminContas"), { accountId: accountOf("joao").id, roleCode: "ADMINISTRADOR", scope: { type: "GROUP", teamId: T_B2B } })).rejects.toMatchObject({ code: "ACCESS_SCOPE_EXCEEDS_GRANTOR" })
  })
  it("auto-escalada bloqueada: ninguém concede papel a si mesmo (nem ampliando o próprio escopo)", async () => {
    const s = setup()
    await expect(assignRole(s.deps, s.actor("carlos"), { accountId: accountOf("carlos").id, roleCode: "ADMINISTRADOR", scope: { type: "ORGANIZATION" } })).rejects.toMatchObject({ code: "ACCESS_SELF_ASSIGNMENT" })
    await expect(assignRole(s.deps, s.actor("ana"), { accountId: accountOf("ana").id, roleCode: "QA_DE_FEEDBACK", scope: { type: "ORGANIZATION" } })).rejects.toMatchObject({ code: "ACCESS_SELF_ASSIGNMENT" })
    await expect(assignRole(s.deps, s.actor("geral"), { accountId: accountOf("geral").id, roleCode: "QA_DE_FEEDBACK", scope: { type: "ORGANIZATION" } })).rejects.toMatchObject({ code: "ACCESS_SELF_ASSIGNMENT" })
  })
  it("escopo incompatível com o papel, escopo de outra organização e papel inexistente são recusados", async () => {
    const s = setup()
    await expect(assignRole(s.deps, s.actor("geral"), { accountId: accountOf("maria").id, roleCode: "ADMINISTRADOR_GERAL", scope: { type: "GROUP", teamId: T_B2B } })).rejects.toMatchObject({ code: "ACCESS_SCOPE_NOT_ALLOWED_FOR_ROLE", statusCode: 422 })
    await expect(assignRole(s.deps, s.actor("geral"), { accountId: accountOf("maria").id, roleCode: "QA_DE_FEEDBACK", scope: { type: "GROUP", teamId: id(999) } })).rejects.toMatchObject({ code: "ACCESS_SCOPE_INVALID" })
    await expect(assignRole(s.deps, s.actor("geral"), { accountId: accountOf("maria").id, roleCode: "SUPER_ROOT", scope: { type: "ORGANIZATION" } })).rejects.toMatchObject({ code: "ACCESS_UNKNOWN_ROLE" })
  })
  it("isolamento entre organizações: conta de outra organização não existe para o ator; ator de outra org não tem acesso", async () => {
    const s = setup()
    await expect(assignRole(s.deps, s.actor("geral"), { accountId: accountOf("externo").id, roleCode: "QA_DE_FEEDBACK", scope: { type: "ORGANIZATION" } })).rejects.toMatchObject({ statusCode: 404 })
    expect(await describeAccess(s.deps, { organizationId: OTHER_ORG, accountId: accountOf("geral").id, personId: PEOPLE.geral.id })).toMatchObject({ permissions: [] })
  })
})

describe("V1.5.7 — revogação, auditoria, lockout e situação", () => {
  it("revogar: só quem poderia conceder; nunca apaga; auditoria estruturada de concessão e revogação", async () => {
    const s = setup()
    await expect(revokeRole(s.deps, s.actor("ana"), { accountId: accountOf("carlos").id, assignmentId: "carlos-ADMINISTRADOR" })).rejects.toMatchObject({ code: "ACCESS_ROLE_NOT_DELEGABLE" })
    await revokeRole(s.deps, s.actor("carlos"), { accountId: accountOf("maria").id, assignmentId: "maria-QA_DE_FEEDBACK", reason: "troca de função" })
    expect(s.memory.assignments.find((entry) => entry.id === "maria-QA_DE_FEEDBACK")).toMatchObject({ revokedByAccountId: accountOf("carlos").id, reason: "troca de função", revokedAt: NOW() })
    expect((await s.context("maria")).assignments).toEqual([])
    const granted = await assignRole(s.deps, s.actor("geral"), { accountId: accountOf("joao").id, roleCode: "QA_DE_FEEDBACK", scope: { type: "MY_STRUCTURE" } })
    expect(s.memory.audit.find((entry) => entry.entityId === granted.id)).toEqual({ organizationId: ORG, actorPersonId: PEOPLE.geral.id, action: "ACCESS_ROLE_GRANTED", entityId: granted.id, payload: { recipientAccountId: accountOf("joao").id, grantedByAccountId: accountOf("geral").id, roleCode: "QA_DE_FEEDBACK", permissions: ["feedback_quality_review.view", "feedback_quality_review.decide"], scope: { type: "MY_STRUCTURE" } } })
    expect(s.memory.audit.find((entry) => entry.action === "ACCESS_ROLE_REVOKED")).toMatchObject({ actorPersonId: PEOPLE.carlos.id, payload: { roleCode: "QA_DE_FEEDBACK", reason: "troca de função" } })
  })
  it("lockout: o último Administrador geral ativo não pode ser revogado nem desativado", async () => {
    const s = setup()
    await expect(revokeRole(s.deps, s.actor("geral"), { accountId: accountOf("geral").id, assignmentId: "geral-ADMINISTRADOR_GERAL" })).rejects.toMatchObject({ code: "ACCESS_LAST_TENANT_ADMIN", statusCode: 409 })
    expect(await wouldRemoveLastTenantAdmin(s.memory.repository, ORG, accountOf("geral").id)).toBe(true)
    await assignRole(s.deps, s.actor("geral"), { accountId: accountOf("ana").id, roleCode: "ADMINISTRADOR_GERAL", scope: { type: "ORGANIZATION" } })
    expect(await wouldRemoveLastTenantAdmin(s.memory.repository, ORG, accountOf("geral").id)).toBe(false)
    await revokeRole(s.deps, s.actor("geral"), { accountId: accountOf("geral").id, assignmentId: "geral-ADMINISTRADOR_GERAL" })
    expect((await s.context("geral")).assignments).toEqual([])
  })
  it("colaborador inativo: atribuições ficam no histórico, mas não se aplicam enquanto ele estiver inativo", async () => {
    const s = setup()
    s.memory.people.find((entry) => entry.id === PEOPLE.maria.id)!.active = false
    expect((await s.context("maria")).assignments).toEqual([])
    expect(s.memory.assignments.some((entry) => entry.id === "maria-QA_DE_FEEDBACK" && !entry.revokedAt)).toBe(true)
  })
})

describe("V1.5.8 — visões ampliadas no catálogo de papéis (permission + scope, nunca papel como bypass)", () => {
  const SURFACES = ["indicators.view", "structure.metrics.view", "calendar.manage"] as const
  const permissionsOf = (code: string) => SYSTEM_ROLES.find((role) => role.code === code)!.permissions

  it("Administrador geral e Administrador CONTÊM as três; Administrador de acessos e QA de feedback não recebem nenhuma", () => {
    for (const permission of SURFACES) {
      expect(permissionsOf("ADMINISTRADOR_GERAL")).toContain(permission)
      expect(permissionsOf("ADMINISTRADOR")).toContain(permission)
      expect(permissionsOf("ADMINISTRADOR_DE_ACESSOS")).not.toContain(permission)
      expect(permissionsOf("QA_DE_FEEDBACK")).not.toContain(permission)
    }
  })

  it("capabilities do /auth/me refletem as permissões efetivas (e nada vem do nível hierárquico)", () => {
    const context = (roleCode: string, scope: AccessContext["assignments"][number]["scope"]) => ({ organizationId: "o", accountId: "a", personId: "p", assignments: [{ id: "x", roleCode, scope }] })
    expect(accessCapabilities(context("ADMINISTRADOR", { type: "SUBGROUP", subteamId: "s", teamId: "t" }))).toMatchObject({ canViewIndicators: true, canViewStructureMetrics: true, canManageCalendar: true })
    expect(accessCapabilities(context("ADMINISTRADOR_DE_ACESSOS", { type: "ORGANIZATION" }))).toMatchObject({ canViewIndicators: false, canViewStructureMetrics: false, canManageCalendar: false })
    expect(accessCapabilities(context("QA_DE_FEEDBACK", { type: "ORGANIZATION" }))).toMatchObject({ canViewIndicators: false, canViewStructureMetrics: false, canManageCalendar: false })
    expect(accessCapabilities({ organizationId: "o", accountId: "a", personId: "p", assignments: [] })).toMatchObject({ canViewIndicators: false, canViewStructureMetrics: false, canManageCalendar: false, canAccessAdministration: false })
  })

  it("visibilidade do escopo: Administrador do Subgrupo Contas vê só Contas nas três superfícies", () => {
    const access = { organizationId: "o", accountId: "a", personId: "p", assignments: [{ id: "x", roleCode: "ADMINISTRADOR", scope: { type: "SUBGROUP" as const, subteamId: "contas", teamId: "fin" } }] }
    for (const permission of SURFACES) expect(visibilityOf(access, permission)).toEqual({ organizationWide: false, teamIds: [], subteamIds: ["contas"] })
  })
})

describe("Conversas com a INIA — papel de leitura e concessão aos gestores", () => {
  it("papel só com a permissão de leitura, em qualquer escopo (inclusive Minha estrutura); não abre a Administração", async () => {
    const role = SYSTEM_ROLES.find((entry) => entry.code === "LEITOR_DE_CONVERSAS_INIA")!
    expect(role.permissions).toEqual(["assistant_conversations.view"])
    expect(role.allowedScopes).toEqual(["ORGANIZATION", "GROUP", "SUBGROUP", "MY_STRUCTURE"])
    expect(SYSTEM_ROLES.find((entry) => entry.code === "ADMINISTRADOR_GERAL")!.permissions).toContain("assistant_conversations.view")
    // Administrador (não geral) não lê conversas por padrão — privacidade; precisa receber o papel.
    expect(SYSTEM_ROLES.find((entry) => entry.code === "ADMINISTRADOR")!.permissions).not.toContain("assistant_conversations.view")
    const s = setup()
    await assignRole(s.deps, s.actor("geral"), { accountId: accountOf("joao").id, roleCode: "LEITOR_DE_CONVERSAS_INIA", scope: { type: "MY_STRUCTURE" } })
    expect(accessCapabilities(await s.context("joao"))).toMatchObject({ canViewAssistantConversations: true, canAccessAdministration: false, canManageAgents: false, canViewUsers: false })
  })

  it("Conceder aos gestores: só quem lidera alguém, escopo Minha estrutura, idempotente, auditado, nunca a si mesmo", async () => {
    const s = setup()
    s.memory.people.find((entry) => entry.id === PEOPLE.maria.id)!.reportsToId = PEOPLE.joao.id
    s.memory.people.find((entry) => entry.id === PEOPLE.joao.id)!.reportsToId = PEOPLE.ana.id
    const result = await assignRoleToLeaders(s.deps, s.actor("geral"), { roleCode: "LEITOR_DE_CONVERSAS_INIA" })
    expect(result).toEqual({ leaders: 2, granted: 2, alreadyAssigned: 0, skipped: 0 })
    const holders = s.memory.assignments.filter((entry) => entry.roleCode === "LEITOR_DE_CONVERSAS_INIA")
    expect(holders.map((entry) => entry.accountId).sort()).toEqual([accountOf("joao").id, accountOf("ana").id].sort())
    expect(holders.every((entry) => entry.scope.type === "MY_STRUCTURE")).toBe(true)
    expect(s.memory.audit.filter((entry) => entry.action === "ACCESS_ROLE_GRANTED" && (entry.payload as { roleCode: string }).roleCode === "LEITOR_DE_CONVERSAS_INIA")).toHaveLength(2)
    expect(await assignRoleToLeaders(s.deps, s.actor("geral"), { roleCode: "LEITOR_DE_CONVERSAS_INIA" })).toEqual({ leaders: 2, granted: 0, alreadyAssigned: 2, skipped: 0 })
    // A própria Ana (lidera o João) tenta conceder: ela mesma é pulada (sem auto-concessão).
    const s2 = setup()
    s2.memory.people.find((entry) => entry.id === PEOPLE.joao.id)!.reportsToId = PEOPLE.ana.id
    expect(await assignRoleToLeaders(s2.deps, s2.actor("ana"), { roleCode: "LEITOR_DE_CONVERSAS_INIA" })).toEqual({ leaders: 1, granted: 0, alreadyAssigned: 0, skipped: 1 })
  })

  it("Conceder aos gestores exige poder atribuir e papel que aceite Minha estrutura", async () => {
    const s = setup()
    await expect(assignRoleToLeaders(s.deps, s.actor("maria"), { roleCode: "LEITOR_DE_CONVERSAS_INIA" })).rejects.toMatchObject({ code: "ACCESS_NOT_AUTHORIZED_TO_ASSIGN" })
    await expect(assignRoleToLeaders(s.deps, s.actor("geral"), { roleCode: "ADMINISTRADOR" })).rejects.toMatchObject({ code: "ACCESS_SCOPE_NOT_ALLOWED_FOR_ROLE" })
    // Administrador de Grupo não cobre "Minha estrutura" (só a organização cobre) → ninguém recebe.
    s.memory.people.find((entry) => entry.id === PEOPLE.maria.id)!.reportsToId = PEOPLE.joao.id
    expect(await assignRoleToLeaders(s.deps, s.actor("carlos"), { roleCode: "LEITOR_DE_CONVERSAS_INIA" })).toMatchObject({ granted: 0, skipped: 1 })
  })
})

describe("Liberação de acesso — habilitar, senha temporária e desabilitar (backend)", () => {
  const accountFor = (s: ReturnType<typeof setup>, key: keyof typeof PEOPLE) => s.memory.accounts.find((entry) => entry.personId === PEOPLE[key].id)!

  it("lista as pessoas JÁ identificadas (sem duplicar cadastro) com a situação do acesso; habilitar cria só a conta de login", async () => {
    const s = setup()
    const before = await listIdentifiedUsers(s.accountDeps, s.actor("geral"), { page: 1, pageSize: 50 })
    expect(before.total).toBe(Object.values(PEOPLE).filter((entry) => entry.organizationId === ORG).length)
    expect(before.items.find((item) => item.personId === PEOPLE.novo.id)).toMatchObject({ accessStatus: "DISABLED", account: null })
    expect(before.items.find((item) => item.personId === PEOPLE.maria.id)).toMatchObject({ accessStatus: "ACTIVE", account: { roles: [{ code: "QA_DE_FEEDBACK", name: "QA de feedback" }] } })

    await expect(enableAccess(s.accountDeps, s.actor("geral"), { personId: PEOPLE.novo.id })).rejects.toMatchObject({ code: "ACCESS_EMAIL_REQUIRED" })
    const issued = await enableAccess(s.accountDeps, s.actor("geral"), { personId: PEOPLE.novo.id, email: "  Novo@INIA.local " })
    expect(issued).toMatchObject({ personId: PEOPLE.novo.id, email: "novo@inia.local", temporaryPassword: "Temp-1-Aa", expiresAt: "2026-09-28T12:00:00.000Z" })
    const account = accountFor(s, "novo")
    // Só o hash fica; a pessoa continua a mesma (nenhum cadastro novo).
    expect(account).toMatchObject({ passwordHash: "hash:Temp-1-Aa", passwordChangeRequired: true })
    expect(s.memory.people.filter((entry) => entry.name === "Novo")).toHaveLength(1)
    const after = await listIdentifiedUsers(s.accountDeps, s.actor("geral"), { page: 1, pageSize: 50, status: "PENDING_PASSWORD_CHANGE" })
    expect(after.items.map((item) => item.personId)).toEqual([PEOPLE.novo.id])
    // Auditoria sem credencial.
    const entry = s.memory.audit.find((item) => item.action === "ACCESS_ENABLED")!
    expect(JSON.stringify(entry.payload)).not.toMatch(/Temp-1|hash:/)
    await expect(enableAccess(s.accountDeps, s.actor("geral"), { personId: PEOPLE.novo.id, email: "x@inia.local" })).rejects.toMatchObject({ code: "ACCESS_ALREADY_ENABLED" })
  })

  it("nova senha temporária invalida a anterior, exige nova troca e revoga as sessões (versão +1)", async () => {
    const s = setup()
    const before = accountFor(s, "maria").sessionVersion ?? 0
    const issued = await issueTemporaryPassword(s.accountDeps, s.actor("geral"), { accountId: accountOf("maria").id })
    expect(accountFor(s, "maria")).toMatchObject({ passwordHash: `hash:${issued.temporaryPassword}`, passwordChangeRequired: true, sessionVersion: before + 1 })
    const again = await issueTemporaryPassword(s.accountDeps, s.actor("geral"), { accountId: accountOf("maria").id })
    expect(again.temporaryPassword).not.toBe(issued.temporaryPassword)
    expect(accountFor(s, "maria")).toMatchObject({ passwordHash: `hash:${again.temporaryPassword}`, sessionVersion: before + 2 })
    expect(s.memory.audit.filter((item) => item.action === "ACCESS_TEMPORARY_PASSWORD_ISSUED")).toHaveLength(2)
  })

  it("desabilitar revoga as sessões e apaga a senha temporária pendente; reabilitar sempre gera outra temporária", async () => {
    const s = setup()
    await disableAccess(s.accountDeps, s.actor("geral"), { accountId: accountOf("pedro").id })
    expect(accountFor(s, "pedro")).toMatchObject({ active: false, passwordChangeRequired: false, sessionVersion: 1, accessDisabledAt: NOW() })
    await expect(disableAccess(s.accountDeps, s.actor("geral"), { accountId: accountOf("pedro").id })).rejects.toMatchObject({ code: "ACCESS_ALREADY_DISABLED" })
    await expect(issueTemporaryPassword(s.accountDeps, s.actor("geral"), { accountId: accountOf("pedro").id })).rejects.toMatchObject({ code: "ACCESS_NOT_ENABLED" })
    const issued = await enableAccess(s.accountDeps, s.actor("geral"), { personId: PEOPLE.pedro.id })
    expect(issued.email).toBe("pedro@inia.local")
    expect(accountFor(s, "pedro")).toMatchObject({ active: true, passwordChangeRequired: true, sessionVersion: 2, accessDisabledAt: null })
  })

  it("sem permissão = 403; fora do escopo = 404; nunca sobre o próprio acesso", async () => {
    const s = setup()
    await expect(listIdentifiedUsers(s.accountDeps, s.actor("maria"), { page: 1, pageSize: 20 })).rejects.toMatchObject({ statusCode: 403 })
    await expect(enableAccess(s.accountDeps, s.actor("maria"), { personId: PEOPLE.novo.id, email: "novo@inia.local" })).rejects.toMatchObject({ statusCode: 403 })
    await expect(disableAccess(s.accountDeps, s.actor("joao"), { accountId: accountOf("maria").id })).rejects.toMatchObject({ statusCode: 403 })
    await expect(issueTemporaryPassword(s.accountDeps, s.actor("carlos"), { accountId: accountOf("pedro").id })).rejects.toMatchObject({ statusCode: 404 })
    expect((await listIdentifiedUsers(s.accountDeps, s.actor("carlos"), { page: 1, pageSize: 50 })).items.map((item) => item.personId)).not.toContain(PEOPLE.pedro.id)
    await expect(issueTemporaryPassword(s.accountDeps, s.actor("geral"), { accountId: accountOf("geral").id })).rejects.toMatchObject({ code: "ACCESS_SELF_CREDENTIAL" })
    await expect(disableAccess(s.accountDeps, s.actor("carlos"), { accountId: accountOf("carlos").id })).rejects.toMatchObject({ code: "ACCESS_SELF_CREDENTIAL" })
  })

  it("custódia: só gera senha / desabilita quem tem papéis que você poderia conceder (sem tomar conta de admin mais forte)", async () => {
    const s = setup()
    // Carlos (Administrador do Grupo B2B) × Ana (Administradora de acessos na ORGANIZAÇÃO, lotada no B2B): não pode.
    await expect(issueTemporaryPassword(s.accountDeps, s.actor("carlos"), { accountId: accountOf("ana").id })).rejects.toMatchObject({ code: "ACCESS_TARGET_MORE_PRIVILEGED", statusCode: 403 })
    await expect(disableAccess(s.accountDeps, s.actor("ana"), { accountId: accountOf("geral").id })).rejects.toMatchObject({ code: "ACCESS_TARGET_MORE_PRIVILEGED" })
    // Carlos × Admin Contas (Administrador do Subgrupo Contas, dentro do Grupo dele): pode.
    expect(await issueTemporaryPassword(s.accountDeps, s.actor("carlos"), { accountId: accountOf("adminContas").id })).toMatchObject({ accountId: accountOf("adminContas").id })
    // Sem papéis, qualquer administrador de acessos que alcança a pessoa pode.
    expect(await issueTemporaryPassword(s.accountDeps, s.actor("ana"), { accountId: accountOf("joao").id })).toMatchObject({ accountId: accountOf("joao").id })
  })

  it("pessoa inativa no cadastro não recebe acesso; e-mail já usado por outra conta é recusado", async () => {
    const s = setup()
    s.memory.people.find((entry) => entry.id === PEOPLE.novo.id)!.active = false
    await expect(enableAccess(s.accountDeps, s.actor("geral"), { personId: PEOPLE.novo.id, email: "novo@inia.local" })).rejects.toMatchObject({ code: "ACCESS_PERSON_INACTIVE" })
    s.memory.people.find((entry) => entry.id === PEOPLE.novo.id)!.active = true
    await expect(enableAccess(s.accountDeps, s.actor("geral"), { personId: PEOPLE.novo.id, email: "maria@inia.local" })).rejects.toMatchObject({ code: "EMAIL_ALREADY_IN_USE" })
  })

  it("conflito: escrita otimista pela versão de sessão — outra alteração no meio do caminho não é sobrescrita", async () => {
    const s = setup()
    const deps: AccountAccessDeps = { ...s.accountDeps, accounts: { ...s.accountDeps.accounts, targetByAccount: async (organizationId, accountId) => { const found = await s.accountDeps.accounts.targetByAccount(organizationId, accountId); return found && found.account ? { ...found, account: { ...found.account, sessionVersion: 99 } } : found } } }
    await expect(issueTemporaryPassword(deps, s.actor("geral"), { accountId: accountOf("maria").id })).rejects.toMatchObject({ code: "ACCESS_CONCURRENT_CHANGE", statusCode: 409 })
    expect(accountFor(s, "maria").passwordChangeRequired).toBeFalsy()
  })
})

describe("Políticas de acompanhamento — configurar não é agir sobre colaboradores", () => {
  it("o gestor de políticas não tem nenhuma permissão sobre colaboradores; a decisão sensível nunca vem com papel administrativo", async () => {
    const { systemRoleCatalog } = await import("../domain/roles.js")
    const manager = systemRoleCatalog.find("GESTOR_DE_POLITICAS_DE_ACOMPANHAMENTO")!
    expect(manager.permissions).toEqual(["intervention_policies.edit", "intervention_policies.simulate", "intervention_policies.publish", "intervention_policies.audit"])
    for (const code of ["ADMINISTRADOR_GERAL", "ADMINISTRADOR", "ADMINISTRADOR_DE_ACESSOS", "ANALISTA_DE_ACOMPANHAMENTO"]) {
      expect(systemRoleCatalog.find(code)!.permissions, code).not.toContain("interventions.sensitive_decide")
    }
    expect(systemRoleCatalog.find("ADMINISTRADOR_GERAL")!.permissions).not.toContain("interventions.execute")
    // Só o Administrador geral delega a decisão sensível.
    expect(systemRoleCatalog.all().filter((role) => role.delegates.includes("AVALIADOR_DE_CONTINUIDADE")).map((role) => role.code)).toEqual(["ADMINISTRADOR_GERAL"])
  })
})
