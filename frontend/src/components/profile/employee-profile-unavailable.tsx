"use client"

import Link from "next/link"
import { Lock } from "lucide-react"

import { AnalyticsEmptyState } from "@/components/analytics/analytics-states"
import { Button } from "@/components/ui/button"

const COPY = {
  forbidden: { title: "Sem acesso a este colaborador", description: "Você só pode abrir pessoas que fazem parte da sua estrutura." },
  not_found: { title: "Colaborador não encontrado", description: "O colaborador pode ter sido removido ou o endereço está incorreto." },
  error: { title: "Não foi possível carregar o colaborador", description: "Tente novamente em instantes." },
} as const

/**
 * Estado "ficha indisponível" (403/404/erro) como Client Component: a página é Server Component e
 * não pode passar o ícone (função) para `AnalyticsEmptyState` — só o `status` (string) atravessa
 * a fronteira. Antes, abrir um colaborador fora do escopo derrubava a página com
 * "Only plain objects can be passed to Client Components".
 */
export function EmployeeProfileUnavailable({ status }: { status: keyof typeof COPY }) {
  const copy = COPY[status]
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12">
      <AnalyticsEmptyState
        icon={Lock}
        title={copy.title}
        description={copy.description}
        action={
          <Button variant="outline" asChild>
            <Link href="/supervisor?tab=people">Voltar para a equipe</Link>
          </Button>
        }
      />
    </main>
  )
}
