"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type { ViewLayout } from "@/components/ui/customizable-grid/layout"
import type { ViewLayoutKey } from "@/schemas/view-layouts/view-layout.schema"
import { fetchViewLayout, resetViewLayout, saveViewLayout } from "@/services/view-layouts/view-layout-service"

const key = (viewKey: ViewLayoutKey) => ["view-layouts", viewKey] as const

/** A disposição salva da pessoa numa tela (muda só quando ela mesma salva: não relê sozinha). */
export function useViewLayout(viewKey: ViewLayoutKey) {
  const client = useQueryClient()
  const query = useQuery({ queryKey: key(viewKey), queryFn: () => fetchViewLayout(viewKey), staleTime: Infinity, refetchOnWindowFocus: false })
  const save = useMutation({ mutationFn: (layout: ViewLayout) => saveViewLayout(viewKey, layout), onSuccess: (data) => client.setQueryData(key(viewKey), data) })
  const reset = useMutation({ mutationFn: () => resetViewLayout(viewKey), onSuccess: () => client.setQueryData(key(viewKey), { layout: null, updatedAt: null }) })
  return { query, save, reset }
}
