"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import type { MemoryFilters, ProcessOrder } from "@/schemas/diagnostics/diagnostics-memory.schema"
import {
  fetchAssessmentDetail,
  fetchAssessments,
  fetchConcentration,
  fetchIndicatorInvestigation,
  fetchIndicatorInvestigations,
  fetchMaterialAggregates,
  fetchMemoryFilterOptions,
  fetchMemorySummary,
  fetchPeopleAggregates,
  fetchProcessAggregates,
} from "@/services/diagnostics/diagnostics-memory-service"

const keys = {
  all: ["diagnostics-memory"] as const,
  summary: (filters: MemoryFilters) => [...keys.all, "summary", filters] as const,
  options: () => [...keys.all, "options"] as const,
  processes: (filters: MemoryFilters, order: ProcessOrder) => [...keys.all, "processes", filters, order] as const,
  people: (filters: MemoryFilters, groupBy: string, page: number, pageSize: number) => [...keys.all, "people", filters, groupBy, page, pageSize] as const,
  concentration: (filters: MemoryFilters, dimension: string) => [...keys.all, "concentration", filters, dimension] as const,
  materials: (filters: MemoryFilters) => [...keys.all, "materials", filters] as const,
  indicators: (filters: MemoryFilters, page: number, pageSize: number) => [...keys.all, "indicators", filters, page, pageSize] as const,
  indicator: (id: string) => [...keys.all, "indicator", id] as const,
  assessments: (filters: MemoryFilters, page: number, pageSize: number) => [...keys.all, "assessments", filters, page, pageSize] as const,
  assessment: (id: string) => [...keys.all, "assessment", id] as const,
}

export const useMemorySummaryQuery = (filters: MemoryFilters) => useQuery({ queryKey: keys.summary(filters), queryFn: () => fetchMemorySummary(filters), placeholderData: keepPreviousData })
export const useMemoryFilterOptionsQuery = () => useQuery({ queryKey: keys.options(), queryFn: fetchMemoryFilterOptions, staleTime: 5 * 60_000 })
export const useProcessAggregatesQuery = (filters: MemoryFilters, order: ProcessOrder = "DEVIATIONS") => useQuery({ queryKey: keys.processes(filters, order), queryFn: () => fetchProcessAggregates(filters, order), placeholderData: keepPreviousData })
export const usePeopleAggregatesQuery = (filters: MemoryFilters, groupBy: string, page: number, pageSize: number) => useQuery({ queryKey: keys.people(filters, groupBy, page, pageSize), queryFn: () => fetchPeopleAggregates(filters, groupBy, page, pageSize), placeholderData: keepPreviousData })
export const useConcentrationQuery = (filters: MemoryFilters, dimension: string) => useQuery({ queryKey: keys.concentration(filters, dimension), queryFn: () => fetchConcentration(filters, dimension), placeholderData: keepPreviousData })
export const useMaterialAggregatesQuery = (filters: MemoryFilters) => useQuery({ queryKey: keys.materials(filters), queryFn: () => fetchMaterialAggregates(filters), placeholderData: keepPreviousData })
export const useIndicatorInvestigationsQuery = (filters: MemoryFilters, page: number, pageSize: number) => useQuery({ queryKey: keys.indicators(filters, page, pageSize), queryFn: () => fetchIndicatorInvestigations(filters, page, pageSize), placeholderData: keepPreviousData })
export const useIndicatorInvestigationQuery = (id: string | null) => useQuery({ queryKey: keys.indicator(id ?? ""), queryFn: () => fetchIndicatorInvestigation(id!), enabled: id !== null })
export const useAssessmentsQuery = (filters: MemoryFilters, page: number, pageSize: number, enabled = true) => useQuery({ queryKey: keys.assessments(filters, page, pageSize), queryFn: () => fetchAssessments(filters, page, pageSize), placeholderData: keepPreviousData, enabled })
export const useAssessmentDetailQuery = (id: string | null) => useQuery({ queryKey: keys.assessment(id ?? ""), queryFn: () => fetchAssessmentDetail(id!), enabled: id !== null })
