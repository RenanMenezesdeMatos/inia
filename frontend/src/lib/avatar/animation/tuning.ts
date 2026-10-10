import type { AvatarTuning } from "./types"
import { DEFAULT_AVATAR_TUNING } from "./types"

/**
 * Ajustes efetivos e utilitários numéricos compartilhados pelas camadas de animação.
 *
 * `prefers-reduced-motion`: a pessoa pediu menos movimento na tela. O avatar continua "presente"
 * (respira, pisca, a boca acompanha a fala — isso é informação, não enfeite), mas gestos de braço
 * quase somem e a cabeça/olhar se mexem bem menos.
 */
const REDUCED_MOTION_SCALE: Readonly<AvatarTuning> = Object.freeze({
  gestureIntensity: 0.25,
  breathing: 0.7,
  blinkRate: 1,
  smile: 1,
  lipsync: 1,
  headMotion: 0.35,
  gaze: 0.6,
})

const TUNING_KEYS = Object.keys(DEFAULT_AVATAR_TUNING) as Array<keyof AvatarTuning>

/** Escreve em `out` o ajuste efetivo (0..2 por campo) sem alocar. */
export function writeEffectiveTuning(base: AvatarTuning, reducedMotion: boolean, out: AvatarTuning): AvatarTuning {
  for (const key of TUNING_KEYS) {
    const raw = Number.isFinite(base[key]) ? base[key] : DEFAULT_AVATAR_TUNING[key]
    const scaled = reducedMotion ? raw * REDUCED_MOTION_SCALE[key] : raw
    out[key] = clamp(scaled, 0, 2)
  }
  return out
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * Aproximação exponencial independente de FPS: `current` anda na direção de `target` com
 * constante de tempo `tau` (s). `tau ≤ 0` = chega na hora.
 */
export function damp(current: number, target: number, tau: number, dt: number): number {
  if (tau <= 0 || dt <= 0) return tau <= 0 ? target : current
  return target + (current - target) * Math.exp(-dt / tau)
}

/** Rampa linear com velocidade máxima `ratePerSecond` — limita o salto por quadro. */
export function approach(current: number, target: number, ratePerSecond: number, dt: number): number {
  const step = ratePerSecond * dt
  if (target > current) return Math.min(target, current + step)
  return Math.max(target, current - step)
}

export function smoothstep01(t: number): number {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}

/** Ease in/out senoidal (0→0, 1→1, derivada nula nas pontas). */
export function easeInOutSine(t: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t))
}

export const DEG = Math.PI / 180
