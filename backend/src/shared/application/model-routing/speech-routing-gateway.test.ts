import { afterEach, describe, expect, it, vi } from "vitest"
import { registerAiRuntime, runWithAiOrganization, type AiRuntime, type PolicySpeechRequest, type SpeechCacheIdentity } from "./ai-runtime.js"
import { createRoutedSpeechSynthesizer, speechCacheIdentity } from "./llm-gateway.js"

/**
 * Voz do recado × policy da organização (zero rede): sem policy (ou sem runtime/organização), a composição de sempre recebe o
 * MESMO pedido e devolve o MESMO áudio, e o cache aceita as MESMAS identidades; com policy ACTIVE, o runtime lê o texto exato e o
 * legado nem é chamado.
 */
const ORG = "11111111-1111-4111-8111-111111111111"
const LEGACY_IDENTITY: SpeechCacheIdentity = { voice: "Kore", models: ["models/gemini-2.5-flash-native-audio-latest", "fallback:gemini-3.8-flash-lite-tts"] }
const legacyAudio = { pcm16: Buffer.from([1, 2, 3, 4]), sampleRate: 24_000, model: "models/gemini-2.5-flash-native-audio-latest", voice: "Kore" }

function fakeRuntime(policy: boolean) {
  const requests: PolicySpeechRequest[] = []
  const runtime: AiRuntime = {
    async executeWithPolicy() {
      return null
    },
    async streamWithPolicy() {
      return null
    },
    async assertLegacyCallAllowed() {},
    async recordUsage() {},
    async speechIdentityWithPolicy() {
      return policy ? { voice: "marin", models: ["gpt-4o-mini-tts#abc123abc123"] } : null
    },
    async synthesizeSpeechWithPolicy(request) {
      requests.push(request)
      if (!policy) return null
      return { pcm16: Buffer.from([9, 9]), sampleRate: 24_000, voice: "marin", model: "gpt-4o-mini-tts#abc123abc123", usage: { promptTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null, reasoningTokens: null }, resolvedRoute: { requestedUseCase: "SPEECH_SYNTHESIS", routingMode: "PINNED", providerKey: "OPENAI", connectionId: "c", connectionName: "OpenAI", modelId: "m", modelName: "gpt-4o-mini-tts", routeReason: "PINNED", fallbackAttempt: 0, fallbackReason: null, correlationId: request.correlationId } }
    },
  }
  return { runtime, requests }
}

describe("voz do recado pelo gateway: policy da organização × composição de sempre", () => {
  afterEach(() => registerAiRuntime(null))

  it("SEM runtime, SEM organização ou runtime sem voz: o legado recebe o mesmo pedido e o áudio volta intacto; o cache aceita as identidades de antes", async () => {
    const legacy = vi.fn(async () => legacyAudio)
    const routed = createRoutedSpeechSynthesizer(legacy)
    const request = { text: "Oi, Ana! Confirme a data de nascimento antes de enviar." }
    expect(await runWithAiOrganization(ORG, () => routed(request))).toBe(legacyAudio)
    expect(await runWithAiOrganization(ORG, () => speechCacheIdentity(LEGACY_IDENTITY))).toBe(LEGACY_IDENTITY)
    const { speechIdentityWithPolicy: _identity, synthesizeSpeechWithPolicy: _synthesize, ...withoutSpeech } = fakeRuntime(true).runtime
    void _identity
    void _synthesize
    registerAiRuntime(withoutSpeech)
    expect(await runWithAiOrganization(ORG, () => routed(request))).toBe(legacyAudio)
    registerAiRuntime(fakeRuntime(true).runtime)
    expect(await routed(request)).toBe(legacyAudio)
    expect(await speechCacheIdentity(LEGACY_IDENTITY)).toBe(LEGACY_IDENTITY)
    expect(legacy.mock.calls).toEqual([[request], [request], [request]])
  })

  it("SEM policy ativa: legado uma vez, a policy nem é tentada; identidades de antes", async () => {
    const fake = fakeRuntime(false)
    registerAiRuntime(fake.runtime)
    const legacy = vi.fn(async () => legacyAudio)
    const audio = await runWithAiOrganization(ORG, () => createRoutedSpeechSynthesizer(legacy)({ text: "Recado." }))
    expect(audio).toBe(legacyAudio)
    expect(legacy).toHaveBeenCalledTimes(1)
    expect(fake.requests).toHaveLength(0)
    expect(await runWithAiOrganization(ORG, () => speechCacheIdentity(LEGACY_IDENTITY))).toBe(LEGACY_IDENTITY)
  })

  it("COM policy: o runtime lê o texto exato (Use Case SPEECH_SYNTHESIS, organização da sessão); o legado nem é chamado; o cache passa a aceitar só a voz/modelo da policy", async () => {
    const fake = fakeRuntime(true)
    registerAiRuntime(fake.runtime)
    const legacy = vi.fn(async () => legacyAudio)
    const text = "Oi, Ana! Confirme a data de nascimento antes de enviar."
    const audio = await runWithAiOrganization(ORG, () => createRoutedSpeechSynthesizer(legacy)({ text }))
    expect(audio).toEqual({ pcm16: Buffer.from([9, 9]), sampleRate: 24_000, model: "gpt-4o-mini-tts#abc123abc123", voice: "marin" })
    expect(legacy).not.toHaveBeenCalled()
    expect(fake.requests).toEqual([expect.objectContaining({ organizationId: ORG, useCase: "SPEECH_SYNTHESIS", text, classification: expect.objectContaining({ purpose: "SPEECH_SYNTHESIS", source: "VOICE" }) })])
    expect(await runWithAiOrganization(ORG, () => speechCacheIdentity(LEGACY_IDENTITY))).toEqual({ voice: "marin", models: ["gpt-4o-mini-tts#abc123abc123"] })
  })
})
