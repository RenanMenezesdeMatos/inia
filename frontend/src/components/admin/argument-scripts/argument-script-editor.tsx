"use client"

import { useState } from "react"
import { z } from "zod"
import { ArrowLeft, Pencil } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

import { OrgScopeSelect, type OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import { AdminApiError } from "@/lib/admin/admin-api"
import {
  useArgumentScriptQuery,
  useArgumentScriptScopeOptionsQuery,
  useCreateArgumentScriptMutation,
  usePublishArgumentScriptMutation,
  useUpdateArgumentScriptMutation,
} from "@/queries/admin/use-argument-script-queries"
import { useBusinessDomainsQuery } from "@/queries/admin/use-business-domain-queries"
import { useKnowledgeDocumentsQuery } from "@/queries/admin/use-knowledge-queries"
import { useTeamsQuery } from "@/queries/admin/use-org-structure-queries"
import {
  ARGUMENT_SCRIPT_STATUS_LABELS,
  LEGACY_CONVERSION_LABEL,
  READ_ONLY_LABEL,
  type ArgumentScriptDetail,
  type ArgumentScriptScopeOptions,
  type ArgumentScriptVersion,
} from "@/schemas/admin/argument-script.schema"
import type { Team } from "@/schemas/admin/org-structure.schema"
import type { ArgumentScriptScopeInput } from "@/services/admin/argument-script-service"

import { ArgumentScriptLifecycleDialog, type ArgumentScriptLifecycleAction } from "./argument-script-lifecycle"
import { ArgumentScriptContentFields, ArgumentScriptContentView, contentToForm, EMPTY_CONTENT_FORM, formSource, formToContent, type ContentFormState } from "./argument-script-form"
import { defaultScopeType, formatDateTime, scopeLabel, teamsForScope, validityLabel, versionSituation } from "./argument-script-format"

// ---------------------------------------------------------------------------------------------
// Cabeçalho: nome, área responsável (domínio de negócio) e escopo
// ---------------------------------------------------------------------------------------------

type HeaderState = { name: string; businessDomainId: string | null; scope: OrgScopeValue }

function toScopeInput(scope: OrgScopeValue): ArgumentScriptScopeInput {
  if (scope.scopeType === "ALL_TEAMS") return { scopeType: "ALL_TEAMS" }
  if (scope.scopeType === "TEAM") return { scopeType: "TEAM", teamId: scope.teamId }
  return { scopeType: "SUBTEAM", teamId: scope.teamId, subteamId: scope.subteamId }
}

function scopeIsComplete(scope: OrgScopeValue) {
  if (scope.scopeType === "TEAM") return Boolean(scope.teamId)
  if (scope.scopeType === "SUBTEAM") return Boolean(scope.subteamId)
  return true
}

function AreaSelect({ value, onChange, currentName }: { value: string | null; onChange: (value: string) => void; currentName: string | null }) {
  const domainsQuery = useBusinessDomainsQuery()
  const options = domainsQuery.data ?? []
  const missing = value !== null && !options.some((domain) => domain.id === value)
  return (
    <div className="space-y-1.5">
      <Label htmlFor="argument-script-area">Área responsável *</Label>
      <Select value={value ?? ""} onValueChange={onChange} disabled={domainsQuery.isLoading}>
        <SelectTrigger id="argument-script-area" className="w-full">
          <SelectValue placeholder="Selecione a área" />
        </SelectTrigger>
        <SelectContent>
          {missing ? <SelectItem value={value!}>{currentName ?? "Área atual"}</SelectItem> : null}
          {options.map((domain) => (
            <SelectItem key={domain.id} value={domain.id}>
              {domain.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">A área que responde por este argumentário.</p>
    </div>
  )
}

function ScopeField({ value, onChange, teams, scopeOptions, lockedLabel }: { value: OrgScopeValue; onChange: (value: OrgScopeValue) => void; teams: Team[] | undefined; scopeOptions: ArgumentScriptScopeOptions | undefined; lockedLabel?: string | null }) {
  if (lockedLabel) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">Escopo</p>
        <p className="text-sm">{lockedLabel}</p>
        <p className="text-xs text-muted-foreground">O escopo não muda depois da primeira publicação. Para outro escopo, desative este argumentário e crie outro.</p>
      </div>
    )
  }
  if (!teams || !scopeOptions) return <Skeleton className="h-16 w-full" />
  return (
    <div className="space-y-1.5" data-testid="argument-script-scope">
      <OrgScopeSelect teams={teamsForScope(teams, scopeOptions, value.scopeType)} value={value} onChange={onChange} allowAllTeams={scopeOptions.allTeams} />
      <p className="text-xs text-muted-foreground">Para quem o argumentário vale. Você só escolhe grupos e subgrupos que administra.</p>
    </div>
  )
}

function HeaderFields({ value, onChange, teams, scopeOptions, currentAreaName, scopeLockedLabel }: { value: HeaderState; onChange: (value: HeaderState) => void; teams: Team[] | undefined; scopeOptions: ArgumentScriptScopeOptions | undefined; currentAreaName: string | null; scopeLockedLabel?: string | null }) {
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="argument-script-name">Nome *</Label>
          <Input id="argument-script-name" value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} maxLength={160} placeholder="Ex.: Retenção por preço" />
        </div>
        <AreaSelect value={value.businessDomainId} onChange={(businessDomainId) => onChange({ ...value, businessDomainId })} currentName={currentAreaName} />
      </div>
      <ScopeField value={value.scope} onChange={(scope) => onChange({ ...value, scope })} teams={teams} scopeOptions={scopeOptions} lockedLabel={scopeLockedLabel} />
    </div>
  )
}

function useKnowledgeOptions() {
  const knowledgeQuery = useKnowledgeDocumentsQuery()
  return { documents: knowledgeQuery.data, unavailable: knowledgeQuery.isError }
}

// ---------------------------------------------------------------------------------------------
// Novo argumentário
// ---------------------------------------------------------------------------------------------

export function ArgumentScriptCreateForm({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const scopeOptionsQuery = useArgumentScriptScopeOptionsQuery()
  const teamsQuery = useTeamsQuery()
  if (scopeOptionsQuery.isError) return <p className="text-sm text-destructive">Não foi possível carregar os escopos que você administra.</p>
  if (!scopeOptionsQuery.data || !teamsQuery.data) return <Skeleton className="h-64 w-full" />
  return <CreateForm scopeOptions={scopeOptionsQuery.data} teams={teamsQuery.data} onCreated={onCreated} onCancel={onCancel} />
}

function CreateForm({ scopeOptions, teams, onCreated, onCancel }: { scopeOptions: ArgumentScriptScopeOptions; teams: Team[]; onCreated: (id: string) => void; onCancel: () => void }) {
  const createMutation = useCreateArgumentScriptMutation()
  const knowledge = useKnowledgeOptions()
  const [header, setHeader] = useState<HeaderState>(() => ({ name: "", businessDomainId: null, scope: { scopeType: defaultScopeType(scopeOptions) } }))
  const [content, setContent] = useState<ContentFormState>(EMPTY_CONTENT_FORM)

  const canSubmit = header.name.trim().length >= 3 && header.businessDomainId !== null && scopeIsComplete(header.scope)

  async function handleCreate() {
    if (!header.businessDomainId) return
    try {
      const created = await createMutation.mutateAsync({
        name: header.name.trim(),
        businessDomainId: header.businessDomainId,
        scope: toScopeInput(header.scope),
        content: formToContent(content),
        ...formSource(content),
      })
      onCreated(created.id)
    } catch {
      // erro exibido abaixo (e no toast)
    }
  }

  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-sm text-muted-foreground">O argumentário nasce como rascunho. Ele só passa a valer depois de publicado.</p>
      <HeaderFields value={header} onChange={setHeader} teams={teams} scopeOptions={scopeOptions} currentAreaName={null} />
      <ArgumentScriptContentFields value={content} onChange={setContent} knowledgeDocuments={knowledge.documents} knowledgeUnavailable={knowledge.unavailable} />
      {createMutation.isError ? <p className="text-sm text-destructive">{createMutation.error.message}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button disabled={!canSubmit || createMutation.isPending} onClick={handleCreate}>
          {createMutation.isPending ? "Salvando..." : "Salvar rascunho"}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Argumentário existente
// ---------------------------------------------------------------------------------------------

export function ArgumentScriptDetailPanel({ id, onBack, onDeleted }: { id: string; onBack: () => void; onDeleted: () => void }) {
  const detailQuery = useArgumentScriptQuery(id)
  if (detailQuery.isLoading) return <Skeleton className="h-64 w-full" />
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div role="alert" className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm text-destructive">Não foi possível carregar o argumentário.</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onBack}>
            Voltar para a lista
          </Button>
          <Button variant="outline" size="sm" onClick={() => detailQuery.refetch()}>
            Tentar novamente
          </Button>
        </div>
      </div>
    )
  }
  const detail = detailQuery.data
  // Remonta o editor quando o servidor devolve outra versão (salvou, publicou, descartou): o formulário recomeça do que foi gravado.
  const editorKey = [detail.id, detail.updatedAt, detail.draft?.id ?? "-", detail.draft?.updatedAt ?? "-", detail.current?.id ?? "-", detail.status].join("|")
  return <ArgumentScriptEditor key={editorKey} detail={detail} onBack={onBack} onDeleted={onDeleted} />
}

function snapshotOf(header: HeaderState, content: ContentFormState) {
  return JSON.stringify({ name: header.name.trim(), area: header.businessDomainId, scope: toScopeInput(header.scope), content: formToContent(content), source: formSource(content) })
}

function StatusBadges({ detail, now }: { detail: ArgumentScriptDetail; now: number }) {
  const validity = validityLabel(detail.currentEffectiveFrom, detail.currentEffectiveUntil, now)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant={detail.status === "ACTIVE" ? "secondary" : "outline"}>{ARGUMENT_SCRIPT_STATUS_LABELS[detail.status]}</Badge>
      {detail.currentVersion !== null ? (
        <Badge variant="outline">
          v{detail.currentVersion}
          {validity ? ` · ${validity}` : ""}
        </Badge>
      ) : (
        <Badge variant="outline">Nunca publicado</Badge>
      )}
      {detail.draftVersion !== null ? <Badge variant="outline">Rascunho v{detail.draftVersion}</Badge> : null}
      {detail.conversion === "LEGACY_UNSTRUCTURED" ? <Badge variant="destructive">{LEGACY_CONVERSION_LABEL}</Badge> : null}
      {detail.canEdit ? null : <Badge variant="outline">{READ_ONLY_LABEL}</Badge>}
    </div>
  )
}

function ArgumentScriptEditor({ detail, onBack, onDeleted }: { detail: ArgumentScriptDetail; onBack: () => void; onDeleted: () => void }) {
  const scopeOptionsQuery = useArgumentScriptScopeOptionsQuery()
  const teamsQuery = useTeamsQuery()
  const knowledge = useKnowledgeOptions()
  const updateMutation = useUpdateArgumentScriptMutation()

  // Edição parte do rascunho (ou da vigente, quando o rascunho ainda vai nascer); a leitura mostra o que vale hoje.
  const base: ArgumentScriptVersion | null = detail.draft ?? detail.current
  const viewVersion: ArgumentScriptVersion | null = detail.current ?? detail.draft
  const [initial] = useState(() => {
    const header: HeaderState = { name: detail.name, businessDomainId: detail.businessDomainId, scope: { scopeType: detail.scopeType, teamId: detail.teamId ?? undefined, subteamId: detail.subteamId ?? undefined } }
    const content = contentToForm(base?.content ?? null, { sourceDocumentId: base?.sourceDocumentId ?? null, sourceReference: base?.sourceReference ?? null })
    return { header, content, snapshot: snapshotOf(header, content), now: Date.now() }
  })
  const [header, setHeader] = useState(initial.header)
  const [content, setContent] = useState(initial.content)
  const [editRequested, setEditRequested] = useState(false)
  const [dialog, setDialog] = useState<"publish" | ArgumentScriptLifecycleAction | null>(null)

  const hasDraft = detail.draft !== null
  const editing = detail.canEdit && (hasDraft || editRequested)
  const dirty = editing && snapshotOf(header, content) !== initial.snapshot
  const areaRequired = detail.conversion === "NATIVE"
  const canSave = header.name.trim().length >= 3 && (!areaRequired || header.businessDomainId !== null) && scopeIsComplete(header.scope)
  const issues = detail.draftIssues
  const publishBlockedReason = !hasDraft
    ? null
    : detail.status === "ARCHIVED"
      ? "Argumentário inativo: reative-o antes de publicar."
      : dirty
        ? "Salve o rascunho antes de publicar."
        : issues.length > 0
          ? "Resolva as pendências acima para publicar."
          : null

  async function handleSave() {
    try {
      await updateMutation.mutateAsync({
        id: detail.id,
        input: {
          name: header.name.trim(),
          businessDomainId: header.businessDomainId,
          ...(detail.everPublished ? {} : { scope: toScopeInput(header.scope) }),
          content: formToContent(content),
          ...formSource(content),
        },
      })
    } catch {
      // erro exibido abaixo (e no toast)
    }
  }

  function cancelEditing() {
    setHeader(initial.header)
    setContent(initial.content)
    setEditRequested(false)
  }

  return (
    <div className="max-w-4xl space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft data-icon="inline-start" /> Voltar para a lista
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold leading-tight">{detail.name}</h2>
          <p className="text-sm text-muted-foreground">
            {detail.businessDomainName ?? "Sem área responsável"} · {scopeLabel(detail)}
          </p>
          <StatusBadges detail={detail} now={initial.now} />
        </div>
        {detail.canEdit ? (
          <div className="flex flex-wrap gap-2">
            {detail.status === "ACTIVE" && detail.everPublished ? (
              <Button variant="outline" size="sm" onClick={() => setDialog("archive")}>
                Desativar
              </Button>
            ) : null}
            {detail.status === "ARCHIVED" ? (
              <Button variant="outline" size="sm" onClick={() => setDialog("reactivate")}>
                Reativar
              </Button>
            ) : null}
            {/* Publicado também: quem decide é o backend (só sem uso em análise de chamada; com uso, 409 e o diálogo explica). */}
            <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDialog("delete")}>
              Excluir
            </Button>
          </div>
        ) : null}
      </div>

      {editing ? (
        <>
          {hasDraft ? (
            <p className="text-sm text-muted-foreground">
              Você está editando o rascunho v{detail.draft!.version}.{detail.currentVersion !== null ? ` A versão v${detail.currentVersion} continua valendo até o rascunho ser publicado.` : " Ele só passa a valer depois de publicado."}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Ao salvar, as alterações viram um rascunho. A versão vigente continua valendo até o rascunho ser publicado.</p>
          )}
          <HeaderFields
            value={header}
            onChange={setHeader}
            teams={teamsQuery.data}
            scopeOptions={scopeOptionsQuery.data}
            currentAreaName={detail.businessDomainName}
            scopeLockedLabel={detail.everPublished ? scopeLabel(detail) : null}
          />
          <ArgumentScriptContentFields value={content} onChange={setContent} knowledgeDocuments={knowledge.documents} knowledgeUnavailable={knowledge.unavailable} currentSourceTitle={base?.sourceDocumentTitle ?? null} />
        </>
      ) : (
        <>
          {detail.canEdit ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3">
              <p className="text-sm text-muted-foreground">
                {detail.current ? "Versão publicada (somente leitura). Para mudar, crie um rascunho: a versão vigente continua valendo até ele ser publicado." : "Este argumentário não tem rascunho nem versão publicada. Crie um rascunho para preenchê-lo."}
              </p>
              <Button size="sm" onClick={() => setEditRequested(true)}>
                <Pencil data-icon="inline-start" /> Editar (criar rascunho)
              </Button>
            </div>
          ) : null}
          {viewVersion ? (
            <ArgumentScriptContentView content={viewVersion.content} sourceDocumentTitle={viewVersion.sourceDocumentTitle} sourceReference={viewVersion.sourceReference} />
          ) : (
            <p className="text-sm text-muted-foreground">Este argumentário ainda não tem conteúdo.</p>
          )}
        </>
      )}

      {editing && hasDraft && issues.length > 0 ? (
        <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive" role="alert" data-testid="argument-script-issues">
          <p className="font-medium">Antes de publicar:</p>
          <ul className="list-disc pl-5">
            {issues.map((issue, index) => (
              <li key={`${issue.field}-${index}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {editing ? (
        <div className="space-y-2">
          {updateMutation.isError ? <p className="text-sm text-destructive">{updateMutation.error.message}</p> : null}
          {dirty ? <p className="text-xs text-muted-foreground">Alterações não salvas.</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            {hasDraft ? (
              <Button variant="ghost" onClick={() => setDialog("discard")}>
                Descartar rascunho
              </Button>
            ) : (
              <Button variant="ghost" onClick={cancelEditing}>
                Cancelar
              </Button>
            )}
            <Button variant="outline" disabled={!dirty || !canSave || updateMutation.isPending} onClick={handleSave}>
              {updateMutation.isPending ? "Salvando..." : "Salvar rascunho"}
            </Button>
            {hasDraft ? (
              <Button disabled={publishBlockedReason !== null} onClick={() => setDialog("publish")}>
                Publicar…
              </Button>
            ) : null}
          </div>
          {publishBlockedReason ? <p className="text-right text-xs text-muted-foreground">{publishBlockedReason}</p> : null}
        </div>
      ) : null}

      <VersionHistory history={detail.history} now={initial.now} />

      <PublishDialog detail={detail} open={dialog === "publish"} onOpenChange={(open) => setDialog(open ? "publish" : null)} />
      {dialog && dialog !== "publish" ? (
        <ArgumentScriptLifecycleDialog target={{ id: detail.id, name: detail.name, hasDraft: detail.draft !== null }} action={dialog} onClose={() => setDialog(null)} onDeleted={onDeleted} />
      ) : null}
    </div>
  )
}

function VersionHistory({ history, now }: { history: ArgumentScriptVersion[]; now: number }) {
  return (
    <section className="space-y-2" data-testid="argument-script-versions">
      <h3 className="text-sm font-semibold">Versões</h3>
      {history.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma versão publicada ainda.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Versão</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Vigência</TableHead>
                <TableHead>Publicada por</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((version) => (
                <TableRow key={version.id}>
                  <TableCell className="font-medium">v{version.version}</TableCell>
                  <TableCell>{versionSituation(version, now)}</TableCell>
                  <TableCell className="text-sm">
                    {formatDateTime(version.effectiveFrom)} → {version.effectiveUntil ? formatDateTime(version.effectiveUntil) : "sem data de fim"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {version.publishedByName ?? "—"} · {formatDateTime(version.publishedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Versões publicadas não mudam. Cada chamada é avaliada pela versão que valia no momento dela.</p>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// Publicar
// ---------------------------------------------------------------------------------------------

const issuesDetailsSchema = z.object({ issues: z.array(z.object({ message: z.string() })) })

function PublishDialog({ detail, open, onOpenChange }: { detail: ArgumentScriptDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open ? <PublishForm detail={detail} onDone={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  )
}

function PublishForm({ detail, onDone }: { detail: ArgumentScriptDetail; onDone: () => void }) {
  const publishMutation = usePublishArgumentScriptMutation()
  const [when, setWhen] = useState<"now" | "scheduled">("now")
  const [startAt, setStartAt] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])

  async function handlePublish() {
    setError(null)
    setIssues([])
    let effectiveFrom: string | undefined
    if (when === "scheduled") {
      const date = new Date(startAt)
      if (!startAt || Number.isNaN(date.getTime())) {
        setError("Informe a data e a hora em que o argumentário começa a valer.")
        return
      }
      if (date.getTime() < Date.now()) {
        setError("A vigência não pode começar no passado: um argumentário nunca vale para chamadas anteriores ao início dele.")
        return
      }
      effectiveFrom = date.toISOString()
    }
    try {
      await publishMutation.mutateAsync({ id: detail.id, effectiveFrom })
      onDone()
    } catch (caught) {
      if (caught instanceof AdminApiError && caught.code === "ARGUMENT_SCRIPT_NOT_READY") {
        const parsed = issuesDetailsSchema.safeParse(caught.details)
        setIssues(parsed.success ? parsed.data.issues.map((issue) => issue.message) : [])
        setError(caught.message)
      } else {
        setError(caught instanceof Error ? caught.message : "Não foi possível publicar.")
      }
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Publicar a versão v{detail.draft?.version}?</DialogTitle>
        <DialogDescription>
          A partir do início da vigência, este argumentário passa a valer para as chamadas de {detail.scopeType === "ALL_TEAMS" ? "todos os grupos" : scopeLabel(detail)}.
          {detail.currentVersion !== null ? ` A versão v${detail.currentVersion} deixa de valer quando esta começar.` : ""}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <RadioGroup value={when} onValueChange={(value) => setWhen(value as "now" | "scheduled")} aria-label="Quando começa a valer">
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="now" id="publish-now" />
            <span>Agora</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="scheduled" id="publish-scheduled" />
            <span>Em uma data e hora específicas</span>
          </label>
        </RadioGroup>
        {when === "scheduled" ? (
          <div className="space-y-1.5">
            <Label htmlFor="publish-start-at">Começa a valer em</Label>
            <Input id="publish-start-at" type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} />
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">Um argumentário nunca vale para chamadas anteriores ao início da vigência. Publicar administra o conteúdo do argumentário — não aprova feedbacks.</p>
        {error ? (
          <div role="alert" className="space-y-1 text-sm text-destructive">
            <p>{error}</p>
            {issues.length > 0 ? (
              <ul className="list-disc pl-5">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button disabled={publishMutation.isPending} onClick={handlePublish}>
          {publishMutation.isPending ? "Publicando..." : "Publicar"}
        </Button>
      </DialogFooter>
    </>
  )
}
