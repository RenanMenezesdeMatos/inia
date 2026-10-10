import { describe, expect, it, vi } from "vitest"
import { acceptedRecadoModels, createRecadoVoice } from "./recado-voice.js"

const TEXT = "Oi, Larissa. O protocolo não foi informado ao cliente. Veja no feedback como ajustar o encerramento."
const audio = (model: string) => ({ pcm16: Buffer.alloc(4800), sampleRate: 24_000, model, voice: "Kore" })

describe("voz do recado: a da conversa, conferida; senão a leitura", () => {
  it("fala fiel → áudio do modelo da conversa, sem TTS", async () => {
    const readWithTts = vi.fn(async () => audio("tts"))
    const voice = createRecadoVoice({ speakLikeConversation: async () => ({ ...audio("live"), transcript: TEXT }), readWithTts })
    await expect(voice({ text: TEXT })).resolves.toMatchObject({ model: "live", voice: "Kore" })
    expect(readWithTts).not.toHaveBeenCalled()
  })

  it("fala que mudou o texto → descartada, leitura do TTS marcada como plano B", async () => {
    const onFallback = vi.fn()
    const voice = createRecadoVoice({ speakLikeConversation: async () => ({ ...audio("live"), transcript: `Claro! Aqui vai o seu recado: ${TEXT}` }), readWithTts: async () => audio("tts"), onFallback })
    await expect(voice({ text: TEXT })).resolves.toMatchObject({ model: "fallback:tts" })
    expect(onFallback).toHaveBeenCalledWith(expect.objectContaining({ reason: "FIDELITY" }))
  })

  it("provedor falhou → leitura do TTS", async () => {
    const onFallback = vi.fn()
    const voice = createRecadoVoice({ speakLikeConversation: async () => { throw Object.assign(new Error("x"), { code: "SPEECH_TIMEOUT" }) }, readWithTts: async () => audio("tts"), onFallback })
    await expect(voice({ text: TEXT })).resolves.toMatchObject({ model: "fallback:tts" })
    expect(onFallback).toHaveBeenCalledWith({ reason: "PROVIDER", fidelity: null, errorCode: "SPEECH_TIMEOUT" })
  })

  it("o cache aceita a voz da conversa e o plano B — nunca o TTS antigo, que é refeito", () => {
    expect(acceptedRecadoModels("live", "tts")).toEqual(["live", "fallback:tts"])
    expect(acceptedRecadoModels("live", "tts")).not.toContain("tts")
  })
})
