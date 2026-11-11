"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Database, DatabaseZap, FileUp, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/surface"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCurrentUserQuery } from "@/queries/auth/use-current-user"

import { AuditLogTab } from "./audit-log-tab"
import { ContractsTab } from "./contracts-tab"
import { DataExplorerTab } from "./explorer/data-explorer-tab"
import { FeedsTab } from "./feeds-tab"
import { OverviewTab } from "./overview-tab"
import { QualityTab } from "./quality-tab"
import { RunsTab } from "./runs-tab"
import { SourcesTab } from "./sources-tab"

const TABS = [
  { value: "overview", label: "Visão geral" },
  { value: "sources", label: "Fontes" },
  { value: "feeds", label: "Feeds e mapeamentos" },
  { value: "runs", label: "Cargas" },
  { value: "quality", label: "Qualidade dos dados" },
  { value: "contracts", label: "Contratos de dados" },
  { value: "explore", label: "Consultar dados" },
  { value: "audit", label: "Registro" },
] as const
type TabValue = (typeof TABS)[number]["value"]

/**
 * Central de Dados — porta única de entrada dos dados do cliente. Responde primeiro "está tudo
 * funcionando? quando atualizou? algo com erro ou atrasado? quanto chegou/foi rejeitado hoje?"
 * e só depois entra em configuração. Operacional, não um BI.
 */
export function DataHubPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const requested = searchParams.get("tab")
  // A aba só aparece para quem tem a permissão. Sem ela, o link cai na Visão geral; quem decide de verdade é a rota do servidor.
  const canExploreData = useCurrentUserQuery().data?.access.capabilities.canExploreData === true
  const tabs = TABS.filter((entry) => entry.value !== "explore" || canExploreData)
  const tab: TabValue = tabs.some((entry) => entry.value === requested) ? (requested as TabValue) : "overview"

  function setTab(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === "overview") params.delete("tab")
    else params.set("tab", next)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Database}
        title="Central de Dados"
        description="Como os dados do cliente entram na INIA: fontes, feeds, contratos, mapeamentos, cargas, qualidade e linhagem — num só lugar."
        actions={
          <>
          <Button asChild variant="outline">
            <Link href="/admin/data-hub/import">
              <FileUp /> Importar arquivo
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/data-hub/sources/new">
              <Plus /> Nova fonte
            </Link>
          </Button>
          <Button asChild>
            <Link href="/admin/data-hub/sources/new?kind=DATABASE" data-testid="connect-database">
              <DatabaseZap /> Conectar banco de dados
            </Link>
          </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto">
          <TabsList>
            {tabs.map((entry) => (
              <TabsTrigger key={entry.value} value={entry.value} className="whitespace-nowrap">
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview" className="mt-4">
          <OverviewTab onOpenTab={setTab} />
        </TabsContent>
        <TabsContent value="sources" className="mt-4">
          <SourcesTab />
        </TabsContent>
        <TabsContent value="feeds" className="mt-4">
          <FeedsTab />
        </TabsContent>
        <TabsContent value="runs" className="mt-4">
          <RunsTab />
        </TabsContent>
        <TabsContent value="quality" className="mt-4">
          <QualityTab />
        </TabsContent>
        <TabsContent value="contracts" className="mt-4">
          <ContractsTab />
        </TabsContent>
        {canExploreData ? (
          <TabsContent value="explore" className="mt-4">
            <DataExplorerTab />
          </TabsContent>
        ) : null}
        <TabsContent value="audit" className="mt-4">
          <AuditLogTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
