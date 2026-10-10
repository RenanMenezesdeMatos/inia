/**
 * Laboratório do lip-sync (só dev): métricas objetivas por captura real do Gemini Live, com o G2P
 * PT-BR de verdade. Mesmas medidas do teste de regressão (`__fixtures__/fixture-metrics.ts`).
 *
 *   npx tsx scripts/dev/lipsync-metrics.ts [fixture|all] [--transcript-delay 1.5] [--transcript-jitter 0.5] [--seed 1] [--words]
 *   npx tsx scripts/dev/lipsync-metrics.ts all --sweep [--transcript-jitter 0.5] [--seed 1]
 *
 * `--words` compara o início de cada palavra com o mesmo áudio com o texto em dia; `--sweep` faz uma
 * tabela por atraso (0 / 0,25 / 0,5 / 1 / 1,5 s): bilabiais no vale, vogais vozeadas, fricativas na
 * banda alta, fim da última palavra, fones só-áudio e palavras deslocadas > 60 ms.
 */
import { compareWordTimings, formatMetrics, measureFixture } from "../../src/lib/avatar/lipsync/__fixtures__/fixture-metrics"
import { buildReplaySchedule, listFixtureIds, loadFixture } from "../../src/lib/avatar/lipsync/__fixtures__/load-fixture"
import { phonemizeText } from "../../src/lib/avatar/lipsync/pt-br/g2p"

const args = process.argv.slice(2)
const option = (name: string, fallback: number) => {
  const index = args.indexOf(name)
  return index >= 0 ? Number(args[index + 1]) : fallback
}
const transcriptDelay = option("--transcript-delay", 0)
const transcriptJitter = option("--transcript-jitter", 0)
const jitterSeed = option("--seed", 1)
const target = args.find((arg, index) => !arg.startsWith("--") && !(index > 0 && args[index - 1].startsWith("--"))) ?? "all"
const ids = target === "all" ? listFixtureIds() : [target]
const pct = (x: number) => `${(x * 100).toFixed(0)}%`.padStart(4)

for (const id of ids) {
  const schedule = buildReplaySchedule(loadFixture(id), { clockOffset: 50 })
  const reference = measureFixture(schedule).engine.debugSnapshot().phones
  if (args.includes("--sweep")) {
    console.log(id)
    for (const delay of [0, 0.25, 0.5, 1, 1.5]) {
      const { metrics: m, engine } = measureFixture(schedule, { replay: { transcriptDelay: delay, transcriptJitter, jitterSeed } })
      const words = compareWordTimings(reference, engine.debugSnapshot().phones)
      console.log(
        `  ${delay.toFixed(2)} s  bilabiais ${pct(m.bilabials.ratio)}  vogais ${pct(m.vowels.ratio)}  fricativas ${pct(m.fricatives.ratio)}  última palavra ${(m.lastWordEndError * 1000).toFixed(0).padStart(4)} ms  só-áudio ${String(m.audioOnlyPhones).padStart(2)}  palavras ${words.compared}+${words.missing} só-áudio, > 60 ms ${words.beyond} (máx ${words.maxDeltaMs.toFixed(0)} ms)`,
      )
    }
    continue
  }
  const { metrics, engine } = measureFixture(schedule, { replay: { transcriptDelay, transcriptJitter, jitterSeed } })
  console.log(formatMetrics(metrics))
  if (args.includes("--words")) {
    const phones = engine.debugSnapshot().phones
    const words = phonemizeText(schedule.fixture.transcript)
    const span = (list: typeof phones, w: number) => {
      const own = list.filter((p) => p.wordIndex === w && p.source === "aligned")
      return own.length > 0 ? `${(own[0].start - schedule.audioStart).toFixed(2)}–${(own[own.length - 1].end - schedule.audioStart).toFixed(2)}` : "só-áudio "
    }
    words.forEach((word, w) => console.log(`  ${String(w).padStart(3)} ${word.text.padEnd(18)} em dia ${span(reference, w)}  aqui ${span(phones, w)}`))
    const comparison = compareWordTimings(reference, phones)
    console.log(`  palavras > 60 ms: ${comparison.beyond}/${comparison.compared} (máx ${comparison.maxDeltaMs.toFixed(0)} ms), só-áudio ${comparison.missing}`)
  }
}
