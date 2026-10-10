"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { applyNodeChanges, BaseEdge, Handle, Panel, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type EdgeProps, type Node, type NodeChange, type NodeProps } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { Crosshair, Minus, Plus } from "lucide-react"

import { FLOW_ARRIVAL_DURATION_MS, FLOW_TRAVEL_DURATION_MS, flowPathEdgeProps, flowPathTravelEdgeProps, flowTravelEdgeProps, usePrefersReducedMotion, type FlowTravelDirection } from "@/components/flow/flow-travel-signal"
import { useReactFlowColorMode } from "@/hooks/use-react-flow-color-mode"
import { cn } from "@/lib/utils"
import type { PersonOrganizationStructure, StructurePerson } from "@/schemas/org-structure/person-structure.schema"

import { ESTIMATED_HEIGHT, layoutOrganization, NODE_WIDTH, type OrganizationLayout } from "./organization-layout"
import { StructurePersonCard, type CardSection, type CardSectionRequest } from "./structure-person-card"

/**
 * Organograma READ-ONLY sobre o MESMO React Flow do editor de Workflows/Orquestradores
 * (`@xyflow/react`, tema via `useReactFlowColorMode`) — reaproveitamos canvas, viewport, pan,
 * zoom, fitView e medição de nodes; NÃO reaproveitamos nada do domínio de Workflow (nodes,
 * edges, validação, paleta). Aqui não existe editor: nodes não arrastam, não conectam, não são
 * apagados; handles são invisíveis; sem grade de fundo, sem minimapa. O usuário enxerga uma
 * hierarquia de pessoas: gestor imediato → focal → subordinados diretos em linhas balanceadas.
 *
 * Estado: `selectedId` (card expandido) é do chamador — clicar num card NÃO troca a focal nem
 * faz request; "Abrir estrutura"/clicar no gestor chamam `onOpenStructure` (a URL muda e o
 * chamador busca a nova estrutura). O viewport (pan/zoom) não é estado de negócio.
 *
 * VIAGEM: toda interação com uma pessoa dá a sensação de "estou percorrendo a organização até
 * ela" — a edge entre a origem (card em uso, senão a focal) e o destino recebe por
 * `FLOW_TRAVEL_DURATION_MS` o mesmo sinal da conexão Orquestrador → Agente
 * (`flow-travel-signal.ts`; `reverse` quando a viagem sobe contra o sentido da edge), o viewport
 * desliza até o destino, e o card de chegada ganha um anel discreto. Sem edge direta (busca) não
 * se inventa edge: só centralização suave + chegada. Selecionar = zero request; "Abrir
 * estrutura"/gestor disparam a viagem E a navegação ao mesmo tempo (nunca esperam a animação).
 * Com `prefers-reduced-motion` não há sinal nem deslocamento animado — a centralização é imediata.
 *
 * CAMINHO DO VIEWER (orientação PERSISTENTE, ≠ viagem): quando a focal é um ancestral real do
 * viewer (`viewerOrganizationPath`, cadeia por `reports_to_id`), o subordinado direto que leva até
 * ele é o `nextViewerPathNode` — o card ganha destaque + texto acessível ("Este caminho leva até
 * você") e a edge focal → next fica animada EM LOOP enquanto existir no grafo (é derivada do payload
 * a cada render: nenhum timer a desliga; some só quando a focal muda, quando a focal deixa de ser
 * ancestral ou quando o viewer vira a focal). Só UM trecho por estrutura: nunca a árvore inteira.
 * Com reduced motion a orientação não some — vira traço estático diferenciado.
 */
export type OrganizationStructureFlowProps = {
  data: PersonOrganizationStructure
  selectedId: string
  onSelect: (personId: string) => void
  onOpenStructure: (personId: string) => void
  profileHref: (personId: string) => string
  /** Pedido de centralização (busca): o node é selecionado e o viewport desliza até ele. `token` distingue pedidos repetidos. */
  focusRequest?: { personId: string; token: number } | null
  /** Pedido de viagem sem seleção nem navegação ("Ir até mim": o chamador navega em seguida). */
  travelRequest?: { personId: string; token: number } | null
  /** A estrutura está sendo trocada (dados anteriores ainda na tela). */
  transitioning?: boolean
  className?: string
}

export type OrgPersonNodeData = {
  person: StructurePerson
  variant: "manager" | "root" | "node"
  expanded: boolean
  isViewer: boolean
  directManager: StructurePerson | null
  directManagerNote: string | null
  sectionRequest: CardSectionRequest | null
  arrived: boolean
  /** `next` = o subordinado da focal que leva até o viewer (destaque persistente); `on` = está no caminho (focal/gestor acima). */
  viewerPath: "next" | "on" | null
  onSelect: (personId: string, section?: CardSection) => void
  onOpenStructure: (personId: string) => void
  profileHref: (personId: string) => string
}
type OrgPersonNode = Node<OrgPersonNodeData, "person">

export type OrgEdgeData = {
  kind: "manager" | "report"
  /** y da barra da linha 0 (onde o conector da focal desce) e da linha deste subordinado. */
  busY: number
  rowBusY: number
  /** x do tronco vertical que liga a linha 0 às linhas seguintes. */
  trunkX: number | null
  /** Trecho do caminho do viewer (orientação persistente) — cor de destaque mesmo sem animação (reduced motion). */
  viewerPath?: boolean
}
type OrgEdge = Edge<OrgEdgeData, "org">

/** Handles invisíveis: o React Flow precisa deles para ancorar as edges, o usuário nunca os vê. */
const HIDDEN_HANDLE = "!h-px !w-px !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0 pointer-events-none"

const OrgPersonNodeView = memo(function OrgPersonNodeView({ data }: NodeProps<OrgPersonNode>) {
  return (
    // `nopan`: o pan (d3-zoom) nasce só no fundo do canvas. Num node NÃO arrastável o React Flow
    // deixa o mousedown chegar ao d3, que o consome (preventDefault + stopImmediatePropagation)
    // antes do React — as abas do card (Radix Tabs, ativadas no mousedown) e o foco dos botões
    // deixavam de funcionar.
    <div data-testid={`org-node-${data.variant}`} data-person-id={data.person.personId} className="nopan">
      {data.variant !== "manager" ? <Handle type="target" position={Position.Top} className={HIDDEN_HANDLE} isConnectable={false} /> : null}
      <StructurePersonCard
        person={data.person}
        variant={data.variant}
        expanded={data.expanded}
        isViewer={data.isViewer}
        directManager={data.directManager}
        directManagerNote={data.directManagerNote}
        sectionRequest={data.sectionRequest}
        arrived={data.arrived}
        viewerPath={data.viewerPath}
        onSelect={(person, section) => data.onSelect(person.personId, section)}
        onOpenStructure={data.onOpenStructure}
        profileHref={data.profileHref}
        className={data.variant === "root" ? "ring-primary/60 shadow-md" : undefined}
      />
      {data.variant !== "node" ? <Handle type="source" position={Position.Bottom} className={HIDDEN_HANDLE} isConnectable={false} /> : null}
    </div>
  )
})

/**
 * Edge organizacional: linha simples, ortogonal, sem seta nem rótulo. Gestor → focal é um
 * traço vertical. Focal → subordinado desce até a barra da linha 0; para as linhas seguintes
 * segue pelo tronco à esquerda até a barra da linha do card, e então até o topo do card. Como
 * todos os trechos comuns coincidem, o desenho final é UMA barra por linha + um pino por card.
 */
export function orgEdgePath(sourceX: number, sourceY: number, targetX: number, targetY: number, data: OrgEdgeData | undefined): string {
  if (!data || data.kind === "manager") return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`
  const segments = [`M ${sourceX} ${sourceY}`, `V ${data.busY}`]
  if (data.rowBusY !== data.busY && data.trunkX !== null) segments.push(`H ${data.trunkX}`, `V ${data.rowBusY}`)
  segments.push(`H ${targetX}`, `V ${targetY}`)
  return segments.join(" ")
}

function OrgEdgeView({ sourceX, sourceY, targetX, targetY, data, animated }: EdgeProps<OrgEdge>) {
  const path = useMemo(() => orgEdgePath(sourceX, sourceY, targetX, targetY, data), [sourceX, sourceY, targetX, targetY, data])
  // Destaque = edge em viagem (sinal transitório) ou trecho do caminho do viewer (persistente — inclusive
  // estático com reduced motion); a edge comum é discreta e sem animação.
  const highlighted = animated || data?.viewerPath === true
  return <BaseEdge path={path} className={highlighted ? "!stroke-primary" : "!stroke-muted-foreground/45"} style={{ strokeWidth: highlighted ? 2 : 1.25 }} interactionWidth={0} />
}

const NODE_TYPES = { person: OrgPersonNodeView }
const EDGE_TYPES = { org: OrgEdgeView }

type Graph = { nodes: OrgPersonNode[]; layout: OrganizationLayout | null }
type Travel = { edgeId: string; direction: FlowTravelDirection; targetId: string; token: number }
type Arrival = { personId: string; token: number }

const noop = () => {}
const MIN_ZOOM = 0.55
const MAX_ZOOM = 1.35
/** Enquadramento e viagem duram o mesmo tempo — uma única cadência de movimento no organograma. */
const FIT_DURATION = FLOW_TRAVEL_DURATION_MS

export function OrganizationStructureFlow(props: OrganizationStructureFlowProps) {
  return (
    <ReactFlowProvider>
      <OrganizationStructureFlowInner {...props} />
    </ReactFlowProvider>
  )
}

/**
 * O próximo trecho do caminho do viewer na estrutura atual: a focal está na cadeia real do viewer
 * (`viewerOrganizationPath`, topo → viewer) e o elemento seguinte a ela é um subordinado direto
 * visível → `{ nextId, edgeId }`; senão null (outra árvore, viewer focal, próximo não visível).
 */
export function resolveViewerPath(data: Pick<PersonOrganizationStructure, "subject" | "directReports" | "viewerOrganizationPath">): { onPath: Set<string>; nextId: string | null; edgeId: string | null } {
  const path = data.viewerOrganizationPath.map((entry) => entry.personId)
  const onPath = new Set(path)
  const focalIndex = path.indexOf(data.subject.personId)
  const candidate = focalIndex >= 0 && focalIndex < path.length - 1 ? path[focalIndex + 1]! : null
  const nextId = candidate && data.directReports.some((report) => report.personId === candidate) ? candidate : null
  return { onPath, nextId, edgeId: nextId ? `e-${data.subject.personId}-${nextId}` : null }
}

function OrganizationStructureFlowInner({ data, selectedId, onSelect, onOpenStructure, profileHref, focusRequest = null, travelRequest = null, transitioning = false, className }: OrganizationStructureFlowProps) {
  const colorMode = useReactFlowColorMode()
  const reducedMotion = usePrefersReducedMotion()
  const { fitView, setCenter, getViewport, getNodesBounds, zoomIn, zoomOut } = useReactFlow()
  const containerRef = useRef<HTMLDivElement>(null)
  // Viagem em curso (edge + direção + destino), destaque de chegada e pedido de seção — estado de UI do canvas.
  const [travel, setTravel] = useState<Travel | null>(null)
  const [arrival, setArrival] = useState<Arrival | null>(null)
  const [sectionRequest, setSectionRequest] = useState<(CardSectionRequest & { personId: string }) | null>(null)
  const tokenRef = useRef(0)
  /** Destino da última viagem — quando ele vira a nova focal (navegação), o card raiz recebe a chegada após o enquadramento. */
  const lastTravelTargetRef = useRef<string | null>(null)
  // Nodes e layout andam juntos: cada reconstrução (payload, seleção, medição) produz os dois.
  const [graph, setGraph] = useState<Graph>({ nodes: [], layout: null })
  const { nodes, layout } = graph

  // Tamanho do canvas observado (ResizeObserver): abaixo de 640px a árvore vira vertical, e a
  // folga do pan é proporcional ao canvas.
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const narrow = canvasSize.width > 0 && canvasSize.width < 640
  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0
      const height = entry?.contentRect.height ?? 0
      setCanvasSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }))
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const { subject, managementChain, directReports, organizationalContext: context, breadcrumb } = data
  const manager = managementChain[0] ?? null
  // Estado derivado do payload — recalculado a cada render, nunca guardado nem expirado por timer.
  const viewerPath = useMemo(() => resolveViewerPath(data), [data])
  const viewerId = subject.isViewer ? subject.personId : (breadcrumb.find((entry) => entry.isViewer)?.personId ?? null)
  const managerNote = context.directManagerStatus === "INACTIVE" ? "O gestor cadastrado está inativo; este é o próximo nível ativo." : null

  /**
   * Edge entre origem e destino, com a direção da viagem: `forward` quando a edge estrutural vai
   * da origem ao destino (focal → subordinado), `reverse` quando a viagem sobe contra ela
   * (focal → gestor, subordinado → focal). Sem edge direta → null (a busca não inventa edge).
   */
  const travelEdgeBetween = useCallback(
    (fromId: string, toId: string): { edgeId: string; direction: FlowTravelDirection } | null => {
      const isReport = (id: string) => directReports.some((report) => report.personId === id)
      if (fromId === subject.personId && isReport(toId)) return { edgeId: `e-${subject.personId}-${toId}`, direction: "forward" }
      if (toId === subject.personId && isReport(fromId)) return { edgeId: `e-${subject.personId}-${fromId}`, direction: "reverse" }
      if (manager && fromId === subject.personId && toId === manager.personId) return { edgeId: `e-${manager.personId}-${subject.personId}`, direction: "reverse" }
      if (manager && fromId === manager.personId && toId === subject.personId) return { edgeId: `e-${manager.personId}-${subject.personId}`, direction: "forward" }
      return null
    },
    [directReports, manager, subject.personId],
  )

  /** Inicia a viagem até `targetId` a partir do card em uso (senão da focal). Com reduced motion: só a chegada, imediata. */
  const startTravel = useCallback(
    (targetId: string) => {
      const token = (tokenRef.current += 1)
      lastTravelTargetRef.current = targetId
      const edge = travelEdgeBetween(selectedId, targetId) ?? travelEdgeBetween(subject.personId, targetId)
      if (reducedMotion || !edge) {
        setTravel(null)
        setArrival({ personId: targetId, token })
        return
      }
      setTravel({ ...edge, targetId, token })
    },
    [reducedMotion, selectedId, subject.personId, travelEdgeBetween],
  )

  // A viagem termina sozinha: o sinal some e o destaque de chegada entra; a chegada também some sozinha.
  useEffect(() => {
    if (!travel) return
    const timer = setTimeout(() => {
      setTravel((current) => (current?.token === travel.token ? null : current))
      setArrival({ personId: travel.targetId, token: travel.token })
    }, FLOW_TRAVEL_DURATION_MS)
    return () => clearTimeout(timer)
  }, [travel])
  useEffect(() => {
    if (!arrival) return
    const timer = setTimeout(() => setArrival((current) => (current?.token === arrival.token ? null : current)), FLOW_ARRIVAL_DURATION_MS)
    return () => clearTimeout(timer)
  }, [arrival])

  const select = useCallback(
    (personId: string, section?: CardSection) => {
      if (personId !== selectedId) startTravel(personId)
      if (section) setSectionRequest({ personId, section, token: (tokenRef.current += 1) })
      onSelect(personId)
    },
    [onSelect, selectedId, startTravel],
  )
  // "Abrir estrutura"/gestor/"Reporta-se à": a viagem começa E a navegação dispara — a request
  // nunca espera a animação. Abrir a estrutura de quem JÁ é a focal só seleciona (zero request).
  const openStructure = useCallback(
    (personId: string) => {
      startTravel(personId)
      if (personId === subject.personId) onSelect(personId)
      else onOpenStructure(personId)
    },
    [onOpenStructure, onSelect, startTravel, subject.personId],
  )

  /** Monta os nodes a partir do payload e reposiciona pelo layout puro, com as alturas já medidas quando existem. */
  const build = useCallback(
    (previous: OrgPersonNode[]): Graph => {
      // Altura medida só vale enquanto o estado (compacto/expandido) não mudou — ao expandir ou
      // compactar, o layout volta à estimativa até o React Flow medir de novo (evita sobreposição).
      const previousById = new Map(previous.map((node) => [node.id, node]))
      const heightOf = (id: string, fallback: number) => {
        const prior = previousById.get(id)
        const expandedNow = id !== manager?.personId && id === selectedId
        return prior?.measured?.height !== undefined && prior.data.expanded === expandedNow ? prior.measured.height : fallback
      }
      const nodeData = (person: StructurePerson, variant: OrgPersonNodeData["variant"]): OrgPersonNodeData => ({
        person,
        variant,
        expanded: variant !== "manager" && person.personId === selectedId,
        isViewer: person.personId === viewerId,
        directManager: variant === "root" ? manager : variant === "node" ? subject : null,
        directManagerNote: variant === "root" ? managerNote : null,
        sectionRequest: sectionRequest?.personId === person.personId ? { section: sectionRequest.section, token: sectionRequest.token } : null,
        arrived: arrival?.personId === person.personId,
        viewerPath: person.personId === viewerPath.nextId ? "next" : viewerPath.onPath.has(person.personId) ? "on" : null,
        onSelect: select,
        onOpenStructure: openStructure,
        profileHref,
      })
      // Tela estreita (mobile): no máximo 2 colunas — a árvore fica vertical e se explora com pan.
      const layout = layoutOrganization(
        {
          manager: manager ? { id: manager.personId, height: heightOf(manager.personId, ESTIMATED_HEIGHT.manager) } : null,
          focal: { id: subject.personId, height: heightOf(subject.personId, selectedId === subject.personId ? ESTIMATED_HEIGHT.focalExpanded : ESTIMATED_HEIGHT.focalCompact) },
          reports: directReports.map((report) => ({ id: report.personId, height: heightOf(report.personId, report.personId === selectedId ? ESTIMATED_HEIGHT.reportExpanded : ESTIMATED_HEIGHT.report) })),
        },
        { maxColumns: narrow ? 2 : 6 },
      )
      const make = (person: StructurePerson, variant: OrgPersonNodeData["variant"], width: number): OrgPersonNode => {
        const prior = previousById.get(person.personId)
        const position = layout.positions.get(person.personId) ?? { x: 0, y: 0 }
        return { ...(prior ?? {}), id: person.personId, type: "person", position, data: nodeData(person, variant), draggable: false, selectable: false, connectable: false, focusable: false, deletable: false, width, ...(prior?.measured ? { measured: prior.measured } : {}) }
      }
      return { layout, nodes: [...(manager ? [make(manager, "manager", NODE_WIDTH.manager)] : []), make(subject, "root", NODE_WIDTH.focal), ...directReports.map((report) => make(report, "node", NODE_WIDTH.report))] }
    },
    [arrival, directReports, manager, managerNote, narrow, openStructure, profileHref, sectionRequest, select, selectedId, subject, viewerId, viewerPath],
  )

  // Payload/seleção mudaram: reconstrói nodes + layout durante o render (estado derivado), sem
  // efeito — o React reexecuta o render com o grafo novo antes de pintar.
  const [builtWith, setBuiltWith] = useState<typeof build | null>(null)
  if (builtWith !== build) {
    setBuiltWith(() => build)
    setGraph((previous) => build(previous.nodes))
  }

  // Mudanças de dimensão (o React Flow mediu um card, ou um card expandiu/compactou): aplica e
  // recalcula o layout com as alturas reais — a linha cresce para baixo, nunca sobrepõe.
  const onNodesChange = useCallback(
    (changes: NodeChange<OrgPersonNode>[]) => {
      setGraph((previous) => {
        const next = applyNodeChanges(changes, previous.nodes)
        return changes.some((change) => change.type === "dimensions") ? build(next) : { ...previous, nodes: next }
      })
    },
    [build],
  )

  // O pan fica limitado à vizinhança da estrutura: a folga é META canvas em cada direção (em
  // unidades do mundo no zoom 1), então a árvore NUNCA sai inteira do canvas — no máximo metade
  // fica de fora. Foi exatamente o bug do "canvas vazio": a rolagem da página virava pan e uma
  // folga de uma tela inteira deixava a estrutura ir embora.
  const translateExtent = useMemo<[[number, number], [number, number]]>(() => {
    const bounds = layout?.bounds ?? { minX: -400, maxX: 400, minY: 0, maxY: 400 }
    const marginX = (canvasSize.width || 1280) / 2
    const marginY = (canvasSize.height || 640) / 2
    return [
      [bounds.minX - marginX, bounds.minY - marginY],
      [bounds.maxX + marginX, bounds.maxY + marginY],
    ]
  }, [canvasSize.height, canvasSize.width, layout])

  const edges = useMemo<OrgEdge[]>(() => {
    if (!layout) return []
    const rowOf = new Map<string, number>()
    layout.rows.forEach((row, index) => row.forEach((id) => rowOf.set(id, index)))
    const reportEdges = directReports.map<OrgEdge>((report) => {
      const row = rowOf.get(report.personId) ?? 0
      return { id: `e-${subject.personId}-${report.personId}`, source: subject.personId, target: report.personId, type: "org", selectable: false, focusable: false, deletable: false, data: { kind: "report", busY: layout.busY[0] ?? 0, rowBusY: layout.busY[row] ?? 0, trunkX: layout.trunkX } }
    })
    const managerEdge: OrgEdge[] = manager ? [{ id: `e-${manager.personId}-${subject.personId}`, source: manager.personId, target: subject.personId, type: "org", selectable: false, focusable: false, deletable: false, data: { kind: "manager", busY: 0, rowBusY: 0, trunkX: null } }] : []
    // Caminho do viewer = animado em loop enquanto a edge existir (sem timer); viagem = sinal transitório
    // por cima; uma edge que é as duas coisas volta a ser caminho quando a viagem termina. As demais, estáticas.
    return [...managerEdge, ...reportEdges].map((edge) => {
      const isPath = edge.id === viewerPath.edgeId
      const isTravel = travel !== null && edge.id === travel.edgeId
      if (isPath && isTravel) return { ...edge, data: { ...edge.data!, viewerPath: true }, ...flowPathTravelEdgeProps(travel.direction, reducedMotion) }
      if (isPath) return { ...edge, data: { ...edge.data!, viewerPath: true }, ...flowPathEdgeProps(reducedMotion) }
      if (isTravel) return { ...edge, ...flowTravelEdgeProps(travel.direction) }
      return edge
    })
  }, [directReports, layout, manager, reducedMotion, subject.personId, travel, viewerPath.edgeId])

  /**
   * Enquadra a estrutura com os cards LEGÍVEIS: gestor + focal + o maior número de linhas de
   * subordinados que ainda cabe com zoom ≥ MIN_ZOOM (tudo, quando a estrutura é pequena). Numa
   * estrutura grande ou numa tela estreita, as linhas restantes ficam abaixo, ao alcance do pan —
   * nunca um zoom em que os nomes somem só para mostrar 30 pessoas de uma vez.
   */
  const frame = useCallback(
    (duration: number) => {
      const container = containerRef.current
      if (!container || !layout) return
      const base = [subject.personId, ...(manager ? [manager.personId] : [])]
      // Nem a primeira linha cabe legível (tela estreita): entra mesmo assim, no zoom mínimo — a
      // focal continua legível e a linha aparece parcialmente, ao alcance do pan.
      let chosen = [...base, ...(layout.rows[0] ?? [])]
      for (let rows = layout.rows.length; rows >= 2; rows -= 1) {
        const candidate = [...base, ...layout.rows.slice(0, rows).flat()]
        const bounds = getNodesBounds(candidate)
        const zoom = Math.min(container.clientWidth / (bounds.width * 1.24), container.clientHeight / (bounds.height * 1.24))
        if (zoom >= MIN_ZOOM) {
          chosen = candidate
          break
        }
      }
      void fitView({ duration, padding: 0.12, minZoom: MIN_ZOOM, maxZoom: 1, nodes: chosen.map((id) => ({ id })) })
    },
    [fitView, getNodesBounds, layout, manager, subject.personId],
  )

  // fitView ao carregar e a cada troca de focal (nunca ao selecionar um filho): só depois de o
  // React Flow ter medido TODOS os nodes da nova estrutura, senão o enquadramento sairia errado.
  const framedFor = useRef<string | null>(null)
  // "Medido" é avaliado contra o PAYLOAD (não contra o state): ao trocar de estrutura, os ids novos
  // ainda não existem nos nodes, então o enquadramento espera a nova estrutura inteira ser medida.
  const measuredById = useMemo(() => new Map(nodes.map((node) => [node.id, node.measured?.height !== undefined && node.measured.width !== undefined])), [nodes])
  const allMeasured = [manager?.personId, subject.personId, ...directReports.map((report) => report.personId)].every((id) => id === undefined || measuredById.get(id) === true)
  useEffect(() => {
    if (!allMeasured || framedFor.current === subject.personId) return
    // O marcador só muda quando o enquadramento de fato roda: o cleanup (StrictMode, re-render)
    // cancela o frame agendado, e a próxima execução do efeito precisa agendar de novo.
    const raf = window.requestAnimationFrame(() => {
      const first = framedFor.current === null
      framedFor.current = subject.personId
      const duration = first || reducedMotion ? 0 : FIT_DURATION
      frame(duration)
      // A nova focal era o destino da viagem: chegada no card raiz quando o enquadramento termina.
      if (!first && lastTravelTargetRef.current === subject.personId) {
        lastTravelTargetRef.current = null
        setTimeout(() => setArrival({ personId: subject.personId, token: (tokenRef.current += 1) }), duration)
      }
    })
    return () => window.cancelAnimationFrame(raf)
  }, [allMeasured, frame, reducedMotion, subject.personId])

  // O canvas mudou de tamanho depois do primeiro enquadramento (janela redimensionada, tela
  // estreita ↔ larga): o layout já foi refeito (2 colunas abaixo de 640px), então reenquadra sem
  // animação — senão o viewport antigo deixaria a árvore fora do canvas.
  const framedSize = useRef<string | null>(null)
  useEffect(() => {
    if (!allMeasured || framedFor.current === null || canvasSize.width === 0) return
    const key = `${canvasSize.width}x${canvasSize.height}`
    if (framedSize.current === key) return
    const first = framedSize.current === null
    const raf = window.requestAnimationFrame(() => {
      framedSize.current = key
      if (!first) frame(0)
    })
    return () => window.cancelAnimationFrame(raf)
  }, [allMeasured, canvasSize, frame])

  /** Desliza o viewport até um node só quando ele não está inteiramente visível — nunca "pula" a tela inteira. */
  const revealNode = useCallback(
    (personId: string, force: boolean) => {
      const container = containerRef.current
      if (!container) return
      const bounds = getNodesBounds([personId])
      const { x, y, zoom } = getViewport()
      const left = bounds.x * zoom + x
      const top = bounds.y * zoom + y
      const right = left + bounds.width * zoom
      const bottom = top + bounds.height * zoom
      const visible = left >= 0 && top >= 0 && right <= container.clientWidth && bottom <= container.clientHeight
      if (visible && !force) return
      void setCenter(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { zoom, duration: reducedMotion ? 0 : FIT_DURATION })
    },
    [getNodesBounds, getViewport, reducedMotion, setCenter],
  )

  const lastSelected = useRef(selectedId)
  useEffect(() => {
    if (!allMeasured || lastSelected.current === selectedId) return
    // Espera a expansão ser medida antes de decidir se precisa deslizar.
    const timer = window.setTimeout(() => {
      lastSelected.current = selectedId
      // A seleção voltou à focal por causa de uma troca de estrutura: o fitView já cuida do enquadramento.
      if (selectedId !== subject.personId) revealNode(selectedId, false)
    }, 60)
    return () => window.clearTimeout(timer)
  }, [allMeasured, revealNode, selectedId, subject.personId])

  // Busca: a pessoa encontrada já está selecionada pelo chamador; aqui a câmera conduz até ela —
  // com o sinal de percurso quando existe edge direta a partir da focal, senão só centralização + chegada.
  const lastFocusTravel = useRef<number | null>(null)
  useEffect(() => {
    if (!focusRequest || lastFocusTravel.current === focusRequest.token) return
    const timer = setTimeout(() => {
      lastFocusTravel.current = focusRequest.token
      startTravel(focusRequest.personId)
    }, 0)
    return () => clearTimeout(timer)
  }, [focusRequest, startTravel])
  // "Ir até mim": o chamador pede a viagem até o próximo trecho e navega em seguida — aqui só o sinal.
  const lastTravelRequest = useRef<number | null>(null)
  useEffect(() => {
    if (!travelRequest || lastTravelRequest.current === travelRequest.token) return
    const timer = setTimeout(() => {
      lastTravelRequest.current = travelRequest.token
      startTravel(travelRequest.personId)
    }, 0)
    return () => clearTimeout(timer)
  }, [startTravel, travelRequest])
  const lastFocus = useRef<number | null>(null)
  useEffect(() => {
    if (!focusRequest || !allMeasured || lastFocus.current === focusRequest.token) return
    // Espera a medição (bounds reais) antes de deslizar a câmera.
    const timer = window.setTimeout(() => {
      lastFocus.current = focusRequest.token
      revealNode(focusRequest.personId, true)
    }, 60)
    return () => window.clearTimeout(timer)
  }, [focusRequest, allMeasured, revealNode])

  return (
    // A altura vem das classes responsivas do chamador; o `minHeight` inline é a rede de segurança:
    // o React Flow é absoluto dentro do container, então sem altura explícita (ex.: folha de estilo
    // antiga em cache do navegador, que foi o "canvas vazio" visto no Safari) o canvas colapsaria a 0px.
    <div ref={containerRef} data-testid="structure-canvas" data-travel-edge={travel?.edgeId} data-travel-direction={travel?.direction} data-arrival={arrival?.personId} data-viewer-path-edge={viewerPath.edgeId ?? undefined} data-viewer-path-next={viewerPath.nextId ?? undefined} data-viewer-path-motion={viewerPath.edgeId ? (reducedMotion ? "static" : "animated") : undefined} style={{ minHeight: "32rem" }} className={cn("relative overflow-hidden rounded-xl bg-card", transitioning && "opacity-70 transition-opacity", className)}>
      <ReactFlow<OrgPersonNode, OrgEdge>
        colorMode={colorMode}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        // Com nodes não selecionáveis/arrastáveis/conectáveis o React Flow desliga os pointer events
        // do node inteiro; um handler de clique (vazio — a seleção é dos botões do card) os mantém.
        onNodeClick={noop}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        panOnDrag
        // A roda/trackpad sobre o canvas dá ZOOM (limitado a MIN_ZOOM–MAX_ZOOM e ao translateExtent,
        // então a estrutura nunca sai da tela); o pan continua só por arrasto — `panOnScroll` foi o
        // bug do "canvas vazio" (a rolagem da página virava pan e empurrava a árvore para fora).
        // Consequência aceita: a página não rola com a roda enquanto o ponteiro está sobre o canvas.
        panOnScroll={false}
        zoomOnScroll
        preventScrolling
        zoomOnPinch
        zoomOnDoubleClick={false}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        translateExtent={translateExtent}
        proOptions={{ hideAttribution: true }}
        className="!bg-transparent"
        aria-label="Organograma"
      >
        <Panel position="bottom-right" className="!m-3 flex flex-col overflow-hidden rounded-lg bg-card shadow-sm ring-1 ring-border" role="group" aria-label="Controles do organograma">
          <CanvasControl label="Aproximar" onClick={() => void zoomIn({ duration: 200 })}>
            <Plus className="size-4" aria-hidden />
          </CanvasControl>
          <CanvasControl label="Afastar" onClick={() => void zoomOut({ duration: 200 })}>
            <Minus className="size-4" aria-hidden />
          </CanvasControl>
          <CanvasControl label="Centralizar estrutura" onClick={() => frame(FIT_DURATION)}>
            <Crosshair className="size-4" aria-hidden />
          </CanvasControl>
        </Panel>
      </ReactFlow>
    </div>
  )
}

function CanvasControl({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&+&]:border-t [&+&]:border-border">
      {children}
    </button>
  )
}
