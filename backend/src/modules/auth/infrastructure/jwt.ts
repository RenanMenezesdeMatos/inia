import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"
import { env } from "../../../config/env.js"

export type PlatformRole = "OPERATOR" | "ADMIN" | "COORDINATOR" | "SUPERVISOR" | "MANAGER" | "SENIOR_MANAGER" | "DIRECTOR"

export type AuthTokenPayload = {
  sub: string
  personId: string
  organizationId: string
  role: PlatformRole
  name: string
  email: string
  avatarUrl: string | null
  jobTitle: string | null
  teamId: string | null
  teamName: string | null
  /** Versão de sessão da conta no login — o backend confere a cada request (versão diferente = sessão revogada). */
  sv?: number
  /** Troca de senha obrigatória pendente no login. Só uma DICA para o frontend redirecionar; quem bloqueia é o banco. */
  pc?: boolean
}

/** Só os campos da sessão (sem `iat`/`exp` de um token já verificado) — para emitir um token novo a partir de outro. */
export function sessionPayloadOf(user: AuthTokenPayload, overrides: Pick<AuthTokenPayload, "sv" | "pc">): AuthTokenPayload {
  const { sub, personId, organizationId, role, name, email, avatarUrl, jobTitle, teamId, teamName } = user
  const payload: AuthTokenPayload = { sub, personId, organizationId, role, name, email, avatarUrl, jobTitle, teamId, teamName, sv: overrides.sv ?? 0 }
  if (overrides.pc) payload.pc = true
  return payload
}

/** O ÚNICO algoritmo aceito: a verificação nunca deixa o próprio token escolher (`alg: none`, troca de algoritmo). */
const SESSION_TOKEN_ALGORITHM = "HS256" as const

/** Token verificado: a sessão + `jti` (id desta sessão, para o logout revogá-la) e `exp` (até quando a revogação importa). */
export type VerifiedAuthToken = AuthTokenPayload & { jti?: string; exp?: number }

export function signAuthToken(payload: AuthTokenPayload) {
  return issueSessionToken(payload).token
}

/** Token novo + o id e o vencimento desta sessão (o registro de atividade e a revogação usam os dois). */
export function issueSessionToken(payload: AuthTokenPayload): { token: string; jti: string; expiresAt: Date } {
  const jti = randomUUID()
  const token = jwt.sign(payload, env.JWT_SECRET, { algorithm: SESSION_TOKEN_ALGORITHM, expiresIn: env.JWT_EXPIRES_IN, jwtid: jti } as jwt.SignOptions)
  const exp = (jwt.decode(token) as { exp?: number } | null)?.exp
  return { token, jti, expiresAt: new Date(typeof exp === "number" ? exp * 1000 : Date.now() + parseDurationToMs(env.JWT_EXPIRES_IN)) }
}

export function verifyAuthToken(token: string): VerifiedAuthToken {
  const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: [SESSION_TOKEN_ALGORITHM] })
  // Assinatura válida mas sem a forma de uma sessão (outro uso do mesmo segredo, payload string): nunca vira identidade.
  if (typeof payload !== "object" || payload === null || typeof payload.sub !== "string" || typeof (payload as { organizationId?: unknown }).organizationId !== "string" || typeof (payload as { personId?: unknown }).personId !== "string") {
    throw new jwt.JsonWebTokenError("invalid session payload")
  }
  return payload as VerifiedAuthToken
}

const DURATION_UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

export function parseDurationToMs(duration: string, fallbackMs = 12 * 60 * 60 * 1000) {
  const match = /^(\d+)([smhd])$/.exec(duration.trim())
  if (!match) return fallbackMs
  const [, amount, unit] = match
  const unitMs = DURATION_UNIT_MS[unit ?? "h"] ?? DURATION_UNIT_MS.h ?? 3_600_000
  return Number(amount) * unitMs
}
