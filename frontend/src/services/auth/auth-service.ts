import {
  currentUserSchema,
  loggedInUserSchema,
  loginOptionsSchema,
  type LoginOptions,
  type CurrentUser,
  type LoggedInUser,
  type LoginInput,
} from "@/schemas/auth/auth.schema"

const API_URL = process.env.INIA_API_URL ?? process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"
/** Tela do primeiro acesso: enquanto a troca de senha estiver pendente, a sessão só leva para cá (ou sai). */
export const CREATE_PASSWORD_ROUTE = "/auth/create-password"

export class InvalidCredentialsError extends Error {
  constructor() {
    super("E-mail ou senha inválidos.")
    this.name = "InvalidCredentialsError"
  }
}

/** Recusas com mensagem própria do backend (login por e-mail e login pela rede). */
const LOGIN_REFUSAL_CODES = ["LOGIN_TOO_MANY_ATTEMPTS", "ACCESS_DISABLED", "TEMPORARY_PASSWORD_EXPIRED", "NETWORK_LOGIN_REQUIRED", "NETWORK_PASSWORD_EXPIRED", "NETWORK_ACCOUNT_LOCKED", "NETWORK_ACCOUNT_DISABLED", "NETWORK_IDENTITY_UNREADABLE", "NETWORK_LOGIN_UNAVAILABLE"] as const
export type LoginRefusalCode = (typeof LOGIN_REFUSAL_CODES)[number]
const isRefusalCode = (code: string | undefined): code is LoginRefusalCode => (LOGIN_REFUSAL_CODES as readonly string[]).includes(code ?? "")

/** Recusa de login com o código do backend (trava de tentativas, acesso desabilitado, senha temporária vencida, conta de rede). */
export class LoginRefusedError extends Error {
  constructor(
    message: string,
    readonly code: LoginRefusalCode,
    readonly retryAt: Date | null = null,
  ) {
    super(message)
    this.name = "LoginRefusedError"
  }
}

type ErrorPayload = { error?: { code?: string; message?: string; details?: { retryAt?: string; violations?: { code: string; message: string }[] } } }
const readError = async (response: Response): Promise<ErrorPayload["error"]> => {
  try {
    return ((await response.json()) as ErrorPayload).error
  } catch {
    return undefined
  }
}

const minutesUntil = (retryAt: Date, now: Date) => Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 60_000))
const minutesText = (minutes: number) => `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`

/** "Tente novamente em N minutos" a partir do horário que o backend devolve (nunca menos de 1 minuto). */
export function retryMessage(retryAt: Date, now: Date = new Date()) {
  return `Muitas tentativas de acesso. Tente novamente em ${minutesText(minutesUntil(retryAt, now))}.`
}

/**
 * Trava do login pela rede: a mensagem do backend (que avisa que insistir pode bloquear a conta de rede) + quando libera.
 * Nunca a genérica (achado QA-04 da run-9).
 */
export function networkRetryMessage(backendMessage: string, retryAt: Date | null, now: Date = new Date()) {
  return retryAt ? `${backendMessage} Libera em ${minutesText(minutesUntil(retryAt, now))}.` : backendMessage
}

/** Opções do login + se a leitura deu certo (`checked: false` = não foi possível conferir o tipo de login). */
export type LoginOptionsResult = LoginOptions & { checked: boolean }

/**
 * Que login a tela mostra (lido no servidor do Next). Falha (API inalcançável, resposta fora do contrato) nunca cai em silêncio
 * no e-mail (achado QA-02 da run-9): vai para o log do servidor e a tela avisa, oferecendo a matrícula de rede E o e-mail.
 */
export async function fetchLoginOptions(): Promise<LoginOptionsResult> {
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/login-options`, { credentials: "include", cache: "no-store" })
    if (!response.ok) {
      console.error(JSON.stringify({ event: "login_options_unavailable", status: response.status, apiUrl: API_URL }))
      return { networkLogin: false, checked: false }
    }
    return { ...loginOptionsSchema.parse(((await response.json()) as { data: unknown }).data), checked: true }
  } catch (error) {
    console.error(JSON.stringify({ event: "login_options_unavailable", apiUrl: API_URL, message: error instanceof Error ? error.message : String(error) }))
    return { networkLogin: false, checked: false }
  }
}

/**
 * Endereço oficial (o da API, gravado no build) quando a pessoa abriu a INIA por outro endereço (IP, nome curto, http): o navegador
 * bloqueia a chamada ou não guarda o cookie de sessão, e a tela não tinha como dizer por quê.
 */
export function officialAddressHint(pageOrigin: string, apiUrl: string = API_URL): string | null {
  try {
    // Porta diferente não conta (desenvolvimento local): o que separa os endereços para o navegador aqui é o protocolo e o nome.
    const official = new URL(apiUrl)
    const page = new URL(pageOrigin)
    return official.protocol === page.protocol && official.hostname === page.hostname ? null : official.origin
  } catch {
    return null
  }
}
const pageAddressHint = () => (typeof window === "undefined" ? null : officialAddressHint(window.location.origin))

/** O navegador não conseguiu falar com o servidor (rede, certificado recusado, endereço diferente do oficial). */
export function unreachableServerMessage(official: string | null = pageAddressHint()): string {
  return `Não foi possível falar com o servidor da INIA.${official ? ` Abra pelo endereço oficial: ${official}` : " Confira a sua conexão e tente de novo."}`
}

/** A senha foi aceita, mas o navegador não guardou a sessão (cookie bloqueado ou endereço diferente do oficial). */
export function sessionNotKeptMessage(official: string | null = pageAddressHint()): string {
  return `Sua senha foi aceita, mas o navegador não guardou a sessão. ${official ? `Abra a INIA pelo endereço oficial: ${official}` : "Permita os cookies deste site e tente de novo; se continuar, avise o administrador da INIA."}`
}

export async function login(input: LoginInput): Promise<LoggedInUser> {
  let response: Response
  try {
    response = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    })
  } catch {
    throw new Error(unreachableServerMessage())
  }
  if (!response.ok) {
    const error = await readError(response)
    if (error?.code === "LOGIN_TOO_MANY_ATTEMPTS") {
      const retryAt = error.details?.retryAt ? new Date(error.details.retryAt) : null
      if ("matricula" in input && error.message) throw new LoginRefusedError(networkRetryMessage(error.message, retryAt), "LOGIN_TOO_MANY_ATTEMPTS", retryAt)
      throw new LoginRefusedError(retryAt ? retryMessage(retryAt) : error.message ?? "Muitas tentativas de acesso.", "LOGIN_TOO_MANY_ATTEMPTS", retryAt)
    }
    // Sessão antiga neste navegador + endereço fora do oficial: a proteção contra CSRF recusa a escrita.
    if (error?.code === "CROSS_SITE_REQUEST_BLOCKED") throw new Error(unreachableServerMessage())
    // Limite por IP + login (429 RATE_LIMITED): a mensagem do backend diz se foi a matrícula ou o e-mail.
    if (error?.code === "RATE_LIMITED" && error.message) throw new Error(error.message)
    if (isRefusalCode(error?.code)) throw new LoginRefusedError(error?.message ?? "Não foi possível entrar.", error!.code as LoginRefusalCode)
    if (response.status === 401) {
      if ("matricula" in input) throw new Error(error?.message ?? "Não foi possível entrar com esta matrícula e senha de rede.")
      throw new InvalidCredentialsError()
    }
    throw new Error("Não foi possível entrar. Tente novamente.")
  }
  const payload: unknown = await response.json()
  return loggedInUserSchema.parse((payload as { data: unknown }).data)
}

/** Recusa da criação de senha no primeiro acesso (política, confirmação, igual à temporária, sessão encerrada…). */
export class DefinePasswordError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number,
    readonly violations: { code: string; message: string }[] = [],
  ) {
    super(message)
    this.name = "DefinePasswordError"
  }
}

/** Primeiro acesso: cria a senha da pessoa (a sessão atual continua; as outras são encerradas pelo backend). */
export async function defineFirstPassword(input: { newPassword: string; confirmPassword: string }): Promise<void> {
  const response = await fetch(`${API_URL}/api/v1/auth/password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify(input),
  })
  if (response.ok) return
  const error = await readError(response)
  throw new DefinePasswordError(error?.message ?? "Não foi possível criar a senha. Tente novamente.", error?.code ?? null, response.status, error?.details?.violations ?? [])
}

export async function logout(): Promise<void> {
  await fetch(`${API_URL}/api/v1/auth/logout`, { method: "POST", credentials: "include" })
}

/** Encerra TODAS as sessões da pessoa, inclusive esta (outro computador esquecido aberto, suspeita de uso do acesso). */
export async function logoutEverywhere(): Promise<void> {
  const response = await fetch(`${API_URL}/api/v1/auth/logout-all`, { method: "POST", credentials: "include" })
  if (!response.ok && response.status !== 401) throw new Error("Não foi possível encerrar as outras sessões. Tente novamente.")
}

/** Aviso de interação na tela: mantém viva a sessão de quem está usando a INIA (as leituras automáticas não contam). */
export async function reportSessionActivity(): Promise<"ok" | "ended"> {
  const response = await fetch(`${API_URL}/api/v1/auth/activity`, { method: "POST", credentials: "include", cache: "no-store" })
  return response.status === 401 ? "ended" : "ok"
}

export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const response = await fetch(`${API_URL}/api/v1/auth/me`, { credentials: "include", cache: "no-store" })
  if (!response.ok) return null
  const payload: unknown = await response.json()
  return currentUserSchema.parse((payload as { data: unknown }).data)
}

/**
 * Página inicial depois do login (V1.5.8). O NÍVEL HIERÁRQUICO só decide a casa OPERACIONAL (Operador → /operator; quem está
 * na cadeia de gestão → /supervisor). Quem está fora da hierarquia não tem casa operacional: vai para
 * a Administração SE a conta tiver a capability — senão para o perfil. O nível nunca abre a Administração por si.
 */
const MANAGEMENT_LEVELS: ReadonlySet<CurrentUser["role"]> = new Set(["SUPERVISOR", "COORDINATOR", "MANAGER", "SENIOR_MANAGER", "DIRECTOR"])

/**
 * "Meu perfil" da pessoa AUTENTICADA. Operador → /operator; qualquer outra conta (gestão OU fora da hierarquia, inclusive o
 * administrador sem posição operacional) → /supervisor, que renderiza o próprio perfil pelo mesmo shell. Nunca depende da
 * Administração nem de cargo para abrir: o perfil existe para toda conta.
 */
export function myProfileHrefFor(user: Pick<CurrentUser, "role">) {
  return user.role === "OPERATOR" ? "/operator" : "/supervisor"
}

export function landingRouteFor(user: Pick<CurrentUser, "role" | "access"> & { passwordChangeRequired?: boolean }) {
  // Primeiro acesso pendente: nada além de criar a senha.
  if (user.passwordChangeRequired) return CREATE_PASSWORD_ROUTE
  if (user.role === "OPERATOR") return "/operator"
  if (MANAGEMENT_LEVELS.has(user.role)) return "/supervisor"
  return user.access.capabilities.canAccessAdministration ? "/admin" : "/supervisor"
}
