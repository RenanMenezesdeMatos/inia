import { useQuery } from "@tanstack/react-query"

import { fetchManageableTeams, fetchSubjects, fetchTeams } from "@/services/admin/org-structure-service"

import { adminQueryKeys } from "./admin-query-keys"

export function useTeamsQuery() {
  return useQuery({ queryKey: adminQueryKeys.teams(), queryFn: fetchTeams })
}

// Só pros seletores de Alcance de Workflow/Agent/Orchestrator (Escopo Administrativo) — as
// demais telas continuam com useTeamsQuery (org inteira), que segue correto pra elas.
export function useManageableTeamsQuery() {
  return useQuery({ queryKey: adminQueryKeys.manageableTeams(), queryFn: fetchManageableTeams })
}

export function useSubjectsQuery() {
  return useQuery({ queryKey: adminQueryKeys.subjects(), queryFn: fetchSubjects })
}
