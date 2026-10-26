"use client"

import { useState } from "react"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useCreateProductNodeMutation, useUpdateProductNodeMutation } from "@/queries/admin/use-product-catalog-queries"
import type { ProductNode } from "@/schemas/admin/product-catalog.schema"

import { codeFromName } from "./catalog-relations"

const NO_CATEGORY = "__none__"
const NEW_CATEGORY = "__new__"

/**
 * Cadastro enxuto (inline, sem painel lateral): nome, categoria e como o cliente e a operação chamam — é esse texto que a IA usa para
 * reconhecer o produto pelo nome. Categoria é opcional e nasce no próprio seletor ("Nova categoria…"). Sem código na tela: o código técnico
 * é gerado pelo nome ao criar e nunca muda depois. Editar uma categoria: nome e como chamam.
 */
export function NodeForm({ node, kind, nodes, defaultParentId = null, onDone }: { node?: ProductNode; kind: ProductNode["kind"]; nodes: readonly ProductNode[]; defaultParentId?: string | null; onDone: (saved: ProductNode | null) => void }) {
  const createMutation = useCreateProductNodeMutation()
  const updateMutation = useUpdateProductNodeMutation()
  const createCategory = useCreateProductNodeMutation()
  const mutation = node ? updateMutation : createMutation
  const [name, setName] = useState(node?.name ?? "")
  const [description, setDescription] = useState(node?.description ?? "")
  const [parentId, setParentId] = useState<string>(node ? (node.parentId ?? NO_CATEGORY) : (defaultParentId ?? NO_CATEGORY))
  const [newCategory, setNewCategory] = useState<string | null>(null)
  const categories = nodes.filter((entry) => entry.kind === "FAMILY" && entry.active && entry.id !== node?.id)
  const category = kind === "FAMILY"
  const canSubmit = name.trim().length >= 2 && newCategory === null

  async function submit() {
    const payload = { name: name.trim(), description: description.trim() || null, parentId: parentId === NO_CATEGORY ? null : parentId }
    try {
      const saved = node ? await updateMutation.mutateAsync({ id: node.id, code: node.code, ...payload }) : await createMutation.mutateAsync({ kind, code: codeFromName(payload.name, nodes), ...payload })
      onDone(saved)
    } catch {
      // mensagem exibida abaixo (o backend é a autoridade da árvore)
    }
  }

  async function addCategory() {
    const categoryName = (newCategory ?? "").trim()
    if (categoryName.length < 2) return
    try {
      const created = await createCategory.mutateAsync({ kind: "FAMILY", code: codeFromName(categoryName, nodes), name: categoryName, description: null, parentId: null })
      setParentId(created.id)
      setNewCategory(null)
    } catch {
      // aviso do backend já mostrado
    }
  }

  function chooseCategory(value: string) {
    if (value === NEW_CATEGORY) return setNewCategory("")
    setParentId(value)
    setNewCategory(null)
  }

  return (
    <div className="space-y-4 rounded-md border bg-muted/30 p-4" data-testid="product-node-form">
      <p className="text-sm font-medium">{node ? (category ? "Editar categoria" : "Editar produto") : category ? "Nova categoria" : "Novo produto"}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="node-name">Nome *</Label>
          <Input id="node-name" value={name} maxLength={120} placeholder={category ? "Ex.: Fixa Básica" : "Ex.: Banda Larga"} onChange={(event) => setName(event.target.value)} />
        </div>
        {category ? null : (
          <div className="space-y-1.5">
            <Label htmlFor="node-parent">Categoria</Label>
            <Select value={newCategory !== null ? NEW_CATEGORY : parentId} onValueChange={chooseCategory}>
              <SelectTrigger id="node-parent" aria-label="Categoria">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>Sem categoria</SelectItem>
                {categories.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem value={NEW_CATEGORY}>Nova categoria…</SelectItem>
              </SelectContent>
            </Select>
            {newCategory !== null ? (
              <div className="flex gap-2" data-testid="new-category-inline">
                <Input
                  autoFocus
                  aria-label="Nome da nova categoria"
                  placeholder="Nome da categoria"
                  value={newCategory}
                  maxLength={120}
                  onChange={(event) => setNewCategory(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void addCategory()
                  }}
                />
                <Button size="sm" variant="outline" disabled={newCategory.trim().length < 2 || createCategory.isPending} onClick={addCategory}>
                  <Plus /> Criar
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Opcional: agrupa produtos que dividem bases ou indícios.</p>
            )}
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="node-description">Como o cliente e a operação chamam</Label>
        <Textarea id="node-description" rows={2} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={category ? "Ex.: serviço básico, fixo" : "Ex.: internet, banda larga, “a conta da minha internet”"} />
        <p className="text-xs text-muted-foreground">A INIA usa estes nomes para reconhecer {category ? "a categoria" : "o produto"} quando o cliente ou o operador fala dele.</p>
      </div>
      {node ? <p className="text-xs text-muted-foreground">O nome pode mudar: as análises já feitas guardam o nome da época.</p> : null}
      {mutation.isError ? <p className="text-sm text-destructive">{(mutation.error as Error).message}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => onDone(null)}>
          Cancelar
        </Button>
        <Button disabled={!canSubmit || mutation.isPending} onClick={submit}>
          {mutation.isPending ? "Salvando..." : node ? "Salvar" : category ? "Criar categoria" : "Criar produto"}
        </Button>
      </div>
    </div>
  )
}
