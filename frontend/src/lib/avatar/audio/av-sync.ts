"use client"

import { useSyncExternalStore } from "react"

/**
 * Sincronia boca × voz POR APARELHO e latência de apresentação.
 *
 * `heardTime` (`speech-playback.ts`) já desconta a latência de saída que o navegador informa
 * (`getOutputTimestamp`/`outputLatency`). O que ele não sabe:
 * - a latência que o aparelho NÃO informa direito (fones Bluetooth costumam relatar menos do que têm:
 *   a boca fica adiantada) → `avOffsetMs`, ajuste manual deste navegador, medido com o teste de claque
 *   do laboratório (`/dev/avatar-lab › Teste de sincronia`) e salvo em Acessibilidade;
 * - o caminho "pose calculada → imagem na tela": o quadro desenhado no `requestAnimationFrame` só
 *   aparece no próximo vsync → `FramePresentationEstimator` (um intervalo de quadro, medido).
 *
 * Positivo = boca adiantada em relação à voz (a mesma convenção de `SpeechPlaybackOptions.avOffsetMs`).
 * Sem armazenamento (janela privada, bloqueio) vale só enquanto a página está aberta.
 */

const STORAGE_KEY = "inia.avatar.avOffsetMs"
export const AV_OFFSET_LIMIT_MS = 300
const listeners = new Set<() => void>()
let cached: number | null = null

function clampOffset(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(-AV_OFFSET_LIMIT_MS, Math.min(AV_OFFSET_LIMIT_MS, Math.round(value)))
}

/** Ajuste deste aparelho (ms). Barato: lido a cada quadro pela reprodução. */
export function readAvOffsetMs(): number {
  if (cached !== null) return cached
  try {
    cached = clampOffset(Number(window.localStorage.getItem(STORAGE_KEY) ?? 0))
  } catch {
    cached = 0
  }
  return cached
}

export function setAvOffsetMs(ms: number): void {
  cached = clampOffset(ms)
  try {
    if (cached === 0) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, String(cached))
  } catch {
    // Sem armazenamento: vale para esta página.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAvOffsetMs(): number {
  return useSyncExternalStore(subscribe, readAvOffsetMs, () => 0)
}

/** Testes: esquece o valor lido. */
export function resetAvOffsetForTests(): void {
  cached = null
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

/** Primeira estimativa (60 Hz) e limites do intervalo de quadro (ms). */
const DEFAULT_FRAME_MS = 1000 / 60
const MIN_FRAME_MS = 4
/** Acima disso é pausa (aba em segundo plano, travada), não ritmo de quadro. */
const MAX_FRAME_MS = 100
/** Teto da compensação: 30 fps (economia de bateria). */
const MAX_LEAD_MS = 34
const SMOOTHING = 0.1

/**
 * Quanto falta para o quadro que está sendo calculado aparecer na tela: um intervalo de quadro
 * (média móvel dos intervalos observados — 16,7 ms a 60 Hz, 8,3 ms a 120 Hz, 33 ms a 30 fps). É a
 * parte determinística do caminho; o resto (compositor, painel) entra no ajuste medido do aparelho.
 */
export class FramePresentationEstimator {
  private last = Number.NaN
  private interval = DEFAULT_FRAME_MS

  /** Registra o quadro de agora (`performance.now()`) e devolve a antecipação a usar (ms). */
  observe(nowMs: number): number {
    const dt = nowMs - this.last
    this.last = nowMs
    if (dt >= MIN_FRAME_MS && dt <= MAX_FRAME_MS) this.interval += (dt - this.interval) * SMOOTHING
    return Math.min(MAX_LEAD_MS, this.interval)
  }

  get leadMs(): number {
    return Math.min(MAX_LEAD_MS, this.interval)
  }
}
