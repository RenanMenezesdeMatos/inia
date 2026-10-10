import { apiGet, toQueryString } from "@/lib/api/api-client"
import {
  assessmentDetailSchema,
  assessmentPageSchema,
  concentrationSchema,
  filterOptionsSchema,
  indicatorDetailSchema,
  indicatorPageSchema,
  materialsSchema,
  memorySummarySchema,
  peoplePageSchema,
  processThemesSchema,
  type MemoryFilters,
  type ProcessOrder,
} from "@/schemas/diagnostics/diagnostics-memory.schema"

const BASE = "/api/v1/diagnostics/memory"
const API_URL = process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"
const query = (filters: MemoryFilters, extra: Record<string, string | number | null | undefined> = {}) => toQueryString({ ...filters, ...extra })

export const fetchMemorySummary = async (filters: MemoryFilters) => memorySummarySchema.parse(await apiGet(`${BASE}/summary${query(filters)}`))
export const fetchMemoryFilterOptions = async () => filterOptionsSchema.parse(await apiGet(`${BASE}/filter-options`))
export const fetchProcessAggregates = async (filters: MemoryFilters, order: ProcessOrder = "DEVIATIONS") => processThemesSchema.parse(await apiGet(`${BASE}/processes${query(filters, { order })}`))
export const fetchPeopleAggregates = async (filters: MemoryFilters, groupBy: string, page: number, pageSize: number) => peoplePageSchema.parse(await apiGet(`${BASE}/people${query(filters, { groupBy, page, pageSize })}`))
export const fetchConcentration = async (filters: MemoryFilters, dimension: string) => concentrationSchema.parse(await apiGet(`${BASE}/concentration${query(filters, { dimension })}`))
export const fetchMaterialAggregates = async (filters: MemoryFilters) => materialsSchema.parse(await apiGet(`${BASE}/materials${query(filters)}`))
export const fetchIndicatorInvestigations = async (filters: MemoryFilters, page: number, pageSize: number) => indicatorPageSchema.parse(await apiGet(`${BASE}/indicators${query(filters, { page, pageSize })}`))
export const fetchIndicatorInvestigation = async (id: string) => indicatorDetailSchema.parse(await apiGet(`${BASE}/indicators/${encodeURIComponent(id)}`))
export const fetchAssessments = async (filters: MemoryFilters, page: number, pageSize: number) => assessmentPageSchema.parse(await apiGet(`${BASE}/assessments${query(filters, { page, pageSize })}`))
export const fetchAssessmentDetail = async (id: string) => assessmentDetailSchema.parse(await apiGet(`${BASE}/assessments/${encodeURIComponent(id)}`))

/** Link de exportação (CSV, mesmo escopo e filtros da tela; o cookie de sessão autentica o download). */
export const memoryExportHref = (filters: MemoryFilters, view: string, extra: Record<string, string | null | undefined> = {}) => `${API_URL}${BASE}/export.csv${query(filters, { view, ...extra })}`
