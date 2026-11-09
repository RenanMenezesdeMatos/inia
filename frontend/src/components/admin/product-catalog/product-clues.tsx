"use client"

import { useState } from "react"
import { ChevronRight, History, Plus } from "lucide-react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { AdminApiError } from "@/lib/admin/admin-api"
import { formatDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import {
  useApproveIdentificationCriterionMutation,
  useArchiveIdentificationCriterionMutation,
  useCreateIdentificationCriterionMutation,
  useDeleteIdentificationCriterionMutation,
  useDiscardIdentificationDraftMutation,
  useIdentificationCriterionQuery,
  useReactivateIdentificationCriterionMutation,
  useUpdateIdentificationCriterionMutation,
} from "@/queries/admin/use-product-catalog-queries"
import { CRITERION_SITUATION_LABEL, STRENGTH_LABEL, type CriterionContent, type CriterionVersion, type IdentificationCriterionSummary, type ProductNode, type ProductScopeSource } from "@/schemas/admin/product-catalog.schema"

import { cluesOf, shownVersionOf } from "./catalog-relations"
import { NodePicker, nodeLabel } from "./node-picker"
import { RESTORE_NOTE } from "@/lib/admin/logical-delete"

const NO_DOCUMENT = "__none__"
const emptyClue = (targetNodeIds: string[]): CriterionContent => ({ statement: "", targetNodeIds, context: null, limitations: null, strength: "INDICATIVE", conclusiveWhen: null, sourceDocumentId: null, sourceReference: null })

/** Nome curto do indício (aparece na lista), tirado do próprio texto: a primeira frase, até 80 caracteres. */
export function clueTitleFrom(statement: string): string {
  const first = statement.trim().split(/(?<=[.!?])\s/u)[0]?.replace(/[.!?]+$/u, "").trim() ?? ""
  return first.length > 80 ? `${first.slice(0, 79).trimEnd()}…` : first
}

/** O que falta para o indício poder valer — a mesma regra do backend (que continua sendo a autoridade), dita antes do clique. */
export function clueMissing(content: CriterionContent): string[] {
  return [
    ...(content.statement.trim().length < 5 ? ["o que aparece na chamada"] : []),
    ...(content.targetNodeIds.length === 0 ? ["qual produto ele indica"] : []),
    ...(content.strength === "CONCLUSIVE" && !content.conclusiveWhen?.trim() ? ["quando ele confirma"] : []),
    ...(!content.sourceDocumentId && !content.sourceReference?.trim() ? ["de onde vem"] : []),
  ]
}

function SituationBadge({ version }: { version: CriterionVersion | null }) {
  if (!version) return <Badge variant="outline">Rascunho</Badge>
  return <Badge variant={version.situation === "IN_FORCE" ? "secondary" : "outline"}>{CRITERION_SITUATION_LABEL[version.situation]}</Badge>
}

/**
 * O indício, enxuto: o que aparece na chamada, se confirma o produto (e quando) ou só sugere, e de onde vem. O resto (outros produtos,
 * situação, exceções, documento da base, nome na lista, data de início) fica em "Mais detalhes". Nada aqui vira regra executável — é o
 * que a análise da chamada LÊ.
 */
function ClueFields({ value, onChange, nodes, documents, idPrefix, title, onTitleChange, effectiveFrom, onEffectiveFromChange }: {
  value: CriterionContent
  onChange: (next: CriterionContent) => void
  nodes: readonly ProductNode[]
  documents: readonly ProductScopeSource[]
  idPrefix: string
  title?: string
  onTitleChange?: (title: string) => void
  effectiveFrom?: string
  onEffectiveFromChange?: (value: string) => void
}) {
  const set = (patch: Partial<CriterionContent>) => onChange({ ...value, ...patch })
  const [details, setDetails] = useState(false)
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-statement`}>O que aparece na chamada *</Label>
        <Textarea id={`${idPrefix}-statement`} rows={2} maxLength={2000} value={value.statement} onChange={(event) => set({ statement: event.target.value })} placeholder="Ex.: a conta do cliente começa com 899." />
        <p className="text-xs text-muted-foreground">Indica: {value.targetNodeIds.map((id) => nodeLabel(nodes, id)).join(", ") || "nenhum produto"}</p>
      </div>
      <RadioGroup value={value.strength} onValueChange={(strength) => set({ strength: strength as CriterionContent["strength"] })} className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-start gap-2 rounded-md border bg-background p-3 text-sm">
          <RadioGroupItem value="CONCLUSIVE" aria-label="Confirma o produto" />
          <span>
            <span className="font-medium">Confirma o produto</span>
            <span className="block text-xs text-muted-foreground">Sozinho, basta para saber o produto.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 rounded-md border bg-background p-3 text-sm">
          <RadioGroupItem value="INDICATIVE" aria-label="Apenas sugere" />
          <span>
            <span className="font-medium">Apenas sugere</span>
            <span className="block text-xs text-muted-foreground">Ajuda, mas sozinho não decide.</span>
          </span>
        </label>
      </RadioGroup>
      {value.strength === "CONCLUSIVE" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-conclusive`}>Confirma quando *</Label>
          <Input id={`${idPrefix}-conclusive`} maxLength={2000} value={value.conclusiveWhen ?? ""} onChange={(event) => set({ conclusiveWhen: event.target.value || null })} placeholder="Ex.: a conta é a do próprio pedido e o começo está legível." />
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-reference`}>De onde vem *</Label>
        <Input id={`${idPrefix}-reference`} maxLength={500} value={value.sourceReference ?? ""} onChange={(event) => set({ sourceReference: event.target.value || null })} placeholder="Ex.: comunicado de outubro, norma interna, planilha da operação" />
      </div>
      <Collapsible open={details} onOpenChange={setDetails}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="-ml-2">
            <ChevronRight className={cn("size-4 transition-transform", details && "rotate-90")} /> Mais detalhes
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-4 rounded-md border bg-background p-3">
          <div className="space-y-1.5">
            <Label>Indica qual produto</Label>
            <p className="text-xs text-muted-foreground">Marque mais de um quando o indício só diz que é “um destes”, ou a categoria inteira.</p>
            <NodePicker nodes={nodes} value={value.targetNodeIds} onChange={(targetNodeIds) => set({ targetNodeIds })} idPrefix={`${idPrefix}-target`} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-context`}>Em que situação vale</Label>
              <Textarea id={`${idPrefix}-context`} rows={2} maxLength={2000} value={value.context ?? ""} onChange={(event) => set({ context: event.target.value || null })} placeholder="Ex.: quando a conta citada é a do pedido." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-limitations`}>Exceções e cuidados</Label>
              <Textarea id={`${idPrefix}-limitations`} rows={2} maxLength={2000} value={value.limitations ?? ""} onChange={(event) => set({ limitations: event.target.value || null })} placeholder="Ex.: contas migradas mantêm o número antigo." />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-document`}>Documento da base (opcional)</Label>
              <Select value={value.sourceDocumentId ?? NO_DOCUMENT} onValueChange={(id) => set({ sourceDocumentId: id === NO_DOCUMENT ? null : id })}>
                <SelectTrigger id={`${idPrefix}-document`} aria-label="Documento de origem">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DOCUMENT}>Nenhum documento</SelectItem>
                  {documents.map((document) => (
                    <SelectItem key={document.sourceId} value={document.sourceId}>
                      {document.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {onTitleChange ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${idPrefix}-title`}>Nome na lista</Label>
                <Input id={`${idPrefix}-title`} maxLength={160} value={title ?? ""} onChange={(event) => onTitleChange(event.target.value)} />
              </div>
            ) : null}
            {onEffectiveFromChange ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${idPrefix}-effective`}>Começa a valer em (opcional)</Label>
                <Input id={`${idPrefix}-effective`} type="datetime-local" value={effectiveFrom ?? ""} onChange={(event) => onEffectiveFromChange(event.target.value)} />
              </div>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function MissingHint({ missing }: { missing: string[] }) {
  if (missing.length === 0) return null
  return <p className="text-xs text-muted-foreground">Para usar, falta: {missing.join(", ")}.</p>
}

function IssuesList({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-destructive" aria-label="O que falta para usar">
      {issues.map((issue) => (
        <li key={issue}>{issue}</li>
      ))}
    </ul>
  )
}

const issuesOf = (error: unknown) => (error instanceof AdminApiError && error.code === "PRODUCT_CRITERION_NOT_READY" ? ((error.details as { issues?: string[] } | undefined)?.issues ?? []) : [])

function VersionHistory({ versions, nodes }: { versions: readonly CriterionVersion[]; nodes: readonly ProductNode[] }) {
  return (
    <ol className="space-y-2" aria-label="Versões do indício">
      {versions.map((version) => (
        <li key={version.id} className="rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Versão {version.version}</span>
            <SituationBadge version={version} />
            <Badge variant="outline">{STRENGTH_LABEL[version.content.strength]}</Badge>
            {version.effectiveFrom ? (
              <span className="text-xs text-muted-foreground">
                vale de {formatDateTime(version.effectiveFrom)}
                {version.effectiveUntil ? ` até ${formatDateTime(version.effectiveUntil)}` : ""}
                {version.approvedByName ? ` · aprovado por ${version.approvedByName}` : ""}
              </span>
            ) : null}
          </div>
          <p className="mt-1">{version.content.statement || "—"}</p>
          <p className="text-xs text-muted-foreground">Indica: {version.content.targetNodeIds.map((id) => nodeLabel(nodes, id)).join(", ") || "—"}</p>
        </li>
      ))}
    </ol>
  )
}

/**
 * Indício existente: edita no próprio lugar e "Salvar e usar" grava e põe em uso de uma vez (nunca antes de agora; a versão em uso
 * continua valendo até lá). Rascunho, encerrar, reativar e excluir ficam como ações secundárias; as versões, recolhidas.
 */
function ClueEditor({ id, nodes, documents, initialIssues = [], onClose }: { id: string; nodes: readonly ProductNode[]; documents: readonly ProductScopeSource[]; initialIssues?: string[]; onClose: () => void }) {
  const criterionQuery = useIdentificationCriterionQuery(id)
  const update = useUpdateIdentificationCriterionMutation()
  const approve = useApproveIdentificationCriterionMutation()
  const discard = useDiscardIdentificationDraftMutation()
  const archive = useArchiveIdentificationCriterionMutation()
  const reactivate = useReactivateIdentificationCriterionMutation()
  const remove = useDeleteIdentificationCriterionMutation()
  const [title, setTitle] = useState<string | null>(null)
  const [content, setContent] = useState<CriterionContent | null>(null)
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [showHistory, setShowHistory] = useState(false)
  if (criterionQuery.isPending) return <Skeleton className="h-48 w-full" />
  if (criterionQuery.isError) return <p className="text-sm text-destructive">Não foi possível carregar o indício.</p>
  const criterion = criterionQuery.data
  const draft = criterion.versions.find((version) => version.status === "DRAFT") ?? null
  const latest = criterion.versions.find((version) => version.status !== "DRAFT") ?? null
  const editing = content ?? draft?.content ?? latest?.content ?? emptyClue([])
  const edited = title !== null || content !== null
  const archived = criterion.status === "ARCHIVED"
  const issues = approve.isError ? issuesOf(approve.error) : initialIssues
  const missing = clueMissing(editing)
  const busy = update.isPending || approve.isPending

  async function saveDraft() {
    await update.mutateAsync({ id, ...(title !== null ? { title } : {}), ...(content !== null ? { content } : {}) })
    setContent(null)
    setTitle(null)
  }

  async function saveAndUse() {
    try {
      if (edited) await saveDraft()
      await approve.mutateAsync({ id, effectiveFrom: effectiveFrom ? new Date(effectiveFrom).toISOString() : null })
      onClose()
    } catch {
      // pendências do backend mostradas abaixo
    }
  }

  return (
    <div className="space-y-4 rounded-md border bg-muted/20 p-4" data-testid="clue-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{criterion.title}</span>
          {archived ? <Badge variant="outline">Encerrado</Badge> : <SituationBadge version={latest} />}
          {draft && latest ? <Badge variant="outline">Alteração não usada ainda</Badge> : null}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Fechar
        </Button>
      </div>
      {archived ? (
        <p className="text-sm text-muted-foreground">Indício encerrado: não vale para chamadas novas. As análises anteriores continuam com a versão da época.</p>
      ) : (
        <>
          {latest ? <p className="text-xs text-muted-foreground">A versão em uso continua valendo até você usar a nova.</p> : null}
          <ClueFields value={editing} onChange={setContent} nodes={nodes} documents={documents} idPrefix={`clue-${id}`} title={title ?? criterion.title} onTitleChange={setTitle} effectiveFrom={effectiveFrom} onEffectiveFromChange={setEffectiveFrom} />
        </>
      )}
      <IssuesList issues={issues} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div className="flex flex-wrap items-center gap-2">
          {archived ? (
            <Button variant="outline" disabled={reactivate.isPending} onClick={() => reactivate.mutate(id)}>
              Reativar a partir de agora
            </Button>
          ) : (
            <>
              <Button disabled={busy || missing.length > 0 || (!edited && !draft)} onClick={saveAndUse}>
                {busy ? "Salvando..." : "Salvar e usar"}
              </Button>
              <Button variant="outline" disabled={busy || !edited} onClick={() => void saveDraft().catch(() => undefined)}>
                Salvar rascunho
              </Button>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {!archived && draft && latest ? (
            <Button variant="ghost" size="sm" disabled={discard.isPending} onClick={() => discard.mutate(id)}>
              Descartar alteração
            </Button>
          ) : null}
          {!archived && latest ? (
            <Button variant="ghost" size="sm" disabled={archive.isPending} onClick={() => archive.mutate(id)}>
              Encerrar
            </Button>
          ) : null}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-destructive">
                Excluir
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir o indício?</AlertDialogTitle>
                <AlertDialogDescription>{criterion.usedByAnalyses ? `Ele deixa de valer e sai das telas. As análises que já o usaram não mudam. ${RESTORE_NOTE}` : `Nenhuma análise usou este indício. Ele deixa de valer e sai das telas. ${RESTORE_NOTE}`}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <Button
                  variant="destructive"
                  disabled={criterion.usedByAnalyses || remove.isPending}
                  onClick={async () => {
                    try {
                      await remove.mutateAsync(id)
                      onClose()
                    } catch {
                      // 409 do backend já avisado
                    }
                  }}
                >
                  Excluir
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      {!archived ? <MissingHint missing={missing} /> : null}
      {criterion.versions.length > 0 ? (
        <Collapsible open={showHistory} onOpenChange={setShowHistory}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="-ml-2">
              <History className="size-4" /> Versões ({criterion.versions.length})
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <VersionHistory versions={criterion.versions} nodes={nodes} />
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}

/** Indício novo em um passo: "Salvar e usar" cria e põe em uso; "Salvar como rascunho" guarda para terminar depois. */
function NewClueForm({ nodes, documents, targetNodeIds, onDone, onNeedsAttention }: { nodes: readonly ProductNode[]; documents: readonly ProductScopeSource[]; targetNodeIds: string[]; onDone: () => void; onNeedsAttention: (id: string, issues: string[]) => void }) {
  const create = useCreateIdentificationCriterionMutation()
  const approve = useApproveIdentificationCriterionMutation()
  const [content, setContent] = useState<CriterionContent>(() => emptyClue(targetNodeIds))
  const missing = clueMissing(content)
  const busy = create.isPending || approve.isPending

  async function save(use: boolean) {
    let id: string | null = null
    try {
      id = (await create.mutateAsync({ title: clueTitleFrom(content.statement), content })).id
      if (use) await approve.mutateAsync({ id, effectiveFrom: null })
      onDone()
    } catch (error) {
      // Criado mas não pôde ser usado: abre o indício (rascunho) com o que falta.
      if (id) onNeedsAttention(id, issuesOf(error))
    }
  }

  return (
    <div className="space-y-4 rounded-md border bg-muted/20 p-4" data-testid="clue-new">
      <ClueFields value={content} onChange={setContent} nodes={nodes} documents={documents} idPrefix="clue-new" />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button variant="outline" disabled={busy || content.statement.trim().length < 5} onClick={() => save(false)}>
          Salvar como rascunho
        </Button>
        <Button disabled={busy || missing.length > 0} onClick={() => save(true)}>
          {busy ? "Salvando..." : "Salvar e usar"}
        </Button>
      </div>
      <MissingHint missing={missing} />
    </div>
  )
}

/**
 * "Como reconhecer na chamada": os indícios que apontam para o item (ou para a categoria dele). Indício de vários produtos aparece em
 * cada um, com "pode indicar também". Criar daqui já marca o item.
 */
export function ProductClues({ node, nodes, criteria, sources }: { node: ProductNode; nodes: readonly ProductNode[]; criteria: readonly IdentificationCriterionSummary[]; sources: readonly ProductScopeSource[] }) {
  const [open, setOpen] = useState<{ id: string | "new"; issues?: string[] } | null>(null)
  const clues = cluesOf(nodes, criteria, node.id)
  const documents = sources.filter((source) => source.sourceKind === "KNOWLEDGE_DOCUMENT")
  const noun = node.kind === "FAMILY" ? "a categoria" : "o produto"
  return (
    <section className="space-y-3" aria-label="Como reconhecer na chamada" data-testid="product-clues">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Como reconhecer na chamada</h3>
          <p className="max-w-2xl text-xs text-muted-foreground">Indícios que mostram que o pedido é {node.kind === "FAMILY" ? "desta categoria" : "deste produto"} — por exemplo, o começo do número da conta.</p>
        </div>
        {open === null ? (
          <Button size="sm" variant="outline" onClick={() => setOpen({ id: "new" })}>
            <Plus /> Novo indício
          </Button>
        ) : null}
      </div>
      {open?.id === "new" ? <NewClueForm nodes={nodes} documents={documents} targetNodeIds={[node.id]} onDone={() => setOpen(null)} onNeedsAttention={(id, issues) => setOpen({ id, issues })} /> : null}
      {open !== null && open.id !== "new" ? <ClueEditor key={open.id} id={open.id} nodes={nodes} documents={documents} initialIssues={open.issues} onClose={() => setOpen(null)} /> : null}
      {clues.length === 0 && open === null ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Nenhum indício ainda. Sem indício, a INIA reconhece {noun} pelo nome e por como chamam{node.description ? ` (${node.description})` : ""}.
        </p>
      ) : null}
      <ul className="space-y-2">
        {clues.map(({ criterion, via, others }) => {
          const shown = shownVersionOf(criterion)
          return (
            <li key={criterion.id}>
              <button type="button" onClick={() => setOpen({ id: criterion.id })} className="w-full rounded-md border p-3 text-left transition-colors hover:bg-muted/50" data-testid={`clue-row-${criterion.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{criterion.title}</span>
                  {criterion.status === "ARCHIVED" ? <Badge variant="outline">Encerrado</Badge> : <SituationBadge version={criterion.current} />}
                  {criterion.draft && criterion.current ? <Badge variant="outline">Alteração não usada ainda</Badge> : null}
                  {shown ? <Badge variant="outline">{STRENGTH_LABEL[shown.content.strength]}</Badge> : null}
                </div>
                {shown?.content.statement ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{shown.content.statement}</p> : null}
                {via ? <p className="mt-1 text-xs text-muted-foreground">Indica a categoria {via.name} (não o produto exato).</p> : null}
                {others.length > 0 ? <p className="mt-1 text-xs text-muted-foreground">Pode indicar também: {others.map((id) => nodeLabel(nodes, id)).join(", ")}.</p> : null}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
