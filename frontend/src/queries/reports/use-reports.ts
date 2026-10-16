"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchDelivery, fetchReceivedDeliveries, fetchReport, fetchReportOptions, fetchReportProposal, fetchReports } from "@/services/reports/reports-service"

export const reportKeys = {
  all: ["reports"] as const,
  list: ["reports", "list"] as const,
  detail: (id: string) => ["reports", "detail", id] as const,
  options: ["reports", "options"] as const,
  proposal: (id: string) => ["reports", "proposal", id] as const,
  received: (reportId?: string) => ["reports", "received", reportId ?? "all"] as const,
  delivery: (id: string) => ["reports", "delivery", id] as const,
}

export const useReportsQuery = () => useQuery({ queryKey: reportKeys.list, queryFn: fetchReports })
export const useReportQuery = (id: string) => useQuery({ queryKey: reportKeys.detail(id), queryFn: () => fetchReport(id) })
export const useReportOptionsQuery = () => useQuery({ queryKey: reportKeys.options, queryFn: fetchReportOptions, staleTime: 60_000 })
export const useReportProposalQuery = (id: string | null) => useQuery({ queryKey: reportKeys.proposal(id ?? ""), queryFn: () => fetchReportProposal(id!), enabled: Boolean(id), staleTime: Infinity })
export const useReceivedDeliveriesQuery = (reportId?: string) => useQuery({ queryKey: reportKeys.received(reportId), queryFn: () => fetchReceivedDeliveries(reportId) })
export const useDeliveryQuery = (id: string) => useQuery({ queryKey: reportKeys.delivery(id), queryFn: () => fetchDelivery(id) })
