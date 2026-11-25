import { describe, expect, it } from "vitest"
import { explainCode } from "../../../shared/domain/errors/error-lookup.js"
import { createInMemoryAccessRepository, createInMemoryAccountAccessRepository, type MemAccount, type MemAssignment, type MemPerson } from "../testing/in-memory-access-repository.js"
import { disableAccess, enableAccess, issueTemporaryPassword, listIdentifiedUsers, type AccountAccessDeps } from "./account-access-service.js"
import { checkNetworkLogin } from "./network-check-service.js"
import { applyNetworkEnable, previewNetworkEnable } from "./network-enable-service.js"

/** Habilitar pela rede (AD), uma a uma e por CSV: sem senha, com as mesmas regras de escopo e custódia. */
const ORG = "00000000-0000-4000-8000-000000000001"
const T_A = "team-a"
const T_B = "team-b"
const NOW = new Date("2026-11-25T12:00:00Z")
const person = (id: string, matricula: string | null, patch: Partial<MemPerson> = {}): MemPerson => ({ id, organizationId: ORG, name: `Pessoa ${id}`, jobTitle: null, level: "OPERATOR", active: true, teamId: T_A, subteamId: null, matricula, ...patch })
const account = (personId: string, patch: Partial<MemAccount> = {}): MemAccount => ({ id: `acc-${personId}`, organizationId: ORG, personId, email: `${personId}@inia.local`, active: true, sessionVersion: 0, credentialProvider: "NETWORK", ...patch })
const role = (personId: string, roleCode: string, scope: MemAssignment["scope"]): MemAssignment => ({ id: `${personId}-${roleCode}`, organizationId: ORG, accountId: `acc-${personId}`, roleCode, scope, grantedByAccountId: null, grantedAt: NOW, revokedAt: null, revokedByAccountId: null, reason: null })

function setup(options: { enabled?: boolean; domain?: string | null } = {}) {
  const networkLogin = { enabled: options.enabled ?? true }
  const memory = createInMemoryAccessRepository({
    people: [
      person("geral", "G0000001", { teamId: null }), person("acessos", "G0000002", { teamId: null }), person("acessosA", "G0000003"),
      person("novo", "G0000010"), person("desab", "G0000011"), person("ativo", "G0000012"), person("inativo", "G0000013", { active: false }),
      person("semMat", null), person("invalida", "G 00 14"), person("outroGrupo", "G0000015", { teamId: T_B }), person("emergencia", "G0000016"),
      person("admin", "G0000017"), person("lider", "G0000018"), person("liderado", "G0000019", { teamId: T_B, reportsToId: "lider" }),
      person("dupA", "G0000020"), person("dupB", "g0000020"), person("zero", "0000521"),
    ],
    accounts: [
      account("geral"), account("acessos"), account("acessosA"), account("desab", { active: false, accessDisabledAt: NOW }), account("ativo", { passwordChangeRequired: true, temporaryPasswordIssuedAt: NOW, temporaryPasswordExpiresAt: new Date(NOW.getTime() - 1) }),
      account("emergencia", { active: false, credentialProvider: "LOCAL" }), account("admin", { active: false }), account("dupA"),
    ],
    teams: [{ id: T_A, organizationId: ORG, name: "A" }, { id: T_B, organizationId: ORG, name: "B" }],
    subteams: [],
    assignments: [role("geral", "ADMINISTRADOR_GERAL", { type: "ORGANIZATION" }), role("acessos", "ADMINISTRADOR_DE_ACESSOS", { type: "ORGANIZATION" }), role("acessosA", "ADMINISTRADOR_DE_ACESSOS", { type: "GROUP", teamId: T_A }), role("admin", "ADMINISTRADOR_GERAL", { type: "ORGANIZATION" })],
  })
  const released: string[] = []
  const passwords: string[] = []
  const deps: AccountAccessDeps = {
    repository: memory.repository, now: () => NOW, accounts: createInMemoryAccountAccessRepository(memory, { teams: [], subteams: [], networkLogin }),
    hashPassword: async (plain) => { passwords.push(plain); return `hash:${plain}` }, temporaryPasswordTtlHours: 72,
    networkAttempts: {
      summaries: async (logins) => new Map(logins.map((login) => [login, { lockedUntil: new Date("2026-11-25T12:10:00Z"), last: { at: NOW, outcome: "INVALID_CREDENTIALS" as const, reason: "NETWORK_ACCOUNT_LOCKED" as const, directoryCode: "775" } }])),
      releaseUnreached: async (logins) => { released.push(...logins) },
    },
    networkLoginEnabled: async () => networkLogin.enabled, networkDomain: options.domain === undefined ? "empresa.local" : options.domain,
  }
  const actor = (id: string) => ({ organizationId: ORG, accountId: `acc-${id}`, personId: id })
  return { memory, deps, actor, released, passwords, networkLogin, accountOf: (id: string) => memory.accounts.find((entry) => entry.personId === id) }
}
const csv = (...lines: string[]) => Buffer.from(["matricula;email", ...lines].join("\r\n"), "utf8")

describe("habilitar uma pessoa pela rede", () => {
  it.each(["geral", "acessos", "acessosA"])("%s habilita sem gerar nem devolver senha; conta identificada pelo AD; trava das tentativas sem conta liberada", async (who) => {
    const s = setup()
    const result = await enableAccess(s.deps, s.actor(who), { personId: "novo" })
    expect(result).toEqual({ credential: "NETWORK", personId: "novo", accountId: expect.any(String), name: "Pessoa novo", matricula: "G0000010" })
    expect(s.accountOf("novo")).toMatchObject({ email: "g0000010@empresa.local", active: true, passwordChangeRequired: false, credentialProvider: "NETWORK" })
    expect(s.released).toEqual(["G0000010"])
    // A senha guardada é aleatória e longa, e não aparece em nenhum lugar da resposta nem da auditoria.
    expect(s.passwords).toHaveLength(1)
    expect(s.passwords[0]!.length).toBeGreaterThanOrEqual(40)
    expect(JSON.stringify([result, s.memory.audit])).not.toContain(s.passwords[0])
    expect(s.memory.audit.at(-1)).toMatchObject({ action: "ACCESS_ENABLED", actorPersonId: who, payload: { credential: "NETWORK", accountCreated: true, personId: "novo" } })
  })
  it("e-mail informado é usado; e-mail em uso é recusado; sem domínio do AD o e-mail é pedido", async () => {
    const s = setup()
    await enableAccess(s.deps, s.actor("geral"), { personId: "novo", email: " Novo@Empresa.com " })
    expect(s.accountOf("novo")!.email).toBe("novo@empresa.com")
    await expect(enableAccess(setup().deps, s.actor("geral"), { personId: "novo", email: "ativo@inia.local" })).rejects.toMatchObject({ code: "EMAIL_ALREADY_IN_USE", statusCode: 409 })
    await expect(enableAccess(setup({ domain: null }).deps, s.actor("geral"), { personId: "novo" })).rejects.toMatchObject({ code: "ACCESS_EMAIL_REQUIRED" })
  })
  it("reabilitar: mesma conta e mesmo e-mail, senha local antiga aposentada, sessões antigas caem", async () => {
    const s = setup()
    expect(await enableAccess(s.deps, s.actor("geral"), { personId: "desab" })).toMatchObject({ credential: "NETWORK", accountId: "acc-desab" })
    expect(s.accountOf("desab")).toMatchObject({ active: true, email: "desab@inia.local", sessionVersion: 1, passwordChangeRequired: false, accessDisabledAt: null })
    expect(s.accountOf("desab")!.passwordHash).toMatch(/^hash:/)
  })
  it.each([["inativo", "ACCESS_PERSON_INACTIVE"], ["semMat", "ACCESS_MATRICULA_REQUIRED"], ["invalida", "ACCESS_MATRICULA_INVALID"], ["dupB", "ACCESS_MATRICULA_DUPLICATED"], ["ativo", "ACCESS_ALREADY_ENABLED"], ["geral", "ACCESS_SELF_CREDENTIAL"]])("%s → %s (recusa o que faria a pessoa continuar sem entrar)", async (who, code) => {
    const s = setup()
    await expect(enableAccess(s.deps, s.actor("geral"), { personId: who })).rejects.toMatchObject({ code })
    expect(s.released).toEqual([])
  })
  it("escopo e custódia iguais: fora do escopo 404; quem tem papel maior e quem lidera fora do escopo 403", async () => {
    const s = setup()
    await expect(enableAccess(s.deps, s.actor("acessosA"), { personId: "outroGrupo" })).rejects.toMatchObject({ statusCode: 404 })
    await expect(enableAccess(s.deps, s.actor("acessos"), { personId: "admin" })).rejects.toMatchObject({ code: "ACCESS_TARGET_MORE_PRIVILEGED", statusCode: 403 })
    await expect(enableAccess(s.deps, s.actor("acessosA"), { personId: "lider" })).rejects.toMatchObject({ code: "ACCESS_TARGET_LEADS_OUTSIDE_SCOPE", statusCode: 403 })
    await expect(enableAccess(s.deps, s.actor("novo"), { personId: "desab" })).rejects.toMatchObject({ statusCode: 403 })
  })
  it("conta de emergência e login pela rede desligado: continua com senha temporária", async () => {
    const s = setup()
    expect(await enableAccess(s.deps, s.actor("geral"), { personId: "emergencia" })).toMatchObject({ credential: "TEMPORARY_PASSWORD", temporaryPassword: expect.any(String) })
    const off = setup({ enabled: false })
    expect(await enableAccess(off.deps, off.actor("geral"), { personId: "novo", email: "novo@empresa.com" })).toMatchObject({ credential: "TEMPORARY_PASSWORD" })
  })
  it("desabilitar e reabilitar pela rede vai e volta; senha temporária continua recusada", async () => {
    const s = setup()
    await disableAccess(s.deps, s.actor("geral"), { accountId: "acc-ativo" })
    expect(await enableAccess(s.deps, s.actor("geral"), { personId: "ativo" })).toMatchObject({ credential: "NETWORK" })
    await expect(issueTemporaryPassword(s.deps, s.actor("geral"), { accountId: "acc-ativo" })).rejects.toMatchObject({ code: "ACCESS_PASSWORD_MANAGED_BY_NETWORK" })
  })
  it("desabilitar, reabilitar pela rede e reabilitar com senha temporária esquecem o login do AD (ARQ12-04/ARQ12-10 da run-12)", async () => {
    const s = setup()
    s.accountOf("ativo")!.directoryLogin = "R456789"
    await disableAccess(s.deps, s.actor("geral"), { accountId: "acc-ativo" })
    expect(s.accountOf("ativo")!.directoryLogin).toBeNull()
    for (const who of ["desab", "emergencia"]) {
      s.accountOf(who)!.directoryLogin = "R456789"
      await enableAccess(s.deps, s.actor("geral"), { personId: who })
      expect(s.accountOf(who)!.directoryLogin, who).toBeNull()
    }
  })
})

describe("lista de Acessos com o login pela rede", () => {
  const rows = async (s: ReturnType<typeof setup>, who: string, filters = {}) => new Map((await listIdentifiedUsers(s.deps, s.actor(who), { page: 1, pageSize: 100, ...filters })).items.map((item) => [item.personId, item]))
  it("senha temporária que sobrou de antes não deixa a conta como pendente nem vencida", async () => {
    expect((await rows(setup(), "geral")).get("ativo")).toMatchObject({ accessStatus: "ACTIVE", temporaryPasswordExpired: false, enableCredential: "NETWORK" })
  })
  it("mostra o que impede a entrada e filtra só quem tem impedimento", async () => {
    const s = setup()
    const all = await rows(s, "geral")
    expect(Object.fromEntries(["novo", "inativo", "semMat", "invalida", "dupB", "emergencia"].map((id) => [id, all.get(id)!.networkIssue]))).toEqual({ novo: null, inativo: "PERSON_INACTIVE", semMat: "MATRICULA_MISSING", invalida: "MATRICULA_INVALID", dupB: "MATRICULA_DUPLICATED", emergencia: null })
    // Inativa sem acesso não é impedimento a resolver; inativa com a conta ainda habilitada é.
    expect([...(await rows(s, "geral", { networkIssue: true })).keys()].sort()).toEqual(["dupB", "invalida", "semMat"])
    s.memory.accounts.push(account("inativo"))
    expect([...(await rows(s, "geral", { networkIssue: true })).keys()].sort()).toEqual(["dupB", "inativo", "invalida", "semMat"])
  })
  it("trava temporária e resposta do AD só para quem GERENCIA acessos, do escopo dele, e nunca na conta de emergência", async () => {
    const s = setup()
    expect((await rows(s, "acessosA")).get("novo")!.networkAttempts).toMatchObject({ lockedUntil: new Date("2026-11-25T12:10:00Z"), last: { reason: "NETWORK_ACCOUNT_LOCKED" } })
    expect((await rows(s, "geral")).get("emergencia")!.networkAttempts).toBeNull()
    expect((await rows(s, "geral")).get("semMat")!.networkAttempts).toBeNull()
  })
})

describe("sinalização de qual login usar", () => {
  const withShort = () => {
    const s = setup()
    s.memory.people.push(person("curta", "R4567891"), person("inteira", "R5678901"), person("nova", "R6789012"))
    s.memory.accounts.push(account("curta", { directoryLogin: "R456789" }), account("inteira", { directoryLogin: "R5678901" }), account("nova"))
    const deps: AccountAccessDeps = { ...s.deps, shortLoginOf: (login) => (/^R\d{7}$/.test(login) ? login.slice(0, -1) : null) }
    return { ...s, guides: async (who: string) => new Map((await listIdentifiedUsers(deps, s.actor(who), { page: 1, pageSize: 100 })).items.map((item) => [item.personId, item])) }
  }
  it("a pessoa digita sempre a matrícula; o AD aparece como descoberto, a descobrir ou igual", async () => {
    const guides = await withShort().guides("geral")
    expect(guides.get("curta")!.loginGuide).toEqual({ kind: "NETWORK", typed: "R4567891", directoryLogins: ["R456789"], proven: true })
    expect(guides.get("inteira")!.loginGuide).toEqual({ kind: "NETWORK", typed: "R5678901", directoryLogins: ["R5678901"], proven: true })
    expect(guides.get("nova")!.loginGuide).toEqual({ kind: "NETWORK", typed: "R6789012", directoryLogins: ["R6789012", "R678901"], proven: false })
    expect(guides.get("novo")!.loginGuide).toEqual({ kind: "NETWORK", typed: "G0000010", directoryLogins: ["G0000010"], proven: false })
    expect(guides.get("emergencia")!.loginGuide).toEqual({ kind: "EMAIL", typed: "emergencia@inia.local", directoryLogins: [], proven: false })
    // Com impedimento no cadastro não existe login que funcione.
    for (const blocked of ["semMat", "invalida", "dupB", "inativo"]) expect(guides.get(blocked)!.loginGuide, blocked).toBeNull()
  })
  it("o login do AD só para quem gerencia acessos da pessoa; o campo interno não sai na resposta", async () => {
    const s = withShort()
    s.memory.assignments.push(role("acessosA", "ADMINISTRADOR_DE_ACESSOS", { type: "GROUP", teamId: T_A }))
    const guides = await s.guides("acessosA")
    expect(guides.get("curta")!.loginGuide).toMatchObject({ directoryLogins: ["R456789"] })
    expect(JSON.stringify([...guides.values()])).not.toContain("directoryLogin\":")
  })
})

describe("habilitar em massa (CSV)", () => {
  it("prévia classifica cada linha e não grava nada; aplicar habilita só as que podem, com auditoria do lote", async () => {
    const s = setup()
    const file = csv("g0000010;", "REDE\\G0000011;outro@x.co", "G0000012;", "G0000013;", "G0000099;", "G0000010;", "G0000016;", "G0000521;", "G0000001;", "G0000020;", "G00 14;", ";so@email.co", "G0000017;")
    const before = JSON.stringify(s.memory.accounts)
    const preview = await previewNetworkEnable(s.deps, s.actor("geral"), file)
    expect(preview.rows.map((row) => [row.line, row.outcome, row.refusal])).toEqual([
      [2, "CREATE", null], [3, "REENABLE", null], [4, "ALREADY_ENABLED", null], [5, "REFUSED", "PERSON_INACTIVE"], [6, "REFUSED", "PERSON_NOT_FOUND"], [7, "REFUSED", "DUPLICATE_IN_FILE"],
      [8, "REFUSED", "EMERGENCY_ACCOUNT"], [9, "REFUSED", "PERSON_NOT_FOUND"], [10, "REFUSED", "SELF_CREDENTIAL"], [11, "REFUSED", "MATRICULA_DUPLICATED"], [12, "REFUSED", "MATRICULA_INVALID"], [13, "REFUSED", "MATRICULA_REQUIRED"], [14, "REENABLE", null],
    ])
    // Prefixo ou zero que faltou: a pessoa vê qual era.
    expect(preview.rows[7]!.similar).toEqual(["0000521"])
    expect(preview.rows[1]!.emailIgnored).toBe(true)
    expect(preview.rows.slice(0, 5).map((row) => row.login)).toEqual(["G0000010", "G0000011", "G0000012", null, null])
    expect(preview.counts).toEqual({ CREATE: 1, REENABLE: 2, ALREADY_ENABLED: 1, REFUSED: 9 })
    expect(JSON.stringify(s.memory.accounts)).toBe(before)
    expect(s.released).toEqual([])

    const applied = await applyNetworkEnable(s.deps, s.actor("geral"), file)
    expect(applied.counts).toEqual(preview.counts)
    expect(s.accountOf("novo")).toMatchObject({ active: true, email: "g0000010@empresa.local" })
    expect(s.accountOf("desab")).toMatchObject({ active: true, email: "desab@inia.local" })
    expect(s.released.sort()).toEqual(["G0000010", "G0000011", "G0000017"])
    expect(s.memory.audit.filter((entry) => entry.payload.batchId === applied.batchId)).toHaveLength(3)
    expect(JSON.stringify(applied)).not.toMatch(/hash:|password/i)
    // De novo: nada a fazer, nada muda (idempotente).
    expect((await applyNetworkEnable(s.deps, s.actor("geral"), csv("G0000010;", "G0000011;"))).counts).toEqual({ CREATE: 0, REENABLE: 0, ALREADY_ENABLED: 2, REFUSED: 0 })
  })
  it("administrador de acessos de um Grupo: fora do escopo é 'não encontrada' (não revela quem existe) e a custódia vale por linha", async () => {
    const s = setup()
    const report = await previewNetworkEnable(s.deps, s.actor("acessosA"), csv("G0000015;", "G0000018;", "G0000017;", "G0000010;"))
    expect(report.rows.map((row) => [row.refusal, row.name])).toEqual([["PERSON_NOT_FOUND", null], ["TARGET_LEADS_OUTSIDE_SCOPE", "Pessoa lider"], ["TARGET_MORE_PRIVILEGED", "Pessoa admin"], [null, "Pessoa novo"]])
  })
  it("e-mail repetido no arquivo ou de outra conta recusa só a linha", async () => {
    const s = setup()
    s.memory.people.push(person("novo2", "G0000030"), person("novo3", "G0000031"))
    const report = await previewNetworkEnable(s.deps, s.actor("geral"), csv("G0000010;a@x.co", "G0000030;A@x.co", "G0000031;ativo@inia.local"))
    expect(report.rows.map((row) => row.refusal)).toEqual([null, "EMAIL_IN_USE", "EMAIL_IN_USE"])
  })
  it("sem permissão 403; login pela rede desligado 409; arquivo errado 422 — sempre antes de gravar", async () => {
    const s = setup()
    await expect(applyNetworkEnable(s.deps, s.actor("ativo"), csv("G0000010;"))).rejects.toMatchObject({ statusCode: 403 })
    await expect(applyNetworkEnable(setup({ enabled: false }).deps, s.actor("geral"), csv("G0000010;"))).rejects.toMatchObject({ code: "ACCESS_NETWORK_LOGIN_OFF", statusCode: 409 })
    await expect(applyNetworkEnable(s.deps, s.actor("geral"), Buffer.from("nome;x\nA;B"))).rejects.toMatchObject({ code: "ACCESS_CSV_NO_MATRICULA_COLUMN", statusCode: 422 })
    await expect(applyNetworkEnable(s.deps, s.actor("geral"), Buffer.alloc(700_001, "a"))).rejects.toMatchObject({ code: "ACCESS_CSV_TOO_LARGE", statusCode: 413 })
    // O catálogo explica como pedido recusado, não como falha de dependência (ARQ12-03 da run-12).
    for (const code of ["ACCESS_CSV_EMPTY", "ACCESS_CSV_NO_MATRICULA_COLUMN", "ACCESS_CSV_TOO_MANY_ROWS", "ACCESS_CSV_INVALID"]) expect(explainCode(code), code).toMatchObject({ family: { id: expect.not.stringMatching("FAMILIA-DEPENDENCIA") } })
  })
})

describe("conferir matrícula", () => {
  it("acha a pessoa pelo que ela digita, mostra parecidas quando não existe e não chama o AD", async () => {
    const s = setup()
    expect(await checkNetworkLogin(s.deps, s.actor("acessos"), " rede\\g0000012 ")).toMatchObject({ networkLogin: "G0000012", people: [{ personId: "ativo", accessStatus: "ACTIVE" }] })
    expect(await checkNetworkLogin(s.deps, s.actor("acessos"), "G0000521")).toMatchObject({ people: [], similar: ["0000521"], attempts: { last: { reason: "NETWORK_ACCOUNT_LOCKED" } } })
    expect(await checkNetworkLogin(s.deps, s.actor("acessos"), "fulano de tal")).toMatchObject({ networkLogin: null, people: [] })
  })
  it("fora do escopo não aparece nem devolve tentativas; sem gerenciar acessos = 403", async () => {
    const s = setup()
    s.memory.people.push(person("alheia", "g0000040 ", { organizationId: "00000000-0000-4000-8000-000000000002" }))
    // Matrícula de pessoa de outra organização (CFA-05 da run-12): os contadores são da instalação e não saem daqui.
    expect(await checkNetworkLogin(s.deps, s.actor("geral"), "G0000040")).toEqual({ networkLogin: "G0000040", networkLoginEnabled: true, people: [], similar: [], attempts: null })
    expect(await checkNetworkLogin(s.deps, s.actor("geral"), "G0000041")).toMatchObject({ attempts: { last: { reason: "NETWORK_ACCOUNT_LOCKED" } } })
    expect(await checkNetworkLogin(s.deps, s.actor("acessosA"), "G0000015")).toEqual({ networkLogin: "G0000015", networkLoginEnabled: true, people: [], similar: [], attempts: null })
    await expect(checkNetworkLogin(s.deps, s.actor("ativo"), "G0000012")).rejects.toMatchObject({ statusCode: 403 })
  })
})
