import { describe, expect, it } from "vitest"

import { NO_VOICE_ACTIVITY, THINKING_LABEL, VOICE_CONSULTING_LABEL, VOICE_PREPARING_LABEL, nextVoiceActivity, voiceActivityLabel, type VoiceActivity, type VoiceActivityEvent } from "./voice-activity"

const run = (...events: VoiceActivityEvent[]): VoiceActivity => events.reduce(nextVoiceActivity, NO_VOICE_ACTIVITY)
const label = (activity: VoiceActivity, state: Parameters<typeof voiceActivityLabel>[1] = "thinking", fallback = true) => voiceActivityLabel(activity, state, { fallback })

describe("indicador da resposta pela voz, só com eventos reais", () => {
  it("segue a pergunta enviada, a consulta e o fim da consulta", () => {
    const sent = run({ type: "TURN_SENT" })
    expect(label(sent, "idle")).toBe(THINKING_LABEL)
    const consulting = nextVoiceActivity(sent, { type: "TOOL_STARTED" })
    expect(label(consulting)).toBe(VOICE_CONSULTING_LABEL)
    expect(label(nextVoiceActivity(consulting, { type: "TOOL_FINISHED" }))).toBe(VOICE_PREPARING_LABEL)
  })

  it("o ocioso da conexão não encerra a pergunta digitada; depois de pensar, encerra", () => {
    const connecting = run({ type: "TURN_SENT" }, { type: "STATE", state: "idle" })
    expect(label(connecting, "idle")).toBe(THINKING_LABEL)
    const started = run({ type: "TURN_SENT" }, { type: "STATE", state: "thinking" }, { type: "STATE", state: "idle" })
    expect(label(started, "idle")).toBeNull()
  })

  it("a fala encerra o indicador; com consulta em andamento, ele volta quando a fala para", () => {
    expect(label(run({ type: "TURN_SENT" }, { type: "STATE", state: "speaking" }), "speaking")).toBeNull()
    const talkingOverTool = run({ type: "TOOL_STARTED" }, { type: "STATE", state: "speaking" })
    expect(label(talkingOverTool, "speaking")).toBeNull()
    expect(label(nextVoiceActivity(talkingOverTool, { type: "STATE", state: "thinking" }))).toBe(VOICE_CONSULTING_LABEL)
  })

  it("resposta da consulta já na conversa: o indicador acaba, mesmo com a fala por começar", () => {
    const shown = run({ type: "TOOL_STARTED" }, { type: "ANSWER_SHOWN" }, { type: "TOOL_FINISHED" })
    expect(label(shown)).toBeNull()
    expect(label(nextVoiceActivity(shown, { type: "STATE", state: "thinking" }))).toBeNull()
    expect(label(nextVoiceActivity(shown, { type: "TOOL_STARTED" }))).toBe(VOICE_CONSULTING_LABEL)
  })

  it("duas consultas juntas: só prepara a resposta quando as duas terminam", () => {
    const one = run({ type: "TOOL_STARTED" }, { type: "TOOL_STARTED" }, { type: "TOOL_FINISHED" })
    expect(label(one)).toBe(VOICE_CONSULTING_LABEL)
    expect(label(nextVoiceActivity(one, { type: "TOOL_FINISHED" }))).toBe(VOICE_PREPARING_LABEL)
  })

  it("microfone aberto, fim do turno e troca de conversa encerram", () => {
    const active = run({ type: "TOOL_STARTED" })
    expect(nextVoiceActivity(active, { type: "STATE", state: "listening" })).toEqual(NO_VOICE_ACTIVITY)
    expect(nextVoiceActivity(active, { type: "STATE", state: "idle" })).toEqual(NO_VOICE_ACTIVITY)
    expect(nextVoiceActivity(active, { type: "RESET" })).toEqual(NO_VOICE_ACTIVITY)
  })

  it("pensando sem evento específico: o genérico honesto; na sessão de feedback, o balão dela já mostra", () => {
    expect(label(NO_VOICE_ACTIVITY)).toBe(THINKING_LABEL)
    expect(label(NO_VOICE_ACTIVITY, "thinking", false)).toBeNull()
    expect(label(run({ type: "TOOL_STARTED" }), "thinking", false)).toBe(VOICE_CONSULTING_LABEL)
    expect(label(NO_VOICE_ACTIVITY, "idle")).toBeNull()
  })
})
