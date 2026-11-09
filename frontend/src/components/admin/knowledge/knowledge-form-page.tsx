"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

import { ProductScopeField, useSourceProductScope } from "@/components/admin/product-catalog/product-scope-field"
import { OrgScopeSelect, type OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import { SubjectScopeSelect, type SubjectScopeValue } from "@/components/admin/shared/subject-scope-select"
import { useTeamsQuery, useSubjectsQuery } from "@/queries/admin/use-org-structure-queries"
import {
  useCreateKnowledgeDocumentMutation,
  useKnowledgeDocumentQuery,
  useReplaceKnowledgeDraftFileMutation,
  useUpdateKnowledgeDocumentMutation,
} from "@/queries/admin/use-knowledge-queries"
import {
  DOCUMENT_TYPE_LABELS,
  SOURCE_TYPE_LABELS,
  isFileSource,
  type KnowledgeDocumentDetail,
  type KnowledgeDocumentType,
} from "@/schemas/admin/knowledge.schema"

import { ChangeSummaryField } from "./knowledge-lifecycle-dialogs"
import { RestrictedEditableNotice } from "./knowledge-restricted-draft"
import { versionLabel } from "./knowledge-visuals"

const LIST_HREF = "/admin/knowledge"
const MIN_CONTENT_LENGTH = 10
const ACCEPTED_FILES = ".pdf,.docx,.txt,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,application/json"

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-3.5 w-3.5" /> {label}
    </Link>
  )
}

function CreateKnowledgeForm() {
  const router = useRouter()
  const teamsQuery = useTeamsQuery()
  const subjectsQuery = useSubjectsQuery()
  const createMutation = useCreateKnowledgeDocumentMutation()

  const [title, setTitle] = useState("")
  const [documentType, setDocumentType] = useState<KnowledgeDocumentType>("PROCEDURE")
  const [sourceMode, setSourceMode] = useState<"text" | "file">("text")
  const [content, setContent] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [orgScope, setOrgScope] = useState<OrgScopeValue>({ scopeType: "ALL_TEAMS" })
  const [subjectScope, setSubjectScope] = useState<SubjectScopeValue>({ scopeType: "ALL_SUBJECTS" })
  const productScope = useSourceProductScope("KNOWLEDGE_DOCUMENT", null)

  async function handleSubmit() {
    try {
      const created = await createMutation.mutateAsync({
        title,
        documentType,
        content: sourceMode === "text" ? content : undefined,
        file: sourceMode === "file" ? (file ?? undefined) : undefined,
        orgScope,
        subjectScope,
      })
      await productScope.save(created.id).catch(() => undefined)
      router.push(`${LIST_HREF}/${created.id}`)
    } catch {
      // erro já sinalizado via createMutation.isError / toast do useAdminMutation
    }
  }

  const canSubmit = title.trim().length > 1 && (sourceMode === "text" ? content.trim().length > 9 : Boolean(file))

  return (
    <div className="max-w-2xl space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="knowledge-title">Título</Label>
          <Input id="knowledge-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Procedimento de segunda via" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="knowledge-document-type">Tipo de documento</Label>
          <Select value={documentType} onValueChange={(value) => setDocumentType(value as KnowledgeDocumentType)}>
            <SelectTrigger id="knowledge-document-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={sourceMode} onValueChange={(value) => setSourceMode(value as "text" | "file")}>
        <TabsList>
          <TabsTrigger value="text">Colar texto</TabsTrigger>
          <TabsTrigger value="file">Enviar arquivo</TabsTrigger>
        </TabsList>
        <TabsContent value="text" className="mt-3 space-y-1.5">
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Cole o procedimento, manual, FAQ ou fluxo"
            rows={12}
          />
          <p className="text-xs text-muted-foreground">
            Títulos com <code>#</code>, listas com <code>-</code> ou <code>1.</code>, <code>**negrito**</code> e tabelas são exibidos formatados na leitura.
          </p>
        </TabsContent>
        <TabsContent value="file" className="mt-3 space-y-1.5">
          <Input
            type="file"
            accept={ACCEPTED_FILES}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <p className="text-xs text-muted-foreground">Formatos aceitos: PDF, DOCX, TXT ou JSON.</p>
        </TabsContent>
      </Tabs>

      {teamsQuery.data ? (
        <OrgScopeSelect teams={teamsQuery.data} value={orgScope} onChange={setOrgScope} />
      ) : (
        <Skeleton className="h-10 w-full" />
      )}
      {subjectsQuery.data ? (
        <SubjectScopeSelect subjects={subjectsQuery.data} value={subjectScope} onChange={setSubjectScope} />
      ) : (
        <Skeleton className="h-10 w-full" />
      )}

      {productScope.available ? <ProductScopeField nodes={productScope.nodes} value={productScope.value} onChange={productScope.setValue} idPrefix="knowledge-products" /> : null}

      {createMutation.isError ? <p className="text-sm text-destructive">{(createMutation.error as Error).message}</p> : null}

      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href={LIST_HREF}>Cancelar</Link>
        </Button>
        <Button disabled={!canSubmit || createMutation.isPending} onClick={handleSubmit}>
          {createMutation.isPending ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </div>
  )
}

function EditKnowledgeForm({ documentId }: { documentId: string }) {
  const detailQuery = useKnowledgeDocumentQuery(documentId)

  if (detailQuery.isLoading) return <Skeleton className="h-64 w-full max-w-2xl" />
  if (detailQuery.isError || !detailQuery.data) {
    return <p className="text-sm text-destructive">Não foi possível carregar esta base de conhecimento.</p>
  }
  // Versão em edição fora do alcance de quem lê: o formulário abriria vazio e a API recusaria salvar ou trocar o arquivo (403).
  if (detailQuery.data.editable?.restricted) return <RestrictedEditableNotice document={detailQuery.data} className="max-w-2xl p-3 text-sm" />
  // O formulário nasce já com os valores carregados (estado inicial a partir das props) — um
  // refetch em segundo plano não sobrescreve o que o admin está digitando.
  return <EditKnowledgeFields key={detailQuery.data.id} document={detailQuery.data} />
}

/** Valores que o formulário abre: os de `editable` (rascunho, atualização com falha, versão em uso ou a mais recente), nunca os "da base". */
function editableValues(document: KnowledgeDocumentDetail) {
  const config = document.editable?.config ?? null
  const org = config ? config.orgScopes[0] : document.orgScopes[0]
  const subject = config ? config.subjectScopes[0] : document.subjectScopes[0]
  return {
    title: config?.title ?? document.title,
    documentType: config?.documentType ?? document.documentType,
    content: document.editable?.content ?? "",
    summary: document.draft?.changeSummary ?? "",
    orgScope: (org
      ? { scopeType: org.scopeType as OrgScopeValue["scopeType"], teamId: org.teamId ?? undefined, subteamId: org.subteamId ?? undefined }
      : { scopeType: "ALL_TEAMS" }) satisfies OrgScopeValue,
    subjectScope: (subject
      ? { scopeType: subject.scopeType as SubjectScopeValue["scopeType"], subjectId: subject.subjectId ?? undefined }
      : { scopeType: "ALL_SUBJECTS" }) satisfies SubjectScopeValue,
  }
}

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

function draftFileOf(document: KnowledgeDocumentDetail) {
  const config = document.editable?.config ?? null
  return {
    sourceType: config?.sourceType ?? document.sourceType,
    filename: config ? (config.file?.filename ?? null) : document.originalFilename,
    textAvailable: document.editable?.textAvailable ?? true,
  }
}

/** O que salvar muda (e o que não muda) depende do que a IA usa hoje. */
function EditingNotice({ document }: { document: KnowledgeDocumentDetail }) {
  return (
    <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
      {document.inUse
        ? `Você está editando o rascunho: salvar não muda o que a IA consulta. A IA continua usando a ${versionLabel(document.inUse.version)} até este rascunho ser publicado e ficar pronto.`
        : document.archived
          ? "Você está editando o rascunho: salvar não reativa a base, que continua arquivada e fora de uso pela IA."
          : "Você está editando o rascunho: esta base ainda não tem versão em uso, e salvar não a disponibiliza para a IA. Para isso, publique depois de salvar."}
    </p>
  )
}

function EditKnowledgeFields({ document }: { document: KnowledgeDocumentDetail }) {
  const router = useRouter()
  const teamsQuery = useTeamsQuery()
  const subjectsQuery = useSubjectsQuery()
  const updateMutation = useUpdateKnowledgeDocumentMutation()
  const replaceFileMutation = useReplaceKnowledgeDraftFileMutation()
  const documentId = document.id
  const productScope = useSourceProductScope("KNOWLEDGE_DOCUMENT", documentId)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [initial] = useState(() => editableValues(document))
  const [title, setTitle] = useState(initial.title)
  const [documentType, setDocumentType] = useState<KnowledgeDocumentType>(initial.documentType)
  const [content, setContent] = useState(initial.content)
  // O texto de referência: o que está gravado. Muda quando o arquivo é trocado, porque o texto extraído já entrou no rascunho.
  const [savedContent, setSavedContent] = useState(initial.content)
  const [changeSummary, setChangeSummary] = useState(initial.summary)
  const [orgScope, setOrgScope] = useState<OrgScopeValue>(initial.orgScope)
  const [subjectScope, setSubjectScope] = useState<SubjectScopeValue>(initial.subjectScope)
  const [draftFile, setDraftFile] = useState(() => draftFileOf(document))

  const fromFile = isFileSource(draftFile.sourceType)
  const hasText = content.trim().length > 0
  // Em branco só passa quando o arquivo não teve texto extraído: o rascunho fica salvo sem texto, e publicar assim falha no processamento.
  const contentInvalid = hasText ? content.trim().length < MIN_CONTENT_LENGTH : draftFile.textAvailable

  async function handleSubmit() {
    try {
      const summary = changeSummary.trim()
      await updateMutation.mutateAsync({
        id: documentId,
        input: {
          title,
          documentType,
          // Sem texto (arquivo sem extração) o campo fica de fora: a API exige um texto mínimo e o rascunho continua sem texto.
          ...(hasText && content !== savedContent ? { content } : {}),
          // Alcance e assuntos só vão se a pessoa mudou: o formulário mostra um de cada, e uma base com mais de um não pode perder os outros ao salvar.
          ...(sameValue(orgScope, initial.orgScope) ? {} : { orgScope }),
          ...(sameValue(subjectScope, initial.subjectScope) ? {} : { subjectScope }),
          ...(summary ? { changeSummary: summary } : {}),
        },
      })
      await productScope.save(documentId)
      router.push(`${LIST_HREF}/${documentId}`)
    } catch {
      // erro já sinalizado via updateMutation.isError / toast do useAdminMutation
    }
  }

  async function handleReplaceFile(file: File) {
    try {
      const updated = await replaceFileMutation.mutateAsync({ id: documentId, file })
      const text = updated.editable?.content ?? ""
      setContent(text)
      setSavedContent(text)
      setDraftFile(draftFileOf(updated))
    } catch {
      // erro já sinalizado pelo toast do useAdminMutation
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <EditingNotice document={document} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="edit-knowledge-title">Título</Label>
          <Input id="edit-knowledge-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-knowledge-document-type">Tipo de documento</Label>
          <Select value={documentType} onValueChange={(value) => setDocumentType(value as KnowledgeDocumentType)}>
            <SelectTrigger id="edit-knowledge-document-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">Arquivo do rascunho</p>
            <p className="truncate text-xs text-muted-foreground">
              {fromFile ? `${draftFile.filename ?? "Nome do arquivo não informado"} · ${SOURCE_TYPE_LABELS[draftFile.sourceType]}` : "Nenhum: o conteúdo é o texto abaixo."}
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            aria-label="Arquivo novo para o rascunho"
            className="sr-only"
            tabIndex={-1}
            accept={ACCEPTED_FILES}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleReplaceFile(file)
            }}
          />
          <Button type="button" size="sm" variant="outline" disabled={replaceFileMutation.isPending} onClick={() => fileInputRef.current?.click()}>
            <Upload /> {replaceFileMutation.isPending ? "Enviando..." : fromFile ? "Trocar arquivo" : "Enviar arquivo"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">O arquivo entra no rascunho na hora e o texto abaixo passa a ser o extraído dele. A versão em uso não muda. Formatos aceitos: PDF, DOCX, TXT ou JSON.</p>
      </div>

      {draftFile.textAvailable ? null : (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          Não foi possível extrair texto deste arquivo. Digite o texto abaixo ou troque o arquivo: publicar sem texto falha no processamento, e a versão em uso não muda.
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="edit-knowledge-content">{fromFile ? "Texto extraído do arquivo" : "Conteúdo"}</Label>
        <Textarea id="edit-knowledge-content" value={content} onChange={(event) => setContent(event.target.value)} rows={14} />
        {fromFile ? <p className="text-xs text-muted-foreground">O texto acima é o que os agentes consultam quando esta versão estiver em uso; alterá-lo não mexe no arquivo original.</p> : null}
        {hasText && content.trim().length < MIN_CONTENT_LENGTH ? <p className="text-xs text-destructive">O conteúdo precisa ter pelo menos {MIN_CONTENT_LENGTH} caracteres.</p> : null}
      </div>

      {teamsQuery.data ? <OrgScopeSelect teams={teamsQuery.data} value={orgScope} onChange={setOrgScope} /> : <Skeleton className="h-10 w-full" />}
      {subjectsQuery.data ? (
        <SubjectScopeSelect subjects={subjectsQuery.data} value={subjectScope} onChange={setSubjectScope} />
      ) : (
        <Skeleton className="h-10 w-full" />
      )}

      {productScope.available ? (
        <div className="space-y-1">
          <ProductScopeField nodes={productScope.nodes} value={productScope.value} onChange={productScope.setValue} idPrefix="edit-knowledge-products" />
          <p className="text-xs text-muted-foreground">Entra no rascunho com o resto: só passa a valer quando a versão entrar em uso, e chamadas já analisadas continuam com o que valia na época.</p>
        </div>
      ) : null}

      <ChangeSummaryField value={changeSummary} onChange={setChangeSummary} description="Aparece no histórico de versões." />

      {updateMutation.isError ? <p className="text-sm text-destructive">{(updateMutation.error as Error).message}</p> : null}

      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href={`${LIST_HREF}/${documentId}`}>Cancelar</Link>
        </Button>
        <Button disabled={title.trim().length < 2 || contentInvalid || updateMutation.isPending} onClick={handleSubmit}>
          {updateMutation.isPending ? "Salvando..." : "Salvar rascunho"}
        </Button>
      </div>
    </div>
  )
}

export function CreateKnowledgePage() {
  return (
    <div className="space-y-4">
      <BackLink href={LIST_HREF} label="Base de conhecimento" />
      <Card>
        <CardHeader>
          <CardTitle>Nova base de conhecimento</CardTitle>
          <CardDescription>
            Texto ou arquivo (PDF, DOCX, TXT, JSON) que orienta os agentes de IA, associado a um grupo/subgrupo e a um assunto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateKnowledgeForm />
        </CardContent>
      </Card>
    </div>
  )
}

export function EditKnowledgePage({ documentId }: { documentId: string }) {
  return (
    <div className="space-y-4">
      <BackLink href={`${LIST_HREF}/${documentId}`} label="Voltar para a base" />
      <Card>
        <CardHeader>
          <CardTitle>Editar base de conhecimento</CardTitle>
          <CardDescription>Título, tipo, alcance, assuntos e conteúdo ficam no rascunho até ele ser publicado e ficar pronto.</CardDescription>
        </CardHeader>
        <CardContent>
          <EditKnowledgeForm documentId={documentId} />
        </CardContent>
      </Card>
    </div>
  )
}
