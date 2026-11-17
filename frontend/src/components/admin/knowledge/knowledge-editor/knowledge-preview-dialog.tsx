"use client"

import { useState } from "react"
import { Bot, BookOpen, Boxes, Eye, Globe2, Tags, Users } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { toneSurface } from "@/components/ui/surface"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DOCUMENT_TYPE_LABELS, type KnowledgeDocumentDetail, type KnowledgeDocumentType } from "@/schemas/admin/knowledge.schema"

import { KnowledgeAiPreview } from "../knowledge-ai-preview"
import { KnowledgeArticleContent } from "../knowledge-article-content"
import { contentStats } from "./knowledge-markdown-field"

export type KnowledgePreviewSummary = { universe: string; scope: string; subjects: string; products: string }

/**
 * Pré-visualização antes de salvar ou publicar. "Leitura": o texto como está no editor, com a mesma leitura formatada da base (quem
 * consulta o material vê assim). "O que a IA recebe": a classificação que decide quem recebe a base (universo, alcance, assuntos e
 * produtos) e, para o que já está salvo, os trechos reais que a busca e a IA recebem (`KnowledgeAiPreview`, do servidor). Com alteração
 * não salva, a tela avisa que os trechos são os do que está salvo.
 */
export function KnowledgePreviewDialog({ title, documentType, content, fromFileName, summary, saved, dirty }: {
  title: string
  documentType: KnowledgeDocumentType
  content: string
  /** Base nova com arquivo escolhido: o texto só existe depois que o servidor extrair. */
  fromFileName: string | null
  summary: KnowledgePreviewSummary
  saved: KnowledgeDocumentDetail | null
  dirty: boolean
}) {
  const [tab, setTab] = useState("reading")
  const stats = contentStats(content)
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline"><Eye data-icon="inline-start" />Pré-visualizar</Button>
      </DialogTrigger>
      <DialogContent className="w-[min(calc(100vw-2rem),52rem)] sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Pré-visualização</DialogTitle>
          <DialogDescription>Como a base aparece para quem lê e o que a IA recebe dela.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="reading"><BookOpen />Leitura</TabsTrigger>
            <TabsTrigger value="ai"><Bot />O que a IA recebe</TabsTrigger>
          </TabsList>
          <div className="mt-3 max-h-[65dvh] overflow-y-auto pr-1">
            <TabsContent value="reading" className="space-y-4">
              <header className="space-y-2">
                <Badge variant="outline">{DOCUMENT_TYPE_LABELS[documentType]}</Badge>
                <h2 className="text-2xl font-semibold leading-tight tracking-tight text-balance">{title.trim() || "Sem título"}</h2>
              </header>
              {fromFileName ? (
                <p className={`${toneSurface("info")} p-3 text-sm`}>O texto de “{fromFileName}” é extraído ao salvar. Depois de salvar, a leitura e os trechos aparecem aqui e na base.</p>
              ) : content.trim() ? (
                <KnowledgeArticleContent text={content} omitLeadingHeading={title.trim() || undefined} />
              ) : (
                <p className="text-sm italic text-muted-foreground">Nada escrito ainda.</p>
              )}
            </TabsContent>
            <TabsContent value="ai" className="space-y-4">
              <dl className={`${toneSurface("info")} grid gap-3 p-3 text-sm sm:grid-cols-2`}>
                <SummaryItem icon={Globe2} label="Universo de atuação" value={summary.universe} />
                <SummaryItem icon={Users} label="Alcance" value={summary.scope} />
                <SummaryItem icon={Tags} label="Assuntos" value={summary.subjects} />
                <SummaryItem icon={Boxes} label="Produtos" value={summary.products} />
              </dl>
              <p className="text-xs text-muted-foreground">
                A base entra nas consultas da IA de quem está no universo e no alcance escolhidos. {fromFileName ? "" : `O texto tem ${stats.headings} ${stats.headings === 1 ? "título" : "títulos"}: cada seção vira um trecho que a busca pode escolher.`}
              </p>
              {saved && !saved.editable?.restricted ? (
                <div className="space-y-2">
                  {dirty ? <p className={`${toneSurface("warning")} p-3 text-sm`}>Há alterações não salvas: os trechos abaixo são os da versão salva. Salve o rascunho para vê-los atualizados.</p> : null}
                  <KnowledgeAiPreview document={saved} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Os trechos exatos que a IA recebe aparecem aqui depois de salvar o rascunho.</p>
              )}
            </TabsContent>
          </div>
        </Tabs>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline">Fechar</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SummaryItem({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0"><dt className="font-medium">{label}</dt><dd className="text-muted-foreground">{value}</dd></div>
    </div>
  )
}
