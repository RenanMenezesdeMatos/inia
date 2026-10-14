"use client"

import { useId, useState } from "react"
import { ArrowLeft, Plus, Shapes } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ListEmptyState, ListErrorState, ListSkeleton } from "@/components/admin/shared/list/list-states"
import { useCapabilityCatalogQuery, useCreateInterventionTypeMutation, useInterventionTypesQuery } from "@/queries/admin/use-intervention-policy-queries"
import { CAPABILITY_LABELS, emptyTypeDefinition, type InterventionTypeView } from "@/schemas/admin/intervention-policy.schema"

import { errorMessage, interventionTypeName, normalizeStableKey, STABLE_KEY_HINT, STABLE_KEY_PATTERN } from "../shared/helpers"
import { useInterventionCapabilities } from "../shared/use-intervention-capabilities"
import { TypeEditor } from "../type-editor"

/** Catálogo administrável de TIPOS de intervenção (vale para a organização inteira). */
export function TypesTab() {
  const { canEdit } = useInterventionCapabilities()
  const typesQuery = useInterventionTypesQuery()
  const catalogQuery = useCapabilityCatalogQuery()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [justCreated, setJustCreated] = useState<InterventionTypeView | null>(null)
  const types = typesQuery.data ?? []
  // O recém-criado abre na hora, mesmo antes de a lista ser recarregada.
  const selected = types.find((type) => type.id === selectedId) ?? (justCreated?.id === selectedId ? justCreated : null)
  const labelOf = (key: keyof typeof CAPABILITY_LABELS) => catalogQuery.data?.capabilities.find((item) => item.key === key)?.label ?? CAPABILITY_LABELS[key]

  if (selected) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
          <ArrowLeft /> Tipos de intervenção
        </Button>
        {/* Recomeça quando a versão PUBLICADA muda (publicação) — nunca a cada refetch nem ao salvar o rascunho. */}
        <TypeEditor key={`${selected.id}|${selected.published?.id ?? "-"}`} type={selected} types={types} />
      </div>
    )
  }

  const newButton = (
    <Button onClick={() => setCreating(true)} disabled={!canEdit} title={canEdit ? undefined : "Criar tipos exige a permissão de edição em toda a organização."}>
      <Plus /> Novo tipo
    </Button>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">O que uma intervenção é (orientar, observar, treinar, plano de ação…): dado da organização, montado a partir de capacidades técnicas fixas. Usado pelas regras das políticas.</p>
        {creating ? null : newButton}
      </div>
      {creating ? (
        <TypeCreateForm
          onCancel={() => setCreating(false)}
          onCreated={(type) => {
            setCreating(false)
            setJustCreated(type)
            setSelectedId(type.id)
          }}
        />
      ) : null}
      {typesQuery.isPending ? (
        <ListSkeleton view="list" rows={4} />
      ) : typesQuery.isError ? (
        <ListErrorState message="Não foi possível carregar os tipos de intervenção." onRetry={() => void typesQuery.refetch()} />
      ) : types.length === 0 ? (
        <ListEmptyState icon={Shapes} title="Nenhum tipo de intervenção" description="Cadastre os tipos que as políticas podem recomendar ou abrir." action={creating ? undefined : newButton} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Capacidades</TableHead>
                <TableHead>Publicado</TableHead>
                <TableHead>Rascunho</TableHead>
                <TableHead>Em uso</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((type) => {
                const definition = type.published?.definition ?? type.draft?.definition
                return (
                  <TableRow key={type.id} className={type.active ? undefined : "opacity-60"} data-testid={`type-row-${type.key}`}>
                    <TableCell>
                      <button type="button" className="text-left font-medium underline-offset-2 hover:underline" onClick={() => setSelectedId(type.id)}>
                        {interventionTypeName(type)}
                      </button>
                      <p className="font-mono text-xs text-muted-foreground">{type.key}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-sm flex-wrap gap-1">
                        {(definition?.capabilities ?? []).map((capability) => (
                          <Badge key={capability} variant="outline">
                            {labelOf(capability)}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{type.published ? `v${type.published.version}` : <span className="text-muted-foreground">Nunca</span>}</TableCell>
                    <TableCell className="text-sm">{type.draft ? `v${type.draft.version}` : "—"}</TableCell>
                    <TableCell className="text-sm">
                      {type.usage.active} ativa(s) · {type.usage.total} no total
                    </TableCell>
                    <TableCell>
                      <Badge variant={type.active ? "secondary" : "outline"}>{type.active ? "Ativo" : "Inativo"}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setSelectedId(type.id)}>
                        {canEdit ? "Abrir e editar" : "Abrir"}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function TypeCreateForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (type: InterventionTypeView) => void }) {
  const create = useCreateInterventionTypeMutation()
  const nameId = useId()
  const keyId = useId()
  const [name, setName] = useState("")
  const [key, setKey] = useState("")
  const [keyTouched, setKeyTouched] = useState(false)
  const keyValid = STABLE_KEY_PATTERN.test(key)
  return (
    <div className="max-w-2xl space-y-3 rounded-xl border p-4">
      <h3 className="text-sm font-semibold">Novo tipo de intervenção</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={nameId}>Nome do tipo *</Label>
          <Input
            id={nameId}
            value={name}
            maxLength={120}
            placeholder="Ex.: Orientação"
            onChange={(event) => {
              setName(event.target.value)
              if (!keyTouched) setKey(normalizeStableKey(event.target.value))
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={keyId}>Chave *</Label>
          <Input
            id={keyId}
            className="font-mono"
            value={key}
            maxLength={40}
            onChange={(event) => {
              setKeyTouched(true)
              setKey(normalizeStableKey(event.target.value))
            }}
          />
          <p className="text-xs text-muted-foreground">{STABLE_KEY_HINT}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Nasce como rascunho com a capacidade Tarefas; ajuste tudo no editor antes de publicar.</p>
      {create.isError ? <p className="text-sm text-destructive">{errorMessage(create.error)}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          disabled={!keyValid || name.trim().length === 0 || create.isPending}
          onClick={async () => {
            try {
              onCreated(await create.mutateAsync({ key, definition: emptyTypeDefinition(name.trim()) }))
            } catch {
              // mensagem do backend acima (chave repetida, escopo de organização exigido…)
            }
          }}
        >
          {create.isPending ? "Criando..." : "Criar tipo"}
        </Button>
      </div>
    </div>
  )
}
