"use client"

import type { ReactNode } from "react"
import { CalendarClock, Megaphone } from "lucide-react"

import { PageHeader } from "@/components/ui/surface"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCurrentUserQuery } from "@/queries/auth/use-current-user"

export type PublicationsTab = "comunicados" | "alinhamentos"

/** Quem pode o quê na área editorial: comunicados (papel de comunicados) e alinhamentos (Gestor de alinhamentos ou administração). */
export function usePublicationsAccess() {
  const me = useCurrentUserQuery()
  const capabilities = me.data?.access.capabilities
  return {
    isLoading: me.isLoading,
    canPublish: Boolean(capabilities?.canPublishTeamCommunications || capabilities?.canPublishOrganizationCommunications),
    // Mesma permissão da tela de alinhamentos, nunca a de configuração.
    canManageAlignments: capabilities?.canManageOperationalAlignments ?? false,
  }
}

/**
 * Moldura única da área editorial: cabeçalho "Publicações" e as abas Comunicados × Alinhamentos operacionais (só para quem tem os
 * dois). A lista de comunicados e a de alinhamentos ficam debaixo dela; o formulário de alinhamento aberto a esconde, como o editor de
 * comunicado (outra página, sem ela) — `hideHeader`; o filho continua no mesmo lugar e não remonta.
 */
export function PublicationsFrame({ tab, onTabChange, actions, hideHeader = false, children }: { tab: PublicationsTab; onTabChange: (tab: PublicationsTab) => void; actions?: ReactNode; hideHeader?: boolean; children: ReactNode }) {
  const { canPublish, canManageAlignments } = usePublicationsAccess()
  return (
    <div className="space-y-5">
      {hideHeader ? null : <PageHeader icon={Megaphone} title="Publicações" description="Comunicados (avisos e novidades, só informação) e alinhamentos operacionais (orientações temporárias de processo, com vigência e público). A INIA usa os dois no chat para quem os recebe." actions={actions} />}
      {canPublish && canManageAlignments && !hideHeader ? (
        <Tabs value={tab} onValueChange={(value) => onTabChange(value as PublicationsTab)}>
          <TabsList>
            <TabsTrigger value="comunicados"><Megaphone />Comunicados</TabsTrigger>
            <TabsTrigger value="alinhamentos"><CalendarClock />Alinhamentos operacionais</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}
      {children}
    </div>
  )
}
