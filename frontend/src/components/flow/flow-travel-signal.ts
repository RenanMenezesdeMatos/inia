"use client"

import { useSyncExternalStore } from "react"
import type { Edge } from "@xyflow/react"

/**
 * SINAL DE PERCURSO em edges do React Flow — primitive visual GENÉRICO, sem domínio (nem Agent,
 * nem Organização): reutiliza exatamente a linguagem da conexão Orquestrador → Agente do editor
 * de Orquestradores, que é o `animated: true` nativo da biblioteca (`.react-flow__edge.animated
 * path { stroke-dasharray: 5; animation: dashdraw .5s linear infinite }` — o traço "em marcha"
 * no sentido source → target). Aqui ele ganha três coisas que o Orquestrador não precisa:
 *  - DIREÇÃO: `reverse` inverte a marcha (`animation-direction: reverse` na classe
 *    `inia-flow-travel-reverse`) — a viagem visual "focal → gestor" percorre a edge estrutural
 *    gestor → focal no sentido contrário;
 *  - TEMPORÁRIO: a edge normal é estática; só a edge em viagem recebe o sinal, por `FLOW_TRAVEL_DURATION_MS`;
 *  - REDUCED MOTION: com `prefers-reduced-motion: reduce` a marcha e o pulso de chegada não rodam
 *    (`globals.css`), e quem chama usa `usePrefersReducedMotion()` para centralizar sem animação.
 * Dois conceitos que nunca se misturam: TRAVEL (feedback transitório de uma interação, com duração) e
 * PATH (orientação PERSISTENTE — "este caminho leva até você" — que dura enquanto a edge for trecho
 * do caminho no grafo atual; some só quando o grafo muda, nunca por timer).
 * O editor de Orquestradores não usa nenhuma destas classes — continua exatamente igual.
 */
export type FlowTravelDirection = "forward" | "reverse"

/** Duração da viagem (sinal + deslocamento do viewport) — o mesmo tempo do enquadramento animado do organograma. */
export const FLOW_TRAVEL_DURATION_MS = 450

/** Duração do destaque de chegada no node de destino (anel discreto, um pulso só). */
export const FLOW_ARRIVAL_DURATION_MS = 900

export const FLOW_TRAVEL_CLASS = "inia-flow-travel"
export const FLOW_TRAVEL_REVERSE_CLASS = "inia-flow-travel-reverse"
/** Edge de ORIENTAÇÃO PERSISTENTE (ver `flowPathEdgeProps`). */
export const FLOW_PATH_CLASS = "inia-flow-path"
export const FLOW_PATH_STATIC_CLASS = "inia-flow-path-static"

/** Props de edge que ligam o sinal TRANSITÓRIO: o `animated` da biblioteca (a mesma classe do Orquestrador) + a direção. */
export function flowTravelEdgeProps(direction: FlowTravelDirection): Pick<Edge, "animated" | "className"> {
  return { animated: true, className: direction === "reverse" ? `${FLOW_TRAVEL_CLASS} ${FLOW_TRAVEL_REVERSE_CLASS}` : FLOW_TRAVEL_CLASS }
}

/**
 * Props de edge de ORIENTAÇÃO PERSISTENTE: a mesma marcha de traços do Orquestrador → Agente rodando em
 * loop ENQUANTO a edge existir no grafo como trecho de um caminho (nada de timer). Com reduced motion
 * a orientação não some: vira um estilo estático diferenciado (`FLOW_PATH_STATIC_CLASS`, sem marcha).
 */
export function flowPathEdgeProps(reducedMotion: boolean): Pick<Edge, "animated" | "className"> {
  return reducedMotion ? { animated: false, className: `${FLOW_PATH_CLASS} ${FLOW_PATH_STATIC_CLASS}` } : { animated: true, className: FLOW_PATH_CLASS }
}

/** Uma edge que é caminho persistente E está em viagem: a viagem (direção) manda enquanto dura; depois ela volta a ser caminho. */
export function flowPathTravelEdgeProps(direction: FlowTravelDirection, reducedMotion: boolean): Pick<Edge, "animated" | "className"> {
  const path = flowPathEdgeProps(reducedMotion)
  const travel = flowTravelEdgeProps(direction)
  return { animated: true, className: `${path.className} ${travel.className}` }
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {}
  const media = window.matchMedia(REDUCED_MOTION_QUERY)
  media.addEventListener?.("change", onChange)
  return () => media.removeEventListener?.("change", onChange)
}

function readPreference(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION_QUERY).matches
}

/** `prefers-reduced-motion: reduce` como estado reativo (false no servidor e no primeiro render do cliente). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, readPreference, () => false)
}
