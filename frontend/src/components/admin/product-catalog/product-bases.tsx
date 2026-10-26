"use client"

import { useState } from "react"
import { BookOpen, PhoneCall, Plus, X } from "lucide-react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSetProductScopeMutation } from "@/queries/admin/use-product-catalog-queries"
import { SOURCE_KIND_LABEL, type ProductNode, type ProductScopeSource } from "@/schemas/admin/product-catalog.schema"

import { basesOf, scopeKindOf } from "./catalog-relations"
import { nodeLabel } from "./node-picker"

export const sourceKey = (source: Pick<ProductScopeSource, "sourceKind" | "sourceId">) => `${source.sourceKind}:${source.sourceId}`

export function SourceIcon({ source }: { source: Pick<ProductScopeSource, "sourceKind"> }) {
  const Icon = source.sourceKind === "KNOWLEDGE_DOCUMENT" ? BookOpen : PhoneCall
  return <Icon className="size-4 shrink-0 text-muted-foreground" />
}

/** Como a base vale hoje, em uma frase. */
export function scopeSummaryOf(source: ProductScopeSource, nodes: readonly ProductNode[]): string {
  const kind = scopeKindOf(source)
  if (kind === "GENERAL") return "Geral — vale para todos os produtos"
  const names = (source.scope?.nodeIds ?? []).map((id) => nodeLabel(nodes, id)).join(", ")
  return kind === "SPECIFIC" ? `Só para ${names}` : `Para ${names}`
}

/** Escolher uma base para acrescentar a este produto (inline): busca, e cada base diz como vale hoje. */
function AddBasePanel({ node, nodes, sources, onDone }: { node: ProductNode; nodes: readonly ProductNode[]; sources: readonly ProductScopeSource[]; onDone: () => void }) {
  const mutation = useSetProductScopeMutation()
  const [search, setSearch] = useState("")
  const term = search.trim().toLocaleLowerCase("pt-BR")
  // Fora da lista: as que já valem para o item (marcadas para ele ou para a categoria dele).
  const applying = new Set(basesOf(nodes, sources, node.id).map(({ source }) => sourceKey(source)))
  const candidates = sources.filter((source) => !applying.has(sourceKey(source))).filter((source) => !term || source.title.toLocaleLowerCase("pt-BR").includes(term))
  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3" data-testid="add-base-panel">
      <div className="flex items-center gap-2">
        <Input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar base de conhecimento ou argumentário" aria-label="Buscar base" />
        <Button variant="ghost" onClick={onDone}>
          Fechar
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Ao adicionar, a base passa a valer {node.kind === "FAMILY" ? "para os produtos desta categoria" : "para este produto"}. Uma base que hoje é geral deixa de valer para todos e fica só com os produtos marcados. Vale a partir de agora: chamadas anteriores continuam com o que valia na época.</p>
      <ul className="max-h-72 divide-y overflow-y-auto rounded-md border bg-background">
        {candidates.length === 0 ? <li className="p-3 text-sm text-muted-foreground">Nenhuma base encontrada.</li> : null}
        {candidates.map((source) => (
          <li key={sourceKey(source)} className="flex items-center gap-3 p-2.5">
            <SourceIcon source={source} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{source.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {SOURCE_KIND_LABEL[source.sourceKind]} · hoje: {scopeSummaryOf(source, nodes)}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending}
              aria-label={`Adicionar ${source.title}`}
              onClick={() => mutation.mutate({ kind: source.sourceKind, id: source.sourceId, nodeIds: [...(source.scope?.nodeIds ?? []), node.id] })}
            >
              Adicionar
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * "Bases de conhecimento" de um produto: as que valem para ele — marcadas para ele ou para a categoria dele. Uma base pode ser só deste
 * produto ou também de outros; as gerais (sem produto marcado) valem para todos e só aparecem contadas.
 */
export function ProductBases({ node, nodes, sources }: { node: ProductNode; nodes: readonly ProductNode[]; sources: readonly ProductScopeSource[] }) {
  const mutation = useSetProductScopeMutation()
  const [adding, setAdding] = useState(false)
  const [confirmGeneral, setConfirmGeneral] = useState<ProductScopeSource | null>(null)
  const bases = basesOf(nodes, sources, node.id)
  const generalCount = sources.filter((source) => scopeKindOf(source) === "GENERAL").length
  const remove = (source: ProductScopeSource) => mutation.mutate({ kind: source.sourceKind, id: source.sourceId, nodeIds: (source.scope?.nodeIds ?? []).filter((id) => id !== node.id) })
  return (
    <section className="space-y-3" aria-label="Bases de conhecimento" data-testid="product-bases">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Bases de conhecimento</h3>
          <p className="max-w-2xl text-xs text-muted-foreground">As orientações que valem {node.kind === "FAMILY" ? "para os produtos desta categoria" : "para este produto"}. A INIA só cobra uma regra destas bases quando a chamada mostra que o pedido é {node.kind === "FAMILY" ? "de um produto desta categoria" : "deste produto"}.</p>
        </div>
        {adding ? null : (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus /> Adicionar base
          </Button>
        )}
      </div>
      {adding ? <AddBasePanel node={node} nodes={nodes} sources={sources} onDone={() => setAdding(false)} /> : null}
      {bases.length === 0 ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nenhuma base específica. {node.kind === "FAMILY" ? "Os produtos desta categoria" : "Este produto"} segue só as bases gerais.</p> : null}
      <ul className="space-y-2">
        {bases.map(({ source, via, others }) => (
          <li key={sourceKey(source)} className="flex flex-wrap items-center gap-3 rounded-md border p-3" data-testid={`product-base-${source.sourceId}`}>
            <SourceIcon source={source} />
            <div className="min-w-0 flex-1">
              <p className="text-sm">{source.title}</p>
              <p className="text-xs text-muted-foreground">
                {SOURCE_KIND_LABEL[source.sourceKind]}
                {source.status === "ARCHIVED" ? " · inativa" : ""}
                {via ? ` · vale para a categoria ${via.name}` : ""}
              </p>
              {others.length > 0 ? <p className="text-xs text-muted-foreground">Também vale para: {others.map((id) => nodeLabel(nodes, id)).join(", ")}</p> : null}
            </div>
            {via ? <Badge variant="outline">Pela categoria</Badge> : others.length === 0 ? <Badge variant="secondary">{node.kind === "FAMILY" ? "Só desta categoria" : "Só deste produto"}</Badge> : <Badge variant="outline">Compartilhada</Badge>}
            {via ? null : (
              <Button size="icon" variant="ghost" aria-label={`Tirar ${source.title} deste item`} disabled={mutation.isPending} onClick={() => (others.length === 0 ? setConfirmGeneral(source) : remove(source))}>
                <X className="size-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {generalCount > 0 ? `Além destas, ${generalCount === 1 ? "1 base geral vale" : `${generalCount} bases gerais valem`} para todos os produtos. ` : ""}
        Também dá para escolher no editor de cada base e de cada argumentário, em “Vale para”.
      </p>
      <AlertDialog open={confirmGeneral !== null} onOpenChange={(open) => (open ? null : setConfirmGeneral(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tirar a base deste produto?</AlertDialogTitle>
            <AlertDialogDescription>“{confirmGeneral?.title}” não vale para nenhum outro produto. Sem nenhum produto marcado, ela volta a ser geral — vale para todos os produtos a partir de agora.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              onClick={() => {
                if (confirmGeneral) remove(confirmGeneral)
                setConfirmGeneral(null)
              }}
            >
              Tirar e deixar geral
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
