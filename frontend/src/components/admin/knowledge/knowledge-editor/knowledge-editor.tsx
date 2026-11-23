"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { EllipsisVertical, ExternalLink, FileUp, Loader2, PanelRightClose, PanelRightOpen, Paperclip, PenLine, Save, Send, SlidersHorizontal, Trash2, Upload } from "lucide-react"

import { productsCompatibleWith, useProductScopeLabels, useSourceProductScope } from "@/components/admin/product-catalog/product-scope-field"
import { scopeTeamOptionsOf } from "@/components/admin/shared/multi-org-scope-field"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { BackLink } from "@/components/ui/back-link"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SectionLabel, StatusChip, SURFACE_CARD, toneSurface, type Tone } from "@/components/ui/surface"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { KnowledgeReadingView } from "@/components/knowledge-reading/knowledge-reading-view"
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard"
import { canReadAsContent } from "@/lib/knowledge/document-inserts"
import { knowledgeVersionImageSrc } from "@/lib/knowledge/knowledge-image-src"
import { unitFitsUniverse } from "@/lib/operating-universe/hierarchy"
import { orgScopesFromValue, scopeReachSummary, scopeValueAfterUniverseChange, scopeValueFromOrgScopes, scopeValueIssue, scopeValueKey, type ScopeLinksValue } from "@/lib/scope-links/scope-links"
import { cn } from "@/lib/utils"
import { useTeamsQuery } from "@/queries/admin/use-org-structure-queries"
import { useCreateKnowledgeDocumentMutation, useKnowledgeSubjectsQuery, useReplaceKnowledgeDraftFileMutation, useUpdateKnowledgeDocumentMutation } from "@/queries/admin/use-knowledge-queries"
import { useCurrentUserQuery } from "@/queries/auth/use-current-user"
import { useSetKnowledgeUniverseMutation } from "@/queries/operating-universe/use-operating-universe"
import { DOCUMENT_TYPE_LABELS, isOcrReading, SOURCE_TYPE_LABELS, subjectScopesOf, type KnowledgeDocumentDetail, type KnowledgeDocumentType, type KnowledgeSubjectSelection } from "@/schemas/admin/knowledge.schema"
import type { OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"

import { DiscardKnowledgeDraftDialog, PublishKnowledgeDialog } from "../knowledge-lifecycle-dialogs"
import { formatFileSize, versionLabel } from "../knowledge-visuals"
import { KnowledgeRecentUploads } from "../knowledge-upload-progress/knowledge-recent-uploads"
import { KnowledgeUploadProgress } from "../knowledge-upload-progress/knowledge-upload-progress"
import { useTrackedUpload } from "../knowledge-upload-progress/use-tracked-upload"
import {
  ACCEPTED_FILES,
  draftFileOf,
  emptyKnowledgeForm,
  isFileDraft,
  KNOWLEDGE_LIST_HREF,
  knowledgeDetailHref,
  knowledgeEditHref,
  knowledgeEditorStateOf,
  knowledgeFormFingerprint,
  knowledgeFormIssue,
  knowledgeFormOf,
  MIN_CONTENT_LENGTH,
  type KnowledgeEditorForm,
  type KnowledgeEditorState,
} from "./knowledge-editor-form"
import { KnowledgePublicationSection, KnowledgeProductsSection, KnowledgeScopeSection, KnowledgeSubjectsSection, KnowledgeUniverseSection } from "./knowledge-editor-settings"
import { KnowledgeMarkdownField } from "./knowledge-markdown-field"
import { KnowledgePreviewDialog } from "./knowledge-preview-dialog"
import { KnowledgeAgentsPicker } from "../knowledge-agents/knowledge-agents-picker"
import { KnowledgeAgentsSection } from "../knowledge-agents/knowledge-agents-section"

const STATE_CHIP: Record<KnowledgeEditorState, { tone: Tone; label: (document: KnowledgeDocumentDetail | null) => string }> = {
  NEW: { tone: "neutral", label: () => "Nova base" },
  DRAFT: { tone: "warning", label: (document) => (document?.draft ? `Rascunho ${versionLabel(document.draft.version)}` : "Rascunho") },
  IN_USE: { tone: "success", label: (document) => (document?.inUse ? `Em uso: ${versionLabel(document.inUse.version)}` : "Em uso") },
  PROCESSING: { tone: "info", label: () => "Publicação em processamento" },
  FAILED: { tone: "danger", label: () => "Atualização com falha" },
  ARCHIVED: { tone: "neutral", label: () => "Arquivada" },
}

const failureMessage = (failure: unknown, fallback: string) => (failure instanceof Error && failure.message ? failure.message : fallback)
const subjectsKey = (selection: KnowledgeSubjectSelection) => `${selection.mode}:${[...selection.subjectIds].sort().join(",")}`

/**
 * EDITOR DA BASE DE CONHECIMENTO — criar ou editar, nos moldes do editor de Publicações: título e conteúdo em destaque; à direita (no
 * celular, na aba "Configurações") publicação, universo, alcance, assuntos e produtos. Ações: pré-visualizar (leitura e o que a IA
 * recebe), salvar rascunho (Ctrl/Cmd+S) e publicar (salva o rascunho e confirma). O conteúdo continua em Markdown (texto ou arquivo) e
 * a leitura é a mesma da base. Ciclo de versões (PEN-008): salvar nunca muda o que a IA usa; publicar só vale quando a versão fica
 * pronta. O servidor é a autoridade: alcance, assuntos, universo e permissão são conferidos lá.
 */
export function KnowledgeEditor({ document }: { document: KnowledgeDocumentDetail | null }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const teamsQuery = useTeamsQuery()
  const subjectsCatalog = useKnowledgeSubjectsQuery()
  const create = useCreateKnowledgeDocumentMutation()
  const update = useUpdateKnowledgeDocumentMutation()
  const replaceFile = useReplaceKnowledgeDraftFileMutation()
  const universeMutation = useSetKnowledgeUniverseMutation()
  const productScope = useSourceProductScope("KNOWLEDGE_DOCUMENT", document?.id ?? null)
  const productLabels = useProductScopeLabels("KNOWLEDGE_DOCUMENT")
  const universeEnforced = useCurrentUserQuery().data?.operatingUniverseEnforced ?? false
  const fileInputRef = useRef<HTMLInputElement>(null)
  const creating = document === null
  // Envio de arquivo com o andamento real (bytes do navegador, etapas do servidor). A requisição continua se a pessoa sair da tela.
  const tracked = useTrackedUpload()
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const teamOptions = useMemo(() => (teamsQuery.data ? scopeTeamOptionsOf(teamsQuery.data) : null), [teamsQuery.data])
  // Alcance de abertura resolvido com os Grupos carregados (Subgrupo antigo sem Grupo encontra o pai); base salva sem alcance = nenhum Grupo
  // (ausência nunca vira "todos os Grupos"). Enquanto a pessoa não mexe, vale o resolvido.
  const [rawOrgScopes] = useState(() => (document ? (document.editable?.config ? document.editable.config.orgScopes : document.orgScopes) : []))
  const openingScope = useMemo<ScopeLinksValue>(() => (creating ? { global: true, groups: [] } : rawOrgScopes.length ? scopeValueFromOrgScopes(rawOrgScopes, teamOptions ?? []) : { global: false, groups: [] }), [creating, rawOrgScopes, teamOptions])

  const [form, setForm] = useState<KnowledgeEditorForm>(() => (document ? knowledgeFormOf(document, { global: false, groups: [] }) : emptyKnowledgeForm()))
  const [baseline, setBaseline] = useState<KnowledgeEditorForm>(form)
  const [editedScope, setEditedScope] = useState<ScopeLinksValue | null>(null)
  const [savedScope, setSavedScope] = useState<ScopeLinksValue | null>(null)
  const scope = editedScope ?? savedScope ?? openingScope
  const baselineScope = savedScope ?? openingScope
  const [universe, setUniverse] = useState<OperatingUniverse | null>(document?.operatingUniverse ?? null)
  const [savedUniverse, setSavedUniverse] = useState<OperatingUniverse | null>(document?.operatingUniverse ?? null)
  const [file, setFile] = useState<File | null>(null)
  const [draftFile, setDraftFile] = useState(() => (document ? draftFileOf(document) : null))
  const [allowNoSubjects] = useState(() => form.subjects.mode === "NONE")
  const [error, setError] = useState("")
  const [universeError, setUniverseError] = useState<string | null>(null)
  const [mobilePanel, setMobilePanel] = useState<"write" | "settings">("write")
  // Telas grandes: a lateral recolhe numa faixa e o conteúdo ganha a largura (mesma transição do painel do Anjo). No celular vale a aba.
  const [settingsOpen, setSettingsOpen] = useState(true)
  const [dialog, setDialog] = useState<"publish" | "confirm-create-publish" | "discard" | null>(null)

  const dirty = knowledgeFormFingerprint({ ...form, scope }) !== knowledgeFormFingerprint({ ...baseline, scope: baselineScope }) || universe !== savedUniverse || productScope.changed || file !== null
  const guard = useUnsavedChangesGuard(dirty)
  const state = knowledgeEditorStateOf(document)
  const ocrReading = isOcrReading(document?.draft?.ocr ?? null)
  // O OCR termina com a tela aberta: o rascunho ganhou o texto lido (e o arquivo passou a ter texto), mas o formulário foi montado antes.
  // Durante a leitura o texto é só leitura, então trazer o novo não apaga nada digitado; se mesmo assim o texto mudou, fica o da pessoa.
  const wasOcrReading = useRef(ocrReading)
  useEffect(() => {
    const finished = wasOcrReading.current && !ocrReading
    wasOcrReading.current = ocrReading
    if (!finished || !document) return
    const text = document.editable?.content ?? ""
    setForm((current) => (current.content === baseline.content ? { ...current, content: text } : current))
    setBaseline((current) => ({ ...current, content: text }))
    setDraftFile(draftFileOf(document))
  }, [ocrReading, document, baseline.content])
  // "Visualizar" do rascunho de PDF convertido: o texto com os prints no lugar, como fica depois de publicar (sem isso, só se conferiam
  // os prints na base publicada). Texto editado continua valendo: a imagem entra no fim da linha onde estava (`imageInsertAt`).
  const draftExtraction = document?.editable && !document.editable.restricted && draftFile?.sourceType === "PDF" ? (document.editable.extraction ?? null) : null
  const draftVersionId = document?.editable?.versionId ?? null
  const draftImageSrc = useCallback((imageId: string) => (document && draftVersionId ? knowledgeVersionImageSrc(document.id, draftVersionId, imageId) : ""), [document, draftVersionId])
  const noPageJump = useCallback(() => undefined, [])
  const draftPreview = draftExtraction && canReadAsContent(form.content, draftExtraction)
    ? <KnowledgeReadingView content={form.content} extraction={draftExtraction} title={form.title} imageSrc={draftImageSrc} onOpenPage={noPageJump} />
    : undefined
  const pending = create.isPending || update.isPending || universeMutation.isPending || replaceFile.isPending || productScope.saving
  const fromFile = draftFile ? isFileDraft(draftFile) : false
  const issue = knowledgeFormIssue({ ...form, scope }, {
    creating,
    hasFile: file !== null,
    textRequired: draftFile?.textAvailable ?? true,
    scopeIssue: scopeValueIssue(scope),
    universeMissing: universeEnforced && universe === null,
  })

  const patch = (next: Partial<KnowledgeEditorForm>) => setForm((current) => ({ ...current, ...next }))

  // Hierarquia universo → Grupo → Subgrupo → produto: trocar o universo limpa o que deixou de caber.
  function changeUniverse(next: OperatingUniverse | null) {
    setUniverse(next)
    setUniverseError(null)
    setEditedScope(scopeValueAfterUniverseChange(scope, teamOptions ?? [], (unit) => unitFitsUniverse(unit, next)))
    const compatible = new Set(productsCompatibleWith(productScope.nodes, next).map((node) => node.id))
    if (productScope.value.some((id) => !compatible.has(id))) productScope.setValue(productScope.value.filter((id) => compatible.has(id)))
  }

  /** Grava (cria a base ou o rascunho). Devolve se deu certo; o erro fica escrito acima do editor. */
  async function save(intent: "DRAFT" | "PUBLISH"): Promise<boolean> {
    if (issue) {
      setError(issue)
      return false
    }
    setError("")
    if (creating) {
      const sending = form.sourceMode === "file" && file ? tracked.begin(file) : null
      try {
        const created = await create.mutateAsync({
          ...(sending ?? {}),
          operatingUniverse: universe,
          title: form.title.trim(),
          documentType: form.documentType,
          content: form.sourceMode === "text" ? form.content : undefined,
          file: form.sourceMode === "file" ? (file ?? undefined) : undefined,
          orgScopes: orgScopesFromValue(scope),
          subjectScopes: subjectScopesOf(form.subjects),
        })
        if (sending) tracked.settle()
        await productScope.save(created.id).catch(() => undefined)
        guard.release() // a navegação abaixo não pode disparar o aviso de "não salvo"
        // Quem saiu da tela durante o envio não é puxado de volta: a base aparece na lista, com o "Último envio de arquivo" dentro dela.
        if (mounted.current) router.replace(knowledgeEditHref(created.id, { publish: intent === "PUBLISH" }))
        return true
      } catch (failure) {
        if (sending) tracked.settle(failureMessage(failure, "Não foi possível criar a base."))
        setError(failureMessage(failure, "Não foi possível criar a base. Tente novamente."))
        return false
      }
    }
    const id = document.id
    try {
      // Universo primeiro: se ele criar vínculo com outro universo, nada mais é salvo e o motivo aparece no campo.
      if (universe !== savedUniverse) {
        try {
          await universeMutation.mutateAsync({ id, operatingUniverse: universe })
          setSavedUniverse(universe)
        } catch (failure) {
          setUniverseError(failureMessage(failure, "Não foi possível mudar o universo."))
          throw failure
        }
      }
      const hasText = form.content.trim().length > 0
      const summary = form.changeSummary.trim()
      const formChanged = knowledgeFormFingerprint({ ...form, scope }) !== knowledgeFormFingerprint({ ...baseline, scope: baselineScope })
      if (formChanged || productScope.changed) {
        await update.mutateAsync({
          id,
          input: {
            title: form.title.trim(),
            documentType: form.documentType,
            // Sem texto (arquivo sem extração) o campo fica de fora: a API exige um texto mínimo e o rascunho continua sem texto.
            ...(hasText && form.content !== baseline.content ? { content: form.content } : {}),
            // Alcance e assuntos só vão se a pessoa mudou: o que não foi mexido nunca é regravado.
            ...(scopeValueKey(scope) === scopeValueKey(baselineScope) ? {} : { orgScopes: orgScopesFromValue(scope) }),
            ...(subjectsKey(form.subjects) === subjectsKey(baseline.subjects) ? {} : { subjectScopes: subjectScopesOf(form.subjects) }),
            ...(summary ? { changeSummary: summary } : {}),
          },
        })
        await productScope.save(id)
      }
      setBaseline(form)
      setSavedScope(scope)
      setEditedScope(null)
      return true
    } catch (failure) {
      setError(failureMessage(failure, "Não foi possível salvar o rascunho. Tente novamente."))
      return false
    }
  }

  async function publish() {
    if (creating) return setDialog("confirm-create-publish")
    if (ocrReading) return setError("Espere a leitura das páginas digitalizadas (OCR) terminar e confira o texto antes de publicar.")
    if (dirty && !(await save("PUBLISH"))) return
    setDialog("publish")
  }

  // Base recém-criada por "Publicar": o editor abre já com a confirmação da publicação.
  const publishRequested = searchParams.get("publicar") === "1"
  const handledPublishRequest = useRef(false)
  useEffect(() => {
    if (!publishRequested || handledPublishRequest.current || !document?.draft) return
    handledPublishRequest.current = true
    router.replace(knowledgeEditHref(document.id))
    setDialog("publish")
  }, [publishRequested, document, router])

  // Ctrl/Cmd+S salva o rascunho.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        if (!pending && dirty) void save("DRAFT")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  async function handleReplaceFile(next: File) {
    if (!document) return
    const sending = tracked.begin(next)
    try {
      const updated = await replaceFile.mutateAsync({ id: document.id, file: next, ...sending })
      tracked.settle()
      const text = updated.editable?.content ?? ""
      setForm((current) => ({ ...current, content: text }))
      setBaseline((current) => ({ ...current, content: text }))
      setDraftFile(draftFileOf(updated))
    } catch (failure) {
      tracked.settle(failureMessage(failure, "Não foi possível trocar o arquivo."))
      setError(failureMessage(failure, "Não foi possível trocar o arquivo."))
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const subjectNames = (selection: KnowledgeSubjectSelection) => {
    if (selection.mode === "ALL") return "Todos os assuntos"
    if (selection.mode === "NONE" || selection.subjectIds.length === 0) return "Nenhum assunto"
    return selection.subjectIds.map((id) => subjectsCatalog.data?.items.find((subject) => subject.id === id)?.name ?? "Assunto removido").join(" · ")
  }
  const productNames = productScope.value.length === 0 ? "Todos os produtos" : productScope.value.map((id) => productScope.nodes.find((node) => node.id === id)?.name ?? "Produto removido").join(" · ")
  const previewSummary = {
    universe: universe ?? "Pendente de classificação",
    scope: scopeReachSummary(scope, teamOptions ?? [], "Todos os grupos"),
    subjects: subjectNames(form.subjects),
    products: productScope.available ? productNames : (document ? productLabels.labelsOf(document.id).join(" · ") || "Todos os produtos" : "Todos os produtos"),
  }

  const draftVersion = document?.draft && !document.draft.restricted ? document.draft : null
  const productsChanged = (() => {
    if (!document || !draftVersion) return false
    const draftProducts = draftVersion.config?.productNodeIds ?? document.inUseProductNodeIds
    return draftProducts.length !== document.inUseProductNodeIds.length || draftProducts.some((id) => !document.inUseProductNodeIds.includes(id))
  })()
  const saveStatus = pending ? "Salvando…" : dirty ? "Alterações não salvas" : draftVersion ? `Rascunho ${versionLabel(draftVersion.version)} salvo` : creating ? "Ainda não salva" : "Sem alterações"
  const chip = STATE_CHIP[state]
  const backHref = document ? knowledgeDetailHref(document.id) : KNOWLEDGE_LIST_HREF

  const settings = (
    <>
      <KnowledgePublicationSection document={document} changeSummary={form.changeSummary} onChangeSummary={(changeSummary) => patch({ changeSummary })} />
      <KnowledgeUniverseSection value={universe} onChange={changeUniverse} allowPending={!universeEnforced && (creating || document.operatingUniverse === null)} error={universeError} />
      <KnowledgeScopeSection teams={teamOptions} value={scope} onChange={setEditedScope} universe={universe} editing={!creating} />
      <KnowledgeSubjectsSection value={form.subjects} onChange={(subjects) => patch({ subjects })} allowNone={allowNoSubjects} />
      {productScope.available ? <KnowledgeProductsSection nodes={productScope.nodes} value={productScope.value} onChange={productScope.setValue} universe={universe} editing={!creating} /> : null}
      <KnowledgeAgentsSection documentId={document?.id ?? null} archived={Boolean(document?.archived)} />
    </>
  )

  return (
    <div className="space-y-4">
      <BackLink label={document ? "Base" : "Base de conhecimento"} onClick={() => guard.request(() => router.push(backHref))} />

      {/* Barra do editor: situação, salvamento e ações. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusChip tone={chip.tone}>{chip.label(document)}</StatusChip>
          <span className={cn("text-sm text-muted-foreground", dirty && "text-amber-700 dark:text-amber-400")} aria-live="polite">{saveStatus}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <KnowledgePreviewDialog
            title={form.title}
            documentType={form.documentType}
            content={form.content}
            fromFileName={creating && form.sourceMode === "file" ? (file?.name ?? "arquivo") : null}
            summary={previewSummary}
            saved={document}
            dirty={dirty}
          />
          <Button type="button" variant="outline" disabled={pending || (!creating && !dirty)} onClick={() => void save("DRAFT")}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}Salvar rascunho
          </Button>
          <Button type="button" disabled={pending || ocrReading || (!creating && !dirty && !draftVersion)} title={!creating && !dirty && !draftVersion ? "Não há rascunho para publicar" : undefined} onClick={() => void publish()}>
            <Send data-icon="inline-start" />Publicar
          </Button>
          {document ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" aria-label="Mais ações"><EllipsisVertical /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => guard.request(() => router.push(knowledgeDetailHref(document.id)))}><ExternalLink />Abrir a base</DropdownMenuItem>
                {draftVersion && draftVersion.version > 1 ? <DropdownMenuItem variant="destructive" onSelect={() => setDialog("discard")}><Trash2 />Descartar rascunho</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {document && !creating ? <p className="text-sm text-muted-foreground">{document.inUse ? `Salvar grava o rascunho e não muda o que a IA consulta: ela continua usando a ${versionLabel(document.inUse.version)} até o rascunho ser publicado e ficar pronto.` : document.archived ? "Salvar grava o rascunho e não reativa a base, que continua arquivada e fora de uso pela IA." : "Esta base ainda não tem versão em uso: salvar não a disponibiliza para a IA. Para isso, publique."}</p> : null}
      {error ? <p role="alert" className={cn(toneSurface("danger"), "px-4 py-3 text-sm")}>{error}</p> : null}

      {/* Celular: escrever e configurar em abas; desktop: as duas colunas. */}
      <Tabs value={mobilePanel} onValueChange={(value) => setMobilePanel(value as "write" | "settings")} className="lg:hidden">
        <TabsList className="w-full">
          <TabsTrigger value="write" className="flex-1"><PenLine />Conteúdo</TabsTrigger>
          <TabsTrigger value="settings" className="flex-1"><SlidersHorizontal />Configurações</TabsTrigger>
        </TabsList>
      </Tabs>

      <div
        className={cn(
          "grid gap-5 lg:transition-[grid-template-columns] lg:duration-300 lg:ease-out motion-reduce:lg:transition-none",
          settingsOpen ? "lg:grid-cols-[minmax(0,1fr)_22rem]" : "lg:grid-cols-[minmax(0,1fr)_3.25rem]",
        )}
        data-testid="knowledge-editor-columns"
      >
        <section aria-label="Conteúdo da base" className={cn(SURFACE_CARD, "min-w-0 space-y-5 px-4 py-4 sm:px-8 sm:py-6", mobilePanel !== "write" && "hidden lg:block")}>
          <div className="space-y-3">
            <textarea
              aria-label="Título da base"
              value={form.title}
              maxLength={200}
              rows={1}
              placeholder="Título da base"
              onChange={(event) => patch({ title: event.target.value.replace(/\n/g, " ") })}
              className="field-sizing-content w-full resize-none bg-transparent font-heading text-2xl leading-tight font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60 sm:text-3xl"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="knowledge-document-type" className="text-sm text-muted-foreground">Tipo</Label>
              <Select value={form.documentType} onValueChange={(value) => patch({ documentType: value as KnowledgeDocumentType })}>
                <SelectTrigger id="knowledge-document-type" className="w-auto min-w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {creating ? (
            <div className="space-y-3">
              <Tabs value={form.sourceMode} onValueChange={(value) => patch({ sourceMode: value as "text" | "file" })}>
                <TabsList>
                  <TabsTrigger value="text"><PenLine />Escrever em Markdown</TabsTrigger>
                  <TabsTrigger value="file"><FileUp />Enviar arquivo</TabsTrigger>
                </TabsList>
              </Tabs>
              {form.sourceMode === "text" ? (
                <KnowledgeMarkdownField id="knowledge-content" label="Conteúdo" title={form.title} value={form.content} onChange={(content) => patch({ content })} placeholder={"# Procedimento\n\n## Quando usar\n- ...\n\n## Passo a passo\n1. ..."} />
              ) : tracked.upload && (tracked.upload.waiting || tracked.run?.status !== "FAILED") && !tracked.upload.requestError ? (
                <KnowledgeUploadProgress filename={tracked.upload.filename} sizeBytes={tracked.upload.sizeBytes} transfer={tracked.upload.transfer} waiting={tracked.upload.waiting} run={tracked.run} requestError={null} />
              ) : (
                <div className="space-y-3">
                {tracked.upload ? <KnowledgeUploadProgress filename={tracked.upload.filename} sizeBytes={tracked.upload.sizeBytes} transfer={tracked.upload.transfer} waiting={tracked.upload.waiting} run={tracked.run} requestError={tracked.upload.requestError} /> : null}
                <div className="space-y-2 rounded-xl border border-dashed border-border p-5 text-center">
                  <FileUp className="mx-auto size-6 text-muted-foreground" aria-hidden />
                  <p className="text-sm font-medium">{file ? file.name : "Escolha o arquivo da base"}</p>
                  <p className="text-xs text-muted-foreground">{file ? `${formatFileSize(file.size) ?? ""} · o texto é extraído ao salvar e pode ser conferido e ajustado depois.` : "PDF, DOCX, TXT ou JSON. O texto é extraído ao salvar; PDF digitalizado passa pela leitura das páginas (OCR)."}</p>
                  <Input type="file" accept={ACCEPTED_FILES} aria-label="Arquivo da base" className="mx-auto max-w-sm" onChange={(event) => { setFile(event.target.files?.[0] ?? null); tracked.reset() }} />
                </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* O envio feito agora nesta tela; sem ele, o último envio de arquivo desta base (quem saiu e voltou vê o estado). */}
              {tracked.upload ? (
                <KnowledgeUploadProgress filename={tracked.upload.filename} sizeBytes={tracked.upload.sizeBytes} transfer={tracked.upload.transfer} waiting={tracked.upload.waiting} run={tracked.run} requestError={tracked.upload.requestError} />
              ) : (
                <KnowledgeRecentUploads documentId={document.id} />
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <p className="min-w-0 truncate text-sm">
                    {fromFile && draftFile ? <><span className="font-medium">{draftFile.filename ?? "Nome do arquivo não informado"}</span><span className="text-muted-foreground">{` · ${SOURCE_TYPE_LABELS[draftFile.sourceType]}${formatFileSize(draftFile.sizeBytes) ? ` · ${formatFileSize(draftFile.sizeBytes)}` : ""}`}</span></> : <span className="text-muted-foreground">Sem arquivo: o conteúdo é o texto abaixo.</span>}
                  </p>
                </div>
                <input ref={fileInputRef} type="file" aria-label="Arquivo novo para o rascunho" className="sr-only" tabIndex={-1} accept={ACCEPTED_FILES} onChange={(event) => { const next = event.target.files?.[0]; if (next) void handleReplaceFile(next) }} />
                <Button type="button" size="sm" variant="outline" disabled={replaceFile.isPending || ocrReading} onClick={() => fileInputRef.current?.click()}>
                  <Upload /> {replaceFile.isPending ? "Enviando…" : fromFile ? "Trocar arquivo" : "Enviar arquivo"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Trocar o arquivo grava no rascunho na hora e o texto abaixo passa a ser o extraído dele. A versão em uso não muda.</p>
              {draftFile && !draftFile.textAvailable ? (
                <p role="status" className={cn(toneSurface("warning"), "p-3 text-sm")}>Não foi possível extrair texto deste arquivo. Escreva o texto abaixo ou troque o arquivo: publicar sem texto falha no processamento, e a versão em uso não muda.</p>
              ) : null}
              <KnowledgeMarkdownField id="knowledge-content" label={fromFile ? "Texto extraído do arquivo" : "Conteúdo"} title={form.title} value={form.content} readOnly={ocrReading} onChange={(content) => patch({ content })} preview={draftPreview} />
              {fromFile ? <p className="text-xs text-muted-foreground">É este texto que a IA consulta quando a versão estiver em uso; alterá-lo não mexe no arquivo original.</p> : null}
              {form.content.trim().length > 0 && form.content.trim().length < MIN_CONTENT_LENGTH ? <p className="text-xs text-destructive">O conteúdo precisa ter pelo menos {MIN_CONTENT_LENGTH} caracteres.</p> : null}
            </div>
          )}
        </section>

        <aside
          aria-label="Configurações da base"
          data-state={settingsOpen ? "open" : "closed"}
          className={cn(SURFACE_CARD, "h-fit overflow-hidden p-4 lg:sticky lg:top-4", !settingsOpen && "lg:px-1.5 lg:py-3", mobilePanel !== "settings" && "hidden lg:block")}
        >
          {/* Cabeçalho só em tela grande. Recolhida, vira a faixa: botão no alto e o título na vertical. */}
          <div className={cn("hidden lg:flex lg:items-center lg:justify-between lg:gap-2", settingsOpen ? "lg:mb-3" : "lg:flex-col lg:justify-start lg:gap-4")}>
            <SectionLabel as="h2" className={cn(!settingsOpen && "lg:order-last lg:rotate-180 lg:whitespace-nowrap lg:[writing-mode:vertical-rl]")}>Configurações</SectionLabel>
            <Button
              type="button"
              variant={settingsOpen ? "ghost" : "outline"}
              size="icon"
              className="size-8 shrink-0"
              aria-expanded={settingsOpen}
              aria-controls="knowledge-editor-settings"
              aria-label={settingsOpen ? "Recolher configurações" : "Mostrar configurações"}
              title={settingsOpen ? "Recolher configurações" : "Mostrar configurações"}
              onClick={() => setSettingsOpen((open) => !open)}
            >
              {settingsOpen ? <PanelRightClose aria-hidden /> : <PanelRightOpen aria-hidden />}
            </Button>
          </div>
          {/* Corpo: some deslizando e esmaecendo; recolhido (só em tela grande) não recebe foco nem leitura. A largura mínima evita que o
              texto quebre enquanto a coluna encolhe. */}
          <div
            id="knowledge-editor-settings"
            className={cn(
              "grid transition-[grid-template-rows,opacity,visibility] duration-300 ease-out motion-reduce:transition-none",
              settingsOpen ? "grid-rows-[1fr] opacity-100" : "lg:invisible lg:grid-rows-[0fr] lg:opacity-0",
            )}
            data-testid="knowledge-editor-settings-body"
          >
            <div className={cn("min-h-0 lg:min-w-[20rem]", !settingsOpen && "lg:overflow-hidden")}>{settings}</div>
          </div>
        </aside>
      </div>

      {/* Largura inteira, como as bases no agente: busca, filtros e paginação precisam de espaço. Salvar ali grava nos agentes, não na base. */}
      {document && document.archived === null ? <KnowledgeAgentsPicker documentId={document.id} title={document.title} baseInUse={Boolean(document.inUse)} /> : null}

      {document && draftVersion ? (
        <PublishKnowledgeDialog
          document={{ id: document.id, draftVersion: draftVersion.version, inUseVersion: document.inUse?.version ?? null, archived: document.archived !== null, changeSummary: draftVersion.changeSummary, productsChanged }}
          open={dialog === "publish"}
          onOpenChange={(open) => setDialog(open ? "publish" : null)}
          onPublished={() => { guard.release(); router.push(knowledgeDetailHref(document.id)) }}
        />
      ) : null}
      {document && draftVersion ? (
        <DiscardKnowledgeDraftDialog document={{ id: document.id, draftVersion: draftVersion.version }} open={dialog === "discard"} onOpenChange={(open) => setDialog(open ? "discard" : null)} onDiscarded={() => { guard.release(); router.push(knowledgeDetailHref(document.id)) }} />
      ) : null}

      <AlertDialog open={dialog === "confirm-create-publish"} onOpenChange={(open) => setDialog(open ? "confirm-create-publish" : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Salvar e publicar a base?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p><strong className="text-foreground">{form.title.trim() || "Sem título"}</strong></p>
                <p>{previewSummary.scope} · {previewSummary.subjects}.</p>
                <p>A base é salva como {versionLabel(1)} e, em seguida, você confirma a publicação. Ela só passa a valer para a IA quando ficar pronta.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Revisar</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={(event) => { event.preventDefault(); void save("PUBLISH").then((ok) => { if (!ok) setDialog(null) }) }}>
              Salvar e continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={guard.open} onOpenChange={(open) => { if (!open) guard.cancel() }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair sem salvar?</AlertDialogTitle>
            <AlertDialogDescription>Há alterações nesta base que ainda não foram salvas. Se sair agora, elas se perdem.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={guard.confirm}>Sair sem salvar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
