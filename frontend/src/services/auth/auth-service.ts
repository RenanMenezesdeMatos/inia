import {
  currentUserSchema,
  loggedInUserSchema,
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

/** Recusa de login com o código do backend (trava de tentativas, acesso desabilitado, senha temporária vencida). */
export class LoginRefusedError extends Error {
  constructor(
    message: string,
    readonly code: "LOGIN_TOO_MANY_ATTEMPTS" | "ACCESS_DISABLED" | "TEMPORARY_PASSWORD_EXPIRED",
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

/** "Tente novamente em N minutos" a partir do horário que o backend devolve (nunca menos de 1 minuto). */
export function retryMessage(retryAt: Date, now: Date = new Date()) {
  const minutes = Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 60_000))
  return `Muitas tentativas de acesso. Tente novamente em ${minutes} ${minutes === 1 ? "minuto" : "minutos"}.`
}

export async function login(input: LoginInput): Promise<LoggedInUser> {
  const response = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const error = await readError(response)
    if (error?.code === "LOGIN_TOO_MANY_ATTEMPTS") {
      const retryAt = error.details?.retryAt ? new Date(error.details.retryAt) : null
      throw new LoginRefusedError(retryAt ? retryMessage(retryAt) : error.message ?? "Muitas tentativas de acesso.", "LOGIN_TOO_MANY_ATTEMPTS", retryAt)
    }
    if (error?.code === "ACCESS_DISABLED" || error?.code === "TEMPORARY_PASSWORD_EXPIRED") throw new LoginRefusedError(error.message ?? "Não foi possível entrar.", error.code)
    if (response.status === 401) throw new InvalidCredentialsError()
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
