"use client"

import { useState, type FormEvent } from "react"
import { Loader2, Pencil, Plus, Power, TriangleAlert, UserRoundCog } from "lucide-react"

import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ListSearchInput, ListToolbar } from "@/components/admin/shared/list/list-filters"
import { ListEmptyState, ListErrorState, ListNoResultsState } from "@/components/admin/shared/list/list-states"
import { useCreateJobPositionMutation, useJobPositionsQuery, useUpdateJobPositionMutation } from "@/queries/admin/use-data-hub-queries"
import { JOB_POSITION_LEVEL_LABELS, JOB_POSITION_LEVELS, type JobPosition, type JobPositionLevel } from "@/schemas/admin/data-hub.schema"

import { formatCount, formatRelative } from "./data-hub-format"

/**
 * CARGOS — o nome que a base do cliente usa é cadastro: cada cargo tem o nome exibido, os nomes que a base usa e o PERFIL (nível da
 * hierarquia). A carga de Colaboradores resolve por aqui; cargo não cadastrado vai para a quarentena e aparece no aviso desta tela.
 */
const LEVEL_HELP: Record<JobPositionLevel, string> = {
  OPERATOR: "Atende clientes: entra em indicadores, comparações e feedbacks.",
  SUPERVISOR: "Lidera operadores diretamente.",
  COORDINATOR: "Lidera supervisores.",
  MANAGER: "Lidera coordenadores ou supervisores.",
  SENIOR_MANAGER: "Lidera gerentes.",
  DIRECTOR: "Topo da estrutura.",
  STAFF: "Não atende nem lidera: fica fora de indicadores e comparações.",
}

type Draft = { id: string | null; name: string; level: JobPositionLevel | null; terms: string; peopleCount: number }

const emptyDraft = (name = ""): Draft => ({ id: null, name, level: null, terms: "", peopleCount: 0 })
/** Os nomes da base sem o próprio nome do cargo, que entra sempre. */
const draftOf = (position: JobPosition): Draft => ({ id: position.id, name: position.name, level: position.level, terms: position.terms.filter((term) => term !== position.name).join("\n"), peopleCount: position.peopleTotal })
const termsOf = (text: string) => text.split(/[\n;]/).map((term) => term.trim()).filter(Boolean)
const searchKey = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
/** "ASSISTENTE DE RELACIONAMENTO" chega em maiúsculas da base; o nome exibido sugerido vem legível. */
const SMALL_WORDS = new Set(["de", "da", "do", "das", "dos", "e"])
const titleCase = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .map((word, index) => (index > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1)))
    .join(" ")

function PositionDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const create = useCreateJobPositionMutation()
  const update = useUpdateJobPositionMutation({ errorsInline: true })
  const [name, setName] = useState(draft.name)
  const [level, setLevel] = useState<JobPositionLevel | null>(draft.level)
  const [terms, setTerms] = useState(draft.terms)
  const mutation = draft.id ? update : create
  const levelChanged = draft.id !== null && level !== draft.level

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!level) return
    const input = { name: name.trim(), level, terms: termsOf(terms) }
    try {
      if (draft.id) await update.mutateAsync({ id: draft.id, ...input })
      else await create.mutateAsync(input)
      onClose()
    } catch {
      // o erro aparece no formulário
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{draft.id ? "Editar cargo" : "Novo cargo"}</DialogTitle>
          <DialogDescription>O cargo nunca concede acesso à INIA: ele só diz o perfil da pessoa na estrutura.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="position-name">Nome que aparece na INIA</Label>
            <Input id="position-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus placeholder="Assistente de Relacionamento" />
            {draft.id && draft.peopleCount > 0 && name.trim() !== draft.name ? (
              <p className="text-xs text-muted-foreground">O nome antigo continua valendo na base. Reports distribuídos por cargo com o nome antigo precisam ser ajustados.</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="position-level">Perfil</Label>
            <Select value={level ?? ""} onValueChange={(value) => setLevel(value as JobPositionLevel)}>
              <SelectTrigger id="position-level" className="w-full" aria-describedby="position-level-help">
                <SelectValue placeholder="Escolha o perfil" />
              </SelectTrigger>
              <SelectContent position="popper">
                {JOB_POSITION_LEVELS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {JOB_POSITION_LEVEL_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id="position-level-help" className="text-xs text-muted-foreground">
              {level ? LEVEL_HELP[level] : "O que a pessoa com este cargo é na estrutura."}
            </p>
            {levelChanged && draft.peopleCount > 0 ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {formatCount(draft.peopleCount)} {draft.peopleCount === 1 ? "pessoa muda" : "pessoas mudam"} de perfil ao salvar (inclusive inativas).
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="position-terms">Como a base escreve este cargo (opcional)</Label>
            <Textarea id="position-terms" value={terms} onChange={(event) => setTerms(event.target.value)} rows={3} placeholder={"ASSISTENTE RELACIONAMENTO\nASSIST. RELACIONAMENTO"} aria-describedby="position-terms-help" />
            <p id="position-terms-help" className="text-xs text-muted-foreground">Um por linha. Maiúsculas, acentos e pontuação não fazem diferença, e o próprio nome já vale.</p>
          </div>
          {mutation.error ? (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={name.trim().length < 2 || !level || mutation.isPending}>
              {mutation.isPending ? <Loader2 className="animate-spin" /> : null} {draft.id ? "Salvar cargo" : "Cadastrar cargo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ActiveSwitch({ position }: { position: JobPosition }) {
  const update = useUpdateJobPositionMutation()
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <Switch
        checked={position.active}
        disabled={update.isPending}
        // Cargo em uso: um clique por engano bloquearia a entrada de gente nova nele.
        onCheckedChange={(active) => (!active && position.peopleTotal > 0 ? setConfirming(true) : update.mutate({ id: position.id, active }))}
        aria-label={position.active ? `Desativar ${position.name}` : `Ativar ${position.name}`}
      />
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar {position.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Quem já tem este cargo continua com ele e segue sendo atualizado pelas cargas. Gente nova com este cargo vai para a quarentena até você ativar de novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: position.id, active: false }, { onSettled: () => setConfirming(false) })}
            >
              Desativar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ActivateButton({ id, term }: { id: string; term: string }) {
  const update = useUpdateJobPositionMutation()
  return (
    <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => update.mutate({ id, active: true })} aria-label={`Ativar o cargo ${term}`}>
      <Power /> Ativar
    </Button>
  )
}

export function JobPositionsTab() {
  const query = useJobPositionsQuery()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [search, setSearch] = useState("")
  if (query.isLoading) return <Skeleton className="h-96 rounded-xl" aria-hidden />
  if (query.isError || !query.data) return <ListErrorState message="Não foi possível carregar os cargos." onRetry={() => query.refetch()} error={query.error} />
  const { positions, unknown } = query.data
  const wanted = searchKey(search.trim())
  const visible = wanted ? positions.filter((position) => [position.name, JOB_POSITION_LEVEL_LABELS[position.level], ...position.terms].some((value) => searchKey(value).includes(wanted))) : positions

  return (
    <div className="space-y-4">
      {unknown.length > 0 ? (
        <Card className="border-amber-300 dark:border-amber-800" data-testid="unknown-positions">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4 text-amber-600 dark:text-amber-400" aria-hidden /> Cargos que chegaram e não estão disponíveis
            </CardTitle>
            <CardDescription>As pessoas com estes cargos ficaram na quarentena nos últimos 30 dias. Cadastre ou ative o cargo e depois reprocesse a carga (ou reinicie a leitura do conjunto, se a carga falhou inteira).</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {unknown.map((entry) => (
                <li key={entry.term} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="font-medium wrap-anywhere">{entry.term}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCount(entry.records)} {entry.records === 1 ? "pessoa" : "pessoas"} · {formatRelative(entry.lastSeenAt)}{entry.inactivePositionId ? " · cargo desativado" : ""}
                    </p>
                  </div>
                  {entry.inactivePositionId ? (
                    <ActivateButton id={entry.inactivePositionId} term={entry.term} />
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setDraft({ ...emptyDraft(titleCase(entry.term)), terms: entry.term })} aria-label={`Cadastrar o cargo ${entry.term}`}>
                      <Plus /> Cadastrar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-2xl space-y-1">
              <CardTitle>Cargos</CardTitle>
              <CardDescription>O nome que a base usa para cada cargo e o perfil que ele representa. A carga de Colaboradores aceita estes nomes no campo Nível hierárquico.</CardDescription>
            </div>
            <Button onClick={() => setDraft(emptyDraft())}>
              <Plus /> Novo cargo
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {positions.length === 0 ? (
            <ListEmptyState icon={UserRoundCog} title="Nenhum cargo cadastrado" description="Sem cargos, a carga só aceita o código do nível (OPERATOR, SUPERVISOR…)." />
          ) : (
            <>
              <ListToolbar search={<ListSearchInput value={search} onChange={setSearch} placeholder="Buscar cargo, perfil ou nome na base" ariaLabel="Buscar cargo" />} hasActiveFilters={search !== ""} onClearFilters={() => setSearch("")} />
              {visible.length === 0 ? (
                <ListNoResultsState title="Nenhum cargo com essa busca" onClear={() => setSearch("")} />
              ) : (
                <div className={TABLE_FRAME}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cargo</TableHead>
                        <TableHead>Perfil</TableHead>
                        <TableHead>Nomes na base</TableHead>
                        <TableHead className="text-right">Pessoas ativas</TableHead>
                        <TableHead>Ativo</TableHead>
                        <TableHead className="w-12">
                          <span className="sr-only">Ações</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.map((position) => (
                        <TableRow key={position.id} className={position.active ? undefined : "opacity-60"}>
                          <TableCell className="font-medium">{position.name}</TableCell>
                          <TableCell>
                            <Badge variant={position.level === "STAFF" ? "outline" : "secondary"}>{JOB_POSITION_LEVEL_LABELS[position.level]}</Badge>
                          </TableCell>
                          <TableCell className="max-w-sm whitespace-normal text-xs text-muted-foreground wrap-anywhere">{position.terms.join(" · ")}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCount(position.peopleCount)}</TableCell>
                          <TableCell>
                            <ActiveSwitch position={position} />
                          </TableCell>
                          <TableCell>
                            <Button size="icon" variant="ghost" aria-label={`Editar ${position.name}`} onClick={() => setDraft(draftOf(position))}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      {draft ? <PositionDialog key={draft.id ?? draft.name} draft={draft} onClose={() => setDraft(null)} /> : null}
    </div>
  )
}
