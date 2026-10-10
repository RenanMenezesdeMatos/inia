/**
 * Diagnóstico: alinha cada fixture de duas formas — OFFLINE (todo o áudio + todo o texto de uma vez)
 * e STREAMING (replay real, chunk a chunk) — e mede as mesmas métricas dos testes, para separar
 * erro do modelo acústico/duração de erro da consolidação incremental.
 *
 *   npx tsx scripts/dev/lipsync-offline-check.ts [fixture]
 */
import { buildReplaySchedule, listFixtureIds, loadFixture, replayIntoEngine } from "../../src/lib/avatar/lipsync/__fixtures__/load-fixture"
import { PHONES, isBilabial } from "../../src/lib/avatar/lipsync/phones"
import { createSpeechLipsyncEngine } from "../../src/lib/avatar/lipsync/speech-lipsync-engine"
import type { AlignedPhone, AudioFeatureFrame, SpeechLipsyncEngine } from "../../src/lib/avatar/lipsync/types"

const ids = process.argv[2] ? [process.argv[2]] : listFixtureIds()

function frameAt(frames: AudioFeatureFrame[], t: number): AudioFeatureFrame {
  let lo = 0
  let hi = frames.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (frames[mid].time < t) lo = mid + 1
    else hi = mid
  }
  return frames[lo]
}

function metrics(engine: SpeechLipsyncEngine, speechEnd: number) {
  const { phones, frames } = engine.debugSnapshot()
  const aligned = phones.filter((p) => p.source === "aligned")
  const nuclei = aligned.filter((p) => p.nucleus && PHONES[p.phone].class === "vowel")
  const center = (p: AlignedPhone) => (p.start + p.end) / 2
  let ok = 0
  const bil = aligned.filter((p) => isBilabial(p.phone))
  const misses: string[] = []
  for (const phone of bil) {
    const c = center(phone)
    const before = [...nuclei].reverse().find((n) => center(n) < c)
    const after = nuclei.find((n) => center(n) > c)
    const ref = [before, after].filter(Boolean).map((n) => frameAt(frames, center(n!)).energyDb)
    const reference = ref.reduce((a, b) => a + b, 0) / ref.length
    // /m/ é nasal e vozeado: a energia TOTAL quase não cai, mas a banda de vogais (300–3000 Hz) cai.
    const nasal = phone.phone === "m"
    const band = (f: AudioFeatureFrame) => (nasal ? f.vowelBandDb : f.energyDb)
    const ref2 = [before, after].filter(Boolean).map((n) => band(frameAt(frames, center(n!))))
    const reference2 = ref2.reduce((a, b) => a + b, 0) / ref2.length
    const energy = Math.min(band(frameAt(frames, c - 0.01)), band(frameAt(frames, c)), band(frameAt(frames, c + 0.01)))
    if (energy <= (nasal ? reference2 : reference) - 6) ok++
    else misses.push(`${phone.phone}@${c.toFixed(2)}(w${phone.wordIndex} Δ${(reference - energy).toFixed(1)}dB)`)
  }
  const words = aligned.filter((p) => p.wordIndex >= 0)
  const lastWord = Math.max(...words.map((p) => p.wordIndex))
  const lastEnd = Math.max(...words.filter((p) => p.wordIndex === lastWord).map((p) => p.end))
  return {
    bilabial: `${ok}/${bil.length}`,
    misses: misses.join(" "),
    audioOnly: phones.length - aligned.length,
    lastWord,
    endErr: (lastEnd - speechEnd).toFixed(3),
    words: words.map((p) => p.wordIndex).filter((w, i, a) => a.indexOf(w) === i).length,
  }
}

for (const id of ids) {
  const fixture = loadFixture(id)
  const schedule = buildReplaySchedule(fixture, { clockOffset: 12.5 })
  // Streaming
  const streaming = createSpeechLipsyncEngine({})
  replayIntoEngine(streaming, schedule)
  // Offline: todo o áudio primeiro, depois todo o texto, depois fim
  const offline = createSpeechLipsyncEngine({})
  offline.beginTurn(1)
  for (const step of schedule.steps) if (step.kind === "audio") offline.pushAudio({ ...step.chunk, receivedAt: schedule.audioStart - 10 })
  for (const step of schedule.steps) if (step.kind === "transcript") offline.pushTranscript({ ...step.fragment, receivedAt: schedule.audioStart - 10 })
  offline.endOfText(1)
  console.log(`\n== ${id}  (speech ${schedule.speechStart.toFixed(2)}–${schedule.speechEnd.toFixed(2)})`)
  console.log("  streaming", JSON.stringify(metrics(streaming, schedule.speechEnd)))
  console.log("  offline  ", JSON.stringify(metrics(offline, schedule.speechEnd)))
}
