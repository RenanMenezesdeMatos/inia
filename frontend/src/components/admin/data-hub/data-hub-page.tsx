"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Database, DatabaseZap, FileUp, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { ContractsTab } from "./contracts-tab"
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
  const tab: TabValue = TABS.some((entry) => entry.value === requested) ? (requested as TabValue) : "overview"

  function setTab(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === "overview") params.delete("tab")
    else params.set("tab", next)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Database className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Central de Dados</h1>
            <p className="text-sm text-muted-foreground">Como os dados do cliente entram na INIA: fontes, feeds, contratos, mapeamentos, cargas, qualidade e linhagem — num só lugar.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
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
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto">
          <TabsList>
            {TABS.map((entry) => (
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
      </Tabs>
    </div>
  )
}
