import { randomUUID } from "node:crypto"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { canAnywhere, type AccessContext } from "../domain/access-decision.js"
import { networkAccountIdentifier, networkLoginOf } from "../domain/network-access.js"
import { NETWORK_ENABLE_CSV_MAX_BYTES, NETWORK_ENABLE_CSV_MAX_ROWS, readNetworkEnableCsv, type NetworkEnableCsvRow } from "../domain/network-enable-csv.js"
import { systemRoleCatalog } from "../domain/roles.js"
import { resolveAccess, visibilityOf, type SessionActor } from "./access-service.js"
import { credentialDenial, isReachable, retiredPasswordHash, type AccountAccessDeps } from "./account-access-service.js"
import type { CredentialTargetRecord } from "./account-access-repository.js"

/**
 * HABILITAR EM MASSA PELA REDE (AD) — um CSV de matrículas. Mesmas regras da habilitação de uma pessoa (permissão, escopo, custódia,
 * cadastro ativo, matrícula utilizável), linha a linha: a linha recusada não impede as outras e o motivo volta para quem enviou. Nada
 * de senha: a identidade é do AD. Nunca cria pessoa, nunca concede papel. Conferir (prévia) e aplicar usam a MESMA avaliação, refeita
 * no servidor na hora de aplicar — o que mudou no meio do caminho aparece no resultado.
 */
export const NETWORK_ENABLE_REFUSALS = ["MATRICULA_REQUIRED", "MATRICULA_INVALID", "DUPLICATE_IN_FILE", "PERSON_NOT_FOUND", "MATRICULA_DUPLICATED", "PERSON_INACTIVE", "SELF_CREDENTIAL", "TARGET_MORE_PRIVILEGED", "TARGET_LEADS_OUTSIDE_SCOPE", "EMERGENCY_ACCOUNT", "EMAIL_INVALID", "EMAIL_REQUIRED", "EMAIL_IN_USE", "CONCURRENT_CHANGE"] as const
export type NetworkEnableRefusal = (typeof NETWORK_ENABLE_REFUSALS)[number]
/** CREATE = conta nova; REENABLE = conta desabilitada volta; ALREADY_ENABLED = nada a fazer; REFUSED = ver `refusal`. */
export type NetworkEnableOutcome = "CREATE" | "REENABLE" | "ALREADY_ENABLED" | "REFUSED"
export type NetworkEnableRow = {
  line: number
  matricula: string
  name: string | null
  /** Login que a pessoa digita na INIA (linhas que têm ou vão ter acesso). */
  login: string | null
  outcome: NetworkEnableOutcome
  refusal: NetworkEnableRefusal | null
  /** Matrículas parecidas do alcance (prefixo ou zeros diferentes), quando a da linha não existe. */
  similar: string[]
  /** O e-mail da linha não foi usado: a conta já existe com outro (o e-mail de login não muda por aqui). */
  emailIgnored: boolean
}
export type NetworkEnableReport = { rows: NetworkEnableRow[]; counts: Record<NetworkEnableOutcome, number>; ignoredColumns: string[] }

const CSV_ERRORS = {
  EMPTY: { status: 422, code: "ACCESS_CSV_EMPTY", message: "O arquivo não tem nenhuma matrícula. Preencha uma por linha na coluna “matricula” do modelo." },
  NO_MATRICULA_COLUMN: { status: 422, code: "ACCESS_CSV_NO_MATRICULA_COLUMN", message: "Não encontrei a coluna “matricula” no arquivo. Use o modelo: a primeira linha precisa ter o nome das colunas." },
  TOO_MANY_ROWS: { status: 422, code: "ACCESS_CSV_TOO_MANY_ROWS", message: `O arquivo passa de ${NETWORK_ENABLE_CSV_MAX_ROWS.toLocaleString("pt-BR")} linhas. Divida em arquivos menores.` },
  NOT_CSV: { status: 422, code: "ACCESS_CSV_INVALID", message: "Este arquivo não é um CSV. Na planilha, use “Salvar como” e escolha CSV." },
} as const

type PlannedRow = NetworkEnableRow & { target: CredentialTargetRecord | null; email: string | null; networkLogin: string | null }
type Plan = { rows: PlannedRow[]; ignoredColumns: string[] }

async function planNetworkEnable(deps: AccountAccessDeps, actor: SessionActor, bytes: Uint8Array): Promise<Plan> {
  const catalog = deps.catalog ?? systemRoleCatalog
  const access = await resolveAccess(deps, actor)
  if (!canAnywhere(access, "access.users.manage", catalog)) throw new DomainError("Você não tem permissão para esta ação.", "FORBIDDEN", 403)
  if (!(await deps.networkLoginEnabled(actor.organizationId))) throw new DomainError("O login pela rede está desligado: habilite cada pessoa em “Habilitar acesso”, com senha temporária.", "ACCESS_NETWORK_LOGIN_OFF", 409)
  if (bytes.length > NETWORK_ENABLE_CSV_MAX_BYTES) throw new DomainError("O arquivo é grande demais. Divida em arquivos menores.", "ACCESS_CSV_TOO_LARGE", 413)
  const csv = readNetworkEnableCsv(bytes)
  if (!csv.ok) throw new DomainError(CSV_ERRORS[csv.error].message, CSV_ERRORS[csv.error].code, CSV_ERRORS[csv.error].status)

  const visibility = visibilityOf(access, "access.users.manage", catalog)
  const logins = [...new Set(csv.rows.flatMap((row) => (row.networkLogin ? [row.networkLogin] : [])))]
  const targets = new Map<string, CredentialTargetRecord[]>()
  for (const target of await deps.accounts.targetsByNetworkLogin(actor.organizationId, logins)) {
    // Fora do escopo = não encontrada (não revela quem existe fora do alcance).
    if (!isReachable(visibility, target)) continue
    const login = networkLoginOf(target.matricula)
    if (login) targets.set(login, [...(targets.get(login) ?? []), target])
  }
  const missing = logins.filter((login) => !targets.has(login))
  const similar = await deps.accounts.similarMatriculas(actor.organizationId, visibility, missing)

  const seen = new Set<string>()
  const rows = csv.rows.map((row): PlannedRow => {
    const repeated = row.networkLogin !== null && seen.has(row.networkLogin)
    if (row.networkLogin) seen.add(row.networkLogin)
    const candidates = row.networkLogin ? targets.get(row.networkLogin) ?? [] : []
    // Cadastro repetido: vale o único ativo; dois ativos = ninguém entraria por ela.
    const active = candidates.filter((candidate) => candidate.personActive)
    const pool = active.length > 0 ? active : candidates
    const target = pool.length === 1 ? pool[0]! : null
    const base = { line: row.line, matricula: row.matricula, name: target?.name ?? null, login: null as string | null, similar: [] as string[], emailIgnored: false, target, networkLogin: row.networkLogin, email: null as string | null }
    const refuse = (refusal: NetworkEnableRefusal, extra: Partial<PlannedRow> = {}): PlannedRow => ({ ...base, outcome: "REFUSED", refusal, ...extra })
    if (row.matricula === "") return refuse("MATRICULA_REQUIRED")
    if (!row.networkLogin) return refuse("MATRICULA_INVALID")
    if (repeated) return refuse("DUPLICATE_IN_FILE")
    if (pool.length > 1) return refuse("MATRICULA_DUPLICATED")
    if (!target) return refuse("PERSON_NOT_FOUND", { similar: similar.get(row.networkLogin) ?? [] })
    const evaluated = evaluateTarget(deps, access, target, row, row.networkLogin)
    return { ...base, ...evaluated, login: evaluated.outcome === "REFUSED" ? null : networkLoginOf(target.matricula) }
  })

  // E-mails (informados ou gerados) que já são de outra conta, ou que duas linhas do arquivo disputam.
  const creating = rows.filter((row) => row.outcome === "CREATE")
  const inUse = await deps.accounts.emailsInUse([...new Set(creating.map((row) => row.email!))])
  const taken = new Set<string>()
  for (const row of creating) {
    if (inUse.has(row.email!) || taken.has(row.email!)) Object.assign(row, { outcome: "REFUSED", refusal: "EMAIL_IN_USE", login: null })
    else taken.add(row.email!)
  }
  return { rows, ignoredColumns: csv.ignoredColumns }

  function evaluateTarget(deps: AccountAccessDeps, access: AccessContext, target: CredentialTargetRecord, row: NetworkEnableCsvRow, networkLogin: string): Pick<PlannedRow, "outcome" | "refusal" | "emailIgnored" | "email"> {
    const no = (refusal: NetworkEnableRefusal) => ({ outcome: "REFUSED" as const, refusal, emailIgnored: false, email: null })
    const denial = credentialDenial(access, visibility, target, catalog)
    if (denial) return no(denial)
    if (!target.personActive) return no("PERSON_INACTIVE")
    if (target.account && target.account.credentialProvider !== "NETWORK") return no("EMERGENCY_ACCOUNT")
    if (target.account?.active) return { outcome: "ALREADY_ENABLED", refusal: null, emailIgnored: row.email !== null && row.email !== target.account.email.toLowerCase(), email: null }
    if (target.matriculaDuplicated) return no("MATRICULA_DUPLICATED")
    if (target.account) return { outcome: "REENABLE", refusal: null, emailIgnored: row.email !== null && row.email !== target.account.email.toLowerCase(), email: null }
    if (row.emailInvalid) return no("EMAIL_INVALID")
    const email = row.email ?? networkAccountIdentifier(networkLogin, deps.networkDomain)
    return email ? { outcome: "CREATE", refusal: null, emailIgnored: false, email } : no("EMAIL_REQUIRED")
  }
}

const toReport = (plan: Plan): NetworkEnableReport => {
  const counts: NetworkEnableReport["counts"] = { CREATE: 0, REENABLE: 0, ALREADY_ENABLED: 0, REFUSED: 0 }
  for (const row of plan.rows) counts[row.outcome] += 1
  return { rows: plan.rows.map(({ target: _target, email: _email, networkLogin: _login, ...row }) => { void [_target, _email, _login]; return row }), counts, ignoredColumns: plan.ignoredColumns }
}

/** Prévia: o que cada linha faria. Não grava nada. */
export async function previewNetworkEnable(deps: AccountAccessDeps, actor: SessionActor, bytes: Uint8Array): Promise<NetworkEnableReport> {
  return toReport(await planNetworkEnable(deps, actor, bytes))
}

/** Aplica: reavalia tudo no servidor e habilita as linhas que podem. CREATE/REENABLE no resultado = habilitada agora. */
export async function applyNetworkEnable(deps: AccountAccessDeps, actor: SessionActor, bytes: Uint8Array): Promise<NetworkEnableReport & { batchId: string }> {
  const plan = await planNetworkEnable(deps, actor, bytes)
  const pending = plan.rows.filter((row) => row.outcome === "CREATE" || row.outcome === "REENABLE")
  const batchId = randomUUID()
  if (pending.length > 0) {
    const enabled = await deps.accounts.enableForNetwork({
      organizationId: actor.organizationId, actorPersonId: actor.personId, actorAccountId: actor.accountId, at: deps.now(), batchId,
      retiredPasswordHash: await retiredPasswordHash(deps),
      create: pending.flatMap((row) => (row.outcome === "CREATE" ? [{ personId: row.target!.personId, email: row.email! }] : [])),
      reenable: pending.flatMap((row) => (row.outcome === "REENABLE" ? [{ personId: row.target!.personId, accountId: row.target!.account!.accountId, expectedSessionVersion: row.target!.account!.sessionVersion }] : [])),
    })
    // Mudou entre a leitura e a escrita (outra pessoa habilitou, o e-mail foi usado, a pessoa foi desativada): nada foi gravado nela.
    for (const row of pending) if (!enabled.has(row.target!.personId)) Object.assign(row, { outcome: "REFUSED", refusal: "CONCURRENT_CHANGE", login: null })
    await deps.networkAttempts.releaseUnreached(pending.flatMap((row) => (enabled.has(row.target!.personId) ? [row.networkLogin!] : [])), deps.now())
  }
  return { ...toReport(plan), batchId }
}
