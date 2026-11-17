"use client"

import { useState } from "react"
import { ArrowRight, Building2, CheckCircle2, CircleSlash, Network, Power } from "lucide-react"

import { AnalyticsEmptyState, AnalyticsErrorState } from "@/components/analytics/analytics-states"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { IconBadge, SectionLabel, SURFACE_CARD, toneSurface } from "@/components/ui/surface"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useSupportScopesQuery, useSupportSettingsQuery } from "@/queries/human-support/use-human-support-admin"
import type { ScopeNode } from "@/schemas/human-support/admin.schema"

import { ScopeDetail } from "./scope-detail"
import type { ScopeFilterValue } from "./scope-filter"
import { findNode, originText } from "./scope-rules"

const ORGANIZATION = "__organization__"

type Props = { onShowAnjos: (filter: ScopeFilterValue) => void; onOpenSettings: () => void; canGrantRoles: boolean }

/**
 * Escopos do Anjo: à esquerda, a hierarquia Organização › Grupo › Subgrupo com o estado EM VIGOR de cada um e de onde ele vem; à
 * direita, o escopo escolhido (o que é, o que vale agora, o que dá para mudar). Regra em `scope-rules.ts` (espelho do servidor).
 * Só o Administrador geral chega aqui: a página e cada rota exigem `human_support.manage` na organização.
 */
export function ScopesTab({ onShowAnjos, onOpenSettings, canGrantRoles }: Props) {
  const query = useSupportScopesQuery()
  const settings = useSupportSettingsQuery()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (query.isPending || settings.isPending) return <Skeleton className="h-60 w-full rounded-xl" aria-label="Carregando os escopos" />
  if (query.isError) return <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (settings.isError) return <AnalyticsErrorState error={settings.error} onRetry={() => void settings.refetch()} />
  if (query.data.length === 0) return <AnalyticsEmptyState icon={Network} title="Nenhum Grupo cadastrado" description="Os Grupos e Subgrupos vêm da estrutura da organização." />

  const tree = query.data
  const masterOn = settings.data.enabled
  const selectedKey = selectedId ?? tree[0]!.id
  const selected = selectedKey === ORGANIZATION ? null : (findNode(tree, selectedKey) ?? findNode(tree, tree[0]!.id))

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {!masterOn ? (
          <div role="alert" className={cn(toneSurface("warning"), "flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm")}>
            <p>A chave geral do Apoio com Anjo está desligada: o Anjo está desabilitado em todos os escopos. As opções salvas abaixo passam a valer quando ela for ligada.</p>
            <Button type="button" size="sm" variant="outline" onClick={onOpenSettings}>
              Ligar na aba Configuração
              <ArrowRight data-icon="inline-end" aria-hidden />
            </Button>
          </div>
        ) : null}

        {/* Tela estreita: um seletor no lugar da lista longa, para o detalhe ficar logo abaixo. */}
        <div className="space-y-1.5 lg:hidden">
          <SectionLabel as="p">Escolha o escopo</SectionLabel>
          <Select value={selected ? selected.node.id : ORGANIZATION} onValueChange={setSelectedId}>
            <SelectTrigger className="w-full" aria-label="Escopo em edição">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ORGANIZATION}>Organização · {masterOn ? "chave geral ligada" : "chave geral desligada"}</SelectItem>
              {tree.map((group) => (
                <SelectGroup key={group.id}>
                  <SelectLabel>{group.name}</SelectLabel>
                  <SelectItem value={group.id}>{group.name} (Grupo) · {group.effective ? "habilitado" : "desabilitado"}</SelectItem>
                  {(group.children ?? []).map((child) => (
                    <SelectItem key={child.id} value={child.id}>
                      {group.name} › {child.name} · {child.effective ? "habilitado" : "desabilitado"}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <nav aria-label="Escopos do Anjo" className={cn(SURFACE_CARD, "hidden overflow-hidden lg:sticky lg:top-4 lg:block")}>
            <SectionLabel as="p" className="px-4 pt-4 pb-2">Escolha o escopo</SectionLabel>
            <ul className="pb-2 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto">
              <ScopeItem id={ORGANIZATION} name="Organização" detail={masterOn ? "Chave geral ligada" : "Chave geral desligada"} on={masterOn} selected={selectedKey === ORGANIZATION} onSelect={setSelectedId} level={0} />
              {tree.map((group) => (
                <li key={group.id}>
                  <ul>
                    <ScopeItem id={group.id} name={group.name} detail={originText(group, null).short} on={group.effective} selected={selected?.node.id === group.id} onSelect={setSelectedId} level={1} />
                    {(group.children ?? []).map((child) => (
                      <ScopeItem key={child.id} id={child.id} name={child.name} detail={originText(child, group).short} on={child.effective} selected={selected?.node.id === child.id} onSelect={setSelectedId} level={2} />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </nav>

          {selected ? (
            <ScopeDetail
              key={selected.node.id}
              node={selected.node}
              parent={selected.parent}
              masterOn={masterOn}
              canGrantRoles={canGrantRoles}
              onOpenSettings={onOpenSettings}
              onShowAnjos={() => onShowAnjos(selected.parent ? { teamId: selected.parent.id, subteamId: selected.node.id } : { teamId: selected.node.id })}
            />
          ) : (
            <OrganizationDetail tree={tree} masterOn={masterOn} onOpenSettings={onOpenSettings} />
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}

function ScopeItem({ id, name, detail, on, selected, onSelect, level }: { id: string; name: string; detail: string; on: boolean; selected: boolean; onSelect: (id: string) => void; level: 0 | 1 | 2 }) {
  return (
    <li>
      <button
        type="button"
        data-testid={`scope-${id}`}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(id)}
        className={cn(
          "flex w-full items-start gap-2.5 border-l-2 border-transparent py-2 pr-4 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/60",
          level === 0 ? "pl-4" : level === 1 ? "pl-4" : "pl-9",
          selected && "border-primary bg-primary/5 hover:bg-primary/5",
        )}
      >
        <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", on ? "bg-emerald-500" : "bg-muted-foreground/40")} />
        <span className="min-w-0">
          <span className={cn("block truncate text-sm", level < 2 ? "font-medium" : "")}>
            {name}
            {level === 1 ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">Grupo</span> : null}
          </span>
          <span className="block text-xs text-muted-foreground">
            {level === 0 ? detail : `${on ? "Habilitado" : "Desabilitado"} · ${detail}`}
          </span>
        </span>
      </button>
    </li>
  )
}

/** A organização: só a chave geral (editada na aba Configuração) e o resumo de onde o Anjo está habilitado. */
function OrganizationDetail({ tree, masterOn, onOpenSettings }: { tree: readonly ScopeNode[]; masterOn: boolean; onOpenSettings: () => void }) {
  const subgroups = tree.flatMap((group) => group.children ?? [])
  const groupsOn = tree.filter((group) => group.effective).length
  const subgroupsOn = subgroups.filter((child) => child.effective).length
  return (
    <section aria-labelledby="scope-organization" className="space-y-4">
      <div className={cn(SURFACE_CARD, "px-4 py-4 sm:px-5")}>
        <SectionLabel as="p">Escopo em edição</SectionLabel>
        <h3 id="scope-organization" className="mt-1 flex items-center gap-2 text-lg font-semibold"><Building2 className="size-5 text-muted-foreground" aria-hidden />Organização</h3>
        <p className="mt-1 text-sm text-muted-foreground">O nível mais alto: vale para todos os Grupos e Subgrupos.</p>
      </div>
      <div className={cn(toneSurface(masterOn ? "success" : "neutral"), "space-y-3 px-4 py-4 sm:px-5")}>
        <SectionLabel as="p">Em vigor agora</SectionLabel>
        <div className="flex items-start gap-3">
          <IconBadge icon={masterOn ? CheckCircle2 : CircleSlash} tone={masterOn ? "success" : "neutral"} size="lg" />
          <div className="space-y-1">
            <p className="text-lg font-semibold" role="status">{masterOn ? "Chave geral ligada" : "Chave geral desligada"}</p>
            <p className="text-sm">
              {masterOn
                ? "A organização libera o Anjo, mas não o habilita sozinha: cada Grupo ou Subgrupo precisa de “Habilitar neste escopo”, próprio ou herdado do Grupo."
                : "A organização bloqueia o Anjo em todos os Grupos e Subgrupos, seja qual for a opção salva em cada um."}
            </p>
            <p className="text-sm text-muted-foreground">
              Habilitado agora em {groupsOn} de {tree.length} {tree.length === 1 ? "Grupo" : "Grupos"} e {subgroupsOn} de {subgroups.length} {subgroups.length === 1 ? "Subgrupo" : "Subgrupos"}.
            </p>
          </div>
        </div>
      </div>
      <div className={cn(SURFACE_CARD, "space-y-3 px-4 py-4 sm:px-5")}>
        <SectionLabel as="p">O que você pode alterar</SectionLabel>
        <p className="text-sm text-muted-foreground">A chave geral fica na aba Configuração, junto com a capacidade padrão dos Anjos. Para habilitar um Grupo ou Subgrupo, escolha-o na lista.</p>
        <Button type="button" variant="outline" onClick={onOpenSettings}>
          <Power data-icon="inline-start" aria-hidden />
          Alterar a chave geral na aba Configuração
        </Button>
      </div>
    </section>
  )
}
