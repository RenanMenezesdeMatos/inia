import { z } from "zod"
import { operatingUniverseSchema } from "@/schemas/operating-universe/operating-universe.schema"

// Universo de atuação (migration 204): no Grupo, o dele; no Subgrupo, o EFETIVO (o próprio ou o do Grupo-pai). Opcional e nulo =
// pendente/servidor antigo — os seletores tratam ausência como "cabe em qualquer universo" (lib/operating-universe/hierarchy.ts).
const unitUniverseSchema = operatingUniverseSchema.nullable().optional().catch(null)

export const subteamSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string(),
  operatingUniverse: unitUniverseSchema,
})
export type Subteam = z.infer<typeof subteamSchema>

export const teamSchema = z.object({
  id: z.string(),
  name: z.string(),
  operationId: z.string(),
  operatingUniverse: unitUniverseSchema,
  subteams: z.array(subteamSchema),
})
export type Team = z.infer<typeof teamSchema>

export const subjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  active: z.boolean(),
})
export type Subject = z.infer<typeof subjectSchema>

// Times/subgrupos que o admin ATUAL pode administrar (Escopo Administrativo) — nunca a org
// inteira pra quem é restrito. `unrestricted` diz se a opção "Todos os grupos" pode ser
// oferecida nos seletores de Alcance de Workflow/Agent/Orchestrator.
export const manageableTeamsSchema = z.object({
  teams: z.array(teamSchema),
  unrestricted: z.boolean(),
})
export type ManageableTeams = z.infer<typeof manageableTeamsSchema>

export const orgScopeTypeSchema = z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"])
export type OrgScopeType = z.infer<typeof orgScopeTypeSchema>

export const subjectScopeTypeSchema = z.enum(["ALL_SUBJECTS", "SUBJECT"])
export type SubjectScopeType = z.infer<typeof subjectScopeTypeSchema>
