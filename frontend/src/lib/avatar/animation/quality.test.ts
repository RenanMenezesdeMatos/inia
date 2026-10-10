import { describe, expect, it } from "vitest"

import { autoQuality, FrameTimeMonitor, lowerQuality, QUALITY_SETTINGS } from "./quality"

const desktop = { hardwareConcurrency: 8, deviceMemory: 8, coarsePointer: false, reducedMotion: false }

describe("qualidade do avatar", () => {
  it("auto: desktop forte = high; celular/pouca memória = medium; aparelho fraco = low", () => {
    expect(autoQuality(desktop)).toBe("high")
    expect(autoQuality({ ...desktop, hardwareConcurrency: null, deviceMemory: null })).toBe("high")
    expect(autoQuality({ ...desktop, coarsePointer: true })).toBe("medium")
    expect(autoQuality({ ...desktop, deviceMemory: 4 })).toBe("medium")
    expect(autoQuality({ ...desktop, reducedMotion: true })).toBe("medium")
    expect(autoQuality({ ...desktop, hardwareConcurrency: 2 })).toBe("low")
    expect(autoQuality({ ...desktop, deviceMemory: 1 })).toBe("low")
  })

  it("níveis: só a baixa desliga antialias; os cachos ficam em todos; DPR decrescente", () => {
    expect(QUALITY_SETTINGS.low.hairCurls).toBe(true)
    expect(QUALITY_SETTINGS.low.antialias).toBe(false)
    expect(QUALITY_SETTINGS.medium.hairCurls).toBe(true)
    expect(QUALITY_SETTINGS.high.maxDpr).toBeGreaterThan(QUALITY_SETTINGS.medium.maxDpr)
    expect(QUALITY_SETTINGS.medium.maxDpr).toBeGreaterThan(QUALITY_SETTINGS.low.maxDpr)
    expect(lowerQuality("high")).toBe("medium")
    expect(lowerQuality("medium")).toBe("low")
    expect(lowerQuality("low")).toBeNull()
  })

  it("monitor: desce só com lentidão sustentada, depois do aquecimento, e espera antes de descer de novo", () => {
    const monitor = new FrameTimeMonitor({ budgetMs: 22, sustainSeconds: 3, warmupSeconds: 2, cooldownSeconds: 4 })
    const feed = (seconds: number, dt: number) => {
      let steps = 0
      for (let t = 0; t < seconds; t += dt) if (monitor.sample(dt)) steps++
      return steps
    }
    expect(feed(2, 0.04)).toBe(0) // aquecimento
    expect(feed(10, 1 / 60)).toBe(0) // rápido
    expect(feed(3.5, 0.04)).toBe(1) // 25 fps por 3,5 s
    expect(feed(3.5, 0.04)).toBe(0) // espera (4 s)
    expect(feed(4, 0.04)).toBe(1)
    // Quadros enormes (aba voltando / loop pausado) não contam.
    const fresh = new FrameTimeMonitor({ warmupSeconds: 0 })
    for (let index = 0; index < 100; index++) expect(fresh.sample(2)).toBe(false)
  })

  it("30 fps estáveis (economia de bateria) não rebaixam a qualidade; abaixo de ~25 fps sustentados, sim", () => {
    const monitor = new FrameTimeMonitor()
    let stepped = false
    for (let t = 0; t < 60; t += 1 / 30) stepped = monitor.sample(1 / 30) || stepped
    expect(stepped).toBe(false)
    const slow = new FrameTimeMonitor()
    let steppedSlow = false
    for (let t = 0; t < 20; t += 1 / 18) steppedSlow = slow.sample(1 / 18) || steppedSlow
    expect(steppedSlow).toBe(true)
  })
})
