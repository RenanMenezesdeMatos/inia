"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { OrgScopeSelect, type OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import { useCreatePolicyMutation, useEditorCatalogQuery } from "@/queries/admin/use-intervention-policy-queries"

import { Note } from "../shared/fields"
import { errorMessage, normalizeStableKey, STABLE_KEY_HINT, STABLE_KEY_PATTERN } from "../shared/helpers"
import { fromOrgScope, scopeIsComplete } from "./scope"

/**
 * Nova política: cabeçalho (chave estável, nome, escopo). O backend cria junto o rascunho v1 vazio; a tela abre a política
 * pelo id devolvido para montar as regras. O escopo pode mudar até a primeira publicação.
 */
export function PolicyCreateForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter()
  const create = useCreatePolicyMutation()
  const catalogQuery = useEditorCatalogQuery()
  const nameId = useId()
  const keyId = useId()
  const [name, setName] = useState("")
  const [key, setKey] = useState("")
  const [keyTouched, setKeyTouched] = useState(false)
  const [chosenScope, setScope] = useState<OrgScopeValue | null>(null)
  // Quem edita com escopo de grupo nunca vê "toda a organização": começa no grupo (o backend recusaria a organização).
  const scope = chosenScope ?? (catalogQuery.data && !catalogQuery.data.unrestricted ? { scopeType: "TEAM" as const, teamId: catalogQuery.data.teams[0]?.id } : { scopeType: "ALL_TEAMS" as const })
  const policyScope = fromOrgScope(scope)
  const keyValid = STABLE_KEY_PATTERN.test(key)
  const canSubmit = name.trim().length > 0 && keyValid && scopeIsComplete(policyScope) && catalogQuery.isSuccess

  async function handleSubmit() {
    try {
      const created = await create.mutateAsync({ key, name: name.trim(), ...policyScope })
      router.push(`/admin/intervention-policies/${created.id}`)
    } catch {
      // mensagem do backend abaixo (chave repetida, escopo fora do seu, etc.)
    }
  }

  return (
    <div className="max-w-2xl space-y-4 rounded-xl border p-4" data-testid="policy-create-form">
      <div>
        <h3 className="text-sm font-semibold">Nova política de acompanhamento</h3>
        <p className="text-xs text-muted-foreground">Ela nasce como rascunho, sem regras. Nada é avaliado até a primeira publicação.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={nameId}>Nome da política *</Label>
          <Input
            id={nameId}
            value={name}
            maxLength={120}
            placeholder="Ex.: Acompanhamento de TMA"
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
            aria-invalid={(key !== "" && !keyValid) || undefined}
            onChange={(event) => {
              setKeyTouched(true)
              setKey(normalizeStableKey(event.target.value))
            }}
          />
          <p className="text-xs text-muted-foreground">{STABLE_KEY_HINT}</p>
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Escopo</p>
        {catalogQuery.isError ? <Note>Não foi possível carregar os grupos agora: {errorMessage(catalogQuery.error)}</Note> : <OrgScopeSelect teams={catalogQuery.data?.teams ?? []} value={scope} onChange={setScope} allowAllTeams={catalogQuery.data?.unrestricted ?? true} />}
        <p className="text-xs text-muted-foreground">Quem a política alcança. Seu escopo de edição precisa cobrir o escolhido; depois da primeira publicação o escopo não muda.</p>
      </div>
      {create.isError ? <p className="text-sm text-destructive">{errorMessage(create.error)}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button disabled={!canSubmit || create.isPending} onClick={handleSubmit}>
          {create.isPending ? "Criando..." : "Criar política"}
        </Button>
      </div>
    </div>
  )
}
