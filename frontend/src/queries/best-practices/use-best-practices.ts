"use client"

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { ApiError } from "@/lib/api/api-client"
import type { CreateAnalysisInput, PatternFilters, ReviewInput } from "@/schemas/best-practices/best-practices.schema"
import {
  createAnalysis,
  fetchAnalyses,
  fetchAnalysis,
  fetchBestPracticesMeta,
  fetchEvidenceCall,
  fetchGuidancePreview,
  fetchPattern,
  fetchPatterns,
  fetchRelevantPractices,
  reviewPattern,
} from "@/services/best-practices/best-practices-service"

export const bestPracticeKeys = {
  all: ["best-practices"] as const,
  meta: () => [...bestPracticeKeys.all, "meta"] as const,
  patterns: (filters: PatternFilters) => [...bestPracticeKeys.all, "patterns", filters] as const,
  pattern: (id: string) => [...bestPracticeKeys.all, "pattern", id] as const,
  evidence: (id: string) => [...bestPracticeKeys.all, "evidence", id] as const,
  analyses: () => [...bestPracticeKeys.all, "analyses"] as const,
  analysis: (id: string) => [...bestPracticeKeys.all, "analysis", id] as const,
  relevant: (query: Record<string, string | null | undefined>) => [...bestPracticeKeys.all, "relevant", query] as const,
  preview: (query: Record<string, string>) => [...bestPracticeKeys.all, "preview", query] as const,
}

const errorMessage = (error: unknown) => (error instanceof ApiError ? error.message : "Não foi possível concluir a ação.")

export const useBestPracticesMetaQuery = () => useQuery({ queryKey: bestPracticeKeys.meta(), queryFn: fetchBestPracticesMeta, staleTime: 60_000 })
export const usePatternsQuery = (filters: PatternFilters) => useQuery({ queryKey: bestPracticeKeys.patterns(filters), queryFn: () => fetchPatterns(filters), placeholderData: keepPreviousData })
export const usePatternQuery = (id: string | null) => useQuery({ queryKey: bestPracticeKeys.pattern(id ?? ""), queryFn: () => fetchPattern(id!), enabled: id !== null })
export const useEvidenceCallQuery = (id: string | null) => useQuery({ queryKey: bestPracticeKeys.evidence(id ?? ""), queryFn: () => fetchEvidenceCall(id!), enabled: id !== null, staleTime: 5 * 60_000 })
/** Enquanto houver análise na fila ou em andamento, a lista se atualiza sozinha (o worker processa em segundo plano). */
export const useAnalysesQuery = () =>
  useQuery({ queryKey: bestPracticeKeys.analyses(), queryFn: fetchAnalyses, refetchInterval: (query) => (query.state.data?.some((item) => item.status === "QUEUED" || item.status === "RUNNING") ? 5_000 : false) })
export const useAnalysisQuery = (id: string | null) => useQuery({ queryKey: bestPracticeKeys.analysis(id ?? ""), queryFn: () => fetchAnalysis(id!), enabled: id !== null })
export const useRelevantPracticesQuery = (query: { indicatorId?: string | null; reason?: string | null; subReason?: string | null; personId?: string | null; interactionId?: string | null }, enabled = true) =>
  useQuery({ queryKey: bestPracticeKeys.relevant(query), queryFn: () => fetchRelevantPractices(query), enabled: enabled && Boolean(query.indicatorId || query.reason || query.interactionId), staleTime: 60_000, retry: false })
export const useGuidancePreviewQuery = (query: { datasetId: string; operatorRef: string; indicatorId: string } | null) =>
  useQuery({ queryKey: bestPracticeKeys.preview(query ?? { datasetId: "", operatorRef: "", indicatorId: "" }), queryFn: () => fetchGuidancePreview(query!), enabled: query !== null })

export function useReviewPatternMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ReviewInput) => reviewPattern(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bestPracticeKeys.all })
      toast.success("Revisão registrada.")
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
}

export function useCreateAnalysisMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateAnalysisInput) => createAnalysis(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bestPracticeKeys.analyses() })
      toast.success("Análise na fila. O resultado aparece aqui quando terminar.")
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
}
