"use client"

import { useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { BookOpen, Plus } from "lucide-react"

import { useAutoOpenFromQuery } from "@/hooks/use-auto-open-from-query"
import { useAdminListState } from "@/hooks/use-admin-list-state"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

import { AdminListView } from "@/components/admin/shared/list/admin-list-view"
import {
  ListDateRangeFilter,
  ListMultiSelectFilter,
  ListOrgScopeFilter,
  ListSearchInput,
  ListSubjectScopeFilter,
  ListToolbar,
  optionsFromLabels,
} from "@/components/admin/shared/list/list-filters"
import { ListCardGrid } from "@/components/admin/shared/list/list-states"
import { ListViewToggle } from "@/components/admin/shared/list/list-view-toggle"
import { useKnowledgeDocumentsPageQuery } from "@/queries/admin/use-knowledge-queries"
import { useSubjectsQuery, useTeamsQuery } from "@/queries/admin/use-org-structure-queries"
import type { KnowledgeListParams } from "@/services/admin/knowledge-service"
import {
  DOCUMENT_TYPE_LABELS,
  KNOWLEDGE_STATUS_FILTER_LABELS,
  SOURCE_TYPE_LABELS,
  type KnowledgeDocument,
} from "@/schemas/admin/knowledge.schema"

import { useProductScopeLabels } from "@/components/admin/product-catalog/product-scope-field"

import { KnowledgeDocumentMenu } from "./knowledge-document-actions"
import { AuthorLine, DocumentTypeLabel, KnowledgeVersionBadges, ScopeTags, SourceTypeIcon, formatDateOnly } from "./knowledge-meta"
import { orgScopeLabel, subjectScopeLabel } from "./knowledge-visuals"

// O resumo vem do texto bruto (que pode ter markdown leve) — tira os marcadores para o card não
// mostrar "## 1. Objetivo **Área**" cru.
function cleanExcerpt(excerpt: string | null) {
  if (!excerpt) return null
  const cleaned = excerpt
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|\s)[-*•]\s+/g, "$1")
    .replace(/\|/g, " ")
    .replace(/-{3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return cleaned.length ? cleaned : null
}

function KnowledgeCard({ document, products }: { document: KnowledgeDocument; products: readonly string[] }) {
  const excerpt = cleanExcerpt(document.excerpt)
  return (
    <article className="group relative flex flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/30 focus-within:border-primary/40">
      <div className="flex items-start gap-3">
        <SourceTypeIcon sourceType={document.sourceType} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
            <DocumentTypeLabel documentType={document.documentType} />
            <span aria-hidden>·</span>
            <span>{SOURCE_TYPE_LABELS[document.sourceType]}</span>
          </div>
          <h3 className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-snug">
            {/* Link "esticado": o card inteiro abre a base, sem envolver tudo num <a>. */}
            <Link href={`/admin/knowledge/${document.id}`} className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none">
              {document.title}
            </Link>
          </h3>
        </div>
        <div className="relative z-10 -mr-1.5 -mt-1 shrink-0">
          <KnowledgeDocumentMenu document={document} />
        </div>
      </div>

      {excerpt ? (
        <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{excerpt}</p>
      ) : (
        <p className="mt-3 text-sm italic text-muted-foreground/70">Sem resumo textual disponível.</p>
      )}

      <div className="mt-auto space-y-2 pt-4">
        <ScopeTags document={document} products={products} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AuthorLine document={document} />
          <KnowledgeVersionBadges document={document} />
        </div>
      </div>
    </article>
  )
}

function KnowledgeTable({ documents }: { documents: KnowledgeDocument[] }) {
  const productScope = useProductScopeLabels("KNOWLEDGE_DOCUMENT")
  return (
    <div className={TABLE_FRAME}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Base</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Grupo</TableHead>
            <TableHead>Assunto</TableHead>
            {productScope.available ? <TableHead>Produtos</TableHead> : null}
            <TableHead>Autor</TableHead>
            <TableHead>Criada em</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((document) => (
            <TableRow key={document.id}>
              <TableCell>
                <div className="flex items-center gap-2.5">
                  <SourceTypeIcon sourceType={document.sourceType} className="size-8" />
                  <div className="min-w-0">
                    <Link href={`/admin/knowledge/${document.id}`} className="block max-w-md truncate font-medium hover:underline" title={document.title}>
                      {document.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">{SOURCE_TYPE_LABELS[document.sourceType]}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <DocumentTypeLabel documentType={document.documentType} />
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{orgScopeLabel(document.orgScopes[0])}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{subjectScopeLabel(document.subjectScopes[0])}</TableCell>
              {productScope.available ? (
                <TableCell className="text-sm text-muted-foreground">
                  {productScope.labelsOf(document.id).join(", ") || "Todos"}
                  {productScope.pendingOf(document.id) ? <p className="text-xs">{productScope.pendingOf(document.id)}</p> : null}
                </TableCell>
              ) : null}
              <TableCell className="text-sm text-muted-foreground">{document.authorName ?? <span className="italic">Não informado</span>}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                <time dateTime={document.createdAt}>{formatDateOnly(document.createdAt)}</time>
              </TableCell>
              <TableCell>
                <KnowledgeVersionBadges document={document} />
              </TableCell>
              <TableCell className="text-right">
                <KnowledgeDocumentMenu document={document} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

type KnowledgeFilters = Omit<KnowledgeListParams, "page" | "pageSize" | "search"> & { search: string }

const DEFAULT_FILTERS: KnowledgeFilters = {
  search: "",
  documentType: [],
  sourceType: [],
  status: [],
  createdAt: {},
}

const DOCUMENT_TYPE_OPTIONS = optionsFromLabels(DOCUMENT_TYPE_LABELS)
const SOURCE_TYPE_OPTIONS = optionsFromLabels(SOURCE_TYPE_LABELS)
const STATUS_OPTIONS = optionsFromLabels(KNOWLEDGE_STATUS_FILTER_LABELS)

export function KnowledgePage() {
  const router = useRouter()
  const productScope = useProductScopeLabels("KNOWLEDGE_DOCUMENT")
  const [autoOpen] = useAutoOpenFromQuery("new")
  const teamsQuery = useTeamsQuery()
  const subjectsQuery = useSubjectsQuery()

  // A biblioteca nasceu em cards — continua sendo o padrão desta tela.
  const list = useAdminListState({ storageKey: "knowledge", defaultFilters: DEFAULT_FILTERS, defaultView: "cards" })
  const pageQuery = useKnowledgeDocumentsPageQuery(list.params)

  // Compatibilidade com o atalho antigo "?new=1" — o cadastro agora tem rota própria.
  useEffect(() => {
    if (autoOpen) router.replace("/admin/knowledge/new")
  }, [autoOpen, router])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Base de conhecimento</CardTitle>
            <CardDescription>
              Textos e arquivos (PDF, DOCX, TXT, JSON) que orientam os agentes de IA, com alcance por grupo/subgrupo e assunto. O status é o da versão em uso pela IA.
            </CardDescription>
          </div>
          <Button asChild>
            <Link href="/admin/knowledge/new">
              <Plus /> Nova base
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ListToolbar
          search={
            <ListSearchInput
              value={list.filters.search}
              onChange={(value) => list.setFilter("search", value)}
              placeholder="Buscar por título ou nome do arquivo"
              ariaLabel="Buscar base de conhecimento"
              pending={list.isSearchPending}
            />
          }
          viewToggle={<ListViewToggle value={list.view} onChange={list.setView} />}
          hasActiveFilters={list.hasActiveFilters}
          onClearFilters={list.resetFilters}
        >
          <ListMultiSelectFilter label="Tipo" values={list.filters.documentType} onChange={(values) => list.setFilter("documentType", values)} options={DOCUMENT_TYPE_OPTIONS} />
          <ListMultiSelectFilter label="Formato" values={list.filters.sourceType} onChange={(values) => list.setFilter("sourceType", values)} options={SOURCE_TYPE_OPTIONS} />
          <ListMultiSelectFilter label="Status" values={list.filters.status} onChange={(values) => list.setFilter("status", values)} options={STATUS_OPTIONS} />
          <ListOrgScopeFilter
            teams={teamsQuery.data}
            value={{ scopeType: list.filters.scopeType, teamId: list.filters.teamId, subteamId: list.filters.subteamId }}
            onChange={(scope) => list.patchFilters({ scopeType: scope.scopeType, teamId: scope.teamId, subteamId: scope.subteamId })}
          />
          <ListSubjectScopeFilter
            subjects={subjectsQuery.data}
            value={{ subjectScopeType: list.filters.subjectScopeType, subjectId: list.filters.subjectId }}
            onChange={(scope) => list.patchFilters({ subjectScopeType: scope.subjectScopeType, subjectId: scope.subjectId })}
          />
          <ListDateRangeFilter label="Criada em" value={list.filters.createdAt} onChange={(value) => list.setFilter("createdAt", value)} />
        </ListToolbar>

        <AdminListView
          state={list}
          query={pageQuery}
          errorMessage="Não foi possível carregar as bases de conhecimento."
          empty={{
            icon: BookOpen,
            title: "Nenhuma base cadastrada ainda",
            description: "Cadastre um texto ou envie um arquivo para os agentes começarem a consultar.",
            action: (
              <Button asChild>
                <Link href="/admin/knowledge/new">
                  <Plus /> Nova base
                </Link>
              </Button>
            ),
          }}
          noResultsTitle="Nenhuma base corresponde à busca ou aos filtros"
          itemLabel={["base", "bases"]}
          renderList={(documents) => <KnowledgeTable documents={documents} />}
          renderCards={(documents) => (
            <ListCardGrid>
              {documents.map((document) => (
                <KnowledgeCard key={document.id} document={document} products={productScope.labelsOf(document.id)} />
              ))}
            </ListCardGrid>
          )}
        />
      </CardContent>
    </Card>
  )
}
