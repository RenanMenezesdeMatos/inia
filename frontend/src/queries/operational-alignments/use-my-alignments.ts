"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type { MyAlignment } from "@/schemas/operational-alignments/my-alignment.schema"
import { fetchMyAlignments, markMyAlignmentRead } from "@/services/operational-alignments/my-alignments-service"

export const myAlignmentsKey = ["operational-alignments", "mine"] as const

/** Fonte "alinhamentos" do Acompanhamento do operador. */
export function useMyAlignmentsQuery() {
  return useQuery({ queryKey: myAlignmentsKey, queryFn: fetchMyAlignments, refetchOnWindowFocus: true })
}

/** "Li o alinhamento": grava e atualiza o item na hora (a fonte de verdade continua o servidor). */
export function useMarkMyAlignmentReadMutation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ alignmentId, versionId }: { alignmentId: string; versionId: string }) => markMyAlignmentRead(alignmentId, versionId),
    onSuccess: ({ readAt }, { versionId }) => {
      client.setQueryData<MyAlignment[]>(myAlignmentsKey, (items) => items?.map((item) => (item.versionId === versionId ? { ...item, readAt } : item)))
    },
  })
}
