import { z } from "zod"

import { adminGet } from "@/lib/admin/admin-api"
import {
  manageableTeamsSchema,
  subjectSchema,
  teamSchema,
  type ManageableTeams,
  type Subject,
  type Team,
} from "@/schemas/admin/org-structure.schema"

export async function fetchTeams(): Promise<Team[]> {
  return z.array(teamSchema).parse(await adminGet("/api/v1/admin/org-structure/teams"))
}

export async function fetchManageableTeams(): Promise<ManageableTeams> {
  return manageableTeamsSchema.parse(await adminGet("/api/v1/admin/org-structure/teams/manageable"))
}

export async function fetchSubjects(): Promise<Subject[]> {
  return z.array(subjectSchema).parse(await adminGet("/api/v1/admin/org-structure/subjects"))
}

