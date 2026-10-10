import { afterEach, describe, expect, it, vi } from "vitest"
import { decodeWavPcm16, sampleRateOf, synthesizeSpeechWithGemini } from "./gemini-tts-client.js"

function wav(samples: number[], options: { sampleRate?: number; channels?: number } = {}): Buffer {
  const channels = options.channels ?? 1
  const sampleRate = options.sampleRate ?? 24_000
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2))
  const header = Buffer.alloc(44)
  header.write("RIFF", 0, "ascii"); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8, "ascii")
  header.write("fmt ", 12, "ascii"); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34)
  header.write("data", 36, "ascii"); header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

vi.mock("../../../config/env.js", () => ({ env: { GEMINI_API_KEY: "test-key", INIA_AVATAR_TTS_MODEL: "gemini-3.8-flash-lite-tts", INIA_AVATAR_VOICE: undefined } }))

afterEach(() => vi.unstubAllGlobals())

describe("TTS do Gemini — voz do recado", () => {
  it("envia o texto EXATO com a voz configurada e devolve PCM16 + taxa + uso", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: Buffer.from([1, 0, 255, 255]).toString("base64") } }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 300, totalTokenCount: 312 },
    })))
    vi.stubGlobal("fetch", fetchMock)
    const speech = await synthesizeSpeechWithGemini({ text: "Oi, Marcela. Tenho um retorno." })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/models\/gemini-3\.8-flash-lite-tts:generateContent$/)
    const body = JSON.parse(String(init.body))
    expect(body.contents[0].parts[0].text).toBe("Oi, Marcela. Tenho um retorno.")
    expect(body.generationConfig).toEqual({ responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } })
    expect(speech).toMatchObject({ sampleRate: 24_000, model: "gemini-3.8-flash-lite-tts", voice: "Kore", usage: { promptTokens: 12, outputTokens: 300, totalTokens: 312 } })
    expect([...speech.pcm16]).toEqual([1, 0, 255, 255])
  })
  it("resposta sem áudio PCM ou erro do provider: falha (o navegador usa a voz do sistema)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "oi" }] } }] }))))
    await expect(synthesizeSpeechWithGemini({ text: "x" })).rejects.toMatchObject({ code: "SPEECH_UNEXPECTED_RESPONSE" })
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429 })))
    await expect(synthesizeSpeechWithGemini({ text: "x" })).rejects.toMatchObject({ code: "SPEECH_PROVIDER_ERROR" })
  })
  it("modelos novos devolvem WAV: lê o cabeçalho (taxa, mono) e entrega só as amostras", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/wav", data: wav([100, -100, 7], { sampleRate: 22_050 }).toString("base64") } }] } }] }))))
    const speech = await synthesizeSpeechWithGemini({ text: "Oi." })
    expect(speech.sampleRate).toBe(22_050)
    expect([speech.pcm16.readInt16LE(0), speech.pcm16.readInt16LE(2), speech.pcm16.readInt16LE(4)]).toEqual([100, -100, 7])
    expect(decodeWavPcm16(wav([10, 30, -10, -30], { channels: 2 }))!.pcm16.length).toBe(4)
    expect(decodeWavPcm16(Buffer.from("not a wav"))).toBeNull()
  })
  it("formato do áudio", () => {
    expect(sampleRateOf("audio/L16;codec=pcm;rate=24000")).toBe(24_000)
    expect(sampleRateOf("audio/mpeg")).toBeNull()
  })
})
