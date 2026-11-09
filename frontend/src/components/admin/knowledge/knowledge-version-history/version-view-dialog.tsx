"use client"

import { Download } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { nodeLabel } from "@/components/admin/product-catalog/node-picker"
import { formatShortDateTime } from "@/lib/format/date"
import { useKnowledgeVersionQuery } from "@/queries/admin/use-knowledge-queries"
import { useProductNodesQuery } from "@/queries/admin/use-product-catalog-queries"
import { useSubjectsQuery, useTeamsQuery } from "@/queries/admin/use-org-structure-queries"
import {
  DOCUMENT_TYPE_LABELS,
  KNOWLEDGE_SITUATION_LABELS,
  SOURCE_TYPE_LABELS,
  type KnowledgeVersionConfig,
  type KnowledgeVersionDetail,
  type KnowledgeVersionFullRow,
} from "@/schemas/admin/knowledge.schema"

import { KnowledgeArticleContent } from "../knowledge-article-content"
import { KnowledgeFilePreview, useDownloadKnowledgeFile } from "../knowledge-file-preview"
import { formatFileSize, NOT_RECORDED, versionLabel } from "../knowledge-visuals"

function useConfigLabels() {
  const teams = useTeamsQuery().data ?? []
  const subjects = useSubjectsQuery().data ?? []
  const productsQuery = useProductNodesQuery()
  return {
    org: (scope: KnowledgeVersionConfig["orgScopes"][number]) => {
      if (scope.scopeType === "ALL_TEAMS") return "Todos os grupos"
      if (scope.scopeType === "SUBTEAM") {
        const subteam = teams.flatMap((team) => team.subteams).find((entry) => entry.id === scope.subteamId)
        return `Subgrupo ${subteam?.name ?? "não identificado"}`
      }
      return `Grupo ${teams.find((team) => team.id === scope.teamId)?.name ?? "não identificado"}`
    },
    subject: (scope: KnowledgeVersionConfig["subjectScopes"][number]) => (scope.scopeType === "ALL_SUBJECTS" ? "Todos os assuntos" : `Assunto ${subjects.find((subject) => subject.id === scope.subjectId)?.name ?? "não identificado"}`),
    product: (id: string) => (productsQuery.data ? nodeLabel(productsQuery.data, id) : "Produto não identificado"),
  }
}

function ConfigurationPanel({ config, versionNumber }: { config: KnowledgeVersionConfig | null; versionNumber: number }) {
  const labels = useConfigLabels()
  if (!config) return <p className="text-sm text-muted-foreground">A configuração da versão {versionNumber} não foi registrada.</p>
  const rows: [string, string][] = [
    ["Título", config.title],
    ["Tipo", DOCUMENT_TYPE_LABELS[config.documentType]],
    ["Formato", SOURCE_TYPE_LABELS[config.sourceType]],
    ["Alcance", config.orgScopes.map(labels.org).join(", ") || NOT_RECORDED],
    ["Assuntos", config.subjectScopes.map(labels.subject).join(", ") || NOT_RECORDED],
    ["Vale para (produtos)", config.productNodeIds.length === 0 ? "Todos os produtos" : config.productNodeIds.map(labels.product).join(", ")],
  ]
  return (
    <dl className="space-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function ContentPanel({ detail, documentTitle }: { detail: KnowledgeVersionDetail; documentTitle: string }) {
  if (!detail.textAvailable || !detail.content.trim()) return <p className="text-sm text-muted-foreground">Não há texto extraído desta versão.</p>
  const isText = detail.config ? detail.config.sourceType === "TEXT" : detail.fileId === null
  if (isText) return <KnowledgeArticleContent text={detail.content} omitLeadingHeading={detail.config?.title ?? documentTitle} />
  return <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">{detail.content}</pre>
}

function FilePanel({ documentId, documentTitle, detail }: { documentId: string; documentTitle: string; detail: KnowledgeVersionDetail }) {
  const fileRef = { documentId, versionId: detail.id, inUse: false }
  const filename = detail.config?.file?.filename ?? null
  const { download, pending } = useDownloadKnowledgeFile(fileRef, filename ?? documentTitle)
  const sourceType = detail.config?.sourceType ?? null
  const size = formatFileSize(detail.config?.file?.sizeBytes)

  if (!detail.fileId) return <p className="text-sm text-muted-foreground">Esta versão não tem arquivo.</p>
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm">
          <p className="truncate font-medium">{filename ?? NOT_RECORDED}</p>
          <p className="text-xs text-muted-foreground">{[sourceType ? SOURCE_TYPE_LABELS[sourceType] : null, size].filter(Boolean).join(" · ") || NOT_RECORDED}</p>
        </div>
        <Button size="sm" variant="outline" disabled={pending} onClick={download}>
          <Download /> {pending ? "Preparando..." : "Baixar arquivo"}
        </Button>
      </div>
      {/* Sem configuração registrada não se sabe o formato: fica só o download. */}
      {sourceType && sourceType !== "TEXT" ? <KnowledgeFilePreview fileRef={fileRef} sourceType={sourceType} content={detail.content} /> : null}
    </div>
  )
}

/** Uma versão como ela era: conteúdo, configuração e arquivo. Só leitura. */
export function VersionViewDialog({ documentId, documentTitle, version, onClose }: { documentId: string; documentTitle: string; version: KnowledgeVersionFullRow; onClose: () => void }) {
  const detailQuery = useKnowledgeVersionQuery(documentId, version.id)
  const label = versionLabel(version.number)
  const when = version.publishedAt ? `Publicada em ${formatShortDateTime(version.publishedAt, { withYear: true })}` : "Ainda não publicada"
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{`${label} · ${KNOWLEDGE_SITUATION_LABELS[version.situation]}`}</DialogTitle>
          <DialogDescription>
            {when}. Resumo: {version.changeSummary ?? NOT_RECORDED}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {detailQuery.isLoading ? <Skeleton className="h-48 w-full" /> : null}
          {detailQuery.isError ? <p className="text-sm text-destructive">{detailQuery.error.message || "Não foi possível carregar esta versão."}</p> : null}
          {detailQuery.data ? (
            <Tabs defaultValue="content">
              <TabsList>
                <TabsTrigger value="content">Conteúdo</TabsTrigger>
                <TabsTrigger value="configuration">Configuração</TabsTrigger>
                <TabsTrigger value="file">Arquivo</TabsTrigger>
              </TabsList>
              <TabsContent value="content" className="pt-3">
                <ContentPanel detail={detailQuery.data} documentTitle={documentTitle} />
              </TabsContent>
              <TabsContent value="configuration" className="pt-3">
                <ConfigurationPanel config={detailQuery.data.config} versionNumber={version.number} />
              </TabsContent>
              <TabsContent value="file" className="pt-3">
                <FilePanel documentId={documentId} documentTitle={documentTitle} detail={detailQuery.data} />
              </TabsContent>
            </Tabs>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
