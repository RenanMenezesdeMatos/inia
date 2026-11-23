"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { CalendarClock, ChevronDown, FileText, Globe2, Megaphone, Plus, Star, Users, Building2 } from "lucide-react"

import { AdminListView } from "@/components/admin/shared/list/admin-list-view"
import { EntityCard, EntityCardIcon, EntityCardTag } from "@/components/admin/shared/list/entity-card"
import { ListSearchInput, ListSelectFilter, ListToolbar, optionsFromLabels } from "@/components/admin/shared/list/list-filters"
import { ListCardGrid } from "@/components/admin/shared/list/list-states"
import { ListViewToggle } from "@/components/admin/shared/list/list-view-toggle"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { StatusChip } from "@/components/ui/surface"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { OperationalAlignmentsPage } from "@/components/operational-alignments/operational-alignments-page"
import { useAdminListState } from "@/hooks/use-admin-list-state"
import { formatDateTime } from "@/lib/format/date"
import { useCurrentUserQuery } from "@/queries/auth/use-current-user"
import { useModerationCommunicationsQuery, useMyCommunicationsQuery } from "@/queries/communications/use-communications"
import { COMMUNICATION_STATE_LABELS, type CommunicationState, type EditorialCommunicationSummary } from "@/schemas/communications/communication.schema"

import { newPublicationPath, publicationPath, STATE_TONES } from "./publication-form"
import { PublicationsFrame, usePublicationsAccess, type PublicationsTab } from "./publications-frame"
import { moderationPath, newAlignmentPath, PUBLICATIONS_PATH } from "./publications-route"

/** De quem: "Minhas" (área editorial) ou "Toda a organização" (moderação — só com `canModerateCommunications`). */
const OWNER_LABELS = { ALL: "Toda a organização" } as const
type Filters = { search: string; state: CommunicationState | undefined; owner: keyof typeof OWNER_LABELS | undefined }
const DEFAULT_FILTERS: Filters = { search: "", state: undefined, owner: undefined }

const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR")

const AUDIENCE_ICON = { TEAM: Users, ORGANIZATION: Building2, SEGMENT: Globe2 } as const
const AUDIENCE_LABEL = { TEAM: "Minha equipe", ORGANIZATION: "Toda a empresa", SEGMENT: "Público específico" } as const

/** Data que interessa em cada estado: rascunho = última alteração; agendado = quando sai; demais = quando saiu. */
function dateOf(item: EditorialCommunicationSummary): string {
  if (item.state === "DRAFT") return `Alterado em ${formatDateTime(item.updatedAt ?? item.createdAt)}`
  if (item.state === "SCHEDULED") return `Sai em ${formatDateTime(item.publishedAt!)}`
  if (item.state === "ARCHIVED") return `Arquivado em ${formatDateTime(item.archivedAt!)}`
  return `Publicado em ${formatDateTime(item.publishedAt!)}${item.displayUntil ? ` · até ${formatDateTime(item.displayUntil)}` : ""}`
}

/**
 * PUBLICAÇÕES — entrada da área editorial (Administração › Publicações). Lista as publicações de quem está logado (rascunho, agendado,
 * publicado, encerrado, arquivado), com busca, filtros e "Nova publicação". A lista vem inteira do servidor (as do autor, até 300)
 * e é filtrada e paginada aqui, com as mesmas peças das listas da Administração.
 */
function CommunicationsList() {
  const me = useCurrentUserQuery()
  const canModerate = me.data?.access.capabilities.canModerateCommunications ?? false
  const list = useAdminListState({ storageKey: "publications", defaultFilters: DEFAULT_FILTERS })
  const { state, owner } = list.filters
  const everyone = canModerate && owner === "ALL"
  const mine = useMyCommunicationsQuery()
  const moderation = useModerationCommunicationsQuery(everyone)
  const query = everyone ? moderation : mine
  const myPersonId = me.data?.personId
  const hrefOf = (item: EditorialCommunicationSummary) => (item.author.personId === myPersonId ? publicationPath(item.id) : moderationPath(item.id))
  const filtered = useMemo(() => {
    const term = normalize(list.params.search ?? "")
    return (query.data ?? []).filter((item) => (!state || item.state === state) && (!term || normalize(`${item.title} ${item.summary ?? ""} ${item.excerpt}`).includes(term)))
  }, [query.data, state, list.params.search])
  const page = useMemo(() => ({ items: filtered.slice((list.page - 1) * list.pageSize, list.page * list.pageSize), total: filtered.length, page: list.page, pageSize: list.pageSize }), [filtered, list.page, list.pageSize])

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-4">
          <ListToolbar
            search={<ListSearchInput value={list.filters.search} onChange={(value) => list.setFilter("search", value)} placeholder="Buscar por título, resumo ou texto" ariaLabel="Buscar publicação" pending={list.isSearchPending} />}
            viewToggle={<ListViewToggle value={list.view} onChange={list.setView} />}
            hasActiveFilters={list.hasActiveFilters}
            onClearFilters={list.resetFilters}
          >
            {canModerate ? <ListSelectFilter value={owner} onChange={(value) => list.setFilter("owner", value)} options={optionsFromLabels(OWNER_LABELS)} allLabel="Minhas publicações" ariaLabel="De quem" /> : null}
            <ListSelectFilter value={state} onChange={(value) => list.setFilter("state", value)} options={optionsFromLabels(COMMUNICATION_STATE_LABELS)} allLabel="Qualquer status" ariaLabel="Filtrar por status" />
          </ListToolbar>
          <AdminListView
            state={list}
            query={{ data: query.data ? page : undefined, isLoading: query.isLoading, isError: query.isError, error: query.error, isFetching: query.isFetching, isPlaceholderData: false, refetch: query.refetch }}
            errorMessage="Não foi possível carregar as publicações."
            empty={{ icon: Megaphone, title: "Nenhuma publicação ainda", description: "Comece um comunicado: você pode salvar como rascunho, pré-visualizar e publicar quando estiver pronto.", action: <Button asChild><Link href={newPublicationPath}><Plus data-icon="inline-start" />Nova publicação</Link></Button> }}
            noResultsTitle="Nenhuma publicação encontrada com esses filtros."
            itemLabel={["publicação", "publicações"]}
            renderList={(items) => (
              <div className={TABLE_FRAME}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Título</TableHead>
                      {everyone ? <TableHead className="hidden sm:table-cell">Autor</TableHead> : null}
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden md:table-cell">Público</TableHead>
                      <TableHead className="hidden lg:table-cell">Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const AudienceIcon = AUDIENCE_ICON[item.audience]
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="max-w-0 w-1/2">
                            <Link href={hrefOf(item)} className="block truncate font-medium hover:text-primary hover:underline" title={item.title}>
                              {item.featured ? <Star className="mr-1 inline size-3.5 fill-current text-amber-500" aria-label="Destaque" /> : null}{item.title}
                            </Link>
                            <span className="block truncate text-xs text-muted-foreground" title={item.summary ?? item.excerpt}>{item.summary || item.excerpt || (item.hasImages ? "Publicação com imagem" : "Sem conteúdo ainda")}</span>
                          </TableCell>
                          {everyone ? <TableCell className="hidden max-w-40 truncate text-sm sm:table-cell" title={item.author.jobTitle ?? undefined}>{item.author.personId === myPersonId ? "Você" : item.author.name}</TableCell> : null}
                          <TableCell><StatusChip tone={STATE_TONES[item.state]}>{COMMUNICATION_STATE_LABELS[item.state]}</StatusChip></TableCell>
                          <TableCell className="hidden md:table-cell"><span className="inline-flex items-center gap-1.5 text-sm"><AudienceIcon className="size-4 text-muted-foreground" aria-hidden />{AUDIENCE_LABEL[item.audience]}{item.state !== "DRAFT" ? <span className="text-muted-foreground">· {item.recipientCount.toLocaleString("pt-BR")}</span> : null}</span></TableCell>
                          <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{dateOf(item)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            renderCards={(items) => (
              <ListCardGrid>
                {items.map((item) => (
                  <EntityCard
                    key={item.id}
                    href={hrefOf(item)}
                    icon={<EntityCardIcon icon={item.state === "DRAFT" ? FileText : Megaphone} />}
                    kicker={<>Comunicado{everyone ? <><span aria-hidden>·</span>{item.author.personId === myPersonId ? "Você" : item.author.name}</> : null}{item.featured ? <><span aria-hidden>·</span>Destaque</> : null}</>}
                    title={item.title}
                    description={item.summary || item.excerpt}
                    descriptionFallback="Sem conteúdo ainda."
                    tags={<EntityCardTag icon={AUDIENCE_ICON[item.audience]}>{AUDIENCE_LABEL[item.audience]}</EntityCardTag>}
                    footerStart={<StatusChip tone={STATE_TONES[item.state]}>{COMMUNICATION_STATE_LABELS[item.state]}</StatusChip>}
                    footerEnd={<span className="text-xs text-muted-foreground">{dateOf(item)}</span>}
                  />
                ))}
              </ListCardGrid>
            )}
          />
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * PUBLICAÇÕES — a área editorial (Administração › Comunicação › Publicações), com os dois tipos de publicação:
 *   - Comunicados (só informação: aviso, novidade) — quem tem o papel de comunicados;
 *   - Alinhamentos operacionais (orientação temporária de processo, com vigência, público e responsável) — quem gerencia alinhamentos.
 *     É a MESMA tela de Atendimento com IA › Alinhamentos operacionais, por dentro (mesma fonte, mesmas regras).
 * A aba fica no endereço (`?tipo=alinhamentos`; `&novo=1` abre o formulário) para o "Nova publicação" e para voltar ao mesmo lugar.
 */
export function PublicationsListPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isLoading, canPublish, canManageAlignments } = usePublicationsAccess()
  const requested: PublicationsTab = searchParams.get("tipo") === "alinhamentos" ? "alinhamentos" : "comunicados"
  const tab: PublicationsTab = !canPublish && canManageAlignments ? "alinhamentos" : requested === "alinhamentos" && !canManageAlignments ? "comunicados" : requested
  const startWithNew = searchParams.get("novo") === "1"
  const setTab = (next: PublicationsTab) => router.replace(next === "alinhamentos" ? `${PUBLICATIONS_PATH}?tipo=alinhamentos` : PUBLICATIONS_PATH)
  // Formulário de alinhamento aberto: sem o cabeçalho e as abas da área, igual ao editor de comunicado (que é outra página).
  const [alignmentEditorOpen, setAlignmentEditorOpen] = useState(false)

  const newButton = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button><Plus data-icon="inline-start" />Nova publicação<ChevronDown data-icon="inline-end" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>O que você quer publicar?</DropdownMenuLabel>
        {canPublish ? <DropdownMenuItem asChild>
          <Link href={newPublicationPath} className="items-start">
            <Megaphone className="mt-0.5" />
            <span><span className="block font-medium">Comunicado</span><span className="block text-xs text-muted-foreground">Aviso ou novidade. Não é orientação de conduta nem muda o procedimento.</span></span>
          </Link>
        </DropdownMenuItem> : null}
        {canManageAlignments ? (
          <DropdownMenuItem asChild>
            <Link href={newAlignmentPath} className="items-start">
              <CalendarClock className="mt-0.5" />
              <span><span className="block font-medium">Alinhamento operacional</span><span className="block text-xs text-muted-foreground">Orientação temporária que muda um ponto do procedimento, com vigência e público.</span></span>
            </Link>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (isLoading) return null
  return (
    <PublicationsFrame tab={tab} onTabChange={setTab} actions={newButton} hideHeader={tab === "alinhamentos" && alignmentEditorOpen}>
      {tab === "alinhamentos" ? <OperationalAlignmentsPage key={startWithNew ? "novo" : "lista"} embedded startWithNew={startWithNew} onEditorOpenChange={setAlignmentEditorOpen} /> : <CommunicationsList />}
    </PublicationsFrame>
  )
}
