import { z } from "zod"

/** Conta local de emergência (entra com e-mail e senha mesmo com o login pela rede ligado). */
export const emergencyAccountSchema = z.object({ accountId: z.string(), name: z.string(), email: z.string(), active: z.boolean(), lastLoginAt: z.string().nullable() })

/** Matrícula repetida com grafias diferentes (maiúscula/espaço) entre as contas da organização: ninguém entra por ela. */
export const ambiguousMatriculaSchema = z.object({ matricula: z.string(), accounts: z.number().int() })

/** Situação do login pela rede (`GET /api/v1/admin/network-login`). */
export const networkLoginStatusSchema = z.object({
  configured: z.boolean(),
  domain: z.string().nullable(),
  servers: z.array(z.string()),
  weakKeyAllowed: z.boolean(),
  httpsRequiredButMissing: z.boolean(),
  maxFailures: z.number().int(),
  enabled: z.boolean(),
  changedAt: z.string().nullable(),
  changedBy: z.string().nullable(),
  emergencyAccounts: z.array(emergencyAccountSchema),
  ambiguousMatriculas: z.array(ambiguousMatriculaSchema).default([]),
})
export type NetworkLoginStatus = z.infer<typeof networkLoginStatusSchema>

/** Conferência de cada servidor do AD (só a conexão TLS, nunca senha). */
export const networkServerProbeSchema = z.object({ url: z.string(), reachable: z.boolean(), trusted: z.boolean(), keyBits: z.number().int().nullable(), validUntil: z.string().nullable(), error: z.string().nullable() })
export const networkProbeResultSchema = z.object({ servers: z.array(networkServerProbeSchema) })
export type NetworkServerProbe = z.infer<typeof networkServerProbeSchema>
