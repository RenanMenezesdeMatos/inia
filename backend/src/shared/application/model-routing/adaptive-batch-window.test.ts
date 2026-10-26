import { describe, expect, it } from "vitest"
import { AiCallCancelledError } from "./ai-errors.js"
import { createAdaptiveBatchWindow, type AdaptiveBatchWindowConfig } from "./adaptive-batch-window.js"

const config: AdaptiveBatchWindowConfig = { windowMs: 60_000, minTokensPerMinute: 10_000, startTokensPerMinute: 100_000, maxTokensPerMinute: 200_000, increaseStep: 50_000, increaseEveryMs: 10_000, congestionDebounceMs: 2_000, holdAfterInteractiveMs: 60_000, idleResetMs: 60_000, defaultCallTokens: 4_000 }

function windowAt(clock: { now: number }) {
  return createAdaptiveBatchWindow(config, { now: () => clock.now, timer: false, log: () => {} })
}
const settled = async (promise: Promise<unknown>) => {
  let done = false
  void promise.then(() => (done = true), () => (done = true))
  await Promise.resolve()
  await Promise.resolve()
  return done
}

describe("vazão adaptativa do lote (tokens/min por conexão, AIMD com partida lenta)", () => {
  it("partida lenta: começa no teto inicial; o que passa espera a janela de 60 s liberar ou o teto subir; passando do máximo, o teto some", async () => {
    const clock = { now: 0 }
    const window = windowAt(clock)
    await window.admit("k", 60_000)
    await window.admit("k", 30_000)
    const waiting = window.admit("k", 20_000)
    expect(await settled(waiting)).toBe(false)
    expect(window.stats().k).toEqual({ tokensPerMinute: 100_000, usedLastMinute: 90_000, waiting: 1 })
    clock.now += 10_000
    window.tick() // +50 mil
    expect(await settled(waiting)).toBe(true)
    clock.now += 10_000
    window.tick()
    clock.now += 10_000
    window.tick()
    expect(window.stats().k!.tokensPerMinute).toBeNull()
  })

  it("chamada sozinha nunca trava (maior que o teto, sem nada no último minuto) e a janela de 60 s libera o que passou", async () => {
    const clock = { now: 0 }
    const window = windowAt(clock)
    await window.admit("k", 500_000)
    const next = window.admit("k", 1_000)
    expect(await settled(next)).toBe(false)
    clock.now += 60_001
    window.tick()
    expect(await settled(next)).toBe(true)
  })

  it("saturação: metade do que o lote usou no último minuto (a rajada conta uma vez); 429 do CHAT: um quarto e o teto parado por uma janela da cota", async () => {
    const clock = { now: 0 }
    const window = windowAt(clock)
    await window.admit("k", 80_000)
    window.congestion("k")
    window.congestion("k") // mesma rajada
    expect(window.stats().k!.tokensPerMinute).toBe(40_000)

    clock.now += 2_500
    window.congestion("k", { interactive: true })
    expect(window.stats().k!.tokensPerMinute).toBe(10_000) // min(40 mil, 80 mil usados) / 4
    clock.now += 30_000
    void window.admit("k", 1_000) // o lote continua pedindo (espera: o último minuto já passou do teto)
    window.tick()
    expect(window.stats().k!.tokensPerMinute).toBe(10_000) // segurado: o que o lote gastou ainda conta na cota
    clock.now += 31_000
    window.tick()
    expect(window.stats().k!.tokensPerMinute).toBe(60_000)
  })

  it("parado por um minuto, a próxima leva recomeça devagar", async () => {
    const clock = { now: 0 }
    const window = windowAt(clock)
    await window.admit("k", 1_000)
    for (let step = 0; step < 3; step += 1) {
      clock.now += 10_000
      window.tick()
    }
    expect(window.stats().k!.tokensPerMinute).toBeNull()
    clock.now += 61_000
    window.tick()
    expect(window.stats().k!.tokensPerMinute).toBe(100_000)
  })

  it("quem espera pode desistir (cancelamento) e nada é contado", async () => {
    const window = windowAt({ now: 0 })
    await window.admit("k", 100_000)
    const controller = new AbortController()
    const waiting = window.admit("k", 1_000, controller.signal)
    controller.abort()
    await expect(waiting).rejects.toBeInstanceOf(AiCallCancelledError)
    expect(window.stats().k).toMatchObject({ usedLastMinute: 100_000, waiting: 0 })
  })
})
