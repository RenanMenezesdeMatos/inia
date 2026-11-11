"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchErrorCode, fetchErrorReference, searchErrorCodes } from "@/services/error-diagnostics/error-diagnostics-service"

const KEY = ["error-diagnostics"] as const

export const useErrorCodeSearchQuery = (query: string) => useQuery({ queryKey: [...KEY, "search", query], queryFn: () => searchErrorCodes(query), staleTime: 5 * 60_000 })
export const useErrorCodeQuery = (code: string | null) => useQuery({ queryKey: [...KEY, "code", code], queryFn: () => fetchErrorCode(code!), enabled: Boolean(code), retry: false })
export const useErrorReferenceQuery = (reference: string | null) => useQuery({ queryKey: [...KEY, "reference", reference], queryFn: () => fetchErrorReference(reference!), enabled: Boolean(reference), retry: false })
