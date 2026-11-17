"use client"

import { useId, useState } from "react"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { InlineError } from "@/components/ui/states"
import { useCreateKnowledgeSubjectMutation, useKnowledgeSubjectsQuery } from "@/queries/admin/use-knowledge-queries"
import { knowledgeSubjectNameSchema, type KnowledgeSubjectSelection } from "@/schemas/admin/knowledge.schema"

/**
 * Assuntos da base: "Todos os assuntos" ou alguns, escolhidos no catálogo canônico das chamadas — o mesmo dos "Pedidos do cliente
 * relacionados" dos Alinhamentos operacionais —, com "Incluir assunto" para quem administra a organização inteira (o servidor diz quem
 * pode). Assunto desativado continua visível e marcado na base que já o tinha; nunca é oferecido a quem não o tinha. "Nenhum assunto" só
 * aparece para base antiga que já estava assim (`allowNone`): ausência nunca vira "todos".
 */
export function KnowledgeSubjectsField({ value, onChange, allowNone }: { value: KnowledgeSubjectSelection; onChange: (value: KnowledgeSubjectSelection) => void; allowNone: boolean }) {
  const id = useId()
  const catalog = useKnowledgeSubjectsQuery()
  const [initialIds] = useState(() => new Set(value.subjectIds))
  const toggle = (subjectId: string) => onChange({ mode: "SPECIFIC", subjectIds: value.subjectIds.includes(subjectId) ? value.subjectIds.filter((entry) => entry !== subjectId) : [...value.subjectIds, subjectId] })

  if (catalog.isLoading) return <Skeleton className="h-24 w-full" />
  if (catalog.isError || !catalog.data) return <InlineError message="Não foi possível carregar os assuntos." onRetry={() => catalog.refetch()} />

  // Oferecidos: os ativos + os desativados que esta base já tinha (marcados).
  const offered = catalog.data.items.filter((subject) => subject.active || initialIds.has(subject.id))
  const unknown = value.subjectIds.filter((subjectId) => !catalog.data.items.some((subject) => subject.id === subjectId))

  return (
    <div className="space-y-3">
      <RadioGroup
        value={value.mode}
        onValueChange={(mode) => onChange({ mode: mode as KnowledgeSubjectSelection["mode"], subjectIds: mode === "SPECIFIC" ? value.subjectIds : [] })}
        className="gap-2"
        aria-label="Para quais assuntos a base vale"
      >
        <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="ALL" />Todos os assuntos</label>
        <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="SPECIFIC" />Assuntos específicos</label>
        {allowNone ? <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="NONE" />Nenhum assunto (como está hoje)</label> : null}
      </RadioGroup>

      {value.mode === "SPECIFIC" ? (
        <div className="space-y-2 rounded-xl bg-muted/40 p-3">
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">Os assuntos dos pedidos do cliente em que esta base se aplica.</p>
          <div role="group" aria-label="Assuntos" aria-describedby={`${id}-hint`} className="flex flex-wrap gap-1.5">
            {offered.map((subject) => {
              const on = value.subjectIds.includes(subject.id)
              return (
                <Button key={subject.id} type="button" size="sm" variant={on ? "default" : "outline"} aria-pressed={on} className="h-7 rounded-full px-3 text-xs" onClick={() => toggle(subject.id)}>
                  {subject.name}{subject.active ? "" : " (desativado)"}
                </Button>
              )
            })}
            {unknown.map((subjectId) => (
              <Button key={subjectId} type="button" size="sm" variant="default" aria-pressed className="h-7 rounded-full px-3 text-xs" onClick={() => toggle(subjectId)}>
                Assunto removido
              </Button>
            ))}
            {offered.length === 0 && unknown.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum assunto cadastrado ainda.</p> : null}
          </div>
          {catalog.data.canCreate ? <AddSubject onAdded={(subjectId) => onChange({ mode: "SPECIFIC", subjectIds: [...new Set([...value.subjectIds, subjectId])] })} /> : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        O mesmo catálogo com que as chamadas são classificadas e que os Alinhamentos operacionais usam em “Pedidos do cliente relacionados”.
        {catalog.data.canCreate ? " Um assunto incluído aqui vale para a organização inteira." : " Para incluir um assunto, fale com quem administra as bases de toda a organização."}
      </p>
    </div>
  )
}

/** Inclui um assunto no catálogo (Popover com o nome) e já o marca nesta base. */
function AddSubject({ onAdded }: { onAdded: (subjectId: string) => void }) {
  const inputId = useId()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [issue, setIssue] = useState<string | null>(null)
  const create = useCreateKnowledgeSubjectMutation()

  async function add() {
    const parsed = knowledgeSubjectNameSchema.safeParse(name)
    if (!parsed.success) return setIssue(parsed.error.issues[0]?.message ?? "Nome inválido.")
    try {
      const subject = await create.mutateAsync(parsed.data)
      onAdded(subject.id)
      setName("")
      setIssue(null)
      setOpen(false)
    } catch (error) {
      setIssue(error instanceof Error && error.message ? error.message : "Não foi possível incluir o assunto.")
    }
  }

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setIssue(null); setName("") } }}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs"><Plus data-icon="inline-start" />Incluir assunto</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2">
        <Label htmlFor={inputId}>Novo assunto</Label>
        <Input
          id={inputId}
          autoFocus
          value={name}
          maxLength={80}
          placeholder="Ex.: Mudança de endereço"
          onChange={(event) => { setName(event.target.value); setIssue(null) }}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void add() } }}
        />
        {issue ? <p role="alert" className="text-xs text-destructive">{issue}</p> : <p className="text-xs text-muted-foreground">Entra no catálogo da organização e já fica marcado nesta base.</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="button" size="sm" disabled={create.isPending} onClick={() => void add()}>{create.isPending ? "Incluindo…" : "Incluir"}</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
