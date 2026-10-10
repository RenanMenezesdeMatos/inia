import { describe, expect, it, vi } from "vitest"
import { RECADO_START_TIMEOUT_MS, speakRecado, splitRecadoSpeech, type RecadoHandlers, type RecadoSpeechEnvironment } from "./recado-speech"

type FakeUtterance = SpeechSynthesisUtterance & { text: string }

function fakeEnv() {
  const utterances: FakeUtterance[] = []
  const timers: { callback: () => void; ms: number; cleared: boolean }[] = []
  const synth = { speak: vi.fn((utterance: FakeUtterance) => void utterances.push(utterance)), cancel: vi.fn(), getVoices: vi.fn(() => [{ lang: "pt-BR", name: "Luciana" } as SpeechSynthesisVoice]) }
  const env: RecadoSpeechEnvironment = {
    synth,
    createUtterance: (text) => ({ text }) as unknown as SpeechSynthesisUtterance,
    setTimeout: (callback, ms) => { const timer = { callback, ms, cleared: false }; timers.push(timer); return timer },
    clearTimeout: (handle) => { if (handle) (handle as { cleared: boolean }).cleared = true },
  }
  return { env, synth, utterances, timers }
}
const handlers = (): RecadoHandlers & { calls: string[] } => {
  const calls: string[] = []
  return { calls, onStarted: () => calls.push("started"), onCompleted: () => calls.push("completed"), onFailed: (reason) => calls.push(`failed:${reason}`), onInterrupted: () => calls.push("interrupted") }
}
const driver = () => {
  const speeches: { text: string; ended: boolean; cancelled: boolean }[] = []
  return { speeches, startFarewell: (text: string) => { const speech = { text, ended: false, cancelled: false }; speeches.push(speech); return { boundary: () => {}, end: () => { speech.ended = true }, cancel: () => { speech.cancelled = true } } } }
}

describe("fala do recado", () => {
  it("fala na HORA: todas as frases entram na fila de voz dentro da própria chamada (o clique), em pt-BR", () => {
    const { env, synth, utterances } = fakeEnv()
    const text = "Oi, Larissa. Tenho um retorno sobre o seu atendimento. " + "O ponto principal é informar o prazo da análise ao cliente, sempre que houver contestação de cobrança. ".repeat(3)
    speakRecado(text, driver(), handlers(), env)
    expect(synth.speak).toHaveBeenCalled()
    expect(utterances.map((utterance) => utterance.text).join(" ")).toBe(splitRecadoSpeech(text).join(" "))
    expect(utterances.every((utterance) => utterance.lang === "pt-BR" && utterance.voice?.name === "Luciana")).toBe(true)
    expect(utterances.every((utterance) => utterance.text.length <= 180)).toBe(true)
  })
  it("iniciou no primeiro onstart; entregue só no fim da ÚLTIMA frase; boca pelo driver do avatar", () => {
    const { env, utterances } = fakeEnv()
    const h = handlers()
    const avatar = driver()
    speakRecado("Primeira frase aqui. " + "Segunda frase bem mais longa para forçar outro pedaço da fala do recado. ".repeat(3), avatar, h, env)
    expect(utterances.length).toBeGreaterThan(1)
    utterances[0]!.onstart?.({} as SpeechSynthesisEvent)
    expect(h.calls).toEqual(["started"])
    utterances[0]!.onend?.({} as SpeechSynthesisEvent)
    expect(h.calls).toEqual(["started"])
    for (const utterance of utterances.slice(1)) {
      utterance.onstart?.({} as SpeechSynthesisEvent)
      utterance.onend?.({} as SpeechSynthesisEvent)
    }
    expect(h.calls).toEqual(["started", "completed"])
    expect(avatar.speeches.map((speech) => speech.ended)).toEqual(utterances.map(() => true))
  })
  it("erro de áudio = falha (nunca entrega); parar no meio = interrupção", () => {
    const failing = fakeEnv()
    const h1 = handlers()
    speakRecado("Uma frase. Outra frase.", driver(), h1, failing.env)
    failing.utterances[0]!.onstart?.({} as SpeechSynthesisEvent)
    failing.utterances[0]!.onerror?.({ error: "synthesis-failed" } as SpeechSynthesisErrorEvent)
    failing.utterances[1]?.onend?.({} as SpeechSynthesisEvent)
    expect(h1.calls).toEqual(["started", "failed:SPEECH_ERROR"])

    const stopping = fakeEnv()
    const h2 = handlers()
    const playback = speakRecado("Uma frase. Outra frase.", driver(), h2, stopping.env)!
    stopping.utterances[0]!.onstart?.({} as SpeechSynthesisEvent)
    playback.stop()
    stopping.utterances[0]!.onerror?.({ error: "interrupted" } as SpeechSynthesisErrorEvent)
    expect(h2.calls).toEqual(["started", "interrupted"])
    expect(stopping.synth.cancel).toHaveBeenCalled()
  })
  it("sem início dentro do prazo (áudio bloqueado) = falha explícita; sem voz no navegador = falha imediata", () => {
    const { env, timers } = fakeEnv()
    const h = handlers()
    speakRecado("Uma frase.", driver(), h, env)
    expect(timers[0]!.ms).toBe(RECADO_START_TIMEOUT_MS)
    timers[0]!.callback()
    expect(h.calls).toEqual(["failed:AUDIO_BLOCKED"])

    const none = handlers()
    expect(speakRecado("Uma frase.", driver(), none, null)).toBeNull()
    expect(none.calls).toEqual(["failed:SPEECH_UNAVAILABLE"])
  })
})
