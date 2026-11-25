/**
 * PROVA de ponta a ponta do acesso pela REDE (25/11/2026): API real + PostgreSQL + AD simulado em LDAPS de verdade (TLS, cadeia
 * conferida, bind do protocolo). Cobre o que fazia gente dizer "não consigo logar" — matrícula sem conta, trava que sobrava depois de
 * habilitar, matrícula digitada com domínio, cadastro repetido desabilitado — e a habilitação sem senha, uma a uma e por CSV, para o
 * Administrador geral e o Administrador de acessos. Tudo numa transação desfeita no fim (banco intacto). Precisa do `openssl`.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run src/modules/access/testing/network-access-proof
 */
import cookieParser from "cookie-parser"
import express, { type ErrorRequestHandler } from "express"
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { authenticateNetwork, createNetworkPasswordVerifier } from "../../auth/application/authenticate-network.js"
import { parseShortLoginFormats } from "../../auth/domain/network-login.js"
import { createPostgresCredentialStore, loginIdentifierHash } from "../../auth/infrastructure/postgres-credential-store.js"
import { createLdapDirectoryAuthenticator } from "../../auth/infrastructure/ldap-directory-authenticator.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { issueDeviceToken } from "../../auth/infrastructure/known-device.js"
import { disableAccountsFromSource } from "../../data-hub/application/writers/person-identity.js"
import { createAuthRouter } from "../../auth/presentation/auth-router.js"
import { startFakeLdapsServer, type FakeLdapsServer } from "../../auth/testing/fake-ldaps-server.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const DOMAIN = "empresa.local"
const PASSWORD = "Senha#Rede çãõ é €"
const LOCAL_PASSWORD = "Emergencia@2026"
let pool: pg.Pool
let client: pg.PoolClient
let ad: FakeLdapsServer
let localHash: string

describe.skipIf(!ENABLED)("Acesso pela rede — API + PostgreSQL + LDAPS", () => {
  const instance = env as { AD_DOMAIN?: string | undefined; AD_LOGIN_WITHOUT_LAST_DIGIT?: string | undefined }
  const originalDomain = instance.AD_DOMAIN
  beforeAll(async () => {
    // Domínio do AD da instalação (identifica a conta sem e-mail).
    instance.AD_DOMAIN = DOMAIN
    // Formato em que o login do AD pode estar sem o último dígito (a lista de Acessos lê do ambiente).
    instance.AD_LOGIN_WITHOUT_LAST_DIGIT = "R:8"
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    client = await pool.connect()
    ad = await startFakeLdapsServer({ domain: DOMAIN })
    localHash = await hashPassword(LOCAL_PASSWORD)
  })
  afterAll(async () => { if (client) client.release(); if (pool) await pool.end(); if (ad) await ad.close(); delete instance.AD_LOGIN_WITHOUT_LAST_DIGIT; if (originalDomain === undefined) delete instance.AD_DOMAIN; else instance.AD_DOMAIN = originalDomain })
  beforeEach(async () => {
    await client.query("rollback").catch(() => undefined)
    await client.query("begin")
    ad.binds.length = 0
    ad.searches.length = 0
    ad.failures.clear()
    ad.users.clear()
    ad.setSilent(false)
    return async () => { await client.query("rollback") }
  })

  async function world() {
    const org = (await client.query<{ id: string }>("select id from organizations order by created_at limit 1")).rows[0]!.id
    await client.query("update organizations set network_login_enabled = true where id = $1", [org])
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [org])).rows[0]!.id
    const team = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof AD Grupo') returning id", [org, operation])).rows[0]!.id
    const other = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof AD Outro') returning id", [org, operation])).rows[0]!.id
    const person = async (name: string, matricula: string | null, patch: { active?: boolean; teamId?: string | null } = {}) =>
      (await client.query<{ id: string }>("insert into people (organization_id, team_id, name, role, matricula, active) values ($1, $2, $3, 'OPERATOR', $4, $5) returning id", [org, patch.teamId === undefined ? team : patch.teamId, `Proof AD ${name}`, matricula, patch.active ?? true])).rows[0]!.id
    const account = async (personId: string, email: string, patch: { active?: boolean; emergency?: boolean } = {}) =>
      (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash, active, emergency_local_access) values ($1, $2, $3, $4, $5, $6) returning id", [org, personId, email, localHash, patch.active ?? true, patch.emergency ?? false])).rows[0]!.id
    const admin = async (key: string, roleCode: string, scope: { type: string; teamId?: string } = { type: "ORGANIZATION" }) => {
      const accountId = await account(await person(key, null, { teamId: null }), `${key}@proof-ad.test`, { emergency: true })
      await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, $3, $4, $5, now())", [org, accountId, roleCode, scope.type, scope.teamId ?? null])
      const app = createApp(client as never, { rateLimits: false })
      const agent = request.agent(app)
      expect((await agent.post("/api/v1/auth/login").send({ email: `${key}@proof-ad.test`, password: LOCAL_PASSWORD })).status).toBe(200)
      return agent
    }
    const directory = createLdapDirectoryAuthenticator({ urls: [ad.url], domain: DOMAIN, ca: ad.ca, allowWeakKey: false, timeoutMs: 1500, shortLoginFormats: parseShortLoginFormats("R:8") })
    const loginApp = express()
    loginApp.use(express.json())
    loginApp.use(cookieParser())
    loginApp.use("/auth", createAuthRouter(client as never, { directory, networkLoginMinimumMs: 0, cookieSecure: false }))
    loginApp.use(((error, _request, response, next) => { void next; response.status(500).json({ error: { code: "INTERNAL", message: String(error) } }) }) as ErrorRequestHandler)
    const login = async (matricula: string, password = PASSWORD) => {
      const response = await request(loginApp).post("/auth/login").send({ matricula, password })
      return { status: response.status, code: (response.body.error?.code as string | undefined) ?? "OK", cookie: (response.headers["set-cookie"] as unknown as string[] | undefined)?.[0] ?? null, body: response.body }
    }
    return { org, team, other, person, account, admin, login, loginApp, directory }
  }
  /**
   * Provas que precisam de conexões concorrendo ficam fora da transação: usam uma organização PRÓPRIA, apagada no fim — ligar o login pela rede
   * na organização do banco de teste derrubaria as provas que rodam ao mesmo tempo.
   */
  const ownOrganization = async () => (await pool.query<{ id: string }>("insert into organizations (name, slug, network_login_enabled) values ('Proof AD Organização', 'proof-ad-' || gen_random_uuid(), true) returning id")).rows[0]!.id
  const dropOrganization = async (org: string) => {
    await pool.query("delete from audit_logs where organization_id = $1", [org])
    await pool.query("delete from user_accounts where organization_id = $1", [org])
    await pool.query("delete from person_operating_universe_history where organization_id = $1", [org])
    await pool.query("delete from people where organization_id = $1", [org])
    await pool.query("delete from organizations where id = $1", [org])
  }
  const csv = (...lines: string[]) => ({ contentBase64: Buffer.from(`\ufeffmatricula;email\r\n${lines.join("\r\n")}\r\n`).toString("base64") })

  it("recém-habilitada entra NA HORA: as tentativas de antes de ter conta nunca chegaram ao AD e saem da trava", async () => {
    const w = await world()
    ad.users.set("g7000001", { password: PASSWORD })
    const id = await w.person("Nova", "G7000001")
    expect([(await w.login("G7000001")).code, (await w.login("G7000001")).code, (await w.login("G7000001")).code]).toEqual(["INVALID_CREDENTIALS", "INVALID_CREDENTIALS", "LOGIN_TOO_MANY_ATTEMPTS"])
    expect(ad.binds).toEqual([])
    const agent = await w.admin("geral", "ADMINISTRADOR_GERAL")
    // A lista mostra o motivo e a trava antes de habilitar.
    const before = (await agent.get("/api/v1/admin/access/users").query({ search: "G7000001" })).body.data
    expect(before).toMatchObject({ networkLoginEnabled: true, items: [{ accessStatus: "DISABLED", enableCredential: "NETWORK", networkIssue: null, networkAttempts: { lockedUntil: expect.any(String), last: { reason: "NO_ACCOUNT" } } }] })
    const enabled = await agent.post(`/api/v1/admin/access/users/${id}/enable`).send({})
    expect(enabled.status).toBe(201)
    expect(enabled.body.data).toEqual({ credential: "NETWORK", personId: id, accountId: expect.any(String), name: "Proof AD Nova", matricula: "G7000001" })
    expect(enabled.headers["cache-control"]).toBe("no-store")
    const logged = await w.login("g7000001")
    expect(logged).toMatchObject({ status: 200, code: "OK" })
    expect(logged.body.data.passwordChangeRequired).toBe(false)
    expect(ad.binds).toEqual(["G7000001@empresa.local"])
    const row = (await agent.get("/api/v1/admin/access/users").query({ search: "G7000001" })).body.data.items[0]
    expect(row).toMatchObject({ accessStatus: "ACTIVE", networkAttempts: { lockedUntil: null, last: { outcome: "SUCCEEDED" } } })
    // A conta nasce sem senha temporária, com auditoria sem senha nem hash.
    const stored = (await client.query("select password_change_required, temporary_password_issued_at, temporary_password_expires_at, password_hash, session_version from user_accounts where id = $1", [enabled.body.data.accountId])).rows[0]
    expect(stored).toMatchObject({ password_change_required: false, temporary_password_issued_at: null, temporary_password_expires_at: null })
    const audit = (await client.query<{ payload: Record<string, unknown>; actor_id: string }>("select payload, actor_id from audit_logs where entity_id = $1 and action = 'ACCESS_ENABLED'", [enabled.body.data.accountId])).rows
    expect(audit).toHaveLength(1)
    expect(audit[0]!.payload).toMatchObject({ credential: "NETWORK", accountCreated: true, personId: id })
    expect(JSON.stringify(audit)).not.toContain(stored.password_hash)
  })

  it("senha recusada pelo AD continua contando: habilitar não fura a trava que protege a conta de rede", async () => {
    const w = await world()
    ad.users.set("g7000002", { password: PASSWORD })
    const id = await w.person("Errou", "G7000002")
    const accountId = await w.account(id, "errou@proof-ad.test")
    for (let index = 0; index < 5; index += 1) await w.login("G7000002", "errada")
    expect(ad.failures.get("g7000002")).toBe(3)
    const agent = await w.admin("geral", "ADMINISTRADOR_GERAL")
    expect((await agent.post(`/api/v1/admin/access/accounts/${accountId}/disable`).send({})).status).toBe(200)
    expect((await agent.post(`/api/v1/admin/access/users/${id}/enable`).send({})).body.data).toMatchObject({ credential: "NETWORK", accountId })
    expect((await w.login("G7000002")).code).toBe("LOGIN_TOO_MANY_ATTEMPTS")
    expect(ad.failures.get("g7000002")).toBe(3)
    // Passados os 15 minutos sem falha, entra.
    await client.query("update auth_login_attempts set attempted_at = attempted_at - interval '17 minutes' where account_id = $1", [accountId])
    expect((await w.login("G7000002")).status).toBe(200)
  })

  it("o que a pessoa digita: maiúscula, espaço, DOMINIO\\, @dominio e caractere invisível entram; senha com acento e espaço chega inteira ao AD", async () => {
    const w = await world()
    ad.users.set("sp7000003", { password: PASSWORD })
    await w.account(await w.person("Digita", " sp7000003 "), "digita@proof-ad.test")
    for (const typed of ["SP7000003", " sp7000003 ", "EMPRESA\\sp7000003", "sp7000003@empresa.local", "\u200bSP7000003\u00a0"]) expect((await w.login(typed)).code, typed).toBe("OK")
    expect(new Set(ad.binds)).toEqual(new Set(["SP7000003@empresa.local"]))
    expect((await w.login("SP7000003", PASSWORD.trimEnd().slice(0, -1))).code).toBe("INVALID_CREDENTIALS")
  })

  it("cada resposta do AD: mensagem própria para a pessoa e motivo gravado para o administrador (sem senha e sem o digitado)", async () => {
    const w = await world()
    const agent = await w.admin("geral", "ADMINISTRADOR_GERAL")
    const cases = [["532", "NETWORK_PASSWORD_EXPIRED", "NETWORK_PASSWORD_EXPIRED"], ["773", "NETWORK_PASSWORD_EXPIRED", "NETWORK_PASSWORD_EXPIRED"], ["533", "NETWORK_ACCOUNT_DISABLED", "NETWORK_ACCOUNT_DISABLED"], ["531", "NETWORK_ACCOUNT_DISABLED", "NETWORK_ACCOUNT_DISABLED"], ["701", "NETWORK_ACCOUNT_DISABLED", "NETWORK_ACCOUNT_DISABLED"], ["775", "NETWORK_ACCOUNT_LOCKED", "NETWORK_ACCOUNT_LOCKED"]] as const
    for (const [index, [code, refusal, reason]] of cases.entries()) {
      const matricula = `G71000${index}0`
      ad.users.set(matricula.toLowerCase(), { password: PASSWORD, code })
      await w.account(await w.person(`Caso ${code}`, matricula), `caso${code}@proof-ad.test`)
      expect((await w.login(matricula)).code, code).toBe(refusal)
      expect((await agent.get("/api/v1/admin/access/users").query({ search: matricula })).body.data.items[0].networkAttempts.last).toMatchObject({ reason, directoryCode: code })
    }
    const stored = JSON.stringify((await client.query("select * from auth_login_attempts order by id desc limit 50")).rows)
    expect(stored).not.toContain(PASSWORD)
    expect(stored).not.toContain("G71000")
  })

  it("AD fora do ar não conta como falha; AD que não responde conta (na dúvida, a favor da conta de rede)", async () => {
    const w = await world()
    ad.users.set("g7000005", { password: PASSWORD })
    await w.account(await w.person("Lento", "G7000005"), "lento@proof-ad.test")
    ad.setSilent(true)
    expect((await w.login("G7000005")).code).toBe("NETWORK_LOGIN_UNAVAILABLE")
    ad.setSilent(false)
    const agent = await w.admin("geral", "ADMINISTRADOR_GERAL")
    expect((await agent.get("/api/v1/admin/access/users").query({ search: "G7000005" })).body.data.items[0].networkAttempts).toMatchObject({ lockedUntil: null, last: { reason: "NETWORK_NO_ANSWER" } })
    expect((await w.login("G7000005")).code).toBe("OK")
  })

  it("login do AD sem o último dígito: entra só quem tem a ID da matrícula; a R de 8 que existe inteira segue igual; a ciência usa a mesma regra", async () => {
    const w = await world()
    const agent = await w.admin("geral", "ADMINISTRADOR_GERAL")
    // Como no AD real: login R700018, ID 07000189; a base manda R7000189.
    ad.users.set("r700018", { password: PASSWORD, employeeId: "07000189" })
    ad.users.set("r7000205", { password: PASSWORD, employeeId: "07000205" })
    const account = await w.account(await w.person("Curta", "R7000189"), "curta@proof-ad.test")
    await w.account(await w.person("Outra", "R7000185"), "outra@proof-ad.test")
    await w.account(await w.person("Inteira", "R7000205"), "inteira@proof-ad.test")
    expect((await w.login("r7000189")).body.data).toMatchObject({ email: "curta@proof-ad.test" })
    expect(ad.binds).toEqual(["R7000189@empresa.local", "R700018@empresa.local"])
    expect(ad.searches).toEqual([{ by: "r700018", login: "R700018", base: "DC=empresa,DC=local" }])
    // A MESMA senha com a matrícula de outra pessoa que viraria o mesmo login: o AD aceita a senha, a INIA não deixa entrar.
    expect((await w.login("R7000185")).code).toBe("INVALID_CREDENTIALS")
    expect((await agent.get("/api/v1/admin/access/users").query({ search: "R7000185" })).body.data.items[0].networkAttempts.last.reason).toBe("NETWORK_IDENTITY_MISMATCH")
    // Existe inteira: uma conferência só, sem pesquisa; senha errada não soma na conta de mais ninguém.
    ad.binds.length = 0
    ad.searches.length = 0
    expect((await w.login("R7000205")).code).toBe("OK")
    expect(ad.binds).toEqual(["R7000205@empresa.local"])
    expect((await w.login("R7000205", "errada")).code).toBe("INVALID_CREDENTIALS")
    expect(Object.fromEntries(ad.failures)).toEqual({ r7000205: 1 })
    // Senha errada de quem tem o login curto: um erro, na própria conta.
    expect((await w.login("R7000189", "errada")).code).toBe("INVALID_CREDENTIALS")
    expect(ad.failures.get("r700018")).toBe(1)
    // A primeira entrada memorizou o login: só ele recebe senha (o inteiro nunca mais), inclusive na ciência.
    expect((await client.query("select directory_login from user_accounts where id = $1", [account])).rows[0]).toEqual({ directory_login: "R700018" })
    expect((await agent.get("/api/v1/admin/access/users").query({ search: "R7000189" })).body.data.items[0].loginGuide).toEqual({ kind: "NETWORK", typed: "R7000189", directoryLogins: ["R700018"], proven: true })
    expect((await agent.get("/api/v1/admin/access/users").query({ search: "R7000185" })).body.data.items[0].loginGuide).toEqual({ kind: "NETWORK", typed: "R7000185", directoryLogins: ["R7000185", "R700018"], proven: false })
    ad.binds.length = 0
    const verify = createNetworkPasswordVerifier({ store: createPostgresCredentialStore(client as never), directory: w.directory, identifierHash: loginIdentifierHash, now: () => new Date() })
    expect(await verify({ normalized: "R7000189", password: PASSWORD, accountId: account })).toBe("OK")
    expect(ad.binds).toEqual(["R700018@empresa.local"])
    // Habilitar de novo esquece (o login pode ter mudado no AD).
    const personId = (await client.query<{ person_id: string }>("select person_id from user_accounts where id = $1", [account])).rows[0]!.person_id
    expect((await agent.post(`/api/v1/admin/access/accounts/${account}/disable`).send({})).status).toBe(200)
    expect((await agent.post(`/api/v1/admin/access/users/${personId}/enable`).send({})).status).toBe(201)
    expect((await client.query("select directory_login from user_accounts where id = $1", [account])).rows[0]).toEqual({ directory_login: null })
    // O AD não deixa ler a ficha, ou a conta não tem ID: nunca entra, e não conta como senha errada.
    for (const patch of [{ searchDenied: true }, { employeeId: undefined }]) {
      ad.users.set("r700018", { password: PASSWORD, employeeId: "07000189", ...patch } as never)
      expect((await w.login("R7000189")).code).toBe("NETWORK_IDENTITY_UNREADABLE")
      expect((await agent.get("/api/v1/admin/access/users").query({ search: "R7000189" })).body.data.items[0].networkAttempts).toMatchObject({ lockedUntil: null, last: { reason: "NETWORK_IDENTITY_UNREADABLE" } })
    }
    // Conta curta bloqueada no AD: a mensagem certa chega à pessoa.
    // (Nova rodada do contador: o teto da soma dos dois logins já tinha contado as tentativas acima.)
    await client.query("update auth_login_attempts set attempted_at = attempted_at - interval '17 minutes'")
    ad.users.set("r700018", { password: PASSWORD, employeeId: "07000189", code: "775" })
    expect((await w.login("R7000189")).code).toBe("NETWORK_ACCOUNT_LOCKED")
  })

  it("revisão independente: mesma conta com dois nomes soma um teto só; login cortado de outra pessoa do cadastro não entra; nome completo de outra conta recusa", async () => {
    const w = await world()
    // Login R700050 cujo nome completo explícito é a matrícula inteira: os dois logins são a MESMA conta.
    ad.users.set("r700050", { password: PASSWORD, employeeId: "07000501", upn: "R7000501" })
    const account = await w.account(await w.person("Dois nomes", "R7000501"), "doisnomes@proof-ad.test")
    for (let index = 0; index < 6; index += 1) await w.login("R7000501", "errada")
    const device = issueDeviceToken(account)
    for (let index = 0; index < 4; index += 1) await request(w.loginApp).post("/auth/login").set("Cookie", `inia_device=${device}`).send({ matricula: "R7000501", password: "errada" })
    expect(ad.failures.get("r700050")).toBe(5)
    // Alguém cadastrado com a matrícula R700060, que no AD é o login de quem tem a matrícula R7000601.
    ad.users.set("r700060", { password: PASSWORD, employeeId: "07000601" })
    await w.account(await w.person("Errada", "R700060"), "errada@proof-ad.test")
    expect((await w.login("R700060")).code).toBe("OK")
    await w.account(await w.person("Dona", "R7000601"), "dona@proof-ad.test")
    expect((await w.login("R700060")).code).toBe("INVALID_CREDENTIALS")
    expect((await w.login("R7000601")).body.data).toMatchObject({ email: "dona@proof-ad.test" })
    // O nome completo de OUTRA conta é o login cortado: não dá para provar qual entrou.
    ad.users.set("r700070", { password: "outra senha", employeeId: "07000701" })
    ad.users.set("z1", { password: PASSWORD, employeeId: "00000001", upn: "R700070" })
    await w.account(await w.person("Ambigua", "R7000701"), "ambigua@proof-ad.test")
    expect((await w.login("R7000701")).code).toBe("NETWORK_IDENTITY_UNREADABLE")
  })

  it("run-12: o inteiro também exige prova de quem entrou (nome completo de outra conta, duas fichas), nada fica memorizado e o dono entra pelo cortado", async () => {
    const w = await world()
    const account = await w.account(await w.person("Dona do nome", "R7000801"), "donadonome@proof-ad.test")
    const remembered = async () => (await client.query<{ directory_login: string | null }>("select directory_login from user_accounts where id = $1", [account])).rows[0]!.directory_login
    ad.users.set("z2", { password: PASSWORD, employeeId: "00000002", upn: "R7000801" })
    ad.users.set("r700080", { password: "senha da dona", employeeId: "07000801" })
    expect((await w.login("R7000801")).code).toBe("INVALID_CREDENTIALS")
    expect(await remembered()).toBeNull()
    ad.users.set("r7000801", { password: "outra", employeeId: "07000801" })
    expect((await w.login("R7000801")).code).toBe("NETWORK_IDENTITY_UNREADABLE")
    expect(await remembered()).toBeNull()
    ad.users.delete("r7000801")
    expect((await w.login("R7000801", "senha da dona")).body.data).toMatchObject({ email: "donadonome@proof-ad.test" })
    expect(await remembered()).toBe("R700080")
  })

  it("run-12: a matrícula cortada digitada direto soma os erros das inteiras (mesma conta do AD), com ou sem navegador conhecido, e a tela mostra a pausa", async () => {
    const w = await world()
    const agent = await w.admin("geral", "ADMINISTRADOR_GERAL")
    ad.users.set("r700090", { password: PASSWORD, employeeId: "07000901", upn: "R7000901" })
    const accounts = new Map<string, string>()
    for (const matricula of ["R7000901", "R700090"]) accounts.set(matricula, await w.account(await w.person(`Nomes ${matricula}`, matricula), `${matricula.toLowerCase()}@proof-ad.test`))
    const wrong = (matricula: string, device?: string) => { const call = request(w.loginApp).post("/auth/login"); return (device ? call.set("Cookie", `inia_device=${device}`) : call).send({ matricula, password: "errada" }) }
    for (const matricula of ["R7000901", "R700090"]) {
      for (let index = 0; index < 4; index += 1) await wrong(matricula)
      for (let browser = 0; browser < 3; browser += 1) { const device = issueDeviceToken(accounts.get(matricula)!); for (let index = 0; index < 4; index += 1) await wrong(matricula, device) }
    }
    expect(ad.failures.get("r700090")).toBe(5)
    expect((await agent.get("/api/v1/admin/access/users").query({ search: "r700090@proof-ad.test" })).body.data.items[0].networkAttempts.lockedUntil).toEqual(expect.any(String))
  })

  it("run-12: inativar pela ficha, desabilitar pela carga e reabilitar com senha temporária esquecem o login do AD; a carga não mexe na conta do Administrador geral", async () => {
    const w = await world()
    const agent = await w.admin("geral", "ADMINISTRADOR_GERAL")
    const build = async (key: string, matricula: string, patch: { active?: boolean; emergency?: boolean } = {}) => {
      const personId = await w.person(key, matricula)
      const accountId = await w.account(personId, `${key}@proof-ad.test`, patch)
      await client.query("update user_accounts set directory_login = 'R700091' where id = $1", [accountId])
      return { personId, accountId, remembered: async () => (await client.query<{ directory_login: string | null }>("select directory_login from user_accounts where id = $1", [accountId])).rows[0]!.directory_login }
    }
    const record = await build("ficha", "R7000911")
    expect((await agent.patch(`/api/v1/admin/users/${record.personId}`).send({ email: "ficha2@proof-ad.test" })).status).toBe(200)
    expect(await record.remembered()).toBe("R700091")
    expect((await agent.patch(`/api/v1/admin/users/${record.personId}`).send({ active: false })).status).toBe(200)
    expect(await record.remembered()).toBeNull()
    const load = await build("carga", "R7000912")
    const general = await build("cargageral", "R7000913")
    await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, 'ADMINISTRADOR_GERAL', 'ORGANIZATION', now())", [w.org, general.accountId])
    const result = await disableAccountsFromSource({ organizationId: w.org, runId: "proof-run", feed: { id: "proof-feed" } } as never, client, [load.personId, general.personId], "PERSON_DEACTIVATED_BY_SOURCE")
    expect(new Map(result.map((row) => [row.personId, row.disabled]))).toEqual(new Map([[load.personId, true], [general.personId, false]]))
    expect([await load.remembered(), await general.remembered()]).toEqual([null, "R700091"])
    const temporary = await build("temporaria", "R7000914", { active: false, emergency: true })
    expect((await agent.post(`/api/v1/admin/access/users/${temporary.personId}/enable`).send({})).body.data).toMatchObject({ credential: "TEMPORARY_PASSWORD" })
    expect(await temporary.remembered()).toBeNull()
  })

  it("run-12: matrícula de outra organização — Conferir não mostra as tentativas e Novo usuário recusa como o Habilitar", async () => {
    const w = await world()
    const agent = await w.admin("geral", "ADMINISTRADOR_GERAL")
    ad.users.set("g7000921", { password: PASSWORD })
    const other = (await client.query<{ id: string }>("insert into organizations (name, slug, network_login_enabled) values ('Proof AD Alheia', 'proof-ad-' || gen_random_uuid(), true) returning id")).rows[0]!.id
    const alien = (await client.query<{ id: string }>("insert into people (organization_id, name, role, matricula) values ($1, 'Proof AD Alheia', 'OPERATOR', ' g7000921 ') returning id", [other])).rows[0]!.id
    const account = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, 'alheia@proof-ad.test', 'x') returning id", [other, alien])).rows[0]!.id
    expect((await w.login("G7000921", "errada")).code).toBe("INVALID_CREDENTIALS")
    const check = async (matricula: string) => (await agent.post("/api/v1/admin/access/network-login-check").send({ matricula })).body.data
    expect(await check("G7000921")).toEqual({ networkLogin: "G7000921", networkLoginEnabled: true, people: [], similar: [], attempts: null })
    // Matrícula de ninguém continua aparecendo para quem administra a organização inteira.
    await w.login("G7000922", "errada")
    expect((await check("G7000922")).attempts).toMatchObject({ last: { reason: "NO_ACCOUNT" } })
    const body = { name: "Proof AD Igual", role: "ADMIN", email: "igual@proof-ad.test", matricula: "G7000921" }
    const refused = await agent.post("/api/v1/admin/users").send(body)
    expect([refused.status, refused.body.error.code]).toEqual([409, "ACCESS_MATRICULA_DUPLICATED"])
    expect((await w.login("G7000921")).body.data).toMatchObject({ email: "alheia@proof-ad.test" })
    // A conta da outra organização desabilitada não impede (a mesma regra do Habilitar).
    await client.query("update user_accounts set active = false where id = $1", [account])
    expect((await agent.post("/api/v1/admin/users").send(body)).status).toBe(201)
  })

  it("várias matrículas que viram o mesmo login: a conta do AD recebe no máximo 3 senhas erradas, somando todas, e a tela mostra a pausa", async () => {
    const w = await world()
    const agent = await w.admin("geral", "ADMINISTRADOR_GERAL")
    ad.users.set("r700030", { password: PASSWORD, employeeId: "07000309" })
    for (let last = 1; last <= 6; last += 1) await w.account(await w.person(`Mesma ${last}`, `R700030${last}`), `mesma${last}@proof-ad.test`)
    const codes = []
    for (let last = 1; last <= 6; last += 1) for (let attempt = 0; attempt < 2; attempt += 1) codes.push((await w.login(`R700030${last}`, "errada")).code)
    expect(ad.failures.get("r700030")).toBe(3)
    expect(codes.slice(0, 3)).toEqual(Array(3).fill("INVALID_CREDENTIALS"))
    expect(codes.slice(3).every((code) => code === "LOGIN_TOO_MANY_ATTEMPTS")).toBe(true)
    expect((await agent.get("/api/v1/admin/access/users").query({ search: "R7000306" })).body.data.items[0].networkAttempts.lockedUntil).toEqual(expect.any(String))
  })

  it("navegadores conhecidos têm trava própria, mas a conta do AD recebe no máximo 5 senhas erradas somando todos", async () => {
    const w = await world()
    ad.users.set("g7000400", { password: PASSWORD })
    const account = await w.account(await w.person("Navegadores", "G7000400"), "nav@proof-ad.test")
    const wrong = (device?: string) => { const call = request(w.loginApp).post("/auth/login"); return (device ? call.set("Cookie", `inia_device=${device}`) : call).send({ matricula: "G7000400", password: "errada" }) }
    for (let index = 0; index < 4; index += 1) await wrong()
    for (let browser = 0; browser < 6; browser += 1) { const device = issueDeviceToken(account); for (let index = 0; index < 4; index += 1) await wrong(device) }
    expect(ad.failures.get("g7000400")).toBe(5)
  })

  it("cadastro repetido por maiúscula: a conta desabilitada não tranca ninguém; duas habilitadas trancam, e habilitar a segunda é recusado", async () => {
    const w = await world()
    ad.users.set("g7000006", { password: PASSWORD })
    await w.account(await w.person("Certa", "G7000006"), "certa@proof-ad.test")
    const twin = await w.person("Repetida", "g7000006")
    const twinAccount = await w.account(twin, "repetida@proof-ad.test", { active: false })
    expect((await w.login("G7000006")).body.data).toMatchObject({ email: "certa@proof-ad.test" })
    const agent = await w.admin("geral", "ADMINISTRADOR_GERAL")
    expect((await agent.post(`/api/v1/admin/access/users/${twin}/enable`).send({})).body.error).toMatchObject({ code: "ACCESS_MATRICULA_DUPLICATED" })
    await client.query("update user_accounts set active = true where id = $1", [twinAccount])
    expect((await w.login("G7000006")).code).toBe("INVALID_CREDENTIALS")
    const listed = (await agent.get("/api/v1/admin/access/users").query({ search: "7000006", networkIssue: "true" })).body.data
    expect(listed.items.map((item: { networkIssue: string }) => item.networkIssue)).toEqual(["MATRICULA_DUPLICATED", "MATRICULA_DUPLICATED"])
  })

  it("pessoa inativa e conta desabilitada: o AD confirma a senha e a INIA não deixa entrar; o motivo fica para o administrador", async () => {
    const w = await world()
    ad.users.set("g7000007", { password: PASSWORD })
    ad.users.set("g7000008", { password: PASSWORD })
    await w.account(await w.person("Inativa", "G7000007", { active: false }), "inativa@proof-ad.test")
    await w.account(await w.person("Desab", "G7000008"), "desab@proof-ad.test", { active: false })
    expect([(await w.login("G7000007")).code, (await w.login("G7000008")).code]).toEqual(["ACCESS_DISABLED", "ACCESS_DISABLED"])
    const agent = await w.admin("geral", "ADMINISTRADOR_GERAL")
    const reasonOf = async (search: string) => (await agent.get("/api/v1/admin/access/users").query({ search })).body.data.items[0].networkAttempts.last.reason
    expect([await reasonOf("G7000007"), await reasonOf("G7000008")]).toEqual(["PERSON_INACTIVE", "INIA_ACCESS_DISABLED"])
  })

  it.each([["geral", "ADMINISTRADOR_GERAL"], ["acessos", "ADMINISTRADOR_DE_ACESSOS"]])("CSV em massa por %s: prévia não grava; aplicar habilita e as pessoas entram", async (key, roleCode) => {
    const w = await world()
    const agent = await w.admin(key, roleCode)
    const numbers = Array.from({ length: 12 }, (_, index) => `G72000${String(index).padStart(2, "0")}`)
    for (const matricula of numbers) { ad.users.set(matricula.toLowerCase(), { password: PASSWORD }); await w.person(matricula, matricula) }
    const disabled = await w.account((await client.query<{ id: string }>("select id from people where matricula = $1", [numbers[0]])).rows[0]!.id, "volta@proof-ad.test", { active: false })
    await w.login(numbers[1]!); await w.login(numbers[1]!); await w.login(numbers[1]!)
    const template = await agent.get("/api/v1/admin/access/users/network-enable/template")
    expect(template.headers["content-disposition"]).toContain("modelo-habilitar-acesso-pela-rede.csv")
    expect(template.text).toContain("matricula;email")
    const file = csv("EXEMPLO-G0000000;nome@empresa.com.br", ...numbers.map((matricula) => `${matricula.toLowerCase()};`), "G7299999;", "7200003;", numbers[2]! + ";")
    const countAccounts = async () => Number((await client.query("select count(*) from user_accounts")).rows[0]!.count)
    const before = await countAccounts()
    const preview = await agent.post("/api/v1/admin/access/users/network-enable/preview").send(file)
    expect(preview.status).toBe(200)
    expect(preview.body.data.counts).toEqual({ CREATE: 11, REENABLE: 1, ALREADY_ENABLED: 0, REFUSED: 3 })
    expect(preview.body.data.rows.filter((row: { outcome: string }) => row.outcome === "REFUSED").map((row: { refusal: string; similar: string[] }) => [row.refusal, row.similar])).toEqual([["PERSON_NOT_FOUND", []], ["PERSON_NOT_FOUND", ["G7200003"]], ["DUPLICATE_IN_FILE", []]])
    expect(await countAccounts()).toBe(before)
    const applied = await agent.post("/api/v1/admin/access/users/network-enable").send(file)
    expect(applied.status).toBe(200)
    expect(applied.body.data.counts).toEqual(preview.body.data.counts)
    expect(await countAccounts()).toBe(before + 11)
    for (const matricula of numbers) expect((await w.login(matricula)).code, matricula).toBe("OK")
    const batch = (await client.query<{ entity_id: string; payload: { accountCreated: boolean } }>("select entity_id, payload from audit_logs where payload ->> 'batchId' = $1", [applied.body.data.batchId])).rows
    expect(batch).toHaveLength(12)
    expect(batch.find((entry) => entry.entity_id === disabled)!.payload.accountCreated).toBe(false)
    expect((await agent.post("/api/v1/admin/access/users/network-enable").send(file)).body.data.counts).toEqual({ CREATE: 0, REENABLE: 0, ALREADY_ENABLED: 12, REFUSED: 3 })
  })

  it("escopo: administrador de acessos de um Grupo não alcança o outro (nem pelo CSV, nem pela conferência); operador recebe 403", async () => {
    const w = await world()
    const agent = await w.admin("grupo", "ADMINISTRADOR_DE_ACESSOS", { type: "GROUP", teamId: w.team })
    await w.person("Dentro", "G7300001")
    await w.person("Fora", "G7300002", { teamId: w.other })
    const preview = (await agent.post("/api/v1/admin/access/users/network-enable/preview").send(csv("G7300001;", "G7300002;", "G0007300002;"))).body.data
    expect(preview.rows.map((row: { outcome: string; refusal: string | null; name: string | null; similar: string[] }) => [row.outcome, row.refusal, row.name, row.similar])).toEqual([["CREATE", null, "Proof AD Dentro", []], ["REFUSED", "PERSON_NOT_FOUND", null, []], ["REFUSED", "PERSON_NOT_FOUND", null, []]])
    expect((await agent.post("/api/v1/admin/access/network-login-check").send({ matricula: "G7300002" })).body.data).toEqual({ networkLogin: "G7300002", networkLoginEnabled: true, people: [], similar: [], attempts: null })
    expect((await agent.post("/api/v1/admin/access/network-login-check").send({ matricula: "g7300001@empresa.local" })).body.data.people[0]).toMatchObject({ name: "Proof AD Dentro" })

    const operator = await w.admin("operador", "LEITOR_DE_CONVERSAS_INIA")
    const base = "/api/v1/admin/access"
    for (const call of [() => operator.post(`${base}/users/network-enable`).send(csv("G7300001;")), () => operator.post(`${base}/users/network-enable/preview`).send(csv("G7300001;")), () => operator.post(`${base}/network-login-check`).send({ matricula: "G7300001" }), () => operator.get(`${base}/users`)]) expect((await call()).status).toBe(403)
    expect((await request(createApp(client as never, { rateLimits: false })).post("/api/v1/admin/access/users/network-enable").send(csv("G7300001;"))).status).toBe(401)
  })

  it("entrada inválida: base64 quebrado, campo a mais e arquivo enorme são recusados com 4xx, sem 500", async () => {
    const w = await world()
    const agent = await w.admin("geral", "ADMINISTRADOR_GERAL")
    const url = "/api/v1/admin/access/users/network-enable"
    expect((await agent.post(url).send({ contentBase64: "não é base64" })).status).toBe(400)
    expect((await agent.post(url).send({ ...csv("G1;"), role: "ADMINISTRADOR_GERAL" })).status).toBe(400)
    expect((await agent.post(url).send({})).status).toBe(400)
    expect((await agent.post(url).send({ contentBase64: Buffer.from("PK\u0003\u0004x").toString("base64") })).body.error.code).toBe("ACCESS_CSV_INVALID")
    expect((await agent.post(url).send(csv("'; drop table people; --;x", "=1+1;", "G\u0000;"))).status).toBe(422)
    expect((await agent.post("/api/v1/admin/access/network-login-check").send({ matricula: "x".repeat(81) })).status).toBe(400)
    await client.query("update organizations set network_login_enabled = false where id = $1", [w.org])
    expect((await agent.post(url).send(csv("G7300001;"))).body.error.code).toBe("ACCESS_NETWORK_LOGIN_OFF")
  })

  it("Novo usuário (cadastro de pessoas) com a rede ligada: sem senha, matrícula obrigatória, e a pessoa entra", async () => {
    const w = await world()
    const agent = await w.admin("geral", "ADMINISTRADOR_GERAL")
    ad.users.set("g7400001", { password: PASSWORD })
    const body = { name: "Proof AD Cadastro", role: "ADMIN", email: "cadastro@proof-ad.test" }
    expect((await agent.post("/api/v1/admin/users").send(body)).body.error.code).toBe("ACCESS_MATRICULA_REQUIRED")
    const created = await agent.post("/api/v1/admin/users").send({ ...body, matricula: "g7400001" })
    expect(created.status).toBe(201)
    expect(created.body.data.issued).toBeNull()
    expect((await w.login("G7400001")).code).toBe("OK")
    expect((await agent.post("/api/v1/admin/users").send({ ...body, email: "outro@proof-ad.test", matricula: "G7400001" })).body.error.code).toBe("PERSON_MATRICULA_IN_USE")
  })

  it("conta de emergência e login pela rede desligado continuam com senha temporária", async () => {
    const w = await world()
    const agent = await w.admin("geral", "ADMINISTRADOR_GERAL")
    const emergency = await w.person("Emergencia", "G7500001")
    await w.account(emergency, "emergencia@proof-ad.test", { active: false, emergency: true })
    expect((await agent.post(`/api/v1/admin/access/users/${emergency}/enable`).send({})).body.data).toMatchObject({ credential: "TEMPORARY_PASSWORD", temporaryPassword: expect.any(String) })
    await client.query("update organizations set network_login_enabled = false where id = $1", [w.org])
    const local = await w.person("Local", "G7500002")
    expect((await agent.post(`/api/v1/admin/access/users/${local}/enable`).send({ email: "local@proof-ad.test" })).body.data).toMatchObject({ credential: "TEMPORARY_PASSWORD" })
  })

  it("volume: 5.000 linhas num arquivo só, conferidas e aplicadas em segundos", async () => {
    const w = await world()
    const agent = await w.admin("geral", "ADMINISTRADOR_GERAL")
    await client.query("insert into people (organization_id, team_id, name, role, matricula) select $1, $2, 'Proof AD Volume ' || n, 'OPERATOR', 'V' || lpad(n::text, 7, '0') from generate_series(1, 4500) n", [w.org, w.team])
    const file = csv(...Array.from({ length: 5000 }, (_, index) => `V${String(index + 1).padStart(7, "0")};`))
    const startedAt = Date.now()
    const preview = await agent.post("/api/v1/admin/access/users/network-enable/preview").send(file)
    expect(preview.body.data.counts).toEqual({ CREATE: 4500, REENABLE: 0, ALREADY_ENABLED: 0, REFUSED: 500 })
    const previewMs = Date.now() - startedAt
    const applied = await agent.post("/api/v1/admin/access/users/network-enable").send(file)
    expect(applied.body.data.counts.CREATE).toBe(4500)
    const totalMs = Date.now() - startedAt
    console.info(JSON.stringify({ event: "network_enable_volume", previewMs, applyMs: totalMs - previewMs }))
    expect(totalMs).toBeLessThan(20_000)
    const listAt = Date.now()
    expect((await agent.get("/api/v1/admin/access/users").query({ networkIssue: "true", pageSize: 100 })).status).toBe(200)
    expect(Date.now() - listAt).toBeLessThan(5_000)
  }, 60_000)

  it("duas habilitações simultâneas da mesma pessoa: uma conta só, a outra recebe conflito", async () => {
    // Fora da transação da prova: precisa de duas conexões reais. Cria e apaga os próprios registros.
    await client.query("rollback")
    const org = await ownOrganization()
    const { createPostgresAccountAccessRepository } = await import("../infrastructure/postgres-account-access-repository.js")
    const repository = createPostgresAccountAccessRepository(pool as never)
    const personId = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, matricula) values ($1, 'Proof AD Corrida', 'OPERATOR', 'G7600001') returning id", [org])).rows[0]!.id
    try {
      const write = (email: string) => repository.enableForNetwork({ organizationId: org, actorPersonId: null, actorAccountId: null, at: new Date(), batchId: null, retiredPasswordHash: localHash, create: [{ personId, email }], reenable: [] })
      const results = await Promise.all([write("corrida1@proof-ad.test"), write("corrida2@proof-ad.test"), write("corrida3@proof-ad.test")])
      expect(results.filter((result) => result.has(personId))).toHaveLength(1)
      expect((await pool.query("select 1 from user_accounts where person_id = $1", [personId])).rowCount).toBe(1)
    } finally {
      await dropOrganization(org)
    }
  })

  it("40 envios simultâneos em conexões diferentes: nunca passam do teto da conta do AD", async () => {
    // Fora da transação da prova: conexões reais concorrendo. Cria e apaga os próprios registros.
    await client.query("rollback")
    const org = await ownOrganization()
    ad.users.set("g7700001", { password: PASSWORD })
    ad.users.set("r770000", { password: PASSWORD, employeeId: "07700009" })
    const store = createPostgresCredentialStore(pool as never)
    const directory = createLdapDirectoryAuthenticator({ urls: [ad.url], domain: DOMAIN, ca: ad.ca, allowWeakKey: false, timeoutMs: 5000, shortLoginFormats: parseShortLoginFormats("R:8") })
    const matriculas = ["G7700001", "R7700001", "R7700002", "R7700003", "R7700004"]
    try {
      for (const matricula of matriculas) {
        const id = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, matricula) values ($1, 'Proof AD Paralelo', 'OPERATOR', $2) returning id", [org, matricula])).rows[0]!.id
        await pool.query("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, 'x')", [org, id, `${matricula.toLowerCase()}@proof-ad-paralelo.test`])
      }
      const deps = { store, directory, identifierHash: loginIdentifierHash, now: () => new Date(), retiredPasswordHash: async () => "x", minimumDurationMs: 0 }
      for (let round = 0; round < 4; round += 1) await Promise.all(Array.from({ length: 40 }, (_, index) => authenticateNetwork(deps, { login: matriculas[index % matriculas.length]!, password: "errada" })))
      expect(ad.failures.get("g7700001") ?? 0).toBeLessThanOrEqual(3)
      expect(ad.failures.get("r770000") ?? 0).toBeLessThanOrEqual(3)
    } finally {
      const logins = [...matriculas.flatMap((matricula) => [`matricula:${matricula}`, `ad:${matricula}`]), "ad:R770000"]
      await pool.query("delete from auth_login_attempts where identifier_hash = any($1::text[])", [logins.map(loginIdentifierHash)])
      await dropOrganization(org)
    }
  }, 60_000)
})
