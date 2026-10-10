"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

import { OrgScopeSelect, type OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import { SubjectScopeSelect, type SubjectScopeValue } from "@/components/admin/shared/subject-scope-select"
import { useTeamsQuery, useSubjectsQuery } from "@/queries/admin/use-org-structure-queries"
import {
  useCreateKnowledgeDocumentMutation,
  useKnowledgeDocumentQuery,
  useUpdateKnowledgeDocumentMutation,
} from "@/queries/admin/use-knowledge-queries"
import {
  DOCUMENT_TYPE_LABELS,
  KNOWLEDGE_STATUS_LABELS,
  SOURCE_TYPE_LABELS,
  isFileSource,
  type KnowledgeDocumentDetail,
  type KnowledgeDocumentType,
} from "@/schemas/admin/knowledge.schema"

const LIST_HREF = "/admin/knowledge"

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
          <Label>Tipo de documento</Label>
          <Select value={documentType} onValueChange={(value) => setDocumentType(value as KnowledgeDocumentType)}>
            <SelectTrigger className="w-full">
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
            accept=".pdf,.docx,.txt,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,application/json"
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
  // O formulário nasce já com os valores carregados (estado inicial a partir das props) — um
  // refetch em segundo plano não sobrescreve o que o admin está digitando.
  return <EditKnowledgeFields key={detailQuery.data.id} document={detailQuery.data} />
}

function EditKnowledgeFields({ document }: { document: KnowledgeDocumentDetail }) {
  const router = useRouter()
  const teamsQuery = useTeamsQuery()
  const subjectsQuery = useSubjectsQuery()
  const updateMutation = useUpdateKnowledgeDocumentMutation()
  const documentId = document.id

  const [title, setTitle] = useState(document.title)
  const [documentType, setDocumentType] = useState<KnowledgeDocumentType>(document.documentType)
  const [content, setContent] = useState(document.latestVersion?.content ?? "")
  const [status, setStatus] = useState(document.latestVersion?.status ?? "DRAFT")
  const [orgScope, setOrgScope] = useState<OrgScopeValue>(() => {
    const org = document.orgScopes[0]
    return org
      ? { scopeType: org.scopeType as OrgScopeValue["scopeType"], teamId: org.teamId ?? undefined, subteamId: org.subteamId ?? undefined }
      : { scopeType: "ALL_TEAMS" }
  })
  const [subjectScope, setSubjectScope] = useState<SubjectScopeValue>(() => {
    const subject = document.subjectScopes[0]
    return subject ? { scopeType: subject.scopeType as SubjectScopeValue["scopeType"], subjectId: subject.subjectId ?? undefined } : { scopeType: "ALL_SUBJECTS" }
  })

  async function handleSubmit() {
    try {
      await updateMutation.mutateAsync({ id: documentId, input: { title, documentType, content, status, orgScope, subjectScope } })
      router.push(`${LIST_HREF}/${documentId}`)
    } catch {
      // erro já sinalizado via updateMutation.isError / toast do useAdminMutation
    }
  }

  const fromFile = isFileSource(document.sourceType)

  return (
    <div className="max-w-2xl space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="edit-knowledge-title">Título</Label>
          <Input id="edit-knowledge-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Tipo de documento</Label>
          <Select value={documentType} onValueChange={(value) => setDocumentType(value as KnowledgeDocumentType)}>
            <SelectTrigger className="w-full">
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

      <div className="space-y-1.5">
        <Label htmlFor="edit-knowledge-content">{fromFile ? "Texto extraído do arquivo" : "Conteúdo"}</Label>
        <Textarea id="edit-knowledge-content" value={content} onChange={(event) => setContent(event.target.value)} rows={14} />
        {fromFile ? (
          <p className="text-xs text-muted-foreground">
            Esta base veio de um arquivo {SOURCE_TYPE_LABELS[document.sourceType]}
            {document.originalFilename ? ` (${document.originalFilename})` : ""}. O texto acima é o que os agentes consultam; alterá-lo
            cria uma nova versão sem mexer no arquivo original.
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label>Status</Label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(KNOWLEDGE_STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {teamsQuery.data ? <OrgScopeSelect teams={teamsQuery.data} value={orgScope} onChange={setOrgScope} /> : <Skeleton className="h-10 w-full" />}
      {subjectsQuery.data ? (
        <SubjectScopeSelect subjects={subjectsQuery.data} value={subjectScope} onChange={setSubjectScope} />
      ) : (
        <Skeleton className="h-10 w-full" />
      )}

      {updateMutation.isError ? <p className="text-sm text-destructive">{(updateMutation.error as Error).message}</p> : null}

      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href={`${LIST_HREF}/${documentId}`}>Cancelar</Link>
        </Button>
        <Button disabled={title.trim().length < 2 || content.trim().length < 10 || updateMutation.isPending} onClick={handleSubmit}>
          {updateMutation.isPending ? "Salvando..." : "Salvar alterações"}
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
          <CardDescription>Alterar o conteúdo cria uma nova versão; título, tipo, status e alcance são atualizados no registro.</CardDescription>
        </CardHeader>
        <CardContent>
          <EditKnowledgeForm documentId={documentId} />
        </CardContent>
      </Card>
    </div>
  )
}
