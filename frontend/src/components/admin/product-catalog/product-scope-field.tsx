"use client"

import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useProductNodesQuery, useProductScopeSourcesQuery, useSetProductScopeMutation } from "@/queries/admin/use-product-catalog-queries"
import type { ProductNode, ProductScopeSource } from "@/schemas/admin/product-catalog.schema"

import { NodePicker, nodeLabel } from "./node-picker"

type SourceKind = ProductScopeSource["sourceKind"]
const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id))

/**
 * "Vale para" de uma base ou argumentário: todos os produtos (padrão) ou só os marcados. Só aparece para quem pode alterar o cadastro de
 * produtos e quando há produto ativo — sem isso a pergunta não faz sentido. O valor gravado vale a partir de agora (histórico guardado).
 */
export function useSourceProductScope(kind: SourceKind, sourceId: string | null) {
  const nodesQuery = useProductNodesQuery()
  const sourcesQuery = useProductScopeSourcesQuery()
  const mutation = useSetProductScopeMutation()
  const nodes = nodesQuery.data ?? []
  const available = nodesQuery.isSuccess && nodes.some((node) => node.active)
  const current = sourceId ? (sourcesQuery.data?.find((source) => source.sourceKind === kind && source.sourceId === sourceId)?.scope?.nodeIds ?? []) : []
  const ready = !sourceId || sourcesQuery.isSuccess
  const [draft, setDraft] = useState<string[] | null>(null)
  const value = draft ?? current
  return {
    available: available && ready,
    nodes,
    value,
    setValue: setDraft,
    changed: draft !== null && !sameIds(draft, current),
    /** Grava a escolha (depois de a base ou o argumentário existir). Sem mudança, não chama nada. */
    save: async (id: string) => {
      if (draft === null || sameIds(draft, current)) return
      await mutation.mutateAsync({ kind, id, nodeIds: draft })
      setDraft(null)
    },
    saving: mutation.isPending,
  }
}

export function ProductScopeField({ nodes, value, onChange, idPrefix }: { nodes: readonly ProductNode[]; value: readonly string[]; onChange: (ids: string[]) => void; idPrefix: string }) {
  const [some, setSome] = useState(value.length > 0)
  return (
    <fieldset className="space-y-2" data-testid="product-scope-field">
      <legend className="text-sm font-medium">Vale para</legend>
      <RadioGroup
        value={some ? "SOME" : "ALL"}
        onValueChange={(next) => {
          setSome(next === "SOME")
          if (next === "ALL") onChange([])
        }}
        className="flex flex-wrap gap-x-6 gap-y-2"
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem id={`${idPrefix}-all`} value="ALL" />
          <Label htmlFor={`${idPrefix}-all`} className="font-normal">
            Todos os produtos
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem id={`${idPrefix}-some`} value="SOME" />
          <Label htmlFor={`${idPrefix}-some`} className="font-normal">
            Só para alguns produtos
          </Label>
        </div>
      </RadioGroup>
      {some ? (
        <>
          <NodePicker nodes={nodes} value={value} onChange={onChange} idPrefix={idPrefix} />
          <p className="text-xs text-muted-foreground">A INIA só cobra estas regras quando a chamada mostra que o pedido é de um destes produtos. Marcar uma categoria vale para todos os produtos dela.</p>
        </>
      ) : null}
    </fieldset>
  )
}

/**
 * Cartão "Vale para" que grava sozinho (fora do rascunho/publicação — a abrangência por produto tem vigência própria): mostra o valor
 * atual e abre a edição no próprio lugar.
 */
export function ProductScopeCard({ kind, sourceId, canEdit }: { kind: SourceKind; sourceId: string; canEdit: boolean }) {
  const scope = useSourceProductScope(kind, sourceId)
  const [editing, setEditing] = useState(false)
  if (!scope.available) return null
  return (
    <div className="space-y-2 rounded-lg border p-3" data-testid="product-scope-card">
      {editing ? (
        <>
          <ProductScopeField nodes={scope.nodes} value={scope.value} onChange={scope.setValue} idPrefix={`scope-card-${sourceId}`} />
          <p className="text-xs text-muted-foreground">Vale a partir de agora: chamadas já analisadas continuam com o que valia na época.</p>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                scope.setValue(null)
                setEditing(false)
              }}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={!scope.changed || scope.saving}
              onClick={async () => {
                try {
                  await scope.save(sourceId)
                  setEditing(false)
                } catch {
                  // aviso do backend já mostrado
                }
              }}
            >
              {scope.saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Vale para</span>
          {scope.value.length === 0 ? (
            <span className="text-sm text-muted-foreground">Todos os produtos</span>
          ) : (
            scope.value.map((id) => (
              <Badge key={id} variant="secondary">
                {nodeLabel(scope.nodes, id)}
              </Badge>
            ))
          )}
          {canEdit ? (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing(true)}>
              Alterar
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}

/**
 * Produtos de cada base ou argumentário (para listas): `available` = há produto cadastrado e quem vê alcança o cadastro; `labelsOf` =
 * nomes dos produtos para quem a fonte vale (vazio = todos os produtos).
 */
export function useProductScopeLabels(kind: SourceKind): { available: boolean; labelsOf: (sourceId: string) => string[] } {
  const nodesQuery = useProductNodesQuery()
  const sourcesQuery = useProductScopeSourcesQuery()
  const nodes = nodesQuery.data ?? []
  const map = new Map<string, string[]>()
  for (const source of sourcesQuery.data ?? []) if (source.sourceKind === kind && source.scope && source.scope.nodeIds.length > 0) map.set(source.sourceId, source.scope.nodeIds.map((id) => nodeLabel(nodes, id)))
  return { available: nodesQuery.isSuccess && sourcesQuery.isSuccess && nodes.some((node) => node.active), labelsOf: (sourceId) => map.get(sourceId) ?? [] }
}
