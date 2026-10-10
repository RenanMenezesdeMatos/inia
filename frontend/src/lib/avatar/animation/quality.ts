import type { AvatarQuality } from "./types"

/**
 * Níveis de qualidade do avatar.
 *
 * "auto" decide pelo aparelho no início (núcleos, memória, ponteiro grosso = celular/tablet,
 * movimento reduzido) e um monitor de tempo de quadro DESCE um nível se o aparelho não aguenta
 * (nunca sobe sozinho: oscilar entre níveis é pior que ficar num nível estável).
 * `antialias` só vale na criação do WebGL — depois o nível só muda DPR e os cachos do cabelo.
 */

export type QualitySettings = {
  /** Teto do devicePixelRatio do canvas. */
  maxDpr: number
  /** MSAA do WebGL (fixo na criação). */
  antialias: boolean
  /** Mostra a malha dos cachos (`INIA_HairCurls`), a mais cara do cabelo. */
  hairCurls: boolean
}

export const QUALITY_SETTINGS: Readonly<Record<AvatarQuality, QualitySettings>> = {
  high: { maxDpr: 2, antialias: true, hairCurls: true },
  medium: { maxDpr: 1.5, antialias: true, hairCurls: true },
  // Os cachos continuam no nível baixo: sem eles o afro vira um "capacete" liso — o volume do
  // cabelo é a característica mais marcante da INIA. O custo real do nível baixo sai da resolução.
  low: { maxDpr: 1, antialias: false, hairCurls: true },
}

export type QualityEnvironment = {
  hardwareConcurrency: number | null
  /** GB (Chrome: `navigator.deviceMemory`, arredondado); null = desconhecido. */
  deviceMemory: number | null
  coarsePointer: boolean
  reducedMotion: boolean
}

/** Lê o ambiente do navegador com segurança (SSR/jsdom = valores neutros). */
export function detectQualityEnvironment(): QualityEnvironment {
  const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { deviceMemory?: number })
  const media = (query: string) => {
    try {
      return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches
    } catch {
      return false
    }
  }
  return {
    hardwareConcurrency: typeof nav?.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : null,
    deviceMemory: typeof nav?.deviceMemory === "number" && nav.deviceMemory > 0 ? nav.deviceMemory : null,
    coarsePointer: media("(pointer: coarse)"),
    reducedMotion: media("(prefers-reduced-motion: reduce)"),
  }
}

export function autoQuality(env: QualityEnvironment): AvatarQuality {
  const cores = env.hardwareConcurrency
  const memory = env.deviceMemory
  if ((cores !== null && cores <= 2) || (memory !== null && memory <= 2)) return "low"
  if (env.coarsePointer || env.reducedMotion || (cores !== null && cores <= 4) || (memory !== null && memory <= 4)) return "medium"
  return "high"
}

export function lowerQuality(quality: AvatarQuality): AvatarQuality | null {
  if (quality === "high") return "medium"
  if (quality === "medium") return "low"
  return null
}

export type FrameTimeMonitorOptions = {
  /**
   * Média acima disso (ms) conta como "lento" (padrão 40 ms ≈ 25 fps). O monitor mede o intervalo
   * entre quadros, que também cai para 30 fps estáveis em modo de economia de bateria (Mac/iPhone,
   * Chrome) sem o aparelho estar sobrecarregado — por isso o limite fica abaixo de 30 fps.
   */
  budgetMs?: number
  /** Segundos seguidos acima do orçamento antes de descer (padrão 5). */
  sustainSeconds?: number
  /** Ignora o começo (carregamento/compilação de shaders) (padrão 2,5 s). */
  warmupSeconds?: number
  /** Espera depois de descer, antes de avaliar de novo (padrão 4 s). */
  cooldownSeconds?: number
}

/**
 * Monitor de tempo de quadro. `sample(dt)` a cada quadro; devolve `true` quando é hora de descer
 * um nível. Quadros enormes (aba voltando do segundo plano, `frameloop` pausado) são ignorados.
 */
export class FrameTimeMonitor {
  private readonly budget: number
  private readonly sustain: number
  private readonly warmup: number
  private readonly cooldown: number
  private elapsed = 0
  private average = 0
  private slowFor = 0
  private quietUntil = 0

  constructor(options: FrameTimeMonitorOptions = {}) {
    this.budget = (options.budgetMs ?? 40) / 1000
    this.sustain = options.sustainSeconds ?? 5
    this.warmup = options.warmupSeconds ?? 2.5
    this.cooldown = options.cooldownSeconds ?? 4
  }

  reset(): void {
    this.elapsed = 0
    this.average = 0
    this.slowFor = 0
    this.quietUntil = 0
  }

  sample(dtSeconds: number): boolean {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0 || dtSeconds > 0.25) return false
    this.elapsed += dtSeconds
    // Média exponencial de ~0,5 s.
    const alpha = Math.min(1, dtSeconds / 0.5)
    this.average = this.average === 0 ? dtSeconds : this.average + (dtSeconds - this.average) * alpha
    if (this.elapsed < this.warmup || this.elapsed < this.quietUntil) {
      this.slowFor = 0
      return false
    }
    this.slowFor = this.average > this.budget ? this.slowFor + dtSeconds : 0
    if (this.slowFor < this.sustain) return false
    this.slowFor = 0
    this.quietUntil = this.elapsed + this.cooldown
    return true
  }
}
