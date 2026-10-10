import { z } from "zod"

export const subteamSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string(),
})
export type Subteam = z.infer<typeof subteamSchema>

export const teamSchema = z.object({
  id: z.string(),
  name: z.string(),
  operationId: z.string(),
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
