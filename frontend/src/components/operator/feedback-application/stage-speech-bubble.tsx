"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Mic } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * O que a INIA está "dizendo" no palco, no balão sobre a cabeça dela:
 *
 * - `say`: uma frase dela (a chegada, um aviso) — título e detalhe;
 * - `stream`: a FALA em andamento — as palavras aparecem no ritmo da voz (`heardWords` = quantas já soaram) e, quando ela termina
 *   (`ended`), o balão POUSA na conversa: voa até a mensagem `landOn`, que surge no lugar dele, e o balão some;
 * - `listening` / `thinking`: ela ouvindo (microfone aberto) / pensando (balão de pensamento);
 * - `none`: nada a dizer — sem balão.
 */
export type FeedbackSessionSpeech =
  | { kind: "say"; headline: string; detail: string | null }
  | { kind: "stream"; key: number; text: string; heardWords: () => number; ended: boolean; landOn: string | null }
  | { kind: "listening" }
  | { kind: "thinking" }
  | { kind: "none" }

const LAND_MS = 620
/** A mensagem onde a fala pousa, na MESMA sessão (o diálogo) do balão. */
function findMessage(bubble: HTMLElement, id: string): HTMLElement | null {
  const scope = bubble.closest<HTMLElement>("[data-slot=dialog-content]") ?? document
  return Array.from(scope.querySelectorAll<HTMLElement>("[data-message-id]")).find((element) => element.dataset.messageId === id) ?? null
}
const prefersReducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * Balão da INIA no palco. Decorativo para leitor de tela (o estado vai na região de status da sessão; a fala, quando pousa, vira
 * mensagem da conversa — marcada pelo chat com `data-message-id`). `onLanded` avisa que o pouso terminou.
 */
export function StageSpeechBubble({ speech, tail, tipAt, onLanded, className }: {
  speech: FeedbackSessionSpeech
  tail: "down" | "up"
  /** Onde a ponta do rabicho (ou as bolinhas do pensamento) cai, em fração da largura — em cima da cabeça dela. Padrão: ~30%. */
  tipAt?: number
  onLanded(key: number): void
  className?: string
}) {
  const bubbleRef = useRef<HTMLDivElement>(null)
  const stream = speech.kind === "stream" ? speech : null
  const landingKey = stream?.ended ? stream.key : null

  // POUSO: o balão voa até a mensagem (e se desfaz) enquanto a mensagem surge do lugar do balão — um só movimento, como se o
  // balão virasse a mensagem. Antes da pintura (sem um quadro da mensagem no lugar final). Sem movimento: pousa na hora.
  useLayoutEffect(() => {
    if (landingKey === null || !stream) return
    const bubble = bubbleRef.current
    const target = stream.landOn && bubble ? findMessage(bubble, stream.landOn) : null
    if (!bubble || !target || prefersReducedMotion() || typeof target.animate !== "function") {
      onLanded(landingKey)
      return
    }
    target.scrollIntoView({ block: "nearest" })
    const from = bubble.getBoundingClientRect()
    const to = target.getBoundingClientRect()
    if (from.width === 0 || to.width === 0) {
      onLanded(landingKey)
      return
    }
    const scale = to.width / from.width
    const easing = "cubic-bezier(.2,.8,.2,1)"
    bubble.animate(
      [
        { transform: "translate(0, 0) scale(1)", opacity: 1, filter: "blur(0)" },
        { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${scale})`, opacity: 0, filter: "blur(2px)" },
      ],
      { duration: LAND_MS, easing, fill: "forwards" },
    )
    const land = target.animate(
      [
        { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${1 / scale})`, opacity: 0, transformOrigin: "top left" },
        { transform: "translate(0, 0) scale(1)", opacity: 1, transformOrigin: "top left" },
      ],
      { duration: LAND_MS, easing },
    )
    let done = false
    const finish = () => {
      if (done) return
      done = true
      onLanded(landingKey)
    }
    land.finished.then(finish, finish)
    return () => finish()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- o pouso roda uma vez por fala (a chave), com a fala daquele momento
  }, [landingKey])

  // Celular (balão embaixo dela, numa rolagem só): quando uma fala COMEÇA, o balão entra na tela — quem estava lendo a conversa
  // vê a resposta nascer; no fim, o pouso traz a mensagem de volta para a vista.
  const streamKey = stream?.key ?? null
  useEffect(() => {
    if (tail !== "up" || streamKey === null) return
    bubbleRef.current?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" })
  }, [tail, streamKey])

  if (speech.kind === "none") return null
  const thinking = speech.kind === "thinking"
  // Uma entrada por "fala": trocar de fala (ou de modo) refaz o balão com o pulo de entrada.
  const enterKey = speech.kind === "stream" ? `stream-${speech.key}` : speech.kind
  return (
    <div
      key={enterKey}
      ref={bubbleRef}
      aria-hidden
      className={cn("relative z-20 inia-bubble-pop", tipAt === undefined && (tail === "down" ? "origin-[30%_100%]" : "origin-[50%_0%]"), thinking && (tail === "down" ? (tipAt === undefined ? "ml-[20%] self-start" : "self-start") : "self-center"), className)}
      // A nuvem de pensamento é estreita: posicionada para as bolinhas (a ~30 px da borda dela) caírem em cima da cabeça.
      style={tipAt === undefined ? undefined : thinking && tail === "down" ? { marginLeft: `calc(${(tipAt * 100).toFixed(2)}% - ${THOUGHT_PUFF_X}px)`, transformOrigin: `${THOUGHT_PUFF_X}px 100%` } : { transformOrigin: `${(tipAt * 100).toFixed(2)}% ${tail === "down" ? "100%" : "0%"}` }}
      data-testid="feedback-session-speech"
      data-speech={speech.kind}
    >
      <SketchBubble shape={thinking ? "thought" : "speech"} direction={tail} tipAt={thinking ? undefined : tipAt} animated={speech.kind === "stream" && !speech.ended}>
        {speech.kind === "say" ? (
          <>
            <p className="text-xl leading-snug font-semibold text-balance">{speech.headline}</p>
            {speech.detail ? <p className="mt-1 text-sm text-muted-foreground">{speech.detail}</p> : null}
          </>
        ) : speech.kind === "stream" ? (
          <StreamingWords text={speech.text} heardWords={speech.heardWords} ended={speech.ended} />
        ) : speech.kind === "listening" ? (
          <p className="flex items-center gap-2 text-base font-medium"><Mic className="size-4 animate-pulse text-primary motion-reduce:animate-none dark:text-chart-4" />Estou ouvindo você…</p>
        ) : (
          <span className="flex items-center gap-1.5 py-1" data-testid="feedback-session-thinking">
            {[0, 1, 2].map((dot) => <span key={dot} className="size-2.5 animate-bounce rounded-full bg-primary/70 motion-reduce:animate-none dark:bg-chart-4/80" style={{ animationDelay: `${dot * 140}ms` }} />)}
          </span>
        )}
      </SketchBubble>
    </div>
  )
}

/**
 * Texto que aparece NO RITMO DA VOZ: a cada quadro pergunta quantas palavras já soaram e só re-renderiza quando o número muda;
 * cada palavra nova entra com um leve desfoque → nítido. As linhas antigas sobem e somem no topo (o fim da fala fica à vista).
 */
function StreamingWords({ text, heardWords, ended }: { text: string; heardWords: () => number; ended: boolean }) {
  const words = useMemo(() => text.trim().split(/\s+/).filter(Boolean), [text])
  const [heard, setHeard] = useState(0)
  useEffect(() => {
    if (ended) return
    let frame = 0
    const tick = () => {
      const next = Math.min(words.length, Math.max(0, heardWords()))
      setHeard((current) => (next > current ? next : current))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [ended, words.length, heardWords])
  // Terminou (ou foi cortada): a fala inteira, como ficou.
  const shown = ended ? words.length : heard
  // O topo só esmaece quando há linhas escondidas acima (texto curto fica inteiro e nítido).
  const windowRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    const box = windowRef.current
    const content = textRef.current
    if (box && content) box.toggleAttribute("data-overflow", content.offsetHeight > box.clientHeight + 1)
  }, [shown])
  return (
    <div ref={windowRef} className="inia-stream-window flex max-h-[9.5rem] flex-col justify-end overflow-hidden">
      <p ref={textRef} className="shrink-0 text-[17px] leading-[1.55] font-medium text-pretty" data-testid="feedback-session-stream">
        {words.slice(0, shown).map((word, index) => (
          <span key={index}>
            <span className="inia-word">{word}</span>{" "}
          </span>
        ))}
        {!ended ? <span aria-hidden className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-current/60 motion-reduce:animate-none" /> : null}
      </p>
    </div>
  )
}

/**
 * Balão DESENHADO: contorno à mão (traço duplo, levemente torto) gerado no tamanho real do balão, com rabicho de quadrinho
 * apontando para ela — ou bolinhas, no balão de pensamento. Enquanto ela fala, o traço "ferve" (como em animação desenhada à
 * mão); com movimento reduzido, fica parado.
 */
function SketchBubble({ shape, direction, tipAt, animated, children }: { shape: "speech" | "thought"; direction: "down" | "up"; tipAt?: number; animated: boolean; children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [seed, setSeed] = useState(7)
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const measure = () => setSize((current) => (current && current.width === box.offsetWidth && current.height === box.offsetHeight ? current : { width: box.offsetWidth, height: box.offsetHeight }))
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!animated || prefersReducedMotion()) return
    const timer = window.setInterval(() => setSeed((value) => (value % 997) + 1), 150)
    return () => window.clearInterval(timer)
  }, [animated])

  // Espaço do rabicho (fala) ou das bolinhas (pensamento), do lado em que ela está.
  const extra = shape === "thought" ? 34 : 22
  const up = direction === "up"
  const paths = useMemo(() => (size ? bubblePaths(size.width, size.height, shape, seed, tipAt) : null), [size, shape, seed, tipAt])
  const ink = "stroke-[color-mix(in_oklab,var(--foreground)_82%,var(--primary))]"
  return (
    <div ref={boxRef} className={cn("relative", shape === "thought" ? "inline-block px-6 py-4" : "px-6 py-5")} style={up ? { marginTop: extra } : { marginBottom: extra }}>
      {size && paths ? (
        <svg aria-hidden className="pointer-events-none absolute left-0 overflow-visible drop-shadow-[0_10px_22px_rgba(10,4,20,0.28)]" style={{ top: up ? -extra : 0 }} width={size.width} height={size.height + extra} viewBox={`0 0 ${size.width} ${size.height + extra}`}>
          <g transform={up ? `translate(0 ${size.height + extra}) scale(1 -1)` : undefined}>
            <path d={paths.body} className="fill-background" />
            {paths.puffs.map((puff, index) => <circle key={index} cx={puff.x} cy={puff.y} r={puff.r} className="fill-background" />)}
            <path d={paths.body} fill="none" className={ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            <path d={paths.sketch} fill="none" className={ink} strokeWidth={1} strokeOpacity={0.45} strokeLinecap="round" strokeLinejoin="round" />
            {paths.puffs.map((puff, index) => <circle key={index} cx={puff.x} cy={puff.y} r={puff.r} fill="none" className={ink} strokeWidth={2} />)}
          </g>
        </svg>
      ) : null}
      <div className="relative">{children}</div>
    </div>
  )
}

/** A ponta do rabicho fica um pouco à esquerda de onde ele sai (curvado como nos quadrinhos). */
const TAIL_TIP_OFFSET = 12
/** Distância das bolinhas do pensamento até a borda esquerda da nuvem. */
const THOUGHT_PUFF_X = 30

/** Gerador determinístico (o mesmo `seed` = o mesmo traço). */
function random(seed: number) {
  let state = seed * 9301 + 49297
  return () => {
    state = (state * 9301 + 49297) % 233280
    return state / 233280
  }
}

/**
 * Contorno de balão de quadrinho no tamanho dado: retângulo de cantos redondos com lados levemente curvos (cada lado é uma curva
 * com pontos de controle tremidos) e o rabicho saindo de baixo, curvado para a esquerda, com a ponta em `tipAt` da largura
 * (padrão: saindo a ~30%). `sketch` é o segundo
 * traço, mais fino e um pouco desencontrado (o "lápis" passando duas vezes). O balão de PENSAMENTO é uma nuvem (bordas em
 * gomos) com duas bolinhas descendo até ela.
 */
function bubblePaths(width: number, height: number, shape: "speech" | "thought", seed: number, tipAt?: number) {
  if (shape === "thought") {
    const puffX = Math.min(width * 0.3, THOUGHT_PUFF_X)
    return { body: cloud(width, height, random(seed), 1), sketch: cloud(width, height, random(seed + 101), 1.8), puffs: [{ x: puffX, y: height + 12, r: 6.5 }, { x: puffX - 9, y: height + 27, r: 4 }] }
  }
  const outline = (rand: () => number, wobble: number) => {
    const j = () => (rand() - 0.5) * 2 * wobble
    const r = Math.min(26, height / 2.4)
    const w = width
    const h = height
    const side = (x1: number, y1: number, x2: number, y2: number) => `C ${x1 + (x2 - x1) / 3 + j()} ${y1 + (y2 - y1) / 3 + j()} ${x1 + ((x2 - x1) * 2) / 3 + j()} ${y1 + ((y2 - y1) * 2) / 3 + j()} ${x2 + j() * 0.4} ${y2 + j() * 0.4}`
    const corner = (cx: number, cy: number, x: number, y: number) => `Q ${cx + j()} ${cy + j()} ${x} ${y}`
    // Rabicho de quadrinho: sai do lado de baixo e se curva até a ponta, à esquerda.
    const base = Math.max(r + 22, Math.min(w - r - 30, tipAt === undefined ? w * 0.3 : w * tipAt + TAIL_TIP_OFFSET))
    const tip = { x: base - TAIL_TIP_OFFSET + j(), y: h + 20 + j() * 0.5 }
    return [
      `M ${r} ${j() * 0.4}`, side(r, 0, w - r, 0), corner(w, 0, w, r), side(w, r, w, h - r), corner(w, h, w - r, h),
      side(w - r, h, base + 22, h), `Q ${base + 8 + j()} ${h + 6 + j()} ${tip.x} ${tip.y}`, `Q ${base + 2 + j()} ${h + 9 + j()} ${base - 6} ${h}`, side(base - 6, h, r, h),
      corner(0, h, 0, h - r), side(0, h - r, 0, r), corner(0, 0, r, 0), "Z",
    ].join(" ")
  }
  return { body: outline(random(seed), 1.6), sketch: outline(random(seed + 101), 2.6), puffs: [] as { x: number; y: number; r: number }[] }
}

/** Nuvem: o perímetro de um retângulo arredondado percorrido em gomos (arcos para fora), cada um de tamanho levemente diferente. */
function cloud(width: number, height: number, rand: () => number, wobble: number) {
  const r = Math.min(height / 2, 18)
  const straightX = Math.max(0, width - 2 * r)
  const straightY = Math.max(0, height - 2 * r)
  const total = 2 * straightX + 2 * straightY + 2 * Math.PI * r
  const count = Math.max(8, Math.round(total / 19))
  const pointAt = (distance: number): [number, number] => {
    let d = distance % total
    const quarter = (Math.PI * r) / 2
    const arc = (cx: number, cy: number, from: number, t: number): [number, number] => [cx + r * Math.cos(from + t / r), cy + r * Math.sin(from + t / r)]
    if (d < straightX) return [r + d, 0]
    d -= straightX
    if (d < quarter) return arc(width - r, r, -Math.PI / 2, d)
    d -= quarter
    if (d < straightY) return [width, r + d]
    d -= straightY
    if (d < quarter) return arc(width - r, height - r, 0, d)
    d -= quarter
    if (d < straightX) return [width - r - d, height]
    d -= straightX
    if (d < quarter) return arc(r, height - r, Math.PI / 2, d)
    d -= quarter
    if (d < straightY) return [0, height - r - d]
    d -= straightY
    return arc(r, r, Math.PI, d)
  }
  const step = total / count
  const points = Array.from({ length: count }, (_, index) => pointAt(index * step))
  const parts = [`M ${points[0]![0]} ${points[0]![1]}`]
  for (let index = 1; index <= count; index++) {
    const [x, y] = points[index % count]!
    const radius = step * (0.6 + rand() * 0.12) + (rand() - 0.5) * wobble
    parts.push(`A ${radius} ${radius} 0 0 1 ${x + (rand() - 0.5) * wobble} ${y + (rand() - 0.5) * wobble}`)
  }
  return `${parts.join(" ")} Z`
}
