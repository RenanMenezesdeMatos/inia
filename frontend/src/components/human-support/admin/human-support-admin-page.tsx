"use client"

import { useState } from "react"
import { HeartHandshake, Network, SlidersHorizontal } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { PageHeader } from "@/components/ui/surface"
import { AnjosTab } from "./anjos-tab"
import type { ScopeFilterValue } from "./scope-filter"
import { ScopesTab } from "./scopes-tab"
import { SettingsTab } from "./settings-tab"

type AdminTab = "settings" | "scopes" | "anjos"

/**
 * Administração › Plataforma › Apoio com Anjo (só o Administrador geral; o backend exige `human_support.manage` na organização).
 * Configuração (chave geral e capacidade padrão) · Escopos (Grupo › Subgrupos) · Anjos (quem atende, capacidade e situação agora).
 * Tudo nasce desligado; conceder os papéis usa o editor de papéis que já existe.
 */
export function HumanSupportAdminPage({ canGrantRoles }: { canGrantRoles: boolean }) {
  const [tab, setTab] = useState<AdminTab>("settings")
  const [anjoFilter, setAnjoFilter] = useState<ScopeFilterValue>({})

  return (
    <section className="space-y-6">
      <PageHeader icon={HeartHandshake} title="Apoio com Anjo" description="Quando a INIA não resolve, o operador pode pedir ajuda a uma pessoa da equipe de apoio. Aqui você liga o apoio, escolhe onde ele vale e acompanha quem atende." />
      <Tabs value={tab} onValueChange={(value) => setTab(value as AdminTab)} className="space-y-5">
        <TabsList>
          <TabsTrigger value="settings" className="gap-1"><SlidersHorizontal className="size-4" aria-hidden />Configuração</TabsTrigger>
          <TabsTrigger value="scopes" className="gap-1"><Network className="size-4" aria-hidden />Escopos</TabsTrigger>
          <TabsTrigger value="anjos" className="gap-1"><HeartHandshake className="size-4" aria-hidden />Anjos</TabsTrigger>
        </TabsList>
        <TabsContent value="settings"><SettingsTab /></TabsContent>
        <TabsContent value="scopes">
          <ScopesTab
            onShowAnjos={(filter) => {
              setAnjoFilter(filter)
              setTab("anjos")
            }}
          />
        </TabsContent>
        <TabsContent value="anjos"><AnjosTab filter={anjoFilter} onFilterChange={setAnjoFilter} canGrantRoles={canGrantRoles} /></TabsContent>
      </Tabs>
    </section>
  )
}
