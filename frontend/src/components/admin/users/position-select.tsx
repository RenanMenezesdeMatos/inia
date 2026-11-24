"use client"

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useJobPositionOptionsQuery } from "@/queries/admin/use-user-account-queries"
import { platformRoleSchema, type PlatformRole } from "@/schemas/auth/auth.schema"
import { ROLE_LABELS, type JobPositionOption } from "@/schemas/admin/user-account.schema"

/** O que a pessoa é na estrutura: um cargo do cadastro (que já traz o perfil) ou só o nível. */
export type PersonPosition = { role: PlatformRole; jobPositionId: string | null }

const keyOf = (position: PersonPosition) => (position.jobPositionId ? `cargo:${position.jobPositionId}` : `nivel:${position.role}`)

/**
 * Cargo da pessoa no cadastro manual. Escolher um cargo define o perfil dele ("Assistente de Relacionamento" → Operador); quem não tem
 * cargo cadastrado escolhe só o nível. `onlyOutsideHierarchy`: a base manda na hierarquia, sobra só "Fora da hierarquia".
 */
export function PositionSelect({ id, value, currentName, onChange, disabled, onlyOutsideHierarchy = false, ariaLabel, className, describedBy }: {
  id?: string
  value: PersonPosition
  /** Nome do cargo atual (aparece mesmo que o cargo tenha sido desativado). */
  currentName?: string | null
  onChange: (next: PersonPosition) => void
  disabled?: boolean
  onlyOutsideHierarchy?: boolean
  ariaLabel?: string
  className?: string
  describedBy?: string
}) {
  const options = useJobPositionOptionsQuery(!onlyOutsideHierarchy)
  const positions: JobPositionOption[] = options.data ?? []
  const known = positions.some((position) => position.id === value.jobPositionId)
  const levels = onlyOutsideHierarchy ? (["ADMIN"] as const) : platformRoleSchema.options

  function change(key: string) {
    const kind = key.slice(0, key.indexOf(":"))
    const rest = key.slice(kind.length + 1)
    if (kind === "nivel") return onChange({ role: rest as PlatformRole, jobPositionId: null })
    const position = positions.find((entry) => entry.id === rest)
    if (position) onChange({ role: position.level, jobPositionId: position.id })
  }

  return (
    <Select value={keyOf(value)} onValueChange={change} disabled={disabled}>
      <SelectTrigger id={id} className={className ?? "w-full"} aria-label={ariaLabel} aria-describedby={describedBy}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {onlyOutsideHierarchy ? null : (
          <SelectGroup>
            <SelectLabel>{options.isError ? "Cargos (não foi possível carregar)" : "Cargos"}</SelectLabel>
            {value.jobPositionId && !known ? <SelectItem value={keyOf(value)}>{currentName ?? "Cargo atual"}</SelectItem> : null}
            {positions.map((position) => (
              <SelectItem key={position.id} value={`cargo:${position.id}`}>
                {position.name}
                {position.name === position.levelLabel ? "" : ` · perfil ${position.levelLabel}`}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        <SelectGroup>
          {onlyOutsideHierarchy ? null : <SelectLabel>Só o nível, sem cargo</SelectLabel>}
          {levels.map((role) => (
            <SelectItem key={role} value={`nivel:${role}`}>
              {ROLE_LABELS[role]}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
