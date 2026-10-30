"use client"

import { useId } from "react"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Subject, SubjectScopeType } from "@/schemas/admin/org-structure.schema"

export type SubjectScopeValue = { scopeType: SubjectScopeType; subjectId?: string }

export function SubjectScopeSelect({
  subjects,
  value,
  onChange,
}: {
  subjects: Subject[]
  value: SubjectScopeValue
  onChange: (value: SubjectScopeValue) => void
}) {
  const id = useId()
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-scope`}>Alcance por assunto</Label>
        <Select
          value={value.scopeType}
          onValueChange={(scopeType) => onChange({ scopeType: scopeType as SubjectScopeType })}
        >
          <SelectTrigger id={`${id}-scope`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL_SUBJECTS">Todos os assuntos</SelectItem>
            <SelectItem value="SUBJECT">Um assunto específico</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {value.scopeType === "SUBJECT" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-subject`}>Assunto</Label>
          <Select value={value.subjectId ?? ""} onValueChange={(subjectId) => onChange({ ...value, subjectId })}>
            <SelectTrigger id={`${id}-subject`} className="w-full">
              <SelectValue placeholder="Selecione o assunto" />
            </SelectTrigger>
            <SelectContent>
              {subjects.map((subject) => (
                <SelectItem key={subject.id} value={subject.id}>
                  {subject.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  )
}
