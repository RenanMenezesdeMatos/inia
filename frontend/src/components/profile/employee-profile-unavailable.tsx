"use client"

import Link from "next/link"
import { Lock } from "lucide-react"

import { AnalyticsEmptyState } from "@/components/analytics/analytics-states"
import { Button } from "@/components/ui/button"

import type { ProfileBackLink } from "./employee-profile-exit"

const COPY = {
  forbidden: { title: "Sem acesso a este colaborador", description: null },
  not_found: { title: "Colaborador não encontrado", description: "O colaborador pode ter sido removido ou o endereço está incorreto." },
  error: { title: "Não foi possível carregar o colaborador", description: "Tente novamente em instantes." },
} as const

/**
 * Estado "ficha indisponível" (403/404/erro) como Client Component: a página é Server Component e
 * não pode passar o ícone (função) para `AnalyticsEmptyState` — só strings atravessam a fronteira.
 * Antes, abrir um colaborador fora do escopo derrubava a página com
 * "Only plain objects can be passed to Client Components". A saída e o motivo do 403 dependem de
 * quem vê (`employee-profile-exit.ts`): a página calcula e passa prontos.
 */
export function EmployeeProfileUnavailable({ status, back, forbiddenDescription }: { status: keyof typeof COPY; back: ProfileBackLink; forbiddenDescription: string }) {
  const copy = COPY[status]
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12">
      <AnalyticsEmptyState
        icon={Lock}
        title={copy.title}
        description={copy.description ?? forbiddenDescription}
        action={
          <Button variant="outline" asChild>
            <Link href={back.href}>{back.label}</Link>
          </Button>
        }
      />
    </main>
  )
}
