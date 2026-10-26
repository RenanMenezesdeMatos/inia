"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { ProductNode } from "@/schemas/admin/product-catalog.schema"

/** Itens em ordem de árvore (categoria, depois o que está dentro dela), com a profundidade para recuo. */
export function treeOrder(nodes: readonly ProductNode[]): { node: ProductNode; depth: number }[] {
  const children = (parentId: string | null) => nodes.filter((node) => node.parentId === parentId).sort((a, b) => Number(b.kind === "FAMILY") - Number(a.kind === "FAMILY") || a.name.localeCompare(b.name, "pt-BR"))
  const out: { node: ProductNode; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (parentId: string | null, depth: number) => {
    for (const node of children(parentId)) {
      if (seen.has(node.id)) continue
      seen.add(node.id)
      out.push({ node, depth })
      walk(node.id, depth + 1)
    }
  }
  walk(null, 0)
  // Item cuja categoria não está na lista (desativada e filtrada) entra no fim, sem recuo.
  for (const node of nodes) if (!seen.has(node.id)) out.push({ node, depth: 0 })
  return out
}

export function nodeLabel(nodes: readonly ProductNode[], id: string): string {
  const node = nodes.find((entry) => entry.id === id)
  return node ? `${node.name}${node.kind === "FAMILY" ? " (categoria)" : ""}` : "Item removido"
}

/**
 * Escolha de produtos e categorias (lista em árvore com caixas de seleção). Item inativo só aparece se já estava escolhido — marcado,
 * para nunca sumir de uma configuração existente.
 */
export function NodePicker({ nodes, value, onChange, idPrefix, disabled }: { nodes: readonly ProductNode[]; value: readonly string[]; onChange: (ids: string[]) => void; idPrefix: string; disabled?: boolean }) {
  const visible = treeOrder(nodes.filter((node) => node.active || value.includes(node.id)))
  if (visible.length === 0) return <p className="text-sm text-muted-foreground">Cadastre os produtos em Agentes › Produtos.</p>
  return (
    <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2" aria-label="Produtos e categorias">
      {visible.map(({ node, depth }) => {
        const id = `${idPrefix}-${node.id}`
        const checked = value.includes(node.id)
        return (
          <li key={node.id} className={cn("flex items-center gap-2", depth > 0 && "pl-5", depth > 1 && "pl-10")}>
            <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(next) => onChange(next ? [...value, node.id] : value.filter((entry) => entry !== node.id))} />
            <Label htmlFor={id} className={cn("text-sm font-normal", node.kind === "FAMILY" && "font-medium", !node.active && "text-muted-foreground line-through")}>
              {node.name}
              {node.kind === "FAMILY" ? <span className="ml-1 text-xs text-muted-foreground">categoria</span> : null}
            </Label>
          </li>
        )
      })}
    </ul>
  )
}
