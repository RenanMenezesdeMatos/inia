"use client"

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { ScopeNode } from "@/schemas/human-support/admin.schema"

/** Grupo ou Subgrupo escolhido (sem nada = todos). Com Subgrupo, o Grupo dele vai junto. */
export type ScopeFilterValue = { teamId?: string | undefined; subteamId?: string | undefined }

const ALL = "__all__"
const encode = (value: ScopeFilterValue) => (value.subteamId ? `subgroup:${value.teamId ?? ""}:${value.subteamId}` : value.teamId ? `group:${value.teamId}` : ALL)
function decode(raw: string): ScopeFilterValue {
  const [kind, first, second] = raw.split(":")
  if (kind === "group" && first) return { teamId: first }
  if (kind === "subgroup" && second) return { teamId: first || undefined, subteamId: second }
  return {}
}

/** Nome do escopo escolhido ("Grupo X › Subgrupo X1"), para títulos e mensagens. */
export function scopeFilterName(nodes: readonly ScopeNode[], value: ScopeFilterValue): string | null {
  if (!value.teamId && !value.subteamId) return null
  for (const group of nodes) {
    if (value.subteamId) {
      const child = group.children?.find((node) => node.id === value.subteamId)
      if (child) return `${group.name} › ${child.name}`
    } else if (group.id === value.teamId) return group.name
  }
  return null
}

/**
 * Filtro por Grupo/Subgrupo a partir da árvore dos escopos (a mesma da aba Escopos). Só para quem configura o apoio: o Coordenador de
 * Anjos não tem rota que liste a estrutura, e a tela nunca chama uma rota que ele não pode chamar.
 */
export function ScopeFilter({ nodes, value, onChange, className }: { nodes: readonly ScopeNode[]; value: ScopeFilterValue; onChange: (value: ScopeFilterValue) => void; className?: string }) {
  const current = encode(value)
  return (
    <Select value={current} onValueChange={(next) => onChange(decode(next))}>
      <SelectTrigger className={cn("w-full sm:w-auto sm:min-w-48", current !== ALL && "border-primary/50 text-foreground", className)} aria-label="Filtrar por Grupo ou Subgrupo">
        <SelectValue placeholder="Todos os Grupos" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Todos os Grupos</SelectItem>
        {nodes.map((group) => (
          <SelectGroup key={group.id}>
            <SelectLabel>{group.name}</SelectLabel>
            <SelectItem value={`group:${group.id}`}>{group.name} (Grupo inteiro)</SelectItem>
            {(group.children ?? []).map((child) => (
              <SelectItem key={child.id} value={`subgroup:${group.id}:${child.id}`}>
                {group.name} › {child.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
