"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { Activity, Ban, BookA, BookOpen, Bot, Boxes, CalendarDays, ChevronRight, ClipboardList, Cpu, Database, Flag, FlaskConical, Gauge, HeartHandshake, ImageIcon, Layers, LifeBuoy, MessageSquareWarning, MessagesSquare, PhoneCall, ShieldCheck, Users, Waypoints, Zap, type LucideIcon } from "lucide-react"

import { HUMAN_SUPPORT_ADMIN_PATH, HUMAN_SUPPORT_MONITORING_PATH } from "@/components/human-support/monitoring/human-support-monitoring-route"
import { cn } from "@/lib/utils"
import type { AccessCapabilities } from "@/schemas/auth/auth.schema"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type Capability = keyof AccessCapabilities
type ActiveMatcher = (pathname: string, searchParams: URLSearchParams) => boolean

/** Destino do menu. A capability (derivada das permissões dos papéis) só mostra o item — é UX; o backend autoriza cada rota. */
type NavPage = {
  href: string
  label: string
  icon: LucideIcon
  capability: Capability
  /** Quando o destino é uma aba de uma página (`?tab=`), a regra de "estou aqui" não é só o caminho. */
  isActive?: ActiveMatcher
}

/**
 * Item do menu: uma página (com ou sem subpáginas) ou só um agrupador de subpáginas (sem `href`, ex.: Governança).
 * Subpágina = área que pertence à página de cima (Base de conhecimento e Domínios de negócio pertencem aos Agentes;
 * o Calendário operacional pertence à Central de Dados).
 */
type NavEntry = {
  label: string
  icon: LucideIcon
  href?: string
  capability?: Capability
  children?: NavPage[]
}

type NavGroup = { label: string; entries: NavEntry[] }

const governanceTab = (tab: "prohibited" | "glossary"): ActiveMatcher => (pathname, searchParams) =>
  pathname.startsWith("/admin/governance") && (searchParams.get("tab") === "glossary" ? "glossary" : "prohibited") === tab

const GROUPS: NavGroup[] = [
  {
    label: "Dados",
    entries: [
      {
        href: "/admin/data-hub",
        label: "Central de Dados",
        icon: Database,
        capability: "canManageDataHub",
        // Feriados e política de feriado: overlay do fallback seg–sex — escala explícita da fonte vence feriado.
        children: [{ href: "/admin/operational-calendar", label: "Calendário operacional", icon: CalendarDays, capability: "canManageConfiguration" }],
      },
      { href: "/admin/indicators", label: "Indicadores", icon: Gauge, capability: "canManageConfiguration" },
      { href: "/admin/channel-flags", label: "Flags de canal", icon: Flag, capability: "canManageConfiguration" },
    ],
  },
  {
    label: "Atendimento com IA",
    entries: [
      {
        href: "/admin/agents",
        label: "Agentes",
        icon: Bot,
        capability: "canManageAgents",
        children: [
          // Bases vinculadas aos Agents (cada especialista consulta só as dele).
          { href: "/admin/knowledge", label: "Base de conhecimento", icon: BookOpen, capability: "canManageKnowledge" },
          // Produtos, critérios de identificação e a que produtos cada fonte se aplica (aplicabilidade antes do julgamento).
          { href: "/admin/product-catalog", label: "Produtos", icon: Boxes, capability: "canManageConfiguration" },
          // Catálogo que classifica Agents (Especialista de domínio) e restringe Orquestradores (Domínios específicos).
          { href: "/admin/business-domains", label: "Domínios de negócio", icon: Layers, capability: "canManageConfiguration" },
        ],
      },
      { href: "/admin/assistant", label: "Orquestrador da INIA", icon: Waypoints, capability: "canManageAgents" },
      { href: "/admin/argument-scripts", label: "Argumentários", icon: PhoneCall, capability: "canManageConfiguration" },
      {
        // Guardrails globais da IA — somados às restrições de cada Agent, nunca substituídos.
        label: "Governança",
        icon: ShieldCheck,
        children: [
          { href: "/admin/governance?tab=prohibited", label: "Assuntos proibidos", icon: Ban, capability: "canManageConfiguration", isActive: governanceTab("prohibited") },
          { href: "/admin/governance?tab=glossary", label: "Glossário geral", icon: BookA, capability: "canManageConfiguration", isActive: governanceTab("glossary") },
        ],
      },
      // Providers, conexões, modelos, roteamento por Use Case, custo e orçamento de IA da organização.
      { href: "/admin/ai", label: "IA / Modelos", icon: Cpu, capability: "canViewAi" },
    ],
  },
  {
    label: "Automação",
    entries: [
      { href: "/admin/workflows", label: "Workflows", icon: Zap, capability: "canManageWorkflows" },
      // Quando observar, orientar, treinar, abrir plano ou encaminhar — tipos de intervenção, competências e políticas versionadas.
      { href: "/admin/intervention-policies", label: "Políticas de acompanhamento", icon: ClipboardList, capability: "canAccessInterventionPolicies" },
      { href: "/admin/simulate", label: "QA Lab", icon: FlaskConical, capability: "canUseQaLab" },
    ],
  },
  {
    label: "Monitoramento",
    // Leitura das conversas reais com a INIA (somente leitura) e Monitoria de usabilidade (uso do produto), no escopo da conta.
    entries: [
      { href: "/admin/conversations", label: "Conversas com a INIA", icon: MessagesSquare, capability: "canViewAssistantConversations" },
      // Contestações dos colaboradores sobre feedbacks da INIA ("não foi útil") — revisão humana com resposta.
      { href: "/admin/feedback-contestations", label: "Contestações de feedback", icon: MessageSquareWarning, capability: "canReviewFeedbackContestations" },
      { href: "/admin/usability", label: "Monitoria de usabilidade", icon: Activity, capability: "canViewUsability" },
      // Painel do apoio: funil das respostas da INIA e do apoio, pedidos, tentativas sem Anjo e atividade dos Anjos do escopo.
      { href: HUMAN_SUPPORT_MONITORING_PATH, label: "Apoio com Anjo", icon: LifeBuoy, capability: "canCoordinateHumanSupport" },
    ],
  },
  {
    label: "Plataforma",
    entries: [
      { href: "/admin/users", label: "Usuários e acessos", icon: Users, capability: "canOpenUsersAndAccess" },
      // Cenário atrás do avatar (padrão e sazonais) — só o Administrador geral.
      { href: "/admin/inia-scenes", label: "Cenário da INIA", icon: ImageIcon, capability: "canManageIniaScenes" },
      // Chave geral, escopos (Grupo › Subgrupos) e capacidade dos Anjos — só o Administrador geral.
      { href: HUMAN_SUPPORT_ADMIN_PATH, label: "Apoio com Anjo", icon: HeartHandshake, capability: "canManageHumanSupport" },
    ],
  },
]

/** Item já filtrado pelas capabilities da conta. */
type VisibleEntry = { label: string; icon: LucideIcon; page: NavPage | null; children: NavPage[] }

/**
 * O menu mostra só o que a conta alcança. Subpágina sem a página de cima (ex.: só gerencia bases, não Agents) sobe para o
 * primeiro nível — nunca fica um agrupador vazio nem um agrupador com um item só.
 */
export function visibleEntries(entries: NavEntry[], capabilities: AccessCapabilities): VisibleEntry[] {
  return entries.flatMap((entry): VisibleEntry[] => {
    const children = (entry.children ?? []).filter((child) => capabilities[child.capability])
    const page = entry.href && entry.capability && capabilities[entry.capability] ? { href: entry.href, label: entry.label, icon: entry.icon, capability: entry.capability } : null
    if (page) return [{ label: entry.label, icon: entry.icon, page, children }]
    if (!entry.href && children.length > 1) return [{ label: entry.label, icon: entry.icon, page: null, children }]
    return children.map((child) => ({ label: child.label, icon: child.icon, page: child, children: [] }))
  })
}

function onPath(href: string, pathname: string) {
  const [path] = href.split("?")
  return pathname === path || pathname.startsWith(`${path}/`)
}

function isPageActive(page: NavPage, pathname: string, searchParams: URLSearchParams) {
  return page.isActive ? page.isActive(pathname, searchParams) : onPath(page.href, pathname)
}

const navButtonClass = (state: "active" | "idle") =>
  cn(
    state === "active" && "!bg-primary/10 !text-primary data-active:!bg-primary/10 data-active:!text-primary data-active:!font-medium",
    state === "idle" && "!bg-transparent !text-muted-foreground hover:!bg-muted hover:!text-foreground",
  )

/**
 * Abrir/fechar um item com subpáginas é UM movimento só: altura das subpáginas, fundo do grupo, tamanho e cor do item de cima
 * e giro da seta andam juntos, no mesmo tempo e curva. Com movimento reduzido, tudo muda sem animação.
 */
const BRANCH_MOTION = "duration-300 ease-in-out motion-reduce:transition-none motion-reduce:animate-none"

/**
 * Linha do item com subpáginas (aberto ou fechado — a transição vale nos dois sentidos). Largura/altura/padding mantêm os
 * 150 ms do recolher do menu; tamanho do texto, cor, fundo e o "negrito" usam o tempo do accordion.
 */
const BRANCH_ROW_MOTION =
  "[transition-property:width,height,padding,font-size,color,background-color,text-shadow] [transition-duration:150ms,150ms,150ms,300ms,300ms,300ms,300ms] ease-in-out motion-reduce:transition-none [&>svg]:transition-[width,height] [&>svg]:duration-300 [&>svg]:ease-in-out motion-reduce:[&>svg]:transition-none"

/**
 * Item com subpáginas ABERTO: levemente maior e roxo (texto, ícone e seta) — as subpáginas logo abaixo leem como "filhas"
 * dele. A altura da linha não muda (h-8), então nada se desloca ao abrir/fechar. O "negrito" é uma sombra de texto da própria
 * cor: a fonte só tem os pesos 400 e 700, e trocar o peso pularia de uma vez — a sombra cresce junto com o resto. O fundo roxo
 * continua sendo só de "página atual".
 */
const OPEN_PARENT_CLASS =
  "!text-primary hover:!text-primary hover:!bg-foreground/[0.06] text-[0.9375rem] [text-shadow:0.35px_0_0_currentColor,-0.35px_0_0_currentColor] [&>svg]:size-[1.125rem]"

/**
 * Menu recolhido em ícones: a seta fica ao lado do ícone de quem tem subpáginas (aponta para baixo quando aberto e, no item
 * que é página, abre/fecha sem navegar).
 */
const ICON_MODE_CARET =
  "data-[state=open]:text-primary group-data-[collapsible=icon]:flex! group-data-[collapsible=icon]:top-2.5! group-data-[collapsible=icon]:-right-2 group-data-[collapsible=icon]:size-3 group-data-[collapsible=icon]:w-3 group-data-[collapsible=icon]:text-muted-foreground group-data-[collapsible=icon]:data-[state=open]:text-primary group-data-[collapsible=icon]:[&>svg]:size-3"

/**
 * Aberto, item + subpáginas ficam dentro do mesmo fundo (expandido e recolhido) — as subpáginas leem como filhas dele. O fundo
 * entra/sai em fade junto com a altura das subpáginas.
 */
const OPEN_GROUP_CLASS = cn("rounded-md transition-colors data-[state=open]:bg-muted", BRANCH_MOTION)
/** Abre/fecha deslizando (altura medida pelo Radix em --radix-collapsible-content-height); sem animação com movimento reduzido. */
const SUBPAGES_MOTION_CLASS = cn("overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up", BRANCH_MOTION)

const subNavButtonClass = (active: boolean) =>
  cn(
    active
      ? "!bg-primary/10 !text-primary data-active:!bg-primary/10 data-active:!text-primary data-active:!font-medium"
      : "!bg-transparent !text-muted-foreground hover:!bg-foreground/[0.06] hover:!text-foreground active:!bg-foreground/[0.06]",
  )

export function AdminSidebar({ capabilities }: { capabilities: AccessCapabilities }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const groups = GROUPS.map((group) => ({ label: group.label, entries: visibleEntries(group.entries, capabilities) })).filter((group) => group.entries.length > 0)

  return (
    // Fundo transparente: o menu fica sobre o mesmo fundo da página (sem faixa de outra cor nem painel flutuante).
    <Sidebar collapsible="icon" variant="inset" className="[&>[data-sidebar=sidebar]]:bg-transparent">
      <SidebarContent>
        {groups.map((group, index) => (
          <SidebarGroup key={group.label}>
            <NavGroupLabel label={group.label} divider={index > 0} />
            <SidebarGroupContent>
              <SidebarMenu>
                {group.entries.map((entry) =>
                  entry.children.length > 0 ? (
                    <NavBranch key={entry.label} entry={entry} pathname={pathname} searchParams={searchParams} />
                  ) : (
                    <NavLeaf key={entry.label} page={entry.page!} active={isPageActive(entry.page!, pathname, searchParams)} />
                  ),
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  )
}

/**
 * Título do grupo. Recolhido em ícones, o padrão do shadcn encolhe o título (-mt-8) e os ícones sobem; aqui ele mantém a
 * altura e vira um divisor fino — os ícones ficam exatamente na mesma linha dos itens expandidos.
 */
function NavGroupLabel({ label, divider }: { label: string; divider: boolean }) {
  return (
    <SidebarGroupLabel className="relative overflow-hidden font-bold whitespace-nowrap text-sidebar-foreground/90 group-data-[collapsible=icon]:mt-0 group-data-[collapsible=icon]:opacity-100">
      <span className="transition-opacity duration-200 group-data-[collapsible=icon]:opacity-0">{label}</span>
      {divider ? (
        <span aria-hidden className="absolute inset-x-2 top-1/2 h-px bg-sidebar-border opacity-0 transition-opacity duration-200 group-data-[collapsible=icon]:opacity-100" />
      ) : null}
    </SidebarGroupLabel>
  )
}

function NavLeaf({ page, active }: { page: NavPage; active: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={page.label} className={navButtonClass(active ? "active" : "idle")}>
        <Link href={page.href} aria-current={active ? "page" : undefined}>
          <page.icon />
          <span>{page.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/**
 * Item com subpáginas. Fechado, mostra só a linha de cima com a seta — e fica destacado quando a página atual é uma das
 * subpáginas escondidas, para nunca perder o "onde estou". Abre sozinho ao entrar na área (pela página de cima, por uma
 * subpágina ou por um link de fora). Recolhido em ícones, as subpáginas abertas continuam no mesmo lugar, só com o ícone.
 */
function NavBranch({ entry, pathname, searchParams }: { entry: VisibleEntry; pathname: string; searchParams: URLSearchParams }) {
  const pageActive = entry.page ? isPageActive(entry.page, pathname, searchParams) : false
  const childActive = entry.children.some((child) => isPageActive(child, pathname, searchParams))
  const inArea = pageActive || childActive

  const [open, setOpen] = useState(inArea)
  // Entrar na área abre o item; sair dela não fecha (quem abriu à mão continua vendo). Ajuste de estado na renderização, sem efeito.
  const [wasInArea, setWasInArea] = useState(inArea)
  if (inArea !== wasInArea) {
    setWasInArea(inArea)
    if (inArea) setOpen(true)
  }

  // Fechado com a página atual escondida lá dentro: a linha de cima fica destacada (o "onde estou" nunca some).
  const rowState = pageActive || (childActive && !open) ? "active" : "idle"
  const rowClass = cn(navButtonClass(rowState), BRANCH_ROW_MOTION, open && OPEN_PARENT_CLASS)
  const subPages = (
    <CollapsibleContent className={SUBPAGES_MOTION_CLASS}>
      <SidebarMenuSub className="pb-1.5 group-data-[collapsible=icon]:mx-0 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:border-l-0 group-data-[collapsible=icon]:px-0">
        {entry.children.map((child) => (
          <NavSubPage key={child.href} page={child} active={isPageActive(child, pathname, searchParams)} />
        ))}
      </SidebarMenuSub>
    </CollapsibleContent>
  )

  if (entry.page) {
    const page = entry.page
    return (
      <Collapsible asChild open={open} onOpenChange={setOpen} className={OPEN_GROUP_CLASS}>
        <SidebarMenuItem>
          <SidebarMenuButton asChild isActive={rowState === "active"} tooltip={page.label} className={rowClass}>
            <Link href={page.href} aria-current={pageActive ? "page" : undefined}>
              <page.icon />
              <span>{page.label}</span>
            </Link>
          </SidebarMenuButton>
          <CollapsibleTrigger asChild>
            <SidebarMenuAction aria-label={`${open ? "Recolher" : "Expandir"} ${page.label}`} className={cn("text-muted-foreground transition-[transform,rotate,color] data-[state=open]:rotate-90", BRANCH_MOTION, ICON_MODE_CARET)}>
              <ChevronRight />
            </SidebarMenuAction>
          </CollapsibleTrigger>
          {subPages}
        </SidebarMenuItem>
      </Collapsible>
    )
  }

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen} className={OPEN_GROUP_CLASS}>
      <SidebarMenuItem>
        {/* A linha toda abre/fecha; a seta é a MESMA dos itens que são página (mesmo lugar, tamanho e giro), nunca uma seta dentro do botão. */}
        <CollapsibleTrigger asChild>
          <SidebarMenuButton isActive={rowState === "active"} tooltip={entry.label} className={rowClass}>
            <entry.icon />
            <span>{entry.label}</span>
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleTrigger asChild>
          <SidebarMenuAction aria-label={`${open ? "Recolher" : "Expandir"} ${entry.label}`} className={cn("text-muted-foreground transition-[transform,rotate,color] data-[state=open]:rotate-90", BRANCH_MOTION, ICON_MODE_CARET)}>
            <ChevronRight />
          </SidebarMenuAction>
        </CollapsibleTrigger>
        {subPages}
      </SidebarMenuItem>
    </Collapsible>
  )
}

/** Subpágina: só texto com o menu expandido; recolhido, o ícone (menor) na mesma linha, com a mesma guia vertical que marca a hierarquia. */
function NavSubPage({ page, active }: { page: NavPage; active: boolean }) {
  const { state, isMobile } = useSidebar()
  return (
    <SidebarMenuSubItem>
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarMenuSubButton
            asChild
            isActive={active}
            className={cn(subNavButtonClass(active), "[&>svg]:text-current group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0")}
          >
            <Link href={page.href} aria-current={active ? "page" : undefined}>
              <page.icon className="hidden size-3.5! group-data-[collapsible=icon]:block" />
              <span className="group-data-[collapsible=icon]:sr-only">{page.label}</span>
            </Link>
          </SidebarMenuSubButton>
        </TooltipTrigger>
        <TooltipContent side="right" align="center" hidden={state !== "collapsed" || isMobile}>
          {page.label}
        </TooltipContent>
      </Tooltip>
    </SidebarMenuSubItem>
  )
}
