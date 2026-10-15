"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Cpu } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAiCan } from "@/queries/admin/use-ai-management-queries"

import { BudgetsTab } from "./budgets-tab"
import { ConnectionsTab } from "./connections-tab"
import { ModelsTab } from "./models-tab"
import { OverviewTab } from "./overview-tab"
import { RoutingTab } from "./routing-tab"
import { UsageRankingTab } from "./usage-ranking-tab"

export const AI_TABS = [
  { value: "overview", label: "Visão geral" },
  { value: "ranking", label: "Quem mais usa" },
  { value: "connections", label: "Conexões" },
  { value: "models", label: "Modelos" },
  { value: "routing", label: "Roteamento" },
  { value: "budgets", label: "Orçamentos" },
] as const
export type AiTabValue = (typeof AI_TABS)[number]["value"]

/**
 * IA / Modelos — administração de providers, conexões, modelos, roteamento por Use Case, custo e
 * orçamento. Trocar Gemini → GPT → Grok → modelo local é CONFIGURAÇÃO da organização, nunca código.
 * Use Cases sem política ativa continuam na configuração legada do ambiente.
 */
export function AiManagementPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const can = useAiCan()
  // "Quem mais usa" só com a permissão explícita do ranking (decidida no backend a cada request); sem ela a aba nem aparece.
  const tabs = AI_TABS.filter((entry) => entry.value !== "ranking" || can("AI_USAGE_RANKING_READ"))
  const requested = searchParams.get("tab")
  const tab: AiTabValue = tabs.some((entry) => entry.value === requested) ? (requested as AiTabValue) : "overview"

  function setTab(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === "overview") params.delete("tab")
    else params.set("tab", next)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Cpu className="size-5" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">IA / Modelos</h1>
          <p className="text-sm text-muted-foreground">Conexões com providers de IA, modelos disponíveis, qual modelo atende cada uso da INIA, custo e orçamento — sem deploy.</p>
        </div>
      </div>

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
        {tab === "ranking" ? (
          <TabsContent value="ranking" className="mt-4">
            <UsageRankingTab />
          </TabsContent>
        ) : null}
        <TabsContent value="connections" className="mt-4">
          <ConnectionsTab />
        </TabsContent>
        <TabsContent value="models" className="mt-4">
          <ModelsTab />
        </TabsContent>
        <TabsContent value="routing" className="mt-4">
          <RoutingTab />
        </TabsContent>
        <TabsContent value="budgets" className="mt-4">
          <BudgetsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
