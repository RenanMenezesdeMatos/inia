"use client"

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react"
import { CheckCircle2, ChevronLeft, ChevronRight, FlaskConical, Map as MapIcon, Play, RotateCcw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Progress } from "@/components/ui/progress"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"

import { exampleBySlug, locateStep, scenesOf } from "./demo-catalog"
import { DemoJourneyMap } from "./demo-journey-map"
import { DemoSceneView } from "./demo-scene-view"
import { DemoShotFigure } from "./demo-shot-figure"
import { DEMO_SHOTS } from "./demo-shots"

/**
 * A demonstração guiada de um exemplo. O estado é só de apresentação: etapa e desfecho escolhido. Trocar de desfecho troca a lista de
 * cenas já escritas; nada é avaliado nem interpretado, e nada sai do navegador. A página não chama nenhuma API.
 */
type Phase = "closed" | "intro" | "playing" | "done"
type PlayerState = { phase: Phase; scenarioId: string; index: number }

const subscribeToHash = (listener: () => void) => {
  window.addEventListener("hashchange", listener)
  return () => window.removeEventListener("hashchange", listener)
}
const readHash = () => decodeURIComponent(window.location.hash.slice(1))
const noHashOnServer = () => ""

export function DemoPlayer({ slug }: { slug: string }) {
  const example = exampleBySlug(slug)
  const firstScenario = example.scenarios[0]!
  const [state, setState] = useState<PlayerState>({ phase: "closed", scenarioId: firstScenario.id, index: 0 })
  const headingRef = useRef<HTMLHeadingElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef(false)
  // Chegou por âncora: a seção rolou até o título do exemplo, e a demonstração precisa aparecer na tela e receber o foco.
  const [arrivals, setArrivals] = useState(0)
  const groupId = useId()

  const scenario = example.scenarios.find((candidate) => candidate.id === state.scenarioId) ?? firstScenario
  const scenes = useMemo(() => scenesOf(example, scenario), [example, scenario])
  const scene = scenes[Math.min(state.index, scenes.length - 1)]!
  const node = example.definition.graph.nodes.find((candidate) => candidate.id === scene.nodeId)!

  // Chegada por âncora ("#nota-ura-baixa" ou "#nota-ura-baixa--condicao"): abre a demonstração naquele ponto (ajuste na renderização).
  const hash = useSyncExternalStore(subscribeToHash, readHash, noHashOnServer)
  const [seenHash, setSeenHash] = useState("")
  if (hash !== seenHash) {
    setSeenHash(hash)
    if (hash === slug) {
      if (state.phase === "closed") setState({ ...state, phase: "intro" })
      setArrivals(arrivals + 1)
    } else if (hash.startsWith(`${slug}--`)) {
      const step = locateStep(example, hash.slice(slug.length + 2))
      if (step) {
        setState({ phase: "playing", scenarioId: step.scenarioId, index: step.index })
        setArrivals(arrivals + 1)
      }
    }
  }

  useEffect(() => {
    if (arrivals === 0) return
    const bringIntoView = () => {
      // `scrollIntoView` existe em todo navegador; o ambiente de teste (jsdom) é quem não o implementa.
      rootRef.current?.scrollIntoView?.({ block: "start" })
      headingRef.current?.focus({ preventScroll: true })
    }
    bringIntoView()
    // Ao abrir a página pelo link, o navegador ainda rola até a âncora depois de hidratar, e essa rolagem venceria a de cima.
    const again = window.setTimeout(bringIntoView, 300)
    if (document.readyState !== "complete") window.addEventListener("load", bringIntoView, { once: true })
    return () => {
      window.clearTimeout(again)
      window.removeEventListener("load", bringIntoView)
    }
  }, [arrivals])

  useEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current = false
    headingRef.current?.focus()
  })

  function go(next: Partial<PlayerState>, focus = true) {
    pendingFocus.current = focus
    setState((previous) => ({ ...previous, ...next }))
  }

  /** Troca de desfecho: mantém a parte comum do caminho e, se a etapa atual não existe no novo, volta ao último ponto em comum. */
  function chooseScenario(scenarioId: string, advance = false) {
    const next = example.scenarios.find((candidate) => candidate.id === scenarioId)
    if (!next) return
    let common = 0
    while (common < next.scenes.length && common < scenario.scenes.length && next.scenes[common] === scenario.scenes[common]) common += 1
    const stay = state.phase === "playing" ? Math.min(state.index, Math.max(common - 1, 0)) : 0
    go({ scenarioId, index: advance ? Math.min(stay + 1, next.scenes.length - 1) : stay, phase: state.phase === "done" ? "playing" : state.phase }, false)
  }

  function previous() {
    if (state.phase === "done") go({ phase: "playing", index: scenes.length - 1 })
    else if (state.index === 0) go({ phase: "intro" })
    else go({ index: state.index - 1 })
  }

  function nextStep() {
    if (state.index >= scenes.length - 1) go({ phase: "done" })
    else go({ index: state.index + 1 })
  }

  function restart() {
    go({ phase: "intro", index: 0, scenarioId: firstScenario.id })
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (state.phase !== "playing" && state.phase !== "done") return
    const target = event.target as HTMLElement
    if (target.closest('[role="radiogroup"], [role="dialog"], a, input, textarea, [data-slot="accordion-trigger"]')) return
    if (event.key === "ArrowRight" && state.phase === "playing") {
      event.preventDefault()
      nextStep()
    } else if (event.key === "ArrowLeft") {
      event.preventDefault()
      previous()
    }
  }

  if (state.phase === "closed") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => go({ phase: "intro" })}>
          <Play className="size-4" aria-hidden /> Ver exemplo na prática
        </Button>
        <span className="text-xs text-muted-foreground">Demonstração com dados fictícios. Nada é publicado nem enviado.</span>
      </div>
    )
  }

  const canvasShot = DEMO_SHOTS[`canvas-${example.slug}`]
  const total = scenes.length
  const current = state.phase === "done" ? total : state.index + 1
  const progress = state.phase === "intro" ? 0 : Math.round((current / total) * 100)
  const stepLabel = state.phase === "intro" ? "Antes de começar" : state.phase === "done" ? "Fim da demonstração" : `Etapa ${current} de ${total}`

  return (
    <div ref={rootRef} role="group" aria-label={`Demonstração guiada: ${example.title}`} onKeyDown={onKeyDown} className="scroll-mt-28 overflow-clip rounded-xl border border-primary/30 bg-card" data-slot="demo-player" data-phase={state.phase}>
      <div className="space-y-2.5 border-b border-border bg-muted/30 px-3.5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge variant="outline" className="gap-1 border-amber-500/40 bg-amber-500/10 font-medium text-amber-900 dark:text-amber-200">
            <FlaskConical className="size-3" aria-hidden /> Demonstração com dados fictícios
          </Badge>
          <span className="text-xs text-muted-foreground">Nada é publicado nem enviado</span>
        </div>
        <Progress value={progress} aria-label="Progresso da demonstração" aria-valuenow={progress} aria-valuetext={stepLabel} className="h-1.5" />
        <p aria-live="polite" className="sr-only">
          {state.phase === "playing" ? `${stepLabel}: ${scene.title}` : stepLabel}
        </p>
        <fieldset className="space-y-1.5">
          <legend id={`${groupId}-legend`} className="text-xs font-medium text-muted-foreground">Desfecho para explorar</legend>
          <RadioGroup aria-labelledby={`${groupId}-legend`} value={scenario.id} onValueChange={(value) => chooseScenario(value)} className="flex flex-wrap gap-1.5">
            {example.scenarios.map((option) => (
              <label
                key={option.id}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors motion-reduce:transition-none focus-within:ring-2 focus-within:ring-ring",
                  option.id === scenario.id ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                <RadioGroupItem value={option.id} className="size-3.5" />
                {option.label}
              </label>
            ))}
          </RadioGroup>
          <p className="text-xs text-muted-foreground">{scenario.description}</p>
        </fieldset>
      </div>

      <div className="grid grid-cols-1 gap-4 p-3.5 lg:grid-cols-[auto_minmax(0,1fr)]">
        <div className="hidden lg:block">
          <div className="sticky top-20">
            <DemoJourneyMap example={example} scenes={scenes} index={state.phase === "playing" ? state.index : state.phase === "done" ? scenes.length - 1 : null} />
          </div>
        </div>
        <Collapsible className="lg:hidden">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="w-full justify-start">
              <MapIcon className="size-4" aria-hidden /> Ver a jornada no mapa
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <DemoJourneyMap example={example} scenes={scenes} index={state.phase === "playing" ? state.index : state.phase === "done" ? scenes.length - 1 : null} />
          </CollapsibleContent>
        </Collapsible>

        <div className="min-w-0 space-y-4">
          <h3 ref={headingRef} tabIndex={-1} className="scroll-mt-28 rounded-sm text-xs font-semibold tracking-wide text-primary uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {example.title}
          </h3>

          {state.phase === "intro" ? (
            <div className="space-y-3 text-sm leading-relaxed animate-in fade-in-0 duration-300 motion-reduce:animate-none" data-testid="demo-intro">
              <p className="rounded-lg bg-muted/40 p-3">
                <span className="font-semibold">{example.persona.name}</span>, {example.persona.role}. {example.persona.need}
              </p>
              <p>
                <span className="font-semibold">Objetivo:</span> {example.goal}
              </p>
              <p>
                <span className="font-semibold">Resultado esperado:</span> {example.expectedResult}
              </p>
              {example.support ? (
                <p className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
                  <span className="font-semibold">{example.support.title}:</span> {example.support.intro}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Você vai acompanhar a jornada etapa por etapa, com as mesmas opções do editor. É só uma simulação didática: nenhum Workflow é publicado e ninguém recebe nada.
              </p>
              {canvasShot ? (
                <details className="rounded-lg border border-border" data-slot="demo-canvas">
                  <summary className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Ver como este fluxo fica no editor</summary>
                  <div className="border-t border-border p-3">
                    <DemoShotFigure shot={canvasShot} />
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}

          {state.phase === "playing" ? <DemoSceneView scene={scene} node={node} onDecision={(decision) => {
            const chosen = example.scenarios.find((option) => option.label === decision)
            if (chosen) chooseScenario(chosen.id, true)
          }} /> : null}

          {state.phase === "done" ? (
            <div className="space-y-3 animate-in fade-in-0 duration-300 motion-reduce:animate-none" data-testid="demo-done">
              <p className="flex items-center gap-2 font-heading text-lg font-semibold">
                <CheckCircle2 className="size-5 text-primary" aria-hidden /> Você viu o desfecho &quot;{scenario.label}&quot;
              </p>
              <p className="text-sm text-foreground/90">{scenario.description}</p>
              {example.scenarios.length > 1 ? <p className="text-sm text-muted-foreground">Escolha outro desfecho acima para ver o que muda. Nada disso aconteceu de verdade: nenhum Workflow foi publicado e ninguém recebeu nada.</p> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card/95 px-3.5 py-2.5 backdrop-blur-sm" data-slot="demo-controls">
        <Button type="button" variant="ghost" size="sm" onClick={restart} disabled={state.phase === "intro" && state.scenarioId === firstScenario.id}>
          <RotateCcw className="size-4" aria-hidden /> Reiniciar
        </Button>
        <span className="order-last w-full text-center text-xs font-medium text-muted-foreground sm:order-none sm:w-auto" data-testid="demo-step-label">{stepLabel}</span>
        <div className="flex items-center gap-2">
          {state.phase === "intro" ? (
            <Button type="button" size="sm" onClick={() => go({ phase: "playing", index: 0 })}>
              Começar <ChevronRight className="size-4" aria-hidden />
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" onClick={previous}>
                <ChevronLeft className="size-4" aria-hidden /> Anterior
              </Button>
              <Button type="button" size="sm" onClick={nextStep} disabled={state.phase === "done"}>
                {state.phase === "playing" && state.index >= scenes.length - 1 ? "Concluir" : "Próximo"} <ChevronRight className="size-4" aria-hidden />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
