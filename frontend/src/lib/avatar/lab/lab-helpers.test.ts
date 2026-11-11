import { describe, expect, it } from "vitest"

import type { AlignedPhone, AudioFeatureFrame, PhoneSymbol } from "@/lib/avatar/lipsync/types"
import { parseUploadTarget, pickRecordingMimeType, recordingFileName } from "./demo-recorder"
import { FrameStats, percentile } from "./frame-stats"
import { LAB_MODEL_URLS, modelExists, parseLabQuery, resolveDefaultModelUrl } from "./lab-models"
import { alignedPhoneAt, energyAt, energyLevel, isMidWord, timelineWindow, timeToX } from "./speech-timeline"

const phone = (symbol: PhoneSymbol, start: number, end: number, wordIndex: number): AlignedPhone => ({
  phone: symbol,
  start,
  end,
  stressed: false,
  nucleus: false,
  wordIndex,
  source: "aligned",
  loudness: 1,
})

// "olá eu": o(0) l(0) a(0) _ e(1) w(1)
const PHONES: AlignedPhone[] = [phone("o", 1, 1.1, 0), phone("l", 1.1, 1.16, 0), phone("a", 1.16, 1.3, 0), phone("_", 1.3, 1.5, -1), phone("e", 1.5, 1.6, 1), phone("w", 1.6, 1.7, 1)]

describe("linha do tempo", () => {
  it("acha o fone ouvido e nada em buracos/antes/depois", () => {
    expect(alignedPhoneAt(PHONES, 1.12)?.phone).toBe("l")
    expect(alignedPhoneAt(PHONES, 0.5)).toBeNull()
    expect(alignedPhoneAt(PHONES, 2)).toBeNull()
  })

  it("meio da palavra = fone não-pausa com vizinhos da mesma palavra", () => {
    expect(isMidWord(PHONES, 1.12)).toBe(true) // "l" de olá
    expect(isMidWord(PHONES, 1.05)).toBe(false) // início da palavra
    expect(isMidWord(PHONES, 1.25)).toBe(false) // fim da palavra
    expect(isMidWord(PHONES, 1.4)).toBe(false) // pausa
    expect(isMidWord(PHONES, 1.65)).toBe(false) // última da resposta
  })

  it("janela, posição e energia", () => {
    const span = timelineWindow(10)
    expect(span).toEqual({ start: 5, end: 11, cursor: 10 })
    expect(timeToX(8, span, 600)).toBe(300)
    expect(energyLevel(-60)).toBe(0)
    expect(energyLevel(0)).toBe(1)
    expect(energyLevel(-30)).toBeCloseTo(0.5)
    const frames = [0, 0.01, 0.02].map((time, i): AudioFeatureFrame => ({ time, energyDb: -60 + i * 30, vowelBandDb: 0, highBandRatio: 0, zeroCrossingRate: 0, voicing: 0 }))
    expect(energyAt(frames, 0.011)).toBeCloseTo(0.5)
    expect(energyAt(frames, 0.019)).toBe(1)
    expect(energyAt(frames, 0.5)).toBeNull()
  })
})

describe("FrameStats", () => {
  it("FPS e percentis da janela; buracos > 1 s não contam", () => {
    const stats = new FrameStats(8)
    let now = 0
    stats.tick(now)
    for (const interval of [16, 16, 17, 16, 33, 16, 2000, 16]) {
      now += interval
      stats.tick(now)
    }
    const summary = stats.summary()
    expect(summary.count).toBe(7)
    expect(summary.p50Ms).toBe(16)
    expect(summary.p95Ms).toBe(33)
    expect(summary.fps).toBeCloseTo((1000 * 7) / 130, 5)
    stats.reset()
    expect(stats.summary()).toEqual({ fps: 0, p50Ms: 0, p95Ms: 0, count: 0 })
  })

  it("janela circular fica só com os últimos intervalos", () => {
    const stats = new FrameStats(4)
    let now = 0
    stats.tick(now)
    for (const interval of [100, 100, 100, 100, 10, 10, 10, 10]) stats.tick((now += interval))
    expect(stats.summary().p95Ms).toBe(10)
    expect(percentile([], 0.5)).toBe(0)
  })
})

describe("gravação", () => {
  it("prefere VP9/Opus, depois VP8/Opus, depois WebM genérico", () => {
    expect(pickRecordingMimeType(() => true)).toBe("video/webm;codecs=vp9,opus")
    expect(pickRecordingMimeType((type) => !type.includes("vp9"))).toBe("video/webm;codecs=vp8,opus")
    expect(pickRecordingMimeType((type) => type === "video/webm")).toBe("video/webm")
    expect(pickRecordingMimeType(() => false)).toBeNull()
  })

  it("upload só para http(s) de loopback com porta explícita", () => {
    expect(parseUploadTarget("?upload=http://127.0.0.1:8123/save")?.href).toBe("http://127.0.0.1:8123/save")
    expect(parseUploadTarget("?upload=http%3A%2F%2Flocalhost%3A9000%2Fx")?.href).toBe("http://localhost:9000/x")
    for (const bad of ["", "?upload=", "?upload=http://evil.example:80/x", "?upload=http://127.0.0.1/x", "?upload=file:///etc/passwd", "?upload=http://user:pw@127.0.0.1:1/x", "?upload=nota-url"]) {
      expect(parseUploadTarget(bad)).toBeNull()
    }
  })

  it("nome do arquivo sem acento/espaço e com a hora local", () => {
    expect(recordingFileName("Frase 1 — apresentação", new Date(2026, 8, 25, 2, 15, 30))).toBe("inia-avatar-frase-1-apresentacao-20260925-021530.webm")
    expect(recordingFileName("—", new Date(2026, 0, 2, 3, 4, 5))).toBe("inia-avatar-demo-20260102-030405.webm")
  })
})

describe("modelo padrão", () => {
  const respond = (status: number, type = "model/gltf-binary") => (async () => new Response(null, { status, headers: { "content-type": type } })) as typeof fetch
  it("mentora quando o GLB existe; POC quando não (404, HTML ou rede)", async () => {
    expect(await resolveDefaultModelUrl(respond(200))).toBe("/models/inia-mentora.glb")
    expect(await resolveDefaultModelUrl(respond(404))).toBe("/models/inia-avatar-poc.glb")
    expect(await modelExists("/x.glb", respond(200, "text/html; charset=utf-8"))).toBe(false)
    expect(await modelExists("/x.glb", (async () => Promise.reject(new TypeError("rede"))) as typeof fetch)).toBe(false)
  })

  it("o v02 é uma opção do laboratório, nunca o padrão", async () => {
    expect(LAB_MODEL_URLS.map((model) => model.url)).toEqual(["/models/inia-mentora.glb", "/models/inia-mentora-v02.glb", "/models/inia-avatar-poc.glb"])
    expect(await resolveDefaultModelUrl((async () => new Response(null, { status: 200, headers: { "content-type": "model/gltf-binary" } })) as typeof fetch)).toBe("/models/inia-mentora.glb")
  })

  it("atalhos da URL: modelo, perfil de movimento e vista; valor desconhecido é ignorado", () => {
    expect(parseLabQuery("?model=v02&motion=classic&view=front")).toEqual({ modelUrl: "/models/inia-mentora-v02.glb", motion: "classic", view: "front" })
    expect(parseLabQuery("?model=outro&motion=turbo")).toEqual({ modelUrl: null, motion: null, view: null })
    expect(parseLabQuery("")).toEqual({ modelUrl: null, motion: null, view: null })
  })
})
