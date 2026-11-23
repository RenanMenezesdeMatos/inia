"use client"

import { useState } from "react"
import { z } from "zod"
import { Pencil } from "lucide-react"

import { BackLink } from "@/components/ui/back-link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ErrorState } from "@/components/ui/states"

import { ProductScopeCard, ProductScopeField, productsCompatibleWith, useSourceProductScope } from "@/components/admin/product-catalog/product-scope-field"
import { UniverseSelect } from "@/components/operating-universe/universe-select"
import type { OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"
import { MultiOrgScopeField } from "@/components/admin/shared/multi-org-scope-field"
import { filterByUniverse, fitsUniverse, unitFitsUniverse } from "@/lib/operating-universe/hierarchy"
import { linksFromScopeValue, scopeValueAfterUniverseChange, scopeValueFromLinks, scopeValueIssue, type ScopeLinksValue } from "@/lib/scope-links/scope-links"
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
import { formatDateTime, scopeLabel, teamsForScope, validityLabel, versionSituation } from "./argument-script-format"

// ---------------------------------------------------------------------------------------------
// Cabeçalho: nome, área responsável (domínio de negócio) e escopo
// ---------------------------------------------------------------------------------------------

type HeaderState = { name: string; businessDomainId: string | null; scope: ScopeLinksValue }

function toScopeInput(scope: ScopeLinksValue): ArgumentScriptScopeInput {
  return scope.global ? { scopeType: "ALL_TEAMS", links: [] } : { scopeType: "GROUPS", links: linksFromScopeValue(scope) }
}

const scopeIsComplete = (scope: ScopeLinksValue) => scopeValueIssue(scope) === null

/**
 * Área responsável (domínio de negócio). Com o universo do argumentário, só oferece domínios dele (ou ainda sem universo) — o backend
 * recusa a mistura (`OPERATING_UNIVERSE_LINK_CONFLICT`). A área já salva e incompatível continua visível, marcada.
 */
function AreaSelect({ value, onChange, currentName, universe }: { value: string | null; onChange: (value: string) => void; currentName: string | null; universe: OperatingUniverse | null }) {
  const domainsQuery = useBusinessDomainsQuery()
  const options = filterByUniverse(domainsQuery.data ?? [], universe)
  const missing = value !== null && !options.some((domain) => domain.id === value)
  const missingDomain = (domainsQuery.data ?? []).find((domain) => domain.id === value)
  const missingOutsideUniverse = missing && missingDomain !== undefined && !fitsUniverse(missingDomain.operatingUniverse, universe)
  return (
    <div className="space-y-1.5">
      <Label htmlFor="argument-script-area">Área responsável *</Label>
      <Select value={value ?? ""} onValueChange={onChange} disabled={domainsQuery.isLoading}>
        <SelectTrigger id="argument-script-area" className="w-full">
          <SelectValue placeholder="Selecione a área" />
        </SelectTrigger>
        <SelectContent>
          {missing ? <SelectItem value={value!}>{missingDomain?.name ?? currentName ?? "Área atual"}{missingOutsideUniverse ? ` (outro universo: ${missingDomain?.operatingUniverse})` : ""}</SelectItem> : null}
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

function ScopeField({ value, onChange, teams, scopeOptions, universe, published }: { value: ScopeLinksValue; onChange: (value: ScopeLinksValue) => void; teams: Team[] | undefined; scopeOptions: ArgumentScriptScopeOptions | undefined; universe: OperatingUniverse | null; published?: boolean }) {
  if (!teams || !scopeOptions) return <Skeleton className="h-16 w-full" />
  return (
    <div className="space-y-1.5" data-testid="argument-script-scope">
      <MultiOrgScopeField
        permission="configuration.manage"
        value={value}
        onChange={onChange}
        allowGlobal={scopeOptions.allTeams || value.global}
        globalLabel="Todos os grupos"
        universe={universe}
        label="Escopo"
        hint={`Para quem o argumentário vale — vários Grupos, inteiros ou só alguns Subgrupos. Você só escolhe Grupos e Subgrupos que administra${universe ? `, do universo ${universe}` : ""}.`}
      />
      {published ? <p className="text-xs text-muted-foreground">Mudar o escopo vai para o rascunho e vale a partir da publicação dele; as chamadas anteriores continuam avaliadas pelo escopo da versão da época.</p> : null}
    </div>
  )
}

function HeaderFields({
  value,
  onChange,
  teams,
  scopeOptions,
  currentAreaName,
  scopePublished,
  universe,
  savedUniverse,
}: {
  value: HeaderState
  onChange: (value: HeaderState) => void
  teams: Team[] | undefined
  scopeOptions: ArgumentScriptScopeOptions | undefined
  currentAreaName: string | null
  scopePublished?: boolean
  /** Só na criação: o universo de atuação (o existente muda pela classificação do universo). */
  universe?: { value: OperatingUniverse | null; onChange: (value: OperatingUniverse | null) => void }
  /** Na edição: o universo já classificado do argumentário — só para encadear área e escopo. */
  savedUniverse?: OperatingUniverse | null
}) {
  // Topo da hierarquia: universo → área (domínio) e escopo (Grupo → Subgrupo) só do mesmo universo.
  const effectiveUniverse = universe ? universe.value : (savedUniverse ?? null)
  return (
    <div className="space-y-4 rounded-lg border p-4">
      {universe ? (
        <div className="space-y-1.5">
          <Label htmlFor="argument-script-universe">Universo de atuação *</Label>
          <UniverseSelect id="argument-script-universe" value={universe.value} onChange={universe.onChange} aria-describedby="argument-script-universe-help" />
          <p id="argument-script-universe-help" className="text-xs text-muted-foreground">Universos são separados: este recurso só será usado no universo escolhido.</p>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="argument-script-name">Nome *</Label>
          <Input id="argument-script-name" value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} maxLength={160} placeholder="Ex.: Retenção por preço" />
        </div>
        <AreaSelect value={value.businessDomainId} onChange={(businessDomainId) => onChange({ ...value, businessDomainId })} currentName={currentAreaName} universe={effectiveUniverse} />
      </div>
      <ScopeField value={value.scope} onChange={(scope) => onChange({ ...value, scope })} teams={teams} scopeOptions={scopeOptions} published={scopePublished} universe={effectiveUniverse} />
    </div>
  )
}

/** Bases para "Base de origem": só as do universo do argumentário (ou ainda sem universo); a já escolhida o formulário mostra mesmo assim. */
function useKnowledgeOptions(universe: OperatingUniverse | null) {
  const knowledgeQuery = useKnowledgeDocumentsQuery()
  return { documents: knowledgeQuery.data ? filterByUniverse(knowledgeQuery.data, universe) : undefined, unavailable: knowledgeQuery.isError }
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
  const [header, setHeader] = useState<HeaderState>(() => ({ name: "", businessDomainId: null, scope: { global: scopeOptions.allTeams, groups: [] } }))
  const [content, setContent] = useState<ContentFormState>(EMPTY_CONTENT_FORM)
  const productScope = useSourceProductScope("ARGUMENT_SCRIPT", null)
  const [operatingUniverse, setOperatingUniverse] = useState<OperatingUniverse | null>(null)
  const knowledge = useKnowledgeOptions(operatingUniverse)
  const domainsQuery = useBusinessDomainsQuery()
  const allKnowledge = useKnowledgeDocumentsQuery().data

  // Trocou o universo: o que já estava escolhido e é de outro universo sai da escolha (universos não se misturam) — área, escopo
  // (Grupo/Subgrupo), base de origem e produtos.
  function handleUniverseChange(next: OperatingUniverse | null) {
    setOperatingUniverse(next)
    setHeader((current) => {
      const domain = (domainsQuery.data ?? []).find((candidate) => candidate.id === current.businessDomainId)
      return {
        ...current,
        businessDomainId: domain && !fitsUniverse(domain.operatingUniverse, next) ? null : current.businessDomainId,
        scope: scopeValueAfterUniverseChange(current.scope, teamsForScope(teams, scopeOptions), (unit) => unitFitsUniverse(unit, next)),
      }
    })
    const source = (allKnowledge ?? []).find((document) => document.id === content.sourceDocumentId)
    if (source && !fitsUniverse(source.operatingUniverse, next)) setContent((current) => ({ ...current, sourceDocumentId: null }))
    const compatible = new Set(productsCompatibleWith(productScope.nodes, next).map((node) => node.id))
    if (productScope.value.some((id) => !compatible.has(id))) productScope.setValue(productScope.value.filter((id) => compatible.has(id)))
  }

  const canSubmit = header.name.trim().length >= 3 && header.businessDomainId !== null && scopeIsComplete(header.scope) && operatingUniverse !== null

  async function handleCreate() {
    if (!header.businessDomainId) return
    try {
      const created = await createMutation.mutateAsync({
        name: header.name.trim(),
        businessDomainId: header.businessDomainId,
        scope: toScopeInput(header.scope),
        content: formToContent(content),
        ...formSource(content),
        ...(operatingUniverse ? { operatingUniverse } : {}),
      })
      await productScope.save(created.id).catch(() => undefined)
      onCreated(created.id)
    } catch {
      // erro exibido abaixo (e no toast)
    }
  }

  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-sm text-muted-foreground">O argumentário nasce como rascunho. Ele só passa a valer depois de publicado.</p>
      <HeaderFields value={header} onChange={setHeader} teams={teams} scopeOptions={scopeOptions} currentAreaName={null} universe={{ value: operatingUniverse, onChange: handleUniverseChange }} />
      <ArgumentScriptContentFields value={content} onChange={setContent} knowledgeDocuments={knowledge.documents} knowledgeUnavailable={knowledge.unavailable} />
      {productScope.available ? <ProductScopeField nodes={productScope.nodes} value={productScope.value} onChange={productScope.setValue} idPrefix="argument-script-products" universe={operatingUniverse} /> : null}
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
      <div className="space-y-3">
        <ErrorState message="Não foi possível carregar o argumentário." onRetry={() => void detailQuery.refetch()} />
        <Button variant="outline" size="sm" onClick={onBack}>
          Voltar para a lista
        </Button>
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
  const updateMutation = useUpdateArgumentScriptMutation()
  const knowledge = useKnowledgeOptions(detail.operatingUniverse ?? null)

  // Edição parte do rascunho (ou da vigente, quando o rascunho ainda vai nascer); a leitura mostra o que vale hoje.
  const base: ArgumentScriptVersion | null = detail.draft ?? detail.current
  const viewVersion: ArgumentScriptVersion | null = detail.current ?? detail.draft
  const [initial] = useState(() => {
    const header: HeaderState = { name: detail.name, businessDomainId: detail.businessDomainId, scope: scopeValueFromLinks((detail.draftScope ?? { scopeType: detail.scopeType, links: detail.scopeLinks }).links, (detail.draftScope ?? detail).scopeType === "ALL_TEAMS") }
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
          // Escopo (223) também depois de publicado: vai para o rascunho e vale a partir da publicação dele.
          ...(JSON.stringify(toScopeInput(header.scope)) === JSON.stringify(toScopeInput(initial.header.scope)) ? {} : { scope: toScopeInput(header.scope) }),
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
      <BackLink onClick={onBack} label="Argumentários" />

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

      {/* Para quais produtos vale: vigência própria (vale a partir da mudança), fora do rascunho e da publicação. */}
      <ProductScopeCard kind="ARGUMENT_SCRIPT" sourceId={detail.id} canEdit={detail.canEdit} />

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
            scopePublished={detail.everPublished}
            savedUniverse={detail.operatingUniverse ?? null}
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
        <div className={TABLE_FRAME}>
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
