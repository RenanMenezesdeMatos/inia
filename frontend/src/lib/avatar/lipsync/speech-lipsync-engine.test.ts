import os from "node:os"
import v8 from "node:v8"
import vm from "node:vm"

import { afterEach, describe, expect, it } from "vitest"

import { compareWithReference, measureFixture } from "./__fixtures__/fixture-metrics"
import {
  buildReplaySchedule,
  createTestPhonemizer,
  listFixtureIds,
  loadFixture,
  loadReferenceWords,
  replayIntoEngine,
  replaySteps,
  type ReplaySchedule,
} from "./__fixtures__/load-fixture"
import { PHONES, isBilabial } from "./phones"
import { phonemizeText } from "./pt-br/g2p"
import { createSpeechLipsyncEngine, type SpeechLipsyncEngineOptions } from "./speech-lipsync-engine"
import type { AlignedPhone, AudioFeatureFrame, SpeechLipsyncEngine } from "./types"
import { createSpeechFrame } from "./types"

/**
 * Motor de lip-sync contra as capturas REAIS do Gemini Live (2026-09-24): chunks e fragmentos
 * entregues na ordem e no instante em que chegaram, com o agendamento colado do transporte.
 * Roda com o G2P de teste (letras) e, quando o G2P de verdade responde, também com ele.
 */

// Os blocos de replay das capturas são CPU síncrona de segundos por teste. Encadeados só por microtarefas, sob carga o worker
// passava de 60 s sem voltar ao event loop e não lia a resposta do processo principal ("[vitest-worker]: Timeout calling
// onTaskUpdate", prazo fixo do Vitest). Uma volta ao event loop entre esses testes resolve. Fica fora do bloco de turnos, onde
// estão as medidas de custo e de alocação (dependem do ritmo do JIT e do lugar delas no arquivo).
const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const ALL_FIXTURES = listFixtureIds()
// Capturas em que a transcrição do Live veio incompleta (2026-10-07): teste próprio, abaixo.
const INCOMPLETE_TEXT_FIXTURES = ALL_FIXTURES.filter((id) => id.endsWith("-texto-incompleto"))
const FIXTURES = ALL_FIXTURES.filter((id) => !INCOMPLETE_TEXT_FIXTURES.includes(id))
const realG2PAvailable = phonemizeText("olá").length > 0
// As métricas nas capturas usam o G2P PT-BR de verdade (o G2P de letras do teste só existia
// enquanto o real não estava pronto; continua nos testes de turno/streaming abaixo).
const PHONEMIZERS: Array<[string, SpeechLipsyncEngineOptions]> = realG2PAvailable
  ? [["G2P PT-BR", {}]]
  : [["G2P de teste", { phonemizerFactory: createTestPhonemizer }]]

const schedules = new Map<string, ReplaySchedule>()
function scheduleOf(id: string, clockOffset = 12.5): ReplaySchedule {
  const key = `${id}@${clockOffset}`
  let schedule = schedules.get(key)
  if (!schedule) {
    schedule = buildReplaySchedule(loadFixture(id), { clockOffset })
    schedules.set(key, schedule)
  }
  return schedule
}

function run(id: string, options: SpeechLipsyncEngineOptions): { engine: SpeechLipsyncEngine; schedule: ReplaySchedule } {
  const schedule = scheduleOf(id)
  const engine = createSpeechLipsyncEngine(options)
  replayIntoEngine(engine, schedule)
  return { engine, schedule }
}

function frameAt(frames: AudioFeatureFrame[], t: number): AudioFeatureFrame {
  let lo = 0
  let hi = frames.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (frames[mid].time < t) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(frames[lo - 1].time - t) < Math.abs(frames[lo].time - t)) lo--
  return frames[lo]
}

/** Nível de fala (percentil 85 da energia dos quadros com som), calculado à parte do motor. */
function speechLevel(frames: AudioFeatureFrame[]): number {
  const energies = frames.map((f) => f.energyDb).filter((db) => db > -70).sort((a, b) => a - b)
  return energies[Math.floor(energies.length * 0.85)]
}

const isNucleusVowel = (phone: AlignedPhone) => phone.nucleus && PHONES[phone.phone].class === "vowel"
const center = (phone: AlignedPhone) => (phone.start + phone.end) / 2

describe.each(PHONEMIZERS)("motor de lip-sync nas capturas reais (%s)", (_label, options) => {
  afterEach(yieldToEventLoop)
  it.each(FIXTURES)("%s: /p/ e /b/ caem nos vales de energia (≥ 80%%) e todo P/B/M fecha os lábios", (id) => {
    const { engine } = run(id, options)
    const { phones, frames } = engine.debugSnapshot()
    const nuclei = phones.filter((p) => isNucleusVowel(p) && p.source === "aligned")
    const bilabials = phones.filter((p) => isBilabial(p.phone) && p.source === "aligned")
    expect(bilabials.length).toBeGreaterThan(0)
    // Oclusivas: o fechamento é silêncio de verdade no áudio. /m/ é nasal e vozeado — a energia quase
    // não cai (medido nas capturas: 0–3 dB), então para ele o critério é só o visual abaixo.
    const plosives = bilabials.filter((p) => p.phone !== "m")
    let ok = 0
    for (const phone of plosives) {
      const c = center(phone)
      const before = [...nuclei].reverse().find((n) => center(n) < c)
      const after = nuclei.find((n) => center(n) > c)
      const neighbors = [before, after].filter((n): n is AlignedPhone => n !== undefined).map((n) => frameAt(frames, center(n)).energyDb)
      const reference = neighbors.reduce((a, b) => a + b, 0) / neighbors.length
      const energy = Math.min(frameAt(frames, c - 0.01).energyDb, frameAt(frames, c).energyDb, frameAt(frames, c + 0.01).energyDb)
      if (energy <= reference - 6) ok++
    }
    if (plosives.length > 0) expect(ok / plosives.length).toBeGreaterThanOrEqual(0.8)
    // Visual: em todo P/B/M os lábios selam (lipClose ≥ 0,85) em algum instante do miolo do fone.
    const frame = createSpeechFrame()
    for (const phone of bilabials) {
      let best = 0
      for (let dt = -0.03; dt <= 0.03; dt += 0.005) {
        engine.sample(center(phone) + dt, frame)
        best = Math.max(best, frame.mouth.lipClose)
      }
      expect(best).toBeGreaterThanOrEqual(0.85)
    }
  })

  it.each(FIXTURES)("%s: núcleos vocálicos em quadros vozeados e fortes (≥ 85%%)", (id) => {
    const { engine } = run(id, options)
    const { phones, frames } = engine.debugSnapshot()
    const level = speechLevel(frames)
    const nuclei = phones.filter((p) => isNucleusVowel(p) && p.source === "aligned")
    expect(nuclei.length).toBeGreaterThan(10)
    const ok = nuclei.filter((phone) => {
      const frame = frameAt(frames, center(phone))
      return frame.voicing >= 0.5 && frame.energyDb >= level - 20
    }).length
    expect(ok / nuclei.length).toBeGreaterThanOrEqual(0.85)
  })

  it.each(FIXTURES)("%s: alinhamento monotônico, texto inteiro e sem deriva até o fim", (id) => {
    const { engine, schedule } = run(id, options)
    const snapshot = engine.debugSnapshot()
    const phones = snapshot.phones
    for (let k = 0; k < phones.length; k++) {
      expect(phones[k].end).toBeGreaterThanOrEqual(phones[k].start)
      if (k > 0) expect(phones[k].start).toBeGreaterThanOrEqual(phones[k - 1].end - 1e-6)
    }
    const words = phones.filter((p) => p.wordIndex >= 0).map((p) => p.wordIndex)
    for (let k = 1; k < words.length; k++) expect(words[k]).toBeGreaterThanOrEqual(words[k - 1])
    expect(snapshot.pendingWords).toBe(0)
    expect(phones.every((p) => p.source === "aligned")).toBe(true)
    const lastWord = Math.max(...words)
    const lastWordEnd = Math.max(...phones.filter((p) => p.wordIndex === lastWord).map((p) => p.end))
    expect(Math.abs(lastWordEnd - schedule.speechEnd)).toBeLessThanOrEqual(0.3)
    // O silêncio depois da fala varia com a voz (Kore: ~0,3 s) — só não pode passar do fim do áudio.
    expect(lastWordEnd).toBeLessThanOrEqual(schedule.audioEnd + 0.01)
  })

  it.each(FIXTURES)("%s: boca em repouso depois da fala e nas pausas longas", (id) => {
    const { engine, schedule } = run(id, options)
    const frame = createSpeechFrame()
    for (let t = schedule.speechEnd + 0.15; t <= schedule.audioEnd + 0.5; t += 0.01) {
      engine.sample(t, frame)
      expect(frame.mouth.jaw).toBeLessThan(0.05)
      expect(frame.mouth.lipClose).toBeLessThan(0.05)
      expect(frame.speaking).toBe(false)
    }
    const pauses = engine.debugSnapshot().phones.filter((p) => p.phone === "_" && p.end - p.start >= 0.35)
    for (const pause of pauses) {
      for (let t = pause.start + 0.15; t <= pause.end - 0.15; t += 0.01) {
        engine.sample(t, frame)
        // A antecipação da próxima frase pode deixar a mandíbula a ~6–9% perto do fim da pausa (a
        // boca se prepara para falar) — o que importa é não "mastigar" no silêncio.
        expect(frame.mouth.jaw).toBeLessThan(0.1)
        expect(frame.mouth.lipClose).toBeLessThan(0.08)
      }
    }
  })
})

/** Aquece o JIT com uma frase curta antes das medições (o primeiro replay paga compilação). */
function warmUpEngine(): void {
  replayIntoEngine(createSpeechLipsyncEngine({}), scheduleOf("frase-02-proposta"))
}
/**
 * Transcrição incompleta (capturas Kore de 2026-10-07: o Live parou a transcrição no meio — "Amanhã,
 * às" numa fala de 4,6 s — ou pulou um trecho do meio). A fala sem texto vira só-áudio: a boca nunca
 * fica parada com a fala tocando (antes: 1–2,5 s de boca fechada) e descansa depois da fala.
 * Limitação conhecida: com um trecho faltando NO MEIO, as palavras depois do buraco ficam adiantadas.
 */
describe.runIf(realG2PAvailable)("motor de lip-sync com a transcrição incompleta (G2P PT-BR)", () => {
  afterEach(yieldToEventLoop)
  it.each(INCOMPLETE_TEXT_FIXTURES)("%s: a boca acompanha a fala sem texto e descansa depois dela", (id) => {
    const { engine, schedule } = run(id, {})
    const { phones, frames } = engine.debugSnapshot()
    for (let k = 1; k < phones.length; k++) expect(phones[k].start).toBeGreaterThanOrEqual(phones[k - 1].end - 1e-6)
    const level = speechLevel(frames)
    const frame = createSpeechFrame()
    let checked = 0
    const still: string[] = []
    for (let t = schedule.speechStart; t + 0.2 <= schedule.speechEnd - 0.1; t += 0.2) {
      const loud = frames.some((f) => f.time >= t && f.time < t + 0.2 && f.energyDb >= level - 12)
      if (!loud) continue
      let jaw = 0
      let speaking = false
      for (let u = t; u < t + 0.2; u += 0.01) {
        engine.sample(u, frame)
        jaw = Math.max(jaw, frame.mouth.jaw)
        speaking = speaking || frame.speaking
      }
      if (jaw < 0.15 || !speaking) still.push(`${(t - schedule.audioStart).toFixed(2)} s`)
      checked++
    }
    expect(checked).toBeGreaterThan(10)
    // Trechos de 200 ms com fala e boca parada: no máximo 2 (o buraco no MEIO da transcrição deixa a
    // pausa final do texto sobre a fala que veio depois — ~0,4 s na kore-frase-03; antes, 2,5 s).
    expect(still.length, `${id}: ${still.join(", ")}`).toBeLessThanOrEqual(2)
    for (let t = schedule.speechEnd + 0.15; t <= schedule.audioEnd + 0.5; t += 0.01) {
      engine.sample(t, frame)
      expect(frame.mouth.jaw).toBeLessThan(0.05)
      expect(frame.speaking).toBe(false)
    }
  })
})

/**
 * Texto atrasado e em rajadas (regressão de 2026-10-07). Antes: com o texto 0,5 s atrasado a resposta
 * longa derivava até 4 s (o enchimento caro fazia o melhor caminho ESTICAR o texto conhecido e a pausa
 * antes das palavras provisórias era consolidada); com 1–1,5 s a retomada encaixava palavras já ditas
 * no áudio novo.
 *
 * Régua: o alinhamento de REFERÊNCIA independente (Whisper, `reference/whisper-words.json`), início de
 * cada palavra. Medido em 2026-10-08 nas 14 capturas com texto completo (467 palavras): erro mediano
 * 57 ms com o texto em dia e 57–63 ms com o texto 0,25–1,5 s atrasado ou com jitter; 93,5–97% das
 * palavras a ≤ 300 ms. Tolerância: agregado com mediana ≤ 70 ms e ≥ 92% a ≤ 300 ms; por captura,
 * mediana ≤ 400 ms (pega deriva grossa). Quem toca antes de o texto chegar vira só-áudio.
 *
 * Invariante do que já foi ouvido: nada que começou a tocar muda de identidade, palavra ou início; o
 * FIM só pode ser revisto no último fone do texto conhecido, até 0,35 s depois de ouvido (o trecho
 * depois dele é desenhado pela boca "ao vivo" do áudio — ver `aligner.ts › TEXT_END_GRACE_SECONDS`).
 */
describe.runIf(realG2PAvailable)("motor de lip-sync com o texto atrasado (G2P PT-BR)", () => {
  afterEach(yieldToEventLoop)
  const SCENARIOS: Array<{ label: string; delay: number; jitter: number; seed: number }> = [
    { label: "0,25 s", delay: 0.25, jitter: 0, seed: 1 },
    { label: "0,5 s", delay: 0.5, jitter: 0, seed: 1 },
    { label: "1 s", delay: 1, jitter: 0, seed: 1 },
    { label: "1,5 s", delay: 1.5, jitter: 0, seed: 1 },
    { label: "jitter 0–0,5 s", delay: 0, jitter: 0.5, seed: 3 },
    { label: "0,5 s + jitter 0–0,5 s", delay: 0.5, jitter: 0.5, seed: 4 },
  ]
  /**
   * Limitação conhecida: "feedback" na voz Kore ("fídbék", "f" sonoro) com o texto chegando DEPOIS de
   * o áudio já tocar (≥ 1 s): a retomada encaixa a frase uma palavra adiante (~1,1 s).
   */
  const KNOWN_LATE_TEXT = new Set(["kore-frase-05-labiais"])
  const GRACE_SECONDS = 0.35
  const reference = loadReferenceWords()

  // Cada cenário reproduz as 14 capturas (~3–5 s de CPU).
  it.each(SCENARIOS)("$label: palavras no lugar da referência, sem reescrever o ouvido", { timeout: 60_000 }, ({ delay, jitter, seed }) => {
    const errors: number[] = []
    let bilabials = 0
    let bilabialsOnDip = 0
    let fricatives = 0
    let fricativesOnHigh = 0
    for (const id of FIXTURES) {
      const schedule = scheduleOf(id)
      const heard: Array<{ at: number; phones: AlignedPhone[] }> = []
      // ~100 instantâneos por captura (a resposta longa tem ~1.500 passos).
      const every = Math.max(1, Math.round(schedule.steps.length / 100))
      let steps = 0
      const { metrics, engine } = measureFixture(schedule, {
        replay: {
          transcriptDelay: delay,
          transcriptJitter: jitter,
          jitterSeed: seed,
          onStep: (step, live) => {
            if (++steps % every === 0) heard.push({ at: step.at, phones: live.debugSnapshot({ frames: false }).phones.filter((p) => p.start <= step.at) })
          },
        },
      })
      const phones = engine.debugSnapshot({ frames: false }).phones
      for (let k = 1; k < phones.length; k++) expect(phones[k].start).toBeGreaterThanOrEqual(phones[k - 1].end - 1e-6)
      for (const entry of heard) {
        entry.phones.forEach((phone, index) => {
          const now = phones[index]
          expect({ phone: now.phone, start: now.start, wordIndex: now.wordIndex, source: now.source }).toEqual({ phone: phone.phone, start: phone.start, wordIndex: phone.wordIndex, source: phone.source })
          if (phone.end <= entry.at - GRACE_SECONDS) expect(now.end).toBe(phone.end)
        })
      }

      const words = compareWithReference(schedule, phones, reference[id])
      const lateText = delay + jitter >= 1 && KNOWN_LATE_TEXT.has(id)
      if (!lateText) {
        expect(words.medianAbsMs, `${id}: ${JSON.stringify(words.worst)}`).toBeLessThanOrEqual(400)
        errors.push(...words.absErrorsMs)
      }
      // Resposta longa: o áudio chega até 39 s antes de tocar, então o texto até 0,5 s atrasado ainda
      // chega antes de ser ouvido — nada de só-áudio. (Nas frases curtas não vale: números e moeda
      // esperam a palavra seguinte no G2P, e o primeiro chunk só dá ~0,9 s de folga.)
      if (id.endsWith("resposta-longa") && delay + jitter <= 0.5) expect(metrics.audioOnlyPhones, id).toBe(0)
      expect(metrics.vowels.ratio, id).toBeGreaterThanOrEqual(0.85)
      expect(Math.abs(metrics.lastWordEndError), id).toBeLessThanOrEqual(0.3)
      bilabials += metrics.bilabials.total
      bilabialsOnDip += metrics.bilabials.onDip
      fricatives += metrics.fricatives.total
      fricativesOnHigh += metrics.fricatives.onHighBand
    }
    errors.sort((x, y) => x - y)
    expect(errors[Math.floor(errors.length / 2)]).toBeLessThanOrEqual(70)
    expect(errors.filter((e) => e <= 300).length / errors.length).toBeGreaterThanOrEqual(0.92)
    expect(bilabialsOnDip / bilabials).toBeGreaterThanOrEqual(0.9)
    expect(fricativesOnHigh / fricatives).toBeGreaterThanOrEqual(0.9)
  })
})

describe("motor de lip-sync: turnos, interrupção e streaming", () => {
  const options: SpeechLipsyncEngineOptions = { phonemizerFactory: createTestPhonemizer }

  it("interrupção: corta em atTime e volta ao repouso em ≤ 150 ms; pacotes antigos são ignorados", () => {
    const schedule = scheduleOf("frase-03-escolha")
    const engine = createSpeechLipsyncEngine(options)
    const stopAt = schedule.speechStart + 1.7
    replayIntoEngine(engine, schedule, { endOfText: false })
    engine.interrupt(stopAt)
    const frame = createSpeechFrame()
    for (let t = stopAt + 0.15; t < schedule.audioEnd + 0.3; t += 0.01) {
      engine.sample(t, frame)
      expect(frame.mouth.jaw).toBeLessThan(0.05)
      expect(frame.mouth.lipClose).toBeLessThan(0.05)
      expect(frame.speaking).toBe(false)
    }
    const phones = engine.debugSnapshot().phones
    expect(phones.every((p) => p.end <= stopAt + 1e-9)).toBe(true)
    // A geração antiga ainda entrega áudio/texto depois do `interrupted`: nada disso entra.
    for (const step of schedule.steps) {
      if (step.kind === "audio") engine.pushAudio(step.chunk)
      if (step.kind === "transcript") engine.pushTranscript(step.fragment)
    }
    engine.endOfText(1)
    expect(engine.debugSnapshot().phones).toEqual(phones)
    engine.sample(stopAt + 0.5, frame)
    expect(frame.mouth.jaw).toBeLessThan(0.05)
  })

  it("nada de um turno vaza para o seguinte", () => {
    const first = scheduleOf("frase-05-labiais", 10)
    const second = scheduleOf("frase-01-apresentacao", 20)
    const engine = createSpeechLipsyncEngine(options)
    replayIntoEngine(engine, first)
    expect(engine.debugSnapshot().phones.length).toBeGreaterThan(10)
    engine.beginTurn(2)
    const frame = createSpeechFrame()
    // Logo depois do beginTurn, o turno anterior sumiu: repouso mesmo no meio da fala antiga.
    for (let t = first.speechStart; t < first.speechEnd; t += 0.02) {
      engine.sample(t, frame)
      expect(frame.mouth).toEqual(createSpeechFrame().mouth)
      expect(frame.speaking).toBe(false)
    }
    expect(engine.debugSnapshot().phones).toEqual([])
    // Pacotes atrasados do turno 1 são ignorados.
    for (const step of first.steps) {
      if (step.kind === "audio") engine.pushAudio(step.chunk)
      if (step.kind === "transcript") engine.pushTranscript(step.fragment)
    }
    expect(engine.debugSnapshot().phones).toEqual([])
    for (const step of second.steps) {
      if (step.kind === "audio") engine.pushAudio({ ...step.chunk, turnId: 2 })
      if (step.kind === "transcript") engine.pushTranscript({ ...step.fragment, turnId: 2 })
    }
    engine.endOfText(2)
    const phones = engine.debugSnapshot().phones
    expect(phones.length).toBeGreaterThan(10)
    expect(phones.every((p) => p.start >= second.audioStart - 0.15 && p.end <= second.audioEnd + 0.05)).toBe(true)
    expect(engine.debugSnapshot().turnId).toBe(2)
    // Palavras do turno 2 recomeçam do zero (G2P reiniciado).
    expect(Math.min(...phones.filter((p) => p.wordIndex >= 0).map((p) => p.wordIndex))).toBe(0)
  })

  it("streaming: o que já foi ouvido nunca é reescrito", () => {
    const schedule = scheduleOf("resposta-longa")
    const engine = createSpeechLipsyncEngine(options)
    const heardSnapshots: Array<{ heard: number; phones: AlignedPhone[] }> = []
    let steps = 0
    replayIntoEngine(engine, schedule, {
      onStep: (step) => {
        if (++steps % 25 !== 0) return
        const heard = step.at
        heardSnapshots.push({ heard, phones: engine.debugSnapshot().phones.filter((p) => p.end <= heard) })
      },
    })
    const final = engine.debugSnapshot().phones
    let checked = 0
    for (const snapshot of heardSnapshots) {
      snapshot.phones.forEach((phone, index) => {
        expect(final[index]).toEqual(phone)
        checked++
      })
    }
    expect(checked).toBeGreaterThan(100)
  })

  it("texto atrasado: fones só-áudio no começo, depois recupera o alinhamento até o fim", () => {
    const schedule = scheduleOf("frase-04-amanha")
    const firstTranscript = schedule.steps.find((step) => step.kind === "transcript")!.at
    const textArrives = schedule.audioStart + 1.5
    const engine = createSpeechLipsyncEngine(options)
    const heard: Array<{ at: number; phones: AlignedPhone[] }> = []
    replayIntoEngine(engine, schedule, {
      transcriptDelay: textArrives - firstTranscript,
      onStep: (step) => heard.push({ at: step.at, phones: engine.debugSnapshot().phones.filter((p) => p.end <= step.at) }),
    })
    const snapshot = engine.debugSnapshot()
    const phones = snapshot.phones
    const audioOnly = phones.filter((p) => p.source === "audio-only" && p.phone !== "_")
    const aligned = phones.filter((p) => p.source === "aligned" && p.phone !== "_")
    expect(audioOnly.length).toBeGreaterThan(2)
    expect(Math.min(...audioOnly.map((p) => p.start))).toBeLessThan(schedule.speechStart + 0.3)
    // Todos os fragmentos chegam atrasados do mesmo tanto: o texto só alcança o áudio quando os
    // últimos fragmentos (em rajada) chegam — até lá a boca segue só pelo áudio.
    const lastFragment = Math.max(...replaySteps(schedule, { transcriptDelay: textArrives - firstTranscript }).filter((step) => step.kind === "transcript").map((step) => step.at))
    expect(Math.max(...audioOnly.map((p) => p.end))).toBeLessThanOrEqual(lastFragment + 0.6)
    // Recuperação: o resto é texto alinhado, até o fim da fala, sem sobreposição.
    expect(aligned.length).toBeGreaterThan(10)
    // Depois que o último fragmento chega (+ folga), tudo é texto alinhado.
    expect(phones.filter((p) => p.start >= lastFragment + 0.6 && p.phone !== "_").every((p) => p.source === "aligned")).toBe(true)
    for (let k = 1; k < phones.length; k++) expect(phones[k].start).toBeGreaterThanOrEqual(phones[k - 1].end - 1e-6)
    const lastEnd = Math.max(...aligned.map((p) => p.end))
    expect(Math.abs(lastEnd - schedule.speechEnd)).toBeLessThanOrEqual(0.3)
    // Com o texto atrasado o tempo todo, a última palavra pode chegar depois de o seu áudio já ter
    // tocado (só-áudio): ela é descartada, nunca "fala atrasada".
    expect(snapshot.pendingWords).toBeLessThanOrEqual(1)
    // O ouvido nunca foi reescrito.
    for (const entry of heard) entry.phones.forEach((phone, index) => expect(phones[index]).toEqual(phone))
  })

  it("custo: resposta longa (55 s) < 1% de CPU e nenhum chunk > 10 ms", (ctx) => {
    // Orçamento ABSOLUTO de CPU: com a máquina saturada (mais processos prontos que núcleos) o tempo de CPU
    // do próprio processo também infla — no Apple Silicon ele vai para os núcleos de eficiência — e a medida
    // deixa de dizer algo sobre o motor. Nesse caso o teste é pulado e diz por quê; em máquina normal e no CI vale.
    if (os.loadavg()[0] > os.availableParallelism()) {
      console.warn(`[lip-sync] custo de CPU não medido: máquina saturada (carga ${os.loadavg()[0].toFixed(1)} em ${os.availableParallelism()} núcleos)`)
      ctx.skip()
    }
    warmUpEngine()
    const schedule = scheduleOf("resposta-longa")
    const steps = replaySteps(schedule)
    // O custo real é por chunk (cada `pushAudio` roda na thread principal quando o áudio chega):
    // o que importa é não travar um quadro, e o total ficar desprezível perto da duração da fala.
    // Medido em tempo de CPU do processo (o relógio contaria o tempo fora da CPU com a máquina
    // ocupada) e no MELHOR de 3 replays: ruído da máquina só soma tempo; uma regressão real do
    // motor aparece nas três medições.
    const cpuMs = () => {
      const usage = process.cpuUsage()
      return (usage.user + usage.system) / 1000
    }
    const measure = () => {
      const run = createSpeechLipsyncEngine({})
      let worstChunk = 0
      const started = cpuMs()
      replayIntoEngine(run, { ...schedule, steps }, {
        onStep: (() => {
          let last = cpuMs()
          return () => {
            const now = cpuMs()
            worstChunk = Math.max(worstChunk, now - last)
            last = now
          }
        })(),
      })
      return { elapsed: cpuMs() - started, worst: worstChunk }
    }
    const runs = [measure(), measure(), measure()]
    // A carga oscila: conferida também DEPOIS de medir (medida feita sob saturação não diz nada sobre o motor).
    const loadAfter = os.loadavg()[0] ?? 0
    if (loadAfter > os.availableParallelism()) {
      console.warn(`[lip-sync] custo de CPU descartado: a máquina saturou durante a medida (carga ${loadAfter.toFixed(1)} em ${os.availableParallelism()} núcleos)`)
      ctx.skip()
    }
    const elapsed = Math.min(...runs.map((run) => run.elapsed))
    const worst = Math.min(...runs.map((run) => run.worst))
    const speechSeconds = schedule.speechEnd - schedule.speechStart
    expect(elapsed).toBeLessThan(speechSeconds * 1000 * 0.01)
    expect(worst).toBeLessThan(10)
  })

  it("sample() sem alocação por quadro", () => {
    warmUpEngine()
    const schedule = scheduleOf("resposta-longa")
    const engine = createSpeechLipsyncEngine({})
    replayIntoEngine(engine, { ...schedule, steps: replaySteps(schedule) })

    v8.setFlagsFromString("--expose-gc")
    const gc = vm.runInNewContext("gc") as () => void
    const frame = createSpeechFrame()
    const t0 = schedule.speechStart
    const span = schedule.speechEnd - schedule.speechStart
    // Aquecimento explícito até o V8 otimizar `sample()`: com 2.000 chamadas a medida dependia dos testes anteriores (e, com a
    // máquina sobrecarregada, da compilação em segundo plano) e às vezes pegava código não otimizado (~1,5 KB/chamada).
    for (let i = 0; i < 100_000; i++) engine.sample(t0 + (i / 100_000) * span, frame)
    gc()
    const before = process.memoryUsage().heapUsed
    for (let i = 0; i < 5000; i++) engine.sample(t0 + (i / 5000) * span, frame)
    const allocated = process.memoryUsage().heapUsed - before
    // Sem arrays/objetos por chamada (tudo em typed arrays). O que sobra é o V8 embrulhando os
    // números gravados nos campos da pose (~140 B/chamada medidos fora do vitest ≈ 9 KB/s a 60 fps,
    // lixo de geração jovem desprezível). Uma regressão real (arrays por quadro) passaria de 1 KB.
    expect(allocated / 5000).toBeLessThan(512)
  })
})
