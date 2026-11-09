"use client"

import { useState } from "react"
import { Boxes, ChevronRight, MoreHorizontal, Package, Pencil, Plus } from "lucide-react"

import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { useDeleteProductNodeMutation, useIdentificationCriteriaQuery, useProductNodesQuery, useProductScopeSourcesQuery, useSetProductNodeActiveMutation } from "@/queries/admin/use-product-catalog-queries"
import type { IdentificationCriterionSummary, ProductNode, ProductScopeSource } from "@/schemas/admin/product-catalog.schema"

import { ancestorsOf, basesOf, cluesOf } from "./catalog-relations"
import { NodeForm } from "./node-form"
import { treeOrder } from "./node-picker"
import { ProductBases } from "./product-bases"
import { ProductClues } from "./product-clues"
import { RESTORE_NOTE } from "@/lib/admin/logical-delete"

function DeleteNodeDialog({ node, open, onOpenChange, onDeleted }: { node: ProductNode; open: boolean; onOpenChange: (open: boolean) => void; onDeleted: () => void }) {
  const deleteMutation = useDeleteProductNodeMutation()
  const blocked = node.blocksDeletion
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir {node.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {blocked ? "Este item tem produtos dentro dele ou é usado agora por bases ou indícios. Tire-o de lá antes de excluir, ou desative — as análises já feitas continuam com ele." : node.kind === "FAMILY" ? `Nenhuma base ou indício usa esta categoria agora. ${RESTORE_NOTE}` : `Nenhuma base ou indício usa este produto agora. ${RESTORE_NOTE}`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={blocked || deleteMutation.isPending}
            onClick={async () => {
              try {
                await deleteMutation.mutateAsync(node.id)
                onOpenChange(false)
                onDeleted()
              } catch {
                // aviso do backend (409) já mostrado
              }
            }}
          >
            Excluir
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Detalhe de um produto (ou categoria): cabeçalho, bases que valem para ele e como reconhecê-lo na chamada. Ativar e excluir no "⋯". */
function ProductDetail({ node, nodes, criteria, sources, onSelect, onNewProduct }: { node: ProductNode; nodes: readonly ProductNode[]; criteria: readonly IdentificationCriterionSummary[]; sources: readonly ProductScopeSource[]; onSelect: (id: string | null) => void; onNewProduct: (parentId: string) => void }) {
  const activeMutation = useSetProductNodeActiveMutation()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const path = ancestorsOf(nodes, node.id).reverse()
  const children = nodes.filter((entry) => entry.parentId === node.id)
  const category = node.kind === "FAMILY"
  return (
    <div className="space-y-6" data-testid={`product-detail-${node.code}`}>
      {editing ? (
        <NodeForm key={node.id} node={node} kind={node.kind} nodes={nodes} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            {path.length > 0 ? <p className="text-xs text-muted-foreground">{path.map((ancestor) => ancestor.name).join(" › ")}</p> : null}
            <h2 className={cn("flex flex-wrap items-center gap-2 text-lg font-semibold", !node.active && "text-muted-foreground")}>
              {node.name}
              {category ? <Badge variant="outline">Categoria</Badge> : null}
              {node.active ? null : <Badge variant="outline">Inativo</Badge>}
            </h2>
            {node.description ? (
              <p className="max-w-2xl text-sm text-muted-foreground">
                <span className="font-medium text-foreground/80">Como chamam:</span> {node.description}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Editar
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" aria-label={`Mais ações de ${node.name}`}>
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={activeMutation.isPending} onSelect={() => activeMutation.mutate({ id: node.id, active: !node.active })}>
                  {node.active ? "Desativar" : "Ativar"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onSelect={() => setDeleting(true)}>
                  Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DeleteNodeDialog node={node} open={deleting} onOpenChange={setDeleting} onDeleted={() => onSelect(null)} />
          </div>
        </div>
      )}
      {category ? (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Produtos desta categoria</p>
          <div className="flex flex-wrap gap-1.5">
            {children.map((child) => (
              <Button key={child.id} size="sm" variant="outline" onClick={() => onSelect(child.id)}>
                {child.name}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => onNewProduct(node.id)}>
              <Plus /> Novo produto nesta categoria
            </Button>
          </div>
        </div>
      ) : null}
      <Separator />
      <ProductBases node={node} nodes={nodes} sources={sources} />
      <Separator />
      <ProductClues node={node} nodes={nodes} criteria={criteria} sources={sources} />
    </div>
  )
}

const countLabel = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/**
 * Lista em árvore: categoria com seta para recolher os produtos de dentro (aberta por padrão); produtos em tamanho menor. Na busca, a
 * árvore inteira abre e cada achado aparece com a categoria acima dele.
 */
function ProductTree({ nodes, criteria, sources, term, selectedId, onSelect }: { nodes: readonly ProductNode[]; criteria: readonly IdentificationCriterionSummary[]; sources: readonly ProductScopeSource[]; term: string; selectedId: string | null; onSelect: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const matches = (node: ProductNode) => node.name.toLocaleLowerCase("pt-BR").includes(term)
  const shownBySearch = new Set(nodes.filter(matches).flatMap((node) => [node.id, ...ancestorsOf(nodes, node.id).map((ancestor) => ancestor.id)]))
  const rows = treeOrder(nodes).filter(({ node }) => (term ? shownBySearch.has(node.id) : !ancestorsOf(nodes, node.id).some((ancestor) => collapsed.has(ancestor.id))))
  const toggle = (id: string) => setCollapsed((current) => (current.has(id) ? new Set([...current].filter((entry) => entry !== id)) : new Set([...current, id])))
  return (
    <ul className="max-h-[32rem] space-y-0.5 overflow-y-auto" aria-label="Produtos">
      {rows.map(({ node, depth }) => {
        const category = node.kind === "FAMILY"
        const open = Boolean(term) || !collapsed.has(node.id)
        const products = nodes.filter((entry) => entry.parentId === node.id).length
        const baseCount = basesOf(nodes, sources, node.id).length
        const clueCount = cluesOf(nodes, criteria, node.id).length
        const meta = category ? [countLabel(products, "produto", "produtos"), ...(clueCount > 0 ? [countLabel(clueCount, "indício", "indícios")] : [])] : [countLabel(baseCount, "base", "bases"), countLabel(clueCount, "indício", "indícios")]
        const Icon = category ? Boxes : Package
        return (
          <li key={node.id} className={cn("flex items-start gap-0.5", depth === 1 && "pl-5", depth > 1 && "pl-10")}>
            {category ? (
              <button type="button" onClick={() => toggle(node.id)} disabled={Boolean(term) || products === 0} aria-expanded={open} aria-label={open ? `Recolher ${node.name}` : `Mostrar os produtos de ${node.name}`} className="mt-1.5 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40">
                <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
              </button>
            ) : (
              <span className="size-5 shrink-0" aria-hidden />
            )}
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              aria-current={selectedId === node.id ? "true" : undefined}
              className={cn("flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 text-left transition-colors hover:bg-muted", category ? "py-1.5" : "py-1", selectedId === node.id && "bg-muted")}
              data-testid={`product-node-${node.code}`}
            >
              <Icon className={cn("shrink-0 text-muted-foreground", category ? "mt-0.5 size-4" : "mt-0.5 size-3.5")} />
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate", category ? "text-sm font-medium" : "text-[13px]", !node.active && "text-muted-foreground line-through")}>{node.name}</span>
                <span className={cn("block text-muted-foreground", category ? "text-xs" : "text-[11px]")}>{meta.join(" · ")}</span>
              </span>
            </button>
          </li>
        )
      })}
      {rows.length === 0 ? <li className="px-2 py-1.5 text-sm text-muted-foreground">Nada encontrado.</li> : null}
    </ul>
  )
}

/**
 * Produtos: lista à esquerda (categorias e produtos, com quantas bases e indícios cada um tem) e, à direita, tudo sobre o escolhido —
 * as bases que valem para ele e como reconhecê-lo numa chamada.
 */
export function ProductDirectory() {
  const nodesQuery = useProductNodesQuery()
  const criteriaQuery = useIdentificationCriteriaQuery()
  const sourcesQuery = useProductScopeSourcesQuery()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Criar produto (com a categoria já escolhida, quando veio do detalhe dela). Categoria nasce no próprio formulário do produto.
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null)
  const [search, setSearch] = useState("")
  if (nodesQuery.isPending || criteriaQuery.isPending || sourcesQuery.isPending) return <Skeleton className="h-64 w-full" />
  if (nodesQuery.isError || criteriaQuery.isError || sourcesQuery.isError) return <p className="text-sm text-destructive">Não foi possível carregar os produtos.</p>
  const nodes = nodesQuery.data
  const criteria = criteriaQuery.data
  const sources = sourcesQuery.data
  const term = search.trim().toLocaleLowerCase("pt-BR")
  const selected = nodes.find((node) => node.id === selectedId) ?? (creating ? null : (treeOrder(nodes)[0]?.node ?? null))

  const newButton = (
    <Button size="sm" onClick={() => setCreating({ parentId: null })}>
      <Plus /> Novo produto
    </Button>
  )

  if (nodes.length === 0 && !creating) {
    return (
      <div className="space-y-3 rounded-md border border-dashed p-6 text-center">
        <p className="text-sm font-medium">Nenhum produto cadastrado</p>
        <p className="mx-auto max-w-xl text-sm text-muted-foreground">Enquanto não houver produtos, a INIA analisa as chamadas como antes, sem olhar o produto. Cadastre os produtos quando o mesmo assunto tiver orientações diferentes por produto.</p>
        <div className="flex justify-center">{newButton}</div>
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="space-y-3">
        {newButton}
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar produto" aria-label="Buscar produto" />
        <ProductTree
          nodes={nodes}
          criteria={criteria}
          sources={sources}
          term={term}
          selectedId={selected?.id ?? null}
          onSelect={(id) => {
            setCreating(null)
            setSelectedId(id)
          }}
        />
      </aside>
      <div className="min-w-0">
        {creating ? (
          <NodeForm
            key={creating.parentId ?? "root"}
            kind="PRODUCT"
            nodes={nodes}
            defaultParentId={creating.parentId}
            onDone={(saved) => {
              setCreating(null)
              if (saved) setSelectedId(saved.id)
            }}
          />
        ) : selected ? (
          <ProductDetail key={selected.id} node={selected} nodes={nodes} criteria={criteria} sources={sources} onSelect={setSelectedId} onNewProduct={(parentId) => setCreating({ parentId })} />
        ) : null}
      </div>
    </div>
  )
}
