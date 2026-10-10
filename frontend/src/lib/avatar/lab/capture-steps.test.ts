import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { FIXTURE_DIR } from "@/lib/avatar/lipsync/__fixtures__/load-fixture"
import { buildCaptureSteps, bytesToBase64, shiftToFastStart, sliceAudioChunks, wavDataBytes, type CaptureFixtureJson, type CaptureStep } from "./capture-steps"
import { LAB_FIXTURES, labFixtureUrl, parseLabFixtureFile } from "./fixture-catalog"

function readFixture(id: string) {
  const json = JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${id}.json`), "utf8")) as CaptureFixtureJson
  const file = readFileSync(path.join(FIXTURE_DIR, `${id}.wav`))
  return { json, wav: new Uint8Array(file.buffer, file.byteOffset, file.byteLength) }
}

/** WAV mínimo (PCM16 mono 24 kHz) com um bloco extra antes do `data`, como alguns gravadores fazem. */
function makeWav(samples: number[], extraChunk = true): Uint8Array {
  const data = new Uint8Array(samples.length * 2)
  const dataView = new DataView(data.buffer)
  samples.forEach((sample, i) => dataView.setInt16(i * 2, sample, true))
  const parts: number[] = []
  const ascii = (text: string) => [...text].forEach((char) => parts.push(char.charCodeAt(0)))
  const u32 = (value: number) => parts.push(value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >>> 24) & 255)
  ascii("RIFF")
  u32(0)
  ascii("WAVE")
  if (extraChunk) {
    ascii("LIST")
    u32(3)
    parts.push(1, 2, 3, 0) // tamanho ímpar + byte de preenchimento
  }
  ascii("data")
  u32(data.length)
  parts.push(...data)
  return new Uint8Array(parts)
}

describe("wavDataBytes", () => {
  it("acha o bloco data mesmo depois de blocos extras (tamanho ímpar com preenchimento)", () => {
    const pcm = wavDataBytes(makeWav([1, -1, 32767]))
    expect([...pcm]).toEqual([1, 0, 255, 255, 255, 127])
  })

  it("recusa o que não é WAV e o WAV truncado", () => {
    expect(() => wavDataBytes(new Uint8Array(20))).toThrow(/RIFF/)
    const truncated = makeWav([1, 2, 3], false).subarray(0, 24)
    expect(() => wavDataBytes(truncated)).toThrow(/truncado/)
  })
})

describe("sliceAudioChunks", () => {
  const pcm = new Uint8Array([1, 2, 3, 4, 5, 6])
  it("corta na ordem dos eventos de áudio, ignorando os outros", () => {
    const chunks = sliceAudioChunks([{ t: 0, transcript: "x" }, { t: 1, audioBytes: 4, mime: "audio/pcm" }, { t: 2, audioBytes: 2, mime: "audio/pcm" }], pcm)
    expect(chunks.map((chunk) => [...chunk])).toEqual([[1, 2, 3, 4], [5, 6]])
  })

  it("falha com áudio sobrando, faltando ou chunk ímpar", () => {
    expect(() => sliceAudioChunks([{ t: 0, audioBytes: 4, mime: "audio/pcm" }], pcm)).toThrow(/sem chunk/)
    expect(() => sliceAudioChunks([{ t: 0, audioBytes: 8, mime: "audio/pcm" }], pcm)).toThrow(/faltam/)
    expect(() => sliceAudioChunks([{ t: 0, audioBytes: 3, mime: "audio/pcm" }], pcm)).toThrow(/ímpar/)
  })
})

describe("buildCaptureSteps com as capturas reais", () => {
  it.each(LAB_FIXTURES.map((fixture) => fixture.id))("%s: o áudio de todos os chunks soma o WAV inteiro", (id) => {
    const { json, wav } = readFixture(id)
    const pcm = wavDataBytes(wav)
    const steps = buildCaptureSteps(json, pcm)
    expect(steps).toHaveLength(json.events.length)
    const audioSteps = steps.filter((step) => step.kind === "audio")
    expect(audioSteps.reduce((sum, step) => sum + (step.samples ?? 0), 0) * 2).toBe(pcm.length)
    expect(steps.at(-1)?.kind).toBe("turnComplete")
    // Mensagens com as formas exatas do Live.
    const first = audioSteps[0].message.serverContent?.modelTurn?.parts?.[0]?.inlineData
    expect(first?.mimeType).toMatch(/^audio\/pcm/)
    const decoded = Uint8Array.from(atob(first?.data ?? ""), (char) => char.charCodeAt(0))
    expect([...decoded.subarray(0, 16)]).toEqual([...pcm.subarray(0, 16)])
  })

  it("bytesToBase64 é o mesmo base64 do Node para blocos grandes", () => {
    const bytes = new Uint8Array(70000).map((_, i) => (i * 31) % 256)
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"))
  })
})

describe("shiftToFastStart", () => {
  const steps: CaptureStep[] = [
    { t: 1100, kind: "transcript", message: {} },
    { t: 1200, kind: "audio", samples: 1, message: {} },
    { t: 1700, kind: "turnComplete", message: {} },
  ]
  it("primeiro áudio em ~150 ms, cadência relativa intacta e nada antes de 0", () => {
    expect(shiftToFastStart(steps).map((step) => step.t)).toEqual([50, 150, 650])
    expect(shiftToFastStart(steps, 50).map((step) => step.t)).toEqual([0, 50, 550])
  })
  it("sem áudio: devolve uma cópia sem mudar", () => {
    const noAudio = steps.filter((step) => step.kind !== "audio")
    expect(shiftToFastStart(noAudio)).toEqual(noAudio)
  })
})

describe("lista branca da rota de fixtures", () => {
  it("aceita só <id>.json e <id>.wav do catálogo", () => {
    expect(parseLabFixtureFile("frase-01-apresentacao.wav")).toEqual({ id: "frase-01-apresentacao", kind: "wav" })
    expect(parseLabFixtureFile("resposta-longa.json")).toEqual({ id: "resposta-longa", kind: "json" })
    for (const bad of ["README.md", "../load-fixture.ts", "frase-01-apresentacao.WAV", "frase-01-apresentacao.wav/", "%2e%2e.json", "frase-99.json", "x/frase-01-apresentacao.json", ""]) {
      expect(parseLabFixtureFile(bad)).toBeNull()
    }
  })

  it("monta a URL da rota do laboratório", () => {
    expect(labFixtureUrl("frase-02-proposta", "json")).toBe("/dev/avatar-lab/fixtures/frase-02-proposta.json")
  })
})
