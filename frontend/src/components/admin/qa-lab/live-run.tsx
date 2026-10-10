"use client"

import { useQaRunQuery } from "@/queries/admin/use-qa-lab-queries"
import type { QaRun } from "@/schemas/admin/qa-lab.schema"

/** Renderiza sempre a versão mais recente do run no cache do React Query — retomadas, decisões
 * e "Executar novamente" atualizam o cache via setQueryData, então o trace muda sem refetch. */
export function LiveRun({ id, fallback, children }: { id: string; fallback: QaRun; children: (run: QaRun) => React.ReactNode }) {
  const query = useQaRunQuery(id)
  return <>{children(query.data ?? fallback)}</>
}
