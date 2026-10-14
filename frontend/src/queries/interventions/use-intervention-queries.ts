"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { ApiError } from "@/lib/api/api-client"
import type { InterventionDetail } from "@/schemas/interventions/intervention.schema"
import { fetchCaseInterventions, fetchForwardTargets, fetchIntervention, fetchPersonInterventions, fetchTrainingCompetencies, retryReportNarrative } from "@/services/interventions/intervention-service"

import { notificationKeys } from "../notifications/notifications-query-keys"
import { pendingActionKeys } from "../pending-actions/pending-actions-query-keys"

export const interventionKeys = {
  all: ["interventions"] as const,
  detail: (id: string) => ["interventions", "detail", id] as const,
  case: (caseId: string) => ["interventions", "case", caseId] as const,
  person: (personId: string) => ["interventions", "person", personId] as const,
  forwardTargets: (id: string) => ["interventions", "forward-targets", id] as const,
  competencies: () => ["interventions", "competencies"] as const,
}

export function useInterventionQuery(id: string | null) {
  return useQuery({ queryKey: interventionKeys.detail(id ?? ""), queryFn: () => fetchIntervention(id!), enabled: Boolean(id) })
}

export function useCaseInterventionsQuery(caseId: string) {
  return useQuery({ queryKey: interventionKeys.case(caseId), queryFn: () => fetchCaseInterventions(caseId) })
}

export function usePersonInterventionsQuery(personId: string) {
  return useQuery({ queryKey: interventionKeys.person(personId), queryFn: () => fetchPersonInterventions(personId) })
}

export function useTrainingCompetenciesQuery(enabled: boolean) {
  return useQuery({ queryKey: interventionKeys.competencies(), queryFn: fetchTrainingCompetencies, enabled, staleTime: 60_000 })
}

export function useForwardTargetsQuery(id: string, enabled: boolean) {
  return useQuery({ queryKey: interventionKeys.forwardTargets(id), queryFn: () => fetchForwardTargets(id), enabled })
}

/**
 * Comando sobre uma intervenção: atualiza o detalhe com a resposta e invalida SÓ o que muda — a intervenção no caso e na
 * ficha, a fila de Pendências, o sino, os contadores da Equipe e o Acompanhamento (avisos novos).
 */
export function useInterventionCommand<TVariables>(mutationFn: (variables: TVariables) => Promise<InterventionDetail>, successMessage?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (detail) => {
      queryClient.setQueryData(interventionKeys.detail(detail.id), detail)
      void queryClient.invalidateQueries({ queryKey: interventionKeys.case(detail.caseId) })
      void queryClient.invalidateQueries({ queryKey: interventionKeys.person(detail.person.id) })
      void queryClient.invalidateQueries({ queryKey: pendingActionKeys.list() })
      void queryClient.invalidateQueries({ queryKey: notificationKeys.summary() })
      void queryClient.invalidateQueries({ queryKey: ["analytics", "context"] })
      void queryClient.invalidateQueries({ queryKey: ["analytics", "team-members"] })
      void queryClient.invalidateQueries({ queryKey: ["analytics", "follow-ups"] })
      if (successMessage) toast.success(successMessage)
    },
    onError: (error) => {
      // Revisão desatualizada: recarrega o detalhe para a pessoa ver o estado atual antes de tentar de novo.
      if (error instanceof ApiError && error.code === "INTERVENTION_CONCURRENT_CHANGE") void queryClient.invalidateQueries({ queryKey: interventionKeys.all })
      toast.error(error instanceof Error ? error.message : "Não foi possível concluir a ação.")
    },
  })
}

export function useRetryNarrativeMutation(interventionId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: retryReportNarrative,
    onSuccess: (report) => {
      void queryClient.invalidateQueries({ queryKey: interventionKeys.detail(interventionId) })
      if (report.narrative.status === "READY") toast.success("Narrativa gerada.")
      else toast.error(report.narrative.lastError ?? "A narrativa não pôde ser gerada; os fatos e as ações continuam disponíveis.")
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível gerar a narrativa."),
  })
}
