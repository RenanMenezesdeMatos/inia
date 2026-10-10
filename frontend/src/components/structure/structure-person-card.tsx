"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowUp, ChevronDown, CircleHelp, Footprints, Network, ShieldAlert, UserRound } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatCount, initials } from "@/lib/analytics/format"
import { cn } from "@/lib/utils"
import { ROLE_PLURAL_LABELS, ROLE_UNIT_LABELS, STRUCTURE_STATUS_BUCKET_LABELS, type ManagementMetrics, type StructurePerson } from "@/schemas/org-structure/person-structure.schema"

/** As três perguntas que o card expandido responde, sem misturar conceitos. */
export type CardSection = "person" | "structure" | "reportsTo"

export const CARD_SECTION_LABELS: Record<CardSection, string> = {
  person: "Dados do colaborador",
  structure: "Dados da estrutura",
  reportsTo: "Reporta-se à",
}

/** Rótulo curto visível na aba (o nome completo fica no `aria-label`/Tooltip) — três abas cabem em 400px sem overflow. */
export const CARD_SECTION_SHORT_LABELS: Record<CardSection, string> = {
  person: "Colaborador",
  structure: "Estrutura",
  reportsTo: "Reporta-se à",
}

/** Pedido de abrir o card numa seção específica (affordance de estrutura); `token` distingue pedidos repetidos. */
export type CardSectionRequest = { section: CardSection; token: number }

export const SPAN_TOOLTIP = "Span de controle: quantidade de pessoas que se reportam diretamente a este gestor."

/** Orientação persistente: o card que é o próximo trecho da cadeia real até quem está logado. */
export const VIEWER_PATH_LABEL = "Sua estrutura"
export const VIEWER_PATH_TOOLTIP = "Este caminho leva até você."
export type ViewerPathState = "next" | "on" | null

export type StructurePersonCardProps = {
  person: StructurePerson
  /** Expandido = a pessoa selecionada: os dados aparecem DENTRO do próprio card, em seções. */
  expanded: boolean
  /** `root` = a pessoa focal (card mais largo, avatar maior); `node` = subordinado direto; `manager` = o gestor
   * imediato acima da focal — card compacto cujo clique inteiro significa "subir um nível" (abre a estrutura dele). */
  variant?: "root" | "node" | "manager"
  /** A pessoa logada — marcador discreto "Você". */
  isViewer?: boolean
  /** Gestor direto conhecido no payload (seção "Reporta-se à"). */
  directManager?: StructurePerson | null
  /** Nota sobre o gestor direto quando o cadastrado está inativo (a cadeia segue do próximo nível ativo). */
  directManagerNote?: string | null
  /** Seção inicial ao expandir — só muda quando o usuário clica numa affordance de estrutura ("N diretos"). */
  sectionRequest?: CardSectionRequest | null
  /** Destaque de chegada (a câmera acabou de conduzir até este card). */
  arrived?: boolean
  /** `next` = este é o próximo trecho do caminho até o viewer: destaque PERSISTENTE (ring, sombra, badge, texto acessível), sem mudar tamanho. */
  viewerPath?: ViewerPathState
  onSelect: (person: StructurePerson, section?: CardSection) => void
  /** "Abrir estrutura" — só é oferecido quando o backend disse hasReports E canViewStructure, e nunca na própria raiz. */
  onOpenStructure?: (personId: string) => void
  profileHref?: (personId: string) => string
  className?: string
}

/**
 * O node do organograma. HEADER FIXO (avatar do Design System, nome, cargo, área e "N diretos")
 * que nunca muda ao trocar de seção + SEÇÕES abaixo, no card expandido:
 *  - "Dados do colaborador" — quem é a pessoa profissionalmente (e-mail corporativo, Grupo,
 *    Subgrupo, capital operacional, gestor direto); nunca performance, PRV, quartil, feedback,
 *    dado médico ou contato pessoal;
 *  - "Dados da estrutura" — como está organizada e distribuída a estrutura que ela lidera; só
 *    existe quando o backend mandou `managementMetrics` (gestão/Admin olhando um líder);
 *  - "Reporta-se à" — onde ela está posicionada acima: o gestor imediato, clicável.
 * Clicar no header seleciona (zero request); "Abrir estrutura" (hasReports E canViewStructure)
 * e "Ver perfil" (canViewProfile) têm capabilities INDEPENDENTES decididas pelo backend. Largura
 * FIXA (focal 400px, subordinado 300px): a expansão cresce só para baixo, nunca invade vizinhos;
 * no card de 300px as abas viram ícones com Tooltip e texto acessível.
 */
export function StructurePersonCard({ person, expanded, variant = "node", isViewer = false, directManager = null, directManagerNote = null, sectionRequest = null, arrived = false, viewerPath = null, onSelect, onOpenStructure, profileHref, className }: StructurePersonCardProps) {
  const root = variant === "root"
  if (variant === "manager") return <ManagerCard person={person} isViewer={isViewer} arrived={arrived} viewerPath={viewerPath} onOpenStructure={onOpenStructure} className={className} />
  const pathNext = viewerPath === "next"
  const navigable = person.capabilities.hasReports && person.capabilities.canViewStructure
  const canOpen = navigable && !root && onOpenStructure !== undefined
  const canViewProfile = person.capabilities.canViewProfile && profileHref !== undefined
  const title = person.jobTitle ?? person.roleLabel
  const area = areaOf(person, title)
  const metrics = person.managementMetrics ?? null
  const directs = person.capabilities.hasReports && person.directReportCount !== null ? person.directReportCount : null
  const production = metrics?.statusDistribution.find((share) => share.bucket === "EM_PRODUCAO")?.count ?? null

  return (
    <div
      data-slot="structure-person-card"
      data-state={expanded ? "expanded" : "compact"}
      data-focal={root || undefined}
      data-arrived={arrived || undefined}
      data-viewer-path={viewerPath ?? undefined}
      className={cn(
        "flex flex-col rounded-xl bg-card text-left shadow-xs ring-1 transition-[box-shadow,background-color]",
        root ? "w-[25rem]" : "w-[18.75rem]",
        expanded ? "ring-primary/70" : "ring-border hover:ring-primary/40",
        // Caminho até o viewer: ring de destaque + sombra discreta, sempre — sem mudar largura/altura.
        pathNext && "ring-2 ring-primary/60 shadow-md shadow-primary/15",
        arrived && "inia-flow-arrival",
        className,
      )}
    >
      {/* Header fixo: nunca muda ao trocar de seção. */}
      <div className={cn("flex items-start gap-2", root ? "px-4 py-3.5" : "px-3 py-2.5")}>
        <button
          type="button"
          onClick={() => onSelect(person)}
          aria-expanded={expanded}
          aria-label={`Ver detalhes de ${person.name}${expanded ? " (selecionada)" : ""}${pathNext ? `. ${person.roleLabel}. ${VIEWER_PATH_TOOLTIP}` : ""}`}
          className={cn("flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-muted", !root && "min-h-[3.75rem]")}
        >
          <Avatar className={cn("shrink-0", root ? "size-16" : "size-11")}>
            <AvatarImage src={person.avatarUrl ?? undefined} alt={person.name} />
            <AvatarFallback className={root ? "text-base" : "text-xs"}>{initials(person.name)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className={cn("flex items-center gap-1.5 leading-tight", root ? "text-lg font-semibold" : "text-sm font-medium")}>
              <span className="truncate">{person.name}</span>
              {isViewer ? <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary">Você</span> : null}
              {pathNext && !isViewer ? <ViewerPathBadge /> : null}
            </span>
            <span className={cn("block text-muted-foreground", root ? "line-clamp-2 text-sm" : "truncate text-xs")}>{title}</span>
            {area ? <span className={cn("block truncate text-muted-foreground/80", root ? "text-xs" : "text-[11px]")}>{area}</span> : null}
          </span>
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-180")} aria-hidden />
          {/* "N diretos" no header; no card compacto de gestão a linha de resumo abaixo já o diz — sem repetir. */}
          {directs !== null && (expanded || production === null) ? (
            <Tooltip>
              <TooltipTrigger asChild>
                {metrics ? (
                  <button type="button" onClick={() => onSelect(person, "structure")} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`${formatCount(directs, "direto", "diretos")} — abrir dados da estrutura`}>
                    {formatCount(directs, "direto", "diretos")}
                  </button>
                ) : (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground" tabIndex={0}>
                    {formatCount(directs, "direto", "diretos")}
                  </span>
                )}
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{SPAN_TOOLTIP}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {!expanded && directs !== null && production !== null ? (
        // Affordance de estrutura: a linha de resumo abre o card DIRETO em "Dados da estrutura".
        <button type="button" onClick={() => onSelect(person, "structure")} aria-label={`${formatCount(directs, "direto", "diretos")} · ${production} em produção — abrir dados da estrutura`} className={cn("border-t border-border text-left text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary", root ? "px-4 py-1.5" : "px-3 py-1.5")} data-testid="structure-compact-summary">
          {formatCount(directs, "direto", "diretos")} · {production} em produção
        </button>
      ) : null}

      {expanded ? (
        <div className={cn("border-t border-border", root ? "px-4 pb-3.5 pt-2" : "px-3 pb-3 pt-1.5")} data-testid="structure-person-details">
          <CardSections person={person} root={root} isViewer={isViewer} directManager={directManager} directManagerNote={directManagerNote} metrics={metrics} sectionRequest={sectionRequest} onOpenStructure={onOpenStructure} iconsOnly={!root} />
          {canOpen || canViewProfile ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {canOpen ? (
                <Button type="button" size="sm" className="h-7 text-xs" onClick={() => onOpenStructure(person.personId)}>
                  <Network aria-hidden /> Abrir estrutura
                </Button>
              ) : null}
              {canViewProfile ? (
                <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                  <Link href={profileHref(person.personId)}>
                    <UserRound aria-hidden /> Ver perfil
                  </Link>
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

type SectionsProps = {
  person: StructurePerson
  root: boolean
  isViewer: boolean
  directManager: StructurePerson | null
  directManagerNote: string | null
  metrics: ManagementMetrics | null
  sectionRequest: CardSectionRequest | null
  onOpenStructure?: (personId: string) => void
  /** Card estreito (300px): abas só com ícone + Tooltip + texto acessível — nunca texto ilegível nem overflow. */
  iconsOnly: boolean
}

const SECTION_ICONS: Record<CardSection, typeof UserRound> = { person: UserRound, structure: Network, reportsTo: ArrowUp }

/**
 * Estado da seção é LOCAL de UI (nunca na URL): nasce em "Dados do colaborador" e só começa
 * noutra seção quando uma affordance de estrutura pediu (`sectionRequest`, aplicado durante o
 * render). Trocar de seção nunca faz request — tudo já veio no payload.
 */
function CardSections({ person, root, isViewer, directManager, directManagerNote, metrics, sectionRequest, onOpenStructure, iconsOnly }: SectionsProps) {
  const [section, setSection] = useState<CardSection>(sectionRequest?.section ?? "person")
  const [appliedToken, setAppliedToken] = useState<number | null>(sectionRequest?.token ?? null)
  if (sectionRequest && sectionRequest.token !== appliedToken) {
    setAppliedToken(sectionRequest.token)
    setSection(sectionRequest.section)
  }
  const sections: CardSection[] = metrics ? ["person", "structure", "reportsTo"] : ["person", "reportsTo"]
  const active = sections.includes(section) ? section : "person"

  return (
    <Tabs value={active} onValueChange={(value) => setSection(value as CardSection)}>
      <TabsList className={cn("h-auto w-full justify-start gap-3 border-b border-border", iconsOnly && "gap-1")} aria-label="Seções do card">
        {sections.map((key) => {
          const Icon = SECTION_ICONS[key]
          const content = (
            <span className="inline-flex items-center gap-1.5">
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className={cn("whitespace-nowrap", iconsOnly && "sr-only")}>{iconsOnly ? CARD_SECTION_LABELS[key] : CARD_SECTION_SHORT_LABELS[key]}</span>
            </span>
          )
          // O Tooltip envolve o CONTEÚDO, não o trigger da aba: como Slot ele sobrescreveria `data-state`/`data-slot` do Radix Tabs.
          return (
            <TabsTrigger key={key} value={key} className={cn("pb-2 text-xs", iconsOnly && "px-2")} data-section={key} aria-label={CARD_SECTION_LABELS[key]}>
              {iconsOnly ? (
                <Tooltip>
                  <TooltipTrigger asChild>{content}</TooltipTrigger>
                  <TooltipContent>{CARD_SECTION_LABELS[key]}</TooltipContent>
                </Tooltip>
              ) : (
                content
              )}
            </TabsTrigger>
          )
        })}
      </TabsList>

      <TabsContent value="person" data-testid="section-person">
        <PersonSection person={person} root={root} isViewer={isViewer} directManager={directManager} directManagerNote={directManagerNote} />
      </TabsContent>
      {metrics ? (
        <TabsContent value="structure" data-testid="section-structure">
          <StructureSection person={person} metrics={metrics} />
        </TabsContent>
      ) : null}
      <TabsContent value="reportsTo" data-testid="section-reports-to">
        <ReportsToSection manager={directManager} note={directManagerNote} onOpenStructure={onOpenStructure} />
      </TabsContent>
    </Tabs>
  )
}

function PersonSection({ person, root, isViewer, directManager, directManagerNote }: { person: StructurePerson; root: boolean; isViewer: boolean; directManager: StructurePerson | null; directManagerNote: string | null }) {
  // O papel técnico só entra quando agrega ao cargo (ex.: cargo "Analista de Qualidade", papel "Supervisor").
  const showRole = person.jobTitle !== null && !person.jobTitle.toLowerCase().includes(person.roleLabel.toLowerCase())
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
      {showRole ? <Field label="Papel" value={person.roleLabel} /> : null}
      <Field label="E-mail" value={person.email} wide />
      {person.operationalCapital !== undefined && person.operationalCapital !== null ? <Field label="Capital operacional" hint="Jurisdição de calendário" value={person.operationalCapital.label} /> : null}
      {person.group !== undefined ? <Field label="Grupo" value={person.group?.name ?? null} /> : null}
      {person.subgroup !== undefined ? <Field label="Subgrupo" value={person.subgroup?.name ?? null} /> : null}
      <Field label="Gestor direto" value={directManager ? directManager.name : null} placeholder={root || isViewer ? "Não informado" : "—"} hint={directManagerNote} />
      {!person.capabilities.hasReports && !root ? <Field label="Estrutura" value="Sem subordinados diretos" muted /> : null}
    </dl>
  )
}

/**
 * "Dados da estrutura": compacto, tipográfico — quantidade + porcentagem lado a lado com o
 * denominador único que o backend mandou; span, abrangência, médias por camada e referência do
 * Grupo como linhas simples com Tooltip para o conceito. Nunca avaliação (sem bom/ruim/ideal/cor).
 */
function StructureSection({ person, metrics }: { person: StructurePerson; metrics: ManagementMetrics }) {
  const first = person.name.split(" ")[0] ?? person.name
  const unit = (role: string) => ROLE_UNIT_LABELS[role] ?? role.toLowerCase()
  const plural = (role: string, count: number) => formatCount(count, ROLE_PLURAL_LABELS[role]?.[0] ?? role, ROLE_PLURAL_LABELS[role]?.[1] ?? role)
  const pluralUnit = (role: string, count: number) => (count === 1 ? unit(role) : pluralOfUnit(unit(role)))
  return (
    <div className="space-y-2 text-xs" data-testid="structure-metrics">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">Estrutura atual</span>
        <span className="text-sm font-semibold tabular-nums" data-testid="structural-population">
          {formatCount(metrics.structuralPopulation, "pessoa", "pessoas")}
        </span>
      </div>
      {metrics.roleCounts.length > 1 ? <p className="text-[11px] text-muted-foreground">{metrics.roleCounts.map((entry) => plural(entry.role, entry.count)).join(" · ")}</p> : null}
      <dl className="space-y-0.5" aria-label="Situação atual da estrutura">
        {metrics.statusDistribution.map((share) => (
          <div key={share.bucket} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3" data-bucket={share.bucket}>
            <dt className={cn("truncate", share.count === 0 ? "text-muted-foreground" : "")}>{STRUCTURE_STATUS_BUCKET_LABELS[share.bucket]}</dt>
            <dd className={cn("tabular-nums", share.count === 0 ? "text-muted-foreground" : "font-medium")}>{share.count}</dd>
            <dd className="w-12 text-right tabular-nums text-muted-foreground">{formatDecimal(share.percent)}%</dd>
          </div>
        ))}
      </dl>
      {metrics.privacy.sensitiveBreakdownSuppressed ? (
        <p className="flex items-start gap-1 text-[11px] text-muted-foreground" data-testid="privacy-note">
          <ShieldAlert className="mt-0.5 size-3 shrink-0" aria-hidden /> Detalhamento de afastamentos indisponível para estruturas pequenas (menos de {metrics.privacy.minimumPopulation} pessoas).
        </p>
      ) : null}
      {metrics.confidence.unconfirmed > 0 ? (
        <p className="text-[11px] text-muted-foreground" data-testid="unconfirmed-note">
          Fonte de situação funcional atrasada: {formatCount(metrics.confidence.unconfirmed, "situação não confirmada", "situações não confirmadas")} (não presumimos “em produção”).
        </p>
      ) : null}
      <Separator />
      <dl className="space-y-1">
        <MetricRow label="Span de controle" value={formatCount(metrics.directSpan, "direto", "diretos")} tooltip={`Quantidade de pessoas que se reportam diretamente a ${first}. Ausências temporárias (férias, INSS, maternidade, paternidade) não alteram o span.`} testId="metric-span" />
        <MetricRow label="Abrangência operacional" value={formatCount(metrics.operatorReach, "operador", "operadores")} tooltip={`Operadores existentes abaixo de ${first}, em qualquer nível da estrutura.`} testId="metric-reach" />
        {metrics.layerMetrics.map((layer) => (
          <MetricRow key={`${layer.managerRole}-${layer.reportRole}`} label="Média da estrutura" value={`${formatDecimal(layer.average)} ${pluralUnit(layer.reportRole, 2)} / ${unit(layer.managerRole)}`} tooltip={`${plural(layer.reportRole, layer.reports)} para ${plural(layer.managerRole, layer.managers)} na estrutura de ${first} — calculado das relações reais de reporte, nunca pelo cargo.`} testId="metric-layer" />
        ))}
        {metrics.groupBenchmark ? (
          <MetricRow label="Referência do Grupo" value={`${formatDecimal(metrics.groupBenchmark.averageDirectSpan)} diretos / ${unit(metrics.groupBenchmark.peerRole)}`} detail={`${formatCount(metrics.groupBenchmark.peerCount, pluralUnit(metrics.groupBenchmark.peerRole, 1), pluralUnit(metrics.groupBenchmark.peerRole, 2))} em ${metrics.groupBenchmark.groupName}`} tooltip={`Média do span de controle dos pares de mesmo cargo no Grupo ${metrics.groupBenchmark.groupName}. Informação descritiva — não é avaliação.`} testId="metric-benchmark" />
        ) : null}
      </dl>
    </div>
  )
}

function MetricRow({ label, value, detail = null, tooltip, testId }: { label: string; value: string; detail?: string | null; tooltip: string; testId: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-2" data-testid={testId}>
      <dt className="flex items-center gap-1 text-muted-foreground">
        <span className="truncate">{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="shrink-0 text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`Sobre ${label.toLowerCase()}`}>
              <CircleHelp className="size-3" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
        </Tooltip>
      </dt>
      <dd className="text-right font-medium tabular-nums">
        {value}
        {detail ? <span className="block text-[11px] font-normal text-muted-foreground">{detail}</span> : null}
      </dd>
    </div>
  )
}

/** "Reporta-se à": só o gestor imediato — clicável para abrir a estrutura dele; no topo, um estado explícito. */
function ReportsToSection({ manager, note, onOpenStructure }: { manager: StructurePerson | null; note: string | null; onOpenStructure?: (personId: string) => void }) {
  if (!manager) {
    return (
      <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground" data-testid="reports-to-top">
        Topo da estrutura organizacional — ninguém acima no cadastro.
      </p>
    )
  }
  const title = manager.jobTitle ?? manager.roleLabel
  const area = areaOf(manager, title)
  const canOpen = manager.capabilities.canViewStructure && onOpenStructure !== undefined
  return (
    <div className="flex items-center gap-2.5" data-testid="reports-to">
      <button type="button" onClick={canOpen ? () => onOpenStructure(manager.personId) : undefined} disabled={!canOpen} aria-label={canOpen ? `Abrir estrutura de ${manager.name}` : `${manager.name}, ${title}`} className={cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", canOpen ? "hover:bg-muted/40" : "cursor-default")}>
        <Avatar className="size-9 shrink-0">
          <AvatarImage src={manager.avatarUrl ?? undefined} alt={manager.name} />
          <AvatarFallback className="text-[10px]">{initials(manager.name)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{manager.name}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{title}</span>
          {area ? <span className="block truncate text-[11px] text-muted-foreground/80">{area}</span> : null}
          {note ? <span className="block text-[10px] text-muted-foreground">{note}</span> : null}
        </span>
      </button>
      {canOpen ? (
        <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={() => onOpenStructure(manager.personId)}>
          <ArrowUp aria-hidden /> Abrir estrutura
        </Button>
      ) : null}
    </div>
  )
}

/**
 * O gestor imediato acima da focal: mesma família visual, sempre compacto, e o card INTEIRO é o
 * botão "Abrir estrutura de <nome>" — subir um nível não exige expandir antes. Só é oferecido
 * quando o backend disse `canViewStructure`.
 */
function ManagerCard({ person, isViewer, arrived, viewerPath, onOpenStructure, className }: { person: StructurePerson; isViewer: boolean; arrived: boolean; viewerPath: ViewerPathState; onOpenStructure?: (personId: string) => void; className?: string }) {
  const title = person.jobTitle ?? person.roleLabel
  const area = areaOf(person, title)
  const canOpen = person.capabilities.canViewStructure && onOpenStructure !== undefined
  return (
    <div data-slot="structure-person-card" data-state="compact" data-variant="manager" data-arrived={arrived || undefined} data-viewer-path={viewerPath ?? undefined} className={cn("flex w-[18rem] flex-col rounded-xl bg-card text-left shadow-xs ring-1 ring-border", canOpen && "hover:ring-primary/40", arrived && "inia-flow-arrival", className)}>
      <button
        type="button"
        onClick={canOpen ? () => onOpenStructure(person.personId) : undefined}
        disabled={!canOpen}
        aria-label={canOpen ? `Abrir estrutura de ${person.name}` : `${person.name}, ${title}`}
        title={canOpen ? "Subir um nível" : undefined}
        className={cn("flex min-h-[4.5rem] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-muted", canOpen ? "hover:bg-muted/40" : "cursor-default")}
      >
        <Avatar className="size-10 shrink-0">
          <AvatarImage src={person.avatarUrl ?? undefined} alt={person.name} />
          <AvatarFallback className="text-xs">{initials(person.name)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium leading-tight">
            <span className="truncate">{person.name}</span>
            {isViewer ? <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary">Você</span> : null}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{title}</span>
          {area ? <span className="block truncate text-[11px] text-muted-foreground/80">{area}</span> : null}
        </span>
        {canOpen ? <ArrowUp className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
      </button>
    </div>
  )
}

/** Badge discreto do caminho persistente — o texto acessível completo vai no aria-label do header. */
function ViewerPathBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary" data-testid="viewer-path-badge">
          <Footprints className="size-2.5" aria-hidden /> {VIEWER_PATH_LABEL}
        </span>
      </TooltipTrigger>
      <TooltipContent>{VIEWER_PATH_TOOLTIP}</TooltipContent>
    </Tooltip>
  )
}

/** Linha secundária do header: Grupo · Subgrupo, sem repetir o que o cargo já diz (a massa demo grava "Supervisora — B2C · Atendimento Geral" como cargo). */
function areaOf(person: StructurePerson, title: string): string | null {
  const parts = [person.group?.name, person.subgroup?.name].filter((part): part is string => typeof part === "string" && part.length > 0 && !title.toLowerCase().includes(part.toLowerCase()))
  return parts.length > 0 ? parts.join(" · ") : null
}

/** Sempre 1 casa decimal (86,7% · 0,0% · 25,0): coluna alinhada e padrão único na aba — o backend já arredondou. */
const decimalFormatter = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
function formatDecimal(value: number): string {
  return decimalFormatter.format(value)
}

/** "supervisão" → "supervisões", "coordenação" → "coordenações", "gerência" → "gerências", "operador" → "operadores". */
function pluralOfUnit(unit: string): string {
  if (unit.endsWith("ão")) return `${unit.slice(0, -2)}ões`
  if (unit.endsWith("ência sênior")) return `${unit.slice(0, -12)}ências sêniores`
  if (unit.endsWith("or")) return `${unit}es`
  return `${unit}s`
}

function Field({ label, value, placeholder = "Não informado", hint = null, muted = false, wide = false }: { label: string; value: string | null; placeholder?: string; hint?: string | null; muted?: boolean; wide?: boolean }) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("break-words text-xs leading-snug", value && !muted ? "font-medium" : "text-muted-foreground")}>
        {value ?? placeholder}
        {hint ? <span className="block text-[10px] font-normal text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  )
}
